/**
 * Lane 34 — GM held-execute wiring (propose → hold → confirm → apply),
 * route-level through TurnExecutor.
 *
 * RED-first: the "live mode applies the confirmed hold" cases FAIL on
 * pristine base d63a0219c (a "yes" on a GM held pending resolves through
 * decideProposedChangeSynthesis → 'invalid' → decline-with-clarify and
 * persists nothing). The shadow-mode and no-payload cases pin the base
 * posture and must pass BOTH before and after the wiring (flag-gated
 * inertness).
 *
 * Pins:
 *  - live + "yes" on a GM held pending carrying `inline_patch.operations`:
 *    zero LLM calls, ONE commit whose `graph` carries the applied edit and
 *    whose `handler_facts` carry an `edit_graph` receipt fact (DL-7: never
 *    a receipt-less mutation), consumed pending never re-persisted;
 *  - the applied receipt is not the decline copy and carries no forbidden
 *    phrase;
 *  - live + hash divergence → superseded recovery, NO graph commit;
 *  - live + legacy pending (no operations payload) → decline-with-clarify,
 *    NO graph commit (backwards-compatible with pre-lane-34 pendings);
 *  - shadow mode + the SAME executable pending → decline-with-clarify,
 *    NO graph commit — byte-identical posture to base (the flag gate).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { findForbiddenPhraseHit } from '../compose/forbidden-user-facing-phrases.js';
import { PROPOSAL_SUPERSEDED_RESPONSE } from '../routing/proposed-change-synthesis.js';
import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = randomUUID();
const GM_PROPOSAL_REF = 'gmh_aaaaaaaaaaaa';
const EMITTED_AT_ISO = '2026-07-08T11:00:00.000Z';

/** The deterministic decline copy `commitProposedChangeRecovery('invalid')` emits. */
const INVALID_RECOVERY_TEXT =
  'The offer I had open is no longer valid. Tell me what to explore next.';

/** Strict GraphV3 fixture (must pass BOTH GraphV3 and the ingress parse). */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
    {
      id: 'fac-marketing',
      kind: 'factor',
      label: 'Marketing',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
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
  ],
};
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error(
      'Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues),
    );
  }
}
const MINIMAL_GRAPH = STRICT_GRAPH as unknown as Parameters<
  typeof computeAnalysisAffectingGraphHash
>[0];
const GRAPH_HASH = computeAnalysisAffectingGraphHash(MINIMAL_GRAPH) ?? 'h_unset';

const PROJECTION_MUTATING_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'opt-b', kind: 'option', label: 'Option B' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
    { id: 'dec-choice', kind: 'decision', label: 'Choose an option' },
    {
      id: 'fac-marketing',
      kind: 'factor',
      label: 'Marketing',
      category: 'controllable',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
  ],
  edges: [
    {
      from: 'dec-choice',
      to: 'opt-a',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: 'dec-choice',
      to: 'opt-b',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: 'opt-a',
      to: 'fac-marketing',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'opt-b',
      to: 'fac-marketing',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac-marketing',
      to: 'goal-g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

/** The canonical validated operation batch the hold captured (edit-pipeline shape). */
const HELD_OPERATIONS = [
  {
    op: 'update_node',
    path: 'fac-marketing',
    value: { description: 'Quarterly ad budget' },
  },
];

let pendingActionsForRead: readonly PendingAction[] = [];
const appendCalls: Array<Record<string, unknown>> = [];
let replayAppendedHistory = false;
let graphForRead: unknown = MINIMAL_GRAPH;

const canonicalReadinessControl = vi.hoisted(() => ({
  unavailableForCanonicalProjection: false,
  canonicalProjectionCalls: 0,
}));

const persistenceProjectionControl = vi.hoisted(() => ({
  promoteOptionsToReady: false,
  appliedCount: 0,
}));

vi.mock('../persisted-graph-projection.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../persisted-graph-projection.js')
  >();
  return {
    ...actual,
    projectGraphForPersistence: vi.fn((
      graph: unknown,
      context?: Parameters<typeof actual.projectGraphForPersistence>[1],
    ) => {
      const projected = actual.projectGraphForPersistence(graph, context);
      if (
        !persistenceProjectionControl.promoteOptionsToReady ||
        projected === null ||
        typeof projected !== 'object' ||
        Array.isArray(projected)
      ) {
        return projected;
      }
      const record = projected as Record<string, unknown>;
      const optionNodes = Array.isArray(record.nodes)
        ? record.nodes.filter(
            (node): node is Record<string, unknown> =>
              node !== null &&
              typeof node === 'object' &&
              !Array.isArray(node) &&
              (node as Record<string, unknown>).kind === 'option',
          )
        : [];
      if (optionNodes.length !== 2) return projected;
      persistenceProjectionControl.appliedCount += 1;
      return {
        ...record,
        options: optionNodes.map((node, index) => ({
          id: node.id,
          label: node.label,
          is_baseline: index === 0,
          interventions: {
            'fac-marketing': {
              value: index === 0 ? 0.1 : 0.3,
              source: 'user_specified',
              target_match: {
                node_id: 'fac-marketing',
                match_type: 'exact_id',
                confidence: 'high',
              },
            },
          },
        })),
      };
    }),
  };
});

