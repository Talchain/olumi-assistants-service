/**
 * G3 AT THE WIRE — a saved analysis that has ROLLED OUT OF THE BOUNDED HOT
 * WINDOW must stay identifiable and must be marked as belonging to an earlier
 * revision. It must never be reported as "never run", and a failed read must
 * stay distinguishable from no analysis.
 *
 * ⚠ THE DEFECT IS A FACT-SET DEFECT, NOT A HASH DEFECT. The wire verdict is
 * derived over `context.prior_facts` — the bounded ~20-turn window. Once a saved
 * `run_analysis` fact rolls out of it, `selectRunAnalysisFact` returns null and
 * the wire says `none` / `no_successful_run_analysis_fact`, which the contract
 * renders as `run_state.kind: 'never_run'` ("no analysis has ever been run … a
 * consumer renders the pre-analysis affordance"). The durable verdict that knows
 * better exists on the same turn and, before this change, reached only the
 * prompt.
 *
 * WHAT IS ASSERTED HERE, and why each assertion exists:
 *
 *  · THE DISCRIMINATING PAIR. Every case is run TWICE through the same
 *    `finaliseV5Response` call with the SAME window derivation — once without
 *    the supersession members and once with them. The "without" arm must still
 *    say `never_run`. Without that arm the "with" arm proves only that some
 *    code ran, not that it changed the answer (trap 13b: a guard agreeing with
 *    itself).
 *
 *  · THE NON-MIGRATION. The authoritative top-level `graph_hash` is asserted
 *    BYTE-IDENTICAL across the pair. It reads `ctx.freshness.current_graph_hash`
 *    three statements below the `analysis_ready` stamp, and the wire-bound
 *    derivation is re-derived post-dispatch against the POST-EDIT hash on a
 *    mutating turn. An implementation that "simplified" this by overwriting
 *    `ctx.freshness` at the route seam passes every other assertion in this
 *    file and REDs this one.
 *
 *  · THE RUN-FACT BINDING EXCLUSION. `selected_fact_index` is array-relative by
 *    contract, and a superseding canonical state's index is a position in the
 *    DURABLE array — which the finaliser does not have. Left in the
 *    `hasRunToBind` disjunct it flips the binding on for a turn whose hot window
 *    holds no fact, hands the identity comparator an `undefined` left-hand side,
 *    and emits `unknown_degraded` / `store_unreadable` with the leader claim
 *    withheld — a WORSE answer than the `never_run` being corrected, from a
 *    fully green path. The `priorFacts`-bearing cases below are what make that
 *    fail loud.
 */

import { describe, expect, it } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { finaliseV5Response } from '../response-finaliser.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { resolveScenarioAnalysisSupersession } from '../context/scenario-analysis-supersession.js';
import { canonicalStateFromFreshness } from '../context/canonical-analysis-state.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANALYSED_HASH = 'hash_analysed_0001';
const CURRENT_HASH = 'hash_current_0002';
const SAVED_COMPUTED_AT = '2026-09-01T09:00:00.000Z';

function savedRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Saved analysis',
      graph_hash_at_run: ANALYSED_HASH,
      computed_at: SAVED_COMPUTED_AT,
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  } as unknown as HandlerFact;
}

/**
 * The hot window on the turn under test. It is NOT empty — it carries an
 * unrelated fact — because an empty array would be indistinguishable from
 * "no facts were threaded" and would not exercise the binding path at all.
 */
const HOT_WINDOW_WITHOUT_ANALYSIS: readonly HandlerFact[] = [
  {
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: { scenario_id: SCENARIO_ID, applied: true },
  } as unknown as HandlerFact,
];

/** The durable scenario history, which still holds the saved analysis. */
const DURABLE_WITH_ANALYSIS: readonly HandlerFact[] = [savedRunAnalysisFact()];

const windowFreshness = deriveAnalysisFreshness(
  HOT_WINDOW_WITHOUT_ANALYSIS,
  CURRENT_HASH,
  undefined,
  { priorFactsReadOk: true },
);
const scenarioFreshness = deriveAnalysisFreshness(
  DURABLE_WITH_ANALYSIS,
  CURRENT_HASH,
  undefined,
  { priorFactsReadOk: true },
);

function readyPayload(): AnalysisReadyPayload {
  return {
    status: 'ready',
    goal_node_id: 'goal_q3',
    options: [
      {
        option_id: 'opt_status_quo',
        label: 'Hold',
        status: 'ready',
        interventions: { fac_capacity: 0 },
        is_baseline: true,
      },
    ],
  } as AnalysisReadyPayload;
}

