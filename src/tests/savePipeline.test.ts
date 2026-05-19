import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSaveConfluencePageOperation } from '../background/savePipeline';
import type { NotionOAuthConfig } from '../notion';
import { notionOAuthConfig } from '../notion';
import { storageKeys, writeLocalStorageValue, type NotionAuthState } from '../shared/storage';

const storage = new Map<string, unknown>();
const startedAt = '2026-05-18T20:20:00.000Z';
const now = new Date('2026-05-18T20:20:02.000Z');

const testConfig: NotionOAuthConfig = {
  ...notionOAuthConfig,
  clientId: 'notion-client-id',
  clientSecret: 'notion-client-secret',
  tokenEndpoint: 'https://api.notion.test/v1/oauth/token'
};

const authState: NotionAuthState = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenType: 'bearer',
  expiresAt: '2026-05-18T21:00:00.000Z'
};

function stubChrome(permissionGranted = true): void {
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async () => permissionGranted)
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
          if (typeof keys === 'string') {
            return { [keys]: storage.get(keys) };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage.get(key)]));
          }
          if (keys && typeof keys === 'object') {
            return Object.fromEntries(Object.entries(keys).map(([key, defaultValue]) => [key, storage.has(key) ? storage.get(key) : defaultValue]));
          }
          return Object.fromEntries(storage.entries());
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value);
          }
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            storage.delete(key);
          }
        })
      }
    }
  });
}

async function seedConfiguredState(): Promise<void> {
  await writeLocalStorageValue(storageKeys.confluenceBaseUrl, 'https://wiki.example.com/confluence');
  await writeLocalStorageValue(storageKeys.notionDefaultTarget, { type: 'page', id: 'target-page-1', displayName: 'Team Home' });
  await writeLocalStorageValue(storageKeys.notionAuthState, authState);
}