vi.mock('../../orchestrator/tools/analysis-ready-helper.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../orchestrator/tools/analysis-ready-helper.js')
  >();
  return {
    ...actual,
    buildCanonicalAnalysisReadyFromGraph: vi.fn((graph: unknown) => {
      const record =
        graph !== null && typeof graph === 'object' && !Array.isArray(graph)
          ? (graph as Record<string, unknown>)
          : null;
      const isCanonicalProjection =
        record !== null &&
        Object.hasOwn(record, 'options') &&
        Object.hasOwn(record, 'goal_node_id') &&
        Object.hasOwn(record, 'goal_constraints');
      if (isCanonicalProjection) {
        canonicalReadinessControl.canonicalProjectionCalls += 1;
      }
      return canonicalReadinessControl.unavailableForCanonicalProjection &&
        isCanonicalProjection
        ? undefined
        : actual.buildCanonicalAnalysisReadyFromGraph(graph);
    }),
  };
});

function gmHeldPending(
  overrides: {
    graphHash?: string;
    withOperations?: boolean;
  } = {},
): PendingAction {
  const withOperations = overrides.withOperations ?? true;
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: GM_PROPOSAL_REF,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: GM_PROPOSAL_REF,
      inline_patch: {
        handler_id: 'graph_management_held_v1',
        apply_wiring: withOperations ? 'held_execute_v1' : 'decline_with_clarify_v0',
        candidate_id: 'cand-lane34',
        candidate_kind: 'update_node_field',
        mutation_class: 'tunable',
        blocker_code: 'TUNABLE_APPLY_HELD',
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
        ...(withOperations
          ? { operations: HELD_OPERATIONS, operations_count: HELD_OPERATIONS.length }
          : {}),
      },
      public_label: 'Continue with this change',
      public_message: 'Yes',
    },
    preconditions: { graph_hash: overrides.graphHash ?? GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: EMITTED_AT_ISO,
  };
}

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      return {
        id: `row-${appendCalls.length}`,
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    readRecent: async () =>
      replayAppendedHistory
        ? [...appendCalls].reverse().map((write, index) => ({
            id: `persisted-row-${index}`,
            scenario_id: String(write['scenario_id'] ?? SCENARIO_ID),
            user_id: null,
            turn_id: String(write['turn_id'] ?? `persisted-turn-${index}`),
            turn_class: String(write['turn_class'] ?? 'direct_answer'),
            handler_id: write['handler_id'] ?? null,
            request_hash: String(write['request_hash'] ?? `persisted-request-${index}`),
            response_emitted: true,
            llm_calls_used: Number(write['llm_calls_used'] ?? 0),
            duration_ms: Number(write['duration_ms'] ?? 1),
            created_at: new Date(Date.now() - index * 1_000).toISOString(),
            user_message:
              typeof write['userMessage'] === 'string' ? write['userMessage'] : null,
            assistant_message:
              typeof write['assistantMessage'] === 'string' ? write['assistantMessage'] : null,
          }))
        : [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => graphForRead,
    loadGraphAndBriefText: async () => ({ graph: graphForRead, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on a deterministic GM held resume');
      }),
  };
}

function textRoutingAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue({
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 20 } as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 20,
      }),
  };
}

function setGmMode(mode: string): void {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode);
  _resetConfigCache();
}

function lastAppend(): Record<string, unknown> {
  expect(appendCalls.length).toBeGreaterThan(0);
  return appendCalls[appendCalls.length - 1]!;
}

function expectCanonicalReceipt(
  response: { draft_graph?: unknown; graph_hash?: unknown },
  write: Record<string, unknown>,
) {
  const graph = write.graph as Record<string, unknown>;
  const receipt = response.draft_graph as Record<string, unknown>;
  for (const key of [
    'nodes',
    'edges',
    'options',
    'goal_node_id',
    'goal_constraints',
  ] as const) {
    expect(Object.hasOwn(graph, key), `append ${key}`).toBe(true);
    expect(Object.hasOwn(receipt, key), `receipt ${key}`).toBe(true);
    expect(receipt[key], key).toStrictEqual(graph[key]);
  }
  expect(receipt.node_count).toBe((receipt.nodes as unknown[]).length);
  expect(receipt.edge_count).toBe((receipt.edges as unknown[]).length);
  expect(response.graph_hash).toBe(
    computeAnalysisAffectingGraphHash(graph as never),
  );
}

