// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mountConfluenceOptions } from '../options/index';
import { storageKeys } from '../shared/storage';

const storage = new Map<string, unknown>();
let requestPermission: ReturnType<typeof vi.fn<[], Promise<boolean>>>;
let containsPermission: ReturnType<typeof vi.fn<[], Promise<boolean>>>;

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  storage.clear();
  requestPermission = vi.fn(async (): Promise<boolean> => true);
  containsPermission = vi.fn(async (): Promise<boolean> => true);

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value);
          }
        }),
        remove: vi.fn()
      }
    },
    permissions: {
      request: requestPermission,
      contains: containsPermission
    }
  });
});

describe('Confluence options UI', () => {
  it('renders saved normalized URL and granted host permission status', async () => {
    storage.set(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');

    await mountConfluenceOptions(getApp());

    expect(getInput().value).toBe('https://confluence.example.com/wiki');
    expect(getText('#saved-confluence-base-url')).toBe('https://confluence.example.com/wiki');
    expect(getText('#confluence-permission-status')).toBe('Granted');
    expect(containsPermission).toHaveBeenCalledWith({ origins: ['https://confluence.example.com/*'] });
  });

  it('shows validation message and does not persist invalid URL', async () => {
    await mountConfluenceOptions(getApp());

    getInput().value = 'https://confluence.example.com/wiki?space=ENG';
    submitForm();
    await flushPromises();

    expect(getText('#confluence-base-url-error')).toBe('Remove query parameters from the Confluence URL.');
    expect(getText('#saved-confluence-base-url')).toBe('Not configured');
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });

  it('saves valid URL, displays normalized value, and requests host permission', async () => {
    await mountConfluenceOptions(getApp());

    getInput().value = 'https://confluence.example.com/wiki/';
    submitForm();
    await flushPromises();

    expect(storage.get(storageKeys.confluenceBaseUrl)).toBe('https://confluence.example.com/wiki');
    expect(getInput().value).toBe('https://confluence.example.com/wiki');
    expect(getText('#saved-confluence-base-url')).toBe('https://confluence.example.com/wiki');
    expect(getText('#confluence-permission-status')).toBe('Granted');
    expect(getText('#confluence-settings-status')).toBe('Confluence URL saved and host permission granted.');
    expect(requestPermission).toHaveBeenCalledWith({ origins: ['https://confluence.example.com/*'] });
  });

  it('shows missing host permission when permission is not granted', async () => {
    requestPermission.mockResolvedValue(false);

    await mountConfluenceOptions(getApp());

    getInput().value = 'https://confluence.example.com/wiki';
    submitForm();
    await flushPromises();

    expect(getText('#confluence-permission-status')).toBe('Missing');
    expect(getText('#confluence-settings-status')).toBe('Confluence URL saved. Grant host permission before saving pages.');
  });

  it('grants permission for the saved URL from the explicit action', async () => {
    storage.set(storageKeys.confluenceBaseUrl, 'https://confluence.example.com/wiki');
    containsPermission.mockResolvedValue(false);

    await mountConfluenceOptions(getApp());

    getButton('#grant-confluence-permission').click();
    await flushPromises();

    expect(getText('#confluence-permission-status')).toBe('Granted');
    expect(getText('#confluence-settings-status')).toBe('Host permission granted.');
    expect(requestPermission).toHaveBeenCalledWith({ origins: ['https://confluence.example.com/*'] });
  });
});

function getApp(): HTMLElement {
  return getElement('#app', HTMLElement);
}

function getInput(): HTMLInputElement {
  return getElement('#confluence-base-url', HTMLInputElement);
}

function getButton(selector: string): HTMLButtonElement {
  return getElement(selector, HTMLButtonElement);
}

function getText(selector: string): string {
  return getElement(selector, HTMLElement).textContent ?? '';
}

function submitForm(): void {
  getElement('#confluence-base-url-form', HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true }));
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
