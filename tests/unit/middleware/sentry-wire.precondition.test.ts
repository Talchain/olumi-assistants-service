/**
 * PRECONDITION twin for sentry-wire.test.ts (system S-H).
 *
 * The REAL @sentry/node with CEE's pre-S-H options (staging df15c8c1
 * src/middleware/sentry.ts: SDK default integrations, tracesSampleRate 0.5,
 * a beforeSend that strips request.data on ERRORS only). A turn request's body
 * reaches the wire on the TRANSACTION. This row must stay GREEN: it proves the
 * harness in sentry-wire.test.ts can see a body, so its absence rows mean
 * something.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';

const SENTINEL = 'SENTINEL-wire-pre-77d1-acquire-northwind';

describe('pre-S-H CEE Sentry options (precondition)', () => {
  afterAll(async () => {
    await Sentry.close();
  });

  it('send the turn request body on a transaction', async () => {
    const sent: string[] = [];
    Sentry.init({
      dsn: 'https://public@o0.ingest.sentry.io/0',
      environment: 'staging',
      tracesSampleRate: 1,
      transport: () => ({
        send: async (envelope: unknown) => {
          sent.push(JSON.stringify(envelope));
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
      beforeSend(event) {
        if (event.request) event.request.data = undefined;
        return event;
      },
    });
    const app = Fastify();
    Sentry.setupFastifyErrorHandler(app);
    app.post('/orchestrate/v2/turn', async () => ({ ok: true }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/orchestrate/v2/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: SENTINEL }),
    });
    await res.text();
    await new Promise((r) => setTimeout(r, 100));
    await Sentry.flush(3000);
    await app.close();
    const wire = sent.join('\n');
    expect(wire).toContain('"type":"transaction"');
    expect(wire).toContain(SENTINEL);
  });
});
