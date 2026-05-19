import { extractConfluenceAssets, processConfluenceAssets, renderProcessedAssetsToNotionBlocks, type ProcessedConfluenceAsset } from '../assets';
import { detectConfluencePage, fetchConfluencePageStorage, parseConfluenceStorageXml, type ConfluenceStorageDocument, type ConfluenceStorageElement, type ConfluenceStorageNode } from '../confluence';
import { convertConfluenceStorageToNotionBlocks, type NotionBlock } from '../converter';
import { type NotionApiConfig, type NotionAuthOptions, NotionWriterError, writeClippedNotionPage } from '../notion';
import type { ClipTaskOperationContext, ClipTaskOperationResult } from './clipTaskRunner';
import type { ClipTaskResult, ConfluencePageData, Degradation, NotionTarget } from '../shared/domain';
import type { AssetKind } from '../shared/domain';
import { createDebugLogger, type DebugLogger } from '../shared/debugLogger';
import { readConfluenceBaseUrl, readLocalStorageValue, storageKeys } from '../shared/storage';
import type { RetriableFetchAttempt } from '../shared/request';

export interface SaveConfluencePageOperationOptions {
  pageUrl: string;
  domPageId?: string;
  bootstrapPageId?: string;
  fetcher?: RetriableFetchAttempt;
  notionConfig?: NotionApiConfig;
  now?: () => Date;
  debugLogger?: DebugLogger;
}

interface PipelineState {
  pageData?: ConfluencePageData;
  target?: NotionTarget;
  warnings: Degradation[];
  blockCount: number;
  assetCount: number;
  notionPageId?: string;
  notionPageUrl?: string;
  partial?: boolean;
}

export function createSaveConfluencePageOperation(
  options: SaveConfluencePageOperationOptions
): (context: ClipTaskOperationContext) => Promise<ClipTaskOperationResult> {
  return async (context) => {
    const state: PipelineState = {
      warnings: [],
      blockCount: 0,
      assetCount: 0
    };

    const logger = options.debugLogger ?? createDebugLogger();

    try {
      const baseUrl = await readConfluenceBaseUrl();
      if (!baseUrl) {
        return fail(options, 'confluence-base-url-missing', 'Configure a Confluence base URL in Options before saving.', context, state);
      }

      state.target = await readLocalStorageValue(storageKeys.notionDefaultTarget);
      if (!state.target) {
        return fail(options, 'notion-target-missing', 'Select a Notion database or page target in Options before saving.', context, state);
      }

      if (!(await readLocalStorageValue(storageKeys.notionAuthState))) {
        return fail(options, 'notion-auth-missing', 'Configure a Notion integration token in Options before saving.', context, state);
      }

      await context.updateStatus('detecting', 'Detecting Confluence page');
      logger.stageStart('detecting');
      const detection = await detectConfluencePage({
        baseUrl,
        pageUrl: options.pageUrl,
        domPageId: options.domPageId,
        bootstrapPageId: options.bootstrapPageId,
        fetcher: options.fetcher
      });
      if (!detection.ok) {
        logger.stageEnd('detecting', { status: 'failed', reason: detection.reason });
        return fail(options, 'confluence-detection-' + detection.reason, detectionFailureMessage(detection.reason), context, state);
      }
      logger.stageEnd('detecting');

      await context.updateStatus('fetching', 'Fetching Confluence storage');
      logger.stageStart('fetching');
      const fetched = await fetchConfluencePageStorage(detection.pageRef, {
        fetcher: options.fetcher,
        deadlineMs: context.deadlineMs,
        debugLogger: logger
      });
      if (!fetched.ok) {
        logger.stageEnd('fetching', { status: 'failed', reason: fetched.reason });
        return fail(options, fetchFailureCode(fetched.reason), fetchFailureMessage(fetched.reason), context, state);
      }
      state.pageData = fetched.pageData;
      logger.stageEnd('fetching', { title: fetched.pageData.title });

      await context.updateStatus('parsing', 'Parsing Confluence storage XML');
      logger.stageStart('parsing');
      const parsed = parseConfluenceStorageXml(fetched.pageData.bodyStorageXml);
      if (!parsed.ok) {
        logger.stageEnd('parsing', { status: 'failed' });
        return fail(options, 'confluence-storage-parse-failed', parsed.message, context, state);
      }
      state.warnings.push(...parsed.degradations);
      logger.xmlParseSummary({ rootChildCount: parsed.document.children.length, degradationCount: parsed.degradations.length });
      logger.stageEnd('parsing');

      await context.updateStatus('converting', 'Converting content to Notion blocks');
      logger.stageStart('converting');
      const converted = convertConfluenceStorageToNotionBlocks(parsed.document, { attachments: fetched.pageData.attachments });
      state.warnings.push(...converted.degradations);
      logger.macroCountByType(countMacrosByType(parsed.document));
      logger.stageEnd('converting', { blockCount: converted.blocks.length, degradationCount: converted.degradations.length });

      const extractedAssets = extractConfluenceAssets(fetched.pageData, parsed.document).assets;
      state.assetCount = extractedAssets.length;

      await context.updateStatus('uploading_assets', 'Uploading assets to Notion');
      logger.stageStart('uploading_assets');
      const authOptions = notionAuthOptions(options, context.deadlineMs, logger);
      const processedAssets = await processConfluenceAssets(extractedAssets, authOptions);
      state.warnings.push(...processedAssets.degradations);
      logger.stageEnd('uploading_assets');

      const content = replaceAssetPlaceholders(converted.blocks, processedAssets.assets, fetched.pageData.pageRef.baseUrl, options.now);
      state.warnings.push(...content.attachTimeDegradations);
      const contentBlocks = content.blocks;
      state.blockCount = contentBlocks.length;

      await context.updateStatus('writing', 'Writing Notion page');
      logger.stageStart('writing');
      const writeResult = await writeClippedNotionPage(
        {
          target: state.target,
          pageData: fetched.pageData,
          contentBlocks
        },
        authOptions
      );
      state.notionPageId = writeResult.pageId;
      state.notionPageUrl = writeResult.pageUrl;
      state.blockCount = writeResult.appendedBlockCount;
      logger.stageEnd('writing', { notionPageId: writeResult.pageId, appendedBlockCount: writeResult.appendedBlockCount });

      return {
        status: 'succeeded',
        sourceTitle: fetched.pageData.title,
        sourceUrl: fetched.pageData.pageRef.pageUrl,
        target: state.target,
        result: buildResult(context, state, options),
        warnings: state.warnings
      };
    } catch (error) {
      if (error instanceof NotionWriterError) {
        state.notionPageId = error.pageId;
        state.notionPageUrl = error.pageUrl;
        state.partial = error.partialWrite;
        return fail(options, 'notion-write-failed', error.guidance ?? error.message, context, state);
      }

      return fail(options, 'clip-save-failed', error instanceof Error ? error.message : 'Save failed.', context, state);
    }
  };
}

