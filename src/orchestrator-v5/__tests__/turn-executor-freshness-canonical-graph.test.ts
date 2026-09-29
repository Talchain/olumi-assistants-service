/**
 * V5 stale-aware explain recovery — H3 wiring regression test.
 *
 * The freshness derivation comparing `graph_hash_at_run` (from a prior
 * run_analysis fact) against the current graph's hash MUST use the
 * canonical persisted graph (`scenarios.graph`, surfaced on
 * `context.persistedGraph` by buildTurnContext) — NOT the
 * request-supplied `options.graphState`.
 *
 * Without that wiring, a client (or replay harness) that lags behind a
 * persisted edit and re-sends the pre-edit graph on the follow-up
 * explain turn would hash to the same value as the run_analysis fact's
 * `graph_hash_at_run`, producing a false-fresh verdict and skipping the
 * stale recovery template + Rerun-analysis chip.
 *
 * This test sets up that exact divergence and asserts the post-fix
 * behaviour: persisted-graph hash diverges from `graph_hash_at_run` →
 * `analysis_freshness === 'stale'` on the pre-handler telemetry event.
 *
 * The negative-control test asserts the fresh path is unaffected: when
 * persisted and request graph match the run_analysis hash, freshness
 * stays `'fresh'`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { finaliseV5Response } from '../response-finaliser.js';
import { GRAPH_CONTEXT_INSTRUCTION } from '../routing/route-with-tool-use.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Session store mock — no Supabase. Mirrors the slim mock in
// turn-executor.test.ts so the test exercises the real runTurnExecutor
// path with deterministic prior_facts / persisted_graph fixtures.
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => (global as Record<string, unknown>).__test_prior_turns ?? [],
    readFactsFor: async () =>
      (global as Record<string, unknown>).__test_prior_facts ?? [],
    readFactsWithTurnFor: async () => {
      const facts = ((global as Record<string, unknown>).__test_prior_facts ?? []) as Array<
        Record<string, unknown>
      >;
      const turns = ((global as Record<string, unknown>).__test_prior_turns ?? []) as Array<
        Record<string, unknown>
      >;
      return facts.map((fact, index) => ({
        fact,
        fact_row_id: `freshness-fact-row-${index}`,
        turn_id: (turns[index]?.id as string | undefined) ?? `turn-row-${index}`,
        fact_created_at:
          ((fact.result as Record<string, unknown> | undefined)
            ?.computed_at as string | undefined) ??
          '2026-05-10T10:00:00.000Z',
      }));
    },
    readScenarioRunAnalysisFactsFor: async (_scenarioId: string, limit: number) => {
      const facts = (((global as Record<string, unknown>).__test_prior_facts ?? []) as Array<
        Record<string, unknown>
      >).filter(
        (fact) => fact.fact_type === 'run_analysis' && fact.noop !== true,
      );
      return {
        facts: facts.slice(0, limit).map((fact, index) => ({
          fact,
          fact_row_id: `freshness-fact-row-${index}`,
          fact_created_at:
            ((fact.result as Record<string, unknown> | undefined)
              ?.computed_at as string | undefined) ??
            '2026-05-10T10:00:00.000Z',
        })),
        total_count: facts.length,
      };
    },
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () =>
      (global as Record<string, unknown>).__test_persisted_graph ?? null,
    loadGraphAndBriefText: async () => ({
      graph: (global as Record<string, unknown>).__test_persisted_graph ?? null,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {
    delete (global as Record<string, unknown>).__test_prior_turns;
    delete (global as Record<string, unknown>).__test_prior_facts;
    delete (global as Record<string, unknown>).__test_persisted_graph;
  },
}));

const { runTurnExecutor } = await import('../turn-executor.js');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

interface SerialisedContextPack {
  readonly graph_context?: { readonly status?: string };
  readonly graph?: {
    readonly nodes?: ReadonlyArray<{
      readonly id?: string;
      readonly label?: string;
      readonly is_baseline?: true;
    }>;
    readonly edges?: ReadonlyArray<{
      readonly from?: string;
      readonly to?: string;
      readonly relationship?: string;
    }>;
  };
}

function routingPrompt(adapter: ReturnType<typeof mockRoutingAdapter>): string {
  const args = adapter.chatWithTools.mock.calls[0]?.[0];
  expect(args, 'the routing adapter was never called').toBeDefined();
  const messages = args!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((message) => message.role === 'user');
  expect(user, 'no user message reached the routing adapter').toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

function serialisedContextPack(prompt: string): SerialisedContextPack {
  const marker = '## ContextPack\n';
  const at = prompt.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  const rest = prompt.slice(at + marker.length);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      return JSON.parse(rest.slice(0, i + 1)) as SerialisedContextPack;
    }
  }
  throw new Error('serialisedContextPack: unterminated ContextPack JSON');
}

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRIOR_ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRIOR_TURN_ID_CLIENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: SCENARIO_ID,
  message: 'why does that option lead?',
  turn_class: 'frame',
  stage: 'analyse',
};

// Two graphs that hash differently under
// `computeAnalysisAffectingGraphHash` (strength.mean differs).
const PRE_EDIT_GRAPH = {
  nodes: [
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'fac_cost', kind: 'factor', label: 'Cost' },
    { id: 'goal_outcome', kind: 'goal', label: 'Outcome' },
  ],
  edges: [
    {
      from: 'opt_a',
      to: 'fac_cost',
      edge_type: 'causal',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac_cost',
      to: 'goal_outcome',
      edge_type: 'causal',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
  goal_node_id: 'goal_outcome',
};

const POST_EDIT_GRAPH = {
  ...PRE_EDIT_GRAPH,
  nodes: PRE_EDIT_GRAPH.nodes.map((node) =>
    node.id === 'opt_a' ? { ...node, label: 'Option A after saved edit' } : node,
  ),
  edges: [
    {
      ...PRE_EDIT_GRAPH.edges[0]!,
      strength: { mean: 0.75, std: 0.1 }, // strengthened — should diverge the hash
    },
    PRE_EDIT_GRAPH.edges[1]!,
  ],
};

const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(
  PRE_EDIT_GRAPH as never,
)!;
const POST_EDIT_HASH = computeAnalysisAffectingGraphHash(
  POST_EDIT_GRAPH as never,
)!;

const CANONICAL_BASELINE_GRAPH = {
  nodes: [
    {
      id: 'opt_current',
      kind: 'option',
      label: 'Saved current approach',
      is_baseline: true,
    },
    { id: 'opt_change', kind: 'option', label: 'Saved alternative' },
    { id: 'goal_outcome', kind: 'goal', label: 'Outcome' },
  ],
  edges: [],
};

const CONFLICTING_REQUEST_BASELINE_GRAPH = {
  nodes: [
    { id: 'opt_current', kind: 'option', label: 'REQUEST ONLY current' },
    {
      id: 'opt_change',
      kind: 'option',
      label: 'REQUEST ONLY alternative',
      is_baseline: true,
    },
    { id: 'goal_outcome', kind: 'goal', label: 'REQUEST ONLY outcome' },
  ],
  edges: [],
};

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}

function findPreHandlerFreshnessEvent(): Event | undefined {
  return events.find(
    (e) =>
      e.event === 'v5.analysis_freshness.derived' &&
      (e.data.dispatch_path as string | undefined) === 'turn_executor_pre_handler',
  );
}

function findContextPackEvent(): Event | undefined {
  return events.find((event) => event.event === 'v5.context_pack.assembled');
}

// ---------------------------------------------------------------------------
// Fixture installer
// ---------------------------------------------------------------------------

function installPriorRunAnalysisFact(graphHashAtRun: string): void {
  (global as Record<string, unknown>).__test_prior_turns = [
    {
      id: PRIOR_ROW_ID,
      scenario_id: SCENARIO_ID,
      user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      turn_id: PRIOR_TURN_ID_CLIENT,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: 'sha256:prev',
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 42,
      created_at: '2026-05-10T10:00:00.000+00:00',
    },
  ];
  (global as Record<string, unknown>).__test_prior_facts = [
    {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Prior analysis',
        graph_hash_at_run: graphHashAtRun,
        computed_at: '2026-05-10T10:00:00.000Z',
        enrichment: { analysis_status: 'completed' },
        win_probabilities: { opt_a: 0.62 },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('turn-executor freshness — canonical persisted graph (H3 fix)', () => {
  beforeEach(() => {
    events = [];
    installSink();
    // Hash invariant: pre and post graphs must differ. Guard the fixture
    // so a future change to computeAnalysisAffectingGraphHash that
    // accidentally projects strength.mean out would not silently break
    // the test premise.
    if (PRE_EDIT_HASH === POST_EDIT_HASH) {
      throw new Error(
        'Test fixture invariant violated: PRE_EDIT_HASH must differ from POST_EDIT_HASH',
      );
    }
  });
  afterEach(() => {
    uninstallSink();
    delete (global as Record<string, unknown>).__test_prior_turns;
    delete (global as Record<string, unknown>).__test_prior_facts;
    delete (global as Record<string, unknown>).__test_persisted_graph;
  });

  it('marks STALE when persisted graph diverges from request graphState (client lag)', async () => {
    // Prior run_analysis fact captured the PRE-edit hash.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    // Canonical persisted graph reflects the post-edit state.
    (global as Record<string, unknown>).__test_persisted_graph = POST_EDIT_GRAPH;
    // Client is lagging — re-sends the PRE-edit graph as request body.
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('follow-up explanation'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what does it mean?' },
      'req-stale-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('stale');
    expect(evt!.data.reason).toBe('graph_hash_diverged');
    expect(evt!.data.graph_hash_at_run).toBe(PRE_EDIT_HASH);
    // The H3 fix: current_graph_hash must come from the persisted graph,
    // not the request graph. Without the fix this is PRE_EDIT_HASH and
    // freshness is 'fresh'.
    expect(evt!.data.current_graph_hash).toBe(POST_EDIT_HASH);
    expect(findContextPackEvent()?.data.graph_context_status).toBe('canonical');
    expect(findContextPackEvent()?.data.graph_context_reason).toBe('persisted_valid');
  });

  it('remains FRESH when persisted graph matches the prior run_analysis fact (no edit)', async () => {
    // Prior run_analysis on the PRE-edit graph, no subsequent edit:
    // persisted graph is still the same shape.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = PRE_EDIT_GRAPH;
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('explanation'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'why does it lead?' },
      'req-fresh-h3',
      {
        routingAdapter,
        // Deliberately divergent client bytes: if freshness or the prompt fell
        // back to request-first authority, this arm would be stale and the
        // client-only renamed label would reach the model.
        graphState: POST_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.reason).toBe('graph_hash_match');
    expect(evt!.data.current_graph_hash).toBe(PRE_EDIT_HASH);

    const prompt = routingPrompt(routingAdapter);
    const pack = serialisedContextPack(prompt);
    const option = pack.graph?.nodes?.find((node) => node.id === 'opt_a');
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(option?.label).toBe('Option A');
    expect(option?.label).not.toBe('Option A after saved edit');
    expect(prompt).toContain(GRAPH_CONTEXT_INSTRUCTION);

  });

  it('keeps the canonical baseline marker when request bytes mark a different option', async () => {
    const canonicalHash = computeAnalysisAffectingGraphHash(
      CANONICAL_BASELINE_GRAPH as never,
    );
    expect(canonicalHash, 'canonical fixture must produce a freshness hash').not.toBeNull();
    installPriorRunAnalysisFact(canonicalHash!);
    (global as Record<string, unknown>).__test_persisted_graph = CANONICAL_BASELINE_GRAPH;
    const routingAdapter = mockRoutingAdapter(async () => mkTextResult('comparison'));

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'compare the current approach with the alternative' },
      'req-canonical-baseline-context',
      {
        routingAdapter,
        graphState: CONFLICTING_REQUEST_BASELINE_GRAPH as never,
      },
    );

    const prompt = routingPrompt(routingAdapter);
    const pack = serialisedContextPack(prompt);
    const current = pack.graph?.nodes?.find((node) => node.id === 'opt_current');
    const alternative = pack.graph?.nodes?.find((node) => node.id === 'opt_change');

    expect(findContextPackEvent()?.data.graph_compact_via).toBe('strict_parse');
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(current).toEqual(
      expect.objectContaining({
        label: 'Saved current approach',
        is_baseline: true,
      }),
    );
    expect(alternative?.label).toBe('Saved alternative');
    expect(alternative).not.toHaveProperty('is_baseline');
    expect(prompt).not.toContain('REQUEST ONLY');
  });

  it('fresh fallback (no request analysis_state, graph_hash_match) emits NO stale/unknown user-facing copy', async () => {
    // Scope C regression: a follow-up turn with NO request analysis_state
    // builds the analysis projection from the prior run_analysis fact
    // (analysis_state_source: 'fallback'). When the persisted graph still
    // matches graph_hash_at_run the verdict is fresh / graph_hash_match, so
    // the legacy `loaded_from_prior_run_freshness_unknown` reason must NOT be
    // stamped and the staleness prefix must NOT be prepended. Guards the
    // P0-era bug where every fallback turn after run_analysis looked stale,
    // and the now-fixed stale docblock in analysis-fallback.ts.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = PRE_EDIT_GRAPH;
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('Here is a follow-up explanation of the prior analysis.'),
    );

    const { response } = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'explain the prior results' },
      'req-fresh-fallback-copy',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    // Sanity-pin: the scenario IS a fresh fallback verdict.
    const evt = findPreHandlerFreshnessEvent();
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.reason).toBe('graph_hash_match');

    // The assistant_text must carry NO stale / unknown freshness wording.
    const text = response.assistant_text ?? '';
    expect(text).not.toMatch(/these results may be out of date/i);
    expect(text.toLowerCase()).not.toContain('out of date');
    expect(text).not.toContain('loaded_from_prior_run_freshness_unknown');
    expect(text).not.toMatch(/freshness[_\s-]?unknown/i);
  });

  it('returns UNKNOWN (not fresh) when persisted graph exists but fails ingress parse (Codex round-3 P1)', async () => {
    // V5 stale-aware explain recovery — Codex round-3 P1.
    //
    // Earlier behaviour: when persistedGraph existed but failed
    // GraphStateIngressSchema parse, the code silently fell back to
    // hashing the request graphState. If the client was also lagging
    // (stale pre-edit graph) the hash matched the prior fact's
    // graph_hash_at_run and produced a false-fresh verdict —
    // misleading the wire envelope and the chip-generator stale rule.
    //
    // Post-fix: parse-failure on a present persistedGraph is a real
    // safety case. The runtime emits the `v5.persisted_graph.
    // parse_failed` log signal and returns null hash, routing the
    // freshness derivation to `'unknown' / current_graph_hash_
    // unavailable`. The user-facing chip rules treat unknown as
    // non-stale (no Rerun-analysis chip surface), but the wire
    // envelope's analysis_ready.freshness reports the verdict
    // honestly instead of lying about freshness.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    // Malformed: `nodes` must be an array per GraphStateIngressSchema;
    // a string-typed nodes field forces safeParse to fail.
    (global as Record<string, unknown>).__test_persisted_graph = {
      nodes: 'not-an-array',
      edges: [],
    };
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('explanation after parse failure'),
    );

    const run = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'why did that lead?' },
      'req-malformed-persisted-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    expect(evt!.data.freshness).toBe('unknown');
    expect(evt!.data.reason).toBe('current_graph_hash_unavailable');
    expect(evt!.data.current_graph_hash).toBeNull();

    // A malformed canonical record fails weak for the ContextPack too. This
    // path exits deterministically before routing, so the assembly event is the
    // observable source-authority seam rather than an adapter prompt.
    expect(findContextPackEvent()?.data.graph_context_status).toBe('unavailable');
    expect(findContextPackEvent()?.data.graph_context_reason).toBe(
      'persisted_invalid_shape',
    );
    // The unavailable graph and request graph are both null at the readiness
    // projection seam. Identity equality must not accidentally resurrect the
    // request-derived readiness that was computed before authority selection.
    expect(run.analysisReady).toBeUndefined();
    expect(run.effectiveGraph).toBeNull();
  });

  it('legacy/unparseable persisted graph reload ships analysis_ready.freshness=unknown on the wire (Mission 3)', async () => {
    // The TRUE gap the Codex round-3 P1 test above does not hit: that test
    // passes a VALID request graphState, so GraphV3 parse succeeds and a
    // structural readiness payload ships anyway. On a real reload of a
    // legacy/unparseable scenario the request carries NO graphState either —
    // readiness is never computed, and pre-Mission-3 the honest 'unknown'
    // verdict was dropped at the finaliser because freshness had no
    // analysis_ready carrier. This test composes the run result into the
    // finaliser exactly as route-v2's turn-executor exit does and asserts
    // the verdict now rides the wire in a minimal science-free block.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = {
      nodes: 'not-an-array',
      edges: [],
    };
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('explanation after reload of legacy scenario'),
    );

    const run = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what did the analysis say?' },
      'req-m3-freshness-only',
      { routingAdapter },
    );

    // Gap preconditions: verdict computed, readiness not.
    expect(run.analysisReady).toBeUndefined();
    expect(run.freshness?.freshness).toBe('unknown');
    expect(run.freshness?.reason).toBe('current_graph_hash_unavailable');

    // Mirror route-v2's turn-executor exit context (route-v2.ts sendFinalised200).
    const finalised = finaliseV5Response(run.response, {
      analysisReady: run.analysisReady,
      ...(run.freshness ? { freshness: run.freshness } : {}),
    });

    const ar = finalised.analysis_ready as Record<string, unknown>;
    expect(ar, 'freshness-only analysis_ready must ship on the wire').toBeDefined();
    expect(ar.freshness).toBe('unknown');
    expect(ar.freshness_reason).toBe('current_graph_hash_unavailable');
    expect(ar.status).toBe('blocked');
    expect(ar.options).toEqual([]);
    expect(ar.bias_findings).toEqual([]);
    // Science-free carrier: no claim-bearing keys.
    expect('blockers' in ar).toBe(false);
    expect('model_adjustments' in ar).toBe(false);
    expect('user_questions' in ar).toBe(false);
    OlumiResponseSchema.parse(finalised);
  });

  it('same reload with NO prior analysis (freshness none) still omits analysis_ready', async () => {
    // Counter-pin: synthesis only carries an existing verdict about a prior
    // analysis. With no run_analysis fact the verdict is 'none' and the
    // wire stays clean — no block is invented.
    (global as Record<string, unknown>).__test_persisted_graph = {
      nodes: 'not-an-array',
      edges: [],
    };
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('nothing analysed yet'),
    );

    const run = await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'what is here?' },
      'req-m3-none',
      { routingAdapter },
    );

    expect(run.analysisReady).toBeUndefined();
    expect(run.freshness?.freshness).toBe('none');

    const finalised = finaliseV5Response(run.response, {
      analysisReady: run.analysisReady,
      ...(run.freshness ? { freshness: run.freshness } : {}),
    });
    expect('analysis_ready' in finalised).toBe(false);
    OlumiResponseSchema.parse(finalised);
  });

  it('uses a valid request graph provisionally only after an explicit absent persisted read', async () => {
    // An explicit successful absent read is the only first-touch state that may
    // promote a valid request graph. A degraded read is covered above and must
    // remain unavailable.
    installPriorRunAnalysisFact(PRE_EDIT_HASH);
    (global as Record<string, unknown>).__test_persisted_graph = null;
    const routingAdapter = mockRoutingAdapter(async () =>
      mkTextResult('fallback path'),
    );

    await runTurnExecutor(
      { ...BASE_PAYLOAD, message: 'first response after analysis' },
      'req-fallback-h3',
      {
        routingAdapter,
        graphState: PRE_EDIT_GRAPH as never,
      },
    );

    const evt = findPreHandlerFreshnessEvent();
    expect(evt, 'pre-handler freshness telemetry event should fire').toBeDefined();
    // Without a persisted graph the fallback hashes the request graph —
    // and that matches the prior fact's hash so freshness is 'fresh'.
    expect(evt!.data.freshness).toBe('fresh');
    expect(evt!.data.current_graph_hash).toBe(PRE_EDIT_HASH);
    expect(findContextPackEvent()?.data.graph_context_status).toBe('provisional');
    expect(findContextPackEvent()?.data.graph_context_reason).toBe(
      'persisted_absent_request_valid',
    );

    const prompt = routingPrompt(routingAdapter);
    const pack = serialisedContextPack(prompt);
    expect(pack.graph_context).toEqual({ status: 'provisional' });
    expect(pack.graph?.nodes?.map((node) => node.id)).toEqual(
      expect.arrayContaining(['opt_a', 'fac_cost', 'goal_outcome']),
    );
    expect(prompt).toContain(GRAPH_CONTEXT_INSTRUCTION);
  });
});
