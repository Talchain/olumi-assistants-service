/**
 * V5 post-analysis advice gate — path-ownership integration tests.
 *
 * Proves the dispatch-chain claim added by the grounded-fresh-analysis
 * workstream: when the projection carries enough data for the advice
 * gate's per-class requirements AND the message matches one of the
 * patterns added by this PR, the advice gate captures the turn FIRST —
 * the downstream fresh-followup catch-net (PR #187) is NOT reached.
 *
 * Mirrors the harness in
 * `turn-executor-fresh-analysis-followup.integration.test.ts`:
 *   - `getSessionStore` is mocked so the executor reads a fresh
 *     run_analysis fact with a graph_hash_at_run matching the
 *     currently-persisted graph (freshness verdict = 'fresh').
 *   - The routing adapter throws on invocation — any matched path that
 *     reaches the LLM fails the test loudly.
 *   - Telemetry is captured via `setTestSink`.
 *
 * Coverage:
 *   - Each of the four newly-owned target phrases ("What drove this
 *     result?", "Why is this option ahead?", "Why is Option A leading?",
 *     "What would need to change for another option to look better?")
 *     → advice gate matched=true.
 *   - Mutation precedence preserved — concrete-edit phrasing combined
 *     with an analytical phrase falls through advice gate with
 *     `mutation_signal` and reaches the downstream edit/routing path.
 *   - Anti-regression: the fresh-followup recap copy MUST NOT ship on
 *     any of these advice-gate-owned turns (proves no double-emission).
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
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
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
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    {
      id: 'opt_hire',
      kind: 'option',
      label: 'Hire',
      interventions: { fac_capacity: 1 },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Hold',
      is_baseline: true,
      interventions: { fac_capacity: 0 },
    },
  ],
  edges: [
    {
      from: 'opt_hire',
      to: 'fac_capacity',
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_status_quo',
      to: 'fac_capacity',
      strength: { mean: 0.01, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_capacity',
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
 * Fresh run_analysis fact rich enough to satisfy the advice gate's
 * per-class data requirements for `explain_results_free_text` and
 * `what_would_flip_free_text`:
 *
 *   - `option_comparison[]` → compactAnalysis() yields options.length > 0
 *     so the ContextPack analysis projection populates `leading_option`
 *     and `runner_up`.
 *   - top-level `factor_sensitivity[]` → `deriveTopDriversFromTopLevel`
 *     produces a non-empty `top_drivers[]` once compactAnalysis's own
 *     per-option walk returns nothing (option_comparison entries here
 *     don't carry per-option factor_sensitivity).
 *   - `robustness_synthesis.overall_assessment` → robustness_band
 *     populates as `moderate`.
 *
 * This is the SAME shape PLoT publishes on staging per CLAUDE.md
 * (PR #180 fix: option_comparison + decision_brief.options, top-level
 * factor_sensitivity).
 */
function makeFreshRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          {
            option_id: 'opt_hire',
            option_label: 'Hire',
            win_probability: 0.72,
            outcome_mean: 0.5,
          },
          {
            option_id: 'opt_status_quo',
            option_label: 'Hold',
            win_probability: 0.28,
            outcome_mean: 0.3,
          },
        ],
        factor_sensitivity: [
          {
            factor_id: 'fac_capacity',
            factor_label: 'Capacity',
            sensitivity: 0.6,
            direction: 'positive',
          },
        ],
        robustness_synthesis: { overall_assessment: 'moderate' },
      },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
          'Routing adapter must NOT be called when advice gate matches a fresh-analysis follow-up',
        );
      }),
  };
}

function passthroughRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => ({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'mock',
        latencyMs: 0,
      })),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

