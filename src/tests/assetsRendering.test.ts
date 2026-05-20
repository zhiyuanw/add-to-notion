import { describe, expect, it } from 'vitest';

import { renderProcessedAssetsToNotionBlocks, type ProcessedConfluenceAsset } from '../assets';

function asset(overrides: Partial<ProcessedConfluenceAsset> = {}): ProcessedConfluenceAsset {
  return {
    sourceUrl: 'https://wiki.example.com/download/attachments/123/image.png',
    filename: 'image.png',
    mimeType: 'image/png',
    size: 1024,
    kind: 'image',
    status: 'uploaded',
    classification: 'same-origin',
    isInsideConfiguredBasePath: false,
    requiresConfluenceCredentials: true,
    notionFileRef: {
      fileUploadId: 'upload-1',
      filename: 'image.png'
    },
    ...overrides
  };
}

describe('renderProcessedAssetsToNotionBlocks', () => {
  it('replaces uploaded assets with Notion-compatible file upload block references', () => {
    const result = renderProcessedAssetsToNotionBlocks([
      asset({ kind: 'image' }),
      asset({ kind: 'file', filename: 'archive.zip', notionFileRef: { fileUploadId: 'upload-file', filename: 'archive.zip' } }),
      asset({ kind: 'video', filename: 'demo.mp4', notionFileRef: { fileUploadId: 'upload-video', filename: 'demo.mp4' } }),
      asset({ kind: 'audio', filename: 'voice.mp3', notionFileRef: { fileUploadId: 'upload-audio', filename: 'voice.mp3' } }),
      asset({ kind: 'pdf', filename: 'guide.pdf', notionFileRef: { fileUploadId: 'upload-pdf', filename: 'guide.pdf' } })
    ]);

    expect(result.blocks).toMatchObject([
      { type: 'image', image: { type: 'file_upload', file_upload: { id: 'upload-1' } } },
      { type: 'file', file: { type: 'file_upload', file_upload: { id: 'upload-file' } } },
      { type: 'video', video: { type: 'file_upload', file_upload: { id: 'upload-video' } } },
      { type: 'audio', audio: { type: 'file_upload', file_upload: { id: 'upload-audio' } } },
      { type: 'pdf', pdf: { type: 'file_upload', file_upload: { id: 'upload-pdf' } } }
    ]);
    expect(result.warningCount).toBe(0);
  });

  it('renders directly usable cross-origin images as Notion external image blocks without warning callouts', () => {
    const result = renderProcessedAssetsToNotionBlocks([
      asset({
        sourceUrl: 'https://cdn.example.net/photo.png',
        classification: 'cross-origin',
        requiresConfluenceCredentials: false,
        status: 'skipped',
        notionFileRef: { externalUrl: 'https://cdn.example.net/photo.png', filename: 'photo.png' }
      })
    ]);

    expect(result.blocks).toMatchObject([
      { type: 'image', image: { type: 'external', external: { url: 'https://cdn.example.net/photo.png' } } }
    ]);
    expect(result.warningCount).toBe(1);
    expect(JSON.stringify(result.blocks)).not.toContain('callout');
  });

  it('renders unusable cross-origin images as ordinary link text', () => {
    const result = renderProcessedAssetsToNotionBlocks([
      asset({
        sourceUrl: 'https://cdn.example.net/image.svg',
        filename: 'image.svg',
        classification: 'cross-origin',
        requiresConfluenceCredentials: false,
        status: 'skipped',
        notionFileRef: { externalUrl: 'https://cdn.example.net/image.svg', filename: 'image.svg' }
      })
    ]);

    expect(result.blocks).toMatchObject([
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: 'image.svg', link: { url: 'https://cdn.example.net/image.svg' } } }
          ]
        }
      }
    ]);
    expect(result.warningCount).toBe(1);
  });

  it('does not render failed Confluence-hosted images as Notion external images pointing at internal URLs', () => {
    const result = renderProcessedAssetsToNotionBlocks([
      asset({
        status: 'failed',
        notionFileRef: { externalUrl: 'https://wiki.example.com/download/attachments/123/image.png', filename: 'image.png' },
        degradation: { type: 'asset-upload-failed', source: 'https://wiki.example.com/download/attachments/123/image.png', message: 'failed', severity: 'warning' }
      })
    ]);

    expect(result.blocks).toMatchObject([
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: 'image.png', link: { url: 'https://wiki.example.com/download/attachments/123/image.png' } } }
          ]
        }
      }
    ]);
    expect(JSON.stringify(result.blocks)).not.toContain('external');
    expect(JSON.stringify(result.blocks)).not.toContain('callout');
    expect(result.warningCount).toBe(1);
  });

  it('validates completed file upload expiry at final render attach-time boundaries', () => {
    function renderWithExpiry(expiresAt?: string) {
      return renderProcessedAssetsToNotionBlocks(
        [asset({ notionFileRef: { fileUploadId: 'upload-1', filename: 'image.png', ...(expiresAt ? { expiresAt } : {}) } })],
        { now: () => new Date('2026-05-18T18:00:00.000Z') }
      );
    }

    expect(renderWithExpiry()).toMatchObject({
      blocks: [{ type: 'image', image: { type: 'file_upload', file_upload: { id: 'upload-1' } } }],
      degradations: [],
      attachTimeDegradations: []
    });
    expect(renderWithExpiry('2026-05-18T18:00:00.001Z')).toMatchObject({
      blocks: [{ type: 'image', image: { type: 'file_upload', file_upload: { id: 'upload-1' } } }],
      degradations: [],
      attachTimeDegradations: []
    });

    const expired = renderWithExpiry('2026-05-18T17:59:59.999Z');
    expect(expired.blocks).toMatchObject([
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'image.png', link: { url: 'https://wiki.example.com/download/attachments/123/image.png' } } }]
        }
      }
    ]);
    expect(expired.degradations).toEqual([expect.objectContaining({ type: 'asset-attach-window-expired', severity: 'warning' })]);
    expect(expired.attachTimeDegradations).toEqual([expect.objectContaining({ type: 'asset-attach-window-expired', severity: 'warning' })]);

    const equalityAtNow = renderWithExpiry('2026-05-18T18:00:00.000Z');
    expect(equalityAtNow.blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(equalityAtNow.degradations).toEqual([expect.objectContaining({ type: 'asset-attach-window-expired', severity: 'warning' })]);
  });

  it('renders Draw.io with rendered image when available and preserves its source link', () => {
    const result = renderProcessedAssetsToNotionBlocks([
      asset({
        kind: 'drawio',
        filename: 'Architecture',
        drawioSourceUrl: 'https://wiki.example.com/download/attachments/123/Architecture.drawio',
        notionFileRef: { fileUploadId: 'upload-drawio', filename: 'Architecture.png' }
      })
    ]);

    expect(result.blocks).toMatchObject([
      { type: 'image', image: { type: 'file_upload', file_upload: { id: 'upload-drawio' } } },
      {
        type: 'paragraph',
        paragraph: {
          rich_text: [
            { type: 'text', text: { content: 'Draw.io source: Architecture', link: { url: 'https://wiki.example.com/download/attachments/123/Architecture.drawio' } } }
          ]
        }
      }
    ]);
  });

  it('renders more than one image batch without adding per-image error callouts', () => {
    const result = renderProcessedAssetsToNotionBlocks(
      Array.from({ length: 4 }, (_, index) =>
        asset({
          sourceUrl: `https://wiki.example.com/download/attachments/123/broken-${index}.png`,
          filename: `broken-${index}.png`,
          status: 'failed',
          notionFileRef: { externalUrl: `https://wiki.example.com/download/attachments/123/broken-${index}.png`, filename: `broken-${index}.png` },
          degradation: { type: 'asset-upload-failed', source: `broken-${index}.png`, message: 'failed', severity: 'warning' }
        })
      )
    );

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks.every((block) => block.type === 'paragraph')).toBe(true);
    expect(JSON.stringify(result.blocks)).not.toContain('callout');
    expect(result.warningCount).toBe(4);
  });
});
