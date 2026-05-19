import { beforeEach, describe, expect, it, vi } from 'vitest';

import manifest from '../../public/manifest.json';
import { extractConfluenceAssets, processConfluenceAssets, renderProcessedAssetsToNotionBlocks, type ExtractedConfluenceAsset } from '../assets';
import { recoverInterruptedClipTaskOnStartup, startBackgroundClipTask } from '../background/clipTaskRunner';
import { detectConfluencePage, fetchConfluencePageStorage, normalizeConfluenceBaseUrl, parseConfluenceStorageXml } from '../confluence';
import { convertConfluenceStorageToNotionBlocks, type NotionBlock } from '../converter';
import { createNotionPage, notionApiConfig, type NotionApiConfig, writeClippedNotionPage } from '../notion';
import type { ClipTask, ConfluencePageData, NotionTarget } from '../shared/domain';
import { clearNotionSessionState, readLocalStorageValue, storageKeys, writeLocalStorageValue, type NotionAuthState } from '../shared/storage';

import { releaseFixtureNames, releaseFixtures } from './fixtures';

const storage = new Map<string, unknown>();
const startedAt = '2026-05-18T21:10:00.000Z';
const now = new Date('2026-05-18T21:10:02.000Z');

const testConfig: NotionApiConfig = {
  ...notionApiConfig,
  notionVersion: '2022-06-28'
};

const authState: NotionAuthState = {
  accessToken: 'access-token',
  tokenType: 'bearer'
};

const pageData: ConfluencePageData = {
  pageRef: {
    baseUrl: 'https://wiki.example.com/confluence',
    pageId: '123',
    pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123'
  },
  title: 'Release Checklist',
  bodyStorageXml: releaseFixtures.simple.storageXml,
  metadata: {
    spaceKey: 'ENG',
    spaceName: 'Engineering',
    labels: ['release'],
    lastModified: '2026-05-17T10:00:00.000Z'
  },
  attachments: [
    {
      id: 'attachment-1',
      filename: 'diagram.png',
      mimeType: 'image/png',
      size: 1024,
      downloadUrl: 'https://wiki.example.com/download/attachments/123/diagram.png'
    }
  ]
};

function stubChrome(permissionGranted = true): void {
  vi.stubGlobal('chrome', {
    permissions: {
      contains: vi.fn(async () => permissionGranted)
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
          if (typeof keys === 'string') {
            return { [keys]: storage.get(keys) };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage.get(key)]));
          }
          if (keys && typeof keys === 'object') {
            return Object.fromEntries(Object.entries(keys).map(([key, defaultValue]) => [key, storage.has(key) ? storage.get(key) : defaultValue]));
          }
          return Object.fromEntries(storage.entries());
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value);
          }
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            storage.delete(key);
          }
        })
      }
    }
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function makeContext() {
  return {
    taskId: 'task-1',
    startedAt,
    deadlineMs: Date.parse(startedAt) + 300_000,
    updateStatus: vi.fn(async (status) => ({
      taskId: 'task-1',
      status,
      progress: { stage: status },
      warnings: [],
      startedAt,
      updatedAt: startedAt
    }))
  };
}

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

beforeEach(() => {
  storage.clear();
  stubChrome();
  vi.useRealTimers();
});

