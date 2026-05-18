import { recoverInterruptedClipTaskOnStartup } from './clipTaskRunner';

export * from './clipTaskRunner';
export * from './savePipeline';

const appName = 'Add to Notion';

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${appName} installed`);
});

void recoverInterruptedClipTaskOnStartup();
