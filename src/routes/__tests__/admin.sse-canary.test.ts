/**
 * SSE infrastructure canary — tests for the diagnostic instrument.
 *
 * These run against a REAL listening socket, not app.inject(), because the
 * load-bearing behaviours are socket-level: headers must arrive at t=0 (that is
 * what defeats a response-HEADER wall), and ticks must keep being produced after
 * the client goes away (blocker B13, the durable-job viability signal). inject()
 * models neither.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';

const TEST_KEY = 'test-admin-key-canary';

const mockConfig = {
  prompts: {
    adminApiKey: TEST_KEY,
    adminApiKeyRead: undefined,
    adminAllowedIPs: '',
  },
  server: {},
};

vi.mock('../../config/index.js', () => ({ config: mockConfig }));

vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  hashIP: () => 'hashed-ip',
  TelemetryEvents: {},
}));

vi.mock('../../utils/hash.js', () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

const { adminTestRoutes } = await import('../admin.testing.js');

let app: FastifyInstance;
let base: string;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(adminTestRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await app.close();
});

const CANARY = '/orchestrate/v2/sse-canary';

async function readFrames(
  res: Response,
  onFrame?: (seq: number, kind: string) => boolean | void,
): Promise<Array<{ seq: number; kind: string; elapsed_ms: number }>> {
  const frames: Array<{ seq: number; kind: string; elapsed_ms: number }> = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const parsed = JSON.parse(dataLine.slice(6));
      frames.push(parsed);
      if (onFrame && onFrame(parsed.seq, parsed.kind) === false) {
        await reader.cancel().catch(() => {});
        return frames;
      }
    }
  }
  return frames;
}

describe('SSE canary — auth', () => {
  it('rejects a request with no admin key', async () => {
    const res = await fetch(base + CANARY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ duration_ms: 1000, interval_ms: 300 }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong admin key supplied in the body', async () => {
    const res = await fetch(base + CANARY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: 'wrong', duration_ms: 1000, interval_ms: 300 }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts the admin key in the BODY (the Netlify edge strips x-admin-key)', async () => {
    const res = await fetch(base + CANARY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: TEST_KEY, duration_ms: 900, interval_ms: 300 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    await readFrames(res);
  });
});

describe('SSE canary — the t=0 header property', () => {
  it('returns response headers and seq 0 BEFORE the first interval elapses', async () => {
    const t0 = Date.now();
    const res = await fetch(base + CANARY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: TEST_KEY, duration_ms: 4000, interval_ms: 2000 }),
    });
    const headerLatency = Date.now() - t0;

    // The whole point of SSE here: headers must not wait for the body.
    expect(res.status).toBe(200);
    expect(headerLatency).toBeLessThan(1500);

    const frames = await readFrames(res, (seq) => (seq >= 1 ? false : undefined));
    expect(frames[0].seq).toBe(0);
    expect(frames[0].elapsed_ms).toBeLessThan(1500);
  });
});

describe('SSE canary — numbered frames and terminal frame', () => {
  it('emits sequentially numbered frames and a terminal done frame', async () => {
    const res = await fetch(base + CANARY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: TEST_KEY, duration_ms: 1500, interval_ms: 300 }),
    });
    const frames = await readFrames(res);

    expect(frames.length).toBeGreaterThanOrEqual(4);
    // Sequence numbers are what let a probe say "the stream died at seq N".
    expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i));
    expect(frames[frames.length - 1].kind).toBe('done');
    expect(frames[frames.length - 1].elapsed_ms).toBeGreaterThanOrEqual(1500);
  });
});

describe('SSE canary — survival after downstream disconnect (blocker B13)', () => {
  it('keeps producing ticks after the client disconnects, and the ledger records them', async () => {
    const res = await fetch(base + CANARY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: TEST_KEY, duration_ms: 3000, interval_ms: 250 }),
    });
    const runId = res.headers.get('x-olumi-canary-run');
    expect(runId).toBeTruthy();

    // Hang up early — around seq 2, i.e. well before duration_ms.
    await readFrames(res, (seq) => (seq >= 2 ? false : undefined));

    // Let the run finish server-side after the socket is gone.
    await new Promise((r) => setTimeout(r, 3500));

    const statusRes = await fetch(base + CANARY + '/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: TEST_KEY, run_id: runId }),
    });
    expect(statusRes.status).toBe(200);
    const run = (await statusRes.json()) as {
      disconnected_at_ms: number | null;
      ticks_after_disconnect: number;
      completed: boolean;
      end_reason: string | null;
      last_seq_produced: number;
      last_seq_flushed: number;
    };

    expect(run.disconnected_at_ms).not.toBeNull();
    // THE signal: work produced after the socket closed.
    expect(run.ticks_after_disconnect).toBeGreaterThan(0);
    expect(run.completed).toBe(true);
    expect(run.end_reason).toBe('duration_reached');
    // Production outran flushing, which is exactly what "survived the client" means.
    expect(run.last_seq_produced).toBeGreaterThan(run.last_seq_flushed);
  });

  it('status returns 404 for an unknown run id', async () => {
    const res = await fetch(base + CANARY + '/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_key: TEST_KEY, run_id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});