function makeContext() {
  const startMs = Date.parse(startedAt);
  vi.spyOn(Date, 'now').mockReturnValue(startMs + 2_000);

  return {
    taskId: 'task-1',
    startedAt,
    deadlineMs: Date.parse(startedAt) + 300_000,
    updateStatus: vi.fn(async (status) => ({
      taskId: 'task-1',
      status,
      progress: { stage: status },
      warnings: [],
      startedAt,
      updatedAt: startedAt
    }))
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

beforeEach(() => {
  storage.clear();
  stubChrome();
});

describe('Confluence to Notion save pipeline', () => {
  it('runs all save stages and returns a terminal success summary with local warnings', async () => {
    await seedConfiguredState();
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          title: 'Runbook',
          body: {
            storage: {
              value:
                '<p>Hello <strong>team</strong></p><table><tr><td rowspan="2">Merged</td></tr></table><ac:image><ri:url ri:value="https://cdn.example.com/image.png" /></ac:image>'
            }
          },
          metadata: { labels: { results: [{ name: 'ops' }] } },
          version: { number: 4, when: '2026-05-17T10:00:00.000Z' },
          space: { key: 'ENG', name: 'Engineering' },
          children: { attachment: { results: [] } }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'notion-page-1', url: 'https://notion.so/notion-page-1' }))
      .mockResolvedValueOnce(jsonResponse({ object: 'list' }));
    const context = makeContext();

    const result = await createSaveConfluencePageOperation({
      pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123',
      fetcher,
      notionConfig: testConfig,
      now: () => now
    })(context);

    expect(context.updateStatus).toHaveBeenCalledWith('fetching', expect.any(String));
    expect(context.updateStatus).toHaveBeenCalledWith('parsing', expect.any(String));
    expect(context.updateStatus).toHaveBeenCalledWith('converting', expect.any(String));
    expect(context.updateStatus).toHaveBeenCalledWith('uploading_assets', expect.any(String));
    expect(context.updateStatus).toHaveBeenCalledWith('writing', expect.any(String));
    expect(result).toMatchObject({
      status: 'succeeded',
      sourceTitle: 'Runbook',
      sourceUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123',
      target: { type: 'page', id: 'target-page-1' },
      result: {
        notionPageId: 'notion-page-1',
        notionPageUrl: 'https://notion.so/notion-page-1',
        blockCount: 4,
        assetCount: 1,
        warningCount: 2,
        elapsedMs: 2000
      }
    });
    expect(result.warnings?.map((warning) => warning.type)).toEqual(['complex-table-flattened', 'asset-cross-origin']);
  });

  it('fails early when required configuration is missing', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    await writeLocalStorageValue(storageKeys.notionDefaultTarget, { type: 'page', id: 'target-page-1', displayName: 'Team Home' });

    const result = await createSaveConfluencePageOperation({
      pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123',
      fetcher: vi.fn(),
      notionConfig: testConfig,
      now: () => now
    })(makeContext());

    expect(result).toEqual({
      status: 'failed',
      failure: {
        code: 'confluence-base-url-missing',
        message: 'Configure a Confluence base URL in Options before saving.'
      },
      warnings: []
    });
  });

  it('fails whole-document parse errors before conversion or Notion writes', async () => {
    await seedConfiguredState();
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          title: 'Broken XML',
          body: { storage: { value: '<p>Unclosed' } },
          metadata: { labels: { results: [] } },
          children: { attachment: { results: [] } }
        })
      );

    const result = await createSaveConfluencePageOperation({
      pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123',
      fetcher,
      notionConfig: testConfig,
      now: () => now
    })(makeContext());

    expect(result).toMatchObject({
      status: 'failed',
      sourceTitle: 'Broken XML',
      failure: { code: 'confluence-storage-parse-failed' },
      result: { blockCount: 0, assetCount: 0, warningCount: 0, elapsedMs: 2000 }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps partial Notion page URL in the failure summary when append fails after page creation', async () => {
    await seedConfiguredState();
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          title: 'Partial Write',
          body: { storage: { value: '<p>Body</p>' } },
          metadata: { labels: { results: [] } },
          children: { attachment: { results: [] } }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'partial-page-1', url: 'https://notion.so/partial-page-1' }))
      .mockResolvedValue(new Response(JSON.stringify({ object: 'error' }), { status: 500 }));

    const result = await createSaveConfluencePageOperation({
      pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123',
      fetcher,
      notionConfig: testConfig,
      now: () => now
    })(makeContext());

    expect(result).toMatchObject({
      status: 'failed',
      sourceTitle: 'Partial Write',
      failure: { code: 'notion-write-failed' },
      result: {
        notionPageId: 'partial-page-1',
        notionPageUrl: 'https://notion.so/partial-page-1',
        blockCount: 1,
        assetCount: 0,
        warningCount: 0,
        elapsedMs: 2000
      }
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://wiki.example.com/confluence/rest/api/content/123?expand=body.storage%2Cmetadata.labels%2Cversion%2Cspace%2Cchildren.attachment',
      'https://api.notion.com/v1/pages',
      'https://api.notion.com/v1/blocks/partial-page-1/children',
      'https://api.notion.com/v1/blocks/partial-page-1/children',
      'https://api.notion.com/v1/blocks/partial-page-1/children'
    ]);
  });

  it('creates a new Notion page on repeated saves instead of reusing old pages', async () => {
    await seedConfiguredState();
    const confluencePayload = {
      title: 'Repeat Save',
      body: { storage: { value: '<p>Body</p>' } },
      metadata: { labels: { results: [] } },
      children: { attachment: { results: [] } }
    };
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(confluencePayload))
      .mockResolvedValueOnce(jsonResponse({ id: 'notion-page-1' }))
      .mockResolvedValueOnce(jsonResponse({ object: 'list' }))
      .mockResolvedValueOnce(jsonResponse(confluencePayload))
      .mockResolvedValueOnce(jsonResponse({ id: 'notion-page-2' }))
      .mockResolvedValueOnce(jsonResponse({ object: 'list' }));
    const operation = createSaveConfluencePageOperation({
      pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123',
      fetcher,
      notionConfig: testConfig,
      now: () => now
    });

    await expect(operation(makeContext())).resolves.toMatchObject({ status: 'succeeded', result: { notionPageId: 'notion-page-1' } });
    await expect(operation(makeContext())).resolves.toMatchObject({ status: 'succeeded', result: { notionPageId: 'notion-page-2' } });

    expect(fetcher.mock.calls.filter((call) => call[0] === 'https://api.notion.com/v1/pages')).toHaveLength(2);
  });
});
