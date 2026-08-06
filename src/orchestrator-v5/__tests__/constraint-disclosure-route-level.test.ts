/**
 * T1 constraint disclosure — ACCEPTANCE AT THE REAL BOUNDARY.
 *
 * WHY THIS FILE EXISTS. #703 composed the disclosure into the run_analysis
 * summary and asserted on `outcome.assistant_text`. That is UPSTREAM of the
 * forwarder, so its tests could not see that the user received only "Ran
 * analysis on your current scenario." — the withheld-leader half of the fix
 * shipped, and the "which condition, and what to do about it" half was
 * replaced by a locked literal at the wire. Green-by-fixture, inside a fix for
 * green-by-fixture.
 *
 * The sibling file (coaching/__tests__/constraint-gap-disclosure-egress.test.ts)
 * closed that by calling the forwarder directly. THIS file closes the rest of
 * the distance: it drives the REAL Fastify route with `app.inject`, through the
 * REAL turn executor, the REAL `renderConfirmation` (turn-executor.ts), the
 * REAL registry forwarder AND the REAL egress sanitiser/finaliser, and asserts
 * on the SERIALISED HTTP RESPONSE BYTES. Nothing between the handler and the
 * socket is stubbed.
 *
 * Only two seams are mocked, and neither is on the disclosure's path:
 *   - the routing LLM (`routeWithToolUse`) — there is no network in CI;
 *   - the PLoT transport, so the enrichment envelope is a fixed, synthetic
 *     wire capture. Everything downstream of it is production code.
 *
 * THE NON-VACUITY CONTROL, and it is the load-bearing part of this file: the
 * same summary string ALSO travels on the `analysis_result` block, which does
 * NOT pass through the allowlist. So every test here asserts the sentence is
 * present in `blocks[].summary` (proving the handler really composed it) AND
 * present in `assistant_text` (proving it survived the forwarder). Under the
 * live defect the first passes and the second fails — which is exactly the
 * shape of #703's inertness, and a test that checked only one of them could
 * not tell the two apart.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { ScenarioReader } from '../tools/handlers/run-analysis.js';
// T1 layer 3 — the guard's own scanner, reused here as the (d)-assertion
// instrument so the route test and the guard cannot drift apart.
import { findLeaderClaims } from '../compose/leading-option-egress-guard.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The user's ratified condition, in CEE's own persisted vocabulary. */
const RATIFIED_CONSTRAINT = {
  constraint_id: 'constraint_out_total_cost_max',
  node_id: 'out_total_cost',
  operator: '<=',
  threshold: 2500,
  label: 'Total three-year cost',
};

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_hold', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_growth', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
  goal_node_id: 'goal_growth',
  goal_constraints: [RATIFIED_CONSTRAINT],
};

/**
 * The PLoT wire, in the shapes the enrichment seam actually carries.
 * `constraintKey` is what PLoT used to key its per-option
 * `constraint_probabilities` map — the single variable that selects between the
 * verdict states this file exercises.
 */
/**
 * A decision_review whose prose ASSERTS A LEADER, in the shapes the live
 * producer emits. Every string below is modelled on the verbatim G-CEE-1 walk
 * capture (staging build `1c078f0`) so the assertions are about the real copy:
 *
 *   `narrative_summary`      → `blocks[].body` of the `narrative` review_card
 *                              ("How the analysis reads") — walk `blocks[1]`.
 *   `robustness_explanation` → the `robustness` card ("How robust is this?")
 *                              — walk `blocks[2]`.
 *   `flip_thresholds[].narrative` → the `flip_threshold` card.
 *   `scenario_contexts`      → the `scenario_context` card, whose prompt makes
 *                              it name BOTH the alternative and the winner.
 *   `key_assumptions`        → the `assumption` card, which is DELIBERATELY
 *                              KEPT on a withheld turn (it makes no comparative
 *                              claim) — the over-suppression control.
 */
const LEADER_DECISION_REVIEW = {
  // NOTE ON WORDING: none of this copy may NAME a modelled factor. `fac_capacity`
  // is an option-controlled LEVER in READY_GRAPH, and the Spine-A backstop drops
  // any Phase-3 block that names one (`drop_reason: 'lever_named'`) — a fixture
  // that named it would be dropped for the WRONG REASON and every absence
  // assertion below would pass vacuously (TESTING-DISCIPLINE rule 1).
  narrative_summary:
    'Hire Marketing Manager leads by a margin of about 52 percentage points, but this result relies on assumptions.',
  /**
   * A DICT keyed by option id — the shape the decision-review prompt's own
   * OUTPUT_SCHEMA mandates (`story_headlines (Record<option_id, string>)`,
   * `prompts/defaults.ts`) and the shape verified on 10/10 live bodies.
   *
   * It is here because the egress guard used to read it as
   * `Array.isArray(review.story_headlines) ? … : []`, which is false for a
   * dict — so the loop body never ran and the guard NEVER SCANNED the field
   * carrying "Leads under current modelling…". A fixture that used an array
   * would have passed against the broken walker (TESTING-DISCIPLINE rule 1:
   * name the branch the fixture must reach).
   */
  story_headlines: {
    opt_hire: 'Leads under current modelling, but the advantage rests on unverified assumptions.',
    opt_hold: 'Trails on the current numbers.',
  },
  robustness_explanation: {
    summary: 'The current result is not robust, as the lead depends on assumptions.',
  },
  scenario_contexts: {
    'opt_hire->fac_capacity': {
      trigger_description: 'Demand falls below the tolerance band',
      consequence: 'Hold overtakes Hire Marketing Manager as the leading option.',
    },
  },
  key_assumptions: ['The hiring pipeline stays open through the year.'],
  produced_at: '2026-07-26T09:00:00.000Z',
};

/**
 * A `decision_brief` in the shape the LIVE producer emits — every field name,
 * nesting and phrasing below is copied from `case1.run.response.json` in
 * `acceptance-evidence/g-cee-1-constraint-verdict/raw-2026-07-26-post-710/`
 * (CEE staging `227e0aa`, a withheld `unevaluated` turn), with the labels
 * swapped for this file's own graph.
 *
 * Split deliberately into its THREE leader-ranking members and its
 * non-comparative remainder, because the acceptance criteria weight
 * over-suppression equally with the leak: the first group must vanish on a
 * withheld turn, the second must survive it.
 */
const LEADER_DECISION_BRIEF = {
  brief_id: '3194a5d7-5c72-4fad-8cc9-5a76fd9ddd07',
  version: '1',
  created_at: '2026-07-26T09:00:00.000Z',
  // ── the three leader-ranking members ──────────────────────────────────────
  headline:
    'Hire Marketing Manager currently leads, but the outcome is highly uncertain. Gather evidence before deciding.',
  headline_banded: {
    text: 'Hire Marketing Manager is slightly ahead.',
    band: 'slightly_ahead',
    leader_option_id: 'opt_hire',
    leader_label: 'Hire Marketing Manager',
    runner_up_option_id: 'opt_hold',
    runner_up_label: 'Hold',
    win_probability_gap: 0.44,
    robustness_gated: true,
    doctrine: 'provisional_doctrine_v0',
  },
  robustness_caveat: {
    text: 'This ranking was fragile under the perturbations tested — small changes to assumptions could change which option leads.',
  },
  // ── the non-comparative remainder (the over-suppression control) ──────────
  options: [
    { option_id: 'opt_hire', label: 'Hire Marketing Manager', win_probability: 0.72, rank: 1 },
    { option_id: 'opt_hold', label: 'Hold', win_probability: 0.28, rank: 2 },
  ],
  top_drivers: [{ factor_label: 'Hiring pipeline health', sensitivity: 0.23, direction: 'positive' }],
  key_assumptions: ['Hiring pipeline health'],
  what_would_change: ['Hiring pipeline health → Customer growth'],
  robustness: 'fragile',
  warnings: [{ code: 'DOMINANT_FACTOR', message: 'One factor dominates.', severity: 'warning' }],
  warning_codes: ['DOMINANT_FACTOR'],
  defaulted_assumptions: [],
  /**
   * ⚠ WAS `{ n_samples: 1000 }` — AN INVENTED SHAPE, AND THE REASON A LEAK RAN
   * FOR THREE WALKS UNDER A GREEN SUITE.
   *
   * The LIVE producer emits exactly four members here, derived across all five
   * archived corpora (142 bodies / 65 enriched blocks, every one of them):
   * `leading_option`, `win_probability`, `robustness_band`, and `goal_fit` (on
   * 40 of 65). `n_samples` is emitted by nothing. So the fixture asserted
   * `analysis_summary` survived a withheld turn while carrying no leader
   * designation to survive WITH — an over-suppression control that could not
   * fail and a leak assertion that was never written.
   *
   * Values below are the `caseINF.run` shape from
   * `acceptance-evidence/g-cee-1-constraint-verdict/raw-2026-07-27-final/`,
   * relabelled onto this file's graph.
   */
  analysis_summary: {
    leading_option: 'Hire Marketing Manager',
    win_probability: 0.72,
    goal_fit: 0,
    robustness_band: 'fragile',
  },
};

/**
 * `enrichment.robustness`, in the LIVE shape — the blob the egress guard did
 * not scan at all until 2026-07-27, and which names the leading option by ID
 * AND by LABEL on every withheld body carrying an analysis block
 * (`WALK-2026-07-27-FINAL.md` §8; present on 65/65 enriched blocks archived).
 *
 * Transcribed member-for-member from `caseINF.run.response.json`
 * (`raw-2026-07-27-final/`), relabelled onto this file's graph. Split into the
 * designations and the fragility science for the same reason the brief is: the
 * first group must vanish on a withheld turn and the second must survive it.
 *
 * ⚠ `fragile_edges[].alternative_winner_id` / `_label` are IN this fixture
 * DELIBERATELY, on the survive side. They name the COUNTERFACTUAL winner if
 * that edge flips — not the leader, and the substance of a fragility finding.
 * A suppression rule written with an unanchored `/winner/` would eat them, and
 * the over-suppression control below is what would catch that.
 */
const LEADER_ROBUSTNESS = {
  // ── the leader designations ───────────────────────────────────────────────
  recommended_option_id: 'opt_hire',
  recommended_option_label: 'Hire Marketing Manager',
  near_tie: {
    is_tie: false,
    top_option_id: 'opt_hire',
    second_option_id: 'opt_hold',
    tied_option_ids: ['opt_hire'],
    gap: 0.44,
    threshold: 0.1,
  },
  // ── the fragility science (the over-suppression control) ──────────────────
  is_robust: false,
  level: 'low',
  confidence: 0.72,
  confidence_basis: 'recommendation_stability_uncalibrated',
  display_verdict: 'fragile',
  display_verdict_reason: 'small changes could flip this result',
  robust_edges: [],
  fragile_edges: [
    {
      edge_id: 'fac_capacity->goal_growth',
      from_id: 'fac_capacity',
      to_id: 'goal_growth',
      from_label: 'Capacity',
      to_label: 'Customer growth',
      switch_probability: 0.535,
      marginal_switch_probability: 0.17,
      alternative_winner_id: 'opt_hold',
      alternative_winner_label: 'Hold',
      severity: 'error',
      visible: true,
    },
  ],
};

