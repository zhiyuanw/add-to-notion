import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getNotionAuthorizationStatus,
  getValidNotionAuthState,
  logoutNotion,
  notionApiConfig,
  notionApiFetch,
  saveNotionPersonalAccessToken,
  validateNotionPersonalAccessToken,
  type NotionApiConfig
} from '../notion';
import { storageKeys, writeLocalStorageValue, type NotionAuthState } from '../shared/storage';

const storage = new Map<string, unknown>();

const testConfig: NotionApiConfig = {
  ...notionApiConfig,
  notionVersion: '2022-06-28'
};

const authState: NotionAuthState = {
  accessToken: 'secret_ntn_token',
  tokenType: 'bearer'
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

describe('Notion personal access token authorization', () => {
  it('validates a Notion integration token through users/me', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ object: 'user', id: 'bot-1', name: 'Docs Bot' }), { status: 200 }));

    await expect(validateNotionPersonalAccessToken(' secret_ntn_token ', { config: testConfig, fetcher })).resolves.toEqual({
      workspaceId: 'bot-1',
      workspaceName: 'Docs Bot',
      botId: 'bot-1'
    });

    expect(fetcher).toHaveBeenCalledWith('https://api.notion.com/v1/users/me', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer secret_ntn_token',
        'Notion-Version': testConfig.notionVersion,
        Accept: 'application/json'
      },
      signal: expect.any(AbortSignal)
    });
  });

  it('saves a token only after validation succeeds', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ object: 'user', id: 'bot-1', name: 'Docs Bot' }), { status: 200 }));

    await saveNotionPersonalAccessToken('secret_ntn_token', { config: testConfig, fetcher });

    expect(storage.get(storageKeys.notionAuthState)).toEqual(authState);
    expect(storage.get(storageKeys.notionWorkspace)).toEqual({
      workspaceId: 'bot-1',
      workspaceName: 'Docs Bot',
      botId: 'bot-1'
    });
  });

  it('rejects empty or invalid tokens without storing them', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));

    await expect(saveNotionPersonalAccessToken('   ', { config: testConfig, fetcher })).rejects.toThrow('notion-token-missing');
    expect(fetcher).not.toHaveBeenCalled();

    await expect(saveNotionPersonalAccessToken('bad-token', { config: testConfig, fetcher })).rejects.toThrow('notion-token-validation-failed:401');
    expect(storage.get(storageKeys.notionAuthState)).toBeUndefined();
    expect(storage.get(storageKeys.notionWorkspace)).toBeUndefined();
  });

  it('returns the stored token and injects Notion API headers', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(getValidNotionAuthState()).resolves.toEqual(authState);
    await notionApiFetch('https://api.notion.test/v1/pages', { method: 'GET' }, { config: testConfig, fetcher });

    const apiCall = fetcher.mock.calls[0];
    expect(apiCall?.[0]).toBe('https://api.notion.test/v1/pages');
    expect((apiCall?.[1]?.headers as Headers).get('Authorization')).toBe('Bearer secret_ntn_token');
    expect((apiCall?.[1]?.headers as Headers).get('Notion-Version')).toBe(testConfig.notionVersion);
    expect((apiCall?.[1]?.headers as Headers).get('Content-Type')).toBeNull();
  });

  it('sends JSON content type for Notion API requests with bodies', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await notionApiFetch('https://api.notion.test/v1/pages', { method: 'POST', body: JSON.stringify({ parent: { database_id: 'database-1' } }) }, { config: testConfig, fetcher });

    const headers = fetcher.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('preserves browser-generated multipart content type for FormData Notion requests', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const fetcher = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const formData = new FormData();
    formData.append('file', new Blob(['content']), 'asset.png');

    await notionApiFetch('https://api.notion.test/v1/file_uploads/upload-1/send', { method: 'POST', body: formData }, { config: testConfig, fetcher });

    const headers = fetcher.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer secret_ntn_token');
    expect(headers.get('Content-Type')).toBeNull();
  });

  it('clears Notion state on logout while keeping Confluence configuration', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    await writeLocalStorageValue(storageKeys.notionWorkspace, { workspaceId: 'workspace-1' });
    await writeLocalStorageValue(storageKeys.notionDefaultTarget, {
      type: 'database',
      id: 'database-1',
      displayName: 'Docs',
      titlePropertyName: 'Name'
    });
    await writeLocalStorageValue(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');
    await writeLocalStorageValue(storageKeys.lastTerminalClipTaskSummary, {
      taskId: 'task-1',
      status: 'failed',
      warningCount: 0,
      completedAt: '2026-05-18T17:00:00.000Z',
      failureReason: 'failed'
    });

    await logoutNotion();

    expect(storage.get(storageKeys.notionAuthState)).toBeUndefined();
    expect(storage.get(storageKeys.notionWorkspace)).toBeUndefined();
    expect(storage.get(storageKeys.notionDefaultTarget)).toBeUndefined();
    expect(storage.get(storageKeys.lastTerminalClipTaskSummary)).toBeUndefined();
    expect(storage.get(storageKeys.confluenceBaseUrl)).toBe('https://confluence.example.com/wiki');
  });

  it('reports authorization status without returning raw tokens', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    await writeLocalStorageValue(storageKeys.notionWorkspace, {
      workspaceId: 'workspace-1',
      workspaceName: 'Engineering'
    });

    await expect(getNotionAuthorizationStatus()).resolves.toEqual({
      connected: true,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Engineering'
      }
    });
  });
});
