import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNotionPage, NotionWriterError, notionApiConfig, writeClippedNotionPage, type NotionApiConfig } from '../notion';
import type { NotionBlock } from '../converter';
import type { ConfluencePageData, NotionTarget } from '../shared/domain';
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

const confluencePageData: ConfluencePageData = {
  pageRef: {
    baseUrl: 'https://wiki.example.com/confluence',
    pageId: '123456',
    pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123456'
  },
  title: 'Confluence Title',
  bodyStorageXml: '<p>Body</p>',
  metadata: {
    spaceKey: 'ENG',
    spaceName: 'Engineering',
    labels: ['runbook', 'team'],
    versionNumber: 7,
    lastModified: '2026-05-17T10:00:00.000Z'
  },
  attachments: []
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

describe('Notion page writer', () => {
  it('creates a new Notion page in a database target with the saved title property', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const target: NotionTarget = {
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      parentObject: 'database',
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

  it('creates a new Notion page in a data source search target using the Notion database parent contract', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const target: NotionTarget = {
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      parentObject: 'data_source',
      titlePropertyName: 'Name',
      titlePropertyId: 'title'
    };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }));

    await createNotionPage(
      {
        target,
        title: 'Confluence Title',
        blocks: []
      },
      {
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      }
    );

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
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
      children: []
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
      new Response(JSON.stringify({ object: 'error', code: 'validation_error', message: 'body.properties.Name should be defined' }), {
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
      guidance:
        'The selected Notion target is unavailable, missing write access, or its title property changed. Re-select the target in Options and check the Notion connection capabilities. Notion: body.properties.Name should be defined'
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

  it('prepends a Confluence metadata toggle and appends content blocks after page creation', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1', url: 'https://notion.so/page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: 'list' }), { status: 200 }));

    await expect(
      writeClippedNotionPage(
        {
          target: { type: 'page', id: 'page-parent-1', displayName: 'Team Home' },
          pageData: confluencePageData,
          contentBlocks
        },
        {
          config: testConfig,
          fetcher,
          now: () => new Date('2026-05-18T20:00:00.000Z')
        }
      )
    ).resolves.toEqual({ pageId: 'page-1', pageUrl: 'https://notion.so/page-1', appendedBlockCount: 2 });

    const createBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(createBody.children).toEqual([]);
    const appendBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.notion.com/v1/blocks/page-1/children');
    expect(appendBody.children).toHaveLength(2);
    expect(appendBody.children[0]).toMatchObject({
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [{ type: 'text', text: { content: 'Confluence metadata' }, annotations: {} }],
        children: expect.any(Array)
      }
    });
    expect(appendBody.children[0].toggle.children.map((block: NotionBlock) => block.type)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph'
    ]);
    expect(appendBody.children[0].toggle.children.map((block: { paragraph: { rich_text: Array<{ text: { content: string } }> } }) => block.paragraph.rich_text[0]?.text.content)).toEqual([
      'Original URL: https://wiki.example.com/confluence/pages/viewpage.action?pageId=123456',
      'Confluence Base URL: https://wiki.example.com/confluence',
      'Confluence Page ID: 123456',
      'Confluence Space: Engineering (ENG)',
      'Labels: runbook, team',
      'Last Modified: 2026-05-17T10:00:00.000Z',
      'Last Clipped At: 2026-05-18T20:00:00.000Z'
    ]);
    expect(appendBody.children[1]).toEqual(contentBlocks[0]);
  });

  it('does not add metadata database properties when writing a database target', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await writeClippedNotionPage(
      {
        target: {
          type: 'database',
          id: 'database-1',
          displayName: 'Engineering Docs',
          titlePropertyName: 'Name',
          titlePropertyId: 'title'
        },
        pageData: confluencePageData,
        contentBlocks: []
      },
      { config: testConfig, fetcher, now: () => new Date('2026-05-18T20:00:00.000Z') }
    );

    const createBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(createBody.properties).toEqual({
      Name: {
        title: [
          {
            type: 'text',
            text: { content: 'Confluence Title' }
          }
        ]
      }
    });
  });

  it('appends blocks in batches of at most 100', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const manyBlocks = Array.from({ length: 205 }, (_, index): NotionBlock => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `Block ${index}` },
            annotations: {}
          }
        ]
      }
    }));
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1' }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await expect(
      writeClippedNotionPage(
        {
          target: { type: 'page', id: 'page-parent-1', displayName: 'Team Home' },
          pageData: confluencePageData,
          contentBlocks: manyBlocks
        },
        { config: testConfig, fetcher, now: () => new Date('2026-05-18T20:00:00.000Z') }
      )
    ).resolves.toMatchObject({ appendedBlockCount: 206 });

    const batchSizes = fetcher.mock.calls.slice(1).map((call) => JSON.parse(String(call[1]?.body)).children.length);
    expect(batchSizes).toEqual([100, 100, 6]);
  });

  it('keeps the created page and returns its URL when a later append batch fails', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const manyBlocks = Array.from({ length: 101 }, (_, index): NotionBlock => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: { content: `Block ${index}` },
            annotations: {}
          }
        ]
      }
    }));
    const fetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'page-1', url: 'https://notion.so/page-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ object: 'error' }), { status: 500 }));

    await expect(
      writeClippedNotionPage(
        {
          target: { type: 'page', id: 'page-parent-1', displayName: 'Team Home' },
          pageData: confluencePageData,
          contentBlocks: manyBlocks
        },
        { config: testConfig, fetcher, now: () => new Date('2026-05-18T20:00:00.000Z') }
      )
    ).rejects.toMatchObject({
      name: 'NotionWriterError',
      message: 'notion-block-append-failed:500',
      partialWrite: true,
      guidance: 'A Notion page was created before the save failed. Open the partial page, inspect it, and delete it manually if needed.',
      pageId: 'page-1',
      pageUrl: 'https://notion.so/page-1'
    });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://api.notion.com/v1/pages',
      'https://api.notion.com/v1/blocks/page-1/children',
      'https://api.notion.com/v1/blocks/page-1/children',
      'https://api.notion.com/v1/blocks/page-1/children',
      'https://api.notion.com/v1/blocks/page-1/children'
    ]);
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH', 'PATCH']);
  });
});