/**
 * A THIRD option, opt-in, whose only job is to make the ORDER of
 * `decision_brief.options[]` measurable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WITHOUT IT THE 2026-07-27 ORDERING ASSERTION IS VACUOUS — CLAUDE.md TRAP 13
 * IN ITS PUREST FORM, AND IT WOULD HAVE SHIPPED GREEN.
 *
 * The fix re-orders `options[]` by `option_id` on a withheld turn, so position
 * stops tracking rank. On this file's two-option graph `opt_hire` (0.72) sorts
 * BEFORE `opt_hold` (0.28), so identity order and probability order are the
 * SAME sequence — "the withheld array is not probability-descending" would have
 * been false-by-construction, i.e. it could never have gone red, on either the
 * fixed or the unfixed code.
 *
 * `opt_contract` sorts FIRST by id and LAST by probability, which is the exact
 * structural property the live archive has and this graph did not:
 * `raw-2026-07-27-confirm/caseINF.run.response.json` ranks
 * `opt_status_quo` (0.6001) first and its id sorts LAST of the three.
 *
 *   probability-descending  →  opt_hire 0.72 · opt_hold 0.28 · opt_contract 0.10
 *   canonical by option_id  →  opt_contract 0.10 · opt_hire 0.72 · opt_hold 0.28
 *
 * OPT-IN, so no test written before 2026-07-27 changes what it measures: the
 * two existing options keep their ids, labels and probabilities exactly, and
 * `opt_hire` remains the leader at 0.72.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const THIRD_OPTION = { id: 'opt_contract', label: 'Contract a Freelancer', win: 0.1 } as const;

/**
 * `decision_brief.options[]` in the LIVE shape: probability-DESCENDING, with an
 * explicit `rank`.
 *
 * Transcribed member-for-member from `caseINF.run.response.json`
 * (`acceptance-evidence/g-cee-1-constraint-verdict/raw-2026-07-27-confirm/`,
 * build `7508820`), relabelled onto this file's graph —
 *
 *   {"option_id": "opt_status_quo", "label": "Defer and Keep Current Machines
 *     (Status Quo)", "win_probability": 0.6000833333333333, "rank": 1}
 *   {"option_id": "opt_dell",    …, "win_probability": 0.21858333333333332, "rank": 2}
 *   {"option_id": "opt_macbook", …, "win_probability": 0.18133333333333332, "rank": 3}
 *
 * — where `WALK-2026-07-27-CONFIRM.md` §6 measured `options[rank == 1]` and
 * `options[0]` designating the leader on 7 of 7 withheld analysis-bearing
 * bodies.
 */
const RANKED_OPTIONS = [
  { option_id: 'opt_hire', label: 'Hire Marketing Manager', win_probability: 0.72, rank: 1 },
  { option_id: 'opt_hold', label: 'Hold', win_probability: 0.28, rank: 2 },
  {
    option_id: THIRD_OPTION.id,
    label: THIRD_OPTION.label,
    win_probability: THIRD_OPTION.win,
    rank: 3,
  },
];

function plotEnvelope(opts: {
  constraintKey?: string;
  /** Attach the leader-asserting decision_review (see above). */
  withDecisionReview?: boolean;
  /** Attach the leader-asserting decision_brief (see above). */
  withDecisionBrief?: boolean;
  /**
   * Add {@link THIRD_OPTION} to `option_comparison` and give `decision_brief`
   * the matching three-element {@link RANKED_OPTIONS}. See THIRD_OPTION for why
   * the ordering assertions need it and why it is opt-in.
   */
  withThirdOption?: boolean;
  /**
   * Attach the leader-designating `robustness` blob (see above).
   *
   * OPT-IN rather than always-on, deliberately: the tests written before
   * 2026-07-27 assert an EMPTY hit list on turns that never carried this blob,
   * and quietly adding it to them would change what those zeros mean. New
   * assertions opt in; old ones keep measuring what they were written to
   * measure.
   */
  withRobustness?: boolean;
  /** Satisfaction probability written under `constraintKey`. 0 ⇒ the leader
   *  violates it, which selects `evaluated_infeasible`. */
  constraintProb?: number;
  constraintsStatus?: string;
  warningCodes?: readonly string[];
}): Record<string, unknown> {
  const withProbs = opts.constraintKey !== undefined;
  const option = (id: string, label: string, win: number, prob: number) => ({
    option_id: id,
    id,
    option_label: label,
    label,
    win_probability: win,
    outcome: { mean: 0.5, std: 0.2, p10: 0.3, p90: 0.7 },
    ...(withProbs
      ? {
          constraint_probabilities: { [opts.constraintKey!]: prob },
          probability_of_joint_goal: prob === 0 ? 0 : 0.9,
        }
      : {}),
  });
  return {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'sha256:fixture' },
    analysis_status: 'completed',
    // Keep-listed, fixture-proven top-level field (compose.ts
    // `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP`). Present so the 1.218
    // over-suppression controls have a SECOND keep-listed field to assert
    // survives — otherwise "the keep-list still works" would rest on
    // `option_comparison` alone.
    option_comparison_status: 'computed',
    constraints_status: opts.constraintsStatus ?? 'computed',
    // The handler stores `enrichment` as a byte-for-byte pass-through of this
    // envelope, so a `decision_review` here lands on the fact exactly as the
    // turn-executor's auto-fire would put it there — and compose's Phase-3
    // rebuild turns it into the review_card / coaching blocks. That is how this
    // route-level file reaches the LIVE-FAILING blocks without needing the
    // enricher's LLM call or its default-off await flag.
    ...(opts.withDecisionReview ? { decision_review: LEADER_DECISION_REVIEW } : {}),
    ...(opts.withDecisionBrief
      ? {
          decision_brief: opts.withThirdOption
            ? { ...LEADER_DECISION_BRIEF, options: RANKED_OPTIONS }
            : LEADER_DECISION_BRIEF,
        }
      : {}),
    ...(opts.withRobustness ? { robustness: LEADER_ROBUSTNESS } : {}),
    ...(opts.warningCodes && opts.warningCodes.length > 0
      ? { inference_warnings: opts.warningCodes.map((code) => ({ code })) }
      : {}),
    // ⚠ THE THIRD OPTION GOES FIRST, AND THAT IS FIDELITY, NOT TIDINESS.
    // `option_comparison` ships in GRAPH order on the live wire, NOT in
    // probability order: on all 7 withheld bodies of
    // `raw-2026-07-27-confirm/` it reads 0.219 · 0.181 · 0.600 — unsorted,
    // with the leader LAST — and `win_probabilities` carries the same key
    // order. Only `decision_brief.options[]` presents an ordering, and that
    // asymmetry is the whole of the 2026-07-27 ruling. Appending the third
    // option instead would have made this roster probability-descending AND
    // leader-first, i.e. a positional designation the live producer does not
    // emit, and the derived sweep below correctly reported it as one.
    // The two-option default is BYTE-UNCHANGED, so no prior test moves.
    option_comparison: [
      ...(opts.withThirdOption
        ? [
            option(
              THIRD_OPTION.id,
              THIRD_OPTION.label,
              THIRD_OPTION.win,
              opts.constraintProb ?? 0.85,
            ),
          ]
        : []),
      option('opt_hire', 'Hire Marketing Manager', 0.72, opts.constraintProb ?? 0.91),
      option('opt_hold', 'Hold', 0.28, opts.constraintProb ?? 0.88),
    ],
    response_hash: 'sha256:fixture-top',
  };
}

/**
 * ROADMAP 2.349 — the ratified set and the graph become SWAPPABLE, defaulting
 * to the byte-identical values every test written before 2.349 measured.
 *
 * OPT-IN, and restored by the FILE-LEVEL `beforeEach` below (which runs before
 * every describe's own hook), so no existing assertion changes what it
 * observes: the gap-5 block at the end of this file swaps in the walk's own
 * deadline constraint for the duration of its own tests and nothing else ever
 * sees a different graph.
 */
let activeGraph: Record<string, unknown> = READY_GRAPH;
let activeRatifiedConstraints: Array<Record<string, unknown>> = [RATIFIED_CONSTRAINT];

beforeEach(() => {
  activeGraph = READY_GRAPH;
  activeRatifiedConstraints = [RATIFIED_CONSTRAINT];
});

/** Swapped per test, before the inject. */
let plotResponse: Record<string, unknown> = plotEnvelope({});
/**
 * A prior successful run selects the RE-RUN coaching signal instead of the
 * first-run one. BOTH the turn row and the fact are required: `buildTurnContext`
 * loads `prior_facts` by FK from `priorTurns.map(t => t.id)`, so seeding facts
 * alone yields an empty `prior_facts` and the turn silently takes the FIRST-run
 * branch. (Found by mutation: a re-run-only revert changed nothing until this
 * was fixed.)
 */
let priorTurns: Array<Record<string, unknown>> = [];
let priorFacts: Array<Record<string, unknown>> = [];

const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: SCENARIO_ID,
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

function priorRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
        ],
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
    },
  };
}

