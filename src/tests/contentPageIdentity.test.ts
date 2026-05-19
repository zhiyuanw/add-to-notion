// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extractConfluencePageIdentity, registerContentPageIdentityMessageHandler, resetContentPageIdentityMessageHandlerForTests } from '../content/pageIdentity';

describe('content-side Confluence page identity extraction', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    Reflect.deleteProperty(window, 'AJS');
    resetContentPageIdentityMessageHandlerForTests();
  });

  it('extracts page ID from Confluence DOM metadata', () => {
    document.head.innerHTML = '<meta name="ajs-page-id" content="24680" />';

    expect(extractConfluencePageIdentity()).toEqual({ domPageId: '24680' });
  });

  it('extracts page ID from Confluence bootstrap data when DOM metadata is unavailable', () => {
    Object.assign(window, {
      AJS: {
        Meta: {
          get: vi.fn((key: string) => (key === 'page-id' ? '13579' : undefined))
        }
      }
    });

    expect(extractConfluencePageIdentity()).toEqual({ bootstrapPageId: '13579' });
  });

  it('returns no page ID when display-page metadata is absent', () => {
    expect(extractConfluencePageIdentity()).toEqual({});
  });

  it('responds to identity requests without exposing secrets', () => {
    document.head.innerHTML = '<meta name="ajs-page-id" content="24680" />';
    const addListener = vi.fn();
    registerContentPageIdentityMessageHandler({ onMessage: { addListener } });
    const listener = addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();

    expect(typeof listener).toBe('function');
    listener({ type: 'confluence.extractPageIdentity' }, {}, sendResponse);

    const response = sendResponse.mock.calls[0][0];
    expect(response).toEqual({ type: 'confluence.pageIdentity', domPageId: '24680' });
    expect(JSON.stringify(response)).not.toMatch(/accessToken|refreshToken|authorization|bearer|cookie/i);
  });

  it('registers the message handler once for repeated on-demand injection', () => {
    const addListener = vi.fn();
    const runtime = { onMessage: { addListener } };

    registerContentPageIdentityMessageHandler(runtime);
    registerContentPageIdentityMessageHandler(runtime);

    expect(addListener).toHaveBeenCalledOnce();
  });
});
