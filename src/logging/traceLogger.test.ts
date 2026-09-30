import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getBaseConfig } from '../config.shared.js';
import { log } from './logger.js';
import {
  isDebugTraceEnabled,
  traceRestRequest,
  traceRestResponse,
  traceSessionContext,
  traceToolOutcome,
} from './traceLogger.js';

// Keep the real `shouldLog` (pure severity math) so isDebugTraceEnabled works; only stub `log`.
vi.mock('./logger.js', async (importActual) => ({
  ...(await importActual<typeof import('./logger.js')>()),
  log: vi.fn(),
}));

vi.mock('../config.shared.js', () => ({
  getBaseConfig: vi.fn(() => ({ logLevel: 'debug' })),
}));

const mockLog = vi.mocked(log);
const mockGetBaseConfig = vi.mocked(getBaseConfig);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBaseConfig.mockReturnValue({ logLevel: 'debug' } as ReturnType<typeof getBaseConfig>);
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

describe('traceSessionContext', () => {
  const base = {
    server: 'https://pod.online.tableau.com',
    siteName: 'acme',
    authType: 'Bearer',
    siteRole: 'SiteAdministratorCreator',
    features: { 'mcp-apps': false, 'flow-tools': true },
    toolsRegistered: 12,
    productVersion: '2025.3',
  };

  it('logs one debug line on the session-trace logger with site/pod/auth/role', () => {
    traceSessionContext(base);
    expect(mockLog).toHaveBeenCalledTimes(1);
    const [entry] = mockLog.mock.calls[0];
    expect(entry.level).toBe('debug');
    expect(entry.logger).toBe('session-trace');
    expect(entry.message).toContain('acme');
    expect(entry.message).toContain('SiteAdministratorCreator');
    expect(entry.message).toContain('tools=12');
  });

  it('carries the full feature-flag state in data', () => {
    traceSessionContext(base);
    expect(mockLog.mock.calls[0][0].data).toMatchObject({
      features: { 'mcp-apps': false, 'flow-tools': true },
      productVersion: '2025.3',
      toolsRegistered: 12,
    });
  });

  it('renders an unfetched role as "(not fetched)"', () => {
    traceSessionContext({ ...base, siteRole: undefined });
    expect(mockLog.mock.calls[0][0].message).toContain('role=(not fetched)');
  });
});

describe('isDebugTraceEnabled', () => {
  it('is true when LOG_LEVEL is debug', () => {
    mockGetBaseConfig.mockReturnValue({ logLevel: 'debug' } as ReturnType<typeof getBaseConfig>);
    expect(isDebugTraceEnabled()).toBe(true);
  });

  it('is false when LOG_LEVEL is info', () => {
    mockGetBaseConfig.mockReturnValue({ logLevel: 'info' } as ReturnType<typeof getBaseConfig>);
    expect(isDebugTraceEnabled()).toBe(false);
  });
});
