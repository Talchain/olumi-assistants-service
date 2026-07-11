/**
 * CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — route-level fixtures
 * through TurnExecutor.
 *
 * Doctrine under test:
 *  (a) every consent receipt names EXACTLY what was confirmed — never a
 *      bare "Done";
 *  (b) a bare confirmation arriving while MULTIPLE consent-expecting
 *      pendings are live lists ALL of them (numbered, short labels) with
 *      per-item chips plus "All of them" and "None" — NO mutation on the
 *      listing turn; a follow-up chip pick / ordinal / "all" resolves.
 *
 * RED-first: on the pre-amendment base a bare "yes" with two live consent
 * holds silently resolves the most recently emitted one (V5 P0.2
 * most-recent-wins within the consent class), the GM applied receipt is
 * the unnamed "Done. I have applied the change you confirmed.", and
 * "all of them" falls through to the LLM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { findForbiddenPhraseHit } from '../compose/forbidden-user-facing-phrases.js';
import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = randomUUID();
const HOLD_A_REF = 'gmh_aaaaaaaaaaaa';
const HOLD_B_REF = 'gmh_bbbbbbbbbbbb';
const GENERIC_REF = 'prop_cccccccccccc';
const EMITTED_AT_ISO = '2026-07-11T11:00:00.000Z';

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

function gmHeldPending(args: {
  ref: string;
  nodeId: string;
  description: string;
  label: string;
  message: string;
  emittedAtIso?: string;
}): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: args.ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: args.ref,
      inline_patch: {
        handler_id: 'graph_management_held_v1',
        apply_wiring: 'held_execute_v1',
        candidate_id: `cand-${args.ref}`,
        candidate_kind: 'update_node_field',
        mutation_class: 'tunable',
        blocker_code: 'TUNABLE_APPLY_HELD',
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
        operations: [
          {
            op: 'update_node',
            path: args.nodeId,
            value: { description: args.description },
          },
        ],
        operations_count: 1,
      },
      public_label: args.label,
      public_message: args.message,
    },
    preconditions: { graph_hash: GRAPH_HASH },
    expires_at_turn_count: 4,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: args.emittedAtIso ?? EMITTED_AT_ISO,
  };
}

function holdA(): PendingAction {
  return gmHeldPending({
    ref: HOLD_A_REF,
    nodeId: 'fac-marketing',
    description: 'Quarterly ad budget',
    label: "Update 'Marketing'",
    message: "Yes, update 'Marketing'.",
    emittedAtIso: '2026-07-11T11:00:00.000Z',
  });
}

function holdB(): PendingAction {
  return gmHeldPending({
    ref: HOLD_B_REF,
    nodeId: 'goal-g',
    description: 'North star statement',
    label: "Update 'Goal'",
    message: "Yes, update 'Goal'.",
    emittedAtIso: '2026-07-11T11:01:00.000Z',
  });
}

function genericProposal(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: GENERIC_REF,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: GENERIC_REF,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: 42 },
        target_entity_ids: ['fac-marketing'],
      },
      public_label: 'Test Marketing at 42',
      public_message: 'Check whether Marketing at 42 changes the result.',
    },
    preconditions: { graph_hash: GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-11T11:02:00.000Z',
  };
}

let pendingActionsForRead: readonly PendingAction[] = [];
const appendCalls: Array<Record<string, unknown>> = [];

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
        throw new Error('routing adapter must NOT be called on a deterministic consent turn');
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
  pendingActionsForRead = [];
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('consent-clarity — multi live consents + bare confirm lists, never mutates', () => {
  it('"yes" with two live consent holds → numbered list naming both, chips incl. All/None, NO mutation', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA(), holdB()];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('yes'), 'req-consent-list', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    // NO mutation on the listing turn.
    expect(write.graph).toBeUndefined();
    expect((write.handler_facts as unknown[]) ?? []).toHaveLength(0);
    // The list names both consents, numbered, with the resolution options.
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).toContain("1) Update 'Marketing'");
    expect(assistant).toContain("2) Update 'Goal'");
    expect(assistant.toLowerCase()).toContain('all of them');
    expect(assistant.toLowerCase()).toContain('none');
    expect(assistant).not.toContain('—');
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // Chips: one per candidate + All + None.
    const chips = (result.response.suggested_actions ?? []) as ReadonlyArray<{
      id: string;
      label: string;
    }>;
    expect(chips.some((c) => c.id === HOLD_A_REF)).toBe(true);
    expect(chips.some((c) => c.id === HOLD_B_REF)).toBe(true);
    expect(chips.some((c) => c.label === 'All of them')).toBe(true);
    expect(chips.some((c) => c.label === 'None')).toBe(true);
    // Both consents re-persisted so the follow-up pick has live offers.
    const persisted = (write.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === HOLD_A_REF)).toBe(true);
    expect(persisted.some((p) => p.chip_id === HOLD_B_REF)).toBe(true);
  });

  it('mixed consent kinds (GM hold + generic proposal) + "yes" → the SAME list posture, NO mutation', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA(), genericProposal()];
    await runTurnExecutor(payload('yes'), 'req-consent-list-mixed', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    expect(write.graph).toBeUndefined();
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).toContain("1) Update 'Marketing'");
    expect(assistant).toContain('2) Test Marketing at 42');
  });
});

describe('consent-clarity — follow-up picks resolve the RIGHT consent', () => {
  it('chip pick (the second hold\'s message) applies hold B, not hold A; hold A survives', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA(), holdB()];
    await runTurnExecutor(payload("Yes, update 'Goal'."), 'req-consent-pick-b', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
    expect(graph).toBeDefined();
    const goal = graph!.nodes!.find((n) => n.id === 'goal-g');
    expect(goal!.description).toBe('North star statement');
    // Hold A's edit must NOT have been applied.
    const factor = graph!.nodes!.find((n) => n.id === 'fac-marketing');
    expect(factor!.description).toBeUndefined();
    // The receipt names what was confirmed.
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).toContain("'Goal'");
    // Hold B consumed; hold A carried forward (still awaiting consent).
    const persisted = (write.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === HOLD_B_REF)).toBe(false);
    expect(persisted.some((p) => p.chip_id === HOLD_A_REF)).toBe(true);
  });

  it('ordinal pick ("the first one") applies hold A only', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA(), holdB()];
    await runTurnExecutor(payload('the first one'), 'req-consent-pick-1', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
    expect(graph).toBeDefined();
    const factor = graph!.nodes!.find((n) => n.id === 'fac-marketing');
    expect(factor!.description).toBe('Quarterly ad budget');
    const goal = graph!.nodes!.find((n) => n.id === 'goal-g');
    expect(goal!.description).toBeUndefined();
  });
});

describe('consent-clarity — "all of them"', () => {
  it('two GM holds + "all of them" (live mode) → both applied in ONE commit, receipt names both, both consumed', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA(), holdB()];
    const adapter = throwingRoutingAdapter();
    await runTurnExecutor(payload('all of them'), 'req-consent-all-gm', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
    expect(graph).toBeDefined();
    expect(graph!.nodes!.find((n) => n.id === 'fac-marketing')!.description).toBe(
      'Quarterly ad budget',
    );
    expect(graph!.nodes!.find((n) => n.id === 'goal-g')!.description).toBe(
      'North star statement',
    );
    // Receipt fact(s) for the applied mutations (DL-7).
    const facts = (write.handler_facts ?? []) as ReadonlyArray<Record<string, unknown>>;
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.every((f) => f.fact_type === 'edit_graph')).toBe(true);
    // Named receipt for BOTH confirmations — never a bare "Done".
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).toContain("'Marketing'");
    expect(assistant).toContain("'Goal'");
    expect(assistant).not.toBe(
      'Done. I have applied the change you confirmed. Run the analysis again ' +
        'when you are ready to see how it plays out.',
    );
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // Both consumed — no zombie confirm chips.
    const persisted = (write.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === HOLD_A_REF)).toBe(false);
    expect(persisted.some((p) => p.chip_id === HOLD_B_REF)).toBe(false);
  });

  it('mixed set (GM hold + generic proposal) + "all of them" → NO mutation; honest one-at-a-time list', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA(), genericProposal()];
    await runTurnExecutor(payload('all of them'), 'req-consent-all-mixed', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    expect(write.graph).toBeUndefined();
    expect((write.handler_facts as unknown[]) ?? []).toHaveLength(0);
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).toContain("1) Update 'Marketing'");
    expect(assistant).toContain('2) Test Marketing at 42');
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // Consents re-persisted so the follow-up pick still has live offers.
    const persisted = (write.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === HOLD_A_REF)).toBe(true);
    expect(persisted.some((p) => p.chip_id === GENERIC_REF)).toBe(true);
  });
});

describe('consent-clarity — single consent receipt names what was confirmed', () => {
  it('"yes" on ONE live GM hold applies it and the receipt names the change (never a bare "Done")', async () => {
    setGmMode('live');
    pendingActionsForRead = [holdA()];
    await runTurnExecutor(payload('yes'), 'req-consent-single-receipt', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    const write = lastAppend();
    const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
    expect(graph).toBeDefined();
    expect(graph!.nodes!.find((n) => n.id === 'fac-marketing')!.description).toBe(
      'Quarterly ad budget',
    );
    const assistant = String(write.assistantMessage ?? '');
    // Names the confirmed change — the fixture pin for doctrine (a).
    expect(assistant).toContain("'Marketing'");
    expect(assistant).not.toBe(
      'Done. I have applied the change you confirmed. Run the analysis again ' +
        'when you are ready to see how it plays out.',
    );
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
  });
});
