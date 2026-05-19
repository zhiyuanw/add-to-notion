import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NotionTargetError,
  notionApiConfig,
  saveNotionTargetSelection,
  searchNotionTargets,
  type NotionApiConfig
} from '../notion';
import { storageKeys, writeLocalStorageValue, type NotionAuthState } from '../shared/storage';

const storage = new Map<string, unknown>();

const testConfig: NotionApiConfig = {
  ...notionApiConfig,
  notionVersion: '2022-06-28'
};

const authState: NotionAuthState = {
  accessToken: 'access-token',
  tokenType: 'bearer',
};

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

describe('Notion target discovery and selection', () => {
  it('lists accessible Notion page and database targets from search results', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);

    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              object: 'page',
              id: 'page-1',
              properties: {
                title: {
                  type: 'title',
                  title: [{ plain_text: 'Team Home' }]
                }
              }
            },
            {
              object: 'database',
              id: 'database-1',
              title: [{ plain_text: 'Engineering Docs' }]
            },
            {
              object: 'user',
              id: 'user-1',
              name: 'Ignored User'
            }
          ]
        }),
        { status: 200 }
      )
    );

    await expect(
      searchNotionTargets('eng', {
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).resolves.toEqual({
      targets: [
        { type: 'page', id: 'page-1', displayName: 'Team Home' },
        { type: 'database', id: 'database-1', displayName: 'Engineering Docs' }
      ]
    });

    expect(fetcher).toHaveBeenCalledWith('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ query: 'eng', page_size: 100 }),
      signal: expect.any(AbortSignal)
    });
  });

  it('returns integration access guidance when target search is empty', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);

    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));

    await expect(
      searchNotionTargets('', {
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).resolves.toEqual({
      targets: [],
      guidance: 'No accessible Notion pages or databases found. Grant the integration access to a page or database in Notion, then search again.'
    });
  });

  it('stores a selected page target as the default Notion target', async () => {
    await saveNotionTargetSelection({ type: 'page', id: 'page-1', displayName: 'Team Home' });

    expect(storage.get(storageKeys.notionDefaultTarget)).toEqual({
      type: 'page',
      id: 'page-1',
      displayName: 'Team Home'
    });
  });

  it('reads database metadata and stores a selected database target with its title property', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);

    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: 'database',
          id: 'database-1',
          title: [{ plain_text: 'Engineering Docs' }],
          properties: {
            Name: { id: 'title', type: 'title' },
            Status: { id: 'status', type: 'select' }
          }
        }),
        { status: 200 }
      )
    );

    await expect(
      saveNotionTargetSelection(
        { type: 'database', id: 'database-1' },
        {
          config: testConfig,
          fetcher,
          now: () => new Date('2026-05-18T18:00:00.000Z')
        }
      )
    ).resolves.toEqual({
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      titlePropertyName: 'Name',
      titlePropertyId: 'title'
    });

    expect(fetcher).toHaveBeenCalledWith('https://api.notion.com/v1/databases/database-1', {
      method: 'GET',
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal)
    });
    expect(storage.get(storageKeys.notionDefaultTarget)).toEqual({
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      titlePropertyName: 'Name',
      titlePropertyId: 'title'
    });
  });

  it('rejects invalid target selection types', async () => {
    await expect(saveNotionTargetSelection({ type: 'workspace', id: 'workspace-1' } as never)).rejects.toThrow(NotionTargetError);
    await expect(saveNotionTargetSelection({ type: 'workspace', id: 'workspace-1' } as never)).rejects.toThrow('invalid-target-type');
  });
});
