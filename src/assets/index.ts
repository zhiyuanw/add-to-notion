import type { ConfluenceStorageDocument, ConfluenceStorageElement, ConfluenceStorageNode } from '../confluence/storageParser';
import { normalizeConfluenceBaseUrl } from '../confluence/baseUrl';
import { notionApiFetch, type NotionAuthOptions } from '../notion/auth';
import { fetchWithTimeoutAndRetry, type RetriableFetchAttempt } from '../shared/request';
import type { AssetKind, AssetRef, ConfluenceAttachment, ConfluencePageData, Degradation, NotionFileRef } from '../shared/domain';

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

export interface ProcessedConfluenceAsset extends ExtractedConfluenceAsset {
  notionFileRef?: NotionFileRef;
  degradation?: Degradation;
}

export interface ConfluenceAssetProcessingResult {
  assets: ProcessedConfluenceAsset[];
  degradations: Degradation[];
}

export interface NotionFileUploadCreateRequest {
  filename: string;
  mimeType: string;
  contentLength: number;
}

export interface NotionFileUploadCreateResponse {
  id: string;
  uploadUrl: string;
}

export interface NotionFileUploadCompleteResponse {
  fileUploadId: string;
  expiresAt?: string;
}

export interface ConfluenceAssetProcessingOptions extends NotionAuthOptions {
  fetcher?: RetriableFetchAttempt;
  createFileUpload?: (metadata: NotionFileUploadCreateRequest, options: ConfluenceAssetProcessingOptions) => Promise<NotionFileUploadCreateResponse>;
  uploadFileContents?: (
    uploadUrl: string,
    file: Blob,
    metadata: NotionFileUploadCreateRequest,
    options: ConfluenceAssetProcessingOptions
  ) => Promise<void>;
  completeFileUpload?: (fileUploadId: string, options: ConfluenceAssetProcessingOptions) => Promise<NotionFileUploadCompleteResponse>;
}

const maxUploadSizeBytes = 20 * 1024 * 1024;
const maxAttachWindowMs = 60 * 60 * 1000;
const assetUploadConcurrency = 3;

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

export async function processConfluenceAssets(
  assets: ExtractedConfluenceAsset[],
  options: ConfluenceAssetProcessingOptions = {}
): Promise<ConfluenceAssetProcessingResult> {
  const processed = new Array<ProcessedConfluenceAsset>(assets.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < assets.length) {
      const index = nextIndex;
      nextIndex += 1;
      processed[index] = await processSingleAsset(assets[index], options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(assetUploadConcurrency, assets.length) }, () => worker()));

  return {
    assets: processed,
    degradations: processed.flatMap((asset) => (asset.degradation ? [asset.degradation] : []))
  };
}

async function processSingleAsset(
  asset: ExtractedConfluenceAsset,
  options: ConfluenceAssetProcessingOptions
): Promise<ProcessedConfluenceAsset> {
  if (asset.size !== undefined && asset.size > maxUploadSizeBytes) {
    return degradeAsset(asset, 'skipped', 'asset-too-large', `Asset is larger than 20 MB: ${asset.sourceUrl}`);
  }

  if (!asset.requiresConfluenceCredentials) {
    return degradeAsset(asset, 'skipped', 'asset-cross-origin', `Cross-origin asset is preserved as a source link: ${asset.sourceUrl}`);
  }

  let file: Blob;

  try {
    file = await downloadConfluenceAsset(asset, options);
  } catch {
    return degradeAsset(asset, 'failed', 'asset-download-failed', `Could not download Confluence asset: ${asset.sourceUrl}`);
  }

  const metadata: NotionFileUploadCreateRequest = {
    filename: asset.filename ?? filenameFromUrl(asset.sourceUrl) ?? 'asset',
    mimeType: asset.mimeType ?? (file.type || 'application/octet-stream'),
    contentLength: file.size
  };

  try {
    const createFileUpload = options.createFileUpload ?? createNotionFileUpload;
    const uploadFileContents = options.uploadFileContents ?? uploadNotionFileContents;
    const completeFileUpload = options.completeFileUpload ?? completeNotionFileUpload;
    const upload = await createFileUpload(metadata, options);

    await uploadFileContents(upload.uploadUrl, file, metadata, options);

    const completed = await completeFileUpload(upload.id, options);

    if (!canAttachWithinOneHour(completed.expiresAt, options.now?.() ?? new Date())) {
      return degradeAsset(asset, 'failed', 'asset-attach-window-expired', `Notion file upload cannot be attached within 1 hour: ${asset.sourceUrl}`);
    }

    return {
      ...asset,
      status: 'uploaded',
      notionFileRef: {
        fileUploadId: completed.fileUploadId,
        filename: metadata.filename,
        ...(completed.expiresAt ? { expiresAt: completed.expiresAt } : {})
      }
    };
  } catch {
    return degradeAsset(asset, 'failed', 'asset-upload-failed', `Could not upload asset to Notion: ${asset.sourceUrl}`);
  }
}

