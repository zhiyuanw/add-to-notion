export type ConfluencePageIdentity = {
  domPageId?: string;
  bootstrapPageId?: string;
};

export type ConfluencePageIdentityRequestMessage = {
  type: 'confluence.extractPageIdentity';
};

export type ConfluencePageIdentityResponseMessage = ConfluencePageIdentity & {
  type: 'confluence.pageIdentity';
};

type RuntimeLike = {
  onMessage: {
    addListener: (listener: (message: unknown, sender: unknown, sendResponse: (response: ConfluencePageIdentityResponseMessage) => void) => boolean | void) => void;
  };
};

let handlerRegistered = false;

export function extractConfluencePageIdentity(doc: Document = document): ConfluencePageIdentity {
  const domPageId = firstNonEmpty(
    doc.querySelector<HTMLMetaElement>('meta[name="ajs-page-id"]')?.content,
    doc.querySelector<HTMLMetaElement>('meta[name="ajs-content-id"]')?.content,
    doc.querySelector<HTMLElement>('[data-page-id]')?.dataset.pageId,
    doc.querySelector<HTMLElement>('[data-content-id]')?.dataset.contentId,
    doc.querySelector<HTMLInputElement>('input[name="pageId"]')?.value,
    doc.querySelector<HTMLInputElement>('input[name="contentId"]')?.value
  );

  if (domPageId) {
    return { domPageId };
  }

  const bootstrapPageId = findBootstrapPageId(doc);
  return bootstrapPageId ? { bootstrapPageId } : {};
}

export function registerContentPageIdentityMessageHandler(runtime: RuntimeLike = chrome.runtime): void {
  if (handlerRegistered) {
    return;
  }

  handlerRegistered = true;
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isPageIdentityRequest(message)) {
      return false;
    }

    sendResponse({ type: 'confluence.pageIdentity', ...extractConfluencePageIdentity() });
    return false;
  });
}

export function resetContentPageIdentityMessageHandlerForTests(): void {
  handlerRegistered = false;
}

function isPageIdentityRequest(message: unknown): message is ConfluencePageIdentityRequestMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'confluence.extractPageIdentity'
  );
}

function findBootstrapPageId(doc: Document): string | undefined {
  for (const script of Array.from(doc.scripts)) {
    const pageId = extractBootstrapPageIdFromScript(script.textContent ?? '');

    if (pageId) {
      return pageId;
    }
  }

  return undefined;
}

function extractBootstrapPageIdFromScript(source: string): string | undefined {
  return firstNonEmpty(
    extractAjsMetaSetCall(source, 'page-id'),
    extractAjsMetaSetCall(source, 'content-id'),
    extractAjsMetaAssignment(source, 'page-id'),
    extractAjsMetaAssignment(source, 'content-id'),
    extractAjsParamsAssignment(source, 'pageId'),
    extractAjsParamsAssignment(source, 'contentId')
  );
}

function extractAjsMetaAssignment(source: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(String.raw`["']${escapedKey}["']\s*:\s*["'](\d+)["']`, 'u');
  return pattern.exec(source)?.[1];
}

function extractAjsMetaSetCall(source: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(String.raw`AJS\.Meta\.set\(\s*["']${escapedKey}["']\s*,\s*["'](\d+)["']`, 'u');
  return pattern.exec(source)?.[1];
}

function extractAjsParamsAssignment(source: string, key: string): string | undefined {
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(String.raw`ajs\.params\.${escapedKey}\s*=\s*["'](\d+)["']`, 'u');
  return pattern.exec(source)?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  registerContentPageIdentityMessageHandler();
}
