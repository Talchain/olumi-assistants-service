/**
 * ⭐⭐ WHICH AUTHORITY THE RECEIVING DECISION READS.
 *
 * ⛔ THE DEFECT THIS PINS, found by independent review of `39557a98`
 *    (`5592620999`): the receiving branch gated on `mayNameLeadingOptionForRun`,
 *    which resolves through `claim-safety-read.ts:412-415` ->
 *    `constraint-feasibility.ts:1042-1053` to the persisted CONSTRAINT verdict.
 *    That is ENTITLEMENT. It says nothing about whether the run separated the
 *    arms. So an entitled `quantified_provisional` run with
 *    `near_tie.is_tie = true` was told by `PROVISIONAL_FIGURES_INSTRUCTION`
 *    that its options ARE separable — a false deterministic premise — while the
 *    final wire arm, which does read separation, refused that same population.
 *
 * The two consumers now ask ONE question through ONE authority:
 * `separationEstablishedFromRobustness`, which `composeLeaderClaim` itself uses
 * to publish `analysis_state.leader_claim.separation`. A copy would be trap 12.
 *
 * ⚠ SCOPE, STATED SO IT IS NOT OVER-READ. These cases bind the DERIVATION the
 *   receiving branch performs — the shared reader over real schema-parsed
 *   `run_analysis` facts, and the exact-mode requirement — not a full
 *   `runTurnExecutor` walk. The end-to-end receiving control the reviewer asked
 *   for needs the DB-backed executor harness and is NOT supplied here; it is
 *   named as the outstanding obligation in the PR and receipt rather than
 *   implied by this file.
 *
 * NOT RUN LOCALLY: hosted-only under root's resource direction.
 */
import { describe, expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { pickLatestRawRobustness } from '../../coaching/pick-raw-robustness.js';
import { separationEstablishedFromRobustness } from '../../compose/analysis-state-v1.js';
import {
  analysisReadyPermitsLeaderNaming,
  permittedAnalysisModeFromAnalysisReady,
} from '../../admission/analysis-admission.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fact(robustness: unknown): RunAnalysisHandlerFact {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      graph_hash_at_run: 'e6aceffe33a51baf',
      computed_at: '2026-09-08T19:18:21.292Z',
      leading_option_id: 'option-a',
      summary: 'Adopt RudderStack scored highest against your goal in 55% of runs.',
      win_probabilities: { 'option-a': 0.55, 'option-b': 0.36 },
      // ENTITLED on every fixture below — that is the point: entitlement is held
      // constant so only separation can move the answer.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: { analysis_status: 'completed', ...(robustness as object) },
    },
  });
}

function readiness(mode: string | null): unknown {
  return mode === null
    ? {}
    : { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } };
}

/** The receiving branch's population test, expressed exactly as the executor's. */
function qualifies(facts: readonly RunAnalysisHandlerFact[], analysisReady: unknown): boolean {
  return (
    !analysisReadyPermitsLeaderNaming(analysisReady) &&
    separationEstablishedFromRobustness(pickLatestRawRobustness(facts)) &&
    permittedAnalysisModeFromAnalysisReady(analysisReady) === 'quantified_provisional'
  );
}

const SEPARATED = fact({ robustness: { level: 'moderate', near_tie: { is_tie: false } } });
const NEAR_TIE = fact({ robustness: { level: 'moderate', near_tie: { is_tie: true } } });
const NO_SEPARATION_SIGNAL = fact({});

describe('the qualified population reads SEPARATION, never entitlement alone', () => {
  it('entitled + separated + provisional qualifies', () => {
    expect(qualifies([SEPARATED], readiness('quantified_provisional'))).toBe(true);
  });

  it('⭐ entitled + NEAR TIE + provisional does NOT qualify — the reported defect', () => {
    // Entitlement is identical to the case above; only separation differs. Under
    // the reviewed head this returned true and the coach was told the options
    // were separable.
    expect(qualifies([NEAR_TIE], readiness('quantified_provisional'))).toBe(false);
  });

  it('⭐ entitled + UNKNOWN separation + provisional does NOT qualify — absence is not permission', () => {
    expect(qualifies([NO_SEPARATION_SIGNAL], readiness('quantified_provisional'))).toBe(false);
    expect(qualifies([], readiness('quantified_provisional'))).toBe(false);
  });

  it('⭐ a lower mode does not qualify, even when separated', () => {
    // The second half of the same finding: any non-null below-comparative mode
    // used to qualify, while the final arm required exactly the provisional cap.
    expect(qualifies([SEPARATED], readiness('exploratory'))).toBe(false);
    expect(qualifies([SEPARATED], readiness('none'))).toBe(false);
  });

  it('a permitting admission does not qualify — it is already permitted', () => {
    expect(qualifies([SEPARATED], readiness('comparative_leader'))).toBe(false);
  });

  it('missing admission does not qualify — legacy compatibility retained', () => {
    expect(qualifies([SEPARATED], readiness(null))).toBe(false);
  });

  it('the shared authority agrees with the published separation semantics', () => {
    // Positive control: the predicate must actually discriminate, or every case
    // above passes by testing nothing (trap #13).
    expect(separationEstablishedFromRobustness(pickLatestRawRobustness([SEPARATED]))).toBe(true);
    expect(separationEstablishedFromRobustness(pickLatestRawRobustness([NEAR_TIE]))).toBe(false);
  });
});