async function downloadConfluenceAsset(asset: ExtractedConfluenceAsset, options: ConfluenceAssetProcessingOptions): Promise<Blob> {
  const response = await fetchWithTimeoutAndRetry(asset.sourceUrl, {
    fetcher: options.fetcher,
    credentials: 'include',
    deadlineMs: options.deadlineMs
  });

  if (!response.ok) {
    throw new Error(`asset-download-failed:${response.status}`);
  }

  return response.blob();
}

async function createNotionFileUpload(
  metadata: NotionFileUploadCreateRequest,
  options: ConfluenceAssetProcessingOptions
): Promise<NotionFileUploadCreateResponse> {
  const response = await notionApiFetch(
    'https://api.notion.com/v1/file_uploads',
    {
      method: 'POST',
      body: JSON.stringify({
        filename: metadata.filename,
        content_type: metadata.mimeType,
        content_length: metadata.contentLength
      })
    },
    options
  );

  if (!response.ok) {
    throw new Error(`notion-file-upload-create-failed:${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    id: requireString(payload.id, 'missing-file-upload-id'),
    uploadUrl: requireString(payload.upload_url ?? payload.uploadUrl, 'missing-file-upload-url')
  };
}

async function uploadNotionFileContents(
  uploadUrl: string,
  file: Blob,
  metadata: NotionFileUploadCreateRequest,
  options: ConfluenceAssetProcessingOptions
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file, metadata.filename);

  const response = await fetchWithTimeoutAndRetry(uploadUrl, {
    fetcher: options.fetcher,
    method: 'POST',
    body: formData,
    deadlineMs: options.deadlineMs
  });

  if (!response.ok) {
    throw new Error(`notion-file-upload-content-failed:${response.status}`);
  }
}

async function completeNotionFileUpload(fileUploadId: string, options: ConfluenceAssetProcessingOptions): Promise<NotionFileUploadCompleteResponse> {
  const response = await notionApiFetch(`https://api.notion.com/v1/file_uploads/${encodeURIComponent(fileUploadId)}/complete`, { method: 'POST' }, options);

  if (!response.ok) {
    throw new Error(`notion-file-upload-complete-failed:${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    fileUploadId: requireString(payload.id ?? payload.file_upload_id ?? payload.fileUploadId, 'missing-file-upload-id'),
    expiresAt: optionalString(payload.expires_at ?? payload.expiresAt)
  };
}

function canAttachWithinOneHour(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime() + maxAttachWindowMs;
}

function degradeAsset(
  asset: ExtractedConfluenceAsset,
  status: 'skipped' | 'failed',
  type: string,
  message: string
): ProcessedConfluenceAsset {
  const degradation: Degradation = {
    type,
    source: asset.sourceUrl,
    message,
    severity: 'warning'
  };

  return {
    ...asset,
    status,
    notionFileRef: {
      externalUrl: asset.sourceUrl,
      filename: asset.filename
    },
    degradation
  };
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(error);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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
