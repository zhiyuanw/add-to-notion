import {
  clearNotionSessionState,
  readLocalStorageValue,
  readNotionAuthState,
  saveNotionAuthState,
  storageKeys,
  type NotionAuthState,
  type NotionWorkspaceInfo
} from '../shared/storage';
import { fetchWithTimeoutAndRetry, type RetriableFetchAttempt } from '../shared/request';
import { notionOAuthConfig, type NotionOAuthConfig } from './oauth';

export interface NotionAuthOptions {
  config?: NotionOAuthConfig;
  fetcher?: RetriableFetchAttempt;
  now?: () => Date;
  deadlineMs?: number;
}

export interface NotionAuthorizationStatus {
  connected: boolean;
  workspace?: NotionWorkspaceInfo;
  requiresReauthorization: boolean;
}

interface NotionRefreshTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

export class NotionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionAuthError';
  }
}

export async function getValidNotionAuthState(options: NotionAuthOptions = {}): Promise<NotionAuthState> {
  const authState = await readNotionAuthState();

  if (!authState) {
    throw new NotionAuthError('notion-auth-missing');
  }

  if (!isNotionAccessTokenExpired(authState, options.now?.() ?? new Date())) {
    return authState;
  }

  try {
    return await refreshNotionAccessToken(authState, options);
  } catch (error) {
    await clearNotionSessionState();
    throw error;
  }
}

export async function refreshNotionAccessToken(
  authState: NotionAuthState,
  options: NotionAuthOptions = {}
): Promise<NotionAuthState> {
  const config = options.config ?? notionOAuthConfig;
  assertConfiguredClient(config);

  if (!authState.refreshToken) {
    throw new NotionAuthError('notion-refresh-token-missing');
  }

  const response = await fetchWithTimeoutAndRetry(config.tokenEndpoint, {
    fetcher: options.fetcher,
    method: 'POST',
    headers: buildTokenRefreshHeaders(config),
    body: JSON.stringify(buildTokenRefreshBody(authState.refreshToken, config)),
    deadlineMs: options.deadlineMs
  });

  if (!response.ok) {
    throw new NotionAuthError(`token-refresh-failed:${response.status}`);
  }

  const refreshedAuthState = mapRefreshResponseToAuthState(
    (await response.json()) as NotionRefreshTokenResponse,
    authState,
    options.now?.() ?? new Date()
  );

  await saveNotionAuthState(refreshedAuthState);
  return refreshedAuthState;
}

export async function notionApiFetch(input: RequestInfo | URL, init: RequestInit = {}, options: NotionAuthOptions = {}): Promise<Response> {
  const config = options.config ?? notionOAuthConfig;
  const authState = await getValidNotionAuthState(options);
  const headers = new Headers(init.headers);

  headers.set('Authorization', `Bearer ${authState.accessToken}`);
  headers.set('Notion-Version', config.notionVersion);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  return fetchWithTimeoutAndRetry(input, { ...init, fetcher: options.fetcher, headers, deadlineMs: options.deadlineMs });
}

export async function logoutNotion(): Promise<void> {
  await clearNotionSessionState();
}

export async function getNotionAuthorizationStatus(options: Pick<NotionAuthOptions, 'now'> = {}): Promise<NotionAuthorizationStatus> {
  const [authState, workspace] = await Promise.all([
    readNotionAuthState(),
    readLocalStorageValue(storageKeys.notionWorkspace)
  ]);

  return {
    connected: Boolean(authState),
    workspace,
    requiresReauthorization: Boolean(authState && isNotionAccessTokenExpired(authState, options.now?.() ?? new Date()) && !authState.refreshToken)
  };
}

export function isNotionAccessTokenExpired(authState: Pick<NotionAuthState, 'expiresAt'>, now: Date = new Date()): boolean {
  const expiresAt = Date.parse(authState.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

function assertConfiguredClient(config: NotionOAuthConfig): void {
  if (!config.clientId || config.clientId === notionOAuthConfig.clientId) {
    throw new NotionAuthError('notion-oauth-client-id-not-configured');
  }
}

function buildTokenRefreshHeaders(config: NotionOAuthConfig): HeadersInit {
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

function buildTokenRefreshBody(refreshToken: string, config: NotionOAuthConfig): Record<string, string> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };

  if (!config.clientSecret) {
    body.client_id = config.clientId;
  }

  return body;
}

function mapRefreshResponseToAuthState(
  response: NotionRefreshTokenResponse,
  previousAuthState: NotionAuthState,
  now: Date
): NotionAuthState {
  const accessToken = requireString(response.access_token, 'missing-access-token');
  const tokenType = requireString(response.token_type, 'missing-token-type').toLowerCase();
  const expiresIn = requireNumber(response.expires_in, 'missing-expires-in');

  if (tokenType !== 'bearer') {
    throw new NotionAuthError('unsupported-token-type');
  }

  return {
    accessToken,
    refreshToken: optionalString(response.refresh_token) ?? previousAuthState.refreshToken,
    tokenType,
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString()
  };
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotionAuthError(error);
  }

  return value;
}

function requireNumber(value: unknown, error: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new NotionAuthError(error);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
