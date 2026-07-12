/**
 * ROADMAP 1.16j — turn-executor threads `recentlyOfferedChipIds()` into the
 * post-analysis coaching wrapper.
 *
 * The 11 Jul manual test (edf2a4d9, VERIFICATION-2026-07-12-A1) showed the
 * IDENTICAL wrapper chip (chip_text_839250dddbc6, card
 * ep_fac_market_timing_fac_salary_cost) re-offered on all 6 post-analysis
 * turns: `generatePostAnalysisCoaching`'s input carried no
 * `recentlyOfferedChipIds`, so the 1.20(b) sameness guard — already
 * threaded into the sibling `generateChips` call sites — was bypassed on
 * the wrapper path. The wrapper-level guard is pinned in
 * tests/contract/post-analysis-wrapper-sameness.test.ts; THIS test pins the
 * THREADING at the executor call site, which is where the defect actually
 * lived (removing the threading would leave the wrapper-level tests green).
 *
 * Setup mirrors turn-executor-bounded-recovery-chip-suppression.test.ts
 * (fresh run_analysis fact + matching persisted graph ⇒ freshness=fresh)
 * with review_cards on the fact's enrichment and a mocked LLM adapter that
 * returns a coach tool call WITH answer_text — the analyse-stage
 * direct_answer path the wrapper fires on. Turn 1 (no prior pendings)
 * discovers the wrapper chip's id from the live response; turn 2 seeds that
 * id as the immediately-prior turn's pending action and asserts the chip is
 * not mechanically repeated.
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
import { PENDING_ACTION_DEFAULT_TURN_TTL, type PendingAction } from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Session-store mock — replayable per-test (mirrors the bounded-recovery
// suppression test's harness).
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
// Fixtures — graph/fact shape identical to the sibling suppression test so
// freshness deterministically resolves to 'fresh'.
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

/** Fresh run_analysis fact whose enrichment carries one review card — the
 * wrapper's chip source. Single card ⇒ single wrapper chip ⇒ the repeat
 * scenario is exactly the live defect's shape. */
function makeFreshRunAnalysisFactWithReviewCards(): Record<string, unknown> {
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
        review_cards: [
          {
            card_id: 'ep_fac_capacity_evidence',
            card_type: 'evidence_priority',
            title: 'Capacity evidence',
            items: [
              {
                node_id: 'fac_capacity',
                factor_label: 'Capacity',
                suggested_evidence: 'Find hiring-pipeline data for the next two quarters.',
              },
            ],
          },
        ],
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

/** A PendingAction recording that the WRAPPER's chip was offered on the
 * immediately-prior turn (undecremented default TTL — the same recency
 * signal `recentlyOfferedChipIds()` filters on; see FIX 3/F11 notes in the
 * sibling test). */
function priorWrapperChipPendingAction(chipId: string): PendingAction {
  return {
    id: 'pa-prior-wrapper-chip',
    scenario_id: SCENARIO_ID,
    chip_id: chipId,
    action: { kind: 'run_analysis' },
    preconditions: {},
    expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
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

/** Coach tool call WITH answer_text — the analyse-stage direct_answer path
 * on which the post-analysis wrapper fires and appends its chips. */
function coachToolResultWithAnswer(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: {
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_text:
          'Your analysis is fresh. Consider strengthening the evidence behind your capacity assumptions before you decide.',
      },
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

function makeAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(coachToolResultWithAnswer()),
  };
}

/** The wrapper's evidence-priority chip is the only 'Add evidence'-labelled
 * chip on this turn shape (generateChips has no such rule). */
function findWrapperChip(
  actions: ReadonlyArray<{ id: string; label: string }>,
): { id: string; label: string } | undefined {
  return actions.find((a) => a.label === 'Add evidence' && a.id.startsWith('chip_text_'));
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

describe('turn-executor — post-analysis wrapper honours the chip-sameness guard at the call site (1.16j)', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFactWithReviewCards()];
    mockState.persistedGraph = READY_GRAPH;
    mockState.pendingActions = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  it('a wrapper chip offered on the immediately-prior turn is NOT re-offered on the next post-analysis turn', async () => {
    // Turn 1 (control shape): no prior pendings — the wrapper fires and
    // offers its review-card chip. Discover the chip id from the live
    // response rather than re-deriving the hash, so the test tracks the
    // wrapper's real id scheme.
    const first = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-post-analysis-sameness-turn1',
      { routingAdapter: makeAdapter(), graphState: READY_GRAPH as never },
    );
    const wrapperChip = findWrapperChip(first.response.suggested_actions);
    expect(wrapperChip, 'turn 1 sanity: the wrapper must offer its review-card chip').toBeDefined();

    // Turn 2: the SAME chip was offered on the immediately-prior turn.
    // Pre-fix (the 11 Jul defect): the identical chip is re-offered —
    // the wrapper input has no recentlyOfferedChipIds, bypassing 1.20(b).
    mockState.pendingActions = [priorWrapperChipPendingAction(wrapperChip!.id)];
    const second = await runTurnExecutor(
      mkPayload('help me think through the tradeoffs'),
      'req-post-analysis-sameness-turn2',
      { routingAdapter: makeAdapter(), graphState: READY_GRAPH as never },
    );

    const repeat = second.response.suggested_actions.find((a) => a.id === wrapperChip!.id);
    expect(
      repeat,
      'the wrapper chip offered on the immediately-prior turn must not be mechanically repeated',
    ).toBeUndefined();
  });

  it('control: with NO prior pending action, consecutive post-analysis turns DO re-offer the wrapper chip source (proves the guard does the suppressing)', async () => {
    const first = await runTurnExecutor(
      mkPayload('help me think this through'),
      'req-post-analysis-sameness-control-turn1',
      { routingAdapter: makeAdapter(), graphState: READY_GRAPH as never },
    );
    const wrapperChip = findWrapperChip(first.response.suggested_actions);
    expect(wrapperChip).toBeDefined();

    // No pendings seeded — the guard has nothing to suppress.
    const second = await runTurnExecutor(
      mkPayload('help me think through the tradeoffs'),
      'req-post-analysis-sameness-control-turn2',
      { routingAdapter: makeAdapter(), graphState: READY_GRAPH as never },
    );
    const again = findWrapperChip(second.response.suggested_actions);
    expect(again, 'without a prior offer on record, the chip is legitimately available').toBeDefined();
    expect(again!.id).toBe(wrapperChip!.id);
  });
});
