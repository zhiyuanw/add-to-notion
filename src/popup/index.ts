import { detectConfluencePage } from '../confluence';
import type { ConfluencePageIdentity } from '../content/pageIdentity';
import type { ClipTask, ClipTaskStatus, NotionTarget, TerminalClipTaskSummary } from '../shared/domain';
import { isTerminalClipTaskStatus } from '../shared/domain';
import { readConfluenceBaseUrl, readLocalStorageValue, storageKeys } from '../shared/storage';

export interface PopupPageOptions {
  queryCurrentTab?: () => Promise<PopupTab | undefined>;
  requestPageIdentity?: (tabId: number) => Promise<ConfluencePageIdentity>;
  sendSaveMessage?: (message: SaveCurrentPageMessage) => Promise<ClipTask>;
}

interface PopupState {
  currentTab?: PopupTab;
  currentPageSupported: boolean;
  pageIdentity: ConfluencePageIdentity;
  target?: NotionTarget;
  activeTask?: ClipTask;
  lastSummary?: TerminalClipTaskSummary;
}

interface PopupTab {
  id?: number;
  url?: string;
}

interface SaveCurrentPageMessage {
  type: 'clip.saveCurrentPage';
  pageUrl: string;
  tabId?: number;
  domPageId?: string;
  bootstrapPageId?: string;
}

const runningStageLabels: Record<ClipTaskStatus, string> = {
  idle: 'Idle.',
  detecting: 'Detecting Confluence page…',
  fetching: 'Fetching Confluence storage…',
  parsing: 'Parsing Confluence storage…',
  converting: 'Converting content to Notion…',
  uploading_assets: 'Uploading images to Notion…',
  writing: 'Writing Notion page…',
  succeeded: 'Save succeeded.',
  failed: 'Save failed.',
  cancelled: 'Save cancelled.'
};

export async function mountPopupPage(root: HTMLElement, options: PopupPageOptions = {}): Promise<void> {
  const state: PopupState = {
    currentPageSupported: false,
    pageIdentity: {}
  };
  render(root, state, options);

  state.currentTab = await (options.queryCurrentTab ?? queryCurrentTab)();
  const [baseUrl, target, activeTask, lastSummary] = await Promise.all([
    readConfluenceBaseUrl(),
    readLocalStorageValue(storageKeys.notionDefaultTarget),
    readLocalStorageValue(storageKeys.activeClipTaskLock),
    readLocalStorageValue(storageKeys.lastTerminalClipTaskSummary)
  ]);

  state.target = target;
  state.activeTask = activeTask && !isTerminalClipTaskStatus(activeTask.status) ? activeTask : undefined;
  state.lastSummary = lastSummary;
  state.pageIdentity = await loadPageIdentity(baseUrl, state.currentTab, options);
  state.currentPageSupported = await isSupportedCurrentPage(baseUrl, state.currentTab?.url, state.pageIdentity);
  render(root, state, options);
}

async function queryCurrentTab(): Promise<PopupTab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadPageIdentity(baseUrl: string | undefined, tab: PopupTab | undefined, options: PopupPageOptions): Promise<ConfluencePageIdentity> {
  if (!baseUrl || !tab?.url || tab.id === undefined || !isDisplayUrlInsideBaseUrl(baseUrl, tab.url)) {
    return {};
  }

  return (options.requestPageIdentity ?? requestPageIdentity)(tab.id);
}

async function isSupportedCurrentPage(baseUrl: string | undefined, pageUrl: string | undefined, pageIdentity: ConfluencePageIdentity): Promise<boolean> {
  if (!baseUrl || !pageUrl) {
    return false;
  }

  const result = await detectConfluencePage({ baseUrl, pageUrl, ...pageIdentity });
  return result.ok;
}

async function requestPageIdentity(tabId: number): Promise<ConfluencePageIdentity> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/pageIdentity.js'] });
    const response = await chrome.tabs.sendMessage(tabId, { type: 'confluence.extractPageIdentity' });
    return isPageIdentityResponse(response) ? response : {};
  } catch {
    return {};
  }
}

