/**
 * V5 P0 golden-path repair — end-to-end HTTP boundary test for the
 * deterministic value-update path AND for stale-after-mutation
 * freshness via the post-handler re-derivation.
 *
 * Coverage in this file:
 *
 * 1. Single-turn deterministic value-update properties (Wave 2):
 *    - UI sends `selected_elements` on the wire; CEE consumes it.
 *    - "Update that factor to £30,000" + selection → set_factor_value
 *      deterministic dispatch, no LLM call, no edit_graph leak.
 *    - Receipt uses human label + user units (£30,000), no raw IDs
 *      or normalised model-unit fractions.
 *    - Selected non-factor (option) does not narrow.
 *
 * 2. Live-hash prior fact + mutation replay (Wave 2 + Wave 3 coherence):
 *    - prior fresh fact: live-hash prior + non-mutating turn → fresh.
 *    - mutation flips stale on same response: prior fresh +
 *      set_factor_value → stale (post-handler re-derivation, asserted
 *      via telemetry event).
 *    - subsequent turn against post-mutation graph remains stale.
 *
 * What this file does NOT prove (acknowledged):
 *    - run_analysis writing a fact through the real handler path.
 *    - A real explain turn consuming post-mutation freshness via
 *      LLM-routed handler dispatch.
 *
 * Live multi-turn coverage of those flows lives in
 * tools/v5-journey-replay/ (requires CEE_API_KEY against staging).
 *
 * The mocked session store accepts a prior handler turn when
 * mockedPriorFacts is non-empty, so the build-turn-context loader
 * exercises readFactsFor and feeds the prior fact into freshness
 * derivation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { setTestSink } from '../../src/utils/telemetry.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// Throwing routing adapter — if the LLM is called, the test fails
// loudly. This is the strongest assertion that the deterministic
// pre-route fired.
const llmCallTracker = { count: 0 };

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-throwing-adapter',
    chat: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when deterministic pre-route matches');
    },
    chatWithTools: async () => {
      llmCallTracker.count += 1;
      throw new Error('LLM should not be called when deterministic pre-route matches');
    },
  }),
  getAdapterWithResolution: (task?: string) => ({
    adapter: {
      name: 'test-throwing-adapter',
      chat: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when deterministic pre-route matches');
      },
      chatWithTools: async () => {
        llmCallTracker.count += 1;
        throw new Error('LLM should not be called when deterministic pre-route matches');
      },
    },
    resolution: {
      task: task ?? 'orchestrator',
      resolved_model: 'test-throwing-adapter',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// In-memory session store. The test mutates this between runs to
// simulate prior facts and verify subsequent freshness behaviour.
let mockedPriorFacts: unknown[] = [];
const appendCalls: unknown[] = [];

// ROADMAP 1.148 C5 — importOriginal-spread + complete shared store mock
// (derive, don't mirror). The old hand-rolled store (a) lacked `loadGraph`,
// so the D1 merge-base guard (PR #268) correctly fail-closed the mutation
// turn with a 500 against the incomplete MOCK — not a live defect — and
// (b) returned partial readRecent rows ({ id, turn_class, turn_id }) that
// fail the ContextPack row validation (handler_id/created_at are required),
// silently dropping the prior fact. The shared helper provides the full
// interface; `makeSessionTurnRow` provides a complete prior-handler row.
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore, makeSessionTurnRow } = await import(
    '../utils/mock-session-store.js'
  );
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write) => {
          appendCalls.push(write);
          return { id: 'mock-row-id' };
        },
        // build-turn-context calls readRecent first (filters to handler
        // turn_class) then readFactsFor against each row id. To exercise
        // the freshness derivation against prior facts we must surface a
        // prior handler turn so readFactsFor fires.
        readRecent: async () =>
          mockedPriorFacts.length > 0
            ? [
                makeSessionTurnRow({
                  id: '77777777-7777-4777-8777-777777777777',
                  scenario_id: SCENARIO_ID,
                  turn_id: 'prior-turn',
                  turn_class: 'handler',
                  handler_id: 'run_analysis',
                }),
              ]
            : [],
        readFactsFor: async () => mockedPriorFacts as never,
      }),
    resetSessionStoreForTests: () => {},
  };
});
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';

function buildGraphState() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
      // Two factors with overlapping label words. Deictic message has
      // no label evidence — selection is the ONLY way to disambiguate.
      {
        id: 'fac_advertising',
        kind: 'factor',
        label: 'Advertising budget',
        observed_state: {
          value: 0.2,
          raw_value: 20000,
          unit: '£',
          cap: 100000,
        },
      },
      {
        id: 'fac_headcount',
        kind: 'factor',
        label: 'Headcount',
        observed_state: { value: 0.5, raw_value: 50, unit: undefined },
      },
      { id: 'opt_a', kind: 'option', label: 'Plan A' },
      { id: 'opt_b', kind: 'option', label: 'Plan B' },
    ],
    edges: [
      {
        from: 'fac_advertising',
        to: 'goal_1',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
    ],
    options: [
      { id: 'opt_a', status: 'ready', interventions: { fac_advertising: { value: 30000 } } },
      { id: 'opt_b', status: 'ready', interventions: { fac_advertising: { value: 20000 } } },
    ],
    goal_node_id: 'goal_1',
  };
}

/**
 * Multi-candidate graph used by tests that need a NON-MUTATING
 * deterministic path through turn_executor. "Raise budget and cost to
 * £30k" against this graph substring-matches both factors → multi-
 * candidate clarify (no LLM call, no mutation). The clarify path goes
 * through turn_executor's freshness derivation, so analysis_ready is
 * stamped on the response — what the freshness assertions rely on.
 */
