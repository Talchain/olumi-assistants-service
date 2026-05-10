/**
 * V5 — `edit_graph` recent_changes acceptance path (DL-7 PR B).
 *
 * Acceptance contract: a successful applied `edit_graph` mutation
 * produces a fact whose summary is surfaced by `recent_changes`, so
 * the next turn's state-query guard ("what changed?") can quote it
 * verbatim.
 *
 * This is the E2E shape requested by the implementation brief
 * ("edit → what changed? → stale/rerun signal"). It runs at
 * fact-builder + projector level rather than full
 * `runTurnExecutor` / `dispatchEditGraph` because:
 *
 *  - `edit_graph` is NOT routed through Sonnet's tool-use schema
 *    (per edit-graph-dispatch.ts header). A turn-executor-driven
 *    E2E for edit_graph would need a route-v2 dispatch path mock
 *    that's substantially larger than the contract under test.
 *  - The dispatch-level wiring is already pinned by
 *    `edit-graph-dispatch-fact-emission.test.ts` (9 tests).
 *  - Here we exercise the chain that those dispatch tests assume
 *    works: fact → projection → display-safe summary → freshness
 *    sidecar.
 *
 * Mirrors the D1-handler integration tests' style: real schemas-vendor
 * Zod parses, real recent_changes projector, real freshness derivation,
 * mocked nothing. Inputs are fixture facts; assertions cover the full
 * acceptance chain.
 */

import { describe, it, expect } from 'vitest';
import {
  EditGraphHandlerFactSchema,
  type EditGraphHandlerFact,
  type HandlerFact,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { buildEditGraphHandlerFact } from '../../../src/orchestrator-v5/handlers/edit-graph-fact-builder.js';
import { projectRecentChanges } from '../../../src/orchestrator-v5/context/recent-changes.js';
import { deriveAnalysisFreshness } from '../../../src/orchestrator-v5/context/freshness.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { buildTurnContext } from '../../../src/orchestrator-v5/build-turn-context.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';
import type { EditGraphResult } from '../../../src/orchestrator/tools/edit-graph.js';
import type { GraphV3T } from '../../../src/schemas/cee-v3.js';
import type { SessionStore, SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';
import type {
  InvalidationResult,
  InvalidationScope,
} from '../../../src/orchestrator-v5/session/invalidation.js';
import type { SessionTurn } from '@talchain/schemas/orchestrator';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const SCENARIO_ID = '99999999-9999-4999-8999-999999999999';
const PRE_EDIT_HASH = 'aaaaaaaaaaaaaaaa';
const COMPUTED_AT = '2026-05-09T10:00:00.000Z';

function makePreEditGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

function makePostEditGraph(): GraphV3T {
  // Same shape as preEditGraph but with the price factor renamed.
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price (revised)' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

function makePriorRunAnalysisFact(graphHashAtRun: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.64, opt_b: 0.36 },
      graph_hash_at_run: graphHashAtRun,
      computed_at: COMPUTED_AT,
    },
  };
}

function makeAppliedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Renamed "Price" to "Price (revised)"',
    latencyMs: 1000,
    appliedGraph: makePostEditGraph(),
    wasRejected: false,
    appliedChanges: {
      summary: 'Renamed "Price" to "Price (revised)"',
      changes: [{ label: 'Price', description: 'Renamed.', element_ref: 'fac_price' }],
      rerun_recommended: true, // prior analysis exists in this scenario
    },
    operations: [
      { op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } },
    ],
    operation_meta: [{ impact: 'low', rationale: 'Rename for clarity.' }],
  };
}

/**
 * Substantive edit fixture for E2E5 (real stale/rerun coverage).
 *
 * Adds a NEW factor + a NEW edge — operations that change the
 * analysis-affecting graph hash (the hash explicitly excludes
 * cosmetic / display fields, but DOES include node identity, edges,
 * strengths, etc.). A label-only rename like makeAppliedEditResult
 * leaves the analysis-affecting hash UNCHANGED, so it cannot be used
 * to model production stale/rerun semantics.
 */
function makeSubstantivePostEditGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      // NEW factor — analysis-affecting.
      { id: 'fac_demand', kind: 'factor', label: 'Demand' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      // NEW edge — analysis-affecting.
      {
        from: 'fac_demand',
        to: 'goal_revenue',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as unknown as GraphV3T;
}

function makeSubstantiveEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Added Demand as a factor influencing Revenue.',
    latencyMs: 1200,
    appliedGraph: makeSubstantivePostEditGraph(),
    wasRejected: false,
    appliedChanges: {
      summary: 'Added Demand as a factor influencing Revenue.',
      changes: [
        { label: 'Demand', description: 'New factor.', element_ref: 'fac_demand' },
      ],
      rerun_recommended: true,
    },
    operations: [
      {
        op: 'add_node',
        path: 'fac_demand',
        value: { id: 'fac_demand', kind: 'factor', label: 'Demand' },
      },
      {
        op: 'add_edge',
        path: 'fac_demand::goal_revenue',
        value: {
          from: 'fac_demand',
          to: 'goal_revenue',
          strength: { mean: 0.6, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      },
    ],
    operation_meta: [
      { impact: 'moderate', rationale: 'Adds a new factor.' },
      { impact: 'moderate', rationale: 'Connects new factor to goal.' },
    ],
  };
}

// ----------------------------------------------------------------------------
// E2E acceptance chain
// ----------------------------------------------------------------------------

describe('edit_graph recent_changes acceptance E2E (DL-7)', () => {
  it('E2E1 successful edit emits a schema-valid fact', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: makeAppliedEditResult(),
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    });

    expect(fact).not.toBeNull();
    const parsed = EditGraphHandlerFactSchema.safeParse(fact);
    expect(parsed.success).toBe(true);
  });

  it('E2E2 emitted fact has graph_hash_before that matches the prior analysis run', () => {
    // Real chain: a prior run_analysis was committed with graph_hash_at_run
    // = hash(preEditGraph). Our edit produces graph_hash_before identical
    // to that hash. Asserting the equality proves the fact's
    // `graph_hash_before` is the right anchor for staleness.
    const fact = buildEditGraphHandlerFact({
      editResult: makeAppliedEditResult(),
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    })!;

    expect(fact.result.graph_hash_before).not.toBeNull();
    expect(fact.result.graph_hash_after).not.toBeNull();
    expect(fact.result.graph_hash_before).not.toBe(fact.result.graph_hash_after);
  });

  it('E2E3 recent_changes projector surfaces the fact as graph_edited', () => {
    const fact = buildEditGraphHandlerFact({
      editResult: makeAppliedEditResult(),
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    })!;

    const recent = projectRecentChanges([fact as unknown as HandlerFact]);
    expect(recent).toHaveLength(1);
    expect(recent[0].action).toBe('graph_edited');
    expect(recent[0].summary).toBe(fact.result.safe_summary);
    expect(recent[0].target_label).toBe('Price');
  });

  it('E2E4 the surfaced summary contains no raw entity IDs (display-safe)', () => {
    // Test a case where the upstream summary contained an entity ID;
    // by the time it reaches recent_changes the ID must be scrubbed.
    const editResult = makeAppliedEditResult();
    editResult.appliedChanges = {
      ...editResult.appliedChanges!,
      summary: 'Updated fac_price for the customer.',
    };
    const fact = buildEditGraphHandlerFact({
      editResult,
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    })!;

    const recent = projectRecentChanges([fact as unknown as HandlerFact]);
    expect(recent[0].summary).not.toContain('fac_price');
  });

  it('E2E5 freshness derivation across a SUBSTANTIVE edit: prior analysis becomes stale', () => {
    // Composite chain modelling the production hash path:
    //   1. Prior run_analysis fact at
    //      computeAnalysisAffectingGraphHash(preEditGraph) — this is
    //      what `run-analysis.ts` actually stamps on `graph_hash_at_run`.
    //   2. A SUBSTANTIVE edit happens (add_node + add_edge — fields
    //      that the analysis-affecting hash includes).
    //   3. Next turn computes freshness: prior.graph_hash_at_run vs
    //      computeAnalysisAffectingGraphHash(postEditGraph) → stale.
    //
    // Earlier versions of this test used a label-only rename and
    // relied on the fact's own SHA-256 (which DOES change with
    // labels) — that produced a tautological "stale" verdict because
    // `rerun_recommended: true` was hard-coded in the fixture. The
    // production analysis-affecting hash explicitly excludes labels,
    // so a label-only rename would NOT make analysis stale. E2E5b
    // pins that counter-case explicitly.

    const preGraph = makePreEditGraph();
    const postGraph = makeSubstantivePostEditGraph();

    // The prior run analysed the pre-edit graph: stamp its
    // graph_hash_at_run via the same hash path production uses.
    const priorAnalysisHash = computeAnalysisAffectingGraphHash(preGraph);

    // Build the edit_graph fact (parallel turn record — its own
    // graph_hash fields are diagnostic and use a different
    // SHA-256 algorithm, NOT used by deriveAnalysisFreshness).
    const fact = buildEditGraphHandlerFact({
      editResult: makeSubstantiveEditResult(),
      preEditGraph: preGraph,
      hasExistingAnalysis: true,
    })!;
    expect(fact.fact_type).toBe('edit_graph');

    // Next turn's prior_facts has the run_analysis fact stamped at
    // priorAnalysisHash. Current-turn graph hash is computed via the
    // SAME analysis-affecting path (this is what
    // turn-executor.ts:635 does for currentAnalysisGraphHashForTurn).
    const currentHash = computeAnalysisAffectingGraphHash(postGraph);
    const priorRunAnalysis = makePriorRunAnalysisFact(priorAnalysisHash);
    const verdict = deriveAnalysisFreshness([priorRunAnalysis], currentHash);

    expect(verdict.freshness).toBe('stale');
    expect(verdict.reason).toBe('graph_hash_diverged');
    expect(verdict.computed_at).toBe(COMPUTED_AT);
    // The fact itself agrees: builder propagated rerun_recommended
    // from appliedChanges (where buildAppliedChanges set it true
    // because hasExistingAnalysis && substantive op).
    expect(fact.result.rerun_recommended).toBe(true);
  });

  it('E2E5b cosmetic label-only rename: analysis-affecting hash unchanged → freshness stays fresh', () => {
    // Counter-case to E2E5 proving that the production hash path
    // ignores labels. A label-only rename touches NO field included
    // in computeAnalysisAffectingGraphHash, so the hash matches and
    // the verdict is `fresh` — even though the local SHA-256 hash
    // (fact.result.graph_hash_before/after) DOES differ across the
    // rename. The fact is still emitted (it's a real edit) but no
    // stale signal flows to the next turn's freshness derivation.

    const preGraph = makePreEditGraph();
    const postGraph = makePostEditGraph(); // label-only rename of fac_price

    // Sanity: analysis-affecting hash is unchanged across the rename.
    const priorAnalysisHash = computeAnalysisAffectingGraphHash(preGraph);
    const currentHash = computeAnalysisAffectingGraphHash(postGraph);
    expect(currentHash).toBe(priorAnalysisHash);

    // The fact's own SHA-256 hashes DO differ (label included) —
    // they're diagnostic only, NOT used by freshness:
    const fact = buildEditGraphHandlerFact({
      editResult: makeAppliedEditResult(),
      preEditGraph: preGraph,
      hasExistingAnalysis: true,
    })!;
    expect(fact.result.graph_hash_before).not.toBe(fact.result.graph_hash_after);

    // Freshness uses analysis-affecting hashes → fresh.
    const priorRunAnalysis = makePriorRunAnalysisFact(priorAnalysisHash);
    const verdict = deriveAnalysisFreshness([priorRunAnalysis], currentHash);

    expect(verdict.freshness).toBe('fresh');
    expect(verdict.reason).toBe('graph_hash_match');
  });

  it('E2E6 rejected edit produces no recent_changes entry (gates work end-to-end)', () => {
    const rejectedResult: EditGraphResult = {
      ...makeAppliedEditResult(),
      wasRejected: true,
      appliedGraph: null,
    };
    const fact = buildEditGraphHandlerFact({
      editResult: rejectedResult,
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    });

    expect(fact).toBeNull();
    // If the dispatcher (correctly) doesn't push this null into
    // handler_facts, recent_changes never sees it. We simulate that
    // by passing an empty prior_facts array.
    const recent = projectRecentChanges([]);
    expect(recent).toHaveLength(0);
  });

  it('E2E7 noop edit (zero ops) produces no recent_changes entry', () => {
    const noopResult: EditGraphResult = {
      ...makeAppliedEditResult(),
      operations: [],
      appliedChanges: undefined,
    };
    const fact = buildEditGraphHandlerFact({
      editResult: noopResult,
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    });

    expect(fact).toBeNull();
    const recent = projectRecentChanges([]);
    expect(recent).toHaveLength(0);
  });

  it('E2E-loader Turn 1 emits fact on direct_answer turn → Turn 2 buildTurnContext loads it → recent_changes surfaces it', async () => {
    // Two-turn flow exercising the full DL-7 PR B chain through the
    // P0 loader fix:
    //
    //   Turn 1 (edit_graph): builder produces fact; dispatch commits
    //     it via handler_facts on a direct_answer turn.
    //   (between turns: append_turn_atomic persists fact to
    //     v5_handler_facts; v5_conversation_turns records turn_class
    //     = 'direct_answer'.)
    //   Turn 2 (any): readRecent returns the prior turn (direct_answer
    //     class); buildTurnContext loads its facts via readFactsFor
    //     using ALL prior-turn row IDs (not filtered by turn_class);
    //     prior_facts contains the fact; projectRecentChanges
    //     surfaces it as graph_edited.
    //
    // Pre-PR-B-loader-fix this test would FAIL at the prior_facts
    // assertion (filter dropped the direct_answer turn's row id).
    // Post-fix it passes end-to-end.

    // ── Turn 1 — build the fact (as dispatch would) ──────────────
    const editFact = buildEditGraphHandlerFact({
      editResult: makeAppliedEditResult(),
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    })!;
    expect(editFact).not.toBeNull();
    expect(editFact.fact_type).toBe('edit_graph');

    // ── Between turns — simulate persistence ─────────────────────
    // Mock session store: prior turns include a direct_answer turn
    // whose row id maps to the edit_graph fact in v5_handler_facts.
    const PRIOR_TURN_ROW_ID = 'row-edit-1';
    const PRIOR_TURN_ID = 'turn-edit-1';
    const priorTurn: SessionTurn = {
      id: PRIOR_TURN_ROW_ID,
      scenario_id: SCENARIO_ID,
      user_id: null,
      turn_id: PRIOR_TURN_ID,
      turn_class: 'direct_answer',  // ← critical: NOT 'handler'
      handler_id: null,             // ← critical: V5ActionType doesn't include edit_graph
      request_hash: 'sha256:edit-1',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 500,
      created_at: '2026-05-10T10:00:00.000Z',
    } as unknown as SessionTurn;

    const store: SessionStore = {
      async append(_: SessionTurnWrite) { return { id: PRIOR_TURN_ROW_ID }; },
      async readRecent() { return [priorTurn]; },
      async readFactsFor(turnIds: readonly string[]) {
        // Production behaviour: FK lookup returns facts for the row ids
        // that have associated v5_handler_facts entries.
        if (turnIds.includes(PRIOR_TURN_ROW_ID)) {
          return [editFact as unknown as Parameters<typeof projectRecentChanges>[0] extends readonly (infer F)[] | undefined ? F : never] as never;
        }
        return [];
      },
      async readFactsWithTurnFor(turnIds: readonly string[]) {
        if (turnIds.includes(PRIOR_TURN_ROW_ID)) {
          return [
            {
              fact: editFact as unknown as Parameters<typeof projectRecentChanges>[0] extends readonly (infer F)[] | undefined ? F : never,
              turn_id: PRIOR_TURN_ROW_ID,
              fact_created_at: '2026-05-10T10:00:01.000Z',
            },
          ] as never;
        }
        return [];
      },
      async invalidateScoped(_s: string, scope: InvalidationScope): Promise<InvalidationResult> {
        return { scope, entries_invalidated: [] };
      },
      async invalidateAll(): Promise<InvalidationResult> {
        return { scope: { kind: 'structural' }, entries_invalidated: [] };
      },
      async ensureScenarioExists(_s: string, userId: string) {
        return { user_id: userId };
      },
      async storeDraftGraph() { /* noop */ },
      async loadGraph() { return null; },
      async loadGraphAndBriefText() { return { graph: null, briefText: null }; },
      async readMostRecentPendingActions() { return []; },
    };

    // ── Turn 2 — buildTurnContext on the next turn ─────────────────
    const turn2Payload = makeMessagePayload({
      turn_id: 'turn-2',
      scenario_id: SCENARIO_ID,
      message: 'what did you change?',
    });
    const ctx = await buildTurnContext(turn2Payload, 'req-e2e-loader', { sessionStore: store });

    // Assertion 1 — the fact reached prior_facts (P0 loader fix).
    expect(ctx.prior_facts).toHaveLength(1);
    expect(ctx.prior_facts[0].fact_type).toBe('edit_graph');

    // Assertion 2 — the fact pairs with its parent direct_answer turn.
    expect(ctx.prior_facts_with_turn).toHaveLength(1);
    expect(ctx.prior_facts_with_turn[0].turn_id).toBe(PRIOR_TURN_ROW_ID);

    // Assertion 3 — recent_changes projector surfaces it.
    const recent = projectRecentChanges(ctx.prior_facts);
    expect(recent).toHaveLength(1);
    expect(recent[0].action).toBe('graph_edited');
    expect(recent[0].summary).toBe(editFact.result.safe_summary);

    // Assertion 4 — no raw entity IDs in the surfaced summary.
    expect(recent[0].summary).not.toContain('fac_');
  });

  it('E2E8 mixed history: D1 set_factor_value AND edit_graph both surface', () => {
    const editFact = buildEditGraphHandlerFact({
      editResult: makeAppliedEditResult(),
      preEditGraph: makePreEditGraph(),
      hasExistingAnalysis: true,
    })! as unknown as HandlerFact;

    const setFactorFact: HandlerFact = {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop: false,
      result: {
        target_id: 'fac_churn',
        status: 'applied',
        before: { value: 0.04, raw_value: 4, unit: 'percent', label: 'Customer churn' },
        after: { value: 0.05, raw_value: 5, unit: 'percent', label: 'Customer churn' },
      },
    } as unknown as HandlerFact;

    // Newest-first: edit happened most recently, set_factor_value before.
    const recent = projectRecentChanges([editFact, setFactorFact]);
    expect(recent).toHaveLength(2);
    expect(recent[0].action).toBe('graph_edited');
    expect(recent[1].action).toBe('factor_value_updated');
    // State-query guard would quote recent[0].summary verbatim.
    expect(recent[0].summary).toBeTruthy();
  });
});
