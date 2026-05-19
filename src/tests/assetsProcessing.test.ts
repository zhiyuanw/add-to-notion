import { describe, expect, it, vi } from 'vitest';

import { processConfluenceAssets, type ExtractedConfluenceAsset } from '../assets';

function asset(overrides: Partial<ExtractedConfluenceAsset> = {}): ExtractedConfluenceAsset {
  return {
    sourceUrl: 'https://wiki.example.com/download/attachments/123/image.png',
    filename: 'image.png',
    mimeType: 'image/png',
    size: 1024,
    kind: 'image',
    status: 'pending',
    classification: 'same-origin',
    isInsideConfiguredBasePath: false,
    requiresConfluenceCredentials: true,
    ...overrides
  };
}

describe('processConfluenceAssets', () => {
  it('downloads same-origin Confluence assets with credentials include and uploads them to Notion', async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(['image-bytes'], { type: 'image/png' }), { status: 200 }));
    const createFileUpload = vi.fn(async () => ({ id: 'upload-1', uploadUrl: 'https://upload.notion.test/file' }));
    const uploadFileContents = vi.fn(async () => undefined);
    const completeFileUpload = vi.fn(async () => ({ fileUploadId: 'upload-1', expiresAt: '2026-05-18T19:00:00.000Z' }));

    const result = await processConfluenceAssets([asset()], {
      fetcher,
      createFileUpload,
      uploadFileContents,
      completeFileUpload,
      now: () => new Date('2026-05-18T18:00:00.000Z')
    });

    expect(fetcher).toHaveBeenCalledWith('https://wiki.example.com/download/attachments/123/image.png', {
      credentials: 'include',
      signal: expect.any(AbortSignal)
    });
    expect(createFileUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'image.png', mimeType: 'image/png', contentLength: 11 }),
      expect.any(Object)
    );
    expect(uploadFileContents).toHaveBeenCalledWith(
      'https://upload.notion.test/file',
      expect.any(Blob),
      expect.objectContaining({ filename: 'image.png', mimeType: 'image/png' }),
      expect.any(Object)
    );
    expect(result.assets[0]).toMatchObject({
      status: 'uploaded',
      notionFileRef: {
        fileUploadId: 'upload-1',
        filename: 'image.png',
            }
    });
    expect(result.degradations).toEqual([]);
  });

  it('limits Notion uploads to concurrency 3', async () => {
    let activeUploads = 0;
    let maxActiveUploads = 0;
    const releaseUpload: Array<() => void> = [];
    const uploadStarted: Promise<void>[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(new Blob(['x'], { type: 'image/png' }), { status: 200 }));
    const createFileUpload = vi.fn(async (_metadata) => ({ id: crypto.randomUUID(), uploadUrl: 'https://upload.notion.test/file' }));
    const uploadFileContents = vi.fn(async () => {
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      uploadStarted.push(Promise.resolve());
      await new Promise<void>((resolve) => releaseUpload.push(resolve));
      activeUploads -= 1;
    });
    const completeFileUpload = vi.fn(async (fileUploadId: string) => ({ fileUploadId, expiresAt: '2026-05-18T19:00:00.000Z' }));

    const processing = processConfluenceAssets(
      Array.from({ length: 5 }, (_, index) =>
        asset({ sourceUrl: `https://wiki.example.com/download/attachments/123/image-${index}.png`, filename: `image-${index}.png` })
      ),
      {
        fetcher,
        createFileUpload,
        uploadFileContents,
        completeFileUpload,
        now: () => new Date('2026-05-18T18:00:00.000Z')
      }
    );

    await vi.waitUntil(() => uploadFileContents.mock.calls.length === 3);
    expect(maxActiveUploads).toBe(3);
    expect(uploadFileContents).toHaveBeenCalledTimes(3);
    releaseUpload.splice(0, 3).forEach((release) => release());
    await vi.waitUntil(() => uploadFileContents.mock.calls.length === 5);
    releaseUpload.splice(0, 2).forEach((release) => release());

    await expect(processing).resolves.toMatchObject({
      assets: expect.arrayContaining([expect.objectContaining({ status: 'uploaded' })])
    });
    expect(maxActiveUploads).toBe(3);
  });

  it('skips files larger than 20 MB and preserves the source link with a warning', async () => {
    const fetcher = vi.fn();
    const createFileUpload = vi.fn();

    const result = await processConfluenceAssets(
      [asset({ size: 20 * 1024 * 1024 + 1, kind: 'pdf', filename: 'large.pdf', mimeType: 'application/pdf' })],
      { fetcher, createFileUpload }
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(createFileUpload).not.toHaveBeenCalled();
    expect(result.assets[0]).toMatchObject({
      status: 'skipped',
      notionFileRef: { externalUrl: 'https://wiki.example.com/download/attachments/123/image.png', filename: 'large.pdf' },
      degradation: expect.objectContaining({ type: 'asset-too-large', severity: 'warning' })
    });
    expect(result.degradations).toHaveLength(1);
  });

  it('never downloads cross-origin assets with Confluence credentials', async () => {
    const fetcher = vi.fn();
    const createFileUpload = vi.fn();

    const result = await processConfluenceAssets(
      [
        asset({
          sourceUrl: 'https://cdn.example.net/image.png',
          classification: 'cross-origin',
          requiresConfluenceCredentials: false
        })
      ],
      { fetcher, createFileUpload }
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(createFileUpload).not.toHaveBeenCalled();
    expect(result.assets[0]).toMatchObject({
      status: 'skipped',
      notionFileRef: { externalUrl: 'https://cdn.example.net/image.png' },
      degradation: expect.objectContaining({ type: 'asset-cross-origin' })
    });
  });

  it('preserves source links with warnings on download and upload failures', async () => {
    const failedDownload = await processConfluenceAssets([asset()], {
      fetcher: vi.fn(async () => new Response('missing', { status: 404 }))
    });

    expect(failedDownload.assets[0]).toMatchObject({
      status: 'failed',
      notionFileRef: { externalUrl: 'https://wiki.example.com/download/attachments/123/image.png' },
      degradation: expect.objectContaining({ type: 'asset-download-failed' })
    });

    const failedUpload = await processConfluenceAssets([asset()], {
      fetcher: vi.fn(async () => new Response(new Blob(['image-bytes'], { type: 'image/png' }), { status: 200 })),
      createFileUpload: vi.fn(async () => ({ id: 'upload-1', uploadUrl: 'https://upload.notion.test/file' })),
      uploadFileContents: vi.fn(async () => {
        throw new Error('upload failed');
      })
    });

    expect(failedUpload.assets[0]).toMatchObject({
      status: 'failed',
      notionFileRef: { externalUrl: 'https://wiki.example.com/download/attachments/123/image.png' },
      degradation: expect.objectContaining({ type: 'asset-upload-failed' })
    });
  });

  it('keeps completed file upload refs for final attach-time expiry validation', async () => {
    const result = await processConfluenceAssets([asset()], {
      fetcher: vi.fn(async () => new Response(new Blob(['image-bytes'], { type: 'image/png' }), { status: 200 })),
      createFileUpload: vi.fn(async () => ({ id: 'upload-1', uploadUrl: 'https://upload.notion.test/file' })),
      uploadFileContents: vi.fn(async () => undefined),
      completeFileUpload: vi.fn(async () => ({ fileUploadId: 'upload-1', expiresAt: '2026-05-18T18:00:00.000Z' })),
      now: () => new Date('2026-05-18T18:00:00.000Z')
    });

    expect(result).toMatchObject({
      assets: [expect.objectContaining({ status: 'uploaded', notionFileRef: expect.objectContaining({ fileUploadId: 'upload-1', expiresAt: '2026-05-18T18:00:00.000Z' }) })],
      degradations: []
    });
  });
});
