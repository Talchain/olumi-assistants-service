/**
 * V5 body-`analysis_state` advice parity — turn-executor integration
 * acceptance for the recap-stub fix.
 *
 * Live defect (staging build 45cb0f6, Phase 0 evidence rerun, turn
 * `d77e40a0`): "What would change the outcome?" WITH body `analysis_state`
 * (the shape DGAI actually sends) degraded to the fresh-analysis recap stub
 * ("Here's the latest analysis recap. Open the analysis view…") while the
 * SAME message without body analysis_state produced grounded advice prose.
 *
 * Root cause: the ingress path projected `top_drivers: []` because
 * `compactAnalysis` only walks per-option `results[].factor_sensitivity`
 * and the live envelope carries drivers only in TOP-LEVEL
 * `factor_sensitivity[]`. The advice gate's `needs_top_driver` classes
 * (`what_would_flip_free_text`, `explain_results_free_text`) then failed
 * with `data_unavailable_for_class` and control fell through to the
 * fresh-analysis follow-up catch-net. The prior-facts fallback path already
 * had the top-level derivation; the request path did not.
 *
 * This test drives `runTurnExecutor` end-to-end with a routing adapter that
 * THROWS if invoked and a faithful staging-shaped `analysis_state` (trimmed
 * from the captured live envelope, INCLUDING its unusable flip data:
 * `flip_value: null`, `margin_sensitivity.value_scale: "normalised"`), and
 * asserts:
 *   - the recap stub is NOT emitted for a valid analysed scenario;
 *   - the response is grounded qualitative evidence-guidance prose;
 *   - NO `apply_proposed_change` proposal is emitted (out of scope, science-gated);
 *   - NO new numeric claims (raw decimals / EVPI / confidence wording);
 *   - ⚠ ROADMAP 2.229: the genuinely-data-absent case NO LONGER falls back to
 *     the recap copy — that guard is retired; it reaches the coach
 *     (the catch-net stays correct where it IS correct).
 *
 * Harness mirrors `turn-executor-fresh-analysis-followup.integration.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({
      graph: mockState.persistedGraph,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRIOR_RA_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_local_hire', kind: 'factor', label: 'Local Senior Hire Programme' },
    {
      id: 'opt_hire_local',
      kind: 'option',
      label: 'Hire Two Senior Engineers Locally',
      interventions: { fac_local_hire: 1 },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Continue with Current Team',
      is_baseline: true,
      interventions: { fac_local_hire: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_hire_local',
      to: 'fac_local_hire',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_local_hire',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_local_hire',
      to: 'goal_q3',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
  goal_node_id: 'goal_q3',
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

/**
 * Faithful trim of the captured live staging envelope (Phase 0 rerun,
 * scenario 686dfb35, turn 1ba88589): TOP-LEVEL `option_comparison` /
 * `factor_sensitivity` / `robustness.fragile_edges`, NO per-option
 * `results`, and the actually-observed UNUSABLE flip data (`flip_value:
 * null`, top-level `value_scale: null`,
 * `margin_sensitivity.value_scale: "normalised"` — an out-of-contract
 * scale string CEE must fail closed on).
 */
function stagingShapedAnalysisState(): Record<string, unknown> {
  return {
    analysis_status: 'computed',
    option_comparison: [
      {
        option_id: 'opt_hire_local',
        option_label: 'Hire Two Senior Engineers Locally',
        outcome: { mean: 0.138, p10: -0.144, p90: 0.391 },
        status: 'computed',
        win_probability: 0.638,
      },
      {
        option_id: 'opt_status_quo',
        option_label: 'Continue with Current Team',
        outcome: { mean: 0.002, p10: -0.044, p90: 0.048 },
        status: 'computed',
        win_probability: 0.156,
      },
    ],
    factor_sensitivity: [
      { label: 'Local Senior Hire Programme', elasticity: 0.42, direction: 'positive', influence_score: 0.42 },
      { label: 'Offshore Partner Engagement', elasticity: 0.31, direction: 'negative', influence_score: 0.31 },
    ],
    robustness: {
      level: 'low',
      is_robust: false,
      recommended_option_id: 'opt_hire_local',
      recommended_option_label: 'Hire Two Senior Engineers Locally',
      fragile_edges: [
        {
          from_label: 'Offshore Partner Engagement',
          to_label: 'Onboarding and Integration Drag',
          switch_probability: 0.21,
        },
      ],
    },
    flip_thresholds: [
      {
        factor_id: 'fac_hiring_cost',
        factor_label: 'Hiring and Onboarding Cost',
        flip_value: null,
        current_value: 0,
        value_scale: null,
        margin_sensitivity: { value_scale: 'normalised' },
        direction: 'increase',
        unit: '£',
        cap: null,
      },
    ],
  };
}

function makeFreshRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire_local',
      summary: 'Prior analysis result',
      // T1 claim safety (ROADMAP 1.233). REQUIRED on any fixture that expects
      // leader-naming prose, and this is a re-point at source, not a baseline
      // bump (TESTING-DISCIPLINE rule 5).
      //
      // The fixture models a COMPLETED analysis, but omitted the field that
      // records whether the user's ratified constraints were checked against
      // it. `readMayNameLeadingOptionFromResult` treats a completed analysis
      // with no verdict as UNKNOWN and fails CLOSED — "unknown" and "verified
      // feasible" are different claims and only the second licenses naming a
      // leader. That default has been in force on the EXECUTE path since #710;
      // 1.233 hoists the read to turn entry, so it now governs the
      // deterministic non-execute composers too (advice gate, run comparison,
      // bounded fallback), which is where this fixture's expectations live.
      //
      // Adding the stamp makes the fixture model what it always meant: a real,
      // constraint-checked, feasible run. Its previous silence was under-
      // specification, and the fact that removing this line turns the
      // leader-naming assertions below red is the mutation check on the 1.233
      // gates — proof they bite, delivered by the pre-existing suite.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_hire_local: 0.638, opt_status_quo: 0.156 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: PRIOR_RA_ROW_ID,
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