function baseResponse(): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: 'Here is where the model stands.',
    stage_indicator: 'analyse',
    blocks: [],
    suggested_actions: [],
    insights: [],
  } as unknown as OlumiResponse;
}

type FinaliserCtx = Parameters<typeof finaliseV5Response>[1];

/**
 * Finalise with the SAME window derivation both ways. `superseded: true` adds
 * exactly the two members the route seam attaches — nothing else differs.
 */
function finalise(opts: {
  readonly superseded: boolean;
  readonly priorFacts?: readonly HandlerFact[];
}): Record<string, unknown> {
  const supersession = resolveScenarioAnalysisSupersession({
    windowFreshness,
    scenarioFreshness,
    readiness: readyPayload(),
  });
  const ctx = {
    analysisReady: readyPayload(),
    freshness: windowFreshness,
    graph: null,
    mayNameLeadingOption: true,
    ...(opts.priorFacts !== undefined ? { priorFacts: opts.priorFacts } : {}),
    ...(opts.superseded
      ? {
          analysisStateFreshness: supersession!.freshness,
          analysisStateCanonical: supersession!.canonicalState,
        }
      : {}),
  };
  return finaliseV5Response(baseResponse(), ctx as unknown as FinaliserCtx) as unknown as Record<
    string,
    unknown
  >;
}

function runStateOf(body: Record<string, unknown>): Record<string, unknown> {
  const state = body.analysis_state as Record<string, unknown> | undefined;
  expect(state, 'analysis_state must be present on every exit').toBeDefined();
  return state!.run_state as Record<string, unknown>;
}

function readyOf(body: Record<string, unknown>): Record<string, unknown> {
  const ready = body.analysis_ready as Record<string, unknown> | undefined;
  expect(ready, 'analysis_ready must be stamped on this turn').toBeDefined();
  return ready!;
}

describe('G3 — preconditions of this whole file', () => {
  it('the window has lost the analysis and the durable set still holds it', () => {
    // Trap 13b — pin the precondition in-test. If either of these stopped
    // holding, the "without" arm would no longer be the defect and the "with"
    // arm would no longer be the fix, and both would still be green.
    expect(windowFreshness.freshness).toBe('none');
    expect(windowFreshness.reason).toBe('no_successful_run_analysis_fact');
    expect(scenarioFreshness.freshness).toBe('stale');
    expect(scenarioFreshness.computed_at).toBe(SAVED_COMPUTED_AT);
    // …and the supersession's own preconditions: same current graph, so the
    // gate is passed for the right reason and not by a null-equals-null.
    expect(windowFreshness.current_graph_hash).toBe(CURRENT_HASH);
    expect(scenarioFreshness.current_graph_hash).toBe(CURRENT_HASH);
  });
});

describe('G3 — analysis_state (migrated reader 2 of 2)', () => {
  it('WITHOUT the supersession the wire still says "never run" — the defect, reproduced', () => {
    expect(runStateOf(finalise({ superseded: false })).kind).toBe('never_run');
  });

  it('WITH it the saved analysis is identifiable and marked as an earlier revision', () => {
    const run = runStateOf(finalise({ superseded: true }));
    // Bound by identity: the state names the saved run's own timestamp, so this
    // cannot pass on some other fact that merely happens to be stale.
    expect(run.kind).toBe('complete_stale');
    expect(run.computed_at).toBe(SAVED_COMPUTED_AT);
    expect(run.cause).toBe('graph_changed');
  });

  it('and it is NOT reported as a failed read — the two stay distinguishable', () => {
    const run = runStateOf(finalise({ superseded: true }));
    expect(run.kind).not.toBe('unknown_degraded');
    expect(run.cause).not.toBe('store_unreadable');
  });
});

describe('G3 — the run-fact binding exclusion (selected_fact_index is array-relative)', () => {
  it('a hot window WITH facts but WITHOUT an analysis still yields the earlier-revision state', () => {
    // This is the case that distinguishes a correct implementation from one
    // that leaves the superseding index in the `hasRunToBind` disjunct. That
    // one emits `unknown_degraded` / `store_unreadable` here.
    const run = runStateOf(
      finalise({ superseded: true, priorFacts: HOT_WINDOW_WITHOUT_ANALYSIS }),
    );
    expect(run.kind).toBe('complete_stale');
    expect(run.computed_at).toBe(SAVED_COMPUTED_AT);
  });

  it('…and the leader claim is not withheld for a fabricated identity conflict', () => {
    const state = finalise({
      superseded: true,
      priorFacts: HOT_WINDOW_WITHOUT_ANALYSIS,
    }).analysis_state as Record<string, unknown>;
    const claim = state.leader_claim as Record<string, unknown>;
    expect(claim.withheld_reason).not.toBe('run_identity_unconfirmed');
    expect(claim.withheld_reason).not.toBe('run_identity_conflict');
  });

  it('CONTRAST: the same turn WITHOUT the supersession is `never_run`, not degraded', () => {
    // Proves the previous two cases are observing the supersession and not
    // simply a turn on which nothing could go wrong.
    const run = runStateOf(
      finalise({ superseded: false, priorFacts: HOT_WINDOW_WITHOUT_ANALYSIS }),
    );
    expect(run.kind).toBe('never_run');
  });
});

