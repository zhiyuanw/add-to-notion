import type { ClipTask, ClipTaskResult, ClipTaskStatus, Degradation, NotionTarget } from '../shared/domain';
import { isTerminalClipTaskStatus, type TerminalClipTaskSummary } from '../shared/domain';
import { readLocalStorageValue, removeLocalStorageValues, storageKeys, writeLocalStorageValue } from '../shared/storage';
import { showClipTaskCompletionFeedback } from './notifications';

const defaultClipTaskTimeoutMs = 5 * 60 * 1000;
const timeoutFailureMessage = 'Clip task timed out. Please try again.';
const startupRecoveryFailureMessage = 'Previous save was interrupted. Please try again.';

export interface ClipTaskOperationContext {
  taskId: string;
  startedAt: string;
  deadlineMs: number;
  updateStatus: (status: ClipTaskStatus, message?: string) => Promise<ClipTask>;
}

export interface ClipTaskOperationSuccess {
  status: 'succeeded';
  sourceTitle?: string;
  sourceUrl?: string;
  target?: NotionTarget;
  result?: ClipTaskResult;
  warnings?: Degradation[];
}

export interface ClipTaskOperationFailure {
  status: 'failed' | 'cancelled';
  sourceTitle?: string;
  sourceUrl?: string;
  target?: NotionTarget;
  result?: ClipTaskResult;
  warnings?: Degradation[];
  failure?: {
    code: string;
    message: string;
  };
}

export type ClipTaskOperationResult = ClipTaskOperationSuccess | ClipTaskOperationFailure;

export interface StartBackgroundClipTaskOptions {
  now?: () => string;
  createTaskId?: () => string;
  timeoutMs?: number;
  operation: (context: ClipTaskOperationContext) => Promise<ClipTaskOperationResult>;
}

export interface UpdateBackgroundClipTaskStatusOptions {
  now?: () => string;
  message?: string;
  completedUnits?: number;
  totalUnits?: number;
}

