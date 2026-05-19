// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mountOptionsPage } from '../options/index';
import {
  NOTION_OAUTH_CLIENT_ID_CONFIGURATION_MESSAGE,
  notionOAuthConfig,
  type NotionOAuthConfig
} from '../notion';
import { storageKeys, type NotionAuthState, type NotionWorkspaceInfo } from '../shared/storage';

const storage = new Map<string, unknown>();
let requestPermission: ReturnType<typeof vi.fn<[], Promise<boolean>>>;
let containsPermission: ReturnType<typeof vi.fn<[], Promise<boolean>>>;
let launchWebAuthFlow: ReturnType<typeof vi.fn<[], Promise<string>>>;
let fetchMock: ReturnType<typeof vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>>;

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

const workspace: NotionWorkspaceInfo = {
  workspaceId: 'workspace-1',
  workspaceName: 'Engineering Workspace',
  botId: 'bot-1'
};

const notionOptions = {
  config: testConfig,
  createState: () => 'test-state',
  now: () => new Date('2026-05-18T18:00:00.000Z')
};

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  storage.clear();
  requestPermission = vi.fn(async (): Promise<boolean> => true);
  containsPermission = vi.fn(async (): Promise<boolean> => true);
  launchWebAuthFlow = vi.fn(async (): Promise<string> => 'https://extension.test/notion-oauth?code=oauth-code&state=test-state');
  fetchMock = vi.fn();

  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    identity: {
      getRedirectURL: vi.fn((path: string) => `https://extension.test/${path}`),
      launchWebAuthFlow
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
  it('shows authorization status and connects Notion through OAuth', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          workspace_id: 'workspace-1',
          workspace_name: 'Engineering Workspace',
          bot_id: 'bot-1'
        }),
        { status: 200 }
      )
    );

    await mountOptionsPage(getApp(), { notion: notionOptions });

    expect(getText('#notion-authorization-status')).toBe('Not connected');

    getButton('#connect-notion').click();
    await flushPromises();

    expect(getText('#notion-authorization-status')).toBe('Connected to Engineering Workspace');
    expect(getText('#notion-settings-status')).toBe('Notion connected.');
    expect(storage.get(storageKeys.notionAuthState)).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      tokenType: 'bearer',
      expiresAt: '2026-05-18T19:00:00.000Z'
    });
    expect(storage.get(storageKeys.notionWorkspace)).toEqual(workspace);
    expect(launchWebAuthFlow).toHaveBeenCalledOnce();
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
              object: 'database',
              id: 'database-1',
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
                object: 'database',
                id: 'database-1',
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
            object: 'database',
            id: 'database-1',
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
    getButton('[data-target-id="database-1"]').click();
    await flushPromises();

    expect(storage.get(storageKeys.notionDefaultTarget)).toEqual({
      type: 'database',
      id: 'database-1',
      displayName: 'Engineering Docs',
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
      'No accessible Notion pages or databases found. Grant the integration access to a page or database in Notion, then search again.'
    );
  });

  it('shows clear setup guidance when the OAuth client ID is missing from the build', async () => {
    await mountOptionsPage(getApp(), { notion: { ...notionOptions, config: { ...testConfig, clientId: '' } } });

    getButton('#connect-notion').click();
    await flushPromises();

    expect(getText('#notion-settings-status')).toBe(NOTION_OAUTH_CLIENT_ID_CONFIGURATION_MESSAGE);
    expect(getText('#notion-authorization-status')).toBe('Not connected');
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
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
