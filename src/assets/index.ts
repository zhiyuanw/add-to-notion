import type { ConfluenceStorageDocument, ConfluenceStorageElement, ConfluenceStorageNode } from '../confluence/storageParser';
import { normalizeConfluenceBaseUrl } from '../confluence/baseUrl';
import type { AssetKind, AssetRef, ConfluenceAttachment, ConfluencePageData } from '../shared/domain';

export const assetsModuleName = 'assets';

export type AssetClassification = 'same-origin' | 'cross-origin';

export interface ExtractedConfluenceAsset extends AssetRef {
  classification: AssetClassification;
  isInsideConfiguredBasePath: boolean;
  requiresConfluenceCredentials: boolean;
  drawioSourceUrl?: string;
}

export interface ConfluenceAssetExtractionResult {
  assets: ExtractedConfluenceAsset[];
}

interface AssetCandidate {
  sourceUrl: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  kind: AssetKind;
  drawioSourceUrl?: string;
}

export function extractConfluenceAssets(
  pageData: ConfluencePageData,
  document: ConfluenceStorageDocument
): ConfluenceAssetExtractionResult {
  const baseUrl = normalizeConfluenceBaseUrl(pageData.pageRef.baseUrl);
  if (!baseUrl.ok) {
    return { assets: [] };
  }

  const candidates = [...storageImageCandidates(document), ...drawioCandidates(document), ...attachmentCandidates(pageData.attachments)];
  const assets = candidates.flatMap((candidate) => toExtractedAsset(candidate, baseUrl.normalizedUrl, baseUrl.origin, baseUrl.contextPath));

  return { assets: dedupeAssets(assets) };
}

function storageImageCandidates(document: ConfluenceStorageDocument): AssetCandidate[] {
  return collectElements(document.children)
    .filter((element) => element.namespacePrefix === 'ac' && element.localName === 'image')
    .flatMap((image) => {
      const resource = elementChildren(image).find((child) => child.namespacePrefix === 'ri' && (child.localName === 'url' || child.localName === 'attachment'));
      if (!resource) {
        return [];
      }
      const sourceUrl = resourceUrl(resource);
      if (!sourceUrl) {
        return [];
      }
      return [
        {
          sourceUrl,
          filename: filenameFromResource(resource),
          kind: 'image' as const
        }
      ];
    });
}

function drawioCandidates(document: ConfluenceStorageDocument): AssetCandidate[] {
  return collectElements(document.children)
    .filter((element) => element.namespacePrefix === 'ac' && element.localName === 'structured-macro' && macroName(element) === 'drawio')
    .flatMap((macro) => {
      const sourceUrl = firstMacroParameter(macro, ['previewUrl', 'renderUrl', 'imageUrl', 'url']);
      if (!sourceUrl) {
        return [];
      }
      return [
        {
          sourceUrl,
          filename: firstMacroParameter(macro, ['diagramName', 'filename']),
          kind: 'drawio' as const,
          drawioSourceUrl: firstMacroParameter(macro, ['sourceUrl', 'attachmentUrl'])
        }
      ];
    });
}

function attachmentCandidates(attachments: ConfluenceAttachment[]): AssetCandidate[] {
  return attachments.flatMap((attachment) => {
    if (!attachment.downloadUrl) {
      return [];
    }
    return [
      {
        sourceUrl: attachment.downloadUrl,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: kindForAttachment(attachment)
      }
    ];
  });
}

function toExtractedAsset(
  candidate: AssetCandidate,
  normalizedBaseUrl: string,
  origin: string,
  contextPath: string
): ExtractedConfluenceAsset[] {
  const sourceUrl = resolveUrl(candidate.sourceUrl, normalizedBaseUrl);
  if (!sourceUrl) {
    return [];
  }

  const drawioSourceUrl = candidate.drawioSourceUrl ? resolveUrl(candidate.drawioSourceUrl, normalizedBaseUrl) : undefined;
  const parsed = new URL(sourceUrl);
  const sameOrigin = parsed.origin === origin;

  return [
    {
      sourceUrl,
      filename: candidate.filename,
      mimeType: candidate.mimeType,
      size: candidate.size,
      kind: candidate.kind,
      status: 'pending',
      classification: sameOrigin ? 'same-origin' : 'cross-origin',
      isInsideConfiguredBasePath: sameOrigin && isInsideBasePath(parsed, contextPath),
      requiresConfluenceCredentials: sameOrigin,
      ...(drawioSourceUrl ? { drawioSourceUrl } : {})
    }
  ];
}

function resolveUrl(value: string, normalizedBaseUrl: string): string | undefined {
  try {
    return new URL(value, normalizedBaseUrl).href;
  } catch {
    return undefined;
  }
}

function dedupeAssets(assets: ExtractedConfluenceAsset[]): ExtractedConfluenceAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = `${asset.kind}:${asset.sourceUrl}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function kindForAttachment(attachment: ConfluenceAttachment): AssetKind {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename.toLowerCase();

  if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(filename)) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) return 'pdf';
  return 'file';
}

function isInsideBasePath(url: URL, contextPath: string): boolean {
  if (contextPath === '') {
    return true;
  }
  return url.pathname === contextPath || url.pathname.startsWith(`${contextPath}/`);
}

function collectElements(nodes: ConfluenceStorageNode[]): ConfluenceStorageElement[] {
  return nodes.flatMap((node) => {
    if (node.type === 'text') {
      return [];
    }
    return [node, ...collectElements(node.children)];
  });
}

function elementChildren(node: ConfluenceStorageElement): ConfluenceStorageElement[] {
  return node.children.filter((child): child is ConfluenceStorageElement => child.type === 'element');
}

function attributeValue(element: ConfluenceStorageElement, localName: string): string | undefined {
  return element.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function resourceUrl(resource: ConfluenceStorageElement): string | undefined {
  if (resource.localName === 'url') {
    return attributeValue(resource, 'value') ?? attributeValue(resource, 'url');
  }
  return attributeValue(resource, 'filename');
}

function filenameFromResource(resource: ConfluenceStorageElement): string | undefined {
  return attributeValue(resource, 'filename') ?? filenameFromUrl(resourceUrl(resource));
}

function filenameFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const pathname = new URL(url, 'https://placeholder.invalid').pathname;
    const filename = pathname.split('/').filter(Boolean).at(-1);
    return filename ? decodeURIComponent(filename) : undefined;
  } catch {
    return undefined;
  }
}

function macroName(node: ConfluenceStorageElement): string | undefined {
  return attributeValue(node, 'name')?.trim();
}

function firstMacroParameter(node: ConfluenceStorageElement, names: string[]): string | undefined {
  for (const name of names) {
    const value = macroParameter(node, name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function macroParameter(node: ConfluenceStorageElement, name: string): string | undefined {
  return elementChildren(node)
    .find((child) => child.localName === 'parameter' && attributeValue(child, 'name') === name)
    ?.children.map((child) => (child.type === 'text' ? child.text : collectPlainText(child.children)))
    .join('')
    .trim();
}

function collectPlainText(nodes: ConfluenceStorageNode[]): string {
  return nodes.map((node) => (node.type === 'text' ? node.text : collectPlainText(node.children))).join('');
}
