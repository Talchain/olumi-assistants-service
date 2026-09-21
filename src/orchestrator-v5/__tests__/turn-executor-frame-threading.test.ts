/**
 * T4 Slice 2 — canonical context frame threading (live turn path).
 *
 * Proves runTurnExecutor builds the CanonicalContextFrame ONCE at the finalise
 * seam and threads it on the run result, wrapping the SAME authority outputs
 * the result already carries (freshness, canonicalState) — never a second
 * derivation. Covers the execute path (successful run_analysis) AND the
 * non-execute path (converse), plus the read-only posture (threading the
 * frame changes no user-facing behaviour).
 *
 * Harness mirrors turn-executor-canonical-state-readonly.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../context/context-pack-assembler.js';
import { summariseCanonicalAnalysisState } from '../context/canonical-analysis-state.js';
import { summariseGraphCounts } from '../context/build-context-summary.js';

const mockState = vi.hoisted(() => ({
  priorTurns: [] as Array<Record<string, unknown>>,
  /** Stored rolling summary the injector should read. `null` ⇒ no summary. */
  summary: null as Record<string, unknown> | null,
  persistedGraph: null as unknown,
}));

/**
 * The rolling-summary store seam. Without it `getRollingSummaryStore()` throws
 * on the missing Supabase env, the injector swallows that into NO_INJECTION,
 * and EVERY fixture lands in the no-coverage branch — which is exactly how the
 * assembled window silently became indistinguishable from the raw store read
 * (see the priorTurnCount spec below). Defaulting `summary` to `null` keeps the
 * other specs byte-identical to the un-mocked behaviour (both routes reach
 * NO_INJECTION); a spec that needs real coverage sets it.
 *
 * `importOriginal` is spread rather than hand-listing the module's exports —
 * a hand-maintained mock allowlist goes stale silently and takes the whole
 * file's collection with it.
 */
vi.mock('../rolling-summary/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rolling-summary/index.js')>()),
  getRollingSummaryStore: () => ({
    loadSummary: async () => mockState.summary,
    upsertSummary: async () => {
      throw new Error('the injector must never write');
    },
  }),
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => [],
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const PROPOSAL_RUN_ANALYSIS = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH_WITH_OPTIONS as never);

function runAnalysisFact(graphHash: string | null): HandlerFact {
  const result: Record<string, unknown> = {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_a',
    summary: 'Ran the analysis on your scenario.',
    computed_at: '2026-04-30T01:00:00.000Z',
    enrichment: { analysis_status: 'completed' },
    win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
  };
  if (graphHash) result.graph_hash_at_run = graphHash;
  return { fact_type: 'run_analysis', fact_version: 1, noop: false, result } as HandlerFact;
}

function makeSuccessRegistry(graphHash: string | null): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis on your scenario.',
    handler_facts: [runAnalysisFact(graphHash)],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(
  impl: (
    args: ChatWithToolsArgs,
    opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
  ) => Promise<ChatWithToolsResult>,
) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

function mkPriorTurn(n: number): Record<string, unknown> {
  return {
    id: `row-${n}`,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: `prior-turn-${n}`,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:prior-${n}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 8,
    created_at: `2026-04-30T0${Math.min(n, 9)}:00:00.000Z`,
    user_message: `prior message ${n}`,
    assistant_message: `prior answer ${n}`,
  };
}

