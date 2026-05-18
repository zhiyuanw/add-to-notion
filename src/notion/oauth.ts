import { fetchWithTimeoutAndRetry, type RetriableFetchAttempt } from '../shared/request';
import { storageKeys, writeLocalStorageValue } from '../shared/storage';
import type { NotionAuthState, NotionWorkspaceInfo } from '../shared/storage';

export interface NotionOAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  notionVersion: string;
  requestedScopes: readonly string[];
  owner: 'user';
  clientId: string;
  clientSecret?: string;
  redirectPath: string;
  redirectUri?: string;
}

export const notionOAuthConfig: NotionOAuthConfig = {
  authorizationEndpoint: 'https://api.notion.com/v1/oauth/authorize',
  tokenEndpoint: 'https://api.notion.com/v1/oauth/token',
  notionVersion: '2022-06-28',
  requestedScopes: ['read_content', 'insert_content', 'update_content'],
  owner: 'user',
  clientId: '__NOTION_OAUTH_CLIENT_ID__',
  redirectPath: 'notion-oauth'
};

export interface NotionOAuthResult {
  authState: NotionAuthState;
  workspace: NotionWorkspaceInfo;
}

interface StartNotionOAuthOptions {
  config?: NotionOAuthConfig;
  now?: () => Date;
  createState?: () => string;
  fetcher?: RetriableFetchAttempt;
  deadlineMs?: number;
}

interface NotionOAuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  workspace_id?: unknown;
  workspace_name?: unknown;
  workspace_icon?: unknown;
  bot_id?: unknown;
  owner?: unknown;
}

export class NotionOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionOAuthError';
  }
}

export async function startNotionOAuth(options: StartNotionOAuthOptions = {}): Promise<NotionOAuthResult> {
  const config = options.config ?? notionOAuthConfig;
  assertConfiguredClient(config);

  const redirectUri = getNotionOAuthRedirectUri(config);
  const state = options.createState?.() ?? crypto.randomUUID();
  const authorizationUrl = buildNotionAuthorizationUrl(config, redirectUri, state);
  const callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });

  if (!callbackUrl) {
    throw new NotionOAuthError('oauth-callback-missing');
  }

  const code = parseNotionOAuthCallback(callbackUrl, state);
  const result = await exchangeNotionAuthorizationCode(code, redirectUri, {
    config,
    now: options.now,
    fetcher: options.fetcher,
    deadlineMs: options.deadlineMs
  });

  await persistNotionOAuthResult(result);
  return result;
}

export function getNotionOAuthRedirectUri(config: Pick<NotionOAuthConfig, 'redirectUri' | 'redirectPath'>): string {
  return config.redirectUri ?? chrome.identity.getRedirectURL(config.redirectPath);
}

export function buildNotionAuthorizationUrl(config: NotionOAuthConfig, redirectUri: string, state: string): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', config.owner);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  if (config.requestedScopes.length > 0) {
    url.searchParams.set('scope', config.requestedScopes.join(' '));
  }

  return url.toString();
}

export function parseNotionOAuthCallback(callbackUrl: string, expectedState: string): string {
  const url = new URL(callbackUrl);
  const error = url.searchParams.get('error');

  if (error) {
    const description = url.searchParams.get('error_description');
    throw new NotionOAuthError(description ? `${error}: ${description}` : error);
  }

  if (url.searchParams.get('state') !== expectedState) {
    throw new NotionOAuthError('oauth-state-mismatch');
  }

  const code = url.searchParams.get('code');

  if (!code) {
    throw new NotionOAuthError('missing-authorization-code');
  }

  return code;
}

export async function exchangeNotionAuthorizationCode(
  code: string,
  redirectUri: string,
  options: Pick<StartNotionOAuthOptions, 'config' | 'now' | 'fetcher' | 'deadlineMs'> = {}
): Promise<NotionOAuthResult> {
  const config = options.config ?? notionOAuthConfig;
  assertConfiguredClient(config);

  const response = await fetchWithTimeoutAndRetry(config.tokenEndpoint, {
    fetcher: options.fetcher,
    method: 'POST',
    headers: buildTokenExchangeHeaders(config),
    body: JSON.stringify(buildTokenExchangeBody(code, redirectUri, config)),
    deadlineMs: options.deadlineMs
  });

  if (!response.ok) {
    throw new NotionOAuthError(`token-exchange-failed:${response.status}`);
  }

  return mapTokenResponseToOAuthResult((await response.json()) as NotionOAuthTokenResponse, options.now?.() ?? new Date());
}

export async function persistNotionOAuthResult(result: NotionOAuthResult): Promise<void> {
  await writeLocalStorageValue(storageKeys.notionAuthState, result.authState);
  await writeLocalStorageValue(storageKeys.notionWorkspace, result.workspace);
}

function assertConfiguredClient(config: NotionOAuthConfig): void {
  if (!config.clientId || config.clientId === notionOAuthConfig.clientId) {
    throw new NotionOAuthError('notion-oauth-client-id-not-configured');
  }
}

function buildTokenExchangeHeaders(config: NotionOAuthConfig): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Notion-Version': config.notionVersion
  };

  if (config.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  }

  return headers;
}

function buildTokenExchangeBody(code: string, redirectUri: string, config: NotionOAuthConfig): Record<string, string> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  };

  if (!config.clientSecret) {
    body.client_id = config.clientId;
  }

  return body;
}

function mapTokenResponseToOAuthResult(response: NotionOAuthTokenResponse, now: Date): NotionOAuthResult {
  const accessToken = requireString(response.access_token, 'missing-access-token');
  const refreshToken = requireString(response.refresh_token, 'missing-refresh-token');
  const tokenType = requireString(response.token_type, 'missing-token-type').toLowerCase();
  const expiresIn = requireNumber(response.expires_in, 'missing-expires-in');
  const workspaceId = requireString(response.workspace_id, 'missing-workspace-id');

  if (tokenType !== 'bearer') {
    throw new NotionOAuthError('unsupported-token-type');
  }

  return {
    authState: {
      accessToken,
      refreshToken,
      tokenType,
      expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString()
    },
    workspace: {
      workspaceId,
      workspaceName: optionalString(response.workspace_name),
      workspaceIcon: optionalString(response.workspace_icon),
      botId: optionalString(response.bot_id),
      ownerUserId: readOwnerUserId(response.owner)
    }
  };
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotionOAuthError(error);
  }

  return value;
}

function requireNumber(value: unknown, error: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new NotionOAuthError(error);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOwnerUserId(owner: unknown): string | undefined {
  if (!owner || typeof owner !== 'object' || !('type' in owner) || owner.type !== 'user' || !('user' in owner)) {
    return undefined;
  }

  const user = owner.user;

  if (!user || typeof user !== 'object' || !('id' in user)) {
    return undefined;
  }

  return optionalString(user.id);
}
