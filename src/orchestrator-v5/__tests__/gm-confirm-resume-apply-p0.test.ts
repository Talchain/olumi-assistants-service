/**
 * P0 — a confirmed graph-management hold must APPLY (deployed Render logs,
 * 2026-08-16, scenario 0f9c4469-8aae-4f59-8e9d-27076e1f07ce).
 *
 * WHAT THE LOGS SHOWED. An option deletion produced 5 operations
 * (`remove_node` x1, `remove_edge` x4), all held `REMOVE_UNCONFIRMED` with a
 * confirm chip (`gmh_0794fc0c5d85`). The user clicked confirm; the resume
 * re-refereed under `dispatch_path: 'gm_held_resume'`, every candidate logged
 * held AGAIN with the identical blocker, and the user's change never landed.
 *
 * WHAT THE MECHANISM ACTUALLY IS (derived at the bytes, this tip). The
 * re-hold telemetry is NOT the blocker: `executeGmHeldResume` accepts a
 * governing `held` verdict by design ("the confirm lifts ONLY the hold"), and
 * a well-ordered confirmed batch applies. The failure is one rung LOWER, in
 * the APPLY:
 *
 *   `applyRemoveNode` CASCADE-REMOVES every edge incident to the node it
 *   removes (patch-applier.ts). So in a delete batch that removes the node
 *   BEFORE its incident edges, each following `remove_edge` targets an edge
 *   the cascade has already taken out, and `applyRemoveEdge` throws
 *   `EDGE_NOT_FOUND`. The confirmed batch resolves to `apply_failed`, and the
 *   turn declines.
 *
 * WHY THE DECLINE IS WORSE THAN THE FAILURE. The decline routes through the
 * generic `commitProposedChangeRecovery('invalid')`, which (a) tells the user
 * "The offer I had open is no longer valid" — FALSE, the offer was valid and
 * the graph had not moved (the hash precondition passed to get here) — (b)
 * offers no next step, and (c) commits WITHOUT consuming the pending, so the
 * confirm chip survives and every subsequent click reproduces the identical
 * failure. The user confirms, is told the offer expired, sees the change come
 * back, and can never get out of it.
 *
 * THE DISCRIMINATING PAIR (CLAUDE.md trap 19 / 22b — one predicate guarding
 * two opposite harms needs a twin in each direction):
 *   (a) a CONFIRMATION-class hold (`REMOVE_UNCONFIRMED`) whose batch orders
 *       the node removal first → APPLIES.            RED at pristine.
 *   (b) an INTEGRITY-class batch (a yes can never override a referee
 *       rejection) → STILL REFUSED, nothing persisted.  GREEN before AND
 *       after — this is what stops the fix becoming a blanket bypass.
 *   (b2) a genuine APPLY-LEVEL failure that is not a cascade artefact (two
 *       removals of the same node) → STILL DECLINES. GREEN before AND after —
 *       this stops the fix swallowing apply errors wholesale.
 *
 * ⚠ SCOPE OF THIS FILE, stated honestly. A route-level turn can only show
 * "nothing persisted", which the REFEREE arm and the APPLIER arm both produce.
 * So this file CANNOT witness which rung a batch died at, and no case here may
 * claim to. Rung discrimination — including the phantom-edge coupling the
 * elision's soundness rests on — is pinned in
 * `graph-management/__tests__/cascade-removes.test.ts`. What this file pins is
 * the user-visible outcome: what persisted, what the user was told, and which
 * chips survived.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { findForbiddenPhraseHit } from '../compose/forbidden-user-facing-phrases.js';
import { GM_HELD_APPLY_FAILED_ASSISTANT_TEXT } from '../handlers/gm-held-execute.js';
import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = randomUUID();
/** The production confirm-chip handle, kept as the identity this test binds to. */
const GM_PROPOSAL_REF = 'gmh_0794fc0c5d85';

