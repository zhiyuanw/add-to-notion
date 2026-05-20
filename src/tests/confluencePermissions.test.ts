import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getConfluenceHostPermission,
  hasConfluenceHostPermission,
  requestConfluenceHostPermission
} from '../confluence';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    permissions: {
      request: vi.fn(async () => true),
      contains: vi.fn(async () => true)
    }
  });
});

describe('Confluence host permissions', () => {
  it('builds origin-scoped permission for an origin-only base URL', () => {
    expect(getConfluenceHostPermission('https://confluence.example.com')).toEqual({
      origins: ['https://confluence.example.com/*']
    });
  });

  it('builds origin-scoped permission for a base URL with context path', () => {
    expect(getConfluenceHostPermission('https://confluence.example.com/wiki')).toEqual({
      origins: ['https://confluence.example.com/*']
    });
  });

  it('requests only the normalized base URL origin permission', async () => {
    await expect(requestConfluenceHostPermission('https://confluence.example.com/wiki')).resolves.toBe(true);

    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://confluence.example.com/*']
    });
  });

  it('requests a new origin permission when the base URL changes', async () => {
    await requestConfluenceHostPermission('https://confluence.example.com/wiki');
    await requestConfluenceHostPermission('https://docs.example.com/confluence');

    expect(chrome.permissions.request).toHaveBeenNthCalledWith(1, {
      origins: ['https://confluence.example.com/*']
    });
    expect(chrome.permissions.request).toHaveBeenNthCalledWith(2, {
      origins: ['https://docs.example.com/*']
    });
    expect(chrome.permissions).not.toHaveProperty('remove');
  });

  it('checks whether the current origin permission exists', async () => {
    await expect(hasConfluenceHostPermission('https://confluence.example.com/wiki')).resolves.toBe(true);

    expect(chrome.permissions.contains).toHaveBeenCalledWith({
      origins: ['https://confluence.example.com/*']
    });
  });

  it('rejects unsafe base URLs before touching chrome.permissions', async () => {
    await expect(requestConfluenceHostPermission('https://confluence.example.com/wiki?space=ENG')).rejects.toThrow(
      'query-not-allowed'
    );
    await expect(hasConfluenceHostPermission('ftp://confluence.example.com/wiki')).rejects.toThrow('unsupported-scheme');

    expect(chrome.permissions.request).not.toHaveBeenCalled();
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
  });
});