const FRESH_FOLLOWUP_RECAP = "Here's the latest analysis recap.";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V5 post-analysis advice gate — path-ownership integration', () => {
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

  // -------------------------------------------------------------------------
  // Phrases newly owned by the advice gate after this PR.
  // -------------------------------------------------------------------------
  const newlyOwned: ReadonlyArray<readonly [string, string]> = [
    ['What drove this result?', 'explain_results_free_text'],
    ['Why is this option ahead?', 'explain_results_free_text'],
    ['Why is Option A leading?', 'explain_results_free_text'],
    [
      'What would need to change for another option to look better?',
      'what_would_flip_free_text',
    ],
  ];

  for (const [message, expectedClass] of newlyOwned) {
    it(`"${message}" with fresh + rich analysis → advice gate captures (class=${expectedClass}), fresh-followup NOT reached`, async () => {
      const adapter = throwingRoutingAdapter();
      const result = await runTurnExecutor(
        mkPayload(message),
        `req-advice-ownership-${expectedClass}`,
        { routingAdapter: adapter, graphState: READY_GRAPH as never },
      );

      // Routing adapter must never be invoked — deterministic path.
      expect(adapter.chatWithTools).not.toHaveBeenCalled();

      // Advice gate fired matched=true with the expected class.
      const adviceEvent = events.find(
        (e) => e.event === 'v5.post_analysis_advice_gate',
      );
      expect(adviceEvent, 'advice-gate telemetry should fire').toBeDefined();
      expect(adviceEvent!.data.matched).toBe(true);
      expect(adviceEvent!.data.advice_class).toBe(expectedClass);
      // Structural field added by this workstream — chips per class:
      // 1 for explain_results_free_text, 0 for what_would_flip_free_text.
      const expectedChipCount =
        expectedClass === 'what_would_flip_free_text' ? 0 : 1;
      expect(adviceEvent!.data.suggested_action_count).toBe(expectedChipCount);

      // Fresh-followup catch-net MUST NOT report matched=true for the same
      // turn — proves dispatch order (advice gate first refusal).
      const freshEvent = events.find(
        (e) => e.event === 'v5.fresh_analysis_followup_guard',
      );
      if (freshEvent !== undefined) {
        expect(freshEvent.data.matched).toBe(false);
      }

      // Response shape: direct_answer, zero LLM calls, no recap copy.
      expect(result.telemetry.turn_class).toBe('direct_answer');
      expect(result.telemetry.llm_calls_used).toBe(0);
      // Anti-regression: the fresh-followup recap copy must NOT ship —
      // advice-gate composer emits its own enriched prose.
      expect(result.response.assistant_text ?? '').not.toContain(
        FRESH_FOLLOWUP_RECAP,
      );

      // Chip threading: explain-class turns carry one `what_would_flip`
      // chip; what_would_flip_free_text turns carry none.
      if (expectedClass === 'what_would_flip_free_text') {
        expect(result.response.suggested_actions).toHaveLength(0);
      } else {
        expect(result.response.suggested_actions).toHaveLength(1);
        const chip = result.response.suggested_actions[0]!;
        expect(chip).toMatchObject({
          id: 'chip_action_what_would_flip',
          action_type: 'what_would_flip',
          label: 'What could change the outcome?',
        });
      }

      // Enriched prose: leading option named, no fabricated numbers from
      // a "Not available" sentinel. (Exact prose is asserted in the
      // composer unit tests; here we only confirm the matched path
      // produced grounded copy.)
      expect(result.response.assistant_text ?? '').toContain('Hire');
      expect(result.response.assistant_text ?? '').not.toContain(
        'Not available',
      );
    });
  }

  // -------------------------------------------------------------------------
  // Mutation precedence regression — a concrete edit paired with any of the
  // new analytical patterns must NOT be captured by the advice gate.
  // -------------------------------------------------------------------------
  const mutationPairs: ReadonlyArray<readonly [string, string]> = [
    ['What drove this result? Set Pricing to 0.7.', 'what_drove + numeric edit'],
    [
      'Why is this option ahead? Set risk to 0.5.',
      'why_ahead + numeric edit',
    ],
    [
      'What would need to change for another option to look better? Add a new constraint.',
      'what_would_need_to_change + add-new',
    ],
  ];

  for (const [message, label] of mutationPairs) {
    it(`mutation precedence (${label}): advice gate falls through, no recap`, async () => {
      const adapter = passthroughRoutingAdapter();
      const result = await runTurnExecutor(
        mkPayload(message),
        `req-advice-ownership-mutation-${label.replace(/[^a-z]/gi, '-')}`,
        { routingAdapter: adapter, graphState: READY_GRAPH as never },
      );

      // The advice gate must NOT have matched (mutation_signal beats
      // analytical pattern). When it emits at all, it reports mutation_signal;
      // when upstream deterministic value-update guard captures first, the
      // advice-gate event never fires — both are acceptable proof that the
      // advice gate did not swallow the concrete edit.
      const adviceEvent = events.find(
        (e) => e.event === 'v5.post_analysis_advice_gate',
      );
      if (adviceEvent !== undefined) {
        expect(adviceEvent.data.matched).toBe(false);
        expect(adviceEvent.data.unmatched_reason).toBe('mutation_signal');
      }

      // The fresh-followup catch-net must also reject mutation phrasings
      // per PR #187's hasIndependentMutationSignal — so it never lies
      // about ownership here.
      const freshEvent = events.find(
        (e) => e.event === 'v5.fresh_analysis_followup_guard',
      );
      if (freshEvent !== undefined) {
        expect(freshEvent.data.matched).toBe(false);
      }

      // The fresh-followup recap copy must NOT ship — proving neither
      // analytical guard captured the turn.
      expect(result.response.assistant_text ?? '').not.toContain(
        FRESH_FOLLOWUP_RECAP,
      );
    });
  }

  // -------------------------------------------------------------------------
  // Regression: "What should I pay attention to?" continues to match the
  // existing `advice` class. Class precedence is NOT reordered by this PR.
  // -------------------------------------------------------------------------
  it('"What should I pay attention to?" continues to match advice class (precedence regression)', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload('What should I pay attention to?'),
      'req-advice-ownership-pay-attention',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    const adviceEvent = events.find(
      (e) => e.event === 'v5.post_analysis_advice_gate',
    );
    expect(adviceEvent!.data.matched).toBe(true);
    expect(adviceEvent!.data.advice_class).toBe('advice');
    expect(adviceEvent!.data.suggested_action_count).toBe(1);
    expect(result.response.assistant_text ?? '').not.toContain(
      FRESH_FOLLOWUP_RECAP,
    );
  });
});
