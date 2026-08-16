/**
 * P0 (2026-07-15, DGAI issue #340 / debug bundle olumi-debug-4605a72b) —
 * held proposals must survive the turn boundary THROUGH THE ROUTE.
 *
 * Live-wire failure being reproduced (Paul's exact sequence):
 *   1. CEE holds a multi-part GM proposal: "I'm holding the change to add
 *      'Wasted Time Searching for Co-Founder' and 2 more changes ... Reply
 *      yes to continue ...". The hold persists an `apply_proposed_change`
 *      pending with the executable batch (this part WORKS today).
 *   2. The user clicks the UI's own confirmation chip. The chip replays its
 *      LABEL TEXT as the user message (`source: 'chip_click'`, no proposal
 *      reference — the boundary chip enum cannot even carry one).
 *   3. The consent-clarity NAMED chip copy ("Add 'X' and 2 more changes")
 *      contains an edit verb + digits BY CONSTRUCTION, so it fails BOTH
 *      anchored confirmation regexes gating the route-level proposal-confirm
 *      suppressor — route-v2's edit heuristic hijacks the turn into
 *      `dispatchEditGraph` (the V4 edit LLM), which never reads pendings.
 *      The user gets "I've drafted a change that fits your description, but
 *      I need the specifics..." and the held proposal is never applied.
 *
 * These tests drive `POST /orchestrate/v2/turn` with the REAL TurnExecutor
 * (mocked LLM router + session store; `dispatchEditGraph` mocked purely as a
 * mis-dispatch detector) and assert the WIRING: the confirm turn must reach
 * the executor's held-resume path and produce a durable commit carrying the
 * applied graph + an `edit_graph` receipt fact — not a clarify, not an LLM
 * round-trip.
 *
 * RED-first: the chip-label, chip-message and typed-exact-copy cases FAIL on
 * base 96f0934378be (routed to dispatchEditGraph). The free-text "yes" case
 * pins the already-working executor path. The unrelated-edit cases pin
 * conservatism: a live hold must NEVER hijack a genuinely new edit command.
 *
 * Mocking strategy mirrors `route-v2-signature-loop.test.ts`; the GM hold
 * fixture mirrors `gm-held-execute-route-level.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

// Mutable per-test session-store behaviour.
let pendingActionsForRead: readonly PendingAction[] = [];

const appendMock = vi.fn(async (write: { graph?: unknown }) => ({
  id: 'mock-row-id',
  ...(write.graph != null
    ? { graph_write_disposition: 'accepted_insert' as const }
    : {}),
}));
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => STRICT_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: STRICT_GRAPH, briefText: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// The deterministic held-resume path must make ZERO LLM calls; any call on
// the apply cases is a wiring failure and must fail the test loudly. The
// mis-dispatch cases stub dispatchEditGraph, so they never reach this either.
const chatWithToolsMock = vi.fn().mockImplementation(async () => {
  throw new Error('LLM router must NOT be called on a deterministic held-proposal resume');
});
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const GM_PROPOSAL_REF = 'gmh_paulsholdref';

/**
 * Strict GraphV3 fixture (must pass BOTH GraphV3 and the ingress parse) —
 * the persisted graph the hold was pinned against AND the request
 * graph_state on the confirm turn (the graph did not move in between).
 */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Find a co-founder' },
    { id: 'goal-g', kind: 'goal', label: 'Launch the venture' },
    {
      id: 'fac-marketing',
      kind: 'factor',
      label: 'Marketing',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
    {
      id: 'fac-revenue',
      kind: 'factor',
      label: 'Revenue',
      observed_state: { value: 0.2, raw_value: 10, cap: 50 },
    },
  ],
  edges: [
    {
      from: 'fac-marketing',
      to: 'goal-g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac-revenue',
      to: 'goal-g',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
}
const GRAPH_HASH =
  computeAnalysisAffectingGraphHash(
    STRICT_GRAPH as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  ) ?? 'h_unset';

/**
 * The held batch — Paul's shape: one add plus two more changes. All three
 * ops are independently valid against STRICT_GRAPH so the confirm-time
 * re-referee accepts the batch.
 */
const HELD_OPERATIONS = [
  {
    op: 'add_node',
    path: 'fac-wasted-time',
    value: {
      id: 'fac-wasted-time',
      kind: 'factor',
      label: 'Wasted time searching for a co-founder',
    },
  },
  { op: 'update_node', path: 'fac-marketing', value: { description: 'Quarterly ad budget' } },
  { op: 'update_node', path: 'fac-revenue', value: { description: 'Monthly recurring revenue' } },
];

/**
 * The consent-clarity NAMED public copy exactly as `buildGmHeldPublicCopy`
 * mints it for this batch (CHANGESET HONESTY 1.134: the subject enumerates
 * EVERY operation — the pre-mechanism "and 2 more changes" collapse is
 * dead). The chip LABEL is what the UI replays on click (DGAI #340); the
 * MESSAGE is the "Yes, ..." variant a typed confirmation may repeat
 * verbatim.
 */
const HELD_CHIP_LABEL =
  "Add factor 'Wasted time searching for a co-founder', " +
  "update the description of 'Marketing' and update the description of 'Revenue'";
const HELD_CHIP_MESSAGE =
  "Yes, add factor 'Wasted time searching for a co-founder', " +
  "update the description of 'Marketing' and update the description of 'Revenue'.";

/** Deterministic clarify copy for a confirm with no live proposal (route-v2). */
const NO_LIVE_PROPOSAL_TEXT =
  "I don't have a pending suggested update to apply. " +
  'Tell me what you want to change, or ask what could change the outcome.';

function gmHeldPending(overrides: { expiresAtIso?: string; graphHash?: string } = {}): PendingAction {
  return {
    id: 'pa-gm-held-paul',
    scenario_id: SCENARIO_ID,
    chip_id: GM_PROPOSAL_REF,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: GM_PROPOSAL_REF,
      inline_patch: {
        handler_id: 'graph_management_held_v1',
        apply_wiring: 'held_execute_v1',
        candidate_id: 'cand-paul-hold',
        candidate_kind: 'add_node',
        mutation_class: 'structural',
        blocker_code: 'STRUCTURAL_APPLY_HELD',
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
        operations: HELD_OPERATIONS,
        operations_count: HELD_OPERATIONS.length,
      },
      public_label: HELD_CHIP_LABEL,
      public_message: HELD_CHIP_MESSAGE,
    },
    preconditions: { graph_hash: overrides.graphHash ?? GRAPH_HASH },
    expires_at_turn_count: 4,
    expires_at_iso: overrides.expiresAtIso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-15T20:00:00.000Z',
  } as PendingAction;
}

