/**
 * FINAL-SWEEP (pre-handover) — commitTurn floor: the held-apply clobber class.
 *
 * The Codex/Fable boundary hunt found that the F2 degraded-read guard covers
 * only the graph-write CHOKEPOINT (turn-executor.ts :8239). The GM held-execute
 * / consent-apply writers (:2119, :2342) return via `finalizeRun()` BEFORE the
 * chokepoint, so `resolvedCanonicalGraphForCommit` is unset there. On a DEGRADED
 * canonical read `context.persistedGraph` is null, so commitTurn derived the CAS
 * expected base from null → `{null,null}` → category `no_expected` → the RPC
 * receives a NULL expected base → an UNCONDITIONAL write that SILENTLY CLOBBERS a
 * concurrently-advanced server graph. The adopt suite never drove held-execute
 * under a degraded read (all its rows exercise the chokepoint), so the suite was
 * green over the clobber.
 *
 * The fix closes the class AT THE SHARED FLOOR (commitTurn): a graph write that
 * arrives unresolved on a degraded read (with CAS meant to protect) strict-rereads
 * the canonical graph and FAILS CLOSED when the reread proves an existing server
 * model (or the reread itself fails), proceeding only when the reread proves the
 * graph ABSENT (a genuine first-write, nothing to clobber).
 *
 * RED-first: the "fail closed" cases go RED on the pre-fix floor (which writes a
 * graph, `appendCalls` length 1 with `graph` defined — the clobber). Mutation-
 * checked in a throwaway worktree by reverting the floor hunk.
 *
 * The REFUTE guards: (C) a degraded read whose reread proves ABSENT must still
 * commit the first-write (the fix must not over-restrict); (D) a HEALTHY read
 * held-apply is entirely unaffected (the branch is inert off a degraded read).
 */

import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs,ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';

import { _resetConfigCache } from '../../config/index.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { SupabaseSessionStore } from '../session/supabase-store.js';
import { SessionLRUCache } from '../session/cache.js';
import { TURN_FENCE_RPC, TURN_FENCE_ATOMIC_SQLSTATE } from '../session/turn-fence.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SCENARIO_ID = randomUUID();
const GM_PROPOSAL_REF = 'gmh_floordegraded';

/** Strict GraphV3 fixture — passes BOTH GraphV3 and the ingress parse. */
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
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const GRAPH_HASH =
  computeAnalysisAffectingGraphHash(
    STRICT_GRAPH as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  ) ?? 'h_unset';

const HELD_OPERATIONS = [
  { op: 'update_node', path: 'fac-marketing', value: { description: 'Quarterly ad budget' } },
];

