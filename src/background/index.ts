const appName = 'Add to Notion';

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${appName} installed`);
});
