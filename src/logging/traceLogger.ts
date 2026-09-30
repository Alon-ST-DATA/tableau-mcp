import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { log } from './logger.js';

/**
 * Extended debug tracing (this fork's addition).
 *
 * The upstream server already emits a debug `log()` line for each TOOL invocation (tool name +
 * args) and routes each external REST request/response through the MCP `notifier` — but the notifier
 * only reaches the client's logging-notification stream and the optional fileLogger, NOT the operator
 * `appLogger` (stderr/console) sink. So an operator tailing the server's own logs at `LOG_LEVEL=debug`
 * can see which tool was called but NOT which external endpoint it hit, with what arguments, or what
 * came back — the single most useful thing when debugging a misbehaving tool.
 *
 * These helpers close that gap by emitting the same information through `log()` at `debug` level, so
 * it lands in whichever sinks the operator has enabled (appLogger and/or fileLogger). They are
 * debug-level by design: set `LOG_LEVEL=debug` to turn the whole trace on, and leave it at the
 * default `info` to keep it off. Payload masking is applied by the callers (which already hold the
 * masked request/response), so no secret material is passed in here.
 *
 * Logger names:
 * - `rest-api-trace` — one line per external request and one per response, correlated by requestId.
 * - `tool`           — the tool OUTCOME line (paired with the existing upstream invocation line).
 */

const REST_TRACE_LOGGER = 'rest-api-trace';
const TOOL_LOGGER = 'tool';

/** Lazy site/user LUID accessors, matching the shape `log()` accepts as its context argument. */
type LuidContext = {
  getSiteLuid?: () => string;
  getUserLuid?: () => string;
};

/** Cap on serialized tool-result text so a large response can't flood the log. */
const MAX_RESULT_CHARS = 4000;

/**
 * Trace one outbound REST request to an external Tableau endpoint. Fields are expected to be
 * already masked by the caller (see `restApiInstance.logRequest`).
 */
export function traceRestRequest(
  {
    requestId,
    method,
    url,
    params,
    data,
  }: {
    requestId: RequestId;
    method: string | undefined;
    url: string;
    params: unknown;
    data: unknown;
  },
  ctx?: LuidContext,
): void {
  log(
    {
      message: `REST request → ${(method ?? 'UNKNOWN').toUpperCase()} ${url}`,
      level: 'debug',
      logger: REST_TRACE_LOGGER,
      request_id: requestId.toString(),
      data: { method, url, params, body: data },
    },
    ctx,
  );
}

/**
 * Trace one REST response from an external Tableau endpoint. Fields are expected to be already
 * masked by the caller (see `restApiInstance.logResponse`).
 */
export function traceRestResponse(
  {
    requestId,
    url,
    status,
    data,
  }: {
    requestId: RequestId;
    url: string;
    status: number | undefined;
    data: unknown;
  },
  ctx?: LuidContext,
): void {
  log(
    {
      message: `REST response ← ${status ?? '???'} ${url}`,
      level: 'debug',
      logger: REST_TRACE_LOGGER,
      request_id: requestId.toString(),
      data: { status, url, body: data },
    },
    ctx,
  );
}

/**
 * Trace a tool's OUTCOME once it has finished, pairing with the upstream invocation line so a log
 * reader sees the full lifecycle: which tool ran, whether it succeeded, the HTTP error category if
 * any, and a bounded preview of the result text.
 */
export function traceToolOutcome(
  {
    toolName,
    requestId,
    success,
    errorCode,
    resultText,
  }: {
    toolName: string;
    requestId: RequestId;
    success: boolean;
    errorCode: string;
    resultText?: string;
  },
  ctx?: LuidContext,
): void {
  const outcome = success ? 'ok' : `error${errorCode ? ` (${errorCode})` : ''}`;
  log(
    {
      message: `Tool ${toolName} completed: requestId=${requestId}, outcome=${outcome}`,
      level: 'debug',
      logger: TOOL_LOGGER,
      tool_name: toolName,
      request_id: requestId.toString(),
      data: {
        success,
        errorCode: errorCode || undefined,
        result: truncate(resultText),
      },
    },
    ctx,
  );
}

function truncate(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncated ${text.length - MAX_RESULT_CHARS} chars]`
    : text;
}
