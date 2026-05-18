import { extractConfluenceAssets, processConfluenceAssets, renderProcessedAssetsToNotionBlocks } from '../assets';
import { detectConfluencePage, fetchConfluencePageStorage, parseConfluenceStorageXml } from '../confluence';
import { convertConfluenceStorageToNotionBlocks, type NotionBlock } from '../converter';
import { notionOAuthConfig, type NotionAuthOptions, type NotionOAuthConfig, NotionWriterError, writeClippedNotionPage } from '../notion';
import type { ClipTaskOperationContext, ClipTaskOperationResult } from './clipTaskRunner';
import type { ClipTaskResult, ConfluencePageData, Degradation, NotionTarget } from '../shared/domain';
import { readConfluenceBaseUrl, readLocalStorageValue, storageKeys } from '../shared/storage';
import type { RetriableFetchAttempt } from '../shared/request';

export interface SaveConfluencePageOperationOptions {
  pageUrl: string;
  domPageId?: string;
  bootstrapPageId?: string;
  fetcher?: RetriableFetchAttempt;
  notionConfig?: NotionOAuthConfig;
  now?: () => Date;
}

interface PipelineState {
  pageData?: ConfluencePageData;
  target?: NotionTarget;
  warnings: Degradation[];
  blockCount: number;
  assetCount: number;
  notionPageId?: string;
  notionPageUrl?: string;
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
        return fail(options, 'notion-auth-missing', 'Connect Notion in Options before saving.', context, state);
      }

      await context.updateStatus('detecting', 'Detecting Confluence page');
      const detection = await detectConfluencePage({
        baseUrl,
        pageUrl: options.pageUrl,
        domPageId: options.domPageId,
        bootstrapPageId: options.bootstrapPageId
      });
      if (!detection.ok) {
        return fail(options, detectionFailureCode(detection.reason), detectionFailureMessage(detection.reason), context, state);
      }

      await context.updateStatus('fetching', 'Fetching Confluence storage');
      const fetched = await fetchConfluencePageStorage(detection.pageRef, {
        fetcher: options.fetcher,
        deadlineMs: context.deadlineMs
      });
      if (!fetched.ok) {
        return fail(options, fetchFailureCode(fetched.reason), fetchFailureMessage(fetched.reason), context, state);
      }
      state.pageData = fetched.pageData;

      await context.updateStatus('parsing', 'Parsing Confluence storage XML');
      const parsed = parseConfluenceStorageXml(fetched.pageData.bodyStorageXml);
      if (!parsed.ok) {
        return fail(options, 'confluence-storage-parse-failed', parsed.message, context, state);
      }
      state.warnings.push(...parsed.degradations);

      await context.updateStatus('converting', 'Converting content to Notion blocks');
      const converted = convertConfluenceStorageToNotionBlocks(parsed.document);
      state.warnings.push(...converted.degradations);

      const extractedAssets = extractConfluenceAssets(fetched.pageData, parsed.document).assets;
      state.assetCount = extractedAssets.length;

      await context.updateStatus('uploading_assets', 'Uploading assets to Notion');
      const authOptions = notionAuthOptions(options, context.deadlineMs);
      const processedAssets = await processConfluenceAssets(extractedAssets, authOptions);
      const renderedAssets = renderProcessedAssetsToNotionBlocks(processedAssets.assets);
      state.warnings.push(...processedAssets.degradations);

      const contentBlocks = [...converted.blocks, ...renderedAssets.blocks] as NotionBlock[];
      state.blockCount = contentBlocks.length;

      await context.updateStatus('writing', 'Writing Notion page');
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
        return fail(options, 'notion-write-failed', error.guidance ?? error.message, context, state);
      }

      return fail(options, 'clip-save-failed', error instanceof Error ? error.message : 'Save failed.', context, state);
    }
  };
}

function notionAuthOptions(options: SaveConfluencePageOperationOptions, deadlineMs: number): NotionAuthOptions {
  return {
    config: options.notionConfig ?? notionOAuthConfig,
    fetcher: options.fetcher,
    now: options.now,
    deadlineMs
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
    blockCount: state.blockCount,
    assetCount: state.assetCount,
    warningCount: state.warnings.length,
    elapsedMs: Math.max(0, (options.now?.() ?? new Date()).getTime() - Date.parse(context.startedAt))
  };
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
