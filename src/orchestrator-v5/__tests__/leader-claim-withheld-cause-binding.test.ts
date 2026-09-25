/**
 * THE FINALISER NAMES A WITHHOLD CAUSE ONLY WHEN THE CALLER THAT DECIDED THE
 * REFUSAL STATES IT — it never re-derives the cause from a fact it picked itself.
 *
 * CHANGES_REQUIRED on #1876 @ ca95bfd6 (cse_01QTxNzZBqXqN2eUoJUieiZk): the
 * finaliser computed `withheldBecauseUnrequested` from `selectRunAnalysisFact`
 * (the FRESHNESS selector: newest successful fact) while the refusal it was
 * explaining came from `readMayNameLeadingOptionVerdict` (the ENTITLEMENT
 * selector: newest fact of any status, unioned with the durable newest fact,
 * over the POST-handler fact set). Two facts, one sentence: a user's own Run
 * whose limits genuinely failed was called "an automatic first pass nobody
 * asked for".
 *
 * WHY THE FINALISER CANNOT BIND THE CAUSE ITSELF (so the fix is to thread it,
 * not to compare selectors): the verdict's source fact is not on its context.
 * It can come from (a) a partial fact the freshness selector skips, (b) this
 * turn's own run, while several exits hand the finaliser the PRE-handler window
 * (`turn-executor.ts`, `priorFacts: context.prior_facts`), or (c) the durable
 * newest fact (`ClaimSafetyScenarioScope.newestAnalysisFact`). Cells B and C
 * below survive a "claim-bearing fact === selected fact" check, which is why
 * that check is not the fix.
 *
 * And no production turn exit refuses for the unrequested reason: the turn
 * verdict is constraint-only (`turn-executor.ts` → `readMayNameLeadingOptionVerdict`),
 * and the Agent lane serves `leader_claim` from the reload read, which binds the
 * cause to one fact (`scenario-graph-analysis-read.ts`). So absence of the
 * caller's statement = the constraint token, which is base behaviour.
 *
 *   RED A  B-newer-partial: auto first pass A permits; the user's newer partial
 *          run B withholds on its limits → `constraint_verdict_withheld`.
 *   RED B  this turn's run is not in the finaliser's window: window [A], the
 *          verdict read [A, B] → `constraint_verdict_withheld`.
 *   RED C  the durable newest fact refuses: window [A], scope newest = B
 *          → `constraint_verdict_withheld`.
 *   CONTROL D  the caller states the refusal was the unrequested confinement
 *          → `unrequested_analysis_withheld` (the only way the code is named).
 *   CONTROL E  the caller's statement cannot put an entitlement cause on an
 *          entitled turn.
 */
import { describe, expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { buildAnalysisResultBlock, composeDirectAnswerResponse } from '../compose.js';
import { finaliseV5Response } from '../response-finaliser.js';
import { readMayNameLeadingOptionVerdict } from '../context/claim-safety-read.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { canonicalStateFromFreshness } from '../context/canonical-analysis-state.js';
import { leaderWithheldOnlyBecauseUnrequested } from '../compose/unrequested-analysis-confinement.js';

const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH as never)!;

function runFact(opts: { at: string; mayName: boolean; auto: boolean; status: 'completed' | 'partial' }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: opts.at, graph_hash_at_run: HASH,
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.',
      win_probabilities: { 'option-a': 0.65, 'option-b': 0.35 },
      constraint_verdict: {
        may_name_leading_option: opts.mayName,
        constraint_verdict_state: opts.mayName ? 'evaluated_feasible' : 'evaluated_infeasible',
      },
      enrichment: {
        analysis_status: opts.status,
        robustness: { level: 'strong', near_tie: { is_tie: false } },
        ...(opts.auto ? { run_provenance: { initiated_by: 'auto_post_draft' } } : {}),
      },
    },
  });
}

/** The automatic first pass: its own verdict PERMITS a leader; nobody asked for it. */
const A = runFact({ at: '2026-09-25T01:00:00.000Z', mayName: true, auto: true, status: 'completed' });