function buildMultiCandidateGraph() {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Profit', successThreshold: 100 },
      {
        id: 'fac_a',
        kind: 'factor',
        label: 'budget',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      {
        id: 'fac_b',
        kind: 'factor',
        label: 'cost',
        observed_state: { value: 0.5, raw_value: 50000, unit: '£', cap: 200000 },
      },
      { id: 'opt_a', kind: 'option', label: 'Plan A' },
      { id: 'opt_b', kind: 'option', label: 'Plan B' },
    ],
    edges: [
      {
        from: 'fac_a',
        to: 'goal_1',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
    ],
    options: [
      { id: 'opt_a', status: 'ready', interventions: { fac_a: { value: 30000 } } },
      { id: 'opt_b', status: 'ready', interventions: { fac_a: { value: 20000 } } },
    ],
    goal_node_id: 'goal_1',
  };
}

function _buildMultiCandidateRequest() {
  return {
    kind: 'message' as const,
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message: 'Raise budget and cost to £30k',
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
    graph_state: buildMultiCandidateGraph(),
    selected_elements: { node_ids: [], edge_ids: [] },
  };
}

/**
 * Path B clarify request — "Update that factor to £30,000" with no
 * selection. Routes through Path B deictic clarify INSIDE
 * turn_executor (so analysis_ready is stamped), no LLM call (the
 * throwing adapter never fires), no graph mutation (so the prior-fact
 * hash still matches the request's graph_state hash → freshness reads
 * 'fresh' for negative-case sanity tests).
 */
function buildDeicticClarifyRequest() {
  return {
    kind: 'message' as const,
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message: 'Update that factor to £30,000',
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
    graph_state: buildGraphState(),
    selected_elements: { node_ids: [], edge_ids: [] },
  };
}

function buildRequest(message: string, selectedNodeIds: string[]) {
  return {
    kind: 'message' as const,
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
    graph_state: buildGraphState(),
    selected_elements: { node_ids: selectedNodeIds, edge_ids: [] },
  };
}

