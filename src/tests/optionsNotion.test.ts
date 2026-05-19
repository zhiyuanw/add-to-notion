// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mountOptionsPage } from '../options/index';
import { notionApiConfig, type NotionApiConfig } from '../notion';
import { storageKeys, type NotionAuthState, type NotionWorkspaceInfo } from '../shared/storage';

const storage = new Map<string, unknown>();
let requestPermission: ReturnType<typeof vi.fn<[], Promise<boolean>>>;
let containsPermission: ReturnType<typeof vi.fn<[], Promise<boolean>>>;
let fetchMock: ReturnType<typeof vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>>;

const testConfig: NotionApiConfig = {
  ...notionApiConfig,
  notionVersion: '2022-06-28'
};

const authState: NotionAuthState = {
  accessToken: 'secret_ntn_token',
  tokenType: 'bearer'
};

const workspace: NotionWorkspaceInfo = {
  workspaceId: 'workspace-1',
  workspaceName: 'Engineering Workspace',
  botId: 'bot-1'
};

const notionOptions = {
  config: testConfig
};

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  storage.clear();
  requestPermission = vi.fn(async (): Promise<boolean> => true);
  containsPermission = vi.fn(async (): Promise<boolean> => true);
  fetchMock = vi.fn();

  vi.stubGlobal('fetch', fetchMock);
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
    },
    permissions: {
      request: requestPermission,
      contains: containsPermission
    }
  });
});

