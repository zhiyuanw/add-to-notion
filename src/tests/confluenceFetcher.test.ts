import { describe, expect, it, vi } from 'vitest';

import { fetchConfluencePageStorage } from '../confluence';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('Confluence storage fetcher', () => {
  it('fetches storage data through the Confluence REST API with browser session credentials', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: '12345',
        title: 'Project Plan',
        body: {
          storage: {
            value: '<p>Hello</p>'
          }
        },
        metadata: {
          labels: {
            results: [{ name: 'planning' }, { name: 'engineering' }]
          }
        },
        version: {
          number: 7,
          when: '2026-05-01T12:00:00.000Z'
        },
        space: {
          key: 'ENG',
          name: 'Engineering'
        },
        children: {
          attachment: {
            results: [
              {
                id: 'att-1',
                title: 'diagram.png',
                metadata: {
                  mediaType: 'image/png'
                },
                extensions: {
                  fileSize: 1024
                },
                _links: {
                  download: '/wiki/download/attachments/12345/diagram.png'
                }
              }
            ]
          }
        }
      })
    );

    await expect(
      fetchConfluencePageStorage(
        {
          baseUrl: 'https://confluence.example.com/wiki',
          pageId: '12345',
          pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
        },
        { fetcher }
      )
    ).resolves.toEqual({
      ok: true,
      pageData: {
        pageRef: {
          baseUrl: 'https://confluence.example.com/wiki',
          pageId: '12345',
          pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
        },
        title: 'Project Plan',
        bodyStorageXml: '<p>Hello</p>',
        metadata: {
          labels: ['planning', 'engineering'],
          lastModified: '2026-05-01T12:00:00.000Z',
          spaceKey: 'ENG',
          spaceName: 'Engineering',
          versionNumber: 7
        },
        attachments: [
          {
            id: 'att-1',
            filename: 'diagram.png',
            mimeType: 'image/png',
            size: 1024,
            downloadUrl: 'https://confluence.example.com/wiki/download/attachments/12345/diagram.png'
          }
        ]
      }
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://confluence.example.com/wiki/rest/api/content/12345?expand=body.storage%2Cmetadata.labels%2Cversion%2Cspace%2Cchildren.attachment',
      { credentials: 'include' }
    );
  });

  it('enforces the normalized base URL path for REST fetches', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}));

    await expect(
      fetchConfluencePageStorage(
        {
          baseUrl: 'https://confluence.example.com/wiki/../admin',
          pageId: '12345',
          pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
        },
        { fetcher }
      )
    ).resolves.toEqual({ ok: false, reason: 'outside-base-url' });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps 401 and 403 responses to authentication or permission failures', async () => {
    await expect(
      fetchConfluencePageStorage(
        {
          baseUrl: 'https://confluence.example.com/wiki',
          pageId: '12345',
          pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
        },
        { fetcher: vi.fn(async () => jsonResponse({ message: 'Forbidden' }, 403)) }
      )
    ).resolves.toEqual({ ok: false, reason: 'auth-or-permission' });
  });

  it('maps 404 responses to page missing or inaccessible failures', async () => {
    await expect(
      fetchConfluencePageStorage(
        {
          baseUrl: 'https://confluence.example.com/wiki',
          pageId: '12345',
          pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
        },
        { fetcher: vi.fn(async () => jsonResponse({ message: 'Not found' }, 404)) }
      )
    ).resolves.toEqual({ ok: false, reason: 'missing-or-inaccessible' });
  });

  it('maps 5xx and network errors to temporary Confluence failures', async () => {
    const pageRef = {
      baseUrl: 'https://confluence.example.com/wiki',
      pageId: '12345',
      pageUrl: 'https://confluence.example.com/wiki/pages/viewpage.action?pageId=12345'
    };

    await expect(
      fetchConfluencePageStorage(pageRef, { fetcher: vi.fn(async () => jsonResponse({ message: 'Unavailable' }, 503)) })
    ).resolves.toEqual({ ok: false, reason: 'temporary-confluence-failure' });

    await expect(
      fetchConfluencePageStorage(pageRef, { fetcher: vi.fn(async () => Promise.reject(new Error('offline'))) })
    ).resolves.toEqual({ ok: false, reason: 'temporary-confluence-failure' });
  });
});
