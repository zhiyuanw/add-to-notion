import { describe, expect, it } from 'vitest';

import { normalizeConfluenceBaseUrl } from '../confluence';

const acceptedCases = [
  {
    name: 'https origin-only URL',
    input: 'https://confluence.example.com',
    normalizedUrl: 'https://confluence.example.com',
    origin: 'https://confluence.example.com',
    contextPath: ''
  },
  {
    name: 'http origin-only URL',
    input: 'http://confluence.example.com',
    normalizedUrl: 'http://confluence.example.com',
    origin: 'http://confluence.example.com',
    contextPath: ''
  },
  {
    name: 'URL with context path',
    input: 'https://confluence.example.com/wiki',
    normalizedUrl: 'https://confluence.example.com/wiki',
    origin: 'https://confluence.example.com',
    contextPath: '/wiki'
  },
  {
    name: 'URL with trailing slash',
    input: 'https://confluence.example.com/wiki/',
    normalizedUrl: 'https://confluence.example.com/wiki',
    origin: 'https://confluence.example.com',
    contextPath: '/wiki'
  },
  {
    name: 'origin-only URL with trailing slash',
    input: 'https://confluence.example.com/',
    normalizedUrl: 'https://confluence.example.com',
    origin: 'https://confluence.example.com',
    contextPath: ''
  }
] as const;

describe('Confluence base URL normalization', () => {
  it.each(acceptedCases)('accepts $name', ({ input, normalizedUrl, origin, contextPath }) => {
    expect(normalizeConfluenceBaseUrl(input)).toEqual({
      ok: true,
      normalizedUrl,
      origin,
      contextPath
    });
  });

  it('trims surrounding whitespace before normalization', () => {
    expect(normalizeConfluenceBaseUrl('  https://confluence.example.com/wiki/  ')).toEqual({
      ok: true,
      normalizedUrl: 'https://confluence.example.com/wiki',
      origin: 'https://confluence.example.com',
      contextPath: '/wiki'
    });
  });

  it('rejects query strings', () => {
    expect(normalizeConfluenceBaseUrl('https://confluence.example.com/wiki?space=ENG')).toEqual({
      ok: false,
      error: 'query-not-allowed'
    });
  });

  it('rejects fragments', () => {
    expect(normalizeConfluenceBaseUrl('https://confluence.example.com/wiki#top')).toEqual({
      ok: false,
      error: 'fragment-not-allowed'
    });
  });

  it('rejects credentials', () => {
    expect(normalizeConfluenceBaseUrl('https://user:pass@confluence.example.com/wiki')).toEqual({
      ok: false,
      error: 'credentials-not-allowed'
    });
  });

  it('rejects unsupported schemes', () => {
    expect(normalizeConfluenceBaseUrl('ftp://confluence.example.com/wiki')).toEqual({
      ok: false,
      error: 'unsupported-scheme'
    });
  });

  it('rejects non-URLs', () => {
    expect(normalizeConfluenceBaseUrl('confluence.example.com/wiki')).toEqual({
      ok: false,
      error: 'invalid-url'
    });
  });
});
