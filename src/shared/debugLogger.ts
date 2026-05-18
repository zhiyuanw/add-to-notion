export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugLogEntry {
  timestamp: string;
  level: DebugLogLevel;
  event: string;
  details?: unknown;
}

export interface DebugLogger {
  debug: (event: string, details?: unknown) => void;
  info: (event: string, details?: unknown) => void;
  warn: (event: string, details?: unknown) => void;
  error: (event: string, details?: unknown) => void;
  stageStart: (stage: string) => void;
  stageEnd: (stage: string, details?: unknown) => void;
  confluenceFetchStatus: (details: { status: number; url?: string }) => void;
  xmlParseSummary: (details: { rootChildCount: number; degradationCount: number }) => void;
  macroCountByType: (counts: Record<string, number>) => void;
  assetUploadSummary: (details: { total: number; uploaded: number; failed: number; skipped: number }) => void;
  notionWriteBatchSummary: (details: { batchIndex: number; batchCount: number; blockCount: number; status: number }) => void;
}

export interface CreateDebugLoggerOptions {
  enabled?: boolean;
  sink?: (entry: DebugLogEntry) => void;
  now?: () => string;
}

const sensitiveKeyPattern = /^(authorization|cookie|access[_-]?token|refresh[_-]?token)$/i;

export function createDebugLogger(options: CreateDebugLoggerOptions = {}): DebugLogger {
  const enabled = options.enabled ?? false;
  const sink = options.sink ?? ((entry: DebugLogEntry) => console.debug('[add-to-notion]', entry));
  const now = options.now ?? (() => new Date().toISOString());

  function log(level: DebugLogLevel, event: string, details?: unknown): void {
    if (!enabled) {
      return;
    }

    sink({
      timestamp: now(),
      level,
      event,
      ...(details === undefined ? {} : { details: redactDebugValue(details) })
    });
  }

  return {
    debug: (event, details) => log('debug', event, details),
    info: (event, details) => log('info', event, details),
    warn: (event, details) => log('warn', event, details),
    error: (event, details) => log('error', event, details),
    stageStart: (stage) => log('info', 'stage-start', { stage }),
    stageEnd: (stage, details) => log('info', 'stage-end', { stage, ...(isPlainObject(details) ? details : details === undefined ? {} : { details }) }),
    confluenceFetchStatus: (details) => log('info', 'confluence-fetch-status', details),
    xmlParseSummary: (details) => log('info', 'xml-parse-summary', details),
    macroCountByType: (counts) => log('info', 'macro-count-by-type', counts),
    assetUploadSummary: (details) => log('info', 'asset-upload-summary', details),
    notionWriteBatchSummary: (details) => log('info', 'notion-write-batch-summary', details)
  };
}

export function redactDebugValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactDebugValue);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sensitiveKeyPattern.test(key) ? '[redacted]' : redactDebugValue(nestedValue)])
    );
  }

  return value;
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/Authorization:\s*Bearer\s+[^\s,;]+/gi, 'Authorization: [redacted]')
    .replace(/Authorization:\s*[^\n]+/gi, 'Authorization: [redacted]')
    .replace(/Cookie:\s*[^\n]+/gi, 'Cookie: [redacted]')
    .replace(/\b(access_token|refresh_token)=([^\s&;]+)/gi, '$1=[redacted]')
    .replace(/\b(access_token|refresh_token)\b\s*[:=]\s*[^\s,;}]+/gi, '$1: [redacted]');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
