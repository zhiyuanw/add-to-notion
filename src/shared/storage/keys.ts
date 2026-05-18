export const storageKeys = {
  notionAuthState: 'notion.authState',
  notionWorkspace: 'notion.workspace',
  notionDefaultTarget: 'notion.defaultTarget',
  confluenceBaseUrl: 'confluence.baseUrl',
  activeClipTaskLock: 'clipTask.activeLock',
  lastTerminalClipTaskSummary: 'clipTask.lastTerminalSummary'
} as const;

export type StorageKeyName = keyof typeof storageKeys;
export type StorageKey = (typeof storageKeys)[StorageKeyName];

export interface NotionAuthState {
  accessToken: string;
  refreshToken: string;
  tokenType: 'bearer';
  expiresAt: string;
}

export interface NotionWorkspaceInfo {
  workspaceId: string;
  workspaceName?: string;
  workspaceIcon?: string;
  botId?: string;
  ownerUserId?: string;
}