/** The exact copy the generic 'invalid' recovery emits — the lie under test. */
const INVALID_RECOVERY_TEXT =
  'The offer I had open is no longer valid. Tell me what to explore next.';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive' as const,
  };
}

/** Five options — mirrors the log's `base_options_count: 5`. */
const STRICT_GRAPH = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Option A' },
    { id: 'opt-b', kind: 'option', label: 'Option B' },
    { id: 'opt-c', kind: 'option', label: 'Option C' },
    { id: 'opt-d', kind: 'option', label: 'Option D' },
    { id: 'opt-e', kind: 'option', label: 'Option E' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
    { id: 'fac-1', kind: 'factor', label: 'Factor One' },
    { id: 'fac-2', kind: 'factor', label: 'Factor Two' },
  ],
  edges: [
    edge('opt-a', 'fac-1'),
    edge('opt-b', 'fac-1'),
    edge('opt-c', 'fac-1'),
    edge('opt-d', 'fac-1'),
    edge('opt-e', 'fac-1'),
    edge('opt-e', 'fac-2'),
    edge('fac-1', 'goal-g'),
    edge('fac-2', 'goal-g'),
  ],
};
{
  const parsed = GraphV3.safeParse(STRICT_GRAPH);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3: ' + JSON.stringify(parsed.error.issues));
  }
}
const MINIMAL_GRAPH = STRICT_GRAPH as unknown as Parameters<
  typeof computeAnalysisAffectingGraphHash
>[0];
const GRAPH_HASH = computeAnalysisAffectingGraphHash(MINIMAL_GRAPH) ?? 'h_unset';

/**
 * The production batch shape: the node removal leads, its incident edge
 * removals follow. This is what `applyRemoveNode`'s cascade makes fatal.
 */
const REMOVE_OPS_NODE_FIRST = [
  { op: 'remove_node', path: 'opt-e' },
  { op: 'remove_edge', path: 'opt-e::fac-1' },
  { op: 'remove_edge', path: 'opt-e::fac-2' },
];

/** (b) A yes must never override an integrity rejection: 'opt-zz' does not exist. */
const REMOVE_OPS_MISSING_ENTITY = [{ op: 'remove_node', path: 'opt-zz' }];

/**
 * (b2) A genuine APPLY-LEVEL failure that is NOT a cascade artefact.
 *
 * Two removals of the SAME node. The referee passes both — its batch view
 * deliberately does not subtract removes — so this reaches the APPLIER, where
 * the second throws NODE_NOT_FOUND. It is a remove_NODE, so the elision never
 * touches it.
 *
 * ⚠ An earlier version of this fixture used a phantom EDGE
 * (`remove_edge opt-a::fac-2`). That was VACUOUS for this purpose: referee R3
 * rejects a phantom edge, so the batch died at the referee and the case merely
 * duplicated (b). Proven by mutant — blanket elision left this file fully
 * green. Which RUNG a batch terminates at is not observable from here (both
 * arms produce "nothing persisted"); it is pinned in
 * `graph-management/__tests__/cascade-removes.test.ts`
 * ("each batch terminates at the rung it should"). What THIS case pins is the
 * route-level DECLINE BEHAVIOUR on an apply-level failure: honest copy, no
 * graph, no facts, and the spent chip retired.
 */
const REMOVE_OPS_APPLY_LEVEL_FAILURE = [
  { op: 'remove_node', path: 'opt-e' },
  { op: 'remove_node', path: 'opt-e' },
];

/**
 * The same apply-level failure against a DIFFERENT node, for the partial
 * consent-all case. It must target something the sibling hold does NOT remove:
 * if it named `opt-e`, the sibling's successful removal would make this batch
 * structurally invalid against the post-mutation graph, and the commit's
 * hold-threading would lapse its chip for reasons unrelated to this fix —
 * a green assertion proving nothing (CLAUDE.md trap 13b).
 */
const REMOVE_OPS_APPLY_LEVEL_FAILURE_OPT_D = [
  { op: 'remove_node', path: 'opt-d' },
  { op: 'remove_node', path: 'opt-d' },
];

