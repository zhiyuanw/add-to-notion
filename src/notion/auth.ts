import {
  clearNotionSessionState,
  readLocalStorageValue,
  readNotionAuthState,
  saveNotionAuthState,
  storageKeys,
  writeLocalStorageValue,
  type NotionAuthState,
  type NotionWorkspaceInfo
} from '../shared/storage';
import { fetchWithTimeoutAndRetry, type RetriableFetchAttempt } from '../shared/request';
import type { DebugLogger } from '../shared/debugLogger';
import { notionApiConfig, type NotionApiConfig } from './config';

export interface NotionAuthOptions {
  config?: NotionApiConfig;
  fetcher?: RetriableFetchAttempt;
  now?: () => Date;
  deadlineMs?: number;
  debugLogger?: DebugLogger;
}

export interface NotionAuthorizationStatus {
  connected: boolean;
  workspace?: NotionWorkspaceInfo;
}

interface NotionUserResponse {
  object?: unknown;
  id?: unknown;
  name?: unknown;
  bot?: unknown;
}

export class NotionAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotionAuthError';
  }
}

export async function getValidNotionAuthState(): Promise<NotionAuthState> {
  const authState = await readNotionAuthState();

  if (!authState) {
    throw new NotionAuthError('notion-auth-missing');
  }

  return authState;
}

export async function saveNotionPersonalAccessToken(token: string, options: NotionAuthOptions = {}): Promise<NotionWorkspaceInfo> {
  const accessToken = normalizeNotionToken(token);
  const workspace = await validateNotionPersonalAccessToken(accessToken, options);

  await saveNotionAuthState({
    accessToken,
    tokenType: 'bearer'
  });
  await writeLocalStorageValue(storageKeys.notionWorkspace, workspace);

  return workspace;
}

export async function validateNotionPersonalAccessToken(token: string, options: NotionAuthOptions = {}): Promise<NotionWorkspaceInfo> {
  const accessToken = normalizeNotionToken(token);
  const response = await fetchWithTimeoutAndRetry('https://api.notion.com/v1/users/me', {
    fetcher: options.fetcher,
    method: 'GET',
    headers: buildNotionApiHeaders(accessToken, options.config ?? notionApiConfig),
    deadlineMs: options.deadlineMs
  });

  if (!response.ok) {
    throw new NotionAuthError(`notion-token-validation-failed:${response.status}`);
  }

  return mapUserResponseToWorkspace((await response.json()) as NotionUserResponse);
}

export async function notionApiFetch(input: RequestInfo | URL, init: RequestInit = {}, options: NotionAuthOptions = {}): Promise<Response> {
  const config = options.config ?? notionApiConfig;
  const authState = await getValidNotionAuthState();
  const headers = new Headers(init.headers);

  for (const [key, value] of Object.entries(buildNotionApiHeaders(authState.accessToken, config))) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  if (shouldUseJsonContentType(init.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetchWithTimeoutAndRetry(input, { ...init, fetcher: options.fetcher, headers, deadlineMs: options.deadlineMs });
}

export async function logoutNotion(): Promise<void> {
  await clearNotionSessionState();
}

export async function getNotionAuthorizationStatus(): Promise<NotionAuthorizationStatus> {
  const [authState, workspace] = await Promise.all([
    readNotionAuthState(),
    readLocalStorageValue(storageKeys.notionWorkspace)
  ]);

  return {
    connected: Boolean(authState),
    workspace
  };
}

function normalizeNotionToken(token: string): string {
  const normalized = token.trim();

  if (!normalized) {
    throw new NotionAuthError('notion-token-missing');
  }

  return normalized;
}

function shouldUseJsonContentType(body: BodyInit | null | undefined): boolean {
  return typeof body === 'string';
}

function buildNotionApiHeaders(accessToken: string, config: NotionApiConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': config.notionVersion,
    Accept: 'application/json'
  };
}

function mapUserResponseToWorkspace(response: NotionUserResponse): NotionWorkspaceInfo {
  if (response.object !== 'user') {
    throw new NotionAuthError('invalid-notion-user-response');
  }

  const workspaceId = requireString(response.id, 'missing-notion-user-id');
  const bot = isRecord(response.bot) ? response.bot : undefined;

  return {
    workspaceId,
    workspaceName: optionalString(response.name) ?? optionalString(bot?.workspace_name) ?? 'Notion integration',
    workspaceIcon: optionalString(bot?.workspace_icon),
    botId: workspaceId,
    ownerUserId: isRecord(bot?.owner) && isRecord(bot.owner.user) ? optionalString(bot.owner.user.id) : undefined
  };
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new NotionAuthError(error);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