function makeEditGraphMockResult(assistantText = 'Mocked edit pipeline reply.') {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: assistantText,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '33333333-3333-4333-8333-333333333333',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'decide',
    source: 'composer',
    graph_state: STRICT_GRAPH,
    ...overrides,
  };
}

/** Assert the durable commit carries the APPLIED hold: mutated graph + receipt fact. */
function expectAppliedHoldCommit(): void {
  expect(appendMock).toHaveBeenCalledTimes(1);
  const write = appendMock.mock.calls[0]![0] as Record<string, unknown>;
  const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
  expect(graph).toBeDefined();
  const added = graph!.nodes!.find((n) => n.id === 'fac-wasted-time');
  expect(added).toBeDefined();
  expect(added!.label).toBe('Wasted time searching for a co-founder');
  const marketing = graph!.nodes!.find((n) => n.id === 'fac-marketing');
  expect(marketing!.description).toBe('Quarterly ad budget');
  const facts = write.handler_facts as ReadonlyArray<Record<string, unknown>>;
  expect(facts).toHaveLength(1);
  expect(facts[0]!.fact_type).toBe('edit_graph');
}

describe('POST /orchestrate/v2/turn — held proposal survives the confirm turn (P0, DGAI #340)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    dispatchEditGraphMock.mockResolvedValue(makeEditGraphMockResult());
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    pendingActionsForRead = [gmHeldPending()];
  });

  // ── Paul's exact sequence: the chip replays its LABEL text ─────────────
  it("chip click replaying the hold chip's LABEL applies the held batch (no edit-LLM hijack, zero LLM calls)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: HELD_CHIP_LABEL, source: 'chip_click' }),
    });
    expect(res.statusCode).toBe(200);
    // The edit heuristic must NOT claim the confirm turn.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // Deterministic resume: zero LLM calls.
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    // Durable commit carries the applied graph + edit_graph receipt fact.
    expectAppliedHoldCommit();
    // The wire reply is the named applied receipt, keeping the hold-turn
    // promise — never the "I need the specifics" clarify Paul got.
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Confirmed:');
    expect(body.assistant_text).toContain('Wasted time searching for a co-founder');
    expect(body.assistant_text).not.toContain('I need the specifics');
  });

  // ── The chip's MESSAGE variant ("Yes, add ...") replayed on the wire ───
  it("chip click replaying the hold chip's MESSAGE applies the held batch", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: HELD_CHIP_MESSAGE, source: 'chip_click' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expectAppliedHoldCommit();
  });

  // ── The same copy TYPED by the user (no chip metadata at all) ──────────
  it('typing the exact "Yes, add ..." confirmation applies the held batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: HELD_CHIP_MESSAGE, source: 'composer' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expectAppliedHoldCommit();
  });

  // ── The copy promise: "Reply yes to continue" must be TRUE ─────────────
  it('free-text "yes" applies the held batch (the hold copy promise)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'yes', source: 'composer' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expectAppliedHoldCommit();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Confirmed:');
  });

  // ── Conservatism: a live hold must never hijack unrelated turns ────────
  it('an unrelated typed edit command while a hold is live still routes to the edit pipeline (no hijack)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add a risk for supplier delays affecting the launch',
        source: 'composer',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toContain('Confirmed:');
  });

  it('an unrelated CHIP click with an edit-verb label while a hold is live still routes to the edit pipeline', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Add a risk for supplier delays affecting the launch',
        source: 'chip_click',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toContain('Confirmed:');
  });

  // ── Honest expiry: a dead hold's chip resolves to the clarify, never a
  //    silent edit-LLM draft and never a false apply ──────────────────────
  it('replaying the chip label after the hold expired returns the deterministic clarify (no apply, no edit dispatch)', async () => {
    pendingActionsForRead = [gmHeldPending({ expiresAtIso: '2020-01-01T00:00:00.000Z' })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: HELD_CHIP_LABEL, source: 'chip_click' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toBe(NO_LIVE_PROPOSAL_TEXT);
    // Nothing applied, nothing drafted.
    const writes = appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    for (const w of writes) expect(w.graph).toBeUndefined();
  });
});
