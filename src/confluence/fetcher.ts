import type { ConfluenceAttachment, ConfluencePageData, ConfluencePageRef } from '../shared/domain';
import type { DebugLogger } from '../shared/debugLogger';
import { fetchWithTimeoutAndRetry, type RetriableFetchAttempt } from '../shared/request';

import { normalizeConfluenceBaseUrl } from './baseUrl';

export type ConfluenceStorageFetchFailureReason =
  | 'invalid-base-url'
  | 'outside-base-url'
  | 'auth-or-permission'
  | 'missing-or-inaccessible'
  | 'temporary-confluence-failure'
  | 'invalid-response';

export type ConfluenceStorageFetchResult =
  | { ok: true; pageData: ConfluencePageData }
  | { ok: false; reason: ConfluenceStorageFetchFailureReason };

export type ConfluenceStorageFetcherOptions = {
  fetcher?: RetriableFetchAttempt;
  deadlineMs?: number;
  debugLogger?: DebugLogger;
};

type ConfluenceRestPage = {
  title?: unknown;
  body?: {
    storage?: {
      value?: unknown;
    };
  };
  metadata?: {
    labels?: {
      results?: Array<{ name?: unknown }>;
    };
  };
  version?: {
    number?: unknown;
    when?: unknown;
  };
  space?: {
    key?: unknown;
    name?: unknown;
  };
  children?: {
    attachment?: {
      results?: ConfluenceRestAttachment[];
    };
  };
};

type ConfluenceRestAttachment = {
  id?: unknown;
  title?: unknown;
  metadata?: {
    mediaType?: unknown;
  };
  extensions?: {
    fileSize?: unknown;
  };
  _links?: {
    download?: unknown;
  };
};

const confluenceStorageExpand = 'body.storage,metadata.labels,version,space,children.attachment';

export async function fetchConfluencePageStorage(
  pageRef: ConfluencePageRef,
  options: ConfluenceStorageFetcherOptions = {}
): Promise<ConfluenceStorageFetchResult> {
  const baseUrl = normalizeConfluenceBaseUrl(pageRef.baseUrl);

  if (!baseUrl.ok) {
    return { ok: false, reason: 'invalid-base-url' };
  }

  const restUrl = buildRestContentUrl(baseUrl.normalizedUrl, pageRef.pageId);

  if (!isPageRefInsideBaseUrl(pageRef, baseUrl.origin, baseUrl.contextPath) || !isInsideBaseUrl(restUrl, baseUrl.origin, baseUrl.contextPath)) {
    return { ok: false, reason: 'outside-base-url' };
  }

  let response: Response;

  try {
    response = await fetchWithTimeoutAndRetry(restUrl.href, {
      fetcher: options.fetcher,
      credentials: 'include',
      deadlineMs: options.deadlineMs
    });
    options.debugLogger?.confluenceFetchStatus({ status: response.status, url: restUrl.href });
  } catch {
    return { ok: false, reason: 'temporary-confluence-failure' };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'auth-or-permission' };
  }

  if (response.status === 404) {
    return { ok: false, reason: 'missing-or-inaccessible' };
  }

  if (response.status >= 500) {
    return { ok: false, reason: 'temporary-confluence-failure' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'invalid-response' };
  }

  let payload: ConfluenceRestPage;

  try {
    payload = (await response.json()) as ConfluenceRestPage;
  } catch {
    return { ok: false, reason: 'invalid-response' };
  }

  if (typeof payload.title !== 'string' || typeof payload.body?.storage?.value !== 'string') {
    return { ok: false, reason: 'invalid-response' };
  }

  return {
    ok: true,
    pageData: {
      pageRef: {
        baseUrl: baseUrl.normalizedUrl,
        pageId: pageRef.pageId,
        pageUrl: pageRef.pageUrl
      },
      title: payload.title,
      bodyStorageXml: payload.body.storage.value,
      metadata: {
        labels: extractLabels(payload),
        versionNumber: typeof payload.version?.number === 'number' ? payload.version.number : undefined,
        lastModified: typeof payload.version?.when === 'string' ? payload.version.when : undefined,
        spaceKey: typeof payload.space?.key === 'string' ? payload.space.key : undefined,
        spaceName: typeof payload.space?.name === 'string' ? payload.space.name : undefined
      },
      attachments: extractAttachments(payload, baseUrl.normalizedUrl)
    }
  };
}

function buildRestContentUrl(normalizedBaseUrl: string, pageId: string): URL {
  const restUrl = new URL(`${normalizedBaseUrl}/rest/api/content/${encodeURIComponent(pageId)}`);
  restUrl.searchParams.set('expand', confluenceStorageExpand);
  return restUrl;
}

function isPageRefInsideBaseUrl(pageRef: ConfluencePageRef, origin: string, contextPath: string): boolean {
  try {
    return isInsideBaseUrl(new URL(pageRef.pageUrl), origin, contextPath);
  } catch {
    return false;
  }
}

function isInsideBaseUrl(url: URL, origin: string, contextPath: string): boolean {
  if (url.origin !== origin) {
    return false;
  }

  if (contextPath === '') {
    return true;
  }

  return url.pathname === contextPath || url.pathname.startsWith(`${contextPath}/`);
}

function extractLabels(payload: ConfluenceRestPage): string[] {
  return (payload.metadata?.labels?.results ?? [])
    .map((label) => label.name)
    .filter((name): name is string => typeof name === 'string');
}

function extractAttachments(payload: ConfluenceRestPage, normalizedBaseUrl: string): ConfluenceAttachment[] {
  return (payload.children?.attachment?.results ?? [])
    .map((attachment) => toConfluenceAttachment(attachment, normalizedBaseUrl))
    .filter((attachment): attachment is ConfluenceAttachment => attachment !== undefined);
}

function toConfluenceAttachment(attachment: ConfluenceRestAttachment, normalizedBaseUrl: string): ConfluenceAttachment | undefined {
  if (typeof attachment.id !== 'string' || typeof attachment.title !== 'string') {
    return undefined;
  }

  return {
    id: attachment.id,
    filename: attachment.title,
    mimeType: typeof attachment.metadata?.mediaType === 'string' ? attachment.metadata.mediaType : undefined,
    size: typeof attachment.extensions?.fileSize === 'number' ? attachment.extensions.fileSize : undefined,
    downloadUrl: typeof attachment._links?.download === 'string' ? new URL(attachment._links.download, normalizedBaseUrl).href : undefined
  };
}
