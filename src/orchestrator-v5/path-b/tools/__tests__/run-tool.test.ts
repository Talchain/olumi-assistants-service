/**
 * PATH-B RUN ADAPTER: `ran` only when a fresh read shows a NEW Run on the model as it now stands; a decline carries its
 * typed readiness; a failure claims nothing; an approval this turn never runs. SYNTHETIC scenario.
 */
import { describe, expect, it, vi } from 'vitest';
import { RunAnalysisParams, runAnalysis } from '../run-tool.js';
import { traceRow } from '../outcome.js';
import { read, type Rec } from './fixtures.js';

type Reply = { status: number; json: Rec } | Error;
/** A scripted product: the graph route answers `reads` in order; the Run turn answers `run`. */
function product(reads: readonly Reply[], run: Reply) {
  const queue = [...reads];
  const dispatch = vi.fn(async (path: string, _body: unknown) => {
    const next = path === '/orchestrate/v2/turn' ? run : queue.shift();
    if (next === undefined) throw new Error(`unscripted ${path}`);
    if (next instanceof Error) throw next;
    return next;
  });
  return { dispatch, onAnalysis: vi.fn() };
}
const graphRead = (runId: string | null, hashAtRun = 'h_one', hash = 'h_one'): Reply => ({ status: 200, json: read({ graph_hash: hash,
  canonical_analysis_view: { staleness: { revision: 7, stale: false }, run: { run_id: runId, graph_hash_at_run: hashAtRun } } }) });
const RUN_OK: Reply = { status: 200, json: { analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-19T11:00:00.000Z' } },
  blocks: [{ type: 'analysis_result' }] } };
const ctx = { scenario_id: 'scn_1' };
const ARGS = { reason: 'The user asked to run it.', effects_timing: 'not_stated' as const };
const FREE = { approvalApplied: false };

describe('a Run is claimed only when a new one is on record', () => {
  it('a new Run on the current model: ok, ran, and the Run turn is the product\'s own', async () => {
    const p = product([graphRead('run_1'), graphRead('run_2')], RUN_OK);
    const out = await runAnalysis(p, ctx, ARGS, FREE);
    expect(out).toMatchObject({ status: 'ok', ran: true, mutated: false, data: { run_id: 'run_2' } });
    expect(traceRow('run_analysis', out)).toEqual({ name: 'run_analysis', ok: true, mutated: false, outcome: 'ok', refusal: null, ran: true });
    expect(p.dispatch).toHaveBeenCalledWith('/orchestrate/v2/turn', expect.objectContaining({ stage: 'analyse', scenario_id: 'scn_1',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis', parameters: { effects_timing: 'not_stated' } } }));
    expect(p.onAnalysis).toHaveBeenCalledWith(expect.objectContaining({ scenario_id: 'scn_1', status: 200, blocks: [{ type: 'analysis_result' }] }));
  });

  it.each([
    ['the same Run id as before', graphRead('run_1')],
    ['a new id computed on a model that has since moved', graphRead('run_2', 'h_old', 'h_one')],
    ['no Run at all', graphRead(null)],
  ] as const)('%s: unavailable, never "ran"', async (_name, after) => {
    const out = await runAnalysis(product([graphRead('run_1'), after], RUN_OK), ctx, ARGS, FREE);
    expect(out).toEqual({ status: 'unavailable', reason: 'run_not_recorded', write: 'none' });
    expect(traceRow('run_analysis', out).ran).toBeNull();
  });

  it('the product declined: refused with the typed readiness it declined on', async () => {
    const declined: Reply = { status: 200, json: { analysis_state: { run_state: { kind: 'blocked' } }, blocks: [] } };
    const out = await runAnalysis(product([graphRead('run_1'), graphRead('run_1')], declined), ctx, ARGS, FREE);
    expect(out).toMatchObject({ status: 'refused', reason: 'run_blocked',
      data: { readiness: { will_run: false, blocking: expect.arrayContaining([expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL' })]) } } });
  });
});

describe('failures claim nothing', () => {
  it('the Run turn failed: unavailable, and the route still hears the status', async () => {
    const p = product([graphRead('run_1')], { status: 500, json: {} });
    expect(await runAnalysis(p, ctx, ARGS, FREE)).toEqual({ status: 'unavailable', reason: 'run_failed', write: 'none', detail: 'HTTP 500' });
    expect(p.onAnalysis).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
  });

  it('the Run turn threw: unavailable', async () => {
    expect(await runAnalysis(product([graphRead('run_1')], new Error('socket')), ctx, ARGS, FREE))
      .toEqual({ status: 'unavailable', reason: 'run_failed', write: 'none' });
  });

  it('the read after the Run failed: not confirmed, never "ran"', async () => {
    expect(await runAnalysis(product([graphRead('run_1'), { status: 500, json: {} }], RUN_OK), ctx, ARGS, FREE))
      .toEqual({ status: 'unavailable', reason: 'run_not_confirmed', write: 'none' });
  });

  it('the scenario is not there: refused before any Run is asked for', async () => {
    const p = product([{ status: 404, json: {} }], RUN_OK);
    expect(await runAnalysis(p, ctx, ARGS, FREE)).toEqual({ status: 'refused', reason: 'not_found' });
    expect(p.dispatch).not.toHaveBeenCalledWith('/orchestrate/v2/turn', expect.anything());
  });

  it('an observer that throws never changes the outcome', async () => {
    const p = product([graphRead('run_1'), graphRead('run_2')], RUN_OK);
    p.onAnalysis.mockImplementation(() => { throw new Error('observer'); });
    expect(await runAnalysis(p, ctx, ARGS, FREE)).toMatchObject({ status: 'ok', ran: true });
  });
});

describe('consent and parameters', () => {
  it('an approval applied this turn never runs an analysis: nothing is dispatched', async () => {
    const p = product([graphRead('run_1'), graphRead('run_2')], RUN_OK);
    expect(await runAnalysis(p, ctx, ARGS, { approvalApplied: true })).toEqual({ status: 'refused', reason: 'run_not_requested' });
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['no timing', { reason: 'Run it.' }],
    ['an unknown timing', { reason: 'Run it.', effects_timing: 'soon' }],
    ['no reason', { reason: '', effects_timing: null }],
    ['an extra key', { reason: 'Run it.', effects_timing: null, force: true }],
  ] as const)('the parameters refuse %s', (_name, args) => {
    expect(RunAnalysisParams.safeParse(args).success).toBe(false);
  });
});
