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
import { observeSerialisedPack } from '../context/__tests__/observe-serialised-pack.js';
import { pickLatestFactorEvppiPriorityGuidance } from '../coaching/select-factor-evppi.js';
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
  priorTurnsTotal: number;
  newestAnalysisFact: Record<string, unknown> | null;
  newestAnalysisFactReadError: Error | null;
  persistedGraph: unknown | null;
  persistedGraphReadError: Error | null;
  appendWrites: Array<Record<string, unknown>>;
  invalidationCalls: number;
  storeDraftGraphCalls: number;
} = {
  priorTurns: [],
  priorFacts: [],
  priorTurnsTotal: 0,
  newestAnalysisFact: null,
  newestAnalysisFactReadError: null,
  persistedGraph: null,
  persistedGraphReadError: null,
  appendWrites: [],
  invalidationCalls: 0,
  storeDraftGraphCalls: 0,
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      mockState.appendWrites.push(write);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => mockState.priorTurns,
    countTurns: async () => mockState.priorTurnsTotal,
    readFactsFor: async () => mockState.priorFacts,
    readScenarioRunAnalysisFactsFor: async () => {
      if (mockState.newestAnalysisFactReadError) {
        throw mockState.newestAnalysisFactReadError;
      }
      const facts = mockState.newestAnalysisFact
        ? [mockState.newestAnalysisFact]
        : mockState.priorFacts.filter(
            (fact) => fact.fact_type === 'run_analysis' && fact.noop !== true,
          );
      return { facts, total_count: facts.length };
    },
    readRecentAppliedMutationFactsFor: async (_scenarioId: string, limit: number) =>
      mockState.priorFacts
        .filter(
          (fact) =>
            fact.fact_type === 'add_constraint' &&
            fact.noop === false &&
            (fact.result as Record<string, unknown> | undefined)?.status ===
              'applied',
        )
        .slice(0, limit),
    // Obsolete compatibility port deliberately throws if production regresses
    // to the former second query/snapshot.
    readNewestAnalysisFactFor: async () => {
      throw new Error('obsolete readNewestAnalysisFactFor must not be called');
    },
    invalidateScoped: async () => {
      mockState.invalidationCalls += 1;
      return {
        scope: { kind: 'structural' as const },
        entries_invalidated: [],
      };
    },
    invalidateAll: async () => {
      mockState.invalidationCalls += 1;
      return {
        scope: { kind: 'structural' as const },
        entries_invalidated: [],
      };
    },
    storeDraftGraph: async () => {
      mockState.storeDraftGraphCalls += 1;
    },
    loadGraph: async () => {
      if (mockState.persistedGraphReadError)
        throw mockState.persistedGraphReadError;
      return mockState.persistedGraph;
    },
    loadGraphAndBriefText: async () => {
      if (mockState.persistedGraphReadError)
        throw mockState.persistedGraphReadError;
      return {
        graph: mockState.persistedGraph,
        briefText: null,
      };
    },
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
    { id: 'dec_q3', kind: 'decision', label: 'Choose the Q3 resourcing route' },
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
      from: 'dec_q3',
      to: 'opt_hire_local',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'dec_q3',
      to: 'opt_status_quo',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
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
 * Strict canonical graph used by the authority tests below. The request twin
 * carries the opposite baseline marker, so a single prompt exposes both
 * authorities at once: the saved graph must own baseline identity while the
 * saved run_analysis fact must own leader and driver identity.
 */
const CANONICAL_AUTHORITY_GRAPH = {
  ...READY_GRAPH,
  edges: READY_GRAPH.edges.map((edge) => ({
    ...edge,
    edge_type: 'directed' as const,
  })),
};

const CONFLICTING_REQUEST_GRAPH = {
  ...CANONICAL_AUTHORITY_GRAPH,
  nodes: CANONICAL_AUTHORITY_GRAPH.nodes.map((node) => {
    if (node.id === 'opt_hire_local') return { ...node, is_baseline: true };
    if (node.id === 'opt_status_quo') {
      const { is_baseline: _ignored, ...withoutBaseline } = node;
      void _ignored;
      return withoutBaseline;
    }
    return node;
  }),
};

const CANONICAL_AUTHORITY_GRAPH_HASH = computeAnalysisAffectingGraphHash(
  CANONICAL_AUTHORITY_GRAPH as never
)!;

const CANONICAL_LEADER_LABEL = 'Continue with Current Team';
const REQUEST_LEADER_LABEL = 'Hire Two Senior Engineers Locally';
const CANONICAL_DRIVER_LABEL = 'CANONICAL STORED delivery-certainty driver';
const REQUEST_DRIVER_LABEL = 'REQUEST ONLY fundraising-speed driver';

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

function conflictingRequestAnalysisState(): Record<string, unknown> {
  return {
    analysis_status: 'computed',
    option_comparison: [
      {
        option_id: 'opt_hire_local',
        option_label: REQUEST_LEADER_LABEL,
        outcome: { mean: 0.7, p10: 0.5, p90: 0.9 },
        status: 'computed',
        win_probability: 0.91,
      },
      {
        option_id: 'opt_status_quo',
        option_label: CANONICAL_LEADER_LABEL,
        outcome: { mean: 0.1, p10: 0, p90: 0.2 },
        status: 'computed',
        win_probability: 0.09,
      },
    ],
    factor_sensitivity: [
      {
        factor_id: 'fac_request_only',
        factor_label: REQUEST_DRIVER_LABEL,
        influence_score: 0.94,
        elasticity: 0.94,
        direction: 'positive',
      },
    ],
    robustness: {
      level: 'high',
      is_robust: true,
      recommended_option_id: 'opt_hire_local',
      recommended_option_label: REQUEST_LEADER_LABEL,
      fragile_edges: [],
    },
  };
}

function canonicalStoredAnalysisEnrichment(): Record<string, unknown> {
  return {
    analysis_status: 'computed',
    option_comparison: [
      {
        option_id: 'opt_status_quo',
        option_label: CANONICAL_LEADER_LABEL,
        outcome: { mean: 0.6, p10: 0.4, p90: 0.8 },
        status: 'computed',
        win_probability: 0.82,
      },
      {
        option_id: 'opt_hire_local',
        option_label: REQUEST_LEADER_LABEL,
        outcome: { mean: 0.2, p10: 0.1, p90: 0.3 },
        status: 'computed',
        win_probability: 0.18,
      },
    ],
    factor_sensitivity: [
      {
        factor_id: 'fac_canonical_driver',
        factor_label: CANONICAL_DRIVER_LABEL,
        influence_score: 0.88,
        elasticity: 0.88,
        direction: 'positive',
      },
    ],
    robustness: {
      level: 'moderate',
      is_robust: false,
      recommended_option_id: 'opt_status_quo',
      recommended_option_label: CANONICAL_LEADER_LABEL,
      fragile_edges: [],
    },
  };
}

function makeFreshRunAnalysisFact(
  enrichment: Record<string, unknown> = stagingShapedAnalysisState()
): Record<string, unknown> {
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
      enrichment,
      win_probabilities: { opt_hire_local: 0.638, opt_status_quo: 0.156 },
    },
  };
}

