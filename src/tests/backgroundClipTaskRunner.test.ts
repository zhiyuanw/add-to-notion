import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClipTask } from '../shared/domain';
import { isTerminalClipTaskStatus } from '../shared/domain';
import { storageKeys } from '../shared/storage';
import { showClipTaskCompletionFeedback } from '../background/notifications';
import {
  recoverInterruptedClipTaskOnStartup,
  startBackgroundClipTask,
  updateBackgroundClipTaskStatus,
  type ClipTaskOperationContext
} from '../background/clipTaskRunner';

vi.mock('../background/notifications', () => ({
  showClipTaskCompletionFeedback: vi.fn(async () => undefined)
}));

const storage = new Map<string, unknown>();
const startedAt = '2026-05-18T20:10:00.000Z';

function stubStorage(): void {
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
}

function makeTask(overrides: Partial<ClipTask> = {}): ClipTask {
  return {
    taskId: 'task-existing',
    status: 'fetching',
    progress: { stage: 'fetching', message: 'Fetching' },
    warnings: [],
    startedAt,
    updatedAt: startedAt,
    ...overrides
  };
}

beforeEach(() => {
  storage.clear();
  stubStorage();
  vi.mocked(showClipTaskCompletionFeedback).mockClear();
  vi.useRealTimers();
});

