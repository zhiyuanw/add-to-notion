import { describe, expect, it, vi } from 'vitest';

import { createDebugLogger, redactDebugValue, type DebugLogEntry } from '../shared/debugLogger';

describe('developer debug logging', () => {
  it('redacts token, cookie, and authorization header patterns recursively', () => {
    const redacted = redactDebugValue({
      accessToken: 'access-secret',
      refresh_token: 'refresh-secret',
      headers: {
        Authorization: 'Bearer notion-secret',
        Cookie: 'JSESSIONID=abc; cloud.session=def'
      },
      message: 'Authorization: Bearer inline-secret Cookie: inline-cookie access_token=query-secret refresh_token=refresh-query'
    });

    expect(JSON.stringify(redacted)).not.toContain('access-secret');
    expect(JSON.stringify(redacted)).not.toContain('refresh-secret');
    expect(JSON.stringify(redacted)).not.toContain('notion-secret');
    expect(JSON.stringify(redacted)).not.toContain('JSESSIONID=abc');
    expect(JSON.stringify(redacted)).not.toContain('inline-secret');
    expect(JSON.stringify(redacted)).not.toContain('query-secret');
    expect(redacted).toMatchObject({
      accessToken: '[redacted]',
      refresh_token: '[redacted]',
      headers: {
        Authorization: '[redacted]',
        Cookie: '[redacted]'
      }
    });
  });

  it('is quiet by default outside development mode', () => {
    const sink = vi.fn();
    const logger = createDebugLogger({ sink });

    logger.info('stage-start', { stage: 'fetching' });

    expect(sink).not.toHaveBeenCalled();
  });

  it('emits structured redacted entries when explicitly enabled', () => {
    const sink = vi.fn();
    const logger = createDebugLogger({ enabled: true, sink, now: () => '2026-05-18T21:00:00.000Z' });

    logger.info('confluence-fetch-status', {
      status: 200,
      Authorization: 'Bearer token-123',
      Cookie: 'JSESSIONID=abc'
    });

    expect(sink).toHaveBeenCalledWith({
      timestamp: '2026-05-18T21:00:00.000Z',
      level: 'info',
      event: 'confluence-fetch-status',
      details: {
        status: 200,
        Authorization: '[redacted]',
        Cookie: '[redacted]'
      }
    } satisfies DebugLogEntry);
  });

  it('provides helpers for stage, parse, macro, asset, and Notion batch summaries', () => {
    const sink = vi.fn();
    const logger = createDebugLogger({ enabled: true, sink, now: () => '2026-05-18T21:00:00.000Z' });

    logger.stageStart('fetching');
    logger.stageEnd('fetching');
    logger.xmlParseSummary({ rootChildCount: 3, degradationCount: 1 });
    logger.macroCountByType({ code: 2, info: 1 });
    logger.assetUploadSummary({ total: 4, uploaded: 2, failed: 1, skipped: 1 });
    logger.notionWriteBatchSummary({ batchIndex: 1, batchCount: 2, blockCount: 100, status: 200 });

    expect(sink.mock.calls.map((call) => call[0].event)).toEqual([
      'stage-start',
      'stage-end',
      'xml-parse-summary',
      'macro-count-by-type',
      'asset-upload-summary',
      'notion-write-batch-summary'
    ]);
  });
});
