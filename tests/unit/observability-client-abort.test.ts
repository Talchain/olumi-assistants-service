/**
 * ROADMAP 1.16i (CEE half) — observability onError hook must not log a
 * client abort as an error-class "Request error" line.
 *
 * Verified defect: one aborted browser request (socket close during reply
 * → ERR_STREAM_PREMATURE_CLOSE) produces four error-class log lines; the
 * FIRST is this plugin's onError hook (src/plugins/observability.ts)
 * logging "Request error" at error level. The 500 never reaches any client
 * — the socket is gone.
 *
 * Pins BOTH directions:
 *  - client-abort-class errors (ERR_STREAM_PREMATURE_CLOSE / ECONNABORTED /
 *    exact "premature close" / "request aborted" messages) produce NO
 *    "Request error" line from this hook (the single warn-class
 *    `client_aborted` line is the server error handler's job — see
 *    tests/contract/client-abort-classification.test.ts);
 *  - genuine errors still log "Request error" at error level exactly as
 *    today, including an error whose message merely CONTAINS an
 *    abort-like phrase (the classifier is exact-match, not substring).
 */

import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import observabilityPlugin from '../../src/plugins/observability.js';

type LogLine = { level: number; msg: string; [key: string]: unknown };

async function buildApp(): Promise<{ app: FastifyInstance; lines: LogLine[] }> {
  const lines: LogLine[] = [];
  const app = Fastify({
    logger: {
      level: 'info',
      stream: {
        write(line: string) {
          lines.push(JSON.parse(line) as LogLine);
        },
      },
    },
  });
  await app.register(observabilityPlugin);

  app.get('/abort/premature-close-code', async () => {
    const err = new Error('premature close') as NodeJS.ErrnoException;
    err.code = 'ERR_STREAM_PREMATURE_CLOSE';
    throw err;
  });
  app.get('/abort/premature-close-message-only', async () => {
    throw new Error('premature close');
  });
  app.get('/abort/request-aborted', async () => {
    const err = new Error('request aborted') as NodeJS.ErrnoException;
    err.code = 'ECONNABORTED';
    throw err;
  });
  app.get('/genuine/boom', async () => {
    throw new Error('boom');
  });
  app.get('/genuine/abort-like-substring', async () => {
    // Contains "premature close" but is NOT the abort error — must still
    // be treated as a genuine error (exact-match classifier).
    throw new Error('stream helper failed: premature close happened while piping fixture');
  });

  await app.ready();
  return { app, lines };
}

function requestErrorLines(lines: LogLine[]): LogLine[] {
  return lines.filter((l) => l.msg === 'Request error');
}

describe('observability onError — client-abort log classification (1.16i)', () => {
  it.each([
    '/abort/premature-close-code',
    '/abort/premature-close-message-only',
    '/abort/request-aborted',
  ])('%s: no error-class "Request error" line for a client abort', async (url) => {
    const { app, lines } = await buildApp();
    try {
      await app.inject({ method: 'GET', url });
      expect(requestErrorLines(lines)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('genuine error still logs "Request error" at error level (pinned unchanged)', async () => {
    const { app, lines } = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/genuine/boom' });
      const errs = requestErrorLines(lines);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.level).toBe(50); // pino error level
      expect((errs[0]!.error as { message?: string })?.message).toBe('boom');
    } finally {
      await app.close();
    }
  });

  it('an error whose message merely CONTAINS an abort phrase is still a genuine error', async () => {
    const { app, lines } = await buildApp();
    try {
      await app.inject({ method: 'GET', url: '/genuine/abort-like-substring' });
      expect(requestErrorLines(lines)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