interface AssetPlaceholderReplacementResult {
  blocks: NotionBlock[];
  attachTimeDegradations: Degradation[];
}

function replaceAssetPlaceholders(
  blocks: NotionBlock[],
  assets: ProcessedConfluenceAsset[],
  baseUrl: string,
  now?: () => Date
): AssetPlaceholderReplacementResult {
  const assetsByKey = new Map(assets.map((asset) => [assetKey(asset.kind, asset.sourceUrl), asset]));
  const replacedBlocks: NotionBlock[] = [];
  const attachTimeDegradations: Degradation[] = [];

  for (const block of blocks) {
    if (block.type === 'asset_placeholder') {
      const resolvedSourceUrl = resolveUrl(block.asset_placeholder.sourceUrl, baseUrl);
      const asset = resolvedSourceUrl ? assetsByKey.get(assetKey(block.asset_placeholder.kind, resolvedSourceUrl)) : undefined;
      if (asset) {
        const rendered = renderProcessedAssetsToNotionBlocks([asset], { now });
        replacedBlocks.push(...rendered.blocks);
        attachTimeDegradations.push(...rendered.attachTimeDegradations);
      }
      continue;
    }

    if (block.type === 'bulleted_list_item' && block.bulleted_list_item.children) {
      const replacedChildren = replaceAssetPlaceholders(block.bulleted_list_item.children, assets, baseUrl, now);
      attachTimeDegradations.push(...replacedChildren.attachTimeDegradations);
      replacedBlocks.push({
        ...block,
        bulleted_list_item: {
          ...block.bulleted_list_item,
          children: replacedChildren.blocks
        }
      });
      continue;
    }

    if (block.type === 'numbered_list_item' && block.numbered_list_item.children) {
      const replacedChildren = replaceAssetPlaceholders(block.numbered_list_item.children, assets, baseUrl, now);
      attachTimeDegradations.push(...replacedChildren.attachTimeDegradations);
      replacedBlocks.push({
        ...block,
        numbered_list_item: {
          ...block.numbered_list_item,
          children: replacedChildren.blocks
        }
      });
      continue;
    }

    if (block.type === 'toggle' && block.toggle.children) {
      const replacedChildren = replaceAssetPlaceholders(block.toggle.children, assets, baseUrl, now);
      attachTimeDegradations.push(...replacedChildren.attachTimeDegradations);
      replacedBlocks.push({
        ...block,
        toggle: {
          ...block.toggle,
          children: replacedChildren.blocks
        }
      });
      continue;
    }

    if (block.type === 'callout' && block.callout.children) {
      const replacedChildren = replaceAssetPlaceholders(block.callout.children, assets, baseUrl, now);
      attachTimeDegradations.push(...replacedChildren.attachTimeDegradations);
      replacedBlocks.push({
        ...block,
        callout: {
          ...block.callout,
          children: replacedChildren.blocks
        }
      });
      continue;
    }

    replacedBlocks.push(block);
  }

  return { blocks: replacedBlocks, attachTimeDegradations };
}

