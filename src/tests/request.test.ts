import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithTimeoutAndRetry } from '../shared/request';

function response(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers });
}

describe('request timeout and retry wrapper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts each request after the default 30 second timeout', async () => {
    vi.useFakeTimers();

    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    );

    const request = fetchWithTimeoutAndRetry('https://example.com/api', { fetcher });
    const expectation = expect(request).rejects.toThrow('request-timeout');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(attempt);

      if (attempt < 3) {
        await vi.advanceTimersByTimeAsync(250);
      }
    }

    await expectation;
  });

  it('retries network errors, 408, 429, and 5xx at most two times', async () => {
    vi.useFakeTimers();

    const retryableStatuses = [408, 429, 500, 503];

    for (const status of retryableStatuses) {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(200));

      const request = fetchWithTimeoutAndRetry(`https://example.com/${status}`, { fetcher, retryDelayMs: 10 });
      await vi.runAllTimersAsync();
      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(fetcher).toHaveBeenCalledTimes(3);
    }

    const networkFetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(200));

    const networkRequest = fetchWithTimeoutAndRetry('https://example.com/network', { fetcher: networkFetcher, retryDelayMs: 10 });
    await vi.runAllTimersAsync();
    await expect(networkRequest).resolves.toMatchObject({ status: 200 });
    expect(networkFetcher).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable 400, 401, 403, and 404 responses by default', async () => {
    for (const status of [400, 401, 403, 404]) {
      const fetcher = vi.fn(async () => response(status));

      await expect(fetchWithTimeoutAndRetry(`https://example.com/${status}`, { fetcher })).resolves.toMatchObject({ status });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it('uses Notion 429 retry hints when available', async () => {
    vi.useFakeTimers();

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(response(200));

    const request = fetchWithTimeoutAndRetry('https://api.notion.com/v1/pages', { fetcher, retryDelayMs: 10 });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('stops retrying when the caller-provided overall deadline is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T00:00:00.000Z'));

    const fetcher = vi.fn(async () => response(503));
    const request = fetchWithTimeoutAndRetry('https://example.com/api', {
      fetcher,
      retryDelayMs: 1_000,
      deadlineMs: Date.now() + 500
    });

    await expect(request).rejects.toThrow('request-deadline-exhausted');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
