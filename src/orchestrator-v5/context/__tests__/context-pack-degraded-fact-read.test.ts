/**
 * CONTEXT/MEMORY V5 defect 4 — THE LLM-FACING ROUTE.
 *
 * `deriveContextPackAnalysisState` already guards ONE of the two empties: when
 * `priorFacts` is omitted entirely it logs a diagnostic and returns `null`
 * rather than an authoritative-looking `'none'` (assembler docblock, ~:1265).
 * It did NOT guard the other: facts WERE wired, the read THREW, and the array
 * arrived as `[]`. That empty derived a positive `'none' /
 * no_successful_run_analysis_fact` verdict straight into `ContextPack
 * .analysis_state` — the projection the routing prompt is built from.
 *
 * WHY THIS ROUTE NEEDED ITS OWN THREADING RATHER THAN INHERITING ONE. The
 * turn-executor's `assembleContextPackWithSummary` call passes NO
 * `canonicalState`, so the short-circuit at the top of
 * `deriveContextPackAnalysisState` does not fire and the assembler's own
 * `selectCanonicalAnalysisState` call IS the pack's freshness authority. The
 * six sites D4 threaded are all in `turn-executor.ts` and none of them feeds
 * this one.
 *
 * WHAT WOULD HAVE TO BE TRUE for these to pass while the property is broken:
 * the new input field could be accepted and dropped before the selector
 * (covered — the degraded arm asserts the VERDICT changes, not that the field
 * exists); it could fire on an ordinary empty scenario (covered by the ok-arm
 * control); or it could override a real fact (covered by the fact arm, which
 * pins the degraded flag as inert whenever a fact was actually selected).
 */

import { describe, it, expect } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack, type GraphWithOptions } from '../context-pack-assembler.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';

const PAYLOAD = makeMessagePayload();

/** Same shape as `context-pack-analysis-state.test.ts` — a hashable raw graph. */
const graph: GraphWithOptions = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'a', kind: 'option', label: 'A' },
    { id: 'b', kind: 'option', label: 'B' },
    { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 100 } },
  ],
  edges: [{ from: 'f', to: 'goal' }],
};

const HASH = computeAnalysisAffectingGraphHash(
  graph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
)!;

/**
 * ⚠ SHAPE DERIVED FROM THE PRODUCER (`viewRunAnalysisFact` reads
 * `graph_hash_at_run` from `result` and requires `noop === false`), copied from
 * the sibling spec rather than reinvented.
 */
function runAnalysisFact(graphHash: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 's',
      leading_option_id: 'a',
      summary: 'ran',
      enrichment: { analysis_status: 'computed' },
      graph_hash_at_run: graphHash,
      computed_at: '2026-05-01T00:00:00.000Z',
    },
  };
}

describe('ContextPack analysis_state — a degraded fact read is not "never analysed"', () => {
  it('DEGRADED read: unknown / derivation_failed, never none', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [],
      priorFactsReadOk: false,
      graph,
    });

    // Pin the precondition: the pack DID derive a state (rather than returning
    // null down the `priorFacts === undefined` path), so the assertions below
    // are about the derivation and not about the omission branch.
    expect(pack.analysis_state).not.toBeNull();
    expect(pack.analysis_state!.freshness).toBe('unknown');
    expect(pack.analysis_state!.freshness_reason).toBe('derivation_failed');
  });

  it('CONTROL (ok arm): a healthy empty read is still genuinely none', () => {
    // The discriminating twin. Without it, a fix that downgraded EVERY empty
    // read would pass the arm above while telling every genuinely-new scenario
    // that its freshness could not be derived.
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [],
      priorFactsReadOk: true,
      graph,
    });
    expect(pack.analysis_state!.freshness).toBe('none');
    expect(pack.analysis_state!.freshness_reason).toBe('no_successful_run_analysis_fact');
  });

  it('CONTROL (absent flag): unwired callers keep the pre-fix verdict exactly', () => {
    // Back-compatibility. Most callers (and every existing test) omit the field;
    // widening the input type must not change what they get.
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [],
      graph,
    });
    expect(pack.analysis_state!.freshness).toBe('none');
    expect(pack.analysis_state!.freshness_reason).toBe('no_successful_run_analysis_fact');
  });

  it('a fact that WAS read stays authoritative — the degraded flag never blanks it', () => {
    // Bounds the change: the flag speaks ONLY to the absence of facts. Even with
    // the degraded flag set, a selected fact whose hash matches must still read
    // `fresh` — otherwise the fix would be a fail-closed sledgehammer that
    // discards good analyses on an unrelated read failure.
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      priorFacts: [runAnalysisFact(HASH)],
      priorFactsReadOk: false,
      graph,
    });
    expect(pack.analysis_state!.freshness).toBe('fresh');
    expect(pack.analysis_state!.usable_for_chips).toBe(true);
    expect(pack.analysis_state!.requires_rerun).toBe(false);
  });
});
