/**
 * Structural-restructure — the CONSENT→APPLY half of the four-turn-nothing fix
 * (LATENCY-RECAPTURE finding 3; A1 red-team A5 binding).
 *
 * A5 (binding): the consent→apply binding MUST classify chat consent with a
 * ROUTING-TOOL-TYPED mechanism — the existing typed short-confirm /
 * sole-live-pending resume discipline (the #488 / P1a derivation) — NOT a new
 * feature-specific consent-phrase list (the 0.22 Intent/ActionType vocabulary
 * has no confirm/consent value; chip consent rides the `patch_accepted`
 * SystemEventKind, and CHAT consent rides the typed sole-live-pending resume).
 *
 * This lane's propose side commits a TYPED `apply_proposed_change` pending
 * (via the edit lane → evaluateEditGraphMutations). The consent that applies it
 * is classified NOT by any string the lane added, but by
 * `tryShortConfirmResume` (deterministic-short-confirm.ts): a bare affirmative
 * (the sanctioned P1a `SHORT_CONFIRM_PATTERN`) resolves ONLY because exactly one
 * live pending of the RESUMABLE, consent-priority kind `apply_proposed_change`
 * exists — the classification keys on the pending's TYPED `action.kind`, not the
 * phrase. This suite pins THAT mechanism for the restructure hold:
 *
 *   MECHANISM PIN (the A5 mutation): replace the typed sole-live-pending
 *   classification with a literal consent-string match → the "go ahead" /
 *   "proceed" phrase-agnostic cases go RED (a hardcoded phrase list cannot
 *   match every valid bare affirmative), and the no-live-pending case would
 *   wrongly apply. Both discriminate typed-classification from string-matching.
 *
 * Harness modelled on route-v2-held-proposal-confirm.test.ts (the confirm-side
 * proof for the generic hold); here the held batch is a structural restructure
 * (a per-option factor split) and the messages are bare chat consents.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { _resetConfigCache } from '../../config/index.js';

// dispatchEditGraph is the V4 edit LLM lane. On a CONSENT turn it must NEVER be
// called — the deterministic sole-live-pending resume owns it (zero LLM).
const dispatchEditGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

let pendingActionsForRead: readonly PendingAction[] = [];

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
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

// Any LLM call on a deterministic resume is a wiring failure (a consent that
// fell to the router instead of the typed sole-live-pending resume).
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
    resolution: { task: 'orchestrator', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const GM_PROPOSAL_REF = 'gmh_restructure_ref';

/** A model with a SHARED factor across two options — the restructure target. */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Build in-house' },
    { id: 'opt-b', kind: 'option', label: 'Outsource' },
    { id: 'goal-g', kind: 'goal', label: 'Ship the platform' },
    {
      id: 'fac-cost',
      kind: 'factor',
      label: 'Cost',
      observed_state: { value: 0.3, raw_value: 30, cap: 100 },
    },
  ],
  edges: [
    {
      from: 'fac-cost',
      to: 'goal-g',
      strength: { mean: -0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
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
 * The held restructure batch — a per-option split of the shared 'Cost' factor:
 * one new option-specific factor node. add_node applies atomically on resume
 * (the proven op-class from the confirm-side suite), so the consent lands a
 * moved hash without an LLM call.
 */
const HELD_OPERATIONS = [
  {
    op: 'add_node',
    path: 'fac-cost-build',
    value: { id: 'fac-cost-build', kind: 'factor', label: 'Cost (Build in-house)' },
  },
];
const HELD_CHIP_LABEL = "Add factor 'Cost (Build in-house)'";
const HELD_CHIP_MESSAGE = "Yes, add factor 'Cost (Build in-house)'.";

function restructureHeldPending(
  overrides: { expiresAtIso?: string } = {},
): PendingAction {
  return {
    id: 'pa-restructure-hold',
    scenario_id: SCENARIO_ID,
    chip_id: GM_PROPOSAL_REF,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: GM_PROPOSAL_REF,
      inline_patch: {
        handler_id: 'graph_management_held_v1',
        apply_wiring: 'held_execute_v1',
        candidate_id: 'cand-restructure',
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
    preconditions: { graph_hash: GRAPH_HASH },
    expires_at_turn_count: 4,
    expires_at_iso: overrides.expiresAtIso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-23T01:00:00.000Z',
  } as PendingAction;
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

/** Assert the durable commit APPLIED the restructure: moved graph + receipt. */
function expectAppliedRestructure(): void {
  expect(appendMock).toHaveBeenCalledTimes(1);
  const write = appendMock.mock.calls[0]![0] as Record<string, unknown>;
  const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
  expect(graph).toBeDefined();
  const added = graph!.nodes!.find((n) => n.id === 'fac-cost-build');
  expect(added).toBeDefined();
  expect(added!.label).toBe('Cost (Build in-house)');
  const facts = write.handler_facts as ReadonlyArray<Record<string, unknown>>;
  expect(facts).toHaveLength(1);
  expect(facts[0]!.fact_type).toBe('edit_graph');
}

describe('POST /orchestrate/v2/turn — bare chat consent applies the restructure hold via the TYPED sole-live-pending resume (A5)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
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
    dispatchEditGraphMock.mockResolvedValue({ response: {}, commitPerformed: true });
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    pendingActionsForRead = [restructureHeldPending()];
  });

  it('"Yes, apply it now." applies the restructure hold (zero LLM, no edit-LLM hijack, hash moves)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Yes, apply it now.', source: 'composer' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expectAppliedRestructure();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Confirmed:');
  });

  // MECHANISM PIN (A5 mutation discriminator): these bare affirmatives are NOT
  // the chip copy and share no distinctive substring — they resume ONLY because
  // the resume keys on the sole live TYPED `apply_proposed_change`, resolving any
  // SHORT_CONFIRM_PATTERN affirmative. Swap the typed classification for a
  // literal consent-string match and these go RED.
  it.each(['go ahead', 'proceed', 'do it', 'confirm'])(
    'the phrase-agnostic bare affirmative "%s" also applies the SAME restructure hold (typed, not string-matched)',
    async (message) => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({ message, source: 'composer' }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
      expect(chatWithToolsMock).not.toHaveBeenCalled();
      expectAppliedRestructure();
    },
  );

  it('with NO live pending, the identical consent applies NOTHING (the resume is gated on the typed pending, not the phrase)', async () => {
    pendingActionsForRead = [];
    // With nothing to resume, a bare "yes" is ordinary conversation — it
    // legitimately reaches the coach. Let that complete benignly for this one
    // turn so the no-apply assertion is a real positive control, not a 500.
    chatWithToolsMock.mockImplementationOnce(async () => ({
      content: [{ type: 'text', text: "There's nothing pending to apply right now." }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'test-model',
      latencyMs: 5,
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Yes, apply it now.', source: 'composer' }),
    });
    expect(res.statusCode).toBe(200);
    // The restructure did NOT apply — no committed graph carries the new node.
    const writes = appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    for (const w of writes) {
      const graph = w.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
      if (graph?.nodes) {
        expect(graph.nodes.find((n) => n.id === 'fac-cost-build')).toBeUndefined();
      }
    }
  });

  it('an expired restructure hold + consent applies NOTHING (typed liveness, not the phrase)', async () => {
    pendingActionsForRead = [restructureHeldPending({ expiresAtIso: '2020-01-01T00:00:00.000Z' })];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Yes, apply it now.', source: 'composer' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const writes = appendMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
    for (const w of writes) expect(w.graph).toBeUndefined();
  });
});
