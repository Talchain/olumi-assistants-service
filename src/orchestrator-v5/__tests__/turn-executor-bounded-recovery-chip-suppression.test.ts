/**
 * Overnight-review P1 fix (F2) — bounded-recovery chip builder must honour
 * the ROADMAP 1.20(b) chip-sameness guard.
 *
 * `buildBoundedFallbackCopyAndChips` (turn-executor.ts) independently builds
 * `[explainResultsChip, runAnalysisChip]` whenever a fresh analysis
 * projection exists — bypassing `recentlyOfferedChipIds()`, the same guard
 * threaded into the coach/converse `generateChips` call sites to stop a
 * chip that was JUST offered from being mechanically re-offered. Because
 * the STEP 7 empty-answer backstop (unconditional) and the
 * `CEE_ANSWER_TEXT_REQUIRED` compose guard both route through this one
 * helper, an empty-answer turn immediately following a turn that offered
 * `chip_action_explain_results` re-offers the IDENTICAL chip id — the exact
 * "consecutive identical chips" defect class ROADMAP 1.20(b) closed for the
 * main chip-generation path, reopened here on the recovery path.
 *
 * Setup mirrors `turn-executor-fresh-analysis-followup.integration.test.ts`
 * (fresh run_analysis fact + matching persisted graph => freshness=fresh,
 * analysis projection present) combined with a mocked LLM adapter that
 * returns a coach tool call with no answer_text/preface — the STEP 7
 * backstop's trigger condition — and a `readMostRecentPendingActions` mock
 * seeding a PRIOR turn's `chip_action_explain_results` offer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test (mirrors the fresh-analysis-
// followup integration test's harness).
// ---------------------------------------------------------------------------

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
  pendingActions: readonly PendingAction[];
} = {
  priorTurns: [],
  priorFacts: [],
  persistedGraph: null,
  pendingActions: [],
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
    readMostRecentPendingActions: async () => mockState.pendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

// ---------------------------------------------------------------------------
// Fixtures — identical graph/fact shape to the fresh-analysis-followup
// integration test, so freshness deterministically resolves to 'fresh'.
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIOR_RA_ROW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
      enrichment: { analysis_status: 'completed' },
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

/** A PendingAction recording that `chip_action_explain_results` was offered
 * on the immediately-prior turn — exactly what `recentlyOfferedChipIds()`
 * reads from `context.most_recent_pending_actions`. */
function priorExplainResultsPendingAction(): PendingAction {
  return {
    id: 'pa-prior-explain',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_action_explain_results',
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: 999,
    expires_at_iso: new Date(Date.now() + 3_600_000).toISOString(),
    emitted_at_iso: new Date(Date.now() - 30_000).toISOString(),
  };
}

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

/** Coach tool call with NO answer_text and NO preface text — the STEP 7
 * empty-answer backstop's trigger condition (composedOk.assistant_text
 * trims to empty on a direct_answer-class turn). */
function emptyAnswerCoachToolResult(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: { intent_class: 'coach', coaching_mode: 'reframe' },
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

describe('turn-executor — bounded-recovery chip builder honours the chip-sameness guard (overnight review F2)', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.persistedGraph = READY_GRAPH;
    mockState.pendingActions = [priorExplainResultsPendingAction()];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('an empty-answer coach turn, with fresh analysis present and chip_action_explain_results just offered, does NOT re-offer chip_action_explain_results', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
    };

    const result = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-bounded-recovery-chip-suppression',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    // Sanity: the backstop actually fired (empty answer_text recovered).
    const recoveryEvent = events.find((e) => e.event === 'v5.coaching.empty_answer_recovered');
    expect(recoveryEvent, 'STEP 7 backstop should have fired').toBeDefined();
    expect(result.response.assistant_text.trim()).not.toBe('');

    // Sanity: a fresh analysis projection WAS available this turn — so,
    // absent the guard, both explainResultsChip and runAnalysisChip would
    // have been candidates.
    const runAnalysisChip = result.response.suggested_actions.find(
      (a: { id?: string }) => a.id === 'chip_action_run_analysis_retry',
    );
    expect(runAnalysisChip, 'run_analysis chip (not recently offered) should survive').toBeDefined();

    // The actual assertion: the chip offered on the immediately-prior turn
    // must NOT be repeated.
    const explainChip = result.response.suggested_actions.find(
      (a: { id?: string }) => a.id === 'chip_action_explain_results',
    );
    expect(
      explainChip,
      'chip_action_explain_results was just offered and must not be mechanically repeated',
    ).toBeUndefined();
  });

  it('control: with NO prior pending action offered, the same empty-answer turn DOES offer chip_action_explain_results (proves the guard is doing the suppressing, not some other filter)', async () => {
    mockState.pendingActions = [];
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(emptyAnswerCoachToolResult()),
    };

    const result = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-bounded-recovery-chip-suppression-control',
      { routingAdapter: adapter, graphState: READY_GRAPH as never },
    );

    const explainChip = result.response.suggested_actions.find(
      (a: { id?: string }) => a.id === 'chip_action_explain_results',
    );
    expect(explainChip, 'with no recently-offered chips, explain_results should be offered').toBeDefined();
  });
});
