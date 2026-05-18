import { recoverInterruptedClipTaskOnStartup, startBackgroundClipTask } from './clipTaskRunner';
import { createSaveConfluencePageOperation } from './savePipeline';

export * from './clipTaskRunner';
export * from './savePipeline';

const appName = 'Add to Notion';

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${appName} installed`);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isSaveCurrentPageMessage(message)) {
    return false;
  }

  void startBackgroundClipTask({
    operation: createSaveConfluencePageOperation({ pageUrl: message.pageUrl })
  }).then(sendResponse);

  return true;
});

void recoverInterruptedClipTaskOnStartup();

function isSaveCurrentPageMessage(message: unknown): message is { type: 'clip.saveCurrentPage'; pageUrl: string; tabId?: number } {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'clip.saveCurrentPage' &&
      'pageUrl' in message &&
      typeof message.pageUrl === 'string'
  );
}
