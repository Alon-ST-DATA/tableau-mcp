import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from './logger.js';
import { traceRestRequest, traceRestResponse, traceToolOutcome } from './traceLogger.js';

vi.mock('./logger.js', () => ({
  log: vi.fn(),
}));

const mockLog = vi.mocked(log);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('traceRestRequest', () => {
  it('logs the request at debug on the rest-api-trace logger with method/url/params/body', () => {
    traceRestRequest({
      requestId: 7,
      method: 'get',
      url: 'https://pod.tableau.com/api/3.24/sites/s/users',
      params: { pageSize: 100 },
      data: undefined,
    });

    expect(mockLog).toHaveBeenCalledTimes(1);
    const [entry, ctx] = mockLog.mock.calls[0];
    expect(entry.level).toBe('debug');
    expect(entry.logger).toBe('rest-api-trace');
    expect(entry.request_id).toBe('7');
    expect(entry.message).toContain('GET');
    expect(entry.message).toContain('/users');
    expect(entry.data).toEqual({
      method: 'get',
      url: 'https://pod.tableau.com/api/3.24/sites/s/users',
      params: { pageSize: 100 },
      body: undefined,
    });
    expect(ctx).toBeUndefined();
  });

  it('renders an unknown method safely', () => {
    traceRestRequest({
      requestId: 1,
      method: undefined,
      url: 'x',
      params: undefined,
      data: undefined,
    });
    expect(mockLog.mock.calls[0][0].message).toContain('UNKNOWN');
  });

  it('forwards the LUID context to log()', () => {
    const ctx = { getSiteLuid: () => 'site', getUserLuid: () => 'user' };
    traceRestRequest(
      { requestId: 1, method: 'post', url: 'x', params: undefined, data: { a: 1 } },
      ctx,
    );
    expect(mockLog.mock.calls[0][1]).toBe(ctx);
  });
});

describe('traceRestResponse', () => {
  it('logs the response at debug on the rest-api-trace logger with status/body', () => {
    traceRestResponse({
      requestId: 7,
      url: 'https://pod.tableau.com/api/3.24/sites/s/users',
      status: 200,
      data: { users: [] },
    });

    const [entry] = mockLog.mock.calls[0];
    expect(entry.level).toBe('debug');
    expect(entry.logger).toBe('rest-api-trace');
    expect(entry.message).toContain('200');
    expect(entry.data).toEqual({
      status: 200,
      url: 'https://pod.tableau.com/api/3.24/sites/s/users',
      body: { users: [] },
    });
  });

  it('renders a missing status safely', () => {
    traceRestResponse({ requestId: 1, url: 'x', status: undefined, data: undefined });
    expect(mockLog.mock.calls[0][0].message).toContain('???');
  });
});

describe('traceToolOutcome', () => {
  it('logs an ok outcome at debug on the tool logger', () => {
    traceToolOutcome({
      toolName: 'list-users',
      requestId: 3,
      success: true,
      errorCode: '',
      resultText: 'done',
    });

    const [entry] = mockLog.mock.calls[0];
    expect(entry.level).toBe('debug');
    expect(entry.logger).toBe('tool');
    expect(entry.tool_name).toBe('list-users');
    expect(entry.request_id).toBe('3');
    expect(entry.message).toContain('outcome=ok');
    expect(entry.data).toMatchObject({ success: true, result: 'done' });
    // errorCode omitted (undefined) on success
    expect((entry.data as { errorCode?: string }).errorCode).toBeUndefined();
  });

  it('includes the HTTP error category on a failed outcome', () => {
    traceToolOutcome({ toolName: 'update-user', requestId: 3, success: false, errorCode: '403' });
    const [entry] = mockLog.mock.calls[0];
    expect(entry.message).toContain('outcome=error (403)');
    expect((entry.data as { errorCode?: string }).errorCode).toBe('403');
  });

  it('truncates an oversized result preview', () => {
    const huge = 'x'.repeat(5000);
    traceToolOutcome({
      toolName: 't',
      requestId: 1,
      success: true,
      errorCode: '',
      resultText: huge,
    });
    const result = (mockLog.mock.calls[0][0].data as { result: string }).result;
    expect(result.length).toBeLessThan(huge.length);
    expect(result).toContain('[truncated 1000 chars]');
  });

  it('leaves an absent result preview undefined', () => {
    traceToolOutcome({ toolName: 't', requestId: 1, success: true, errorCode: '' });
    expect((mockLog.mock.calls[0][0].data as { result?: string }).result).toBeUndefined();
  });
});
