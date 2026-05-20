import { describe, expect, it } from 'vitest';

import { extractConfluenceAssets } from '../assets';
import { parseConfluenceStorageXml } from '../confluence/storageParser';
import type { ConfluencePageData } from '../shared/domain';

function pageData(bodyStorageXml: string): ConfluencePageData {
  return {
    pageRef: {
      baseUrl: 'https://wiki.example.com/confluence',
      pageId: '123',
      pageUrl: 'https://wiki.example.com/confluence/display/ENG/Page'
    },
    title: 'Asset page',
    bodyStorageXml,
    metadata: {
      labels: []
    },
    attachments: []
  };
}

function parse(storageXml: string) {
  const result = parseConfluenceStorageXml(storageXml);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.document;
}

describe('extractConfluenceAssets', () => {
  it('extracts storage XML image assets and classifies same-origin URLs inside the configured path', () => {
    const result = extractConfluenceAssets(
      pageData(`<p><ac:image><ri:url ri:value="/confluence/download/attachments/123/screenshot.png" /></ac:image></p>`),
      parse(`<p><ac:image><ri:url ri:value="/confluence/download/attachments/123/screenshot.png" /></ac:image></p>`)
    );

    expect(result.assets).toMatchObject([
      {
        sourceUrl: 'https://wiki.example.com/confluence/download/attachments/123/screenshot.png',
        kind: 'image',
        status: 'pending',
        classification: 'same-origin',
        isInsideConfiguredBasePath: true,
        requiresConfluenceCredentials: true
      }
    ]);
  });

  it('allows same-origin storage XML assets outside the configured base path', () => {
    const result = extractConfluenceAssets(
      pageData(`<ac:image><ri:url ri:value="/download/attachments/123/outside.png" /></ac:image>`),
      parse(`<ac:image><ri:url ri:value="/download/attachments/123/outside.png" /></ac:image>`)
    );

    expect(result.assets[0]).toMatchObject({
      sourceUrl: 'https://wiki.example.com/download/attachments/123/outside.png',
      classification: 'same-origin',
      isInsideConfiguredBasePath: false,
      requiresConfluenceCredentials: true
    });
  });

  it('classifies cross-origin external image URLs without Confluence credentials', () => {
    const result = extractConfluenceAssets(
      pageData(`<ac:image><ri:url ri:value="https://cdn.example.net/image.png" /></ac:image>`),
      parse(`<ac:image><ri:url ri:value="https://cdn.example.net/image.png" /></ac:image>`)
    );

    expect(result.assets[0]).toMatchObject({
      sourceUrl: 'https://cdn.example.net/image.png',
      kind: 'image',
      classification: 'cross-origin',
      requiresConfluenceCredentials: false
    });
  });

  it('extracts attachment metadata assets and preserves filename, MIME type, and size', () => {
    const data = pageData('<p>No inline assets</p>');
    data.attachments = [
      {
        id: 'att-1',
        filename: 'diagram.pdf',
        mimeType: 'application/pdf',
        size: 1234,
        downloadUrl: 'https://wiki.example.com/download/attachments/123/diagram.pdf'
      }
    ];

    const result = extractConfluenceAssets(data, parse(data.bodyStorageXml));

    expect(result.assets).toMatchObject([
      {
        sourceUrl: 'https://wiki.example.com/download/attachments/123/diagram.pdf',
        filename: 'diagram.pdf',
        mimeType: 'application/pdf',
        size: 1234,
        kind: 'pdf',
        classification: 'same-origin',
        isInsideConfiguredBasePath: false,
        requiresConfluenceCredentials: true
      }
    ]);
  });

  it('extracts Draw.io rendered image candidate and optional source link', () => {
    const storageXml = `
      <ac:structured-macro ac:name="drawio">
        <ac:parameter ac:name="diagramName">Architecture</ac:parameter>
        <ac:parameter ac:name="contentId">456</ac:parameter>
        <ac:parameter ac:name="previewUrl">/confluence/plugins/servlet/drawio/render?diagram=Architecture</ac:parameter>
        <ac:parameter ac:name="filename">Architecture.drawio</ac:parameter>
        <ac:parameter ac:name="sourceUrl">/confluence/download/attachments/123/Architecture.drawio</ac:parameter>
      </ac:structured-macro>
    `;

    const result = extractConfluenceAssets(pageData(storageXml), parse(storageXml));

    expect(result.assets).toMatchObject([
      {
        sourceUrl: 'https://wiki.example.com/confluence/plugins/servlet/drawio/render?diagram=Architecture',
        filename: 'Architecture',
        kind: 'drawio',
        status: 'pending',
        classification: 'same-origin',
        drawioSourceUrl: 'https://wiki.example.com/confluence/download/attachments/123/Architecture.drawio'
      }
    ]);
  });
});