const RECAP_STUB_PREFIX = "Here's the latest analysis recap.";

function mkPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'frame',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error(
          'Routing adapter must NOT be called on the deterministic post-analysis path',
        );
      }),
  };
}

/**
 * ROADMAP 2.229 — for the data-absent case, which no longer short-circuits.
 * Records the call and answers with plain text rather than throwing.
 */
function recordingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'Routed coaching answer.' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock-routing',
        latencyMs: 0,
      })),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V5 body-analysis_state advice parity — recap-stub fix', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.persistedGraph = READY_GRAPH;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('"What would change the outcome?" + staging-shaped body analysis_state → grounded advice, NOT the recap stub', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What would change the outcome?'),
      'req-body-analysis-state-flip',
      {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        analysisState: stagingShapedAnalysisState() as never,
      },
    );

    // Deterministic path proof: no LLM routing call.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.telemetry.turn_class).toBe('direct_answer');

    // THE fix: the recap stub must NOT ship for a valid analysed scenario.
    expect(result.response.assistant_text).not.toContain(RECAP_STUB_PREFIX);

    // The advice gate matched the flip free-text class (previously
    // `data_unavailable_for_class` on this exact shape).
    const gateEvent = events.find((e) => e.event === 'v5.post_analysis_advice_gate');
    expect(gateEvent, 'advice gate telemetry should fire').toBeDefined();
    expect(gateEvent!.data.matched).toBe(true);
    expect(gateEvent!.data.advice_class).toBe('what_would_flip_free_text');

    // Grounded, qualitative evidence-guidance: names the leading option and
    // keeps the provisional caveat (fragile edges present in the envelope).
    expect(result.response.assistant_text).toContain('Hire Two Senior Engineers Locally');
    expect(result.response.assistant_text.toLowerCase()).toContain('provisional');

    // Out-of-scope surfaces stay closed: no proposal emission of any kind.
    const serialised = JSON.stringify(result.response);
    expect(serialised).not.toContain('apply_proposed_change');

    // No NEW numeric claims: no raw decimals (the unusable flip_value /
    // elasticities / switch_probability must never surface), no EVPI /
    // confidence wording. Integer percentages from the existing composer
    // copy ("probability of 64%", "48 percentage points") remain allowed.
    expect(result.response.assistant_text).not.toMatch(/\d+\.\d+/);
    expect(result.response.assistant_text).not.toMatch(/EVPI/i);
    expect(result.response.assistant_text).not.toMatch(/\bconfidence\b/i);
    expect(result.response.assistant_text).not.toContain('normalised');
  });

  it('telemetry confirms the parity wiring: analysis_state_source=request + top_driver_source=top_level', async () => {
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('What would change the outcome?'),
      'req-body-analysis-state-telemetry',
      {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        analysisState: stagingShapedAnalysisState() as never,
      },
    );

    const freshnessEvent = events.find(
      (e) =>
        e.data.analysis_state_source !== undefined &&
        e.data.dispatch_path === 'turn_executor_pre_handler',
    );
    expect(freshnessEvent, 'pre-handler freshness telemetry should fire').toBeDefined();
    expect(freshnessEvent!.data.analysis_state_source).toBe('request');
    expect(freshnessEvent!.data.top_driver_source).toBe('top_level');
    expect(freshnessEvent!.data.fragile_edge_source).toBe('top_level');
  });

  it('genuinely data-absent body analysis_state (no drivers anywhere) now reaches the coach instead of the recap stub', async () => {
    // ⚠ ROADMAP 2.229 — INVERTED, NOT DELETED. This case used to assert the
    // OPPOSITE: `not.toHaveBeenCalled()` on the adapter and
    // `toContain(RECAP_STUB_PREFIX)`, on the reasoning that "with no driver
    // data the needs_top_driver class cannot compose, and the deterministic
    // recap + chip is the honest fallback".
    //
    // That reasoning is exactly what the founder ruling overturned. The recap
    // is a string constant with ZERO inputs; it is not "honest fallback", it
    // is the absence of an answer. Data-absent is precisely the case where the
    // coach — which sees the conversation and the graph, not just the analysis
    // projection — has the best chance of saying something true. The guard
    // that emitted the constant is retired and its module deleted, so this
    // turn now falls through to `routeWithToolUse`.
    //
    // The part of the original claim that was about SAFETY is kept verbatim:
    // no proposal is fabricated on a data-absent turn.
    const adapter = recordingRoutingAdapter();
    const thin = stagingShapedAnalysisState();
    delete thin.factor_sensitivity;
    const result = await runTurnExecutor(
      mkPayload('What would change the outcome?'),
      'req-body-analysis-state-thin',
      {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        analysisState: thin as never,
      },
    );

    expect(adapter.chatWithTools, 'a data-absent post-analysis turn must reach the coach').toHaveBeenCalled();
    expect(result.response.assistant_text ?? '').not.toContain(RECAP_STUB_PREFIX);
    expect(JSON.stringify(result.response)).not.toContain('apply_proposed_change');
  });
});
