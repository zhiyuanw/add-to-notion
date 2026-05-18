import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectConfluencePage } from '../confluence';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async () => true)
    }
  });
});

describe('Confluence page detection', () => {
  it('detects viewpage URLs and extracts pageId', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
      })
    ).resolves.toEqual({
      ok: true,
      pageRef: {
        baseUrl: 'https://confluence.example.com/wiki',
        pageId: '12345',
        pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
      }
    });
  });

  it('detects modern space page URLs and extracts pageId', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/spaces/ENG/pages/67890/Project+Plan'
      })
    ).resolves.toMatchObject({
      ok: true,
      pageRef: {
        baseUrl: 'https://confluence.example.com/wiki',
        pageId: '67890'
      }
    });
  });

  it('detects display URLs using DOM metadata pageId', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/display/ENG/Project+Plan',
        domPageId: '24680'
      })
    ).resolves.toMatchObject({
      ok: true,
      pageRef: {
        baseUrl: 'https://confluence.example.com/wiki',
        pageId: '24680'
      }
    });
  });

  it('detects display URLs using bootstrap pageId when DOM metadata is unavailable', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/display/ENG/Project+Plan',
        bootstrapPageId: '13579'
      })
    ).resolves.toMatchObject({
      ok: true,
      pageRef: {
        baseUrl: 'https://confluence.example.com/wiki',
        pageId: '13579'
      }
    });
  });

  it('rejects display URLs when no metadata pageId is available', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/display/ENG/Project+Plan'
      })
    ).resolves.toEqual({ ok: false, reason: 'missing-page-id' });
  });

  it('rejects URLs outside the normalized base URL path on the same origin', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/pages/viewpage.action?pageId=12345'
      })
    ).resolves.toEqual({ ok: false, reason: 'outside-base-url' });
  });

  it('rejects URLs outside the configured origin', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://docs.example.com/wiki/pages/viewpage.action?pageId=12345'
      })
    ).resolves.toEqual({ ok: false, reason: 'outside-base-url' });
  });

  it('rejects detection when host permission is missing', async () => {
    (chrome.permissions.contains as unknown as { mockResolvedValue: (value: boolean) => void }).mockResolvedValue(false);

    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
      })
    ).resolves.toEqual({ ok: false, reason: 'missing-host-permission' });
  });

  it('rejects unsupported Confluence URL forms', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/spaces/ENG/overview'
      })
    ).resolves.toEqual({ ok: false, reason: 'unsupported-url' });
  });
});
