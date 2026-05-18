import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildNotionAuthorizationUrl,
  exchangeNotionAuthorizationCode,
  getNotionOAuthRedirectUri,
  notionOAuthConfig,
  parseNotionOAuthCallback,
  startNotionOAuth,
  type NotionOAuthConfig
} from '../notion';
import { storageKeys, type NotionAuthState, type NotionWorkspaceInfo } from '../shared/storage';

const storage = new Map<string, unknown>();

const testConfig: NotionOAuthConfig = {
  ...notionOAuthConfig,
  clientId: 'notion-client-id',
  clientSecret: 'notion-client-secret',
  redirectPath: 'notion-test-callback',
  redirectUri: 'https://extension.example.test/notion-callback'
};

beforeEach(() => {
  storage.clear();

  vi.stubGlobal('chrome', {
    identity: {
      getRedirectURL: vi.fn((path?: string) => `https://extension.example.test/${path ?? ''}`),
      launchWebAuthFlow: vi.fn()
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value);
          }
        }),
        remove: vi.fn(async () => undefined)
      }
    }
  });
});

describe('Notion OAuth configuration', () => {
  it('records the selected Notion API version and requested minimum scopes', () => {
    expect(notionOAuthConfig.notionVersion).toBe('2022-06-28');
    expect(notionOAuthConfig.requestedScopes).toEqual(['read_content', 'insert_content', 'update_content']);
    expect(notionOAuthConfig.requestedScopes).not.toContain('read_user');
  });

  it('builds an MV3-compatible redirect URI through chrome.identity', () => {
    expect(getNotionOAuthRedirectUri({ redirectPath: 'notion-oauth' })).toBe(
      'https://extension.example.test/notion-oauth'
    );
    expect(chrome.identity.getRedirectURL).toHaveBeenCalledWith('notion-oauth');
  });

  it('builds a Notion authorization URL with configured scopes and state', () => {
    const url = new URL(buildNotionAuthorizationUrl(testConfig, testConfig.redirectUri!, 'state-1'));

    expect(url.origin + url.pathname).toBe(testConfig.authorizationEndpoint);
    expect(url.searchParams.get('client_id')).toBe('notion-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('owner')).toBe('user');
    expect(url.searchParams.get('redirect_uri')).toBe(testConfig.redirectUri);
    expect(url.searchParams.get('scope')).toBe('read_content insert_content update_content');
    expect(url.searchParams.get('state')).toBe('state-1');
  });
});

describe('Notion OAuth callback handling', () => {
  it('extracts the authorization code from a valid callback', () => {
    expect(parseNotionOAuthCallback('https://extension.example.test/callback?code=auth-code&state=state-1', 'state-1')).toBe(
      'auth-code'
    );
  });

  it('rejects failed callbacks', () => {
    expect(() =>
      parseNotionOAuthCallback(
        'https://extension.example.test/callback?error=access_denied&error_description=Denied&state=state-1',
        'state-1'
      )
    ).toThrow('access_denied: Denied');
  });

  it('rejects callbacks with a mismatched state', () => {
    expect(() =>
      parseNotionOAuthCallback('https://extension.example.test/callback?code=auth-code&state=other-state', 'state-1')
    ).toThrow('oauth-state-mismatch');
  });
});

describe('Notion token exchange and persistence', () => {
  it('exchanges an authorization code for tokens and workspace info', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          expires_in: 3600,
          workspace_id: 'workspace-1',
          workspace_name: 'Engineering',
          workspace_icon: 'https://notion.example/icon.png',
          bot_id: 'bot-1',
          owner: { type: 'user', user: { id: 'user-1' } }
        }),
        { status: 200 }
      )
    );

    await expect(
      exchangeNotionAuthorizationCode('auth-code', testConfig.redirectUri!, {
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      })
    ).resolves.toEqual({
      authState: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'bearer',
        expiresAt: '2026-05-18T19:00:00.000Z'
      } satisfies NotionAuthState,
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'Engineering',
        workspaceIcon: 'https://notion.example/icon.png',
        botId: 'bot-1',
        ownerUserId: 'user-1'
      } satisfies NotionWorkspaceInfo
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
        grant_type: 'authorization_code',
        code: 'auth-code',
        redirect_uri: testConfig.redirectUri
      }),
      signal: expect.any(AbortSignal)
    });
  });

  it('stores Notion tokens only through chrome.storage.local after launch and callback', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          expires_in: 600,
          workspace_id: 'workspace-1'
        }),
        { status: 200 }
      )
    );

    vi.mocked(chrome.identity.launchWebAuthFlow).mockResolvedValue(
      'https://extension.example.test/notion-callback?code=auth-code&state=state-1'
    );

    await expect(
      startNotionOAuth({
        config: testConfig,
        fetcher,
        now: () => new Date('2026-05-18T18:00:00.000Z'),
        createState: () => 'state-1'
      })
    ).resolves.toEqual({
      authState: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'bearer',
        expiresAt: '2026-05-18T18:10:00.000Z'
      },
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: undefined,
        workspaceIcon: undefined,
        botId: undefined,
        ownerUserId: undefined
      }
    });

    const launchedUrl = new URL(vi.mocked(chrome.identity.launchWebAuthFlow).mock.calls[0][0].url);
    expect(launchedUrl.searchParams.get('state')).toBe('state-1');
    expect(launchedUrl.searchParams.get('redirect_uri')).toBe(testConfig.redirectUri);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [storageKeys.notionAuthState]: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'bearer',
        expiresAt: '2026-05-18T18:10:00.000Z'
      }
    });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [storageKeys.notionWorkspace]: {
        workspaceId: 'workspace-1',
        workspaceName: undefined,
        workspaceIcon: undefined,
        botId: undefined,
        ownerUserId: undefined
      }
    });
  });

  it('rejects a failed token exchange without persisting tokens', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));

    await expect(
      exchangeNotionAuthorizationCode('bad-code', testConfig.redirectUri!, { config: testConfig, fetcher })
    ).rejects.toThrow('token-exchange-failed:400');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('rejects OAuth launch when the client id is not configured', async () => {
    await expect(startNotionOAuth({ config: notionOAuthConfig })).rejects.toThrow('notion-oauth-client-id-not-configured');
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });
});