function assetKey(kind: AssetKind, sourceUrl: string): string {
  return `${kind}:${sourceUrl}`;
}

function resolveUrl(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function notionAuthOptions(options: SaveConfluencePageOperationOptions, deadlineMs: number, debugLogger: DebugLogger): NotionAuthOptions {
  return {
    config: options.notionConfig,
    fetcher: options.fetcher,
    now: options.now,
    deadlineMs,
    debugLogger
  };
}

function fail(
  options: Pick<SaveConfluencePageOperationOptions, 'now'>,
  code: string,
  message: string,
  context: ClipTaskOperationContext,
  state: PipelineState
): ClipTaskOperationResult {
  return {
    status: 'failed',
    sourceTitle: state.pageData?.title,
    sourceUrl: state.pageData?.pageRef.pageUrl,
    target: state.target,
    result: state.pageData || state.blockCount > 0 || state.assetCount > 0 || state.notionPageId ? buildResult(context, state, options) : undefined,
    warnings: state.warnings,
    failure: { code, message }
  };
}

function buildResult(context: ClipTaskOperationContext, state: PipelineState, options: Pick<SaveConfluencePageOperationOptions, 'now'>): ClipTaskResult {
  return {
    notionPageId: state.notionPageId,
    notionPageUrl: state.notionPageUrl,
    partial: state.partial,
    blockCount: state.blockCount,
    assetCount: state.assetCount,
    warningCount: state.warnings.length,
    elapsedMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - Date.parse(context.startedAt))
  };
}

function countMacrosByType(document: ConfluenceStorageDocument): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const macro of collectMacroElements(document.children)) {
    const name = macro.attributes.find((attribute) => attribute.localName === 'name')?.value ?? 'unknown';
    counts[name] = (counts[name] ?? 0) + 1;
  }

  return counts;
}

function collectMacroElements(nodes: ConfluenceStorageNode[]): ConfluenceStorageElement[] {
  return nodes.flatMap((node) => {
    if (node.type === 'text') {
      return [];
    }

    const nested = collectMacroElements(node.children);
    return node.namespacePrefix === 'ac' && node.localName === 'structured-macro' ? [node, ...nested] : nested;
  });
}

function detectionFailureCode(reason: string): string {
  return `confluence-detection-${reason}`;
}

function detectionFailureMessage(reason: string): string {
  if (reason === 'missing-host-permission') {
    return 'Grant Confluence host permission in Options before saving.';
  }
  if (reason === 'outside-base-url' || reason === 'unsupported-url' || reason === 'missing-page-id') {
    return 'Open a supported Confluence page inside the configured base URL before saving.';
  }
  return 'Could not detect a supported Confluence page.';
}

function fetchFailureCode(reason: string): string {
  return `confluence-fetch-${reason}`;
}

function fetchFailureMessage(reason: string): string {
  if (reason === 'auth-or-permission') {
    return 'Confluence rejected the request. Sign in or check page permissions, then try again.';
  }
  if (reason === 'missing-or-inaccessible') {
    return 'The Confluence page is missing or inaccessible.';
  }
  if (reason === 'temporary-confluence-failure') {
    return 'Confluence is temporarily unavailable. Try again later.';
  }
  return 'Could not fetch Confluence storage data.';
}
