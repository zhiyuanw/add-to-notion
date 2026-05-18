import { describe, expect, it, vi } from 'vitest';

import type { ClipTask } from '../shared/domain';
import { buildClipTaskNotification, redactSensitiveText, showClipTaskCompletionFeedback } from '../background/notifications';

const completedTask: ClipTask = {
  taskId: 'task-1',
  status: 'succeeded',
  progress: { stage: 'succeeded' },
  warnings: [],
  startedAt: '2026-05-18T20:50:00.000Z',
  updatedAt: '2026-05-18T20:51:00.000Z',
  sourceTitle: 'Roadmap',
  result: {
    notionPageId: 'page-1',
    notionPageUrl: 'https://notion.example/page-1',
    blockCount: 10,
    assetCount: 2,
    warningCount: 1,
    elapsedMs: 1000
  }
};

describe('ClipTask completion feedback', () => {
  it('builds a success notification payload and success badge', async () => {
    const create = vi.fn(async () => 'notification-1');
    const setBadgeText = vi.fn(async () => undefined);
    const setBadgeBackgroundColor = vi.fn(async () => undefined);

    await showClipTaskCompletionFeedback(completedTask, {
      chromeApi: {
        notifications: { create },
        action: { setBadgeText, setBadgeBackgroundColor }
      }
    });

    expect(create).toHaveBeenCalledWith(
      'clip-task-task-1',
      expect.objectContaining({
        type: 'basic',
        title: 'Save to Notion complete',
        message: expect.stringContaining('Created a new Notion page for Roadmap')
      })
    );
    expect(setBadgeText).toHaveBeenCalledWith({ text: 'OK' });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#137333' });
  });

  it('builds a failure notification payload and failure badge', async () => {
    const task: ClipTask = {
      ...completedTask,
      status: 'failed',
      progress: { stage: 'failed', message: 'Notion rejected the request.' },
      failure: { code: 'notion-write-failed', message: 'Notion rejected the request.' },
      result: undefined
    };

    const payload = buildClipTaskNotification(task);

    expect(payload.notificationId).toBe('clip-task-task-1');
    expect(payload.options.title).toBe('Save to Notion failed');
    expect(payload.options.message).toContain('Notion rejected the request.');
    expect(payload.badgeText).toBe('!');
    expect(payload.badgeColor).toBe('#b3261e');
  });

  it('includes retry guidance for timeout and startup recovery failures', () => {
    const timeoutPayload = buildClipTaskNotification({
      ...completedTask,
      status: 'failed',
      failure: { code: 'clip-task-timeout', message: 'Clip task timed out. Please try again.' },
      result: undefined
    });
    const startupPayload = buildClipTaskNotification({
      ...completedTask,
      status: 'failed',
      failure: { code: 'service-worker-restarted', message: 'Previous save was interrupted. Please try again.' },
      result: undefined
    });

    expect(timeoutPayload.options.message).toContain('Open the popup and retry the save.');
    expect(startupPayload.options.message).toContain('Open the popup and retry the save.');
  });

  it('redacts secrets from notification text', () => {
    const text = redactSensitiveText(
      'Authorization: Bearer notion-token-123\nCookie: JSESSIONID=abc; cloud.session=def\naccess_token=secret-a refresh_token=secret-b'
    );

    expect(text).not.toContain('notion-token-123');
    expect(text).not.toContain('JSESSIONID=abc');
    expect(text).not.toContain('cloud.session=def');
    expect(text).not.toContain('secret-a');
    expect(text).not.toContain('secret-b');
    expect(text).toContain('Authorization: [redacted]');
    expect(text).toContain('Cookie: [redacted]');
  });
});
