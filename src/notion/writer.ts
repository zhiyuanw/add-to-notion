import type { NotionBlock, NotionParagraphBlock, NotionToggleBlock } from '../converter';
import type { ConfluencePageData, NotionDatabaseTarget, NotionPageTarget, NotionTarget } from '../shared/domain';
import { notionApiFetch, type NotionAuthOptions } from './auth';

export interface CreateNotionPageRequest {
  target: NotionTarget;
  title: string;
  blocks: NotionBlock[];
}

export interface WriteClippedNotionPageRequest {
  target: NotionTarget;
  pageData: ConfluencePageData;
  contentBlocks: NotionBlock[];
}

export interface CreateNotionPageResult {
  pageId: string;
  pageUrl?: string;
}

export interface WriteClippedNotionPageResult extends CreateNotionPageResult {
  appendedBlockCount: number;
}

interface NotionPageCreateResponse {
  id?: unknown;
  url?: unknown;
}

export class NotionWriterError extends Error {
  guidance?: string;
  pageId?: string;
  pageUrl?: string;
  partialWrite?: boolean;

  constructor(message: string, guidance?: string, partialPage?: CreateNotionPageResult, partialWrite = false) {
    super(message);
    this.name = 'NotionWriterError';
    this.guidance = guidance;
    this.pageId = partialPage?.pageId;
    this.pageUrl = partialPage?.pageUrl;
    this.partialWrite = partialWrite;
  }
}

export const notionTargetInvalidGuidance =
  'The selected Notion target is unavailable, missing write access, or its title property changed. Re-select the target in Options and check the Notion connection capabilities.';

export const notionPartialWriteGuidance =
  'A Notion page was created before the save failed. Open the partial page, inspect it, and delete it manually if needed.';

export async function createNotionPage(
  request: CreateNotionPageRequest,
  options: NotionAuthOptions = {}
): Promise<CreateNotionPageResult> {
  const response = await notionApiFetch(
    'https://api.notion.com/v1/pages',
    {
      method: 'POST',
      body: JSON.stringify(buildCreatePageBody(request))
    },
    options
  );

  if (!response.ok) {
    if (isTargetInvalidStatus(response.status)) {
      throw new NotionWriterError('target-invalid', await targetInvalidGuidance(response));
    }

    throw new NotionWriterError(`notion-page-create-failed:${response.status}`);
  }

  const payload = (await response.json()) as NotionPageCreateResponse;
  return {
    pageId: requireString(payload.id, 'missing-created-page-id'),
    ...(typeof payload.url === 'string' && payload.url.length > 0 ? { pageUrl: payload.url } : {})
  };
}

export async function writeClippedNotionPage(
  request: WriteClippedNotionPageRequest,
  options: NotionAuthOptions = {}
): Promise<WriteClippedNotionPageResult> {
  const createdPage = await createNotionPage(
    {
      target: request.target,
      title: request.pageData.title,
      blocks: []
    },
    options
  );
  const blocks = [createMetadataToggleBlock(request.pageData, options.now?.() ?? new Date()), ...request.contentBlocks];

  const batches = chunkBlocks(blocks, 100);
  for (const [index, batch] of batches.entries()) {
    const response = await notionApiFetch(
      `https://api.notion.com/v1/blocks/${createdPage.pageId}/children`,
      {
        method: 'PATCH',
        body: JSON.stringify({ children: batch })
      },
      options
    );
    options.debugLogger?.notionWriteBatchSummary({ batchIndex: index + 1, batchCount: batches.length, blockCount: batch.length, status: response.status });

    if (!response.ok) {
      throw new NotionWriterError(`notion-block-append-failed:${response.status}`, notionPartialWriteGuidance, createdPage, true);
    }
  }

  return {
    ...createdPage,
    appendedBlockCount: blocks.length
  };
}

async function targetInvalidGuidance(response: Response): Promise<string> {
  const message = await readNotionErrorMessage(response);
  return message ? `${notionTargetInvalidGuidance} Notion: ${message}` : notionTargetInvalidGuidance;
}

async function readNotionErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.clone().json();
    if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildCreatePageBody(request: CreateNotionPageRequest): Record<string, unknown> {
  if (request.target.type === 'database') {
    return buildDatabasePageCreateBody(request.target, request.title, request.blocks);
  }

  return buildChildPageCreateBody(request.target, request.title, request.blocks);
}

function buildDatabasePageCreateBody(target: NotionDatabaseTarget, title: string, blocks: NotionBlock[]): Record<string, unknown> {
  const titlePropertyName = requireString(target.titlePropertyName, 'database-title-property-missing');
  return {
    parent: { database_id: target.id },
    properties: {
      [titlePropertyName]: {
        title: [createTitleRichText(title)]
      }
    },
    children: blocks
  };
}

function buildChildPageCreateBody(target: NotionPageTarget, title: string, blocks: NotionBlock[]): Record<string, unknown> {
  return {
    parent: { page_id: target.id },
    properties: {
      title: [createTitleRichText(title)]
    },
    children: blocks
  };
}

function createTitleRichText(title: string): Record<string, unknown> {
  return {
    type: 'text',
    text: { content: title }
  };
}

function createMetadataToggleBlock(pageData: ConfluencePageData, clippedAt: Date): NotionToggleBlock {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [createRichText('Confluence metadata')],
      children: metadataLines(pageData, clippedAt).map(createParagraphBlock)
    }
  };
}

function metadataLines(pageData: ConfluencePageData, clippedAt: Date): string[] {
  return [
    `Original URL: ${pageData.pageRef.pageUrl}`,
    `Confluence Base URL: ${pageData.pageRef.baseUrl}`,
    `Confluence Page ID: ${pageData.pageRef.pageId}`,
    `Confluence Space: ${formatSpace(pageData)}`,
    `Labels: ${pageData.metadata.labels.length > 0 ? pageData.metadata.labels.join(', ') : 'None'}`,
    `Last Modified: ${pageData.metadata.lastModified ?? 'Unknown'}`,
    `Last Clipped At: ${clippedAt.toISOString()}`
  ];
}

function formatSpace(pageData: ConfluencePageData): string {
  if (pageData.metadata.spaceName && pageData.metadata.spaceKey) {
    return `${pageData.metadata.spaceName} (${pageData.metadata.spaceKey})`;
  }

  return pageData.metadata.spaceName ?? pageData.metadata.spaceKey ?? 'Unknown';
}

function createParagraphBlock(content: string): NotionParagraphBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [createRichText(content)]
    }
  };
}

function createRichText(content: string): { type: 'text'; text: { content: string }; annotations: Record<string, never> } {
  return {
    type: 'text',
    text: { content },
    annotations: {}
  };
}

function chunkBlocks(blocks: NotionBlock[], size: number): NotionBlock[][] {
  return Array.from({ length: Math.ceil(blocks.length / size) }, (_, index) => blocks.slice(index * size, index * size + size));
}

function isTargetInvalidStatus(status: number): boolean {
  return status === 400 || status === 403 || status === 404;
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotionWriterError(error);
  }

  return value;
}