/** Seed a prior successful run: BOTH the turn row and its fact. */
function seedPriorRun(): void {
  priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
  priorFacts = [priorRunAnalysisFact()];
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    loadGraph: async () => activeGraph,
    loadGraphAndBriefText: async () => ({ graph: activeGraph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

// The REAL run_analysis handler, with only the PLoT transport and the scenario
// reader injected. `createRegistry` is the production factory.
vi.mock('../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../tools/registry.js')>(
    '../tools/registry.js',
  );
  const plotClient = {
    run: async () => structuredClone(plotResponse),
    validatePatch: async () => ({}),
  } as unknown as PLoTClient;
  const scenarioReader: ScenarioReader = async () => ({
    graph: activeGraph,
    options: [
      { id: 'opt_hire', option_id: 'opt_hire', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
      { id: 'opt_hold', option_id: 'opt_hold', label: 'Hold', interventions: { fac_capacity: 0 } },
    ],
    goal_node_id: 'goal_growth',
    // The exact array the handler forwards to PLoT — the tightest statement of
    // "what we asked the engine to enforce".
    goal_constraints: activeRatifiedConstraints,
    rawPersistedGraph: activeGraph,
  });
  return {
    ...actual,
    getDefaultRegistry: () => actual.createRegistry({ plotClient, scenarioReader }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

function routedRunAnalysis() {
  return {
    type: 'tool_call' as const,
    orientationText: '',
    llmCallCount: 1,
    droppedActions: [],
    rawResult: {
      content: [],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'mock',
      latencyMs: 0,
    },
    proposal: {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'opt_hire',
          kind: 'option' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'id_match' as const,
        },
        parameters: [],
        cited_context_fields: ['graph.options'],
      },
    },
  };
}

interface WireTurn {
  status: number;
  /** The RAW serialised body — the bytes the user's browser receives. */
  raw: string;
  assistantText: string;
  /**
   * The CONFIRMATION segment of `assistant_text` — i.e. exactly what
   * `renderConfirmation` returned. `composeToolCallResponse` joins
   * [orientation?, confirmation, coaching?] with a blank line, so the
   * confirmation is the piece the egress allowlist governs and the only piece
   * the disclosure grammar has to match.
   */
  confirmation: string;
  /**
   * The `analysis_result` block's summary. Composed from the SAME handler
   * string but shipped WITHOUT passing the allowlist, so it is the control
   * that proves an `assistant_text` assertion is not vacuous.
   */
  blockSummary: string;
  /**
   * The COACHING segment — the last `\n\n`-delimited piece when one fired.
   * `composeToolCallResponse` joins [orientation?, confirmation, coaching?],
   * and the egress allowlist governs ONLY the confirmation, so the two slots
   * must be asserted separately.
   */
  coaching: string;
}

async function runAnalysisTurn(app: FastifyInstance): Promise<WireTurn> {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: randomUUID(),
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'Run the analysis',
      turn_class: 'decide',
      source: 'composer',
      graph_state: activeGraph,
    },
  });
  const body = JSON.parse(res.body) as Record<string, any>;
  const block = Array.isArray(body.blocks)
    ? body.blocks.find((b: Record<string, unknown>) => b.type === 'analysis_result')
    : undefined;
  const assistantText = typeof body.assistant_text === 'string' ? body.assistant_text : '';
  return {
    status: res.statusCode,
    raw: res.body,
    assistantText,
    confirmation: assistantText.split('\n\n')[0] ?? '',
    coaching: (() => {
      const segs = assistantText.split('\n\n');
      return segs.length > 1 ? segs[segs.length - 1]! : '';
    })(),
    blockSummary: typeof block?.summary === 'string' ? block.summary : '',
  };
}

const FALLBACK = 'Ran analysis on your current scenario.';

describe('route-level: the constraint disclosure in the serialised HTTP envelope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('POSITIVE CONTROL: a HEALTHY evaluated run keeps its recommendation on the wire', () => {
    // The false-positive direction, asserted at the boundary that matters. PLoT
    // scored the ratified constraint under CEE's own id, so the verdict is
    // `evaluated_feasible`, the leading option may be named, and NO disclosure
    // is appended. If this ever goes red, the fix below is costing users a
    // recommendation on healthy runs.
    plotResponse = plotEnvelope({ constraintKey: 'constraint_out_total_cost_max' });
    return runAnalysisTurn(app).then((turn) => {
      expect(turn.status).toBe(200);
      expect(turn.raw).not.toContain('conditions you set');
      expect(turn.raw).not.toContain('could not be matched');
      expect(turn.assistantText.length).toBeGreaterThan(0);
    });
  });

  it('UNEVALUATED: the condition and the repair step reach the SERIALISED bytes', async () => {
    // The live staging defect: the ratified constraint has no score anywhere,
    // and PLoT says the constraint block is unavailable. Requirements (b) and
    // (c) of #703 — name the condition, offer a repair step — are what never
    // reached the wire.
    plotResponse = plotEnvelope({
      constraintsStatus: 'unavailable',
      warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'],
    });
    const turn = await runAnalysisTurn(app);
    expect(turn.status).toBe(200);

    // CONTROL FIRST: the handler really composed it (this path bypasses the
    // allowlist), so the assertions below are about SURVIVAL, not composition.
    expect(turn.blockSummary).toContain('Total three-year cost');

    // (a) the leading-option claim is withheld
    expect(turn.assistantText).not.toContain('Hire Marketing Manager');
    // and the message is not the bland substitute
    expect(turn.assistantText).not.toBe(FALLBACK);
    // (b) the condition is NAMED — in the serialised bytes
    expect(turn.raw).toContain('Total three-year cost');
    expect(turn.assistantText).toContain('Total three-year cost');
    expect(turn.assistantText).toContain('could not be checked');
    // (c) the repair step is present
    expect(turn.assistantText).toContain('Tell me the limit you meant');
  });

  it('IDENTITY_UNRESOLVED: the honest wording reaches the wire, and says neither false thing', async () => {
    // PLoT scored a constraint, but keyed it by its `${node_id}_${operator}`
    // fallback, so nothing reconciles with `constraint_out_total_cost_max`.
    plotResponse = plotEnvelope({ constraintKey: 'out_total_cost_<=' });
    const turn = await runAnalysisTurn(app);
    expect(turn.status).toBe(200);

    expect(turn.blockSummary).toContain('could not be matched');

    // It survives the forwarder.
    expect(turn.assistantText).not.toBe(FALLBACK);
    expect(turn.raw).toContain('could not be matched to the condition you set');
    // It does NOT say the condition went unchecked (#703's false statement).
    expect(turn.assistantText).not.toContain('could not be checked');
    // It does NOT certify safety — no leader is named (#707's false statement).
    expect(turn.assistantText).not.toContain('Hire Marketing Manager');
    expect(turn.assistantText).toContain('no option can be put forward yet');
    // And it offers ITS repair step, not the units one.
    expect(turn.assistantText).toContain('Re-state the condition and run the analysis again');
    expect(turn.assistantText).not.toContain('recorded in the same units');
  });

  it('the disclosure survives serialisation intact — whole confirmation, curly quotes and all', async () => {
    // The curly quotes around the label are the one non-ASCII part of the copy
    // and the likeliest thing to be mangled by an egress sanitiser or a JSON
    // escape. And the disclosure composes LAST, so the confirmation ending on
    // the repair step is what proves it was not truncated at the tail — the
    // failure mode a `toContain` on the subject sentence alone would miss.
    plotResponse = plotEnvelope({
      constraintsStatus: 'unavailable',
      warningCodes: ['CONSTRAINT_TARGET_UNRELIABLE'],
    });
    const turn = await runAnalysisTurn(app);
    expect(turn.confirmation).toContain('\u201cTotal three-year cost\u201d');
    expect(turn.confirmation.endsWith('Then run the analysis again.')).toBe(true);
    // Single-line: the allowlist rejects any confirmation containing a newline,
    // so a multi-line disclosure would be silently replaced by the fallback.
    expect(turn.confirmation).not.toContain('\n');
  });

  it('the coaching tail is a SEPARATE piece — the confirmation the allowlist saw is intact', async () => {
    // `assistant_text` is [orientation?, confirmation, coaching?] joined by a
    // blank line. This pins WHICH piece carries the disclosure, so a future
    // change that moves the disclosure into the coaching slot (where no egress
    // allowlist governs it, and where it would not be part of the receipt)
    // fails here instead of passing a loose whole-string `toContain`.
    plotResponse = plotEnvelope({
      constraintsStatus: 'unavailable',
      warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'],
    });
    const turn = await runAnalysisTurn(app);
    expect(turn.confirmation).toContain('could not be checked');
    expect(turn.confirmation).toContain('Tell me the limit you meant');
    expect(turn.confirmation.startsWith(FALLBACK)).toBe(true);
    // The withheld headline is why the confirmation opens with the locked
    // template rather than "Hire Marketing Manager currently leads".
    expect(turn.assistantText).not.toContain('currently leads');
  });
});

/**
 * THE COACHING TAIL — the second producer of claims about the same state.
 *
 * The confirmation above says "no option can be put forward yet". The composer
 * then appends the STEP-5 coaching piece to the SAME `assistant_text`, and that
 * copy presumes the very leader the confirmation declined to name — on a re-run
 * it names the option outright. Observed verbatim before the fix:
 *
 *   [0] "Ran analysis on your current scenario. One of the conditions you set
 *        could not be checked: “Total three-year cost”. … so no option can be put
 *        forward yet. Tell me the limit you meant … then run the analysis again."
 *   [1] "Your first analysis is ready. Take a moment to explore the leading
 *        option and the factors shaping it before acting on the result."
 *
 * WHY NO EXISTING DEFENCE CAUGHT IT: `isAllowedRunAnalysisAssistantText`
 * governs only the CONFIRMATION segment. The coaching piece is a separate
 * compose slot that never passes through it, so every defence built for the
 * headline is bypassed one line underneath.
 *
 * The gate is `mayNameLeadingOption === false`, NOT a list of state names, so a
 * future withholding state is covered without touching this code. All three
 * current withholding states are exercised below for the same reason the enum
 * exists: they reach this slot by one path.
 */
const LEADING_OPTION_LANGUAGE: readonly RegExp[] = [
  /explore the leading option/i,
  /\bstill leads\b/i,
  /\bnow leads\b/i,
  /\bled before\b/i,
  /its lead has (?:widened|narrowed)/i,
  /the result is unchanged/i,
];

/**
 * The three states in which the verdict forbids naming a leading option.
 *
 * `opts` is the SAME argument `envelope()` passes, exposed so a later describe
 * can add a flag (`withThirdOption`) without re-deriving which options select
 * which verdict. `envelope()` is defined in terms of it, so the two cannot
 * drift — a second literal copy of these arguments is exactly the
 * hand-maintained mirror CLAUDE.md trap #12 is about.
 */
const WITHHOLDING_STATES = [
  {
    state: 'unevaluated',
    opts: { constraintsStatus: 'unavailable', warningCodes: ['CONSTRAINT_OUT_OF_DOMAIN'] },
  },
  { state: 'identity_unresolved', opts: { constraintKey: 'out_total_cost_<=' } },
  {
    state: 'evaluated_infeasible',
    opts: { constraintKey: 'constraint_out_total_cost_max', constraintProb: 0 },
  },
].map((entry) => ({ ...entry, envelope: () => plotEnvelope(entry.opts) }));

