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

type AjsMeta = {
  Meta?: {
    get?: (key: string) => unknown;
  };
};

let handlerRegistered = false;

declare global {
  interface Window {
    AJS?: AjsMeta;
  }
}

export function extractConfluencePageIdentity(doc: Document = document, win: Window = window): ConfluencePageIdentity {
  const domPageId = firstNonEmpty(
    doc.querySelector<HTMLMetaElement>('meta[name="ajs-page-id"]')?.content,
    doc.querySelector<HTMLElement>('[data-page-id]')?.dataset.pageId,
    doc.querySelector<HTMLInputElement>('input[name="pageId"]')?.value
  );

  if (domPageId) {
    return { domPageId };
  }

  const bootstrapPageId = firstNonEmpty(readAjsMeta(win, 'page-id'), readAjsMeta(win, 'content-id'));
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

function readAjsMeta(win: Window, key: string): string | undefined {
  const value = win.AJS?.Meta?.get?.(key);
  return typeof value === 'string' ? value : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  registerContentPageIdentityMessageHandler();
}
