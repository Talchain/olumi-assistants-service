/**
 * ⭐ PJ-C1 BUILD TURN, LEVER 3 (DL GO #72 5868860230): a READ the caller names does not end the read epoch.
 *
 * Measured on 16 served first-pass builds (28 Sep, `openai-runtime/c1-build-turn-20260928/`): the dispatch ledger read
 * graph → versions → graph → graph(fresh) → register → graph → graph. The construction receipt lookup
 * (`findConstructionVersion`, a LIST of versions) ended the epoch the route's prefetch had started, so the
 * "never build over a model" check (`before`) read the graph again 0.5–0.7 s later, with nothing written in between.
 *
 * The rule: a path the route names as read-only (the scenario's version list) is dispatched without ending the epoch.
 * Every other dispatch still ends it, and a FRESH read (the construction's own concurrency guard) still bypasses the
 * cache. The route passes exactly its own scenario's version-list path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { turnReadCache, FRESH_READ } from '../turn-read-cache.js';

const READ = '/assist/v1/scenarios/s1/graph';
const VERSIONS = '/assist/v1/scenarios/s1/versions';

function fakeStore() {
  let version = 1;
  const calls: string[] = [];
  const inner = async (path: string): Promise<{ status: number; json: Record<string, unknown> }> => {
    calls.push(path);
    if (path === READ) return { status: 200, json: { graph_hash: `v${version}`, graph: { nodes: [] } } };
    if (path.endsWith('/graph/register')) version += 1;
    return { status: 200, json: { versions: [] } };
  };
  return { inner, calls };
}
const reads = (calls: string[]) => calls.filter((c) => c === READ).length;

describe('⭐ lever 3: a named read-only dispatch keeps the read epoch', () => {
  it('RED (the served build ledger): prefetch → versions → graph reads the model ONCE', async () => {
    const s = fakeStore();
    const cache = turnReadCache(s.inner, READ, [VERSIONS]);
    cache.prefetch();
    await cache.dispatch(VERSIONS, { limit: 200 });
    const before = await cache.dispatch(READ, {});
    expect(before.json.graph_hash).toBe('v1');
    expect(reads(s.calls), JSON.stringify(s.calls)).toBe(1);
  });

  it('CONTROL: the construction’s FRESH guard still reads, and a write still ends the epoch', async () => {
    const s = fakeStore();
    const cache = turnReadCache(s.inner, READ, [VERSIONS]);
    cache.prefetch();
    await cache.dispatch(VERSIONS, {});
    await cache.dispatch(READ, {});
    await cache.dispatch(READ, { ...FRESH_READ });
    expect(reads(s.calls)).toBe(2);
    await cache.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    const after = await cache.dispatch(READ, {});
    expect(after.json.graph_hash, 'a read after the write sees the write').toBe('v2');
    expect(reads(s.calls)).toBe(3);
  });

  it('CONTRAST: without the path named, the versions dispatch ends the epoch, as before', async () => {
    const s = fakeStore();
    const cache = turnReadCache(s.inner, READ);
    cache.prefetch();
    await cache.dispatch(VERSIONS, {});
    await cache.dispatch(READ, {});
    expect(reads(s.calls)).toBe(2);
  });

  it('the route names exactly its own scenario’s version list', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('turnReadCache(dispatch, `/assist/v1/scenarios/${scenarioId}/graph`, [`/assist/v1/scenarios/${scenarioId}/versions`])');
  });
});
