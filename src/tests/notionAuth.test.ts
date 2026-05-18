import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getNotionAuthorizationStatus,
  getValidNotionAuthState,
  isNotionAccessTokenExpired,
  logoutNotion,
  notionApiFetch,
  notionOAuthConfig,
  refreshNotionAccessToken,
  type NotionOAuthConfig
} from '../notion';
import { storageKeys, writeLocalStorageValue, type NotionAuthState } from '../shared/storage';

const storage = new Map<string, unknown>();

const testConfig: NotionOAuthConfig = {
  ...notionOAuthConfig,
  clientId: 'notion-client-id',
  clientSecret: 'notion-client-secret',
  tokenEndpoint: 'https://api.notion.test/v1/oauth/token'
};

const expiredAuthState: NotionAuthState = {
  accessToken: 'old-access-token',
  refreshToken: 'refresh-token',
  tokenType: 'bearer',
  expiresAt: '2026-05-18T17:59:59.000Z'
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

describe('Notion token refresh and API authorization', () => {
  it('detects expired Notion access tokens', () => {
    expect(isNotionAccessTokenExpired({ expiresAt: '2026-05-18T18:00:00.000Z' }, new Date('2026-05-18T18:00:00.000Z'))).toBe(
      true
    );
    expect(isNotionAccessTokenExpired({ expiresAt: '2026-05-18T18:00:01.000Z' }, new Date('2026-05-18T18:00:00.000Z'))).toBe(
      false
    );
    expect(isNotionAccessTokenExpired({ expiresAt: 'not-a-date' }, new Date('2026-05-18T18:00:00.000Z'))).toBe(true);
  });

  it('refreshes an expired access token and stores the replacement in chrome.storage.local', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'bearer',
          expires_in: 3600
        }),
        { status: 200 }
      )
    );

    await expect(
      refreshNotionAccessToken(expiredAuthState, {
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).resolves.toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      tokenType: 'bearer',
      expiresAt: '2026-05-18T19:00:00.000Z'
    });

    expect(fetcher).toHaveBeenCalledWith(testConfig.tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Notion-Version': testConfig.notionVersion,
        Authorization: `Basic ${btoa('notion-client-id:notion-client-secret')}`
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token'
      })
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [storageKeys.notionAuthState]: {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'bearer',
        expiresAt: '2026-05-18T19:00:00.000Z'
      }
    });
  });

  it('reuses the previous refresh token when Notion does not rotate it', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'new-access-token',
          token_type: 'bearer',
          expires_in: 600
        }),
        { status: 200 }
      )
    );

    await expect(
      refreshNotionAccessToken(expiredAuthState, {
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).resolves.toMatchObject({ refreshToken: 'refresh-token' });
  });

  it('returns an unexpired token without refreshing it', async () => {
    const authState: NotionAuthState = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'bearer',
      expiresAt: '2026-05-18T19:00:00.000Z'
    };
    const fetcher = vi.fn();

    await writeLocalStorageValue(storageKeys.notionAuthState, authState);

    await expect(
      getValidNotionAuthState({
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).resolves.toEqual(authState);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refreshes expired tokens before Notion API calls and does not expose tokens through messages', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, expiredAuthState);

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'new-access-token',
            token_type: 'bearer',
            expires_in: 3600
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await notionApiFetch('https://api.notion.test/v1/pages', { method: 'GET' }, {
      config: testConfig,
      fetcher,
      now: () => new Date('2026-05-18T18:00:00.000Z')
    });

    const apiCall = fetcher.mock.calls[1];
    expect(apiCall[0]).toBe('https://api.notion.test/v1/pages');
    expect((apiCall[1].headers as Headers).get('Authorization')).toBe('Bearer new-access-token');
    expect((apiCall[1].headers as Headers).get('Notion-Version')).toBe(testConfig.notionVersion);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [storageKeys.notionAuthState]: {
        accessToken: 'new-access-token',
        refreshToken: 'refresh-token',
        tokenType: 'bearer',
        expiresAt: '2026-05-18T19:00:00.000Z'
      }
    });
  });

  it('clears Notion state on refresh failure while preserving Confluence configuration', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, expiredAuthState);
    await writeLocalStorageValue(storageKeys.notionWorkspace, { workspaceId: 'workspace-1' });
    await writeLocalStorageValue(storageKeys.notionDefaultTarget, {
      type: 'page',
      id: 'page-1',
      displayName: 'Team Home'
    });
    await writeLocalStorageValue(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');
    await writeLocalStorageValue(storageKeys.lastTerminalClipTaskSummary, {
      taskId: 'task-1',
      status: 'succeeded',
      warningCount: 0,
      completedAt: '2026-05-18T17:00:00.000Z'
    });

    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 401 }));

    await expect(
      getValidNotionAuthState({
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).rejects.toThrow('token-refresh-failed:401');

    expect(storage.get(storageKeys.notionAuthState)).toBeUndefined();
    expect(storage.get(storageKeys.notionWorkspace)).toBeUndefined();
    expect(storage.get(storageKeys.notionDefaultTarget)).toBeUndefined();
    expect(storage.get(storageKeys.lastTerminalClipTaskSummary)).toBeUndefined();
    expect(storage.get(storageKeys.confluenceBaseUrl)).toBe('https://confluence.example.com/wiki');
  });

  it('clears the same Notion state on logout while keeping Confluence configuration', async () => {
    await writeLocalStorageValue(storageKeys.notionAuthState, expiredAuthState);
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
    await writeLocalStorageValue(storageKeys.notionAuthState, expiredAuthState);
    await writeLocalStorageValue(storageKeys.notionWorkspace, {
      workspaceId: 'workspace-1',
      workspaceName: 'Engineering'
    });

    await expect(getNotionAuthorizationStatus({ now: () => new Date('2026-05-18T18:00:00.000Z') })).resolves.toEqual({
      connected: true,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Engineering'
      },
      requiresReauthorization: false
    });
  });
});
