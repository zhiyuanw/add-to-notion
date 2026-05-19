// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mountPopupPage } from '../popup/index';
import type { ClipTask } from '../shared/domain';
import { storageKeys } from '../shared/storage';

type TestTab = { id?: number; url?: string };

const storage = new Map<string, unknown>();
let queryTabs: ReturnType<typeof vi.fn<[], Promise<TestTab[]>>>;
let sendMessage: ReturnType<typeof vi.fn<[unknown], Promise<ClipTask>>>;

const target = { type: 'page' as const, id: 'page-1', displayName: 'Team Docs' };
const pageUrl = 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=123';

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  storage.clear();
  queryTabs = vi.fn(async (): Promise<TestTab[]> => [{ id: 7, url: pageUrl }]);
  sendMessage = vi.fn();

  vi.stubGlobal('chrome', {
    tabs: {
      query: queryTabs
    },
    runtime: {
      sendMessage
    },
    scripting: {
      executeScript: vi.fn(async () => [])
    },
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
    },
    permissions: {
      contains: vi.fn(async () => true)
    }
  });
});

describe('popup save UI', () => {
  it('shows supported Confluence page status and selected Notion target', async () => {
    seedConfiguredPage();

    await mountPopupPage(getApp());
    await flushPromises();

    expect(getText('#popup-page-status')).toBe('Supported Confluence page detected.');
    expect(getText('#popup-target-status')).toBe('Target: Page — Team Docs');
    expect(getButton('#save-to-notion').disabled).toBe(false);
  });

  it('blocks save when no Notion target is selected', async () => {
    storage.set(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');

    await mountPopupPage(getApp());
    await flushPromises();

    expect(getText('#popup-target-status')).toBe('Target: None selected.');
    expect(getButton('#save-to-notion').disabled).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('starts a background ClipTask for the current tab without depending on popup lifetime', async () => {
    seedConfiguredPage();
    sendMessage.mockResolvedValueOnce(makeTask({ taskId: 'task-started', status: 'detecting' }));

    await mountPopupPage(getApp());
    await flushPromises();
    getButton('#save-to-notion').click();
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'clip.saveCurrentPage', pageUrl, tabId: 7 });
    expect(getText('#popup-task-progress')).toBe('Detecting Confluence page…');
  });

  it('shows an existing running ClipTask stage and duplicate save progress', async () => {
    seedConfiguredPage();
    storage.set(storageKeys.activeClipTaskLock, makeTask({ taskId: 'task-running', status: 'uploading_assets' }));
    sendMessage.mockResolvedValueOnce(makeTask({ taskId: 'task-running', status: 'uploading_assets' }));

    await mountPopupPage(getApp());
    await flushPromises();

    expect(getText('#popup-task-progress')).toBe('Uploading images to Notion…');

    getButton('#save-to-notion').click();
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(getText('#popup-task-progress')).toBe('Uploading images to Notion…');
  });

  it('does not request page identity for non-display URLs', async () => {
    seedConfiguredPage();
    const requestPageIdentity = vi.fn(async () => ({ domPageId: '24680' }));

    await mountPopupPage(getApp(), { requestPageIdentity });
    await flushPromises();

    expect(requestPageIdentity).not.toHaveBeenCalled();
    expect(getText('#popup-page-status')).toBe('Supported Confluence page detected.');
  });

  it('does not request page identity for display URLs outside the configured base URL', async () => {
    seedConfiguredPage();
    queryTabs.mockResolvedValueOnce([{ id: 7, url: 'https://other.example.com/wiki/display/ENG/Project+Plan' }]);
    const requestPageIdentity = vi.fn(async () => ({ domPageId: '24680' }));

    await mountPopupPage(getApp(), { requestPageIdentity });
    await flushPromises();

    expect(requestPageIdentity).not.toHaveBeenCalled();
    expect(getText('#popup-page-status')).toBe('Open a supported configured Confluence page to save.');
  });

  it('passes extracted display URL page identity to the background save request', async () => {
    seedConfiguredPage();
    const displayUrl = 'https://confluence.example.com/wiki/display/ENG/Project+Plan';
    queryTabs.mockResolvedValueOnce([{ id: 7, url: displayUrl }]);
    sendMessage.mockResolvedValueOnce(makeTask({ taskId: 'task-started', status: 'detecting' }));
    const requestPageIdentity = vi.fn(async () => ({ domPageId: '24680' }));

    await mountPopupPage(getApp(), { requestPageIdentity });
    await flushPromises();

    expect(getText('#popup-page-status')).toBe('Supported Confluence page detected.');
    getButton('#save-to-notion').click();
    await flushPromises();

    expect(requestPageIdentity).toHaveBeenCalledWith(7);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'clip.saveCurrentPage', pageUrl: displayUrl, tabId: 7, domPageId: '24680' });
  });

  it('shows unsupported guidance for display URLs when page identity is unavailable', async () => {
    seedConfiguredPage();
    queryTabs.mockResolvedValueOnce([{ id: 7, url: 'https://confluence.example.com/wiki/display/ENG/Project+Plan' }]);
    const requestPageIdentity = vi.fn(async () => ({}));

    await mountPopupPage(getApp(), { requestPageIdentity });
    await flushPromises();

    expect(getText('#popup-page-status')).toBe('Open a supported configured Confluence page to save.');
    expect(getButton('#save-to-notion').disabled).toBe(true);
  });

  it('shows terminal success summary and makes new-page creation clear', async () => {
    seedConfiguredPage();
    storage.set(storageKeys.lastTerminalClipTaskSummary, {
      taskId: 'task-done',
      status: 'succeeded',
      completedAt: '2026-05-18T20:50:00.000Z',
      sourceTitle: 'Roadmap',
      sourceUrl: pageUrl,
      target,
      notionPageUrl: 'https://notion.example/roadmap',
      warningCount: 2
    });

    await mountPopupPage(getApp());
    await flushPromises();

    expect(getText('#popup-result-summary')).toContain('Success: created a new Notion page.');
    expect(getText('#popup-result-summary')).toContain('Warnings: 2.');
    expect(getElement<HTMLAnchorElement>('#popup-result-summary a', HTMLAnchorElement).href).toBe('https://notion.example/roadmap');
  });

  it('shows terminal failure summary with warning count', async () => {
    seedConfiguredPage();
    storage.set(storageKeys.lastTerminalClipTaskSummary, {
      taskId: 'task-failed',
      status: 'failed',
      completedAt: '2026-05-18T20:50:00.000Z',
      sourceTitle: 'Roadmap',
      sourceUrl: pageUrl,
      target,
      warningCount: 1,
      failureReason: 'Confluence rejected the request.'
    });

    await mountPopupPage(getApp());
    await flushPromises();

    expect(getText('#popup-result-summary')).toContain('Failed: Confluence rejected the request.');
    expect(getText('#popup-result-summary')).toContain('Warnings: 1.');
  });
});

function seedConfiguredPage(): void {
  storage.set(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');
  storage.set(storageKeys.notionDefaultTarget, target);
}

function makeTask(overrides: Partial<ClipTask> = {}): ClipTask {
  return {
    taskId: 'task-1',
    status: 'detecting',
    progress: { stage: 'detecting' },
    warnings: [],
    startedAt: '2026-05-18T20:45:00.000Z',
    updatedAt: '2026-05-18T20:45:00.000Z',
    ...overrides
  };
}

function getApp(): HTMLElement {
  return getElement('#app', HTMLElement);
}

function getButton(selector: string): HTMLButtonElement {
  return getElement(selector, HTMLButtonElement);
}

function getText(selector: string): string {
  return getElement(selector, HTMLElement).textContent ?? '';
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function getElement<ElementType extends HTMLElement>(
  selector: string,
  elementType: typeof HTMLElement
): ElementType {
  const element = document.querySelector(selector);

  if (!(element instanceof elementType)) {
    throw new Error(`Missing test element: ${selector}`);
  }

  return element as ElementType;
}
