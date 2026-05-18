import { describe, expect, it } from 'vitest';

import { clipTaskStatuses, isTerminalClipTaskStatus, terminalClipTaskStatuses } from '../shared/domain/clipTask';
import { storageKeys } from '../shared/storage/keys';

describe('ClipTask status helpers', () => {
  it('defines the exact ClipTask status contract from the spec', () => {
    expect(clipTaskStatuses).toEqual([
      'idle',
      'detecting',
      'fetching',
      'parsing',
      'converting',
      'uploading_assets',
      'writing',
      'succeeded',
      'failed',
      'cancelled'
    ]);
  });

  it('identifies only terminal ClipTask statuses', () => {
    expect(terminalClipTaskStatuses).toEqual(['succeeded', 'failed', 'cancelled']);

    for (const status of clipTaskStatuses) {
      expect(isTerminalClipTaskStatus(status)).toBe(['succeeded', 'failed', 'cancelled'].includes(status));
    }
  });
});

describe('storage key constants', () => {
  it('defines stable chrome.storage.local keys for persisted extension state', () => {
    expect(storageKeys).toEqual({
      notionAuthState: 'notion.authState',
      notionWorkspace: 'notion.workspace',
      notionDefaultTarget: 'notion.defaultTarget',
      confluenceBaseUrl: 'confluence.baseUrl',
      activeClipTaskLock: 'clipTask.activeLock',
      lastTerminalClipTaskSummary: 'clipTask.lastTerminalSummary'
    });
  });

  it('keeps Notion, Confluence, and ClipTask key namespaces separate', () => {
    expect(storageKeys.notionAuthState).toMatch(/^notion\./);
    expect(storageKeys.notionWorkspace).toMatch(/^notion\./);
    expect(storageKeys.notionDefaultTarget).toMatch(/^notion\./);
    expect(storageKeys.confluenceBaseUrl).toMatch(/^confluence\./);
    expect(storageKeys.activeClipTaskLock).toMatch(/^clipTask\./);
    expect(storageKeys.lastTerminalClipTaskSummary).toMatch(/^clipTask\./);
  });
});