describe('Notion options UI', () => {
  it('saves a Notion integration token after validation', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ object: 'user', id: 'bot-1', name: 'Engineering Workspace' }), { status: 200 }));

    await mountOptionsPage(getApp(), { notion: notionOptions });

    expect(getText('#notion-authorization-status')).toBe('Not connected');

    getInput('#notion-token').value = ' secret_ntn_token ';
    getButton('#save-notion-token').click();
    await flushPromises();

    expect(getText('#notion-authorization-status')).toBe('Connected to Engineering Workspace');
    expect(getText('#notion-settings-status')).toBe('Notion token saved.');
    expect(getInput('#notion-token').value).toBe('');
    expect(storage.get(storageKeys.notionAuthState)).toEqual(authState);
    expect(storage.get(storageKeys.notionWorkspace)).toEqual({
      workspaceId: 'bot-1',
      workspaceName: 'Engineering Workspace',
      botId: 'bot-1'
    });
  });

  it('shows token setup guidance without storing invalid tokens', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));

    await mountOptionsPage(getApp(), { notion: notionOptions });

    getInput('#notion-token').value = 'bad-token';
    getButton('#save-notion-token').click();
    await flushPromises();

    expect(getText('#notion-settings-status')).toBe('Notion rejected this token. Check the token value and personal access token API access.');
    expect(getText('#notion-authorization-status')).toBe('Not connected');
    expect(storage.has(storageKeys.notionAuthState)).toBe(false);
    expect(storage.has(storageKeys.notionWorkspace)).toBe(false);
  });

  it('lists searchable page and database targets and saves a selected page target', async () => {
    storage.set(storageKeys.notionAuthState, authState);
    storage.set(storageKeys.notionWorkspace, workspace);
    fetchMock.mockResolvedValueOnce(
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
              object: 'data_source',
              id: 'data-source-1',
              title: [{ plain_text: 'Engineering Docs' }]
            }
          ]
        }),
        { status: 200 }
      )
    );

    await mountOptionsPage(getApp(), { notion: notionOptions });

    getInput('#notion-target-search').value = 'eng';
    getButton('#search-notion-targets').click();
    await flushPromises();

    expect(getText('#notion-target-results')).toContain('Team Home');
    expect(getText('#notion-target-results')).toContain('Engineering Docs');

    getButton('[data-target-id="page-1"]').click();
    await flushPromises();

    expect(storage.get(storageKeys.notionDefaultTarget)).toEqual({ type: 'page', id: 'page-1', displayName: 'Team Home' });
    expect(getText('#selected-notion-target')).toBe('Selected target: Page — Team Home');
  });

  it('saves a selected database target as the default target', async () => {
    storage.set(storageKeys.notionAuthState, authState);
    storage.set(storageKeys.notionWorkspace, workspace);
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                object: 'data_source',
                id: 'data-source-1',
                title: [{ plain_text: 'Engineering Docs' }]
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: 'data_source',
            id: 'data-source-1',
            parent: { type: 'database_id', database_id: 'database-1' },
            title: [{ plain_text: 'Engineering Docs' }],
            properties: {
              Name: { id: 'title', type: 'title' }
            }
          }),
          { status: 200 }
        )
      );

    await mountOptionsPage(getApp(), { notion: notionOptions });

    getButton('#search-notion-targets').click();
    await flushPromises();
    getButton('[data-target-id="data-source-1"]').click();
    await flushPromises();

    expect(storage.get(storageKeys.notionDefaultTarget)).toEqual({
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
      parentObject: 'data_source',
      titlePropertyName: 'Name',
      titlePropertyId: 'title'
    });
    expect(getText('#selected-notion-target')).toBe('Selected target: Database — Engineering Docs');
  });

  it('shows guidance when no Notion targets are accessible', async () => {
    storage.set(storageKeys.notionAuthState, authState);
    storage.set(storageKeys.notionWorkspace, workspace);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    await mountOptionsPage(getApp(), { notion: notionOptions });

    getButton('#search-notion-targets').click();
    await flushPromises();

    expect(getText('#notion-target-guidance')).toBe(
      'No accessible Notion pages or databases found. Check that this personal access token belongs to a user who can open the target page or database, then search again.'
    );
  });

  it('logs out Notion while keeping Confluence configuration visible', async () => {
    storage.set(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');
    storage.set(storageKeys.notionAuthState, authState);
    storage.set(storageKeys.notionWorkspace, workspace);
    storage.set(storageKeys.notionDefaultTarget, { type: 'page', id: 'page-1', displayName: 'Team Home' });
    storage.set(storageKeys.lastTerminalClipTaskSummary, {
      taskId: 'task-1',
      status: 'succeeded',
      completedAt: '2026-05-18T18:00:00.000Z',
      sourceTitle: 'Source',
      sourceUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=1',
      warningCount: 0
    });

    await mountOptionsPage(getApp(), { notion: notionOptions });

    getButton('#logout-notion').click();
    await flushPromises();

    expect(getText('#notion-authorization-status')).toBe('Not connected');
    expect(getText('#selected-notion-target')).toBe('Selected target: None');
    expect(getText('#saved-confluence-base-url')).toBe('https://confluence.example.com/wiki');
    expect(storage.has(storageKeys.notionAuthState)).toBe(false);
    expect(storage.has(storageKeys.notionWorkspace)).toBe(false);
    expect(storage.has(storageKeys.notionDefaultTarget)).toBe(false);
    expect(storage.has(storageKeys.lastTerminalClipTaskSummary)).toBe(false);
    expect(storage.get(storageKeys.confluenceBaseUrl)).toBe('https://confluence.example.com/wiki');
  });
});

function getApp(): HTMLElement {
  return getElement('#app', HTMLElement);
}

function getInput(selector: string): HTMLInputElement {
  return getElement(selector, HTMLInputElement);
}

function getButton(selector: string): HTMLButtonElement {
  return getElement(selector, HTMLButtonElement);
}

function getText(selector: string): string {
  return getElement(selector, HTMLElement).textContent ?? '';
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getElement<ElementType extends HTMLElement>(
  selector: string,
  elementType: typeof HTMLElement
): ElementType {
  const element = document.querySelector(selector);

  if (!(element instanceof elementType)) {
    throw new Error(`Missing test element: ${selector}`);
  }

  return element as ElementType;
}