function makeCanonicalAuthorityRunAnalysisFact(
  graphHash = CANONICAL_AUTHORITY_GRAPH_HASH,
  enrichmentOverrides: Record<string, unknown> = {},
  computedAt = new Date(Date.now() - 60_000).toISOString(),
): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_status_quo',
      summary: 'Canonical persisted analysis result',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
      graph_hash_at_run: graphHash,
      computed_at: computedAt,
      enrichment: {
        ...canonicalStoredAnalysisEnrichment(),
        ...enrichmentOverrides,
      },
      win_probabilities: { opt_status_quo: 0.82, opt_hire_local: 0.18 },
    },
  };
}

function makeAppliedConstraintFact(): Record<string, unknown> {
  return {
    fact_type: 'add_constraint' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      target_id: 'constraint-budget-cap',
      status: 'applied',
      before: null,
      after: {
        constraint_id: 'constraint-budget-cap',
        node_id: 'fac_local_hire',
        operator: '<=',
        value: 50000,
        label: 'Total hiring cost',
        unit: 'GBP',
        provenance: 'explicit',
      },
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

function capturedRoutingPrompt(
  adapter: ReturnType<typeof recordingRoutingAdapter>
): string {
  const call = adapter.chatWithTools.mock.calls[0]?.[0];
  expect(call, 'the routed turn must reach the model adapter').toBeDefined();
  const user = call!.messages.find((message) => message.role === 'user');
  expect(user, 'the adapter call must contain a user message').toBeDefined();
  return typeof user!.content === 'string'
    ? user!.content
    : JSON.stringify(user!.content);
}

function expectNoCanonicalAuthorityWrite(): void {
  expect(mockState.storeDraftGraphCalls).toBe(0);
  expect(mockState.invalidationCalls).toBe(0);
  expect(
    mockState.appendWrites.length,
    'the ordinary answered turn remains durable'
  ).toBe(1);
  const write = mockState.appendWrites[0]!;
  expect(write.graph).toBeUndefined();
  expect(write.handler_facts).toEqual([]);
  expect(write).not.toHaveProperty('modelVersion');
}

function recentNonAnalysisTurns(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, index) => ({
    id: `recent-row-${String(index).padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: `recent-turn-${String(index).padStart(2, '0')}`,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:recent-${index}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 10,
    user_message: `Recent user turn ${index}`,
    assistant_message: `Recent assistant turn ${index}`,
    created_at: new Date(Date.now() - index * 1_000).toISOString(),
  }));
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
    mockState.priorTurnsTotal = 1;
    mockState.newestAnalysisFact = mockState.priorFacts[0]!;
    mockState.newestAnalysisFactReadError = null;
    mockState.persistedGraph = READY_GRAPH;
    mockState.persistedGraphReadError = null;
    mockState.appendWrites = [];
    mockState.invalidationCalls = 0;
    mockState.storeDraftGraphCalls = 0;
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

  it('threads producer-ranked EVPPI identity through the real evidence-gap turn', async () => {
    mockState.priorFacts = [makeFreshRunAnalysisFact({
      analysis_status: 'completed',
      // Deliberately reverse the authorities: LLM object order says A first,
      // while the ISL producer ranks B first. Only B may reach the answer.
      factor_evppi: [
        { factor_id: 'fac_b', evppi: 0.01, status: 'resolved' },
        { factor_id: 'fac_a', evppi: 0.9, status: 'resolved' },
      ],
      factor_sensitivity: [
        { factor_id: 'fac_a', factor_label: 'Factor A' },
        { factor_id: 'fac_b', factor_label: 'Delivery uncertainty' },
      ],
      decision_review: {
        evidence_enhancements: {
          fac_a: { specific_action: 'LLM-order action A must not be served.' },
          fac_b: { specific_action: 'Collect matched cohort evidence for factor B.' },
        },
        key_assumptions: ['An unranked assumption must not be promoted.'],
      },
    })];
    mockState.newestAnalysisFact = mockState.priorFacts[0]!;
    expect(
      pickLatestFactorEvppiPriorityGuidance(mockState.priorFacts as never),
    ).toStrictEqual({
      outcome: 'selected',
      factorId: 'fac_b',
      factorLabel: 'Delivery uncertainty',
      specificAction: 'Collect matched cohort evidence for factor B.',
    });
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What should we validate?'),
      'req-factor-evppi-validation-priority',
      {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        analysisState: stagingShapedAnalysisState() as never,
      },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.analysisReady?.status).toBe('ready');
    expect(result.response.assistant_text).toContain(
      'The first evidence priority from this analysis is Delivery uncertainty:',
    );
    expect(result.response.assistant_text).toContain(
      'Collect matched cohort evidence for factor B.',
    );
    expect(result.response.assistant_text).not.toContain('LLM-order action A');
    expect(result.response.assistant_text).not.toContain('unranked assumption');
    expect(result.response.assistant_text).not.toMatch(/0\.01|0\.9|evppi/i);
  });

  it('keeps the science-to-reasoning action live when Decision Review is absent', async () => {
    mockState.priorFacts = [makeFreshRunAnalysisFact({
      analysis_status: 'completed',
      factor_evppi: [
        { factor_id: 'fac_b', evppi: 0, status: 'resolved' },
      ],
      factor_sensitivity: [
        { factor_id: 'fac_b', factor_label: 'Delivery uncertainty' },
      ],
      // decision_review deliberately absent: it is configuration-gated and
      // may be absent or soft-fail regardless of the deployed flag posture.
    })];
    mockState.newestAnalysisFact = mockState.priorFacts[0]!;
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What should we validate?'),
      'req-factor-evppi-validation-no-review',
      {
        routingAdapter: adapter,
        graphState: READY_GRAPH as never,
        analysisState: stagingShapedAnalysisState() as never,
      },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.response.assistant_text).toContain(
      'The first evidence priority from this analysis is Delivery uncertainty.',
    );
    expect(result.response.assistant_text).toContain(
      'gather relevant data or expert judgement',
    );
    expect(result.response.assistant_text).not.toMatch(/\b0(?:\.\d+)?\b|evppi/i);
  });

  it('treats an equal body analysis_state as compatibility input, never reasoning authority', async () => {
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
    expect(freshnessEvent!.data.analysis_state_source).not.toBe('request');
  });

  it('uses one canonical server snapshot for baseline, leading option and top driver when body state conflicts', async () => {
    const canonicalFact = makeCanonicalAuthorityRunAnalysisFact();
    mockState.priorFacts = [canonicalFact];
    mockState.newestAnalysisFact = canonicalFact;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue the strategic reasoning from the saved model.'),
      'req-canonical-analysis-authority-conflict',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
        analysisState: conflictingRequestAnalysisState() as never,
      }
    );

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    const analysis = pack.analysis as {
      leading_option?: { label?: string };
      top_drivers?: Array<{ label?: string }>;
    } | null;
    const graph = pack.graph as {
      nodes?: Array<{ id?: string; is_baseline?: true }>;
    };

    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(
      graph.nodes
        ?.filter((node) => node.is_baseline === true)
        .map((node) => node.id)
    ).toEqual(['opt_status_quo']);
    expect(analysis?.leading_option?.label).toBe(CANONICAL_LEADER_LABEL);
    expect(analysis?.top_drivers?.[0]?.label).toBe(CANONICAL_DRIVER_LABEL);
    expect(prompt).not.toContain(REQUEST_DRIVER_LABEL);
    expectNoCanonicalAuthorityWrite();
  });

  it('keeps conflicting request analysis read-only: no graph, fact, version or invalidation write', async () => {
    const canonicalFact = makeCanonicalAuthorityRunAnalysisFact();
    mockState.priorFacts = [canonicalFact];
    mockState.newestAnalysisFact = canonicalFact;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;
    const canonicalBytesBefore = JSON.stringify(mockState.persistedGraph);

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue the strategic reasoning from the saved model.'),
      'req-analysis-authority-read-only',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
        analysisState: conflictingRequestAnalysisState() as never,
      }
    );

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expectNoCanonicalAuthorityWrite();
    expect(mockState.persistedGraph).toBe(CANONICAL_AUTHORITY_GRAPH);
    expect(JSON.stringify(mockState.persistedGraph)).toBe(canonicalBytesBefore);
  });

  it('does not let stale request graph plus body analysis reopen or replace the stored run', async () => {
    const changedCanonicalGraph = {
      ...CANONICAL_AUTHORITY_GRAPH,
      edges: CANONICAL_AUTHORITY_GRAPH.edges.map((edge, index) =>
        index === 0 ? { ...edge, strength: { mean: 0.37, std: 0.1 } } : edge
      ),
    };
    const changedHash = computeAnalysisAffectingGraphHash(
      changedCanonicalGraph as never
    );
    expect(changedHash).not.toBe(CANONICAL_AUTHORITY_GRAPH_HASH);

    const canonicalFact = makeCanonicalAuthorityRunAnalysisFact(
      CANONICAL_AUTHORITY_GRAPH_HASH
    );
    mockState.priorFacts = [canonicalFact];
    mockState.newestAnalysisFact = canonicalFact;
    mockState.persistedGraph = changedCanonicalGraph;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue the strategic reasoning from the saved model.'),
      'req-stale-request-analysis-authority',
      {
        routingAdapter: adapter,
        graphState: CANONICAL_AUTHORITY_GRAPH as never,
        analysisState: conflictingRequestAnalysisState() as never,
      }
    );

    const freshnessEvent = events.find(
      (event) => event.data.dispatch_path === 'turn_executor_pre_handler'
    );
    expect(freshnessEvent?.data.freshness).toBe('stale');
    expect(freshnessEvent?.data.current_graph_hash).toBe(changedHash);

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    const analysis = pack.analysis as {
      leading_option?: { label?: string };
      top_drivers?: Array<{ label?: string }>;
      analysis_not_current_note?: string;
    } | null;
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(analysis?.leading_option?.label).toBe(CANONICAL_LEADER_LABEL);
    expect(analysis?.top_drivers?.[0]?.label).toBe(CANONICAL_DRIVER_LABEL);
    expect(analysis?.analysis_not_current_note).toBeDefined();
    expect(pack.coaching_context).toMatchObject({
      analysis_present: true,
      freshness: 'stale',
      usable_for_prose: true,
      usable_for_chips: false,
    });
    expect(prompt).not.toContain(REQUEST_DRIVER_LABEL);
    expectNoCanonicalAuthorityWrite();
  });

  it.each([
    {
      label: 'provisional',
      expectedStatus: 'provisional',
      requestGraph: CANONICAL_AUTHORITY_GRAPH,
      graphReadError: null,
    },
    {
      label: 'absent',
      expectedStatus: 'absent',
      requestGraph: null,
      graphReadError: null,
    },
    {
      label: 'unavailable',
      expectedStatus: 'unavailable',
      requestGraph: CANONICAL_AUTHORITY_GRAPH,
      graphReadError: new Error('canonical graph read unavailable'),
    },
  ] as const)(
    '$label graph authority never promotes request-only analysis_state',
    async ({ expectedStatus, requestGraph, graphReadError }) => {
      mockState.priorTurns = [];
      mockState.priorFacts = [];
      mockState.priorTurnsTotal = 0;
      mockState.newestAnalysisFact = null;
      mockState.persistedGraph = null;
      mockState.persistedGraphReadError = graphReadError;

      const adapter = recordingRoutingAdapter();
      await runTurnExecutor(
        mkPayload(
          'Continue the strategic reasoning from the available context.'
        ),
        `req-request-analysis-${expectedStatus}`,
        {
          routingAdapter: adapter,
          ...(requestGraph === null
            ? {}
            : { graphState: requestGraph as never }),
          analysisState: conflictingRequestAnalysisState() as never,
        }
      );

      const prompt = capturedRoutingPrompt(adapter);
      const pack = observeSerialisedPack(prompt);
      expect(pack.graph_context).toEqual({ status: expectedStatus });
      expect(pack.analysis).toBeNull();
      expect(pack.coaching).toEqual({
        draft_coaching: null,
        decision_review: null,
        last_coaching_signal: null,
      });
      expect(pack.coaching_context).toMatchObject({
        analysis_present: false,
        freshness: 'none',
        usable_for_prose: false,
        usable_for_chips: false,
      });
      expect(prompt).not.toContain(REQUEST_DRIVER_LABEL);
      if (expectedStatus === 'provisional') {
        // First-touch provisional adoption is a pre-existing, validated commit
        // path. The request analysis still cannot become reasoning authority.
        expect(mockState.appendWrites).toHaveLength(1);
        expect(mockState.appendWrites[0]?.handler_facts).toEqual([]);
      } else {
        expectNoCanonicalAuthorityWrite();
      }
    }
  );

  it('loads the scenario-wide newest run_analysis fact after its parent turn leaves the 20-turn hot window', async () => {
    const canonicalFact = makeCanonicalAuthorityRunAnalysisFact(
      CANONICAL_AUTHORITY_GRAPH_HASH,
      {
        decision_review: {
          produced_at: '2026-08-27T09:00:00.000Z',
          narrative_summary: 'DURABLE_DECISION_REVIEW_CANARY',
        },
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'analysis-turn-outside-hot-window',
        coaching_signal_produced_at: '2026-08-27T09:00:01.000Z',
      },
    );
    mockState.priorTurns = recentNonAnalysisTurns(20);
    mockState.priorTurnsTotal = 41;
    mockState.priorFacts = [];
    mockState.newestAnalysisFact = canonicalFact;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue the strategic reasoning from the saved model.'),
      'req-analysis-outside-hot-window',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
      }
    );

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    const analysis = pack.analysis as {
      leading_option?: { label?: string };
      top_drivers?: Array<{ label?: string }>;
    } | null;
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(analysis?.leading_option?.label).toBe(CANONICAL_LEADER_LABEL);
    expect(analysis?.top_drivers?.[0]?.label).toBe(CANONICAL_DRIVER_LABEL);
    expect(pack.coaching).toEqual({
      draft_coaching: null,
      decision_review: {
        produced_at: '2026-08-27T09:00:00.000Z',
        narrative_summary: 'DURABLE_DECISION_REVIEW_CANARY',
      },
      last_coaching_signal: {
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'analysis-turn-outside-hot-window',
        produced_at: '2026-08-27T09:00:01.000Z',
      },
    });
    expect(pack.coaching_context).toMatchObject({
      analysis_present: true,
      freshness: 'fresh',
      usable_for_prose: true,
      usable_for_chips: true,
    });
    expect(prompt).toContain('DURABLE_DECISION_REVIEW_CANARY');
    expect(prompt).toContain('analysis-turn-outside-hot-window');
    expectNoCanonicalAuthorityWrite();
  });

  it('does not offer a first analysis after durable analysis leaves the hot window', async () => {
    const canonicalFact = makeCanonicalAuthorityRunAnalysisFact();
    const recentMutation = makeAppliedConstraintFact();
    mockState.priorTurns = recentNonAnalysisTurns(20);
    mockState.priorTurnsTotal = 41;
    mockState.priorFacts = [recentMutation];
    mockState.newestAnalysisFact = canonicalFact;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What changed?'),
      'req-state-query-analysis-outside-hot-window',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
      },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.response.suggested_actions ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Run analysis',
        }),
      ]),
    );
    expectNoCanonicalAuthorityWrite();
  });

  it('binds Decision Review to the exact computed_at-selected display fact', async () => {
    const dbHeadButOlderRun = makeCanonicalAuthorityRunAnalysisFact(
      CANONICAL_AUTHORITY_GRAPH_HASH,
      {
        factor_sensitivity: [
          {
            factor_id: 'fac_db_head',
            factor_label: 'DB_HEAD_DRIVER_MUST_NOT_REACH_PROMPT',
            influence_score: 0.9,
            direction: 'positive',
          },
        ],
        decision_review: {
          produced_at: '2026-04-30T01:01:00+02:00',
          narrative_summary: 'DB_HEAD_REVIEW_MUST_NOT_REACH_PROMPT',
        },
      },
      // First in the DB-created chronology, but the represented run instant
      // is older than the second row below.
      '2026-04-30T01:00:00+02:00',
    );
    const selectedDisplayRun = makeCanonicalAuthorityRunAnalysisFact(
      CANONICAL_AUTHORITY_GRAPH_HASH,
      {
        factor_sensitivity: [
          {
            factor_id: 'fac_selected',
            factor_label: 'SELECTED_DISPLAY_DRIVER',
            influence_score: 0.8,
            direction: 'positive',
          },
        ],
        decision_review: {
          produced_at: '2026-04-30T00:31:00.000Z',
          narrative_summary: 'SELECTED_DISPLAY_REVIEW',
        },
      },
      '2026-04-30T00:30:00.000Z',
    );
    mockState.priorFacts = [dbHeadButOlderRun, selectedDisplayRun];
    mockState.newestAnalysisFact = null;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue from the current analysis.'),
      'req-analysis-display-review-same-fact',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
      },
    );

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    const analysis = pack.analysis as {
      top_drivers?: Array<{ label?: string }>;
    } | null;
    expect(analysis?.top_drivers?.[0]?.label).toBe(
      'SELECTED_DISPLAY_DRIVER',
    );
    expect(pack.coaching).toMatchObject({
      decision_review: {
        narrative_summary: 'SELECTED_DISPLAY_REVIEW',
      },
    });
    expect(prompt).toContain('SELECTED_DISPLAY_DRIVER');
    expect(prompt).toContain('SELECTED_DISPLAY_REVIEW');
    expect(prompt).not.toContain('DB_HEAD_DRIVER_MUST_NOT_REACH_PROMPT');
    expect(prompt).not.toContain('DB_HEAD_REVIEW_MUST_NOT_REACH_PROMPT');
    expectNoCanonicalAuthorityWrite();
  });

  it.each(['scenario_id', 'scenarioId', 'scenario-id', 'SCENARIO_ID'])(
    'withholds Decision Review nested foreign identity key %s from final prompt bytes',
    async (identityKey) => {
      const foreignScenarioId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const fact = makeCanonicalAuthorityRunAnalysisFact(
        CANONICAL_AUTHORITY_GRAPH_HASH,
        {
          decision_review: {
            produced_at: '2026-08-27T09:00:00.000Z',
            narrative_summary: 'FOREIGN_DECISION_REVIEW_MUST_NOT_REACH_PROMPT',
            nested: { origin: { [identityKey]: foreignScenarioId } },
          },
        },
      );
      mockState.priorFacts = [fact];
      mockState.newestAnalysisFact = fact;
      mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

      const adapter = recordingRoutingAdapter();
      await runTurnExecutor(
        mkPayload('Continue from the current saved analysis.'),
        `req-analysis-review-foreign-identity-${identityKey}`,
        {
          routingAdapter: adapter,
          graphState: CONFLICTING_REQUEST_GRAPH as never,
        },
      );

      const prompt = capturedRoutingPrompt(adapter);
      const pack = observeSerialisedPack(prompt);
      expect(pack.coaching).toMatchObject({ decision_review: null });
      expect(prompt).not.toContain(foreignScenarioId);
      expect(prompt).not.toContain('FOREIGN_DECISION_REVIEW_MUST_NOT_REACH_PROMPT');
      expectNoCanonicalAuthorityWrite();
    },
  );

  it.each(['partial', 'refused'])(
    'does not project a producer-carried completion signal from a %s analysis fact into final prompt bytes',
    async (analysisStatus) => {
      const canary = `${analysisStatus.toUpperCase()}_FORGED_COMPLETE_CANARY`;
      const fact = makeCanonicalAuthorityRunAnalysisFact(
        CANONICAL_AUTHORITY_GRAPH_HASH,
        {
          analysis_status: analysisStatus,
          coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
          coaching_signal_turn_id: canary,
          coaching_signal_produced_at: '2026-08-27T09:00:01.000Z',
        },
      );
      mockState.priorFacts = [fact];
      mockState.newestAnalysisFact = fact;
      mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

      const adapter = recordingRoutingAdapter();
      await runTurnExecutor(
        mkPayload('Continue from the current saved analysis state.'),
        `req-analysis-${analysisStatus}-producer-signal`,
        {
          routingAdapter: adapter,
          graphState: CONFLICTING_REQUEST_GRAPH as never,
        },
      );

      const prompt = capturedRoutingPrompt(adapter);
      const pack = observeSerialisedPack(prompt);
      expect(pack.coaching).toMatchObject({ last_coaching_signal: null });
      expect(prompt).not.toContain(canary);
      expectNoCanonicalAuthorityWrite();
    },
  );

  it('fails weak when the scenario-wide analysis-fact read degrades instead of substituting body state', async () => {
    mockState.priorTurns = recentNonAnalysisTurns(20);
    mockState.priorTurnsTotal = 41;
    mockState.priorFacts = [];
    mockState.newestAnalysisFact = null;
    mockState.newestAnalysisFactReadError = new Error(
      'scenario fact read unavailable'
    );
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue the strategic reasoning from the saved model.'),
      'req-analysis-fact-read-degraded',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
        analysisState: conflictingRequestAnalysisState() as never,
      }
    );

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(pack.analysis).toBeNull();
    expect(pack.coaching).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
    expect(pack.coaching_context).toMatchObject({
      analysis_present: false,
      freshness: 'unknown',
      usable_for_prose: false,
      usable_for_chips: false,
    });
    expect(prompt).not.toContain(REQUEST_DRIVER_LABEL);
    expectNoCanonicalAuthorityWrite();
  });

  it('fails weak on a true capped scenario page instead of treating its prefix or request body as analysis', async () => {
    mockState.priorTurns = recentNonAnalysisTurns(20);
    mockState.priorTurnsTotal = 41;
    mockState.priorFacts = Array.from({ length: 21 }, (_, index) =>
      makeCanonicalAuthorityRunAnalysisFact(
        CANONICAL_AUTHORITY_GRAPH_HASH,
        {
          factor_sensitivity: [
            {
              factor_id: `fac-capped-${index}`,
              factor_label: `CAPPED_PREFIX_CANARY_${index}`,
              influence_score: 0.9,
              direction: 'positive',
            },
          ],
        },
        `2026-08-${String(27 - Math.min(index, 26)).padStart(2, '0')}T09:00:00.000Z`,
      ),
    );
    mockState.newestAnalysisFact = null;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue from whatever analysis is authoritatively available.'),
      'req-analysis-fact-read-capped',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
        analysisState: conflictingRequestAnalysisState() as never,
      },
    );

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(pack.analysis).toBeNull();
    expect(pack.coaching).toEqual({
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    });
    expect(pack.coaching_context).toMatchObject({
      analysis_present: false,
      freshness: 'unknown',
      usable_for_prose: false,
      usable_for_chips: false,
    });
    expect(prompt).not.toContain('CAPPED_PREFIX_CANARY_');
    expect(prompt).not.toContain(REQUEST_DRIVER_LABEL);
    expectNoCanonicalAuthorityWrite();
  });

  it('preserves canonical analysis authority through dense whole-pack budgeting', async () => {
    const durableCanary = 'DURABLE_DENSE_ANALYSIS_CANARY';
    const canonicalFact = makeCanonicalAuthorityRunAnalysisFact(
      CANONICAL_AUTHORITY_GRAPH_HASH,
      {
        factor_sensitivity: [
          {
            factor_id: 'fac-durable-dense',
            factor_label: durableCanary,
            influence_score: 0.88,
            direction: 'positive',
          },
        ],
        coaching_signal_id: 'FIRST_ANALYSIS_COMPLETE',
        coaching_signal_turn_id: 'dense-durable-analysis-turn',
        coaching_signal_produced_at: '2026-08-27T09:00:01.000Z',
      },
    );
    mockState.priorTurns = recentNonAnalysisTurns(20).map((turn, index) => ({
      ...turn,
      user_message: `IRRELEVANT_DENSE_USER_${index}_${'u'.repeat(6_000)}`,
      assistant_message: `IRRELEVANT_DENSE_ASSISTANT_${index}_${'a'.repeat(6_000)}`,
    }));
    mockState.priorTurnsTotal = 41;
    mockState.priorFacts = [];
    mockState.newestAnalysisFact = canonicalFact;
    mockState.persistedGraph = CANONICAL_AUTHORITY_GRAPH;

    const adapter = recordingRoutingAdapter();
    await runTurnExecutor(
      mkPayload('Continue from the saved model under dense context pressure.'),
      'req-analysis-authority-dense-budget',
      {
        routingAdapter: adapter,
        graphState: CONFLICTING_REQUEST_GRAPH as never,
        analysisState: conflictingRequestAnalysisState() as never,
      },
    );

    const prompt = capturedRoutingPrompt(adapter);
    const pack = observeSerialisedPack(prompt);
    expect(JSON.stringify(pack).length).toBeLessThanOrEqual(55_000);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'v5.context_truncation',
          data: expect.objectContaining({
            section: 'conversation',
            original_chars: expect.any(Number),
            kept_chars: expect.any(Number),
          }),
        }),
      ]),
    );
    const conversationCut = events.find(
      (event) =>
        event.event === 'v5.context_truncation' &&
        event.data.section === 'conversation',
    );
    expect(Number(conversationCut?.data.kept_chars)).toBeLessThan(
      Number(conversationCut?.data.original_chars),
    );
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(pack.analysis).toMatchObject({
      top_drivers: [expect.objectContaining({ label: durableCanary })],
    });
    expect(pack.coaching).toMatchObject({
      last_coaching_signal: {
        signal_id: 'FIRST_ANALYSIS_COMPLETE',
        turn_id: 'dense-durable-analysis-turn',
      },
    });
    expect(prompt).toContain(durableCanary);
    expect(prompt).not.toContain(REQUEST_DRIVER_LABEL);
    expect(prompt).not.toContain('IRRELEVANT_DENSE_USER_19_');
    expectNoCanonicalAuthorityWrite();
  });

  it('caller-only body analysis_state cannot change data-absent reasoning or recovery', async () => {
    const withoutBodyAdapter = recordingRoutingAdapter();
    const withoutBody = await runTurnExecutor(
      mkPayload('What would change the outcome?'),
      'req-no-body-analysis-state-thin',
      {
        routingAdapter: withoutBodyAdapter,
        graphState: READY_GRAPH as never,
      },
    );

    const withBodyAdapter = recordingRoutingAdapter();
    const thin = stagingShapedAnalysisState();
    delete thin.factor_sensitivity;
    const withBody = await runTurnExecutor(
      mkPayload('What would change the outcome?'),
      'req-body-analysis-state-thin',
      {
        routingAdapter: withBodyAdapter,
        graphState: READY_GRAPH as never,
        analysisState: thin as never,
      },
    );

    expect(withBodyAdapter.chatWithTools.mock.calls).toHaveLength(
      withoutBodyAdapter.chatWithTools.mock.calls.length,
    );
    expect(withBody.response).toEqual(withoutBody.response);
    expect(withBody.response.assistant_text ?? '').not.toContain(RECAP_STUB_PREFIX);
    expect(JSON.stringify(withBody.response)).not.toContain('apply_proposed_change');
  });
});
