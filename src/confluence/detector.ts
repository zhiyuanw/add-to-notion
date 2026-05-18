import type { ConfluencePageRef } from '../shared/domain';

import { normalizeConfluenceBaseUrl } from './baseUrl';
import { hasConfluenceHostPermission } from './permissions';

export type ConfluencePageDetectionInput = {
  baseUrl: string;
  pageUrl: string;
  domPageId?: string;
  bootstrapPageId?: string;
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
  const pageId = detectPageId(relativePath, pageUrl, input);

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

function detectPageId(relativePath: string, pageUrl: URL, input: ConfluencePageDetectionInput): string | undefined {
  if (relativePath === '/pages/viewpage.action') {
    return pageUrl.searchParams.get('pageId') ?? '';
  }

  const modernPageMatch = /^\/spaces\/[^/]+\/pages\/(\d+)(?:\/.*)?$/u.exec(relativePath);
  if (modernPageMatch) {
    return modernPageMatch[1];
  }

  if (/^\/display\/[^/]+\/.+/u.test(relativePath)) {
    return input.domPageId ?? input.bootstrapPageId ?? '';
  }

  return undefined;
}