describe('V1 release checklist verification', () => {
  it('declares only runtime permissions plus the MV3 optional host candidate envelope needed for release', () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(['storage', 'notifications', 'tabs', 'activeTab', 'scripting']));
    expect(manifest.permissions).not.toContain('identity');
    expect(manifest.permissions).not.toContain('cookies');
    expect('host_permissions' in manifest).toBe(false);
    expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.optional_host_permissions).not.toContain('<all_urls>');
  });

  it('packages the content page identity bridge for on-demand configured-page injection', () => {
    expect(manifest.permissions).toContain('scripting');
    expect('content_scripts' in manifest).toBe(false);
  });

  it('ships sanitized fixtures named simple, macro-heavy, and image-heavy', () => {
    expect(releaseFixtureNames).toEqual(['simple', 'macro-heavy', 'image-heavy']);

    for (const fixture of Object.values(releaseFixtures)) {
      expect(fixture.name).toBeTruthy();
      expect(fixture.storageXml).not.toMatch(/<script|onclick=|<iframe/i);
      expect(parseConfluenceStorageXml(fixture.storageXml)).toMatchObject({ ok: true });
    }
  });

  it('covers the required release validation matrix through automated behavior checks', async () => {
    expect(normalizeConfluenceBaseUrl('https://wiki.example.com/confluence/')).toMatchObject({
      ok: true,
      normalizedUrl: 'https://wiki.example.com/confluence',
      contextPath: '/confluence'
    });
    expect(normalizeConfluenceBaseUrl('https://wiki.example.com/confluence?space=ENG')).toEqual({ ok: false, error: 'query-not-allowed' });

    await expect(
      detectConfluencePage({
        baseUrl: 'https://wiki.example.com/confluence',
        pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123'
      })
    ).resolves.toMatchObject({ ok: true, pageRef: { pageId: '123' } });
    await expect(
      detectConfluencePage({
        baseUrl: 'https://wiki.example.com/confluence',
        pageUrl: 'https://wiki.example.com/other/pages/viewpage.action?pageId=123'
      })
    ).resolves.toEqual({ ok: false, reason: 'outside-base-url' });
    stubChrome(false);
    await expect(
      detectConfluencePage({
        baseUrl: 'https://wiki.example.com/confluence',
        pageUrl: 'https://wiki.example.com/confluence/pages/viewpage.action?pageId=123'
      })
    ).resolves.toEqual({ ok: false, reason: 'missing-host-permission' });
    stubChrome(true);

    const fetcher = vi.fn(async () =>
      jsonResponse({
        title: 'Release Checklist',
        body: { storage: { value: releaseFixtures.simple.storageXml } },
        metadata: { labels: { results: [{ name: 'release' }] } },
        children: { attachment: { results: [] } }
      })
    );
    await expect(fetchConfluencePageStorage(pageData.pageRef, { fetcher })).resolves.toMatchObject({ ok: true });
    await expect(
      fetchConfluencePageStorage(
        { ...pageData.pageRef, pageUrl: 'https://wiki.example.com/other/pages/viewpage.action?pageId=123' },
        { fetcher }
      )
    ).resolves.toEqual({ ok: false, reason: 'outside-base-url' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://wiki.example.com/confluence/rest/api/content/123?expand=body.storage%2Cmetadata.labels%2Cversion%2Cspace%2Cchildren.attachment',
      expect.objectContaining({ credentials: 'include' })
    );

    const externalEntity = parseConfluenceStorageXml('<!DOCTYPE x [<!ENTITY ext SYSTEM "https://attacker.example/entity">]><p>&ext;</p>');
    expect(externalEntity).toMatchObject({ ok: true, degradations: [{ type: 'external-entity-blocked' }] });

    const simpleParsed = parseConfluenceStorageXml(releaseFixtures.simple.storageXml);
    const macroParsed = parseConfluenceStorageXml(releaseFixtures['macro-heavy'].storageXml);
    const imageParsed = parseConfluenceStorageXml(releaseFixtures['image-heavy'].storageXml);
    expect(simpleParsed.ok && macroParsed.ok && imageParsed.ok).toBe(true);
    if (!simpleParsed.ok || !macroParsed.ok || !imageParsed.ok) {
      return;
    }

    const simpleBlocks = convertConfluenceStorageToNotionBlocks(simpleParsed.document);
    expect(simpleBlocks.blocks.map((block) => block.type)).toEqual([
      'heading_1',
      'paragraph',
      'bulleted_list_item',
      'bulleted_list_item',
      'numbered_list_item',
      'table'
    ]);

    const macroBlocks = convertConfluenceStorageToNotionBlocks(macroParsed.document);
    expect(macroBlocks.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'code', code: expect.objectContaining({ language: 'mermaid' }) }),
        expect.objectContaining({ type: 'code', code: expect.objectContaining({ language: 'typescript' }) }),
        expect.objectContaining({ type: 'toggle' }),
        expect.objectContaining({ type: 'callout', callout: expect.objectContaining({ rich_text: [{ type: 'text', text: { content: 'Unsupported Confluence macro: custom-macro' }, annotations: {} }] }) })
      ])
    );

    const extractedAssets = extractConfluenceAssets({ ...pageData, bodyStorageXml: releaseFixtures['image-heavy'].storageXml }, imageParsed.document).assets;
    expect(extractedAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUrl: 'https://wiki.example.com/confluence/download/attachments/123/in-path.png', classification: 'same-origin', isInsideConfiguredBasePath: true }),
        expect.objectContaining({ sourceUrl: 'https://wiki.example.com/download/attachments/123/diagram.png', classification: 'same-origin', isInsideConfiguredBasePath: false }),
        expect.objectContaining({ sourceUrl: 'https://cdn.example.net/photo.png', classification: 'cross-origin', requiresConfluenceCredentials: false }),
        expect.objectContaining({ kind: 'drawio', drawioSourceUrl: 'https://wiki.example.com/download/attachments/123/Architecture.drawio' })
      ])
    );

    let activeUploads = 0;
    let maxActiveUploads = 0;
    const releaseUpload: Array<() => void> = [];
    const processing = processConfluenceAssets(
      Array.from({ length: 4 }, (_, index) => asset({ sourceUrl: `https://wiki.example.com/download/attachments/123/image-${index}.png`, filename: `image-${index}.png` })),
      {
        fetcher: vi.fn(async () => new Response(new Blob(['x'], { type: 'image/png' }), { status: 200 })),
        createFileUpload: vi.fn(async () => ({ id: crypto.randomUUID(), uploadUrl: 'https://upload.notion.test/file' })),
        uploadFileContents: vi.fn(async () => {
          activeUploads += 1;
          maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
          await new Promise<void>((resolve) => releaseUpload.push(resolve));
          activeUploads -= 1;
        }),
        completeFileUpload: vi.fn(async (fileUploadId: string) => ({ fileUploadId, expiresAt: '2026-05-18T22:00:00.000Z' })),
        now: () => now
      }
    );
    await vi.waitUntil(() => releaseUpload.length === 3);
    expect(maxActiveUploads).toBe(3);
    releaseUpload.splice(0, 3).forEach((release) => release());
    await vi.waitUntil(() => releaseUpload.length === 1);
    releaseUpload.splice(0, 1).forEach((release) => release());
    await expect(processing).resolves.toMatchObject({ assets: expect.arrayContaining([expect.objectContaining({ status: 'uploaded' })]) });

    const assetFallbacks = await processConfluenceAssets([
      asset({ sourceUrl: 'https://wiki.example.com/download/attachments/123/large.pdf', filename: 'large.pdf', kind: 'pdf', size: 20 * 1024 * 1024 + 1 }),
      asset({ sourceUrl: 'https://wiki.example.com/download/attachments/123/broken.png', filename: 'broken.png' })
    ], { fetcher: vi.fn(async () => new Response('missing', { status: 404 })) });
    expect(assetFallbacks.assets).toEqual([
      expect.objectContaining({ status: 'skipped', degradation: expect.objectContaining({ type: 'asset-too-large' }) }),
      expect.objectContaining({ status: 'failed', degradation: expect.objectContaining({ type: 'asset-download-failed' }) })
    ]);

    const renderedAssets = renderProcessedAssetsToNotionBlocks([
      {
        ...asset({ sourceUrl: 'https://cdn.example.net/photo.png', filename: 'photo.png', classification: 'cross-origin', requiresConfluenceCredentials: false }),
        status: 'skipped',
        notionFileRef: { externalUrl: 'https://cdn.example.net/photo.png', filename: 'photo.png' },
        degradation: { type: 'asset-cross-origin', source: 'https://cdn.example.net/photo.png', message: 'cross-origin', severity: 'warning' }
      },
      {
        ...asset({ sourceUrl: 'https://wiki.example.com/download/attachments/123/broken.png', filename: 'broken.png' }),
        status: 'failed',
        notionFileRef: { externalUrl: 'https://wiki.example.com/download/attachments/123/broken.png', filename: 'broken.png' },
        degradation: { type: 'asset-upload-failed', source: 'broken.png', message: 'failed', severity: 'warning' }
      }
    ]);
    expect(renderedAssets.blocks).toMatchObject([{ type: 'image' }, { type: 'paragraph' }]);
    expect(JSON.stringify(renderedAssets.blocks)).not.toContain('callout');

    await writeLocalStorageValue(storageKeys.notionAuthState, authState);
    const pageTarget: NotionTarget = { type: 'page', id: 'parent-page-1', displayName: 'Team Home' };
    const databaseTarget: NotionTarget = { type: 'database', id: 'database-1', displayName: 'Docs', titlePropertyName: 'Name' };
    const pageCreateFetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: 'page-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'page-1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'page-2' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'database-page-1' }));
    await expect(createNotionPage({ target: pageTarget, title: pageData.title, blocks: [] }, { config: testConfig, fetcher: pageCreateFetcher, now: () => now })).resolves.toMatchObject({ pageId: 'page-1' });
    await expect(createNotionPage({ target: pageTarget, title: pageData.title, blocks: [] }, { config: testConfig, fetcher: pageCreateFetcher, now: () => now })).resolves.toMatchObject({ pageId: 'page-2' });
    await expect(createNotionPage({ target: databaseTarget, title: pageData.title, blocks: [] }, { config: testConfig, fetcher: pageCreateFetcher, now: () => now })).resolves.toMatchObject({ pageId: 'database-page-1' });
    expect(pageCreateFetcher.mock.calls.map((call) => call[0])).toEqual(['https://api.notion.com/v1/pages', 'https://api.notion.com/v1/pages', 'https://api.notion.com/v1/pages']);

    const manyBlocks = Array.from({ length: 205 }, (_, index): NotionBlock => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: `Block ${index}` }, annotations: {} }] }
    }));
    const writeFetcher = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ id: 'written-page-1', url: 'https://notion.so/written-page-1' }))
      .mockResolvedValue(jsonResponse({ object: 'list' }));
    await expect(
      writeClippedNotionPage({ target: pageTarget, pageData, contentBlocks: manyBlocks }, { config: testConfig, fetcher: writeFetcher, now: () => now })
    ).resolves.toMatchObject({ appendedBlockCount: 206 });
    expect(writeFetcher.mock.calls.slice(1).map((call) => JSON.parse(String(call[1]?.body)).children.length)).toEqual([100, 100, 6]);

    await writeLocalStorageValue(storageKeys.confluenceBaseUrl, pageData.pageRef.baseUrl);
    await writeLocalStorageValue(storageKeys.notionDefaultTarget, pageTarget);
    await writeLocalStorageValue(storageKeys.lastTerminalClipTaskSummary, { taskId: 'old-summary', status: 'succeeded', warningCount: 0, completedAt: startedAt });
    await clearNotionSessionState();
    await expect(readLocalStorageValue(storageKeys.confluenceBaseUrl)).resolves.toBe(pageData.pageRef.baseUrl);
    await expect(readLocalStorageValue(storageKeys.lastTerminalClipTaskSummary)).resolves.toBeUndefined();

    const runningTask: ClipTask = { taskId: 'task-running', status: 'fetching', progress: { stage: 'fetching' }, warnings: [], startedAt, updatedAt: startedAt };
    await writeLocalStorageValue(storageKeys.activeClipTaskLock, runningTask);
    const duplicate = await startBackgroundClipTask({ now: () => startedAt, createTaskId: () => 'task-new', operation: vi.fn() });
    expect(duplicate).toEqual(runningTask);

    const interruptedTask: ClipTask = { ...runningTask, taskId: 'task-interrupted', status: 'writing' };
    await writeLocalStorageValue(storageKeys.activeClipTaskLock, interruptedTask);
    const recovered = await recoverInterruptedClipTaskOnStartup({ now: () => startedAt });
    expect(recovered).toMatchObject({ status: 'failed', failure: { code: 'service-worker-restarted' } });
  });
});