let pendingActionsForRead: readonly PendingAction[] = [];
const appendCalls: Array<Record<string, unknown>> = [];

function gmHeldPending(
  operations: unknown[],
  graphHash: string = GRAPH_HASH,
  chipId: string = GM_PROPOSAL_REF,
  label: string = 'Remove Option E',
): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: chipId,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: chipId,
      inline_patch: {
        handler_id: 'graph_management_held_v1',
        apply_wiring: 'held_execute_v1',
        candidate_id: 'cand-remove-opt-e',
        candidate_kind: 'remove_node',
        mutation_class: 'structural',
        blocker_code: 'REMOVE_UNCONFIRMED',
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
        operations,
        operations_count: operations.length,
      },
      public_label: label,
      public_message: 'Yes, remove Option E.',
    },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 4,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-16T11:57:08.000Z',
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
      .fn<(a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on a deterministic GM held resume');
      }),
  };
}

function lastAppend(): Record<string, unknown> {
  expect(appendCalls.length).toBeGreaterThan(0);
  return appendCalls[appendCalls.length - 1]!;
}

function committedGraph(): { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> } | undefined {
  return lastAppend().graph as
    | { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> }
    | undefined;
}

beforeEach(() => {
  appendCalls.length = 0;
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  _resetConfigCache();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('P0 (a) — a confirmed REMOVE hold applies even when the node removal leads', () => {
  it('persists the deletion: Option E and BOTH its incident edges are gone', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_NODE_FIRST)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-remove-node-first', {
      routingAdapter: throwingRoutingAdapter(),
    });

    expect(appendCalls).toHaveLength(1);
    const graph = committedGraph();
    // The commit MUST carry a graph — a decline commits none.
    expect(graph).toBeDefined();
    // Bind by identity (trap 19): the exact node the user confirmed removing.
    expect(graph!.nodes.some((n) => n.id === 'opt-e')).toBe(false);
    // The four options the user did NOT touch survive.
    for (const id of ['opt-a', 'opt-b', 'opt-c', 'opt-d']) {
      expect(graph!.nodes.some((n) => n.id === id)).toBe(true);
    }
    // Both incident edges are gone, and unrelated edges are untouched.
    expect(graph!.edges.some((e) => e.from === 'opt-e')).toBe(false);
    expect(graph!.edges.some((e) => e.from === 'opt-a' && e.to === 'fac-1')).toBe(true);
    expect(graph!.edges.some((e) => e.from === 'fac-1' && e.to === 'goal-g')).toBe(true);
  });

  it('ships an honest applied receipt, never the "offer is no longer valid" lie', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_NODE_FIRST)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-remove-receipt', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const assistant = String(lastAppend().assistantMessage ?? '');
    expect(assistant).not.toBe(INVALID_RECOVERY_TEXT);
    expect(assistant).toContain('Confirmed:');
    expect(assistant).toContain('Option E');
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
  });

  it('consumes the confirm chip, so the user is never looped on a spent confirmation', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_NODE_FIRST)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-remove-consumed', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const persisted = (lastAppend().pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === GM_PROPOSAL_REF)).toBe(false);
  });

  it('DL-7: the persisted mutation carries an edit_graph receipt fact', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_NODE_FIRST)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-remove-fact', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const facts = (lastAppend().handler_facts ?? []) as ReadonlyArray<Record<string, unknown>>;
    expect(facts).toHaveLength(1);
    expect(facts[0]!.fact_type).toBe('edit_graph');
  });
});

