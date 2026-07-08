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
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => MINIMAL_GRAPH,
    loadGraphAndBriefText: async () => ({ graph: MINIMAL_GRAPH, briefText: null }),
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

function setGmMode(mode: string): void {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode);
  _resetConfigCache();
}

function lastAppend(): Record<string, unknown> {
  expect(appendCalls.length).toBeGreaterThan(0);
  return appendCalls[appendCalls.length - 1]!;
}

beforeEach(() => {
  appendCalls.length = 0;
  pendingActionsForRead = [gmHeldPending()];
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('GM held-execute — live mode applies the confirmed hold (RED on base)', () => {
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