describe('POST /orchestrate/v2/turn — deterministic value-update HTTP boundary', () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });
  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });
  beforeEach(() => {
    events = [];
    appendCalls.length = 0;
    mockedPriorFacts = [];
    llmCallTracker.count = 0;
    process.env = { ...originalEnv };
  });

  it('"Update that factor to £30,000" + one factor selected → 200 + set_factor_value graph_patch, no LLM call, no edit_graph', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', ['fac_advertising']),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    // Acceptance Gate 1: no LLM call. Strongest signal that the
    // deterministic pre-route fired.
    expect(llmCallTracker.count).toBe(0);

    // Acceptance Gate 2: dispatched set_factor_value, NOT edit_graph.
    const patchBlock = parsed.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeDefined();
    expect((patchBlock as { operation?: string }).operation).toBe('set_factor_value');
    expect((patchBlock as { target_id?: string }).target_id).toBe('fac_advertising');

    // No edit_graph block surfaces.
    const editGraphBlock = parsed.blocks.find(
      (b) => (b as { operation?: string }).operation === 'edit_graph',
    );
    expect(editGraphBlock).toBeUndefined();

    // Acceptance Gate 3: receipt uses human label and user units; no
    // raw IDs, no normalised fractions.
    expect(parsed.assistant_text).toContain('Advertising budget');
    expect(parsed.assistant_text).toMatch(/£30,000|£30000/);
    expect(parsed.assistant_text).not.toMatch(/\bfac_advertising\b/);
    // Receipts must show user units, not normalised model-unit fractions.
    // 0.3 is the model-unit equivalent of £30,000 / £100,000 — must NOT leak.
    expect(parsed.assistant_text).not.toMatch(/0\.\d+/);

    // Telemetry: deterministic pre-route emitted set_factor_value dispatch.
    const preRouteEvent = events.find(
      (e) => e.event === 'v5.deterministic_value_update',
    );
    expect(preRouteEvent?.data.matched).toBe(true);
    expect(preRouteEvent?.data.dispatch).toBe('set_factor_value');
  });

  it('"Update that factor to £30,000" + NO selection → clarify, no edit_graph, no LLM call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', []),
    });

    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);

    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    // No graph_patch — no mutation occurred.
    const patchBlock = parsed.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeUndefined();

    // Curated clarify copy. No internal terms.
    expect(parsed.assistant_text).toMatch(/factor/i);
    expect(parsed.assistant_text).not.toMatch(/\bedit_graph\b/);
    expect(parsed.assistant_text).not.toMatch(/\bnoop\b/);
    expect(parsed.assistant_text).not.toMatch(/\bfac_/);
  });

  it('"Update that factor to £30,000" + selected option (non-factor) → clarify, no mutation', async () => {
    // Option pre-filtering is in turn-executor: only factor-kind ids
    // are passed to the deterministic pre-route. A selected option
    // must NOT silently become the value-update target.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', ['opt_a']),
    });

    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);

    const body = JSON.parse(res.body);
    const parsed = OlumiResponseSchema.parse(body);

    const patchBlock = parsed.blocks.find((b) => b.type === 'graph_patch');
    expect(patchBlock).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR — shared synthetic prior fact used
// by the live-hash + mutation replay below. The describe block formerly
// at this position ("stale-after-mutation freshness (multi-turn)") was
// removed in fifth-round review (P1 #2 + IMP #3): it used a synthetic
// divergent hash and overlapped with the live-hash replay's narrative
// for the same property. The replay is the canonical coverage; nothing
// else seeds a divergent hash.
// ---------------------------------------------------------------------------

const SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR = {
  fact_type: 'run_analysis' as const,
  fact_version: 1 as const,
  noop: false as const,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_a',
    summary: 'Prior analysis run.',
    enrichment: { analysis_status: 'computed' },
    // graph_hash_at_run is OVERRIDDEN per-test with the live hash of
    // the test's graph_state (or, for the post-mutation persistence
    // test, the pre-mutation live hash). Tests do not consume this
    // default value directly.
    graph_hash_at_run: 'live-hash-overridden-per-test',
    computed_at: '2026-04-30T00:00:00.000Z',
  },
};

