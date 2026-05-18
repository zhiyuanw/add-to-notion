export type RetriableFetchAttempt = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface FetchWithTimeoutAndRetryOptions extends RequestInit {
  fetcher?: RetriableFetchAttempt;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  deadlineMs?: number;
}

const defaultTimeoutMs = 30_000;
const defaultMaxRetries = 2;
const defaultRetryDelayMs = 250;

export class RequestTimeoutError extends Error {
  constructor() {
    super('request-timeout');
    this.name = 'RequestTimeoutError';
  }
}

export class RequestDeadlineError extends Error {
  constructor() {
    super('request-deadline-exhausted');
    this.name = 'RequestDeadlineError';
  }
}

export async function fetchWithTimeoutAndRetry(
  input: RequestInfo | URL,
  options: FetchWithTimeoutAndRetryOptions = {}
): Promise<Response> {
  const { fetcher = fetch, timeoutMs = defaultTimeoutMs, maxRetries = defaultMaxRetries, retryDelayMs = defaultRetryDelayMs, deadlineMs, ...init } = options;
  let attempt = 0;

  while (true) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      throw new RequestDeadlineError();
    }

    try {
      const response = await fetchWithTimeout(fetcher, input, init, timeoutMs, deadlineMs);

      if (!isRetryableStatus(response.status)) {
        return response;
      }

      if (attempt >= maxRetries) {
        return response;
      }

      await delay(nextRetryDelayMs(response, retryDelayMs), deadlineMs);
      attempt += 1;
    } catch (error) {
      if (!isRetryableNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }

      await delay(retryDelayMs, deadlineMs);
      attempt += 1;
    }
  }
}

async function fetchWithTimeout(
  fetcher: RetriableFetchAttempt,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  deadlineMs: number | undefined
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new RequestTimeoutError()), effectiveTimeoutMs(timeoutMs, deadlineMs));

  try {
    return await fetcher(input, { ...init, signal: composeAbortSignal(init.signal, controller.signal) });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RequestTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function effectiveTimeoutMs(timeoutMs: number, deadlineMs: number | undefined): number {
  if (deadlineMs === undefined) {
    return timeoutMs;
  }

  return Math.max(0, Math.min(timeoutMs, deadlineMs - Date.now()));
}

function composeAbortSignal(existingSignal: AbortSignal | null | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!existingSignal) {
    return timeoutSignal;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  existingSignal.addEventListener('abort', abort, { once: true });
  timeoutSignal.addEventListener('abort', abort, { once: true });

  if (existingSignal.aborted || timeoutSignal.aborted) {
    abort();
  }

  return controller.signal;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof RequestTimeoutError || (error instanceof DOMException && error.name === 'AbortError');
}

function nextRetryDelayMs(response: Response, defaultDelayMs: number): number {
  if (response.status !== 429) {
    return defaultDelayMs;
  }

  const retryAfter = response.headers.get('Retry-After');

  if (!retryAfter) {
    return defaultDelayMs;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : defaultDelayMs;
}

async function delay(delayMs: number, deadlineMs: number | undefined): Promise<void> {
  if (deadlineMs !== undefined && Date.now() + delayMs > deadlineMs) {
    throw new RequestDeadlineError();
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
