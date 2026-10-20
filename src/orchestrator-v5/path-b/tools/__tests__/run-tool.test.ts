/**
 * PATH-B RUN ADAPTER (C5; gap 4, PATH-B): the Run is the route's EXISTING pipeline (`deps.runAnalysis`); the adapter claims
 * `ran` only when a fresh read selects THAT Run, by its own identity, on the model as it now stands. A decline keeps the
 * pipeline's own code and facts; a failure claims nothing; an approval this turn never runs. SYNTHETIC scenario.
 */
import { describe, expect, it, vi } from 'vitest';
import { RunAnalysisParams, runAnalysis } from '../run-tool.js';
import { traceRow } from '../outcome.js';
import { read, type Rec } from './fixtures.js';

const AT = '2026-10-19T11:00:00.000Z';
type Reply = { status: number; json: Rec } | Error;
/** A scripted product: the pipeline answers `run`; the graph route answers `reads` in order. */
function product(run: Rec | Error, reads: readonly Reply[]) {
  const queue = [...reads];
  const dispatch = vi.fn(async (path: string, _body: unknown) => {
    const next = queue.shift();
    if (next === undefined) throw new Error(`unscripted ${path}`);
    if (next instanceof Error) throw next;
    return next;
  });
  const pipeline = vi.fn(async (_args: unknown) => { if (run instanceof Error) throw run; return run; });
  return { dispatch, runAnalysis: pipeline };
}
/** The saved scenario as read: its revision, and the Run its analysis selects (id, the revision it ran on, when). */
const graphRead = (runId: string | null, hashAtRun = 'h_one', hash = 'h_one', at = AT): Reply => ({ status: 200, json: read({ graph_hash: hash,
  canonical_analysis_view: { staleness: { revision: 7, stale: false }, run: { run_id: runId, graph_hash_at_run: hashAtRun } },
  analysis_state: { run_state: { kind: runId === null ? 'never_run' : 'complete_current', computed_at: at } } }) });
/** The pipeline's own result for a Run it made (`capabilities.runAnalysis`): its identity, result and comparison. */
const RAN = { ok: true, mutated: false, ran: true, status: 'ready', result: { headline: 'synthetic' },
  run_identity: { scenario_id: 'scn_1', graph_hash_at_run: 'h_one', computed_at: AT }, run_comparison: { note: 'compare' } };
const ctx = { scenario_id: 'scn_1' };
const ARGS = { reason: 'The user asked to run it.', effects_timing: 'not_stated' as const };
const FREE = { approvalApplied: false };

