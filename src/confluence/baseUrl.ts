export type ConfluenceBaseUrlValidationError =
  | 'missing-url'
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'credentials-not-allowed'
  | 'query-not-allowed'
  | 'fragment-not-allowed';

export type ConfluenceBaseUrlValidationResult =
  | { ok: true; normalizedUrl: string; origin: string; contextPath: string }
  | { ok: false; error: ConfluenceBaseUrlValidationError };

export function normalizeConfluenceBaseUrl(input: string): ConfluenceBaseUrlValidationResult {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    return { ok: false, error: 'missing-url' };
  }

  let url: URL;

  try {
    url = new URL(trimmedInput);
  } catch {
    return { ok: false, error: 'invalid-url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'unsupported-scheme' };
  }

  if (url.username || url.password) {
    return { ok: false, error: 'credentials-not-allowed' };
  }

  if (url.search) {
    return { ok: false, error: 'query-not-allowed' };
  }

  if (url.hash) {
    return { ok: false, error: 'fragment-not-allowed' };
  }

  const contextPath = normalizeContextPath(url.pathname);
  const normalizedUrl = `${url.origin}${contextPath}`;

  return {
    ok: true,
    normalizedUrl,
    origin: url.origin,
    contextPath
  };
}

function normalizeContextPath(pathname: string): string {
  const normalizedPathname = pathname.replace(/\/+$/u, '');
  return normalizedPathname === '' ? '' : normalizedPathname;
}
