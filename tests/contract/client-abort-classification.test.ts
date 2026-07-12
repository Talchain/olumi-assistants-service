/**
 * ROADMAP 1.16i (CEE half) — client aborts must not be classified as 500s
 * by the central error handler.
 *
 * Verified defect: one aborted browser request (socket close during reply
 * → ERR_STREAM_PREMATURE_CLOSE) produces four error-class log lines and a
 * FALSE 5xx metric increment:
 *   1. observability onError logs "Request error"          (plugin test)
 *   2. toErrorV1 logs "Internal server error occurred"     (this file)
 *   3. 500-branch logs "[INTERNAL] Internal server error"  (this file)
 *   4. incrementErrorCount(500) bumps server_errors_5xx    (this file)
 * The 500 never reaches any client — the socket is gone.
 *
 * Fix under test (src/server.ts setErrorHandler): a client-abort-class
 * error short-circuits BEFORE toErrorV1 — one warn-class line with
 * `event: 'client_aborted'`, no incrementErrorCount, no
 * internal-server-error copy, reply finalised as 499 (client closed
 * request; nothing is deliverable on a dead socket, and 499 keeps the
 * onResponse access-log line out of the 5xx/error class).
 *
 * The genuine-error direction is pinned byte-equal: a thrown Error still
 * produces the 500 + error.v1 INTERNAL body + both error-class log lines +
 * the 5xx metric increment, exactly as today.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// LLM_PROVIDER must be stubbed — the config default is "openai" and no
// OPENAI_API_KEY is present in the test env (same pattern as
// endpoint-feature-matrix.test.ts). build() fail-fasts otherwise.
vi.stubEnv('LLM_PROVIDER', 'fixtures');

import { build } from '../../src/server.js';
import { log as telemetryLog } from '../../src/utils/telemetry.js';

let app: FastifyInstance;

type Captured = { obj: unknown; msg: string | undefined };

/** Shadow a pino level method with a recording passthrough-free stub.
 * Instance-level assignment shadows the prototype method; `restore`
 * deletes the shadow so the original resurfaces. */
function captureLevel(
  logger: Record<string, unknown>,
  level: string,
): { calls: Captured[]; restore: () => void } {
  const calls: Captured[] = [];
  const target = logger as Record<string, (...args: unknown[]) => void>;
  const hadOwn = Object.prototype.hasOwnProperty.call(logger, level);
  const original = target[level];
  target[level] = (...args: unknown[]) => {
    calls.push({
      obj: args[0],
      msg: typeof args[1] === 'string' ? args[1] : undefined,
    });
  };
  return {
    calls,
    restore: () => {
      if (hadOwn) {
        target[level] = original!;
      } else {
        delete target[level];
      }
    },
  };
}

let restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores) restore();
  restores = [];
});

function captureAppLogs() {
  const err = captureLevel(app.log as unknown as Record<string, unknown>, 'error');
  const warn = captureLevel(app.log as unknown as Record<string, unknown>, 'warn');
  const telErr = captureLevel(telemetryLog as unknown as Record<string, unknown>, 'error');
  restores.push(err.restore, warn.restore, telErr.restore);
  return { errorCalls: err.calls, warnCalls: warn.calls, telemetryErrorCalls: telErr.calls };
}

async function read5xxCount(): Promise<number> {
  const res = await app.inject({ method: 'GET', url: '/v1/status' });
  expect(res.statusCode).toBe(200);
  return (JSON.parse(res.body) as { requests: { server_errors_5xx: number } }).requests
    .server_errors_5xx;
}

beforeAll(async () => {
  app = await build();
  app.get('/__test/client-abort', async () => {
    const err = new Error('premature close') as NodeJS.ErrnoException;
    err.code = 'ERR_STREAM_PREMATURE_CLOSE';
    throw err;
  });
  app.get('/__test/genuine-error', async () => {
    throw new Error('synthetic genuine failure');
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('central error handler — client-abort classification (1.16i)', () => {
  it('an aborted request does not increment the 5xx metric, does not log at error level, and logs ONE warn-class client_aborted line', async () => {
    const before = await read5xxCount();
    const { errorCalls, warnCalls, telemetryErrorCalls } = captureAppLogs();

    const res = await app.inject({ method: 'GET', url: '/__test/client-abort' });

    // (metric) no false 5xx increment
    // NOTE: read AFTER restoring nothing — /v1/status is uninstrumented here.
    expect(await read5xxCount()).toBe(before);

    // (status) nothing is deliverable; 499 keeps the completion access-log
    // line out of the 5xx/error class. Pre-fix behaviour: 500.
    expect(res.statusCode).toBe(499);

    // (logs) zero error-class lines from the handler chain…
    expect(
      errorCalls.map((c) => c.msg),
      'no error-class log line may fire for a client abort',
    ).toEqual([]);
    // …toErrorV1's internal-server-error copy is never reached…
    expect(
      telemetryErrorCalls.filter((c) => c.msg === 'Internal server error occurred'),
    ).toEqual([]);
    // …and exactly ONE warn-class line carries the distinct class.
    const abortWarns = warnCalls.filter(
      (c) => (c.obj as { event?: string })?.event === 'client_aborted',
    );
    expect(abortWarns).toHaveLength(1);
  });

  it('a genuine thrown error still behaves exactly as today (500 + error.v1 INTERNAL + both error-class lines + 5xx increment)', async () => {
    const before = await read5xxCount();
    const { errorCalls, warnCalls, telemetryErrorCalls } = captureAppLogs();

    const res = await app.inject({ method: 'GET', url: '/__test/genuine-error' });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toBe('Internal server error');

    expect(await read5xxCount()).toBe(before + 1);

    // 500-branch line, byte-equal message.
    expect(errorCalls.some((c) => c.msg === '[INTERNAL] Internal server error')).toBe(true);
    // toErrorV1's server-side line, byte-equal message.
    expect(
      telemetryErrorCalls.some((c) => c.msg === 'Internal server error occurred'),
    ).toBe(true);
    // And no abort classification leaks onto the genuine path.
    expect(
      warnCalls.filter((c) => (c.obj as { event?: string })?.event === 'client_aborted'),
    ).toEqual([]);
  });
});
