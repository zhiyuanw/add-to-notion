import type { ClipTask } from '../shared/domain';

export interface ClipTaskFeedbackChromeApi {
  notifications?: {
    create: (notificationId: string, options: chrome.notifications.NotificationOptions<true>) => Promise<string> | void;
  };
  action?: {
    setBadgeText: (details: chrome.action.BadgeTextDetails) => Promise<void> | void;
    setBadgeBackgroundColor: (details: chrome.action.BadgeColorDetails) => Promise<void> | void;
  };
}

export interface ClipTaskNotificationPayload {
  notificationId: string;
  options: chrome.notifications.NotificationOptions<true>;
  badgeText: string;
  badgeColor: string;
}

export interface ShowClipTaskCompletionFeedbackOptions {
  chromeApi?: ClipTaskFeedbackChromeApi;
}

const successBadgeColor = '#137333';
const failureBadgeColor = '#b3261e';
const retryableFailureCodes = new Set(['clip-task-timeout', 'service-worker-restarted']);

function getChromeApi(): ClipTaskFeedbackChromeApi | undefined {
  return typeof chrome === 'undefined' ? undefined : chrome;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/Authorization:\s*Bearer\s+[^\s,;]+/gi, 'Authorization: [redacted]')
    .replace(/Authorization:\s*[^\n]+/gi, 'Authorization: [redacted]')
    .replace(/Cookie:\s*[^\n]+/gi, 'Cookie: [redacted]')
    .replace(/\b(access_token|refresh_token)=([^\s&;]+)/gi, '$1=[redacted]')
    .replace(/\b(access_token|refresh_token)\b\s*[:=]\s*[^\s,;}]+/gi, '$1: [redacted]');
}

export function buildClipTaskNotification(task: ClipTask): ClipTaskNotificationPayload {
  const isSuccess = task.status === 'succeeded';
  const title = isSuccess ? 'Save to Notion complete' : 'Save to Notion failed';
  const message = redactSensitiveText(isSuccess ? buildSuccessMessage(task) : buildFailureMessage(task));

  return {
    notificationId: `clip-task-${task.taskId}`,
    options: {
      type: 'basic',
      iconUrl: 'icon-128.png',
      title,
      message
    },
    badgeText: isSuccess ? 'OK' : '!',
    badgeColor: isSuccess ? successBadgeColor : failureBadgeColor
  };
}

export async function showClipTaskCompletionFeedback(
  task: ClipTask,
  options: ShowClipTaskCompletionFeedbackOptions = {}
): Promise<void> {
  if (task.status !== 'succeeded' && task.status !== 'failed') {
    return;
  }

  const payload = buildClipTaskNotification(task);
  const chromeApi = options.chromeApi ?? getChromeApi();

  await chromeApi?.notifications?.create(payload.notificationId, payload.options);
  await chromeApi?.action?.setBadgeText({ text: payload.badgeText });
  await chromeApi?.action?.setBadgeBackgroundColor({ color: payload.badgeColor });
}

function buildSuccessMessage(task: ClipTask): string {
  const title = task.sourceTitle ?? 'this Confluence page';
  const warningText = (task.result?.warningCount ?? task.warnings.length) > 0 ? ` with ${task.result?.warningCount ?? task.warnings.length} warning(s)` : '';
  return `Created a new Notion page for ${title}${warningText}.`;
}

function buildFailureMessage(task: ClipTask): string {
  const reason = task.failure?.message ?? task.progress.message ?? 'The save did not complete.';
  const retryGuidance = task.failure?.code && retryableFailureCodes.has(task.failure.code) ? ' Open the popup and retry the save.' : '';
  return `${reason}${retryGuidance}`;
}
