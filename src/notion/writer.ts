import type { NotionBlock } from '../converter';
import type { NotionDatabaseTarget, NotionPageTarget, NotionTarget } from '../shared/domain';
import { notionApiFetch, type NotionAuthOptions } from './auth';

export interface CreateNotionPageRequest {
  target: NotionTarget;
  title: string;
  blocks: NotionBlock[];
}

export interface CreateNotionPageResult {
  pageId: string;
  pageUrl?: string;
}

interface NotionPageCreateResponse {
  id?: unknown;
  url?: unknown;
}

export class NotionWriterError extends Error {
  guidance?: string;

  constructor(message: string, guidance?: string) {
    super(message);
    this.name = 'NotionWriterError';
    this.guidance = guidance;
  }
}

export const notionTargetInvalidGuidance =
  'The selected Notion target is unavailable or its title property changed. Re-select the target in Options.';

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
      throw new NotionWriterError('target-invalid', notionTargetInvalidGuidance);
    }

    throw new NotionWriterError(`notion-page-create-failed:${response.status}`);
  }

  const payload = (await response.json()) as NotionPageCreateResponse;
  return {
    pageId: requireString(payload.id, 'missing-created-page-id'),
    ...(typeof payload.url === 'string' && payload.url.length > 0 ? { pageUrl: payload.url } : {})
  };
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

function isTargetInvalidStatus(status: number): boolean {
  return status === 400 || status === 403 || status === 404;
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotionWriterError(error);
  }

  return value;
}