describe('a Run is claimed only when the read selects that Run on the current model', () => {
  it('the pipeline ran and the read selects its Run: ok, ran, with the pipeline\'s own facts', async () => {
    const p = product(RAN, [graphRead('run_2')]);
    const out = await runAnalysis(p, ctx, ARGS, FREE);
    expect(out).toMatchObject({ status: 'ok', ran: true, mutated: false,
      data: { run_id: 'run_2', result: { headline: 'synthetic' }, run_comparison: { note: 'compare' } } });
    expect(traceRow('run_analysis', out)).toEqual({ name: 'run_analysis', ok: true, mutated: false, outcome: 'ok', refusal: null, ran: true });
    expect(p.runAnalysis).toHaveBeenCalledWith(ARGS);
  });

  it.each(['parcels', 'repairs'])('L11: %s exact dispatched inputs reach the Run tool, never substituted from today’s model', async subject => {
    const snapshot = { options: [
      { option_id: 'evening', settings: [{ factor_id: 'capacity', raw: 300, encoded: 0.3, unit: `${subject} per day` }] },
      { option_id: 'equipment', settings: [{ factor_id: 'capacity', raw: 250, encoded: 0.25, unit: `${subject} per day` }] },
    ] };
    const after = graphRead('run_2') as { status: number; json: Rec };
    after.json.analysis_run_evidence = { run_id: 'run_2', input_snapshot: snapshot };
    const out = await runAnalysis(product(RAN, [after]), ctx, ARGS, FREE);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') throw new Error('not recorded');
    expect(out.data.inputs_used).toEqual(snapshot);
    expect(out.data.inputs_used).not.toEqual(after.json.graph);
  });

  it.each(['missing', 'foreign'] as const)('L11: %s input evidence never borrows the saved model’s values', async kind => {
    const after = graphRead('run_2') as { status: number; json: Rec };
    if (kind === 'foreign') after.json.analysis_run_evidence = { run_id: 'run_1', input_snapshot: { options: [{ raw: 999 }] } };
    const out = await runAnalysis(product(RAN, [after]), ctx, ARGS, FREE);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') throw new Error('not recorded');
    expect(out.data.inputs_used).toBeNull();
  });

  it.each([
    ['the read selects another Run (another time)', graphRead('run_1', 'h_one', 'h_one', '2026-10-19T09:00:00.000Z')],
    ['the model has moved since the Run', graphRead('run_2', 'h_one', 'h_two')],
    ['no Run at all', graphRead(null)],
    // Codex R1 on #3469: the canonical view allows a current Run with no id; a matching revision and time is no receipt.
    ['a current Run on the right revision and time, with no Run id', { status: 200, json: read({ graph_hash: 'h_one',
      canonical_analysis_view: { staleness: { revision: 7, stale: false }, run: { run_id: null, graph_hash_at_run: 'h_one' } },
      analysis_state: { run_state: { kind: 'complete_current', computed_at: AT } } }) } as Reply],
  ] as const)('%s: unavailable, never "ran", and no result is passed on', async (_name, after) => {
    const out = await runAnalysis(product(RAN, [after]), ctx, ARGS, FREE);
    expect(out).toEqual({ status: 'unavailable', reason: 'run_not_recorded', write: 'none' });
    expect(traceRow('run_analysis', out).ran).toBeNull();
  });

  it('the pipeline gave an engine outcome and no result: refused, with its own facts', async () => {
    const out = await runAnalysis(product({ ok: true, mutated: false, ran: false, what_is_missing: 'A goal level.' }, []), ctx, ARGS, FREE);
    expect(out).toEqual({ status: 'refused', reason: 'run_blocked', data: { ran: false, what_is_missing: 'A goal level.' } });
  });

  it('the pipeline declined with its own code (a spent Run press): refused with that code', async () => {
    const out = await runAnalysis(product({ ok: false, mutated: false, ran: false, refusal: 'run_press_consumed' }, []), ctx, ARGS, FREE);
    expect(out).toMatchObject({ status: 'refused', reason: 'run_press_consumed' });
  });
});

describe('failures claim nothing', () => {
  it('the Run failed: unavailable, with the pipeline\'s own facts', async () => {
    const out = await runAnalysis(product({ ok: false, mutated: false, ran: false, refusal: 'run_failed', http: 500 }, []), ctx, ARGS, FREE);
    expect(out).toEqual({ status: 'unavailable', reason: 'run_failed', write: 'none', data: { ran: false, refusal: 'run_failed', http: 500 } });
  });

  it('the pipeline threw: unavailable', async () => {
    expect(await runAnalysis(product(new Error('socket'), []), ctx, ARGS, FREE)).toEqual({ status: 'unavailable', reason: 'run_failed', write: 'none' });
  });

  it('the read after the Run failed: not confirmed, never "ran"', async () => {
    expect(await runAnalysis(product(RAN, [{ status: 500, json: {} }]), ctx, ARGS, FREE))
      .toEqual({ status: 'unavailable', reason: 'run_not_confirmed', write: 'none' });
  });
});

describe('consent and parameters', () => {
  it('an approval applied this turn never runs an analysis: the pipeline is not asked', async () => {
    const p = product(RAN, [graphRead('run_2')]);
    expect(await runAnalysis(p, ctx, ARGS, { approvalApplied: true })).toEqual({ status: 'refused', reason: 'run_not_requested' });
    expect(p.runAnalysis).not.toHaveBeenCalled();
    expect(p.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['no timing', { reason: 'Run it.' }],
    ['an unknown timing', { reason: 'Run it.', effects_timing: 'soon' }],
    ['no reason', { effects_timing: null }],
    ['an extra key', { reason: 'Run it.', effects_timing: null, force: true }],
  ] as const)('the parameters refuse %s', (_name, args) => {
    expect(RunAnalysisParams.safeParse(args).success).toBe(false);
  });
});
