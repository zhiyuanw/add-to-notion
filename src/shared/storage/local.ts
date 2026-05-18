import type { ClipTask, TerminalClipTaskSummary } from '../domain/clipTask';
import type { NotionTarget } from '../domain/models';
import { normalizeConfluenceBaseUrl } from '../../confluence/baseUrl';
import { storageKeys, type NotionAuthState, type NotionWorkspaceInfo } from './keys';

export type LocalStorageValueByKey = {
  [storageKeys.notionAuthState]: NotionAuthState;
  [storageKeys.notionWorkspace]: NotionWorkspaceInfo;
  [storageKeys.notionDefaultTarget]: NotionTarget;
  [storageKeys.confluenceBaseUrl]: string;
  [storageKeys.activeClipTaskLock]: ClipTask;
  [storageKeys.lastTerminalClipTaskSummary]: TerminalClipTaskSummary;
};

export type LocalStorageKey = keyof LocalStorageValueByKey;

const notionLogoutStorageKeys = [
  storageKeys.notionAuthState,
  storageKeys.notionWorkspace,
  storageKeys.notionDefaultTarget,
  storageKeys.lastTerminalClipTaskSummary
] as const satisfies readonly LocalStorageKey[];

export async function readLocalStorageValue<Key extends LocalStorageKey>(
  key: Key
): Promise<LocalStorageValueByKey[Key] | undefined> {
  const values = await chrome.storage.local.get(key);
  return values[key] as LocalStorageValueByKey[Key] | undefined;
}

export async function writeLocalStorageValue<Key extends LocalStorageKey>(
  key: Key,
  value: LocalStorageValueByKey[Key]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocalStorageValues(keys: readonly LocalStorageKey[]): Promise<void> {
  await chrome.storage.local.remove([...keys]);
}

export async function saveNotionAuthState(authState: NotionAuthState): Promise<void> {
  await writeLocalStorageValue(storageKeys.notionAuthState, authState);
}

export async function readNotionAuthState(): Promise<NotionAuthState | undefined> {
  return readLocalStorageValue(storageKeys.notionAuthState);
}

export async function saveConfluenceBaseUrl(input: string): Promise<string> {
  const result = normalizeConfluenceBaseUrl(input);

  if (!result.ok) {
    throw new Error(result.error);
  }

  await writeLocalStorageValue(storageKeys.confluenceBaseUrl, result.normalizedUrl);
  return result.normalizedUrl;
}

export async function readConfluenceBaseUrl(): Promise<string | undefined> {
  return readLocalStorageValue(storageKeys.confluenceBaseUrl);
}

export async function clearNotionSessionState(): Promise<void> {
  await removeLocalStorageValues(notionLogoutStorageKeys);
}
