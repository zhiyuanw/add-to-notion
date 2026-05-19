import type { ConfluencePageRef } from '../shared/domain';
import { fetchWithTimeoutAndRetry, type RetriableFetchAttempt } from '../shared/request';

import { normalizeConfluenceBaseUrl } from './baseUrl';
import { hasConfluenceHostPermission } from './permissions';

export type ConfluenceDisplayPageIdResolver = (input: {
  normalizedBaseUrl: string;
  relativePath: string;
}) => Promise<string | undefined>;

export type ConfluencePageDetectionInput = {
  baseUrl: string;
  pageUrl: string;
  domPageId?: string;
  bootstrapPageId?: string;
  displayPageIdResolver?: ConfluenceDisplayPageIdResolver;
  fetcher?: RetriableFetchAttempt;
};

export type ConfluencePageDetectionFailureReason =
  | 'invalid-base-url'
  | 'invalid-page-url'
  | 'missing-host-permission'
  | 'outside-base-url'
  | 'unsupported-url'
  | 'missing-page-id';

export type ConfluencePageDetectionResult =
  | { ok: true; pageRef: ConfluencePageRef }
  | { ok: false; reason: ConfluencePageDetectionFailureReason };

export async function detectConfluencePage(input: ConfluencePageDetectionInput): Promise<ConfluencePageDetectionResult> {
  const baseUrl = normalizeConfluenceBaseUrl(input.baseUrl);

  if (!baseUrl.ok) {
    return { ok: false, reason: 'invalid-base-url' };
  }

  if (!(await hasConfluenceHostPermission(baseUrl.normalizedUrl))) {
    return { ok: false, reason: 'missing-host-permission' };
  }

  let pageUrl: URL;

  try {
    pageUrl = new URL(input.pageUrl);
  } catch {
    return { ok: false, reason: 'invalid-page-url' };
  }

  if (!isInsideBaseUrl(pageUrl, baseUrl.origin, baseUrl.contextPath)) {
    return { ok: false, reason: 'outside-base-url' };
  }

  const relativePath = getRelativePath(pageUrl.pathname, baseUrl.contextPath);
  const pageId = await detectPageId(relativePath, pageUrl, input, baseUrl.normalizedUrl);

  if (pageId === undefined) {
    return { ok: false, reason: 'unsupported-url' };
  }

  if (pageId === '') {
    return { ok: false, reason: 'missing-page-id' };
  }

  return {
    ok: true,
    pageRef: {
      baseUrl: baseUrl.normalizedUrl,
      pageId,
      pageUrl: pageUrl.href
    }
  };
}

function isInsideBaseUrl(pageUrl: URL, origin: string, contextPath: string): boolean {
  if (pageUrl.origin !== origin) {
    return false;
  }

  if (contextPath === '') {
    return true;
  }

  return pageUrl.pathname === contextPath || pageUrl.pathname.startsWith(`${contextPath}/`);
}

function getRelativePath(pathname: string, contextPath: string): string {
  if (contextPath === '') {
    return pathname;
  }

  const relativePath = pathname.slice(contextPath.length);
  return relativePath === '' ? '/' : relativePath;
}

async function detectPageId(
  relativePath: string,
  pageUrl: URL,
  input: ConfluencePageDetectionInput,
  normalizedBaseUrl: string
): Promise<string | undefined> {
  if (relativePath === '/pages/viewpage.action') {
    return pageUrl.searchParams.get('pageId') ?? '';
  }

  const modernPageMatch = /^\/spaces\/[^/]+\/pages\/(\d+)(?:\/.*)?$/u.exec(relativePath);
  if (modernPageMatch) {
    return modernPageMatch[1];
  }

  if (/^\/display\/[^/]+\/.+/u.test(relativePath)) {
    return input.domPageId ?? input.bootstrapPageId ?? await (input.displayPageIdResolver ?? resolveDisplayPageIdFromRest)({
      normalizedBaseUrl,
      relativePath,
      fetcher: input.fetcher
    });
  }

  return undefined;
}

type RestDisplayPageIdResolverInput = {
  normalizedBaseUrl: string;
  relativePath: string;
  fetcher?: RetriableFetchAttempt;
};

type RestContentSearchResponse = {
  results?: Array<{ id?: unknown }>;
};

async function resolveDisplayPageIdFromRest(input: RestDisplayPageIdResolverInput): Promise<string> {
  const displayPage = parseDisplayRelativePath(input.relativePath);
  if (!displayPage) {
    return '';
  }

  const restUrl = new URL(`${input.normalizedBaseUrl}/rest/api/content`);
  restUrl.searchParams.set('spaceKey', displayPage.spaceKey);
  restUrl.searchParams.set('title', displayPage.title);
  restUrl.searchParams.set('type', 'page');
  restUrl.searchParams.set('limit', '1');

  try {
    const response = await fetchWithTimeoutAndRetry(restUrl.href, {
      fetcher: input.fetcher,
      credentials: 'include'
    });

    if (!response.ok) {
      return '';
    }

    const payload = (await response.json()) as RestContentSearchResponse;
    const pageId = payload.results?.[0]?.id;
    return typeof pageId === 'string' ? pageId : '';
  } catch {
    return '';
  }
}

function parseDisplayRelativePath(relativePath: string): { spaceKey: string; title: string } | undefined {
  const match = /^\/display\/([^/]+)\/(.+)$/u.exec(relativePath);
  if (!match) {
    return undefined;
  }

  return {
    spaceKey: decodeDisplayPathSegment(match[1]),
    title: decodeDisplayPathSegment(match[2])
  };
}

function decodeDisplayPathSegment(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, ' '));
  } catch {
    return value.replace(/\+/gu, ' ');
  }
}