describe('withhold paths: the coaching tail must not presume a leading option', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  describe('POSITIVE CONTROLS — the test can fail in BOTH directions', () => {
    // Without these, every `not.toMatch` below would pass on a turn that
    // emitted no coaching at all. These assert the copy IS present on
    // `evaluated_feasible`, so a fix that simply deleted all coaching fails.

    it('evaluated_feasible, FIRST run: the coaching copy IS still present', () => {
      plotResponse = plotEnvelope({ constraintKey: 'constraint_out_total_cost_max' });
      return runAnalysisTurn(app).then((turn) => {
        expect(turn.status).toBe(200);
        expect(turn.coaching).toMatch(/explore the leading option/i);
      });
    });

    it('evaluated_feasible, RE-RUN: the coaching copy names the option', () => {
      // Also proves the re-run branch is genuinely reached — the first-run copy
      // is asserted ABSENT, so a fixture that silently fell back to the
      // first-run signal fails here instead of passing the withhold assertions
      // below for the wrong reason.
      plotResponse = plotEnvelope({ constraintKey: 'constraint_out_total_cost_max' });
      seedPriorRun();
      return runAnalysisTurn(app).then((turn) => {
        expect(turn.status).toBe(200);
        expect(turn.coaching).not.toMatch(/your first analysis is ready/i);
        expect(turn.coaching).toContain('Hire Marketing Manager');
      });
    });
  });

  for (const { state, envelope } of WITHHOLDING_STATES) {
    describe(`${state}`, () => {
      it('FIRST analysis: no leading-option language in the serialised bytes', async () => {
        plotResponse = envelope();
        const turn = await runAnalysisTurn(app);
        expect(turn.status).toBe(200);
        for (const pattern of LEADING_OPTION_LANGUAGE) {
          expect(turn.assistantText).not.toMatch(pattern);
        }
        expect(turn.assistantText).not.toContain('Hire Marketing Manager');
      });

      it('RE-RUN: no leading-option language in the serialised bytes', async () => {
        // The worse case: `composeRerunText` NAMES the option in four of its
        // five branches, on a turn whose claim-safety machinery just withheld
        // exactly that claim.
        plotResponse = envelope();
        seedPriorRun();
        const turn = await runAnalysisTurn(app);
        expect(turn.status).toBe(200);
        for (const pattern of LEADING_OPTION_LANGUAGE) {
          expect(turn.assistantText).not.toMatch(pattern);
        }
        expect(turn.assistantText).not.toContain('Hire Marketing Manager');
      });

      it('FIRST analysis: the coaching slot is SUPPRESSED, not reworded', async () => {
        // The confirmation already names the condition and gives the repair
        // step. A replacement sentence would be a second, competing
        // call-to-action on the same screen.
        plotResponse = envelope();
        const turn = await runAnalysisTurn(app);
        expect(turn.coaching).toBe('');
        // …and the confirmation is still there, so the screen is not empty.
        expect(turn.confirmation.length).toBeGreaterThan(0);
      });

      it('RE-RUN: the comparison-free acknowledgement survives', async () => {
        // This one is KEPT rather than suppressed: "your earlier result has
        // been replaced" is information the confirmation does not carry, and it
        // presumes no leader. It is `composeRerunText`'s own existing degrade,
        // reused rather than written.
        plotResponse = envelope();
        seedPriorRun();
        const turn = await runAnalysisTurn(app);
        expect(turn.coaching).toBe(
          'This was a re-run. It replaces the earlier result as the current analysis.',
        );
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// G-CEE-1 REMEDIATION — the BLOCKS, not just the confirmation.
//
// The 26 Jul live walk (staging `1c078f0`) passed assertions (a)–(c) and failed
// (d): the SAME HTTP response that said "no option can be put forward yet"
// carried, in its rendered block prose —
//
//   blocks[1].body  "The MacBook Pro leads by a margin of about 52 percentage
//                    points…"                          (review_card, narrative)
//   blocks[2].body  "…the lead depends on assumptions…" (review_card, robustness)
//   blocks[13].body "…could tip which option leads…"    (coaching, strengthen)
//
// #709's sweep was scoped to producers of the `coaching_text` STRING FIELD.
// True for that field; the user-visible leader claim was never confined to it.
//
// These tests assert on the SERIALISED HTTP BYTES (`turn.raw`) — past the
// compose funnel, the terminology rewrite, the prose guard, the egress
// sanitiser and JSON serialisation. A test upstream of any of those cannot see
// this defect class (TESTING-DISCIPLINE rule 3).
// ═══════════════════════════════════════════════════════════════════════════

/** Parse the wire body and index the Phase-3 blocks by kind. */
function blocksOf(raw: string): Array<Record<string, any>> {
  const body = JSON.parse(raw) as Record<string, any>;
  return Array.isArray(body.blocks) ? body.blocks : [];
}
function cardKinds(raw: string): string[] {
  return blocksOf(raw)
    .map((b) => b.card_kind ?? b.coaching_kind)
    .filter((k): k is string => typeof k === 'string');
}

describe('withhold paths: leader-presuming BLOCK PROSE must not reach the wire', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  describe('POSITIVE CONTROLS — the suite fails in BOTH directions', () => {
    // Without these, every absence assertion below would pass on a turn that
    // emitted no Phase-3 blocks at all — which is exactly how an
    // over-suppressing fix ships green while costing users their whole review.

    it('evaluated_feasible: the leader-presuming cards ARE built and DO reach the wire', async () => {
      plotResponse = plotEnvelope({
        constraintKey: 'constraint_out_total_cost_max',
        withDecisionReview: true,
      });
      const turn = await runAnalysisTurn(app);
      expect(turn.status).toBe(200);

      const kinds = cardKinds(turn.raw);
      // The three walk-failing producers, present on a healthy run.
      expect(kinds).toContain('narrative');
      expect(kinds).toContain('robustness');
      // …and the copy itself is on the serialised bytes, verbatim.
      expect(turn.raw).toContain('leads by a margin of about 52 percentage points');
      expect(turn.raw).toContain('the lead depends on assumptions');
    });

    it('evaluated_feasible: the non-comparative cards are ALSO present (the baseline)', async () => {
      plotResponse = plotEnvelope({
        constraintKey: 'constraint_out_total_cost_max',
        withDecisionReview: true,
      });
      const turn = await runAnalysisTurn(app);
      expect(cardKinds(turn.raw)).toContain('assumption');
    });
  });

  for (const { state, envelope } of WITHHOLDING_STATES) {
    describe(`${state}`, () => {
      /** The same envelope this state selects, plus the leader-asserting review. */
      const withReview = () => ({ ...envelope(), decision_review: LEADER_DECISION_REVIEW });

      it('the three live-failing block bodies are ABSENT from the serialised bytes', async () => {
        plotResponse = withReview();
        const turn = await runAnalysisTurn(app);
        expect(turn.status).toBe(200);

        // Scoped to RENDERED BLOCK PROSE. The `decision_review` BLOB also rides
        // the wire on `blocks[0].enrichment` (it is on the safe-transport
        // allowlist) and layer 2 does not touch it — that residual has its own
        // test below, and conflating the two here would hide whichever one got
        // fixed first.
        const prose = JSON.stringify(
          blocksOf(turn.raw).map(({ enrichment, ...rest }) => { void enrichment; return rest; }),
        );
        // blocks[1] — narrative. The exact live sentence class.
        expect(prose).not.toContain('leads by a margin of about 52 percentage points');
        // blocks[2] — robustness.
        expect(prose).not.toContain('the lead depends on assumptions');
        // blocks[13] — the deterministic lens copy bank. Five of the eight
        // BODY_BY_RATIONALE entries assert a leader; `tip which option leads`
        // is the phrasing shared by FLIP_RISK_ISOLATED and FLIP_RISK_CORRELATED
        // and by the flip_threshold card's own narrative.
        // The deterministic lens copy bank: five of the eight BODY_BY_RATIONALE
        // entries assert a leader, and `tip which option leads` is the phrasing
        // shared by FLIP_RISK_ISOLATED and FLIP_RISK_CORRELATED.
        expect(prose).not.toContain('tip which option leads');
        expect(prose).not.toContain('leading option is ahead');
      });

      it('the leader-presuming CARD KINDS are dropped whole, not reworded', async () => {
        // Dropped whole because the bodies are LLM-authored from
        // `enrichment.decision_review` and the served prompt instructs the model
        // to name the winner and give the margin — there is no template to gate
        // and no substitution that makes that prose honest.
        plotResponse = withReview();
        const turn = await runAnalysisTurn(app);
        const kinds = cardKinds(turn.raw);
        for (const kind of ['narrative', 'robustness', 'scenario_context', 'flip_threshold', 'strengthen']) {
          expect(kinds, `${kind} survived a withheld turn`).not.toContain(kind);
        }
      });

      it('OVER-SUPPRESSION CONTROL: non-comparative cards still ship', async () => {
        // The user needs their review most on exactly the turn we are
        // withholding a recommendation. A fix that stripped everything would
        // pass every absence assertion above; this is what stops it.
        plotResponse = withReview();
        const turn = await runAnalysisTurn(app);
        expect(cardKinds(turn.raw)).toContain('assumption');
        expect(turn.raw).toContain('The hiring pipeline stays open through the year');
      });

      it('the confirmation and the blocks now AGREE — the (d) assertion', async () => {
        // The whole gate, in one assertion: the response must not both withhold
        // the leading option in words and assert it in prose.
        plotResponse = withReview();
        const turn = await runAnalysisTurn(app);
        const hits = findLeaderClaims(JSON.parse(turn.raw));
        // The enrichment blob is a KNOWN, DELIBERATE residual — see the
        // dedicated test below. Everything the UI renders as block prose must
        // be clean.
        const prose = hits.filter((h) => !h.path.includes('.enrichment.'));
        expect(
          prose.map((h) => `${h.path} (${h.code})`),
          'a leading-option claim survived to the wire on a withheld turn',
        ).toEqual([]);
      });
    });
  }

  // ── LAYER 3, on the real route ────────────────────────────────────────────

  it('LAYER 3: the egress guard is ARMED on the real route and stays silent on a clean turn', async () => {
    const events: Array<{ name: string }> = [];
    setTestSink((name) => events.push({ name }));
    plotResponse = plotEnvelope({
      constraintKey: 'constraint_out_total_cost_max',
      withDecisionReview: true,
    });
    await runAnalysisTurn(app);
    expect(events.filter((e) => e.name === 'v5.egress.leading_option_claim_withheld_violated'))
      .toEqual([]);
  });

  it('LAYER 3: the FORMER residual — the enrichment blob no longer carries the leader prose', async () => {
    // ═══════════════════════════════════════════════════════════════════════
    // RE-POINTED AT SOURCE, ROADMAP 1.218. TESTING-DISCIPLINE rule 5 — the
    // rationale lives here so a future reader needs no PR archaeology.
    //
    // WHAT THIS TEST USED TO ASSERT, verbatim:
    //
    //     expect(hits.map((h) => h.path)).toEqual(
    //       ['blocks[0].enrichment.decision_review.narrative_summary']);
    //
    // …under the heading "the KNOWN RESIDUAL — the enrichment blob STILL
    // carries the leader prose", and it said of itself: "This test pins the
    // residual so it cannot be forgotten, and it FAILS THE DAY IT IS FIXED —
    // at which point delete it and assert the absence."
    //
    // THIS IS THAT DAY. The residual is fixed (compose/
    // withheld-claim-projection.ts drops `decision_review` whole and the three
    // leader-ranking members of `decision_brief` on a withheld turn), so the
    // old expectation is inverted here rather than deleted: the shape it
    // described is exactly the regression this file must keep catching.
    //
    // The assertion is NOT weakened in the process. It still reads the guard's
    // own scanner over the SERIALISED bytes, it still enumerates every hit
    // path rather than counting, and the guard's scan surface is now STRICTLY
    // WIDER than it was when the old expectation was written (deep walk over
    // `decision_review` AND `decision_brief`, fixing the `story_headlines`
    // dict/array blindness) — so the zero below is measured by a bigger net,
    // not a smaller one. Its non-vacuity control is the sibling
    // `evaluated_feasible` test in the block above, which proves this same
    // instrument, on this same route, still returns hits when the claim is
    // licensed.
    // ═══════════════════════════════════════════════════════════════════════
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data: data as Record<string, unknown> }));

    plotResponse = { ...plotEnvelope({ constraintsStatus: 'unavailable' }), decision_review: LEADER_DECISION_REVIEW };
    const turn = await runAnalysisTurn(app);

    const hits = findLeaderClaims(JSON.parse(turn.raw));
    expect(
      hits.map((h) => `${h.path} (${h.code})`),
      'a leading-option claim reached the wire on a withheld turn',
    ).toEqual([]);

    // …and the alarm therefore stays SILENT, where it used to fire. This is the
    // other half of the inversion: the guard is observe-only, so "no event" is
    // the only observable that distinguishes a clean withheld turn from a
    // leaking one.
    const fired = events.filter(
      (e) => e.name === 'v5.egress.leading_option_claim_withheld_violated',
    );
    expect(fired.map((f) => f.data)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ROADMAP 1.218 — THE VERDICT GATES EVERY EGRESS SURFACE, NOT JUST PROSE.
//
// The POST-#710 live walk (staging `227e0aa`,
// `acceptance-evidence/g-cee-1-constraint-verdict/WALK-2026-07-26-POST-710.md`)
// closed the rendered-prose failure and measured what remained. On **5/5**
// withheld bodies, the same HTTP response that said "no option can be put
// forward yet" still carried:
//
//   blocks[0].leading_option_id                              `opt_status_quo`
//   ui_directive                                    `highlight → opt_status_quo`
//   …enrichment.decision_brief.headline             "… currently leads, …"
//   …enrichment.decision_brief.headline_banded      { band: 'slightly_ahead',
//                                                     leader_option_id: … }
//   …enrichment.decision_review.*                   leader prose, 7+ sub-paths
//
// …while all 5 PERMITTED bodies shipped `focus → <a factor>`. The one class of
// turn that must not name a leader was the only class pointing the canvas at
// it.
//
// Asserted on the SERIALISED HTTP BYTES, past compose, the terminology
// rewrite, the egress sanitiser and JSON serialisation (TESTING-DISCIPLINE
// rule 3). Every absence below is paired with a POSITIVE CONTROL on
// `evaluated_feasible` proving the same surface still carries its content when
// the claim is licensed — over-suppression is a failure equal to the leak.
// ═══════════════════════════════════════════════════════════════════════════

/** The `analysis_result` block off the wire. */
function analysisBlockOf(raw: string): Record<string, any> {
  const block = blocksOf(raw).find((b) => b.type === 'analysis_result');
  if (block === undefined) throw new Error('no analysis_result block on the wire');
  return block;
}
/** Every `ui_directive` block off the wire, flattened to `verb → target ids`. */
function uiDirectivesOf(raw: string): string[] {
  return blocksOf(raw)
    .filter((b) => b.type === 'ui_directive')
    .map((b) => `${b.verb} → ${(b.targets ?? []).map((t: Record<string, any>) => t.id).join('|')}`);
}

describe('withhold paths: the STRUCTURED leader residue must not reach the wire', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  /** The healthy envelope: the ratified constraint scored under CEE's own id. */
  const feasible = () =>
    plotEnvelope({
      constraintKey: 'constraint_out_total_cost_max',
      withDecisionReview: true,
      withDecisionBrief: true,
      withRobustness: true,
    });

  describe('POSITIVE CONTROLS — evaluated_feasible keeps every one of these surfaces', () => {
    // Without these, all five absence assertions below would pass on a turn
    // that shipped no enrichment, no directive and no leader id at all — which
    // is precisely how an over-suppressing "fix" ships green while costing the
    // user their whole analysis.

    it('leading_option_id, the enrichment blobs and the brief all ride the wire', async () => {
      plotResponse = feasible();
      const turn = await runAnalysisTurn(app);
      expect(turn.status).toBe(200);
      const block = analysisBlockOf(turn.raw);

      expect(block.leading_option_id).toBe('opt_hire');
      expect(block.enrichment.decision_review).toBeDefined();
      expect(block.enrichment.decision_review.narrative_summary).toContain('leads by a margin');
      expect(block.enrichment.decision_brief.headline).toContain('currently leads');
      expect(block.enrichment.decision_brief.headline_banded.leader_option_id).toBe('opt_hire');
      expect(block.enrichment.decision_brief.headline_banded.band).toBe('slightly_ahead');
      expect(block.enrichment.decision_brief.robustness_caveat.text).toContain('which option leads');
    });

    it('a ui_directive IS emitted on a permitted run', async () => {
      plotResponse = feasible();
      const turn = await runAnalysisTurn(app);
      // The verb is whatever the §2.1 ladder selects for this fixture (row 2
      // lens `focus` supersedes row 3 `highlight` when a lens block survives);
      // this control asserts only that the ladder still REACHES an emission,
      // which is the thing the withheld gate must not destroy for permitted
      // turns.
      expect(uiDirectivesOf(turn.raw).length).toBe(1);
    });

    it('the guard SEES the licensed claim — the instrument is not blind', async () => {
      // The non-vacuity control for every `toEqual([])` below, and the specific
      // proof that the two scan-surface defects this PR fixes are fixed: the
      // `story_headlines` DICT (`Array.isArray` was false on 10/10 live bodies,
      // so the loop body never ran) and `decision_brief` (not scanned at all).
      // `findLeaderClaims` is the PURE scanner — it carries no verdict gate, so
      // calling it on a permitted turn asserts the SCAN SURFACE directly.
      plotResponse = feasible();
      const turn = await runAnalysisTurn(app);
      const paths = findLeaderClaims(JSON.parse(turn.raw)).map((h) => h.path);
      expect(paths).toContain('blocks[0].enrichment.decision_review.narrative_summary');
      expect(paths).toContain('blocks[0].enrichment.decision_review.story_headlines.opt_hire');
      expect(paths).toContain('blocks[0].enrichment.decision_brief.headline');
      expect(paths).toContain('blocks[0].enrichment.decision_brief.headline_banded.text');
      expect(paths).toContain('blocks[0].enrichment.decision_brief.robustness_caveat.text');
    });

    it('the STRUCTURED designations ride the wire on a permitted run', async () => {
      // The load-bearing half of the 2026-07-27 slice's over-suppression arm.
      // The hoist already widened the suppression estate; a projection that ate
      // these on a HEALTHY run would cost the user the recommendation itself,
      // and every absence assertion below would still be green.
      plotResponse = feasible();
      const turn = await runAnalysisTurn(app);
      const enrichment = analysisBlockOf(turn.raw).enrichment;

      expect(enrichment.decision_brief.analysis_summary.leading_option).toBe(
        'Hire Marketing Manager',
      );
      expect(enrichment.decision_brief.analysis_summary.win_probability).toBe(0.72);
      expect(enrichment.robustness.recommended_option_id).toBe('opt_hire');
      expect(enrichment.robustness.recommended_option_label).toBe('Hire Marketing Manager');
      expect(enrichment.robustness.near_tie.top_option_id).toBe('opt_hire');
      expect(enrichment.robustness.near_tie.second_option_id).toBe('opt_hold');
      expect(enrichment.robustness.near_tie.tied_option_ids).toEqual(['opt_hire']);
    });

    it('the guard SEES the structured designation — the KEY reader is not blind', async () => {
      // ═══════════════════════════════════════════════════════════════════════
      // THE NON-VACUITY PROOF FOR THE WHOLE 2026-07-27 SLICE (TESTING-DISCIPLINE
      // rule 1 / CLAUDE.md trap 13: an absence assertion must first prove it can
      // see a presence).
      //
      // Every value below is a BARE OPTION LABEL or a BARE OPTION ID. None of
      // them contains one word of comparative English, so `textNamesLeadingOption`
      // — the reader every prior version of this guard used — returns false on all
      // of them. That is precisely why three walks reported "S1–S6 all silent"
      // over corpora carrying this: the claim is in the KEY, and no text matcher
      // reads keys.
      //
      // These paths therefore appear here ONLY because `keyDesignatesLeadingOption`
      // exists. Narrow that pattern family and this test goes red before the
      // withheld assertions below start silently passing on an unscanned surface.
      // ═══════════════════════════════════════════════════════════════════════
      plotResponse = feasible();
      const turn = await runAnalysisTurn(app);
      const hits = findLeaderClaims(JSON.parse(turn.raw)).map((h) => `${h.path} (${h.code})`);

      expect(hits).toContain(
        'blocks[0].enrichment.decision_brief.analysis_summary.leading_option (key_leading_option)',
      );
      expect(hits).toContain(
        'blocks[0].enrichment.robustness.recommended_option_id (key_recommended_option)',
      );
      expect(hits).toContain(
        'blocks[0].enrichment.robustness.recommended_option_label (key_recommended_option)',
      );
      expect(hits).toContain(
        'blocks[0].enrichment.robustness.near_tie.top_option_id (key_top_option)',
      );
      // …and the block's own leader id, which sat outside every scan surface in
      // this module until the same change.
      expect(hits).toContain('blocks[0].leading_option_id (key_leading_option)');
    });

    it('the guard does NOT read the counterfactual winner as a leader designation', async () => {
      // The anchor control. `fragile_edges[].alternative_winner_label` is a bare
      // option label under a key containing "winner"; an unanchored pattern
      // family would report it, the projection sharing that family would then
      // DROP it, and a fragility finding would lose the one field that says what
      // flipping the edge does. PR #717 landed a fix to carry exactly this field
      // through the flip path.
      plotResponse = feasible();
      const turn = await runAnalysisTurn(app);
      const hits = findLeaderClaims(JSON.parse(turn.raw)).map((h) => h.path);
      expect(hits.filter((p) => p.includes('alternative_winner'))).toEqual([]);
    });
  });

  for (const { state, envelope } of WITHHOLDING_STATES) {
    describe(`${state}`, () => {
      const withBlobs = () => ({
        ...envelope(),
        decision_review: LEADER_DECISION_REVIEW,
        decision_brief: LEADER_DECISION_BRIEF,
        robustness: LEADER_ROBUSTNESS,
      });

      it('(c) leading_option_id is NULL, not the leader id', async () => {
        // DGAI's `V5AnalysisResultBlock.tsx` renders a `data-leader="true"`
        // win-probability pill straight off this field, so the id surviving a
        // clean-prose withheld turn is a VISUAL leader marker on the same
        // screen as "no option can be put forward yet". `null` is the boundary
        // schema's own value for the field (`z.string().nullable()`).
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        expect(turn.status).toBe(200);
        expect(analysisBlockOf(turn.raw).leading_option_id).toBeNull();
        expect(turn.raw).not.toContain('"leading_option_id":"opt_hire"');
      });

      it('(c) NO ui_directive points at the leading option', async () => {
        // The walk's inverted correlation: `highlight → <leader>` on 5/5
        // withheld bodies, `focus → <a factor>` on 5/5 permitted ones.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        for (const directive of uiDirectivesOf(turn.raw)) {
          expect(directive, 'a directive pointed at the leading option').not.toContain('opt_hire');
        }
      });

      it('(a) decision_brief ships WITHOUT its three leader-ranking members', async () => {
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const brief = analysisBlockOf(turn.raw).enrichment?.decision_brief;
        expect(brief, 'the brief itself must survive — see the control below').toBeDefined();
        expect(brief.headline).toBeUndefined();
        expect(brief.headline_banded).toBeUndefined();
        expect(brief.robustness_caveat).toBeUndefined();
        // …and the strings themselves are off the SERIALISED bytes, not merely
        // off one parsed path.
        expect(turn.raw).not.toContain('currently leads');
        expect(turn.raw).not.toContain('is slightly ahead');
        expect(turn.raw).not.toContain('could change which option leads');
        expect(turn.raw).not.toContain('slightly_ahead');
      });

      it('(a) OVER-SUPPRESSION CONTROL: the rest of the brief still ships', async () => {
        // The user needs the drivers, the assumptions and the warnings MOST on
        // the turn where the recommendation is being withheld. A fix that
        // dropped `decision_brief` whole would pass every absence assertion
        // above; this is what stops it.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const brief = analysisBlockOf(turn.raw).enrichment.decision_brief;
        expect(brief.top_drivers).toBeDefined();
        expect(brief.key_assumptions).toEqual(['Hiring pipeline health']);
        expect(brief.what_would_change).toBeDefined();
        expect(brief.warnings).toBeDefined();
        expect(brief.analysis_summary).toBeDefined();
        expect(brief.options).toBeDefined();
        expect(turn.raw).toContain('Hiring pipeline health');
      });

      it('(e) analysis_summary ships WITHOUT the leader and its win probability', async () => {
        // WALK-2026-07-27-FINAL.md §8, channel 1 of 2. Present on 10/10 withheld
        // bodies that carried an analysis block, and in BOTH prior archives —
        // pre-existing, uncovered by S1–S6 because the hand-kept list has no
        // entry for this container.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const summary = analysisBlockOf(turn.raw).enrichment.decision_brief.analysis_summary;

        expect(summary.leading_option).toBeUndefined();
        expect(summary.win_probability).toBeUndefined();
        // …and off the SERIALISED bytes, not merely off one parsed path. The
        // label still appears elsewhere on a permitted-shaped envelope, so the
        // assertion is scoped to the KEY that carries the designation.
        expect(turn.raw).not.toContain('"leading_option":"Hire Marketing Manager"');
      });

      it('(e) OVER-SUPPRESSION CONTROL: the rest of analysis_summary still ships', async () => {
        // The complete member manifest of this object across all five archives
        // is {leading_option, win_probability, goal_fit, robustness_band}. Two
        // go; two must stay — both name no option and rank nothing, and both are
        // on the KEEP list of the model-facing projection for the same reason.
        // Dropping `analysis_summary` whole would pass the assertion above.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const summary = analysisBlockOf(turn.raw).enrichment.decision_brief.analysis_summary;

        expect(summary, 'analysis_summary itself must survive').toBeDefined();
        expect(summary.goal_fit).toBe(0);
        expect(summary.robustness_band).toBe('fragile');
      });

      it('(f) enrichment.robustness ships WITHOUT the recommendation or the tie identities', async () => {
        // WALK-2026-07-27-FINAL.md §8, channel 2 of 2 — and the blob the egress
        // guard did not scan at all. `recommended_option_label` is the sharpest:
        // a withheld turn declining to recommend an option, shipping a field
        // called "recommended option label" with that option's name in it.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const robustness = analysisBlockOf(turn.raw).enrichment.robustness;

        expect(robustness, 'the blob itself must survive — see the control below').toBeDefined();
        expect(robustness.recommended_option_id).toBeUndefined();
        expect(robustness.recommended_option_label).toBeUndefined();
        expect(robustness.near_tie.top_option_id).toBeUndefined();
        expect(robustness.near_tie.second_option_id).toBeUndefined();
        expect(robustness.near_tie.tied_option_ids).toBeUndefined();
        expect(turn.raw).not.toContain('"recommended_option_label"');
        expect(turn.raw).not.toContain('"top_option_id"');
      });

      it('(f) OVER-SUPPRESSION CONTROL: the fragility science survives intact', async () => {
        // KEEP THE FACT, DROP THE IDENTITIES. `near_tie` still says whether the
        // top of the ranking is a tie and by how much; the blob still says the
        // result is fragile and which edge makes it so. This is the content a
        // user needs MOST on the turn where the recommendation is withheld.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const robustness = analysisBlockOf(turn.raw).enrichment.robustness;

        expect(robustness.is_robust).toBe(false);
        expect(robustness.level).toBe('low');
        expect(robustness.confidence).toBe(0.72);
        expect(robustness.display_verdict).toBe('fragile');
        expect(robustness.display_verdict_reason).toBe('small changes could flip this result');
        expect(robustness.near_tie.is_tie).toBe(false);
        expect(robustness.near_tie.gap).toBe(0.44);
        expect(robustness.near_tie.threshold).toBe(0.1);
        // The counterfactual winner is NOT the leader and is NOT suppressed.
        expect(robustness.fragile_edges).toHaveLength(1);
        expect(robustness.fragile_edges[0].alternative_winner_id).toBe('opt_hold');
        expect(robustness.fragile_edges[0].alternative_winner_label).toBe('Hold');
        expect(robustness.fragile_edges[0].switch_probability).toBe(0.535);
      });

      it('(b) the decision_review blob does not ship at all', async () => {
        // Dropped WHOLE, not field-filtered: the blob is LLM-authored prose end
        // to end and its leader claims land under DYNAMIC keys (option ids,
        // factor ids, edge ids) on 7+ sub-paths across the live archive. A
        // field allow-list over it is the hand-maintained mirror CLAUDE.md trap
        // #12 is about. compose.ts already drops the CARDS built from this blob
        // whole on these turns, for the same stated reason.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        expect(analysisBlockOf(turn.raw).enrichment?.decision_review).toBeUndefined();
        expect(turn.raw).not.toContain('leads by a margin of about 52 percentage points');
        expect(turn.raw).not.toContain('overtakes');
      });

      it('(b) OVER-SUPPRESSION CONTROL: the other keep-listed science still ships', async () => {
        // `decision_review` going whole must not take the transport keep-list
        // with it.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        const enrichment = analysisBlockOf(turn.raw).enrichment;
        expect(enrichment.option_comparison).toBeDefined();
        expect(enrichment.option_comparison_status).toBeDefined();
        // …and the block's own non-enrichment payload is untouched.
        expect(analysisBlockOf(turn.raw).win_probabilities).toBeDefined();
        expect(analysisBlockOf(turn.raw).summary.length).toBeGreaterThan(0);
      });

      it('(d) THE WHOLE GATE: the guard finds ZERO leader claims anywhere', async () => {
        // One assertion over the entire serialised envelope, using the
        // production alarm's own scanner — so the route test and the guard
        // cannot drift apart, and so a leak through a producer nobody has
        // thought of yet fails HERE. Under the pre-1.218 code this returns the
        // enrichment-blob paths; its non-vacuity control is the
        // `evaluated_feasible` scanner test above.
        plotResponse = withBlobs();
        const turn = await runAnalysisTurn(app);
        expect(
          findLeaderClaims(JSON.parse(turn.raw)).map((h) => `${h.path} (${h.code})`),
          'a leading-option claim survived to the wire on a withheld turn',
        ).toEqual([]);
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// S9 — ORDINAL AND POSITIONAL DESIGNATION. WALK-2026-07-27-CONFIRM.md §6.
//
// THE FINDING, live on 7 of 7 withheld analysis-bearing bodies at build
// `7508820` and invisible to every instrument ever pointed at this wire:
//
//   `decision_brief.options[rank == 1]`  names the leader by LABEL and carries
//                                        its win probability
//   `decision_brief.options[0]`          the array ships sorted
//                                        win-probability-DESCENDING, so
//                                        position IS the designation with no
//                                        `rank` field needed
//
// Why nothing saw it: S1–S6 is a hand-kept list of five paths with no entry
// for this one; S7/S8 (`matcher-v4.py`) read KEY NAMES and `rank`, `label`,
// `win_probability` are innocent names — matcher-v4's own anchor control
// REQUIRES them to stay innocent, or it would manufacture an over-suppression
// finding against the deliberately-kept set; every prose tier sees bare labels
// and bare numbers; and the FINAL walk's derived manifest normalised
// `options[0]` → `options[]`, found all three options at that path, and
// classified it a symmetric roster — correct about the PATH, wrong about the
// OBJECT.
//
// THE RULING (A1, 2026-07-27) IS **DESIGNATION vs DATA**, and these tests pin
// BOTH sides of it, because a gate that only pins the suppression half is one
// "tighten it" away from deleting the user's analysis:
//
//   KEEP     every per-option `win_probability`, `win_probabilities`,
//            `option_comparison`. Computed facts the user is entitled to. The
//            verdict withholds a CLAIM, not the simulation's numbers — the same
//            doctrine that made the UI RELABEL rather than gate its probability
//            readouts (#493/#494). **The presence assertions below are
//            load-bearing, not decoration.**
//   GATE     `rank`. Not a measurement — an ordinal designation, a claim
//            wearing a number.
//   NEUTRALISE  the ORDER, by re-sorting on `option_id` so position is a pure
//            function of identities the payload already ships in full.
//
// The two sweeps below (`ordinalDesignations` / `positionalDesignations`) are
// the in-repo successor to `channel-sweep.py`: DERIVED over the whole
// serialised envelope rather than aimed at a known path, so the day a new
// producer ships a ranked array this file goes red instead of a fifth walk
// finding it. Their non-vacuity control is the `evaluated_feasible` arm, where
// both fire on exactly the path the walk measured.
// ═══════════════════════════════════════════════════════════════════════════

/** Ordinal key names, DELIBERATELY wider than the production predicate. */
const ORDINAL_VOCAB = [
  'rank',
  'ranking',
  'rank_index',
  'rank_position',
  'order',
  'ordering',
  'order_index',
  'position',
  'ordinal',
  'placement',
  'standing',
  'sequence',
  'seq',
  'slot',
];
/** Keys whose STRING value says "this object is about that option". */
const IDENTITY_KEYS = ['option_id', 'id', 'option_label', 'label', 'name', 'key'];

function everyNode(
  node: unknown,
  path: string,
  onObject: (path: string, obj: Record<string, unknown>) => void,
  onArray: (path: string, arr: unknown[]) => void,
): void {
  if (Array.isArray(node)) {
    onArray(path, node);
    node.forEach((child, i) => everyNode(child, `${path}[${i}]`, onObject, onArray));
    return;
  }
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    onObject(path, obj);
    for (const [k, v] of Object.entries(obj)) everyNode(v, path ? `${path}.${k}` : k, onObject, onArray);
  }
}

/**
 * The leader, and every option identity, derived from
 * `option_comparison[].win_probability` — VALUE-derived, never read off a field
 * that claims to name a leader, which would be circular.
 */
function optionRoster(raw: string): {
  leader: Set<string>;
  others: Set<string>;
  leaderWin: number;
} {
  const comparison = analysisBlockOf(raw).enrichment.option_comparison as Array<
    Record<string, any>
  >;
  const scored = [...comparison].sort((a, b) => b.win_probability - a.win_probability);
  const names = (o: Record<string, any>) =>
    new Set<string>([o.option_id, o.id, o.option_label, o.label].filter(Boolean));
  const others = new Set<string>();
  for (const o of scored.slice(1)) for (const n of names(o)) others.add(n);
  return { leader: names(scored[0]!), others, leaderWin: scored[0]!.win_probability };
}

function singlesOutLeader(obj: Record<string, unknown>, roster: ReturnType<typeof optionRoster>) {
  const values = IDENTITY_KEYS.map((k) => obj[k]).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return values.some((v) => roster.leader.has(v)) && !values.some((v) => roster.others.has(v));
}

/** Every object anywhere carrying an ordinal key AND singling out the leader. */
function ordinalDesignations(raw: string): string[] {
  const roster = optionRoster(raw);
  const hits: string[] = [];
  everyNode(
    JSON.parse(raw),
    '',
    (path, obj) => {
      for (const key of ORDINAL_VOCAB) {
        if (!(key in obj)) continue;
        if (singlesOutLeader(obj, roster)) hits.push(`${path}.${key}=${JSON.stringify(obj[key])}`);
      }
    },
    () => {},
  );
  return hits.sort();
}

/**
 * Every array anywhere whose POSITION carries the ranking.
 *
 * ⚠ THE CRITERION IS SHARPER THAN "LEADER FIRST", AND THE FIRST DRAFT OF THIS
 * FILE PROVED WHY. A roster in graph order puts the leader at `[0]` whenever
 * the user happened to create that option first — position determined by a
 * claim-free key is a COINCIDENCE, not information, and asserting `[]` on
 * "leader first" would fail on `analysis_ready.options` for a user who typed
 * their options in a lucky order. Two shapes DO carry the ranking:
 *
 *   MONOTONE  the array is sorted by a numeric member common to every element,
 *             and the element at the sorted extreme singles out the leader.
 *             That is `decision_brief.options[]` exactly: sorted
 *             win-probability-descending with the leader at `[0]`.
 *   SINGLETON the array is bare option identities and the leader is the ONLY
 *             option in it — `near_tie.tied_option_ids: ['opt_hire']`, which
 *             fired on 4 bodies of `raw-2026-07-27-final/` before #718 closed
 *             it. Nothing coincidental about naming one option and no other.
 */
function positionalDesignations(raw: string): string[] {
  const roster = optionRoster(raw);
  const hits: string[] = [];
  everyNode(
    JSON.parse(raw),
    '',
    () => {},
    (path, arr) => {
      if (arr.length === 0) return;
      if (arr.every((e) => e !== null && typeof e === 'object' && !Array.isArray(e))) {
        const records = arr as Array<Record<string, unknown>>;
        const common = Object.keys(records[0]!).filter((k) =>
          records.every((r) => typeof r[k] === 'number'),
        );
        for (const key of common) {
          const values = records.map((r) => r[key] as number);
          if (new Set(values).size < 2) continue; // a constant column orders nothing
          const desc = values.every((v, i) => i === 0 || values[i - 1]! >= v);
          const asc = values.every((v, i) => i === 0 || values[i - 1]! <= v);
          if (!desc && !asc) continue;
          const extreme = desc ? records[0]! : records[records.length - 1]!;
          if (singlesOutLeader(extreme, roster)) hits.push(`${path} sorted-by:${key}`);
        }
        return;
      }
      const strings = arr.filter((e): e is string => typeof e === 'string');
      if (strings.length !== arr.length) return;
      if (strings.some((s) => roster.leader.has(s)) && !strings.some((s) => roster.others.has(s))) {
        hits.push(`${path} singleton-leader`);
      }
    },
  );
  // Sorted so the manifest assertions do not depend on producer key order.
  return [...new Set(hits)].sort();
}

/** `decision_brief.options[]` off the wire. */
function briefOptionsOf(raw: string): Array<Record<string, any>> {
  return analysisBlockOf(raw).enrichment.decision_brief.options as Array<Record<string, any>>;
}
const isDescending = (xs: number[]) => xs.every((x, i) => i === 0 || xs[i - 1]! >= x);

describe('withhold paths: ORDINAL and POSITIONAL designation must not reach the wire', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    plotResponse = plotEnvelope({});
    priorTurns = [];
    priorFacts = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  describe('POSITIVE CONTROLS — evaluated_feasible keeps the ordinal AND the ordering', () => {
    const feasible = () =>
      plotEnvelope({
        constraintKey: 'constraint_out_total_cost_max',
        withDecisionBrief: true,
        withRobustness: true,
        withThirdOption: true,
      });

    it('the ranked options ride the wire in full on a permitted run', async () => {
      // Without this, every absence below would pass on a turn that shipped no
      // `options` array at all — the over-suppressing "fix" that ships green
      // while costing the user the comparison.
      plotResponse = feasible();
      const options = briefOptionsOf((await runAnalysisTurn(app)).raw);

      expect(options.map((o) => o.rank)).toEqual([1, 2, 3]);
      expect(options.map((o) => o.option_id)).toEqual(['opt_hire', 'opt_hold', 'opt_contract']);
      expect(options.map((o) => o.win_probability)).toEqual([0.72, 0.28, 0.1]);
      expect(isDescending(options.map((o) => o.win_probability))).toBe(true);
    });

    it('BOTH SWEEPS SEE IT, AND SEE NOTHING ELSE — a COMPLETE manifest', async () => {
      // TESTING-DISCIPLINE rule 1 / CLAUDE.md trap 13: an absence assertion must
      // first prove it can see a PRESENCE. These two sweeps are derived over the
      // whole envelope, so "they found nothing on a withheld turn" is worth
      // exactly as much as this control and no more.
      //
      // EXACT EQUALITY, not `toContain`, so this is a MANIFEST rather than a
      // spot check: on a permitted turn `decision_brief.options[]` is the ONLY
      // ordinal and the ONLY rank-carrying position in the entire envelope,
      // which is what makes "zero on the withheld arm" a measurement. A second
      // ranked producer appearing anywhere fails HERE, in the direction of
      // discovery, before it can fail silently on the withheld side.
      plotResponse = feasible();
      const raw = (await runAnalysisTurn(app)).raw;

      expect(ordinalDesignations(raw)).toEqual([
        'blocks[0].enrichment.decision_brief.options[0].rank=1',
      ]);
      // TWO entries, and the second is the sweep earning its keep:
      // `near_tie.tied_option_ids: ['opt_hire']` is the singleton shape that
      // fired on 4 bodies of `raw-2026-07-27-final/` and that #718 closed on
      // withheld turns. It is CORRECT here — this is the permitted arm — and
      // its presence proves the singleton branch is live rather than dead code
      // that would never have caught a regression.
      expect(positionalDesignations(raw)).toEqual([
        'blocks[0].enrichment.decision_brief.options sorted-by:win_probability',
        'blocks[0].enrichment.robustness.near_tie.tied_option_ids singleton-leader',
      ]);
    });
  });

  for (const { state, opts } of WITHHOLDING_STATES) {
    describe(`${state}`, () => {
      // The state's own verdict-selecting arguments, plus the third option.
      // Nothing about which constraint is scored, or how, is restated here.
      const withRanked = () => ({
        ...plotEnvelope({ ...opts, withThirdOption: true, withDecisionBrief: true }),
        robustness: LEADER_ROBUSTNESS,
      });

      it('(g) the ORDINAL is gone — no `rank` survives on the serialised bytes', async () => {
        plotResponse = withRanked();
        const turn = await runAnalysisTurn(app);
        for (const option of briefOptionsOf(turn.raw)) {
          expect(option.rank, 'an options[] element still carries its rank').toBeUndefined();
        }
        // …and off the SERIALISED bytes, not merely off one parsed path. The
        // `"` in the needle is what keeps `priority_rank` / `importance_rank`
        // out of it — those rank CARDS and FACTORS and are untouched.
        expect(turn.raw).not.toContain('"rank":');
      });

      it('(g) the ORDER is neutralised — position no longer tracks probability', async () => {
        // `options[0]` WAS the leader with no rank field needed. It is now the
        // canonical-by-identity first element, which on this graph is the
        // LOWEST-probability option — see THIRD_OPTION for why a two-option
        // fixture could not have measured this.
        plotResponse = withRanked();
        const options = briefOptionsOf((await runAnalysisTurn(app)).raw);

        expect(options.map((o) => o.option_id)).toEqual(['opt_contract', 'opt_hire', 'opt_hold']);
        expect(isDescending(options.map((o) => o.win_probability))).toBe(false);
        const top = Math.max(...options.map((o) => o.win_probability));
        expect(options[0]!.win_probability, 'options[0] is still the leader').not.toBe(top);
      });

      it('(g) ⚠ ANTI-OVER-SUPPRESSION: every PROBABILITY is still there', async () => {
        // THE LOAD-BEARING HALF OF THE RULING. Gating these would delete a
        // computed fact the user is entitled to; the verdict withholds the
        // CLAIM, not the numbers. Every other assertion in this describe would
        // still be green if the whole array had been dropped, and this is what
        // stops that being called a fix.
        plotResponse = withRanked();
        const turn = await runAnalysisTurn(app);
        const options = briefOptionsOf(turn.raw);

        expect(options).toHaveLength(3);
        expect([...options.map((o) => o.win_probability)].sort()).toEqual([0.1, 0.28, 0.72]);
        expect(options.map((o) => o.label).sort()).toEqual([
          'Contract a Freelancer',
          'Hire Marketing Manager',
          'Hold',
        ]);
        for (const option of options) {
          expect(typeof option.win_probability, `${option.option_id} lost its probability`).toBe(
            'number',
          );
          expect(typeof option.option_id).toBe('string');
        }
        // The whole roster is on the wire beside it, unprojected.
        expect(analysisBlockOf(turn.raw).win_probabilities['Hire Marketing Manager']).toBe(0.72);
        expect(analysisBlockOf(turn.raw).enrichment.option_comparison).toHaveLength(3);
        // …and the deliberately-kept scalar the walk flagged (§6 channel 4).
        // Traced to ISL `robustness_analyzer_v2.py:2739` / PLoT
        // `routes/v2/run.ts:2794`: it is the leader's win probability under a
        // name that implies calibration. A LABEL defect owned by the ISL→PLoT
        // contract, not a designation — it names no option.
        expect(analysisBlockOf(turn.raw).enrichment.robustness.confidence).toBe(0.72);
      });

      it('(g) THE DERIVED SWEEP: no ordinal designation anywhere in the envelope', async () => {
        // Not "the path I know about is clean" — every object at every depth,
        // against a vocabulary wider than the production predicate's.
        plotResponse = withRanked();
        const turn = await runAnalysisTurn(app);
        expect(
          ordinalDesignations(turn.raw),
          'an ordinal designation survived to the wire on a withheld turn',
        ).toEqual([]);
      });

      it('(g) THE DERIVED SWEEP: no leader-first array anywhere in the envelope', async () => {
        // Every array at every depth, objects and bare strings alike — the two
        // shapes `channel-sweep.py` could not reach (it collected only
        // all-dict arrays and required a `win_probability` on every element).
        plotResponse = withRanked();
        const turn = await runAnalysisTurn(app);
        expect(
          positionalDesignations(turn.raw),
          'a leader-first array survived to the wire on a withheld turn',
        ).toEqual([]);
      });
    });
  }
});

// ===========================================================================
// ROADMAP 2.349 — GAP 5: the minted deadline that nulled a computable leader
// ===========================================================================

/**
 * The walk's OWN minted constraint, transcribed member-for-member from the
 * draft SSE COMPLETE payload at `journey-witness-2026-08-04b-raw/p3b/
 * wire-run1-0-res.txt` (UI `b63f278d` · CEE `1ba181e` · staging):
 *
 *   {"constraint_id":"constraint_goal_arr_max","node_id":"goal_arr",
 *    "operator":"<=","value":18,"label":"Delivery deadline","unit":"months",
 *    "source_quote":"within 18 months","confidence":0.95,
 *    "provenance":"inferred","deadline_metadata":{"deadline_date":
 *    "2028-02-03","reference_date":"2026-08-03","assumed_reference_date":true}}
 *
 * `node_id` is relabelled onto this file's goal node (`goal_growth`); every
 * other member is the capture's. The `provenance: "inferred"` is kept because
 * it is the first of the three untruths — the copy said "a condition YOU set"
 * about something no user ever ratified.
 */
const WALK_DEADLINE_CONSTRAINT = {
  constraint_id: 'constraint_goal_arr_max',
  node_id: 'goal_growth',
  operator: '<=',
  value: 18,
  label: 'Delivery deadline',
  unit: 'months',
  source_quote: 'within 18 months',
  confidence: 0.95,
  provenance: 'inferred',
  deadline_metadata: {
    deadline_date: '2028-02-03',
    reference_date: '2026-08-03',
    assumed_reference_date: true,
  },
};

/**
 * PLoT's disclosure of the drop, in the shape `FilteredConstraintRecord`
 * declares at the pinned deployed SHA `eb73c6a9`
 * (`plot-lite-service/src/types/engine-v3.ts:348`), attached to `_meta` exactly
 * as `routes/v2/run.ts:3808` attaches it — only when the list is non-empty.
 */
function withFilteredConstraints(
  envelope: Record<string, unknown>,
  records: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...envelope,
    _meta: {
      source_path: 'v3',
      plot_build: 'eb73c6a',
      request_id: 'fixture',
      repairs_applied: [],
      filtered_constraints: records,
    },
  };
}

const TEMPORAL_FILTER_RECORD = {
  constraint_id: WALK_DEADLINE_CONSTRAINT.constraint_id,
  node_id: WALK_DEADLINE_CONSTRAINT.node_id,
  reason: 'temporal_deadline',
};

describe('2.349 R2 — gap 5 at the serialised HTTP boundary', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    setTestSink(() => {});
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedRunAnalysis());
    priorTurns = [];
    priorFacts = [];
    // Opt in: the scenario's ONLY ratified constraint is the minted deadline,
    // which is exactly the walk's state.
    activeGraph = { ...READY_GRAPH, goal_constraints: [WALK_DEADLINE_CONSTRAINT] };
    activeRatifiedConstraints = [WALK_DEADLINE_CONSTRAINT];
    plotResponse = withFilteredConstraints(plotEnvelope({}), [TEMPORAL_FILTER_RECORD]);
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('the leader is NAMED on the wire — `leading_option_id` is non-null', async () => {
    // The whole defect in one assertion. On the four failing walk runs this
    // field was `null` while `win_probabilities` showed a top-2 gap of 0.27,
    // 0.30 and 0.33 — roughly 3× the tie threshold.
    const turn = await runAnalysisTurn(app);
    expect(turn.status).toBe(200);
    const body = JSON.parse(turn.raw) as Record<string, any>;
    const block = body.blocks.find((b: any) => b.type === 'analysis_result');
    expect(block).toBeDefined();
    expect(block.leading_option_id).toBe('opt_hire');
    expect(block.leading_option_id).not.toBeNull();
  });

  it('and the three untruths are GONE from the bytes the user receives', async () => {
    const turn = await runAnalysisTurn(app);
    // CONTROL FIRST — the handler really composed a disclosure, so the
    // assertions below are about CONTENT, not about an empty string.
    expect(turn.blockSummary).toContain('Delivery deadline');

    // untruth #2 — "could not be checked", framing a deliberate, disclosed removal
    // as an engine anomaly.
    expect(turn.raw).not.toContain('could not be checked');
    expect(turn.raw).not.toContain('could not evaluate it against this model');
    // untruth #3 — a repair step that can never change the outcome.
    expect(turn.raw).not.toContain('Tell me the limit you meant');
    // and the withheld-leader consequence, which is simply false here.
    expect(turn.raw).not.toContain('no option can be put forward yet');
  });

  it('the honest sentence SURVIVES the egress allowlist and reaches assistant_text', async () => {
    // #703's failure mode: the correct copy composed, then was silently
    // replaced by the locked literal at the wire. `blockSummary` bypasses the
    // allowlist and `assistantText` does not, so asserting BOTH is what
    // distinguishes "not composed" from "not survived".
    const turn = await runAnalysisTurn(app);
    expect(turn.blockSummary).toContain('This analysis does not test');
    expect(turn.assistantText).toContain('This analysis does not test');
    expect(turn.assistantText).toContain('Delivery deadline');
    expect(turn.assistantText).toContain('stays recorded on your scenario');
    expect(turn.assistantText).not.toBe(FALLBACK);
  });

  it('the egress guard still finds no leaked leader claim it should not', async () => {
    // The 2.149 machinery is untouched; on a turn that legitimately names a
    // leader there is nothing for the guard to withhold, and the response is
    // simply a healthy one.
    const turn = await runAnalysisTurn(app);
    expect(turn.status).toBe(200);
    expect(turn.assistantText.length).toBeGreaterThan(0);
  });

  it('IDENTITY-BOUND (trap 19): a filtered record for a DIFFERENT id still withholds', async () => {
    // The other direction, and the one that proves the fix is not a blanket
    // "any `_meta.filtered_constraints` names a leader". PLoT discloses a drop
    // for a constraint this scenario never ratified; the walk's deadline is
    // therefore still unscored-and-undisclosed, and the withhold must fire
    // exactly as it did before 2.349.
    plotResponse = withFilteredConstraints(plotEnvelope({}), [
      { constraint_id: 'constraint_someone_elses', node_id: 'goal_growth', reason: 'temporal_deadline' },
    ]);
    const turn = await runAnalysisTurn(app);
    const body = JSON.parse(turn.raw) as Record<string, any>;
    const block = body.blocks.find((b: any) => b.type === 'analysis_result');
    expect(block.leading_option_id).toBeNull();
    expect(turn.assistantText).toContain('could not be checked');
  });

  it('IDENTITY-BOUND (trap 19): with NO producer disclosure the withhold fires unchanged', async () => {
    // The pre-2.349 wire, byte-for-byte: no `_meta`, nothing scored. This is
    // the 2.149 withhold doing its job, and it must be indistinguishable from
    // its behaviour before this change.
    plotResponse = plotEnvelope({});
    const turn = await runAnalysisTurn(app);
    const body = JSON.parse(turn.raw) as Record<string, any>;
    const block = body.blocks.find((b: any) => b.type === 'analysis_result');
    expect(block.leading_option_id).toBeNull();
    expect(turn.assistantText).toContain('could not be checked');
    expect(turn.assistantText).toContain('Tell me the limit you meant');
  });

  it('MIXED: a second, genuinely unscored constraint still withholds AND both are disclosed', async () => {
    // A removed constraint must not buy amnesty for a real one. The state
    // voice fires for the budget; the 2.349 voice fires for the deadline; both
    // survive the single allowlist slot.
    activeRatifiedConstraints = [WALK_DEADLINE_CONSTRAINT, RATIFIED_CONSTRAINT];
    activeGraph = {
      ...READY_GRAPH,
      goal_constraints: [WALK_DEADLINE_CONSTRAINT, RATIFIED_CONSTRAINT],
    };
    const turn = await runAnalysisTurn(app);
    const body = JSON.parse(turn.raw) as Record<string, any>;
    const block = body.blocks.find((b: any) => b.type === 'analysis_result');
    expect(block.leading_option_id).toBeNull();
    expect(turn.assistantText).toContain('Total three-year cost');
    expect(turn.assistantText).toContain('could not be checked');
    expect(turn.assistantText).toContain('This analysis does not test');
    expect(turn.assistantText).toContain('Delivery deadline');
  });
});
