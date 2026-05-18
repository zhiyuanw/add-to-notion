import type { NotionDatabaseTarget, NotionPageTarget, NotionTarget } from '../shared/domain/models';
import { storageKeys, writeLocalStorageValue } from '../shared/storage';
import { notionApiFetch, type NotionAuthOptions } from './auth';

export interface NotionTargetSearchResult {
  targets: NotionTarget[];
  guidance?: string;
}

export type NotionTargetSelection = NotionPageTarget | Pick<NotionDatabaseTarget, 'type' | 'id'>;

interface NotionSearchResponse {
  results?: unknown;
}

interface NotionDatabaseResponse {
  object?: unknown;
  id?: unknown;
  title?: unknown;
  properties?: unknown;
}

export class NotionTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionTargetError';
  }
}

export const notionTargetAccessGuidance =
  'No accessible Notion pages or databases found. Grant the integration access to a page or database in Notion, then search again.';

export async function searchNotionTargets(query = '', options: NotionAuthOptions = {}): Promise<NotionTargetSearchResult> {
  const response = await notionApiFetch(
    'https://api.notion.com/v1/search',
    {
      method: 'POST',
      body: JSON.stringify(buildSearchBody(query))
    },
    options
  );

  if (!response.ok) {
    throw new NotionTargetError(`notion-target-search-failed:${response.status}`);
  }

  const payload = (await response.json()) as NotionSearchResponse;
  const targets = Array.isArray(payload.results) ? payload.results.flatMap(mapSearchResultToTarget) : [];

  return targets.length === 0 ? { targets, guidance: notionTargetAccessGuidance } : { targets };
}

export async function saveNotionTargetSelection(
  selection: NotionTargetSelection,
  options: NotionAuthOptions = {}
): Promise<NotionTarget> {
  if (selection.type === 'page') {
    const target: NotionPageTarget = {
      type: 'page',
      id: requireNonEmptyString(selection.id, 'missing-page-id'),
      displayName: requireNonEmptyString(selection.displayName, 'missing-page-display-name')
    };

    await writeLocalStorageValue(storageKeys.notionDefaultTarget, target);
    return target;
  }

  if (selection.type === 'database') {
    const target = await fetchDatabaseTarget(selection.id, options);
    await writeLocalStorageValue(storageKeys.notionDefaultTarget, target);
    return target;
  }

  throw new NotionTargetError('invalid-target-type');
}

async function fetchDatabaseTarget(id: string, options: NotionAuthOptions): Promise<NotionDatabaseTarget> {
  const databaseId = requireNonEmptyString(id, 'missing-database-id');
  const response = await notionApiFetch(`https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`, { method: 'GET' }, options);

  if (!response.ok) {
    throw new NotionTargetError(`notion-database-fetch-failed:${response.status}`);
  }

  const payload = (await response.json()) as NotionDatabaseResponse;

  if (payload.object !== 'database') {
    throw new NotionTargetError('invalid-database-response');
  }

  const titleProperty = findTitleProperty(payload.properties);

  if (!titleProperty) {
    throw new NotionTargetError('database-title-property-missing');
  }

  return {
    type: 'database',
    id: requireNonEmptyString(payload.id, 'missing-database-id'),
    displayName: extractRichTextPlainText(payload.title) ?? 'Untitled database',
    titlePropertyName: titleProperty.name,
    titlePropertyId: titleProperty.id
  };
}

function buildSearchBody(query: string): { query?: string; page_size: number } {
  const trimmedQuery = query.trim();
  return trimmedQuery.length > 0 ? { query: trimmedQuery, page_size: 100 } : { page_size: 100 };
}

function mapSearchResultToTarget(result: unknown): NotionTarget[] {
  if (!isRecord(result)) {
    return [];
  }

  if (result.object === 'page') {
    const id = optionalNonEmptyString(result.id);

    if (!id) {
      return [];
    }

    return [
      {
        type: 'page',
        id,
        displayName: extractPageTitle(result) ?? 'Untitled page'
      }
    ];
  }

  if (result.object === 'database') {
    const id = optionalNonEmptyString(result.id);

    if (!id) {
      return [];
    }

    return [
      {
        type: 'database',
        id,
        displayName: extractRichTextPlainText(result.title) ?? 'Untitled database'
      }
    ];
  }

  return [];
}

function extractPageTitle(page: Record<string, unknown>): string | undefined {
  if (!isRecord(page.properties)) {
    return undefined;
  }

  for (const property of Object.values(page.properties)) {
    if (isRecord(property) && property.type === 'title') {
      return extractRichTextPlainText(property.title);
    }
  }

  return undefined;
}

function findTitleProperty(properties: unknown): { name: string; id: string } | undefined {
  if (!isRecord(properties)) {
    return undefined;
  }

  for (const [name, property] of Object.entries(properties)) {
    if (isRecord(property) && property.type === 'title') {
      const id = optionalNonEmptyString(property.id);

      if (id) {
        return { name, id };
      }
    }
  }

  return undefined;
}

function extractRichTextPlainText(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((part) => (isRecord(part) && typeof part.plain_text === 'string' ? part.plain_text : ''))
    .join('')
    .trim();

  return text.length > 0 ? text : undefined;
}

function requireNonEmptyString(value: unknown, error: string): string {
  const stringValue = optionalNonEmptyString(value);

  if (!stringValue) {
    throw new NotionTargetError(error);
  }

  return stringValue;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
