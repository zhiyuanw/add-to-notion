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

  it('detects display URLs by resolving pageId from Confluence REST when metadata is unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      expect(url.href).toBe('https://confluence.example.com/wiki/rest/api/content?spaceKey=ENG&title=Project+Plan&type=page&limit=1');
      return new Response(JSON.stringify({ results: [{ id: '97531' }] }), { status: 200 });
    });

    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/display/ENG/Project+Plan',
        fetcher
      })
    ).resolves.toMatchObject({
      ok: true,
      pageRef: {
        baseUrl: 'https://confluence.example.com/wiki',
        pageId: '97531'
      }
    });
  });

  it('decodes display URL space and title before resolving pageId from Confluence REST', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      expect(url.searchParams.get('spaceKey')).toBe('SD PT');
      expect(url.searchParams.get('title')).toBe('Confluence upload-md fence sample');
      return new Response(JSON.stringify({ results: [{ id: '86420' }] }), { status: 200 });
    });

    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com',
        pageUrl: 'https://confluence.example.com/display/SD+PT/Confluence+upload-md+fence+sample',
        fetcher
      })
    ).resolves.toMatchObject({
      ok: true,
      pageRef: {
        pageId: '86420'
      }
    });
  });

  it('rejects display URLs when no metadata pageId is available and REST cannot resolve it', async () => {
    await expect(
      detectConfluencePage({
        baseUrl: 'https://confluence.example.com/wiki',
        pageUrl: 'https://confluence.example.com/wiki/display/ENG/Project+Plan',
        displayPageIdResolver: async () => ''
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