beforeEach(() => {
  appendCalls.length = 0;
  pendingActionsForRead = [gmHeldPending()];
  replayAppendedHistory = false;
  graphForRead = MINIMAL_GRAPH;
  canonicalReadinessControl.unavailableForCanonicalProjection = false;
  canonicalReadinessControl.canonicalProjectionCalls = 0;
  persistenceProjectionControl.promoteOptionsToReady = false;
  persistenceProjectionControl.appliedCount = 0;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('GM held-execute — live mode applies the confirmed hold (RED on base)', () => {
  it('a ghost-selected confirmation persists and replays the durable mutation receipt, never the zero-selection refusal', async () => {
    setGmMode('live');
    const result = await runTurnExecutor(payload('yes'), 'req-gm-held-ghost-selection', {
      routingAdapter: throwingRoutingAdapter(),
      selectedElements: {
        node_ids: ['ghost-not-in-canonical-model'],
        edge_ids: [],
      },
    });

    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    const durableReceipt = String(write.assistantMessage ?? '');
    expect(durableReceipt).toContain('Confirmed:');
    expect(result.response.assistant_text).toBe(durableReceipt);
    expect(result.response.draft_graph).toBeDefined();
    expect(write.graph).toBeDefined();
    expect(write.pending_actions).toEqual([]);

    pendingActionsForRead = [];
    replayAppendedHistory = true;
    const followUpAdapter = textRoutingAdapter('Let us inspect another assumption.');
    await runTurnExecutor(payload('What else should I inspect?'), 'req-gm-held-follow-up', {
      routingAdapter: followUpAdapter,
    });

    expect(followUpAdapter.chatWithTools).toHaveBeenCalledTimes(1);
    const modelInput = String(
      followUpAdapter.chatWithTools.mock.calls[0]![0].messages[0]?.content ?? '',
    );
    expect(modelInput).toContain(durableReceipt);
    expect(modelInput).not.toContain('What you selected is not in the model I can see');
    expect(appendCalls[0]?.pending_actions).toEqual([]);
  });

  it('"yes" on a held pending with operations applies + persists the mutation with an edit_graph receipt fact', async () => {
    setGmMode('live');
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('yes'), 'req-gm-held-apply', {
      routingAdapter: adapter,
    });
    // Deterministic: zero LLM calls.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    // Exactly one commit, carrying the mutated graph.
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
    expect(graph).toBeDefined();
    const factor = graph!.nodes!.find((n) => n.id === 'fac-marketing');
    expect(factor).toBeDefined();
    expect(factor!.description).toBe('Quarterly ad budget');
    // DL-7: the persisted mutation carries a receipt fact.
    const facts = write.handler_facts as ReadonlyArray<Record<string, unknown>>;
    expect(facts).toHaveLength(1);
    expect(facts[0]!.fact_type).toBe('edit_graph');
    // Honest applied receipt — not the decline copy, no forbidden phrase.
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).not.toBe(INVALID_RECOVERY_TEXT);
    expect(assistant).not.toBe(PROPOSAL_SUPERSEDED_RESPONSE);
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // The consumed pending never re-persists (no zombie confirm chip).
    const persistedPendings = (write.pending_actions ?? []) as ReadonlyArray<{
      chip_id?: string;
    }>;
    expect(persistedPendings.some((p) => p.chip_id === GM_PROPOSAL_REF)).toBe(false);
  });

  it('F2-CEE: the applied-receipt response carries draft_graph with the post-mutation node (wire projection of the applied graph)', async () => {
    setGmMode('live');
    const result = await runTurnExecutor(payload('yes'), 'req-gm-held-draft-graph', {
      routingAdapter: throwingRoutingAdapter(),
    });
    // The commit persisted the mutation (pinned by the sibling test); the
    // WIRE response must carry the same applied graph via the existing
    // `draft_graph` field — the UI's only inline-graph ingestion path
    // (it never re-reads scenarios.graph on an edit turn).
    const dg = result.response.draft_graph;
    expect(dg).toBeDefined();
    const factor = (dg!.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'fac-marketing',
    );
    expect(factor).toBeDefined();
    expect(factor!.description).toBe('Quarterly ad budget');
    expect(dg!.node_count).toBe(dg!.nodes.length);
    expect(dg!.edge_count).toBe(dg!.edges.length);
    expectCanonicalReceipt(result.response, lastAppend());
    expect(result.analysisReady).toBeDefined();
  });

  it('projection-mutating held apply persists and returns one canonical ready response, chip and pending', async () => {
    setGmMode('live');
    graphForRead = PROJECTION_MUTATING_GRAPH;
    pendingActionsForRead = [gmHeldPending({
      graphHash:
        computeAnalysisAffectingGraphHash(PROJECTION_MUTATING_GRAPH as never) ??
        'h_projection_unset',
    })];
    persistenceProjectionControl.promoteOptionsToReady = true;

    const result = await runTurnExecutor(
      payload('yes'),
      'req-gm-held-projection-mutates-readiness',
      { routingAdapter: throwingRoutingAdapter() },
    );

    expect(appendCalls).toHaveLength(1);
    expect(persistenceProjectionControl.appliedCount).toBe(1);
    expect(canonicalReadinessControl.canonicalProjectionCalls).toBe(1);
    const write = lastAppend();
    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.analysisReady?.status).toBe('ready');
    expect(result.response.assistant_text).toBe(write.assistantMessage);
    expect(result.response.assistant_text).not.toContain(
      'does not have effect values yet',
    );
    expect(result.response.suggested_actions).toEqual([
      expect.objectContaining({
        id: 'chip_action_rerun_analysis_gm_held_applied',
        action_type: 'run_analysis',
      }),
    ]);
    expect(write.pending_actions).toEqual([
      expect.objectContaining({
        chip_id: 'chip_action_rerun_analysis_gm_held_applied',
        action: { kind: 'run_analysis' },
      }),
    ]);
    expectCanonicalReceipt(result.response, write);
    expect((write.graph as Record<string, unknown>).options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'opt-a',
          interventions: expect.objectContaining({ 'fac-marketing': expect.any(Object) }),
        }),
        expect.objectContaining({
          id: 'opt-b',
          interventions: expect.objectContaining({ 'fac-marketing': expect.any(Object) }),
        }),
      ]),
    );
  });

  it('fails closed before append when held-single projected canonical readiness is unavailable', async () => {
    setGmMode('live');
    canonicalReadinessControl.unavailableForCanonicalProjection = true;
    const result = await runTurnExecutor(
      payload('yes'),
      'req-gm-held-status-unavailable',
      { routingAdapter: throwingRoutingAdapter() },
    );

    expect(appendCalls).toHaveLength(0);
    expect(result.telemetry.commit_performed).toBe(false);
    expect(result.response.draft_graph).toBeUndefined();
    expect(result.response.graph_hash).toBeUndefined();
    const errorBlock = (
      result.response.blocks as Array<{ type: string; error_code?: string }>
    ).find((block) => block.type === 'error');
    expect(errorBlock?.error_code).toBe('INTERNAL_ERROR');
  });

  it('F2-CEE negative: a declined resume (hash divergence) ships NO draft_graph — nothing was applied', async () => {
    setGmMode('live');
    pendingActionsForRead = [gmHeldPending({ graphHash: 'h_divergent_9999' })];
    const result = await runTurnExecutor(payload('yes'), 'req-gm-held-superseded-wire', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect('draft_graph' in result.response).toBe(false);
  });

  it('hash divergence at resume → superseded recovery, NO graph commit', async () => {
    setGmMode('live');
    pendingActionsForRead = [gmHeldPending({ graphHash: 'h_divergent_9999' })];
    await runTurnExecutor(payload('yes'), 'req-gm-held-superseded', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    expect(write.graph).toBeUndefined();
    expect((write.handler_facts as unknown[]) ?? []).toHaveLength(0);
    expect(String(write.assistantMessage ?? '')).toBe(PROPOSAL_SUPERSEDED_RESPONSE);
  });

  it('legacy held pending (no operations payload) → decline-with-clarify, NO graph commit', async () => {
    setGmMode('live');
    pendingActionsForRead = [gmHeldPending({ withOperations: false })];
    await runTurnExecutor(payload('yes'), 'req-gm-held-legacy', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    expect(write.graph).toBeUndefined();
    expect(String(write.assistantMessage ?? '')).toBe(INVALID_RECOVERY_TEXT);
  });
});

describe('GM held-execute — flag-gated inertness (must pass at base AND after wiring)', () => {
  it.each(['shadow', 'off'])(
    'mode=%s: "yes" on an executable GM held pending stays decline-with-clarify, NO graph commit',
    async (mode) => {
      setGmMode(mode);
      await runTurnExecutor(payload('yes'), `req-gm-held-${mode}`, {
        routingAdapter: throwingRoutingAdapter(),
      });
      expect(appendCalls).toHaveLength(1);
      const write = lastAppend();
      expect(write.graph).toBeUndefined();
      expect((write.handler_facts as unknown[]) ?? []).toHaveLength(0);
      expect(String(write.assistantMessage ?? '')).toBe(INVALID_RECOVERY_TEXT);
    },
  );
});