describe('background ClipTask runner', () => {
  it('starts a new persisted non-terminal ClipTask and runs the operation in the background', async () => {
    const operation = vi.fn(async (context: ClipTaskOperationContext) => {
      await context.updateStatus('fetching', 'Fetching storage');
      return {
        status: 'succeeded' as const,
        sourceTitle: 'Roadmap',
        sourceUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=123',
        target: { type: 'page' as const, id: 'page-1', displayName: 'Docs' },
        result: {
          notionPageId: 'notion-page-1',
          notionPageUrl: 'https://notion.example/page-1',
          blockCount: 5,
          assetCount: 1,
          warningCount: 0,
          elapsedMs: 100
        },
        warnings: []
      };
    });

    const task = await startBackgroundClipTask({ now: () => startedAt, createTaskId: () => 'task-1', operation });

    expect(task).toMatchObject({ taskId: 'task-1', status: 'detecting', progress: { stage: 'detecting' } });
    expect(storage.get(storageKeys.activeClipTaskLock)).toMatchObject({ taskId: 'task-1', status: 'detecting' });

    await vi.waitFor(() => {
      expect(storage.get(storageKeys.activeClipTaskLock)).toBeUndefined();
      expect(storage.get(storageKeys.lastTerminalClipTaskSummary)).toMatchObject({
        taskId: 'task-1',
        status: 'succeeded',
        sourceTitle: 'Roadmap',
        sourceUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=123',
        notionPageUrl: 'https://notion.example/page-1',
        warningCount: 0
      });
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(showClipTaskCompletionFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', status: 'succeeded' })
    );
  });

  it('returns the existing non-terminal ClipTask for duplicate save clicks', async () => {
    const existingTask = makeTask({ taskId: 'task-running', status: 'uploading_assets' });
    storage.set(storageKeys.activeClipTaskLock, existingTask);
    const operation = vi.fn(async () => ({ status: 'succeeded' as const, result: undefined, warnings: [] }));

    const task = await startBackgroundClipTask({ now: () => startedAt, createTaskId: () => 'task-new', operation });

    expect(task).toEqual(existingTask);
    expect(operation).not.toHaveBeenCalled();
    expect(storage.get(storageKeys.activeClipTaskLock)).toEqual(existingTask);
  });

  it('marks the task failed and releases the lock when the overall timeout expires', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(() => new Promise<never>(() => undefined));

    await startBackgroundClipTask({ now: () => startedAt, createTaskId: () => 'task-timeout', operation, timeoutMs: 300 });
    await vi.advanceTimersByTimeAsync(300);

    await vi.waitFor(() => {
      expect(storage.get(storageKeys.activeClipTaskLock)).toBeUndefined();
      expect(storage.get(storageKeys.lastTerminalClipTaskSummary)).toMatchObject({
        taskId: 'task-timeout',
        status: 'failed',
        failureReason: 'Clip task timed out. Please try again.',
        warningCount: 0
      });
    });
    expect(showClipTaskCompletionFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-timeout',
        status: 'failed',
        failure: { code: 'clip-task-timeout', message: 'Clip task timed out. Please try again.' }
      })
    );
  });

  it('recovers an interrupted persisted non-terminal task on service worker startup', async () => {
    storage.set(
      storageKeys.activeClipTaskLock,
      makeTask({
        taskId: 'task-interrupted',
        status: 'writing',
        sourceTitle: 'Incident Runbook',
        pageRef: {
          baseUrl: 'https://confluence.example.com/wiki',
          pageId: '456',
          pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=456'
        },
        target: { type: 'database', id: 'db-1', displayName: 'Knowledge Base', titlePropertyName: 'Name' }
      })
    );

    const recovered = await recoverInterruptedClipTaskOnStartup({ now: () => '2026-05-18T20:11:00.000Z' });

    expect(recovered).toMatchObject({
      taskId: 'task-interrupted',
      status: 'failed',
      failure: { code: 'service-worker-restarted', message: 'Previous save was interrupted. Please try again.' }
    });
    expect(storage.get(storageKeys.activeClipTaskLock)).toBeUndefined();
    expect(storage.get(storageKeys.lastTerminalClipTaskSummary)).toMatchObject({
      taskId: 'task-interrupted',
      status: 'failed',
      sourceTitle: 'Incident Runbook',
      sourceUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=456',
      failureReason: 'Previous save was interrupted. Please try again.',
      warningCount: 0,
      completedAt: '2026-05-18T20:11:00.000Z'
    });
    expect(showClipTaskCompletionFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-interrupted',
        status: 'failed',
        failure: { code: 'service-worker-restarted', message: 'Previous save was interrupted. Please try again.' }
      })
    );
  });

  it('keeps terminal tasks untouched during service worker startup recovery', async () => {
    storage.set(storageKeys.activeClipTaskLock, makeTask({ taskId: 'task-done', status: 'succeeded' }));

    await expect(recoverInterruptedClipTaskOnStartup({ now: () => startedAt })).resolves.toBeUndefined();
    expect(storage.get(storageKeys.activeClipTaskLock)).toMatchObject({ taskId: 'task-done', status: 'succeeded' });
  });

  it('shows failure feedback when the operation fails', async () => {
    const operation = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'notion-write-failed', message: 'Notion write failed.' },
      warnings: []
    }));

    await startBackgroundClipTask({ now: () => startedAt, createTaskId: () => 'task-failed', operation });

    await vi.waitFor(() => {
      expect(storage.get(storageKeys.activeClipTaskLock)).toBeUndefined();
      expect(showClipTaskCompletionFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-failed',
          status: 'failed',
          failure: { code: 'notion-write-failed', message: 'Notion write failed.' }
        })
      );
    });
  });

  it('persists partial write details and guidance in terminal failure summaries', async () => {
    const operation = vi.fn(async () => ({
      status: 'failed' as const,
      sourceTitle: 'Roadmap',
      sourceUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=123',
      failure: {
        code: 'notion-write-failed',
        message: 'A Notion page was created before the save failed. Open the partial page, inspect it, and delete it manually if needed.'
      },
      result: {
        notionPageId: 'partial-page-1',
        notionPageUrl: 'https://notion.example/partial-page-1',
        partial: true,
        blockCount: 1,
        assetCount: 0,
        warningCount: 0,
        elapsedMs: 100
      },
      warnings: []
    }));

    await startBackgroundClipTask({ now: () => startedAt, createTaskId: () => 'task-partial', operation });

    await vi.waitFor(() => {
      expect(storage.get(storageKeys.activeClipTaskLock)).toBeUndefined();
      expect(storage.get(storageKeys.lastTerminalClipTaskSummary)).toMatchObject({
        taskId: 'task-partial',
        status: 'failed',
        sourceTitle: 'Roadmap',
        sourceUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=123',
        notionPageUrl: 'https://notion.example/partial-page-1',
        warningCount: 0,
        failureReason: 'A Notion page was created before the save failed. Open the partial page, inspect it, and delete it manually if needed.',
        partial: true
      });
    });
    expect(showClipTaskCompletionFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-partial',
        status: 'failed',
        result: expect.objectContaining({ partial: true, notionPageUrl: 'https://notion.example/partial-page-1' })
      })
    );
  });

  it('updates persisted state transitions while a task is running', async () => {
    storage.set(storageKeys.activeClipTaskLock, makeTask({ taskId: 'task-progress', status: 'detecting' }));

    const updated = await updateBackgroundClipTaskStatus('task-progress', 'parsing', {
      now: () => '2026-05-18T20:12:00.000Z',
      message: 'Parsing storage XML',
      completedUnits: 2,
      totalUnits: 5
    });

    expect(isTerminalClipTaskStatus(updated.status)).toBe(false);
    expect(storage.get(storageKeys.activeClipTaskLock)).toMatchObject({
      taskId: 'task-progress',
      status: 'parsing',
      progress: { stage: 'parsing', message: 'Parsing storage XML', completedUnits: 2, totalUnits: 5 },
      updatedAt: '2026-05-18T20:12:00.000Z'
    });
  });
});