type Fact = ReturnType<typeof runFact>;

function finalise(window: readonly Fact[], mayNameLeadingOption: boolean, extra: Record<string, unknown> = {}) {
  const freshness = deriveAnalysisFreshness(window, HASH, undefined, { priorFactsReadOk: true });
  const analysisReady = { status: 'ready' as const, goal_node_id: 'goal', options: [], analysis_admission: { permitted_analysis_mode: 'comparative_leader' } };
  const response = composeDirectAnswerResponse({
    assistant_text: 'Here is where the analysis stands.', stage: 'analyse', answerKind: 'substantive',
    blocks: [buildAnalysisResultBlock(A, analysisReady as never)],
  });
  return finaliseV5Response(response, {
    scenarioId: SCENARIO,
    analysisReady: analysisReady as never,
    freshness,
    canonicalState: canonicalStateFromFreshness(freshness, {}),
    priorFacts: window,
    mayNameLeadingOption,
    ...extra,
  } as never);
}

describe('the finaliser binds a withheld leader\'s cause to the refusal, never to a fact it picked', () => {
  it('premise: A alone is a leader-permitting, unrequested fact (the predicate the finaliser used to apply)', () => {
    expect(leaderWithheldOnlyBecauseUnrequested(A)).toBe(true);
  });

  it('RED A — the user\'s newer PARTIAL run withholds on its limits: the cause is the constraint verdict', () => {
    const B = runFact({ at: '2026-09-25T02:00:00.000Z', mayName: false, auto: false, status: 'partial' });
    const verdict = readMayNameLeadingOptionVerdict([A, B], { newestAnalysisFact: null, readOk: true, windowTruncated: false });
    expect(verdict.may_name_leading_option, 'premise: the production verdict refuses (B\'s limits)').toBe(false);
    expect(verdict.constraint_verdict_state).toBe('evaluated_infeasible');
    const out = finalise([A, B], verdict.may_name_leading_option);
    expect(out.analysis_state?.leader_claim.permitted).toBe(false);
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('RED B — this turn\'s own run refused, but the finaliser was handed the pre-handler window [A]', () => {
    const B = runFact({ at: '2026-09-25T02:00:00.000Z', mayName: false, auto: false, status: 'completed' });
    const verdict = readMayNameLeadingOptionVerdict([A, B], { newestAnalysisFact: null, readOk: true, windowTruncated: false });
    expect(verdict.may_name_leading_option, 'premise: the post-handler verdict refuses').toBe(false);
    const out = finalise([A], verdict.may_name_leading_option);
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('RED C — the durable newest fact refused; the window holds only A', () => {
    const B = runFact({ at: '2026-09-25T02:00:00.000Z', mayName: false, auto: false, status: 'completed' });
    const verdict = readMayNameLeadingOptionVerdict([A], { newestAnalysisFact: B, readOk: true, windowTruncated: true });
    expect(verdict.may_name_leading_option, 'premise: the durable newest fact refuses').toBe(false);
    const out = finalise([A], verdict.may_name_leading_option);
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe('constraint_verdict_withheld');
  });

  it('CONTROL D — the caller that refused states the unrequested cause: the finaliser names it', () => {
    const out = finalise([A], false, { leaderWithheldBecauseUnrequested: true });
    expect(out.analysis_state?.leader_claim.permitted).toBe(false);
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe('unrequested_analysis_withheld');
  });

  it('CONTROL E — an entitled turn never names an entitlement cause, whatever the caller states', () => {
    // This minimal body carries no robustness, so an ENTITLED turn is still
    // withheld — on the separation half. The property pinned is that the
    // caller's statement cannot put an ENTITLEMENT cause on an entitled turn.
    const out = finalise([A], true, { leaderWithheldBecauseUnrequested: true });
    const reason = out.analysis_state?.leader_claim.withheld_reason;
    expect(reason, 'premise: the separation half names its own cause').toBeDefined();
    expect(reason).not.toBe('unrequested_analysis_withheld');
    expect(reason).not.toBe('constraint_verdict_withheld');
  });
});
