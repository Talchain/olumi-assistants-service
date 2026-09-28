/**
 * ⭐ PJ-C1 LATENCY: THE TURN'S FIRST READ OF THE MODEL STARTS AT THE TOP OF THE TURN (#72 5861769155).
 *
 * Served `84440ff` (DL run `pj-20260928T011147Z`, A13, Render logs): the Agent route spent ~560 ms on sequential store
 * reads and the turn claim (ownership, pending, committed-turn, claim write + read-back) and only THEN started the
 * graph read (1,011 ms; 33 reads in 18 turns, median 1,078 ms). The claim row is `writesGraph: false`, so a read
 * started before it returns what a read started after it would. `prefetch()` starts that read at once; the first
 * reader of the same write epoch joins it instead of reading again.
 *
 * The epoch rule is unchanged (a read after a write sees the write): the controls below are the existing guarantee.
 */
import { describe, it, expect } from 'vitest';
import { turnReadCache } from '../turn-read-cache.js';

const READ = '/assist/v1/scenarios/s1/graph';

function fakeStore() {
  let version = 1;
  const calls: string[] = [];
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let failNext: 'reject' | 500 | undefined;
  const inner = async (path: string): Promise<{ status: number; json: Record<string, unknown> }> => {
    calls.push(path);
    if (path === READ) {
      // A read sees the model as it was when the read STARTED, however long it then takes.
      const seen = version;
      const f = failNext;
      failNext = undefined;
      if (gate !== undefined) await gate;
      if (f === 'reject') throw new Error('read failed');
      if (f === 500) return { status: 500, json: {} };
      return { status: 200, json: { graph_hash: `v${seen}`, graph: { nodes: [{ id: 'a', label: 'A' }] } } };
    }
    if (path.endsWith('/graph/register')) version += 1;
    return { status: 200, json: {} };
  };
  return {
    inner, calls,
    hold: () => { gate = new Promise<void>((r) => { open = r; }); },
    release: () => { open?.(); gate = undefined; },
    failNextRead: (f: 'reject' | 500) => { failNext = f; },
  };
}
const reads = (calls: string[]) => calls.filter((c) => c === READ).length;

describe('turnReadCache.prefetch: the first read starts at the top of the turn, and the first reader joins it', () => {
  it('RED: prefetch, then read → ONE graph read, and the reader is given that read', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    expect(reads(s.calls), 'the read starts at once, before anyone asks').toBe(1);
    const r = await c.dispatch(READ, {});
    expect(r.json.graph_hash).toBe('v1');
    expect(reads(s.calls)).toBe(1);
    // A reused read is a copy: one caller cannot alter what the next is given.
    (r.json.graph as { nodes: { label: string }[] }).nodes[0]!.label = 'changed';
    expect(((await c.dispatch(READ, {})).json.graph as { nodes: { label: string }[] }).nodes[0]!.label).toBe('A');
    expect(reads(s.calls)).toBe(1);
  });

  it('RED: a reader that arrives while the prefetch is still in flight JOINS it (one read, not two)', async () => {
    const s = fakeStore();
    s.hold();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    const pending = c.dispatch(READ, {});
    await Promise.resolve();
    expect(reads(s.calls)).toBe(1);
    s.release();
    expect((await pending).json.graph_hash).toBe('v1');
    expect(reads(s.calls)).toBe(1);
  });

  it('RED: a failed prefetch (thrown or non-200) is never the answer: the reader reads for itself, and nothing is unhandled', async () => {
    for (const f of ['reject', 500] as const) {
      const s = fakeStore();
      s.failNextRead(f);
      const c = turnReadCache(s.inner, READ);
      c.prefetch();
      const r = await c.dispatch(READ, {});
      expect([f, r.status, r.json.graph_hash]).toEqual([f, 200, 'v1']);
      expect(reads(s.calls), String(f)).toBe(2);
    }
  });

  it('CONTROL: a write that finishes after the prefetch started → the next read is fresh and sees it (the epoch rule holds)', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    await c.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    expect((await c.dispatch(READ, {})).json.graph_hash).toBe('v2');
    expect(reads(s.calls)).toBe(2);
  });

  it('CONTROL: a prefetch STILL IN FLIGHT when a write finishes is never given to a later reader: it is tagged with the epoch it STARTED in', async () => {
    const s = fakeStore();
    s.hold();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    await c.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    s.release();
    await new Promise((r) => setTimeout(r, 0));
    expect((await c.dispatch(READ, {})).json.graph_hash).toBe('v2');
    expect(reads(s.calls)).toBe(2);
  });

  it('CONTROL (discriminating): a reader that arrives AFTER a write while the prefetch is STILL held never joins it', async () => {
    const s = fakeStore();
    s.hold();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    await c.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    const pending = c.dispatch(READ, {}); // the prefetch (epoch 0) is still in flight; this reader is in epoch 1
    s.release();
    expect((await pending).json.graph_hash).toBe('v2');
    expect(reads(s.calls)).toBe(2);
  });

  it('CONTROL: a read that must see other writers (`{ fresh: true }`) never takes the prefetched read', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    await c.dispatch(READ, { fresh: true });
    expect(reads(s.calls)).toBe(2);
  });

  it('CONTROL: prefetch is idempotent — a second call starts no second read', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    c.prefetch();
    c.prefetch();
    await c.dispatch(READ, {});
    expect(reads(s.calls)).toBe(1);
  });
});
