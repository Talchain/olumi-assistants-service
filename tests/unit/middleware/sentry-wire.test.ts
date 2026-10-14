/**
 * Sentry reporting contract (system S-H) — CEE, measured ON THE WIRE.
 *
 * The REAL @sentry/node (no mock) with CEE's initSentry() options and a real
 * Fastify server on a socket; only the transport is swapped for an in-memory
 * one, so the rows read the envelopes the SDK would actually send.
 *
 * Precondition twin: sentry-wire.precondition.test.ts (its own file, so its
 * Sentry.init cannot share process state with this one) shows the pre-S-H
 * options DO put the request body on the wire. The contract rows must not.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import Fastify, { type FastifyInstance } from 'fastify';

const SENTINEL = 'SENTINEL-wire-2c8a-acquire-northwind-for-40m';
const SHA40 = '0123456789abcdef0123456789abcdef01234567';

const sent: string[] = [];
const transport = () => ({
  send: async (envelope: unknown) => {
    sent.push(JSON.stringify(envelope));
    return { statusCode: 200 };
  },
  flush: async () => true,
});

async function serve(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify();
  Sentry.setupFastifyErrorHandler(app);
  app.post('/orchestrate/v2/turn', async (req) => ({ ok: true, n: JSON.stringify(req.body).length }));
  app.post('/assist/v1/boom', async () => {
    throw new Error('turn pipeline failed');
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, url: `http://127.0.0.1:${port}` };
}

async function post(url: string, path: string): Promise<string> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-share-token': SENTINEL },
    body: JSON.stringify({ message: SENTINEL, graph: { nodes: [{ label: SENTINEL }] } }),
  });
  await res.text();
  await new Promise((r) => setTimeout(r, 100));
  await Sentry.flush(3000);
  return sent.join('\n');
}

describe('CEE Sentry on the wire (S-H)', () => {
  let app: FastifyInstance;
  let url: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
    process.env.SENTRY_ENVIRONMENT = 'production';
    process.env.NODE_ENV = 'staging';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '1';
    delete process.env.CEE_BUILD_HASH;
    delete process.env.GIT_COMMIT_SHA;
    process.env.RENDER_GIT_COMMIT = SHA40;
    const { initSentry } = await import('../../../src/middleware/sentry.js');
    initSentry({ transport });
    ({ app, url } = await serve());
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close();
    process.env = { ...saved };
  });

  beforeEach(() => {
    sent.length = 0;
  });

  it('a turn transaction is sent with no request body and no credential header', async () => {
    const wire = await post(url, '/orchestrate/v2/turn');
    expect(wire).toContain('"type":"transaction"');
    expect(wire).toContain('/orchestrate/v2/turn');
    expect(wire).not.toContain(SENTINEL);
  });

  it('a failed request is sent as an error with no body; labelled production, service=cee, full SHA', async () => {
    const wire = await post(url, '/assist/v1/boom');
    expect(wire).toContain('turn pipeline failed');
    expect(wire).not.toContain(SENTINEL);
    expect(wire).toContain('"environment":"production"');
    expect(wire).toContain('"service":"cee"');
    expect(wire).toContain(SHA40);
  });
});