describe('G3 — analysis_ready.freshness (migrated reader 1 of 2)', () => {
  it('reports the durable verdict and the saved run\'s own timestamp', () => {
    const ready = readyOf(finalise({ superseded: true }));
    expect(ready.freshness).toBe('stale');
    expect(ready.freshness_reason).toBe('graph_hash_diverged');
    expect(ready.graph_hash_at_run).toBe(ANALYSED_HASH);
    expect(ready.computed_at).toBe(SAVED_COMPUTED_AT);
  });

  it('CONTRAST: without it the block ships `none` and no run hash at all', () => {
    const ready = readyOf(finalise({ superseded: false }));
    expect(ready.freshness).toBe('none');
    expect(ready.graph_hash_at_run).toBeUndefined();
  });
});

describe('G3 — the readers that must NOT move', () => {
  it('the authoritative top-level graph_hash is byte-identical across the pair', () => {
    // `graph_hash` is stamped from `ctx.freshness.current_graph_hash`, which on
    // a mutating turn is the POST-EDIT hash while the scenario derivation holds
    // the PRE-dispatch one. Overwriting `ctx.freshness` at the route seam —
    // the "obvious" simplification — rewrites this stamp on exactly the edit
    // turns G3 is about. Both arms must read the CURRENT graph, never the
    // analysed one.
    const withOut = finalise({ superseded: false });
    const withIn = finalise({ superseded: true });
    expect(withOut.graph_hash).toBe(CURRENT_HASH);
    expect(withIn.graph_hash).toBe(CURRENT_HASH);
    expect(withIn.graph_hash).toBe(withOut.graph_hash);
    expect(withIn.graph_hash).not.toBe(ANALYSED_HASH);
  });

  it('⭐ graph_hash reports `ctx.freshness` even when the RESOLVED derivation describes another graph', () => {
    // ⚠ THIS CASE CANNOT ARISE THROUGH THE ROUTE SEAM, AND IS HERE ON PURPOSE.
    // `resolveScenarioAnalysisSupersession` requires both derivations to name
    // the same current graph, so no supersession it produces can move this
    // stamp — which means the assertion above, on its own, cannot be bitten by
    // a single-site mutant and proves less than it appears to (trap 13b: a
    // guard whose discrimination depends on a precondition holding elsewhere).
    //
    // So this pins the FINALISER'S OWN contract directly, with the two members
    // supplied by hand: whatever the resolved derivation says, `graph_hash` is
    // stamped from the WIRE-bound derivation. That is what keeps the design
    // safe if the route gate is ever loosened, and it is exactly the property
    // an implementation that overwrote `ctx.freshness` would lose.
    const divergent = deriveAnalysisFreshness(
      DURABLE_WITH_ANALYSIS,
      ANALYSED_HASH,
      undefined,
      { priorFactsReadOk: true },
    );
    expect(divergent.current_graph_hash).toBe(ANALYSED_HASH);
    expect(divergent.current_graph_hash).not.toBe(windowFreshness.current_graph_hash);

    const body = finaliseV5Response(baseResponse(), {
      analysisReady: readyPayload(),
      freshness: windowFreshness,
      graph: null,
      mayNameLeadingOption: true,
      analysisStateFreshness: divergent,
      analysisStateCanonical: canonicalStateFromFreshness(divergent, {
        readiness: readyPayload(),
      }),
    } as unknown as FinaliserCtx) as unknown as Record<string, unknown>;

    // The analysis-state surfaces DID move — proving the members were consumed
    // and this is not a case where nothing happened.
    expect((body.analysis_ready as Record<string, unknown>).freshness).toBe('fresh');
    // …and the authoritative stamp did NOT.
    expect(body.graph_hash).toBe(CURRENT_HASH);
    expect(body.graph_hash).not.toBe(ANALYSED_HASH);
  });

  it('`analysis_ready.current_graph_hash` likewise still describes the CURRENT graph', () => {
    // Both derivations were taken against the same current graph (that is the
    // supersession's own gate), so this must hold — and it is the observable
    // that would move first if the gate were ever dropped.
    expect(readyOf(finalise({ superseded: true })).current_graph_hash).toBe(CURRENT_HASH);
  });
});
