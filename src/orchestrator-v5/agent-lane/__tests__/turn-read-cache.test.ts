/**
 * C6: one read of the model per WRITE EPOCH (served pj-dispatch-2106r: 22 graph reads at ~1.1 s in one journey).
 * The invariant is C1c's, widened: a read is reused only while nothing else has been dispatched or written since it
 * was taken, so a read after a write always sees the write.
 */
import { describe, it, expect } from 'vitest';
import { turnReadCache } from '../turn-read-cache.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';

const READ = '/assist/v1/scenarios/s1/graph';

/** A fake store: the graph read returns the current version; a register call bumps it. */
function fakeStore() {
  let version = 1;
  const calls: string[] = [];
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  const inner = async (path: string): Promise<{ status: number; json: Record<string, unknown> }> => {
    calls.push(path);
    if (path === READ) {
      const graph = { nodes: [{ id: 'a', label: 'A' }] };
      return { status: 200, json: { graph_hash: `v${version}`, graph,
        canonical_analysis_view: projectCanonicalAnalysisView({ revision: version, graph, runFact: null }) } };
    }
    if (path.endsWith('/graph/register')) {
      if (gate !== undefined) await gate;
      version += 1;
    }
    return { status: 200, json: {} };
  };
  return {
    inner, calls,
    bump: () => { version += 1; },
    hold: () => { gate = new Promise<void>((r) => { open = r; }); },
    releaseNow: () => { open?.(); gate = undefined; },
  };
}
const reads = (calls: string[]) => calls.filter((c) => c === READ).length;

describe('turnReadCache: one read per write epoch', () => {
  it('retains canonical analysis cells through isolated cached copies and refreshes them after a write', async () => {
    let version = 1;
    let graphReads = 0;
    const cache = turnReadCache(async path => {
      if (path !== READ) { version += 1; return { status: 200, json: {} }; }
      graphReads += 1;
      const graph = { nodes: [{ id: 'goal', kind: 'goal', label: `Goal ${version}` }], edges: [] };
      const result = {
        type: 'analysis_result',
        enrichment: {
          option_comparison: [{ option_id: 'a' }],
          inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each',
            option_ids: ['a'], pct_by_option: { a: version * 10 } }],
        },
      };
      const canonicalAnalysisView = projectCanonicalAnalysisView({
        revision: version, graph,
        runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false,
          result: { scenario_id: 's1', summary: '', run_id: `run-${version}` } } as never,
        analysisState: { run_state: { kind: 'complete_current' } } as never,
        currentResult: result as never,
      });
      return { status: 200, json: { graph, canonical_analysis_view: canonicalAnalysisView } };
    }, READ);
    // A capability seeds the cache before the final reply reads it.
    await cache.dispatch(READ, {});
    const view = (read: { json: Record<string, unknown> }) => read.json.canonical_analysis_view as {
      run: { run_id: string }; staleness: { revision: number }; options: { cell: { kind: string; display: string; face: string } }[];
    };
    const first = await cache.dispatch(READ, {});
    expect(view(first).staleness.revision).toBe(1);
    expect(view(first).options[0]?.cell).toEqual({ kind: 'figure', display: 'about 10%', face: 'about 10% chance of meeting your goal, in this model.' });
    (first.json.graph as { nodes: { label: string }[] }).nodes[0]!.label = 'Caller mutation';
    view(first).options[0]!.cell.display = 'Caller mutation';
    view(first).options[0]!.cell.face = 'Caller mutation';
    const repeat = await cache.dispatch(READ, {});
    expect(view(repeat)).not.toBe(view(first));
    expect(view(repeat).options[0]?.cell).toEqual({ kind: 'figure', display: 'about 10%', face: 'about 10% chance of meeting your goal, in this model.' });
    expect((repeat.json.graph as { nodes: { label: string }[] }).nodes[0]!.label).toBe('Goal 1');
    expect(graphReads).toBe(1);
    await cache.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    const next = await cache.dispatch(READ, {});
    expect(view(next).staleness.revision).toBe(2);
    expect(view(next).run.run_id).toBe('run-2');
    expect(view(next).options[0]?.cell).toEqual({ kind: 'figure', display: 'about 20%', face: 'about 20% chance of meeting your goal, in this model.' });
    expect(graphReads).toBe(2);
  });

  it('RED (the approve shape): read → write → read → read → read makes TWO graph reads, and every read after the write sees it', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    expect((await c.dispatch(READ, {})).json.graph_hash).toBe('v1');
    await c.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    const after = [await c.dispatch(READ, {}), await c.dispatch(READ, {}), await c.dispatch(READ, {})];
    expect(after.map((r) => r.json.graph_hash)).toEqual(['v2', 'v2', 'v2']);
    expect(reads(s.calls), 'one read before the write, ONE after it').toBe(2);
  });

  it('an in-process writer ends the epoch at its start and its end: the next read is fresh and sees it', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    await c.dispatch(READ, {});
    await c.around(async () => { s.bump(); });
    expect((await c.dispatch(READ, {})).json.graph_hash).toBe('v2');
    expect(reads(s.calls)).toBe(2);
  });

  it('any other dispatch ends the epoch too (it may write): the next read is fresh', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    await c.dispatch(READ, {});
    await c.dispatch('/orchestrate/v2/turn', {});
    await c.dispatch(READ, {});
    expect(reads(s.calls)).toBe(2);
  });

  it('a read taken WHILE a write is in flight is never kept', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    s.hold();
    const writing = c.dispatch('/assist/v1/scenarios/s1/graph/register', {});
    const during = await c.dispatch(READ, {});
    expect(during.json.graph_hash, 'the write has not landed yet').toBe('v1');
    s.releaseNow();
    await writing;
    expect((await c.dispatch(READ, {})).json.graph_hash, 'never answered from before the write').toBe('v2');
    expect(reads(s.calls)).toBe(2);
  });

  it('a reused read is a copy: one caller changing its read never changes another\'s', async () => {
    const s = fakeStore();
    const c = turnReadCache(s.inner, READ);
    const first = await c.dispatch(READ, {});
    ((first.json.graph as { nodes: { label: string }[] }).nodes[0]!).label = 'CHANGED';
    const second = await c.dispatch(READ, {});
    expect(((second.json.graph as { nodes: { label: string }[] }).nodes[0]!).label).toBe('A');
    expect(reads(s.calls)).toBe(1);
  });

  it('a failed read is never kept', async () => {
    let n = 0;
    const c = turnReadCache(async () => ({ status: n++ === 0 ? 503 : 200, json: {} }), READ);
    expect((await c.dispatch(READ, {})).status).toBe(503);
    expect((await c.dispatch(READ, {})).status).toBe(200);
  });
});
