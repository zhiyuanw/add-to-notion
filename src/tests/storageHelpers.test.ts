import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClipTask } from '../shared/domain/clipTask';
import type { NotionTarget } from '../shared/domain/models';
import {
  clearNotionSessionState,
  getLocalStorageChangeValue,
  readConfluenceBaseUrl,
  readLocalStorageValue,
  readNotionAuthState,
  removeLocalStorageValues,
  saveConfluenceBaseUrl,
  saveNotionAuthState,
  storageKeys,
  writeLocalStorageValue,
  type NotionAuthState,
  type NotionWorkspaceInfo
} from '../shared/storage';

const storage = new Map<string, unknown>();

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

describe('chrome.storage.local helpers', () => {
  it('reads and writes typed values in chrome.storage.local', async () => {
    const workspace: NotionWorkspaceInfo = {
      workspaceId: 'workspace-1',
      workspaceName: 'Engineering'
    };

    await writeLocalStorageValue(storageKeys.notionWorkspace, workspace);

    await expect(readLocalStorageValue(storageKeys.notionWorkspace)).resolves.toEqual(workspace);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ [storageKeys.notionWorkspace]: workspace });
    expect(chrome.storage.local.get).toHaveBeenCalledWith(storageKeys.notionWorkspace);
  });

  it('removes typed values from chrome.storage.local', async () => {
    const target: NotionTarget = {
      type: 'page',
      id: 'page-1',
      displayName: 'Team Home'
    };

    await writeLocalStorageValue(storageKeys.notionDefaultTarget, target);
    await removeLocalStorageValues([storageKeys.notionDefaultTarget]);

    await expect(readLocalStorageValue(storageKeys.notionDefaultTarget)).resolves.toBeUndefined();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith([storageKeys.notionDefaultTarget]);
  });

  it('stores Notion access and refresh tokens only through local storage helpers', async () => {
    const authState: NotionAuthState = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'bearer',
      expiresAt: '2026-05-18T18:00:00.000Z'
    };

    await saveNotionAuthState(authState);

    await expect(readNotionAuthState()).resolves.toEqual(authState);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ [storageKeys.notionAuthState]: authState });
  });

  it('stores one normalized Confluence base URL', async () => {
    await expect(saveConfluenceBaseUrl('https://confluence.example.com/wiki/')).resolves.toBe(
      'https://confluence.example.com/wiki'
    );
    await expect(readConfluenceBaseUrl()).resolves.toBe('https://confluence.example.com/wiki');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [storageKeys.confluenceBaseUrl]: 'https://confluence.example.com/wiki'
    });
  });

  it('replaces the active Confluence base URL when saving a new one', async () => {
    await saveConfluenceBaseUrl('https://confluence.example.com/wiki');
    await saveConfluenceBaseUrl('https://docs.example.com/confluence');

    await expect(readConfluenceBaseUrl()).resolves.toBe('https://docs.example.com/confluence');
  });

  it('does not store invalid Confluence base URLs', async () => {
    await expect(saveConfluenceBaseUrl('https://confluence.example.com/wiki?space=ENG')).rejects.toThrow(
      'query-not-allowed'
    );
    await expect(readConfluenceBaseUrl()).resolves.toBeUndefined();
  });

  it('reads typed new values from chrome.storage.local change events', () => {
    const activeTask: ClipTask = {
      taskId: 'task-1',
      status: 'fetching',
      progress: { stage: 'fetching' },
      warnings: [],
      startedAt: '2026-05-18T17:00:00.000Z',
      updatedAt: '2026-05-18T17:00:00.000Z'
    };
    const changes: Record<string, chrome.storage.StorageChange> = {
      [storageKeys.activeClipTaskLock]: { newValue: activeTask }
    };

    expect(getLocalStorageChangeValue(changes, storageKeys.activeClipTaskLock)).toEqual(activeTask);
    expect(getLocalStorageChangeValue(changes, storageKeys.lastTerminalClipTaskSummary)).toBeUndefined();
  });

  it('clears Notion session state on logout while preserving Confluence configuration', async () => {
    const activeTask: ClipTask = {
      taskId: 'task-1',
      status: 'fetching',
      progress: { stage: 'fetching' },
      warnings: [],
      startedAt: '2026-05-18T17:00:00.000Z',
      updatedAt: '2026-05-18T17:00:00.000Z'
    };

    await writeLocalStorageValue(storageKeys.notionAuthState, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'bearer',
      expiresAt: '2026-05-18T18:00:00.000Z'
    });
    await writeLocalStorageValue(storageKeys.notionWorkspace, { workspaceId: 'workspace-1' });
    await writeLocalStorageValue(storageKeys.notionDefaultTarget, {
      type: 'database',
      id: 'database-1',
      displayName: 'Docs',
      titlePropertyName: 'Name'
    });
    await writeLocalStorageValue(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');
    await writeLocalStorageValue(storageKeys.activeClipTaskLock, activeTask);
    await writeLocalStorageValue(storageKeys.lastTerminalClipTaskSummary, {
      taskId: 'task-0',
      status: 'succeeded',
      warningCount: 0,
      completedAt: '2026-05-18T17:30:00.000Z'
    });

    await clearNotionSessionState();

    await expect(readLocalStorageValue(storageKeys.notionAuthState)).resolves.toBeUndefined();
    await expect(readLocalStorageValue(storageKeys.notionWorkspace)).resolves.toBeUndefined();
    await expect(readLocalStorageValue(storageKeys.notionDefaultTarget)).resolves.toBeUndefined();
    await expect(readLocalStorageValue(storageKeys.lastTerminalClipTaskSummary)).resolves.toBeUndefined();
    await expect(readLocalStorageValue(storageKeys.confluenceBaseUrl)).resolves.toBe('https://confluence.example.com/wiki');
    await expect(readLocalStorageValue(storageKeys.activeClipTaskLock)).resolves.toEqual(activeTask);
    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      storageKeys.notionAuthState,
      storageKeys.notionWorkspace,
      storageKeys.notionDefaultTarget,
      storageKeys.lastTerminalClipTaskSummary
    ]);
  });
});
