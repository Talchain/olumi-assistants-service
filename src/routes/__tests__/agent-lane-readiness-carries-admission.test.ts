/**
 * ⛔⛔ THE AGENT (OpenAI) LANE'S READINESS PAYLOAD IS BUILT IN ONE PLACE, AND
 * IT WAS OMITTING THE RUN ADMISSION.
 *
 * `readBackState` fills `analysis_ready` from the graph when the graph read did
 * not supply one. Measured, that branch is ALWAYS taken:
 * `/assist/v1/scenarios/:id/graph` never sends `analysis_ready` at all — its
 * 200 carries `graph_hash`, `layout_present`, `not_modelled` and friends. So
 * this is not a fallback in practice; it is the whole producer for this lane.
 *
 * It used `assessCanonicalAnalysisReadiness(...).analysisReady`, which does not
 * compute `may_run`. The client gates the Run affordance on
 * `admitsRunAffordance(status, may_run) = status === 'ready' || may_run === true`,
 * so with `may_run` absent it falls back to the stricter `status` term — and
 * 108 of 400 real persisted models (27.0%) are `may_run: true` under a
 * NON-ready status. Those users can run the analysis and are never offered it,
 * on exactly the turn this code path exists to serve.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readBackState } from '../agent-v1-turn.js';

/**
 * A REAL persisted user model, anonymised and verified to yield the same
 * verdict as the original: `status: needs_user_input`, `may_run: true` — i.e.
 * the admissible-but-not-ready shape this whole fix is about.
 */
const GRAPH = JSON.parse(
  readFileSync(
    new URL('../../orchestrator-v5/handlers/__tests__/fixtures/admissible-not-ready.graph.json', import.meta.url),
    'utf8',
  ),
) as unknown;

/** Mirrors the real route: 200, a graph, and NO `analysis_ready`. */
const dispatch = async () => ({ status: 200, json: { graph_hash: 'h1', graph: GRAPH } }) as never;

describe('agent-lane readback publishes the run admission', () => {
  it('⭐ carries may_run, so the Run affordance is not withheld from OpenAI users', async () => {
    const state = await readBackState(dispatch as never, 'scn_1');
    const ready = state.analysisReady as { status?: unknown; may_run?: unknown } | undefined;
    expect(ready, 'the lane must publish a readiness payload at all').toBeDefined();
    // CONTRAST CONTROL: `status` was always present. Its presence proves the
    // payload is real, so a missing `may_run` is a genuine absence rather than
    // an empty response.
    expect(typeof ready?.status).toBe('string');
    expect(typeof ready?.may_run).toBe('boolean');
  });

  it('⭐ and this fixture is the case that matters: admissible while NOT ready', async () => {
    const state = await readBackState(dispatch as never, 'scn_1');
    const ready = state.analysisReady as { status?: string; may_run?: boolean };
    expect(ready.may_run).toBe(true);
    expect(ready.status).not.toBe('ready');
  });

  it('CONTROL: a graph read that DOES supply analysis_ready still wins — it reflects a real run', async () => {
    const withRun = async () =>
      ({ status: 200, json: { graph_hash: 'h1', graph: GRAPH, analysis_ready: { status: 'ready', may_run: false, from: 'a real run' } } }) as never;
    const state = await readBackState(withRun as never, 'scn_1');
    expect((state.analysisReady as { from?: string }).from).toBe('a real run');
  });

  it('CONTROL: a readback failure loses neither the turn nor the answer', async () => {
    const boom = async () => { throw new Error('network'); };
    const state = await readBackState(boom as never, 'scn_1');
    expect(state.analysisReady).toBeUndefined();
  });
});