export interface RecoverInterruptedClipTaskOptions {
  now?: () => string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultCreateTaskId(): string {
  return crypto.randomUUID();
}

function buildTerminalSummary(task: ClipTask, completedAt: string): TerminalClipTaskSummary {
  return {
    taskId: task.taskId,
    status: task.status === 'cancelled' ? 'cancelled' : task.status === 'succeeded' ? 'succeeded' : 'failed',
    sourceTitle: task.sourceTitle,
    sourceUrl: task.pageRef?.pageUrl,
    target: task.target,
    notionPageUrl: task.result?.notionPageUrl,
    partial: task.result?.partial,
    warningCount: task.result?.warningCount ?? task.warnings.length,
    failureReason: task.failure?.message,
    completedAt
  };
}

async function persistTerminalTask(task: ClipTask, completedAt: string): Promise<void> {
  await writeLocalStorageValue(storageKeys.lastTerminalClipTaskSummary, buildTerminalSummary(task, completedAt));
  await removeLocalStorageValues([storageKeys.activeClipTaskLock]);
  await showClipTaskCompletionFeedback(task);
}

async function failTask(task: ClipTask, code: string, message: string, now: string): Promise<ClipTask> {
  const failedTask: ClipTask = {
    ...task,
    status: 'failed',
    progress: { stage: 'failed', message },
    failure: { code, message },
    updatedAt: now
  };

  await persistTerminalTask(failedTask, now);
  return failedTask;
}

export async function updateBackgroundClipTaskStatus(
  taskId: string,
  status: ClipTaskStatus,
  options: UpdateBackgroundClipTaskStatusOptions = {}
): Promise<ClipTask> {
  const task = await readLocalStorageValue(storageKeys.activeClipTaskLock);

  if (!task || task.taskId !== taskId) {
    throw new Error('clip-task-not-active');
  }

  const updatedAt = options.now?.() ?? defaultNow();
  const updatedTask: ClipTask = {
    ...task,
    status,
    progress: {
      stage: status,
      message: options.message,
      completedUnits: options.completedUnits,
      totalUnits: options.totalUnits
    },
    updatedAt
  };

  await writeLocalStorageValue(storageKeys.activeClipTaskLock, updatedTask);
  return updatedTask;
}

async function finishTask(taskId: string, result: ClipTaskOperationResult, now: string): Promise<ClipTask | undefined> {
  const currentTask = await readLocalStorageValue(storageKeys.activeClipTaskLock);

  if (!currentTask || currentTask.taskId !== taskId || isTerminalClipTaskStatus(currentTask.status)) {
    return undefined;
  }

  const terminalTask: ClipTask = {
    ...currentTask,
    status: result.status,
    progress: { stage: result.status, message: result.status === 'succeeded' ? undefined : result.failure?.message },
    warnings: result.warnings ?? currentTask.warnings,
    sourceTitle: result.sourceTitle ?? currentTask.sourceTitle,
    target: result.target ?? currentTask.target,
    result: result.result,
    failure: result.status === 'succeeded' ? undefined : result.failure,
    pageRef: result.sourceUrl
      ? {
          baseUrl: currentTask.pageRef?.baseUrl ?? '',
          pageId: currentTask.pageRef?.pageId ?? '',
          pageUrl: result.sourceUrl
        }
      : currentTask.pageRef,
    updatedAt: now
  };

  await persistTerminalTask(terminalTask, now);
  return terminalTask;
}

export async function startBackgroundClipTask(options: StartBackgroundClipTaskOptions): Promise<ClipTask> {
  const existingTask = await readLocalStorageValue(storageKeys.activeClipTaskLock);

  if (existingTask && !isTerminalClipTaskStatus(existingTask.status)) {
    return existingTask;
  }

  const now = options.now ?? defaultNow;
  const startedAt = now();
  const taskId = options.createTaskId?.() ?? defaultCreateTaskId();
  const timeoutMs = options.timeoutMs ?? defaultClipTaskTimeoutMs;
  const task: ClipTask = {
    taskId,
    status: 'detecting',
    progress: { stage: 'detecting' },
    warnings: [],
    startedAt,
    updatedAt: startedAt
  };

  await writeLocalStorageValue(storageKeys.activeClipTaskLock, task);

  void runOperation(task, timeoutMs, options.operation, now);

  return task;
}

async function runOperation(
  task: ClipTask,
  timeoutMs: number,
  operation: (context: ClipTaskOperationContext) => Promise<ClipTaskOperationResult>,
  now: () => string
): Promise<void> {
  const deadlineMs = Date.parse(task.startedAt) + timeoutMs;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<ClipTaskOperationFailure>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        status: 'failed',
        failure: { code: 'clip-task-timeout', message: timeoutFailureMessage },
        warnings: []
      });
    }, timeoutMs);
  });

  const operationPromise = operation({
    taskId: task.taskId,
    startedAt: task.startedAt,
    deadlineMs,
    updateStatus: (status, message) => updateBackgroundClipTaskStatus(task.taskId, status, { now, message })
  }).catch(
    (error: unknown): ClipTaskOperationFailure => ({
      status: 'failed',
      failure: { code: 'clip-task-failed', message: error instanceof Error ? error.message : 'Clip task failed.' },
      warnings: []
    })
  );

  const result = await Promise.race([operationPromise, timeoutPromise]);

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  await finishTask(task.taskId, result, now());
}

export async function recoverInterruptedClipTaskOnStartup(
  options: RecoverInterruptedClipTaskOptions = {}
): Promise<ClipTask | undefined> {
  const task = await readLocalStorageValue(storageKeys.activeClipTaskLock);

  if (!task || isTerminalClipTaskStatus(task.status)) {
    return undefined;
  }

  return failTask(task, 'service-worker-restarted', startupRecoveryFailureMessage, options.now?.() ?? defaultNow());
}
