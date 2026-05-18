import type { ConfluencePageRef, Degradation, NotionTarget } from './models';

export const clipTaskStatuses = [
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
] as const;

export type ClipTaskStatus = (typeof clipTaskStatuses)[number];

export const terminalClipTaskStatuses = ['succeeded', 'failed', 'cancelled'] as const satisfies readonly ClipTaskStatus[];

export type TerminalClipTaskStatus = (typeof terminalClipTaskStatuses)[number];

const terminalClipTaskStatusSet = new Set<ClipTaskStatus>(terminalClipTaskStatuses);

export function isTerminalClipTaskStatus(status: ClipTaskStatus): status is TerminalClipTaskStatus {
  return terminalClipTaskStatusSet.has(status);
}

export interface ClipTaskProgress {
  stage: ClipTaskStatus;
  message?: string;
  completedUnits?: number;
  totalUnits?: number;
}

export interface ClipTaskFailure {
  code: string;
  message: string;
}

export interface ClipTaskResult {
  notionPageId?: string;
  notionPageUrl?: string;
  blockCount: number;
  assetCount: number;
  warningCount: number;
  elapsedMs: number;
}

export interface ClipTask {
  taskId: string;
  status: ClipTaskStatus;
  progress: ClipTaskProgress;
  warnings: Degradation[];
  startedAt: string;
  updatedAt: string;
  pageRef?: ConfluencePageRef;
  sourceTitle?: string;
  target?: NotionTarget;
  result?: ClipTaskResult;
  failure?: ClipTaskFailure;
}

export interface TerminalClipTaskSummary {
  taskId: string;
  status: TerminalClipTaskStatus;
  sourceTitle?: string;
  sourceUrl?: string;
  target?: NotionTarget;
  notionPageUrl?: string;
  warningCount: number;
  failureReason?: string;
  completedAt: string;
}