// ---------------------------------------------------------------------------
// Fourth-round review (P0 #3 + IMP #3 + IMP #4): RENAMED. Previously
// claimed "real 3-turn replay (run_analysis → set_factor_value →
// freshness)"; review correctly noted this seeded a synthetic prior
// fact rather than running run_analysis through HTTP. Renamed to
// "live-hash prior fact + mutation replay" to reflect what the test
// actually proves: with a synthetic prior fact at the live graph hash,
// (a) a non-mutating turn reports freshness=fresh, (b) a value-update
// mutation flips freshness=stale on the SAME response via post-handler
// re-derivation, and (c) a subsequent non-mutating turn against the
// post-mutation graph still reports freshness=stale.
//
// What this DOES prove (HTTP-boundary):
//   - Mutation drives post-handler freshness flip.
//   - The freshness verdict persists across non-mutating turns.
//   - Zero-LLM deterministic dispatch on the value-update path.
//
// What this does NOT prove (acknowledged honestly):
//   - run_analysis writing the fact through the real handler path
//     (mocked PLoT not present in this harness).
//   - A real explain turn consuming the post-mutation freshness via
//     the LLM-routed handler.
// Live multi-turn coverage of those properties stays in
// tools/v5-journey-replay/ which needs CEE_API_KEY against staging.
// ---------------------------------------------------------------------------

describe('POST /orchestrate/v2/turn — live-hash prior fact + mutation replay', () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });
  afterAll(async () => {
    setTestSink(null);
    await app.close();
  });
  beforeEach(() => {
    events = [];
    appendCalls.length = 0;
    mockedPriorFacts = [];
    llmCallTracker.count = 0;
    process.env = { ...originalEnv };
  });

  it('prior fresh fact: live-hash prior + non-mutating turn → freshness=fresh', async () => {
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../src/orchestrator-v5/context/graph-hash.js'
    );
    const liveHash = computeAnalysisAffectingGraphHash(buildGraphState() as never)!;
    mockedPriorFacts = [
      {
        ...SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR,
        result: {
          ...SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR.result,
          graph_hash_at_run: liveHash,
        },
      },
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildDeicticClarifyRequest(),
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    const ar = readAnalysisReadyFromResponseBody(body);
    expect(ar?.freshness).toBe('fresh');
  });

  it('mutation flips stale on same response: prior fresh + set_factor_value → freshness=stale (post-handler re-derivation)', async () => {
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../src/orchestrator-v5/context/graph-hash.js'
    );
    const liveHash = computeAnalysisAffectingGraphHash(buildGraphState() as never)!;
    mockedPriorFacts = [
      {
        ...SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR,
        result: {
          ...SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR.result,
          graph_hash_at_run: liveHash,
        },
      },
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: buildRequest('Update that factor to £30,000', ['fac_advertising']),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Confirm mutation happened: graph_patch with set_factor_value.
    const patchBlock = body.blocks?.find(
      (b: { type?: string; operation?: string }) => b?.type === 'graph_patch',
    );
    expect(patchBlock).toBeDefined();
    expect((patchBlock as { operation?: string }).operation).toBe('set_factor_value');

    // Post-handler freshness re-derivation flips to stale.
    const ar = readAnalysisReadyFromResponseBody(body);
    expect(ar?.freshness).toBe('stale');
    expect(llmCallTracker.count).toBe(0);

    // Fourth-round review (P1 #2): the report cited telemetry as
    // evidence ("dispatch_path: turn_executor_post_handler ... reason:
    // graph_hash_diverged"). Pin the assertion in the test so the
    // claim is provable, not anecdotal from a debug log.
    const postHandlerEvent = events.find(
      (e) =>
        e.event === 'v5.analysis_freshness.derived' &&
        e.data.dispatch_path === 'turn_executor_post_handler',
    );
    expect(postHandlerEvent, 'expected post-handler freshness derivation event').toBeDefined();
    expect(postHandlerEvent?.data.freshness).toBe('stale');
    expect(postHandlerEvent?.data.reason).toBe('graph_hash_diverged');
  });

  it('subsequent turn against post-mutation graph remains stale (freshness verdict persists)', async () => {
    // After the mutation in the previous test, the canvas reflects
    // the post-mutation graph. A subsequent non-mutating turn against
    // that graph (different hash from the prior fact's
    // graph_hash_at_run) must continue to report stale until a new
    // run_analysis writes a matching fact. This pins the persistence
    // property — the verdict is not a transient post-handler quirk.
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../src/orchestrator-v5/context/graph-hash.js'
    );
    // Build the post-mutation graph by hand: same shape but with the
    // factor's observed_state shifted to the mutation target.
    //
    // Fifth-round review (P1 #3): preserve ALL existing observed_state
    // fields (unit, cap, etc.) — only update value/raw_value. Pre-fix
    // the test overwrote the entire observed_state object, dropping
    // unit and cap, which polluted the hash divergence proof. With
    // metadata preserved, the hash differs purely because of the
    // value/raw_value change.
    const postMutationGraph = JSON.parse(JSON.stringify(buildGraphState())) as ReturnType<
      typeof buildGraphState
    >;
    const target = postMutationGraph.nodes.find((n) => n.id === 'fac_advertising')!;
    const previousObservedState = (target as { observed_state?: Record<string, unknown> })
      .observed_state ?? {};
    (target as { observed_state?: Record<string, unknown> }).observed_state = {
      ...previousObservedState,
      raw_value: 30000,
      value: 0.3,
    };
    const postMutationHash = computeAnalysisAffectingGraphHash(postMutationGraph as never)!;

    // Seed the prior fact at the PRE-mutation hash (different from
    // the post-mutation graph the request will carry).
    const preMutationHash = computeAnalysisAffectingGraphHash(buildGraphState() as never)!;
    expect(postMutationHash).not.toBe(preMutationHash);
    mockedPriorFacts = [
      {
        ...SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR,
        result: {
          ...SUCCESSFUL_RUN_ANALYSIS_FACT_PRIOR.result,
          graph_hash_at_run: preMutationHash,
        },
      },
    ];

    // Non-mutating turn carrying the post-mutation graph.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message' as const,
        turn_id: TURN_ID,
        scenario_id: SCENARIO_ID,
        message: 'Update that factor to £30,000',
        turn_class: 'decide' as const,
        stage: 'analyse' as const,
        source: 'composer' as const,
        graph_state: postMutationGraph,
        selected_elements: { node_ids: [], edge_ids: [] }, // no selection → clarify
      },
    });
    expect(res.statusCode).toBe(200);
    expect(llmCallTracker.count).toBe(0);
    const body = JSON.parse(res.body);
    const ar = readAnalysisReadyFromResponseBody(body);
    expect(ar?.freshness).toBe('stale');
  });
});