describe('P0 (b) — the confirm must NOT become a blanket bypass', () => {
  it('a yes can never override an integrity rejection: a missing entity still refuses, nothing persisted', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_MISSING_ENTITY)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-integrity-reject', {
      routingAdapter: throwingRoutingAdapter(),
    });

    // The turn still commits (a recovery), but it must carry NO graph.
    expect(committedGraph()).toBeUndefined();
    const facts = (lastAppend().handler_facts ?? []) as ReadonlyArray<unknown>;
    expect(facts).toHaveLength(0);
  });

  it('b2: a genuine apply-level failure (not a cascade artefact) still declines, nothing persisted', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-unappliable-edge', {
      routingAdapter: throwingRoutingAdapter(),
    });

    expect(committedGraph()).toBeUndefined();
    const facts = (lastAppend().handler_facts ?? []) as ReadonlyArray<unknown>;
    expect(facts).toHaveLength(0);
  });

  it('an un-appliable confirm declines HONESTLY and retires the spent chip, never the loop', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE)];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-honest-decline', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const write = lastAppend();
    const assistant = String(write.assistantMessage ?? '');
    // The lie is gone: the offer was valid and the graph had not moved.
    expect(assistant).not.toBe(INVALID_RECOVERY_TEXT);
    expect(assistant).toBe(GM_HELD_APPLY_FAILED_ASSISTANT_TEXT);
    // It states the model is unchanged and names a usable next step.
    expect(assistant).toContain('nothing has changed');
    expect(assistant).toContain('Tell me the change again');
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // Nothing persisted.
    expect(committedGraph()).toBeUndefined();
    // The spent confirmation is retired — a chip that cannot do what it says
    // must not stay on offer (this is what produced the infinite loop).
    const persisted = (write.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === GM_PROPOSAL_REF)).toBe(false);
  });

  it('a graph-hash divergence at resume still supersedes, nothing persisted', async () => {
    pendingActionsForRead = [gmHeldPending(REMOVE_OPS_NODE_FIRST, 'h_diverged_from_current')];

    await runTurnExecutor(payload('Yes, remove Option E.'), 'req-p0-hash-diverged', {
      routingAdapter: throwingRoutingAdapter(),
    });

    expect(committedGraph()).toBeUndefined();
  });
});

/**
 * P0 (c) — THE SAME LOOP ON THE CONSENT-ALL ROUTE.
 *
 * `commitGmHeldResumeAll` handles "all of them" / "yes to all" / "apply both"
 * when two or more consents are live (`routing/deterministic-short-confirm.ts`,
 * CONSENT_RESOLVE_ALL_PATTERN). Its all-declined branch returned the SAME
 * generic `commitProposedChangeRecovery('invalid')` the single-resume path did
 * — so the identical deterministic loop survived on this route: the false
 * "offer is no longer valid" sentence, and EVERY chip left live to reproduce
 * the failure on the next click.
 *
 * The per-step decline had the mirror gap: a hold that was ATTEMPTED and
 * declined kept its chip, so a partially-successful "all of them" still left a
 * spent confirmation on offer. A hold never attempted (the chain fails closed
 * after a mid-chain hash-derivation failure) legitimately keeps its chip — it
 * has not been spent, and that asymmetry is the point.
 */