// ---------------------------------------------------------------------------
// Mock control flags.
// ---------------------------------------------------------------------------
let failContextRead = false; // loadGraphAndBriefText throws → DEGRADED canonical read
let rereadMode: 'model' | 'absent' | 'throw' = 'model'; // loadGraph (the strict reread)
const appendCalls: Array<Record<string, unknown>> = [];
let pendingActionsForRead: readonly PendingAction[] = [];
let fencedStore: SupabaseSessionStore | undefined;
let fencedAppendError: unknown;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    claimTurnFence: async (sid: string, tid: string) => fencedStore?.claimTurnFence(sid, tid),
    append: async (write: Record<string, unknown>) => {
      if (fencedStore !== undefined) {
        try { return await fencedStore.append(write as never); }
        catch (error) { fencedAppendError = error; throw error; }
      }
      appendCalls.push(write);
      return { id: `row-${appendCalls.length}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => pendingActionsForRead,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => {
      if (rereadMode === 'throw') {
        throw new Error('loadGraph failed (injected): strict reread degraded');
      }
      if (rereadMode === 'absent') return null;
      return clone(STRICT_GRAPH);
    },
    loadGraphAndBriefText: async () => {
      if (failContextRead) {
        throw new Error('loadGraphAndBriefText failed (injected): canonical read degraded');
      }
      return { graph: clone(STRICT_GRAPH), briefText: null, ...(fencedStore !== undefined ? { revision: 7 } : {}) };
    },
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runHeldProposalApproval, commitHeldProposalInProcess } = await import('../handlers/approve-held-proposal.js');
const { resolveProposalRenderCopy } = await import('../compose/proposed-change.js');
// Approval now names the stored card; all graph/source/receipt assertions below are unchanged.
const runTurnExecutor = (p: MessageTurnPayload, requestId: string, options?: Parameters<typeof runHeldProposalApproval>[2] & { routingAdapter?: unknown }) => {
  const held = pendingActionsForRead[0]!;
  return runHeldProposalApproval({ ...p, source: 'chip', chip: { id: held.chip_id }, message: resolveProposalRenderCopy(held.action).message }, requestId, options);
};

function gmHeldPending(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: GM_PROPOSAL_REF,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: GM_PROPOSAL_REF,
      inline_patch: {
        handler_id: 'graph_management_held_v1',
        apply_wiring: 'held_execute_v1',
        candidate_id: 'cand-floor',
        candidate_kind: 'update_node_field',
        mutation_class: 'tunable',
        blocker_code: 'TUNABLE_APPLY_HELD',
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
        operations: HELD_OPERATIONS,
        operations_count: HELD_OPERATIONS.length,
      },
      public_label: 'Continue with this change',
      public_message: 'Yes',
    },
    preconditions: { graph_hash: GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-24T11:00:00.000Z',
  };
}

function payload(): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message: 'yes',
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

beforeEach(() => {
  setTestSink(() => undefined);
  appendCalls.length = 0;
  fencedStore = undefined;
  fencedAppendError = undefined;
  failContextRead = false;
  rereadMode = 'model';
  pendingActionsForRead = [gmHeldPending()];
  // CAS meant to protect (observe derives real expected hashes) + GM live so
  // the confirmed hold actually executes.
  vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'live');
  _resetConfigCache();
});

afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('commitTurn floor — held-apply under a DEGRADED canonical read (clobber class)', () => {
  it('A · degraded read + strict reread proves an existing server model → FAIL CLOSED, NO graph write (was RED: the clobber write landed)', async () => {
    failContextRead = true; // context read degrades → persistedGraph null, read degraded
    rereadMode = 'model'; // the write-floor strict reread sees a server model

    const { response } = await runTurnExecutor(payload(), 'req-floor-degraded-model', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: clone(STRICT_GRAPH) as never, // the client echo (the tautological base)
    });

    // Post-fix: the floor refused the write — nothing reached the store.
    // Pre-fix: the held-apply wrote `graph: mutated(echo)` with a null expected
    // base (no_expected → unconditional) → appendCalls length 1 with graph → RED.
    expect(appendCalls).toHaveLength(0);
    // The wire response is a fail-closed commit failure — never an applied receipt.
    expect('draft_graph' in response).toBe(false);
  });

  it('B · degraded read AND the strict reread also fails → FAIL CLOSED, NO graph write', async () => {
    failContextRead = true;
    rereadMode = 'throw'; // the reread at the floor also throws → state unknown

    const { response } = await runTurnExecutor(payload(), 'req-floor-degraded-reread-throws', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: clone(STRICT_GRAPH) as never,
    });

    expect(appendCalls).toHaveLength(0);
    expect('draft_graph' in response).toBe(false);
  });

  it('C · degraded read but the strict reread PROVES ABSENT → first-write proceeds (fix must not over-restrict)', async () => {
    failContextRead = true;
    rereadMode = 'absent'; // reread returns null → nothing to clobber

    const { response } = await runTurnExecutor(payload(), 'req-floor-degraded-reread-absent', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: clone(STRICT_GRAPH) as never,
    });

    // The reread proved absent → a genuine first-write; the held-apply commits.
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeDefined();
    const committed = appendCalls[0]!.graph as { nodes?: Array<{ id: string; description?: string }> };
    expect(committed.nodes?.find((n) => n.id === 'fac-marketing')?.description).toBe(
      'Quarterly ad budget',
    );
    expect('draft_graph' in response).toBe(true);
  });

  it('D · REFUTE — a HEALTHY read held-apply is entirely unaffected (branch inert off degraded)', async () => {
    failContextRead = false; // healthy: persistedGraph = the server model
    rereadMode = 'model';

    await runTurnExecutor(payload(), 'req-floor-healthy-unaffected', {
      routingAdapter: throwingRoutingAdapter(),
      // No graphState needed — the healthy persisted read supplies the base.
    });

    // The held-apply commits normally through the shared floor.
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeDefined();
    expect({ expectedGraphIdentityHash: appendCalls[0]!.expectedGraphIdentityHash, expectedGraphAnalysisHash: appendCalls[0]!.expectedGraphAnalysisHash }).toEqual(computeExpectedGraphCasHashes(STRICT_GRAPH));
    const committed = appendCalls[0]!.graph as { nodes?: Array<{ id: string; description?: string }> };
    expect(committed.nodes?.find((n) => n.id === 'fac-marketing')?.description).toBe(
      'Quarterly ad budget',
    );
  });
  it('E · a stopped held approval returns 409 and commits no append', async () => {
    const claims: string[] = [];
    // Real claim/enforcement/serializer; the local RPC port rejects the stopped transaction before recording any append.
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === TURN_FENCE_RPC.claim) { claims.push(String(args.p_turn_id)); return { data: 1, error: null }; }
      if (!name.startsWith('append_turn_atomic')) throw new Error(`Unexpected RPC ${name}`);
      if (args.p_fence_generation != null) return { data: null, error: { code: TURN_FENCE_ATOMIC_SQLSTATE.stopped, message: 'turn stopped' } };
      appendCalls.push(args); return { data: { turn_row_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', model_version_receipt: null, revision: 8 }, error: null };
    }, from: () => {
      // Post-commit loss-notice maintenance has no rows in this local backend.
      const query: object = new Proxy({}, { get: (_target, key) => key === 'then'
        ? (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null }))
        : () => query });
      return query;
    } } as unknown as SupabaseClient;
    fencedStore = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 4 }), { defaultReadLimit: 4 });
    vi.spyOn(fencedStore, 'markGraphWriteFailed').mockResolvedValue(undefined);
    const held = pendingActionsForRead[0]!;
    const p = { ...payload(), source: 'chip' as const, chip: { id: held.chip_id }, message: resolveProposalRenderCopy(held.action).message };
    const reply = await commitHeldProposalInProcess(p, 'req-stopped-held');
    expect(reply.status, JSON.stringify(reply.json) + String(fencedAppendError)).toBe(409);
    expect(reply.json).toMatchObject({ error: 'GRAPH_DIVERGED', details: { fence_verdict: 'stopped', conflict_category: 'turn_fence_stopped' } });
    expect(claims).toEqual([p.turn_id]);
    expect(appendCalls).toEqual([]);
  });

});