describe('TurnExecutor — canonical context frame threading (T4 Slice 2)', () => {
  beforeEach(() => {
    setTestSink(() => {});
    mockState.priorTurns = [];
    mockState.summary = null;
    mockState.persistedGraph = GRAPH_WITH_OPTIONS;
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('execute path: frame present and WRAPS the same authority outputs the result carries', async () => {
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-frame-exec', {
      routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
      handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
      graphState: GRAPH_WITH_OPTIONS,
    });

    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.frame).toBeDefined();
    const frame = result.frame!;

    // Wrap-parity: the frame's freshness/hash/analysis fields are the SAME
    // values as the result's own authority outputs — one derivation, no drift.
    expect(result.freshness).toBeDefined();
    expect(frame.freshness.verdict).toBe(result.freshness!.freshness);
    expect(frame.freshness.reason).toBe(result.freshness!.reason);
    expect(frame.freshness.computedAt).toBe(result.freshness!.computed_at);
    expect(frame.model.graphHash).toBe(result.freshness!.current_graph_hash);
    expect(frame.model.graphHashAtRun).toBe(result.freshness!.graph_hash_at_run);

    expect(result.canonicalState).toBeDefined();
    expect(frame.analysis.status).toBe(result.canonicalState!.status);
    expect(frame.analysis.source).toBe('turn_executor');
    expect(frame.diagnostics.analysisStateSummary).toEqual(
      summariseCanonicalAnalysisState(result.canonicalState!),
    );

    // Counts read the authoritative per-turn graph (3 nodes / 0 edges / 2
    // options / 1 goal) — same graph the route resolves labels against.
    expect(frame.model.counts).toEqual({ nodes: 3, edges: 0, options: 2, goals: 1 });
    // Relationship pin (not just the literal): the frame's counts equal the
    // counts of the EXACT graph object the route's legacy branch would count
    // (ctx.graph = result.effectiveGraph, always set by finalizeRun) — so the
    // frame path and the pre-frame path can never report divergent counts.
    expect(result.effectiveGraph).not.toBeNull();
    expect(result.effectiveGraph).toBeDefined();
    expect(frame.model.counts).toEqual(summariseGraphCounts(result.effectiveGraph));

    // Conversation projection: empty mocked store → 0 prior turns; no prior
    // mutation facts → 0 recent changes; confirmation state not threaded yet.
    expect(frame.conversation.priorTurnCount).toBe(0);
    expect(frame.conversation.recentChangeCount).toBe(0);
    expect(frame.changes).toEqual([]);

    // Claim permissions stay default-HELD — slice 2 relaxes nothing.
    expect(Object.values(frame.claimPermissions).every((v) => v === 'held')).toBe(true);
  });

  it('non-execute path (converse): frame present via the finalise fallback, same wrap-parity', async () => {
    const payload = makeMessagePayload({
      turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      scenario_id: SCENARIO_ID,
      message: 'tell me about this decision',
      turn_class: 'frame',
      stage: 'analyse',
    });
    const result = await runTurnExecutor(payload, 'req-frame-converse', {
      routingAdapter: mockRoutingAdapter(async () =>
        mkTextResult('Here is a thought about your decision.'),
      ),
      handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
      graphState: GRAPH_WITH_OPTIONS,
    });

    // Non-execute turn: no handler commit, but the finalise fallback still
    // assembles the canonical state — and the frame wraps that same verdict.
    expect(result.canonicalState).toBeDefined();
    expect(result.frame).toBeDefined();
    const frame = result.frame!;
    expect(frame.analysis.source).toBe('turn_executor');
    expect(frame.analysis.status).toBe(result.canonicalState!.status);
    expect(result.freshness).toBeDefined();
    expect(frame.freshness.verdict).toBe(result.freshness!.freshness);
    expect(frame.model.graphHash).toBe(result.freshness!.current_graph_hash);
  });

  /**
   * F5 (independent review of PR #1102) — THE DISCRIMINATING FIXTURE.
   *
   * `priorTurnCount` must report the ASSEMBLED conversation window, never the
   * raw store read. The previous version of this spec fetched 10 turns with no
   * summary seam, where the assembler's no-coverage branch expands the window
   * to `priorTurns.length` — so assembled (10) EQUALLED the raw read (10), and
   * a mutant sourcing `priorTurnCount` from `context.prior_turns.length` — the
   * exact defect this spec names — stayed GREEN. A guard whose two candidate
   * answers are the same number is not a guard.
   *
   * The fix is a fixture where the two genuinely differ: a HEALTHY summary
   * (real coverage) puts the assembler back on `CONTEXT_PACK_RECENT_TURNS_CAP`,
   * so 10 are fetched and 8 assembled. The assertion below is satisfiable ONLY
   * on that path — if the fixture ever degrades into the floor / memory-hole
   * arm, `summarisedTurns` stops being > 0, the window expands to 10, and this
   * spec goes red rather than quietly passing for the wrong reason.
   */
  it('priorTurnCount reports the ASSEMBLED window (8), not the raw store read (10)', async () => {
    const fetchedWindow = CONTEXT_PACK_RECENT_TURNS_CAP + 2;
    // ANTI-VACUITY: the whole discrimination rests on these two differing. If
    // the cap ever moves to equal the fetched window, this spec stops telling
    // the two candidate sources apart and must fail loudly, not silently pass.
    expect(
      fetchedWindow,
      'fetched and assembled must differ or this spec discriminates nothing',
    ).not.toBe(CONTEXT_PACK_RECENT_TURNS_CAP);

    mockState.priorTurns = Array.from({ length: fetchedWindow }, (_, i) => i + 1).map(mkPriorTurn);
    // Watermark at prior turn 3 (2026-04-30T03:00Z): it is present in the
    // window (so the watermark is provably COVERED) and 7 turns are newer than
    // it — lag 7, inside the 8-turn verbatim slice, so the memory-hole guard
    // does NOT refuse and the block earns real coverage (10 − 8 = 2 turns).
    mockState.summary = {
      text: [
        'DECISION FRAME: Choosing a supplier for the new product line.',
        'CONSTRAINTS & PREFERENCES: Keep Maria on the team.',
        'RESOLVED: (none)',
        'OPEN: Which region to launch first?',
      ].join('\n'),
      slots: [
        {
          slot: 'FRAME',
          entries: [
            { text: 'Choosing a supplier for the new product line.', source_turn_ids: [] },
          ],
        },
        {
          slot: 'CONSTRAINTS',
          entries: [{ text: 'Keep Maria on the team.', source_turn_ids: ['prior-turn-2'] }],
        },
        { slot: 'RESOLVED', entries: [] },
        {
          slot: 'OPEN',
          entries: [
            { text: 'Which region to launch first?', source_turn_ids: ['prior-turn-3'] },
          ],
        },
      ],
      updated_turn_id: 'prior-turn-3',
      updated_turn_created_at: '2026-04-30T03:00:00.000Z',
      version: 3,
      generator: 'incremental',
      schema_version: 1,
    };

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-frame-cap', {
      routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
      handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
      graphState: GRAPH_WITH_OPTIONS,
    });
    expect(result.frame).toBeDefined();
    // THE PIN: the assembled window, which on this path is the cap — and is
    // NOT the number of rows the store returned.
    expect(result.frame!.conversation.priorTurnCount).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(result.frame!.conversation.priorTurnCount).not.toBe(fetchedWindow);
  });

  /**
   * The degraded arm, kept as an honest record of current behaviour: with no
   * stored summary the assembler retains every fetched row, so the assembled
   * window legitimately equals the fetched one.
   *
   * ⚠ This spec CANNOT discriminate assembled-vs-raw — the two are the same
   * number here by construction. That is the point of the spec above, and this
   * one must never be mistaken for the guard.
   */
  it('degraded (no summary): the assembled window retains every fetched row', async () => {
    const fetchedWindow = CONTEXT_PACK_RECENT_TURNS_CAP + 2;
    mockState.priorTurns = Array.from({ length: fetchedWindow }, (_, i) => i + 1).map(mkPriorTurn);
    mockState.summary = null;
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-frame-cap-degraded', {
      routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
      handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
      graphState: GRAPH_WITH_OPTIONS,
    });
    expect(result.frame).toBeDefined();
    expect(result.frame!.conversation.priorTurnCount).toBe(fetchedWindow);
  });

  it('read-only posture: the frame never alters the user-facing response', async () => {
    // Identical turns; the frame is threaded on both. Response prose + chips
    // must be byte-identical — the frame is context plumbing, not product
    // behaviour (behaviour changes are later slices, gated separately).
    const run = (requestId: string) =>
      runTurnExecutor(BASE_PAYLOAD, requestId, {
        routingAdapter: mockRoutingAdapter(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS, 'Routing…')),
        handlerRegistry: makeSuccessRegistry(GRAPH_HASH),
        graphState: GRAPH_WITH_OPTIONS,
      });
    const a = await run('req-frame-posture-a');
    const b = await run('req-frame-posture-b');
    expect(a.frame).toBeDefined();
    expect(a.response.assistant_text).toBe(b.response.assistant_text);
    expect(JSON.stringify(a.response.suggested_actions)).toBe(
      JSON.stringify(b.response.suggested_actions),
    );
  });
});