describe('P0 (c) — consent-all must not reproduce the loop', () => {
  const CHIP_A = 'gmh_aaaaaaaaaaaa';
  const CHIP_B = 'gmh_bbbbbbbbbbbb';

  it('all holds fail at apply → honest copy, nothing persisted, BOTH spent chips retired', async () => {
    pendingActionsForRead = [
      gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE, GRAPH_HASH, CHIP_A, 'Remove Option E'),
      gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE, GRAPH_HASH, CHIP_B, 'Remove Option D'),
    ];

    await runTurnExecutor(payload('Yes, all of them.'), 'req-p0-consent-all-declined', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const write = lastAppend();
    const assistant = String(write.assistantMessage ?? '');
    // The lie must be gone on this route too.
    expect(assistant).not.toBe(INVALID_RECOVERY_TEXT);
    expect(assistant).toBe(GM_HELD_APPLY_FAILED_ASSISTANT_TEXT);
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // Nothing persisted.
    expect(committedGraph()).toBeUndefined();
    expect((write.handler_facts ?? []) as ReadonlyArray<unknown>).toHaveLength(0);
    // Both spent confirmations retired — neither may survive to loop.
    const persisted = (write.pending_actions ?? []) as ReadonlyArray<{ chip_id?: string }>;
    expect(persisted.some((p) => p.chip_id === CHIP_A)).toBe(false);
    expect(persisted.some((p) => p.chip_id === CHIP_B)).toBe(false);
  });

  /**
   * ⚠ This case deliberately does NOT assert chip survival. `commitGmHeldResumeAll`'s
   * applied path commits WITHOUT `priorPendingActions`, so that mutating commit
   * wipes every live hold regardless of this fix — `pending_actions` is `[]`
   * both before and after, and a chip assertion here would pass vacuously
   * (CLAUDE.md trap 13b). Chip retirement IS discriminating on the
   * all-declined case above, whose recovery commit does carry priors forward.
   * What this case pins is the half that is observable: the applied change
   * really landed, and the user is TOLD about the one that did not.
   */
  it('a partial "all of them" applies what it can and names what it could not', async () => {
    pendingActionsForRead = [
      // Applies (the P0 cascade batch, now fixed).
      gmHeldPending(REMOVE_OPS_NODE_FIRST, GRAPH_HASH, CHIP_A, 'Remove Option E'),
      // Attempted and declined at the applier.
      gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE_OPT_D, GRAPH_HASH, CHIP_B, 'Remove Option D'),
    ];

    await runTurnExecutor(payload('Yes, all of them.'), 'req-p0-consent-all-partial', {
      routingAdapter: throwingRoutingAdapter(),
    });

    const write = lastAppend();
    // The applied half really landed.
    const graph = committedGraph();
    expect(graph).toBeDefined();
    expect(graph!.nodes.some((n) => n.id === 'opt-e')).toBe(false);
    // Neither chip may survive: one was applied, the other was attempted and
    // declined. Both are spent.
    // The declined sibling is named honestly, never silently dropped.
    const assistant = String(write.assistantMessage ?? '');
    expect(assistant).toContain('Remove Option D');
    expect(assistant).toContain("I couldn't take");
    expect(findForbiddenPhraseHit(assistant)).toBeNull();
    // Only the successful half's receipt fact is committed.
    expect((write.handler_facts ?? []) as ReadonlyArray<unknown>).toHaveLength(1);
  });

  /**
   * ⭐ THE ASYMMETRY, pinned so it cannot be flattened into "declines always
   * retire" (which would destroy a still-actionable consent) or "declines
   * never retire" (which re-opens the loop).
   *
   * all-declined  → nothing applied, graph UNCHANGED, decline deterministic
   *                 → retire the spent chips.
   * partial apply → graph MOVED, decline judged against an intermediate graph
   *                 that no longer exists → the pending lifecycle re-assesses
   *                 it against the FINAL graph. Retiring here would pre-empt
   *                 that, so it must NOT happen. (Owned by
   *                 consent-clarity-route-level.test.ts, whose mid-chain
   *                 decline case asserts the chip SURVIVES.)
   */
  it('retires spent chips ONLY when nothing applied, never on a partial apply', async () => {
    // All declined → chips retired.
    pendingActionsForRead = [
      gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE, GRAPH_HASH, CHIP_A, 'Remove Option E'),
      gmHeldPending(REMOVE_OPS_APPLY_LEVEL_FAILURE_OPT_D, GRAPH_HASH, CHIP_B, 'Remove Option D'),
    ];
    await runTurnExecutor(payload('Yes, all of them.'), 'req-p0-asym-all-declined', {
      routingAdapter: throwingRoutingAdapter(),
    });
    const allDeclined = (lastAppend().pending_actions ?? []) as ReadonlyArray<{
      chip_id?: string;
    }>;
    expect(allDeclined.some((p) => p.chip_id === CHIP_A)).toBe(false);
    expect(allDeclined.some((p) => p.chip_id === CHIP_B)).toBe(false);
    // And nothing was persisted on that turn.
    expect(committedGraph()).toBeUndefined();
  });
});
