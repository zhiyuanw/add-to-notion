import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotionPage, NotionWriterError, notionOAuthConfig, type NotionOAuthConfig } from '../notion';
import type { NotionBlock } from '../converter';
import type { NotionTarget } from '../shared/domain';
import { storageKeys, writeLocalStorageValue, type NotionAuthState } from '../shared/storage';

const storage = new Map<string, unknown>();

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
  expiresAt: '2026-05-18T19:00:00.000Z'
};

const contentBlocks: NotionBlock[] = [
  {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        {
          type: 'text',
          text: { content: 'Body' },
          annotations: {}
        }
      ]
    }
  }
];

beforeEach(() => {
  storage.clear();

  vi.stubGlobal('chrome', {
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
            return Object.fromEntries(
              Object.entries(keys).map(([key, defaultValue]) => [key, storage.has(key) ? storage.get(key) : defaultValue])
            );
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
});

describe('Notion page writer', () => {
  it('creates a new Notion page in a database target with the saved title property', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const target: NotionTarget = {
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      titlePropertyName: 'Name',
      titlePropertyId: 'title'
    };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'page-1', url: 'https://notion.so/page-1' }), {
        status: 200
      })
    );

    await expect(
      createNotionPage(
        {
          target,
          title: 'Confluence Title',
          blocks: contentBlocks
        },
        {
          config: testConfig,
          fetcher,
          now: () => new Date('2026-05-18T18:00:00.000Z')
        }
      )
    ).resolves.toEqual({ pageId: 'page-1', pageUrl: 'https://notion.so/page-1' });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({
        parent: { database_id: 'database-1' },
        properties: {
          Name: {
            title: [
              {
                type: 'text',
                text: { content: 'Confluence Title' }
              }
            ]
          }
        },
        children: contentBlocks
      }),
      signal: expect.any(AbortSignal)
    });
  });

  it('creates a new child page under a page target', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: 'child-page-1' }), { status: 200 }));

    await expect(
      createNotionPage(
        {
          target: { type: 'page', id: 'page-parent-1', displayName: 'Team Home' },
          title: 'Confluence Title',
          blocks: []
        },
        {
          config: testConfig,
          fetcher,
          now: () => new Date('2026-05-18T18:00:00.000Z')
        }
      )
    ).resolves.toEqual({ pageId: 'child-page-1' });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      parent: { page_id: 'page-parent-1' },
      properties: {
        title: [
          {
            type: 'text',
            text: { content: 'Confluence Title' }
          }
        ]
      },
      children: []
    });
  });

  it('creates a new page on every repeated save without duplicate lookup or update calls', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-2' }), { status: 200 }));
    const target: NotionTarget = { type: 'page', id: 'page-parent-1', displayName: 'Team Home' };

    await expect(
      createNotionPage({ target, title: 'Confluence Title', blocks: [] }, { config: testConfig, fetcher, now: () => new Date('2026-05-18T18:00:00.000Z') })
    ).resolves.toEqual({ pageId: 'page-1' });
    await expect(
      createNotionPage({ target, title: 'Confluence Title', blocks: [] }, { config: testConfig, fetcher, now: () => new Date('2026-05-18T18:00:00.000Z') })
    ).resolves.toEqual({ pageId: 'page-2' });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://api.notion.com/v1/pages', 'https://api.notion.com/v1/pages']);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'POST']);
  });

  it('returns target-invalid guidance for a stale database title property or target permission failure', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const target: NotionTarget = {
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      titlePropertyName: 'Old Name'
    };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ object: 'error', code: 'validation_error' }), {
        status: 400
      })
    );

    await expect(
      createNotionPage(
        { target, title: 'Confluence Title', blocks: [] },
        { config: testConfig, fetcher, now: () => new Date('2026-05-18T18:00:00.000Z') }
      )
    ).rejects.toMatchObject({
      name: 'NotionWriterError',
      message: 'target-invalid',
      guidance: 'The selected Notion target is unavailable or its title property changed. Re-select the target in Options.'
    });
    await expect(
      createNotionPage(
        { target, title: 'Confluence Title', blocks: [] },
        {
          config: testConfig,
          fetcher: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ object: 'error' }), { status: 403 })),
          now: () => new Date('2026-05-18T18:00:00.000Z')
        }
      )
    ).rejects.toThrow(NotionWriterError);
  });
});