function isPageIdentityResponse(response: unknown): response is ConfluencePageIdentity & { type: 'confluence.pageIdentity' } {
  return Boolean(
    response &&
      typeof response === 'object' &&
      'type' in response &&
      response.type === 'confluence.pageIdentity'
  );
}

function isDisplayUrlInsideBaseUrl(baseUrl: string, pageUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const page = new URL(pageUrl);
    const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/u, '');

    if (base.origin !== page.origin || !page.pathname.startsWith(`${basePath}/display/`)) {
      return false;
    }

    return /^\/display\/[^/]+\/.+/u.test(page.pathname.slice(basePath.length));
  } catch {
    return false;
  }
}

function render(root: HTMLElement, state: PopupState, options: PopupPageOptions): void {
  root.replaceChildren();

  const title = document.createElement('h1');
  title.textContent = 'Add to Notion';

  const pageStatus = document.createElement('p');
  pageStatus.id = 'popup-page-status';
  pageStatus.textContent = state.currentPageSupported ? 'Supported Confluence page detected.' : 'Open a supported configured Confluence page to save.';

  const targetStatus = document.createElement('p');
  targetStatus.id = 'popup-target-status';
  targetStatus.textContent = state.target ? `Target: ${formatTarget(state.target)}` : 'Target: None selected.';

  const saveButton = document.createElement('button');
  saveButton.id = 'save-to-notion';
  saveButton.type = 'button';
  saveButton.textContent = 'Save to Notion';
  saveButton.disabled = !state.currentPageSupported || !state.target || !state.currentTab?.url;
  saveButton.addEventListener('click', () => {
    void startSave(root, state, options);
  });

  const progress = document.createElement('p');
  progress.id = 'popup-task-progress';
  progress.textContent = state.activeTask ? runningStageLabels[state.activeTask.status] : 'No save running.';

  const resultSummary = document.createElement('p');
  resultSummary.id = 'popup-result-summary';
  renderResultSummary(resultSummary, state.lastSummary);

  root.append(title, pageStatus, targetStatus, saveButton, progress, resultSummary);
}

async function startSave(root: HTMLElement, state: PopupState, options: PopupPageOptions): Promise<void> {
  if (!state.currentTab?.url) {
    return;
  }

  state.activeTask = {
    taskId: 'pending',
    status: 'detecting',
    progress: { stage: 'detecting', message: 'Starting save' },
    warnings: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  render(root, state, options);
  const progress = root.querySelector('#popup-task-progress');
  if (progress) {
    progress.textContent = 'Starting save…';
  }

  const message: SaveCurrentPageMessage = {
    type: 'clip.saveCurrentPage',
    pageUrl: state.currentTab.url,
    tabId: state.currentTab.id,
    ...state.pageIdentity
  };

  const task = await (options.sendSaveMessage ?? sendSaveMessage)(message);
  state.activeTask = task;
  render(root, state, options);
}

async function sendSaveMessage(message: SaveCurrentPageMessage): Promise<ClipTask> {
  return chrome.runtime.sendMessage(message);
}

function renderResultSummary(element: HTMLElement, summary: TerminalClipTaskSummary | undefined): void {
  element.replaceChildren();

  if (!summary) {
    element.textContent = 'No recent save result.';
    return;
  }

  const prefix = summary.status === 'succeeded' ? 'Success: created a new Notion page.' : `Failed: ${summary.failureReason ?? 'Save failed.'}`;
  element.append(document.createTextNode(`${prefix} Warnings: ${summary.warningCount}.`));

  if (summary.notionPageUrl) {
    element.append(document.createTextNode(' '));
    const link = document.createElement('a');
    link.href = summary.notionPageUrl;
    link.textContent = 'Open Notion page';
    element.append(link);
  }
}

function formatTarget(target: NotionTarget): string {
  return `${target.type === 'database' ? 'Database' : 'Page'} — ${target.displayName}`;
}

const defaultRoot = document.querySelector('#app');
if (defaultRoot instanceof HTMLElement) {
  void mountPopupPage(defaultRoot);
}