/**
 * Shared helper to extract analysis_ready from a wire response body.
 *
 * Fifth-round review (P1 #4 + IMP #2): matches the UI's extraction
 * semantics in `src/components/debug/utils/exportBundle.ts`
 * `extractAnalysisReadyFromBlocks` — root, then block.data,
 * then block.data.applied_graph (draft_graph emits analysis_ready
 * nested inside applied_graph). Without the applied_graph branch,
 * tests would falsely read undefined for any draft-style response.
 */
function readAnalysisReadyFromResponseBody(
  body: unknown,
): { freshness?: string; freshness_reason?: string } | undefined {
  const envelope = body as {
    analysis_ready?: { freshness?: string }
    blocks?: Array<{
      data?: {
        analysis_ready?: { freshness?: string }
        applied_graph?: { analysis_ready?: { freshness?: string } }
      }
    } | null>
  }
  // 1. Envelope root.
  if (envelope?.analysis_ready) return envelope.analysis_ready
  // 2. Any block carrying data.analysis_ready.
  for (const b of envelope.blocks ?? []) {
    if (b?.data?.analysis_ready) return b.data.analysis_ready
    // 3. Draft-graph nesting: data.applied_graph.analysis_ready.
    if (b?.data?.applied_graph?.analysis_ready) {
      return b.data.applied_graph.analysis_ready
    }
  }
  return undefined
}
