/**
 * Shared fixtures for the AI-harness coaching suites — Cap-1 post-analysis
 * loop and Cap-2A add-risk rejection guidance (both UNCONDITIONAL since
 * 2026-07-20 — O-7 wave 2: their flags were deleted, live-true on staging).
 *
 * Extracted from the suites that previously carried diverging copies:
 *   - src/orchestrator-v5/__tests__/turn-executor-post-analysis-loop.integration.test.ts
 *   - tests/unit/ai-harness/coaching-flags-combined.test.ts
 *   - tests/integration/orchestrator/edit-graph-dispatch-add-risk-e2e.test.ts
 *   - tests/unit/orchestrator/edit-graph-add-risk-flag-seam.test.ts
 *
 * Naming convention (single colocated fixtures module) matches the existing
 * `src/orchestrator-v5/__tests__/fixtures.ts`. Deliberately vitest-free:
 * this file sits inside the `tsconfig.build.json` include set (`src/**`,
 * only `*.test.ts` excluded), so it must compile without test-runner types.
 * Mock helpers that need `vi` stay in the consuming suites.
 */

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

// ────────────────────────────────────────────────────────────────────
// Cap-1 fixtures — post-analysis loop (blank thin projection, fresh fact)
// ────────────────────────────────────────────────────────────────────

export const CAP1_SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// A structurally valid graph whose canonical whole-status is NOT ready: both
// options are configured, but a controllable capacity risk reaches the goal
// without being reachable from either option. This is the exact discriminator
// the canonical producer reports as `needs_user_mapping`; absent goal threshold
// is deliberately irrelevant (ready-without-threshold is valid).
export const PARTIAL_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'dec_q3', kind: 'decision', label: 'Choose the Q3 route' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'fac_delivery_risk', kind: 'factor', label: 'Delivery risk', category: 'controllable' as const },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_capacity: 1 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'dec_q3', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_q3', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_status_quo', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_q3', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_delivery_risk', to: 'goal_q3', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' as const },
  ],
  goal_node_id: 'goal_q3',
};

export const PARTIAL_GRAPH_HASH = computeAnalysisAffectingGraphHash(PARTIAL_GRAPH as never)!;

/**
 * Fresh run_analysis fact with a usable leading option BUT no renderable
 * tunable driver: `fac_capacity` is fully option-controlled (both options
 * intervene on it) so Spine A suppresses it from the driver projection, and no
 * external factor is supplied. The ContextPack projection therefore has a
 * populated `leading_option` but an EMPTY `top_drivers[]` — so an `improvement`
 * question (needs leading_option AND top_driver) falls through
 * `data_unavailable_for_class: ['top_driver']`. Still a successful,
 * hash-matching fact → freshness 'fresh', canonical state usable.
 */
export function makeBlankProjectionFreshFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: CAP1_SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: PARTIAL_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          { option_id: 'opt_hire', option_label: 'Hire', win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_status_quo', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
        ],
        // No external/tunable factor_sensitivity → top_drivers projects empty.
        robustness_synthesis: { overall_assessment: 'moderate' },
      },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  };
}

export const PRIOR_RA_TURN = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  scenario_id: CAP1_SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

// ────────────────────────────────────────────────────────────────────
// Cap-2A fixtures — add-risk edit rejection (edit-graph dispatch)
// ────────────────────────────────────────────────────────────────────

export const ADD_RISK_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Structurally clean baseline: decision → options → factor → goal. */
export const PRICING_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Reach 1000 customers' },
    { id: 'dec_pricing', kind: 'decision', label: 'Pricing model' },
    { id: 'opt_subscription', kind: 'option', label: 'Subscription' },
    { id: 'opt_oneoff', kind: 'option', label: 'One-off' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  edges: [
    { from: 'dec_pricing', to: 'opt_subscription', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_pricing', to: 'opt_oneoff', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_subscription', to: 'fac_price', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'opt_oneoff', to: 'fac_price', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' },
  ],
} as unknown as GraphStateIngress;

/**
 * LLM proposal that adds a risk as a DEAD-END (inbound edge only — nothing
 * flows out of it) — the candidate graph fails structural validation with
 * the reachability class (the risk cannot reach the goal via forward
 * edges), which is the Cap-2A target shape.
 *
 * 1.16 item C — deliberate fixture change: this fixture previously wired
 * the risk with an OUTBOUND edge (`risk → opt_subscription`). Under the
 * corrected reachability predicate (a node fails only when it cannot REACH
 * the goal via forward edges), that shape is a legitimate exogenous
 * influence — risk → option → factor → goal — and is now ACCEPTED, so it
 * can no longer drive a rejection-guidance test. The inbound-only sink
 * below is a TRUE dead-end and still legitimately rejects.
 */
export const TARGETED_ADD_RISK_OPS = [
  {
    // patch-applier semantics: `path` is the authoritative node id.
    op: 'add_node',
    path: 'risk_team_dynamics',
    value: { id: 'risk_team_dynamics', kind: 'risk', label: 'Team dynamics' },
  },
  {
    op: 'add_edge',
    path: 'opt_subscription->risk_team_dynamics',
    value: {
      from: 'opt_subscription',
      to: 'risk_team_dynamics',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'negative',
    },
  },
];

/**
 * The edit-graph LLM-proposal envelope as the mocked chat adapter resolves
 * it: `{ content }` where content is the JSON body the edit pipeline parses.
 * Callers feed it to their file-local `llmChatMock.mockResolvedValue(...)`
 * (the mock itself needs `vi`, so it cannot live here).
 */
export function makeEditProposalResponse(
  operations: readonly unknown[],
  coachingSummary = 'Proposed change.',
): { content: string } {
  return {
    content: JSON.stringify({
      operations,
      removed_edges: [],
      warnings: [],
      coaching: { summary: coachingSummary },
    }),
  };
}
