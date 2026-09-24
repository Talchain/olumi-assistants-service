/**
 * OWN-WRITE PROOF — what, in the `/orchestrate/v2/turn` reply to a
 * `factor_value_edit` system event, proves that THIS operation committed.
 *
 * THE PRODUCT RULE (Paul): "Saved" rests ONLY on this operation's own canonical
 * commit result — never on a moved graph hash, and never on the target happening
 * to hold the requested value. This file pins that rule at the PRODUCER, one hop
 * before any client reads it:
 *
 *   P1  exact-target success — an `applied` graph_patch naming MY factor, and a
 *       `graph_hash` equal to the hash of the EXACT bytes MY append carried,
 *       exist only because MY append resolved (the same request whose append
 *       rejects carries neither). Owner variant: the version receipt names MY
 *       turn; guest variant: no receipt.
 *   P2  a foreign commit BEFORE my base read is composed into my write, and my
 *       patch still names only my target.
 *   P3  a foreign commit AFTER my base read loses me the atomic CAS: no commit
 *       evidence on the reply, nothing of mine stored.
 *   P4  a foreign writer already set my requested value: `noop`, not `applied`,
 *       and no version receipt.
 *   P5  a refusal: no commit evidence, and no append carried a graph.
 *   P6  ⭐ DECISIVE NEGATIVE CONTROL — my edit is REFUSED while a foreign writer
 *       MOVES the stored graph. The stored hash moves; my reply still carries no
 *       commit evidence. The reply discriminates; the hash does not.
 *   P7  a replay of an already-committed request (same turn_id) after a foreign
 *       writer moved the target: `noop`, reconciled to the current stored value.
 *
 * THE FAKE STORE mirrors the three behaviours of the real atomic RPC these cases
 * turn on, as read at HEAD in
 * `supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql` and
 * `src/orchestrator-v5/session/supabase-store.ts`:
 *   · REPLAY IS DECIDED BEFORE CAS. A graph write whose (scenario_id, turn_id)
 *     already has a row writes nothing; same `request_hash` → `replayedPriorTurn`,
 *     different → `priorTurnConflict` (supabase-store.ts `append` →
 *     `classifyPriorTurn`).
 *   · ATOMIC CAS on the IDENTITY hash, with the migration's idempotent-replay
 *     exemption (incoming === current is not a conflict) and its unstamped-row
 *     exemption; a conflict throws the repo's own `GraphStaleWriteError`
 *     (`rpc_cas_conflict`) and lands nothing (the transaction rolls back).
 *   · A VERSION RECEIPT only for an OWNED scenario, only when the write carries a
 *     model-version carrier, and only when the incoming identity differs from the
 *     current one (`v_should_create`). `source_turn_id` is the write's own
 *     `turn_id` (`'source_turn_id', p_turn_id`).
 *   Identity hashes come from `computeExpectedGraphCasHashes`, the function the
 *   real store stamps `p_incoming_graph_identity_hash` with, so the fake's CAS is
 *   in the same hash space as the base the dispatcher sends.
 *
 * WHAT THIS DELIBERATELY DOES NOT PROVE:
 *   - that the real Postgres function behaves as the fake does (the migration's
 *     own oracle tests own that); a wrong fake here is a wrong premise, so each
 *     case asserts the fake's decision (replayed / CAS-rejected / landed) as a
 *     precondition rather than assuming it;
 *   - the status CODE of a lost CAS race — 500 today (`dispatchFactorValueEdit`'s
 *     commit catch has no `GraphStaleWriteError` branch), a typed 409 is
 *     follow-up F2. P3 asserts only the absence of commit evidence, so F2's fix
 *     cannot break it;
 *   - what the UI renders, or how the reload route / freshness read the result;
 *   - ⚠ OPEN DESIGN QUESTION, "idempotent replay": whether a replay of an
 *     already-committed request should answer `noop` (today, deliberately — see
 *     `commit.ts` "A REPLAY MUST NOT CLAIM AN EDIT HAPPENED ON THIS TURN") or
 *     re-issue the original success. P7 pins today's answer so a change to it is
 *     a decision, not a drift.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../../../src/orchestrator-v5/context/graph-cas-conflict.js';
import {
  GraphStaleWriteError,
  StateCommitFailedError,
  type AtomicCommittedModelVersionReceipt,
  type SessionAppendOutcome,
  type SessionTurnWrite,
} from '../../../src/orchestrator-v5/session/store.js';

// ── the persisted model ────────────────────────────────────────────────────
// Two capped factors so a foreign writer can touch one while this operation
// touches the other. `f-budget` is the route-v2-factor-value-edit.test.ts
// fixture's factor, unchanged, so its above-cap refusal (£250,000 > £100,000)
// is reused as-is.
function buildBaseGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      {
        id: 'f-price',
        kind: 'factor',
        label: 'Unit price',
        observed_state: { value: 0.2, raw_value: 200, unit: '£', cap: 1000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'f-price',
        to: 'g-revenue',
        strength: { mean: 0.3, std: 0.1 },
        exists_probability: 0.8,
        effect_direction: 'positive',
      },
    ],
  };
}

/**
 * A foreign writer's committed graph: `base` with `f-price` moved. Built from
 * the base rather than hand-copied so the ONLY difference is the foreign field.
 */
function withForeignPrice(base: unknown, rawValue: number): Record<string, unknown> {
  const g = JSON.parse(JSON.stringify(base)) as {
    nodes: Array<{ id: string; observed_state?: Record<string, unknown> }>;
  };
  const price = g.nodes.find((n) => n.id === 'f-price');
  if (price?.observed_state === undefined) throw new Error('fixture has no f-price observed_state');
  price.observed_state = { ...price.observed_state, raw_value: rawValue, value: rawValue / 1000 };
  return g as unknown as Record<string, unknown>;
}

// ── the fake canonical store ───────────────────────────────────────────────

interface FakeRow {
  readonly id: string;
  readonly request_hash: string;
  readonly receipt?: AtomicCommittedModelVersionReceipt;
}

const VERSION_IDS = [
  'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000003',
] as const;

const fake = {
  /** `scenarios.graph` — what the next read returns. */
  graph: buildBaseGraph() as unknown,
  /** `scenarios.user_id IS NOT NULL` — gates the version receipt. */
  owned: false,
  /** `v5_conversation_turns`, keyed by turn_id (one scenario in this file). */
  rows: new Map<string, FakeRow>(),
  versions: [] as string[],
  /** Runs once, AFTER the next `loadGraph` has taken its snapshot. */
  afterNextRead: undefined as (() => void) | undefined,
  /** One-shot infrastructure failure for the next append (not a CAS verdict). */
  nextAppendFailure: undefined as Error | undefined,
  loadGraphCalls: 0,
  /** The fake's own verdicts, per turn_id — asserted as preconditions. */
  casRejected: [] as string[],
  replayed: [] as string[],
};

function resetFake() {
  fake.graph = buildBaseGraph();
  fake.owned = false;
  fake.rows = new Map();
  fake.versions = [];
  fake.afterNextRead = undefined;
  fake.nextAppendFailure = undefined;
  fake.loadGraphCalls = 0;
  fake.casRejected = [];
  fake.replayed = [];
}

/** The identity hash the real store stamps on `scenarios.graph_identity_hash`. */
function identityOf(graph: unknown): string | null {
  return computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash;
}

function jsonCopy<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function mintReceipt(write: SessionTurnWrite, incomingIdentity: string): AtomicCommittedModelVersionReceipt {
  const carrier = write.modelVersion;
  if (carrier === undefined) throw new Error('mintReceipt called without a model-version carrier');
  const parent = fake.versions.at(-1) ?? null;
  const versionId = VERSION_IDS[fake.versions.length];
  if (versionId === undefined) throw new Error('fixture ran out of version ids');
  fake.versions.push(versionId);
  return {
    mutation_id: carrier.mutation_id,
    version_id: versionId,
    version_number: fake.versions.length,
    graph_identity_hash: incomingIdentity,
    analysis_affecting_hash: carrier.analysis_affecting_hash,
    hash_algorithm: carrier.hash_algorithm,
    identity_projection_version: carrier.identity_projection_version,
    identity_normaliser_version: carrier.identity_normaliser_version,
    graph_schema_version: carrier.graph_schema_version,
    actor_kind: carrier.actor_kind,
    authored_by: carrier.authored_by,
    creation_kind: parent === null ? 'initial' : 'committed_mutation',
    source_version_id: null,
    // The migration writes `p_turn_id` here — the WRITE's own turn id.
    source_turn_id: write.turn_id,
    parent_version_id: parent,
    root_version_id: fake.versions[0] ?? versionId,
    undo_version_id: parent,
    graph: write.graph,
    event_id: `model_version_created_mutation_${carrier.mutation_id}`,
  };
}

const appendMock = vi.fn(async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => {
  if (fake.nextAppendFailure !== undefined) {
    const failure = fake.nextAppendFailure;
    fake.nextAppendFailure = undefined;
    throw failure;
  }
  const prior = fake.rows.get(write.turn_id);

  // A non-graph write (a refusal's transcript row) never meets CAS or versioning.
  if (write.graph == null) {
    if (prior !== undefined) return { id: prior.id };
    const id = `row-${write.turn_id}`;
    fake.rows.set(write.turn_id, { id, request_hash: write.request_hash });
    return { id };
  }

  // 1. REPLAY BEFORE CAS — an existing (scenario_id, turn_id) writes nothing.
  if (prior !== undefined) {
    fake.replayed.push(write.turn_id);
    const receipt = prior.receipt !== undefined ? { modelVersionReceipt: prior.receipt } : {};
    return prior.request_hash === write.request_hash
      ? { id: prior.id, replayedPriorTurn: true, ...receipt }
      : { id: prior.id, priorTurnConflict: true, ...receipt };
  }

  // 2. ATOMIC CAS on identity, with the migration's two exemptions.
  const current = identityOf(fake.graph);
  const incoming = identityOf(write.graph);
  const expected = write.expectedGraphIdentityHash;
  if (
    expected !== undefined &&
    current !== expected &&
    incoming !== current &&
    !(current === null && expected !== null)
  ) {
    fake.casRejected.push(write.turn_id);
    throw new GraphStaleWriteError('fake append_turn_atomic_v5: stale base (OLGC1) — whole turn rolled back', {
      conflict_category: 'rpc_cas_conflict',
      ...(expected !== null ? { expected_base_graph_hash: expected } : {}),
    });
  }

  // 3. LAND — graph, turn row and (owned + carrier + moved identity) a version.
  const receipt =
    fake.owned && write.modelVersion !== undefined && incoming !== null && incoming !== current
      ? mintReceipt(write, incoming)
      : undefined;
  const id = `row-${write.turn_id}`;
  fake.graph = jsonCopy(write.graph);
  fake.rows.set(write.turn_id, {
    id,
    request_hash: write.request_hash,
    ...(receipt !== undefined ? { receipt } : {}),
  });
  return { id, ...(receipt !== undefined ? { modelVersionReceipt: receipt } : {}) };
});

const fakeStore = {
  append: appendMock,
  readRecent: async () => [],
  readFactsFor: async () => [],
  // A DB read hands back fresh bytes every time; the snapshot is taken BEFORE
  // any interleaved foreign commit runs, which is what "after my base read" means.
  loadGraph: async (_scenarioId: string) => {
    fake.loadGraphCalls += 1;
    const snapshot = jsonCopy(fake.graph);
    const interleaved = fake.afterNextRead;
    fake.afterNextRead = undefined;
    interleaved?.();
    return snapshot;
  },
  loadGraphAndBriefText: async () => ({ graph: jsonCopy(fake.graph), briefText: null }),
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
};

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => fakeStore,
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ORIENT is the only step that reaches the LLM; every case here stays deterministic.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
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

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
// Distinct, valid v4 UUIDs: MINE is this operation, FOREIGN is another writer.
const MINE = 'a0000000-0000-4000-8000-00000000000a';
const MINE_2 = 'a0000000-0000-4000-8000-00000000000b';
const FOREIGN = 'f0000000-0000-4000-8000-00000000000f';

const SET_BUDGET_50K = { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' } as const;
const SET_BUDGET_70K = { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.7, raw_value: 70000, unit: '£' } as const;
const SET_PRICE_300 = { kind: 'factor_value_edit', target_id: 'f-price', value: 0.3, raw_value: 300, unit: '£' } as const;
// The route-v2-factor-value-edit.test.ts refusal fixture: £250,000 against a £100,000 cap.
const ABOVE_CAP_BUDGET = { kind: 'factor_value_edit', target_id: 'f-budget', value: 2.5, raw_value: 250000, unit: '£' } as const;

let app: FastifyInstance;

async function send(event: Record<string, unknown>, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: { kind: 'system_event', turn_id: turnId, scenario_id: SCENARIO_ID, stage: 'analyse', event },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

/** Every append ATTEMPTED for a turn, in order — landed or not. */
function appendsFor(turnId: string): SessionTurnWrite[] {
  return appendMock.mock.calls.map((c) => c[0]).filter((w) => w.turn_id === turnId);
}

function graphPatches(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const blocks = Array.isArray(body.blocks) ? (body.blocks as Array<Record<string, unknown>>) : [];
  return blocks.filter((b) => b?.type === 'graph_patch');
}

function rawValueOf(graph: unknown, factorId: string): unknown {
  const nodes = ((graph as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
    id: string;
    observed_state?: { raw_value?: unknown };
  }>;
  return nodes.find((n) => n.id === factorId)?.observed_state?.raw_value;
}

/** The repo's analysis hash, guarded so a null can never make two sides agree vacuously. */
function analysisHash(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (typeof h !== 'string' || h.length === 0) throw new Error('graph produced no analysis hash — assertion would be vacuous');
  return h;
}

/**
 * NO COMMIT EVIDENCE on a reply: no `applied` graph_patch, no applied postimage.
 * Deliberately says nothing about the status code or the copy.
 */
function expectNoCommitEvidence(body: Record<string, unknown>) {
  expect(graphPatches(body).filter((p) => p.status === 'applied')).toEqual([]);
  expect(body.draft_graph).toBeUndefined();
  expect(body.model_version_receipt).toBeUndefined();
}

describe('POST /orchestrate/v2/turn — factor_value_edit: what proves THIS operation committed', () => {
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    resetFake();
  });

  // ── P1 — exact-target success ────────────────────────────────────────────

  it('P1 guest: an applied patch on MY factor and a graph_hash of MY appended bytes exist only because MY append resolved', async () => {
    const g0 = buildBaseGraph();
    const { status, body } = await send(SET_BUDGET_50K, MINE);

    expect(status).toBe(200);
    expect(llmChatMock).not.toHaveBeenCalled();

    // Exactly one append, for MY turn, carrying MY value — and it LANDED.
    expect(appendMock).toHaveBeenCalledTimes(1);
    const [mine] = appendsFor(MINE);
    expect(rawValueOf(mine?.graph, 'f-budget')).toBe(50000);
    expect(fake.rows.has(MINE)).toBe(true);
    expect(fake.casRejected).toEqual([]);
    expect(fake.replayed).toEqual([]);
    // Its CAS base is the SERVER's start-of-turn read (fve carries no client hash).
    expect(mine?.expectedGraphIdentityHash).toBe(identityOf(g0));

    // The reply's commit evidence, bound to MY target and MY bytes.
    const patches = graphPatches(body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('applied');
    expect(body.graph_hash).toBe(analysisHash(mine?.graph));
    expect(body.graph_hash).not.toBe(analysisHash(g0));
    // Guest: the store minted no version, so the reply claims none.
    expect(body.model_version_receipt).toBeUndefined();

    // THE PAIR — the identical request whose append REJECTS (an infrastructure
    // failure, not a CAS verdict) carries none of that evidence. So `applied`
    // and the hash above are the append's result, not the handler's intent.
    resetFake();
    appendMock.mockClear();
    fake.nextAppendFailure = new StateCommitFailedError('fake append_turn_atomic_v5 RPC failed');
    const failed = await send(SET_BUDGET_50K, MINE_2);

    expect(appendsFor(MINE_2)).toHaveLength(1);
    expect(rawValueOf(appendsFor(MINE_2)[0]?.graph, 'f-budget')).toBe(50000);
    expect(fake.rows.has(MINE_2)).toBe(false);
    expect(failed.status).not.toBe(200);
    expectNoCommitEvidence(failed.body);
    expect(failed.body.graph_hash).not.toBe(analysisHash(appendsFor(MINE_2)[0]?.graph));
  });

  it('P1 owner: the version receipt on the reply is the one minted for MY write — source_turn_id is MY turn', async () => {
    fake.owned = true;
    const { status, body } = await send(SET_BUDGET_50K, MINE);

    expect(status).toBe(200);
    const [mine] = appendsFor(MINE);
    // Precondition: commit handed the store a version carrier, and the store
    // minted exactly one version, for this write.
    expect(mine?.modelVersion?.source_turn_id).toBe(MINE);
    expect(fake.versions).toEqual([VERSION_IDS[0]]);

    const receipt = body.model_version_receipt as Record<string, unknown> | undefined;
    expect(receipt, 'an owned scenario must return the receipt the store minted').toBeDefined();
    expect(receipt?.source_turn_id).toBe(MINE);
    expect(receipt?.version_id).toBe(VERSION_IDS[0]);
    expect(receipt?.mutation_id).toBe(mine?.modelVersion?.mutation_id);
    expect(receipt?.scenario_id).toBe(SCENARIO_ID);
    // The receipt's identity is the identity of the bytes MY append carried.
    expect(receipt?.full_hash).toBe(identityOf(mine?.graph));

    expect(graphPatches(body)[0]?.status).toBe('applied');
    expect(body.graph_hash).toBe(analysisHash(mine?.graph));
  });

  // ── P2 — a foreign commit BEFORE my base read ────────────────────────────

  it('P2: a foreign commit that landed before my base read is carried into my write; my patch names only my target', async () => {
    const foreign = await send(SET_PRICE_300, FOREIGN);
    expect(foreign.status).toBe(200);
    const [foreignWrite] = appendsFor(FOREIGN);
    expect(fake.rows.has(FOREIGN)).toBe(true);

    const { status, body } = await send(SET_BUDGET_50K, MINE);
    expect(status).toBe(200);

    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(1);
    const [mine] = mineWrites;
    // My base WAS the foreign commit's bytes (identity-bound, not value-bound).
    expect(mine?.expectedGraphIdentityHash).toBe(identityOf(foreignWrite?.graph));
    // Both writers' values are in the graph I committed.
    expect(rawValueOf(mine?.graph, 'f-price')).toBe(300);
    expect(rawValueOf(mine?.graph, 'f-budget')).toBe(50000);
    expect(fake.casRejected).toEqual([]);

    const patches = graphPatches(body);
    expect(patches.map((p) => p.target_id)).toEqual(['f-budget']);
    expect(patches[0]?.status).toBe('applied');
    expect(body.graph_hash).toBe(analysisHash(mine?.graph));
  });

  // ── P3 — a foreign commit AFTER my base read ─────────────────────────────

  it('P3: a foreign commit between my base read and my atomic append — CAS rejects me, the reply carries no commit evidence, nothing of mine is stored', async () => {
    const g0 = buildBaseGraph();
    const g1 = withForeignPrice(g0, 300);
    // The foreign writer lands the instant my base read has been served.
    fake.afterNextRead = () => {
      fake.graph = g1;
      fake.rows.set(FOREIGN, { id: `row-${FOREIGN}`, request_hash: 'sha256:foreign' });
    };

    const { status, body } = await send(SET_BUDGET_50K, MINE);

    // ── preconditions: MY append was attempted on the G0 base and the fake's
    //    CAS — not anything else — rejected it.
    expect(fake.loadGraphCalls).toBe(1);
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(1);
    const attempted = mineWrites[0]?.graph;
    expect(rawValueOf(attempted, 'f-budget')).toBe(50000);
    expect(mineWrites[0]?.expectedGraphIdentityHash).toBe(identityOf(g0));
    expect(identityOf(g0)).not.toBe(identityOf(g1));
    expect(fake.casRejected).toEqual([MINE]);

    // ── no commit evidence on the reply. The CODE is 500 today; a typed 409 is
    //    follow-up F2 — so this asserts "not a success", never "is 500".
    expect(status).not.toBe(200);
    expectNoCommitEvidence(body);
    expect(body.graph_hash).not.toBe(analysisHash(attempted));

    // ── nothing of mine stored: the store holds exactly the foreign commit.
    expect(fake.rows.has(MINE)).toBe(false);
    expect(identityOf(fake.graph)).toBe(identityOf(g1));
    expect(rawValueOf(fake.graph, 'f-budget')).toBe(40000);
  });

  // ── P4 — my requested value was set first by a foreign writer ────────────

  it('P4: when a foreign writer already set my requested value, my reply is noop — not applied — and carries no version receipt', async () => {
    fake.owned = true;
    const foreign = await send(SET_BUDGET_50K, FOREIGN);
    expect(foreign.status).toBe(200);
    expect(graphPatches(foreign.body)[0]?.status).toBe('applied');
    // Precondition: the value is there because the FOREIGN writer put it there.
    expect(rawValueOf(fake.graph, 'f-budget')).toBe(50000);
    expect(fake.versions).toHaveLength(1);

    const { status, body } = await send(SET_BUDGET_50K, MINE);
    expect(status).toBe(200);

    const patches = graphPatches(body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('noop');
    expect(patches[0]?.status).not.toBe('applied');
    expect(body.model_version_receipt).toBeUndefined();
    // The store minted no version for MY write.
    expect(fake.versions).toHaveLength(1);
  });

  // ── P5 — refused ─────────────────────────────────────────────────────────

  it('P5: a refused edit (above a confirmed cap) answers 200 with no commit evidence and no graph_hash, and no append carried a graph', async () => {
    const g0 = buildBaseGraph();
    const { status, body } = await send(ABOVE_CAP_BUDGET, MINE);

    expect(status).toBe(200);
    expectNoCommitEvidence(body);
    expect(graphPatches(body)).toEqual([]);
    expect(body.graph_hash).toBeUndefined();

    // The refusal is recorded as a turn, but no append carried a graph.
    expect(appendsFor(MINE)).toHaveLength(1);
    expect(appendMock.mock.calls.every(([w]) => w.graph == null)).toBe(true);
    expect(identityOf(fake.graph)).toBe(identityOf(g0));
  });

  // ── P6 — ⭐ DECISIVE NEGATIVE CONTROL ─────────────────────────────────────

  it('P6 NEGATIVE CONTROL: my edit is REFUSED while a foreign writer MOVES the stored hash — the reply carries no commit evidence; the hash cannot tell you whose write landed', async () => {
    const g0 = buildBaseGraph();
    const g1 = withForeignPrice(g0, 300);
    // THE PREMISE, proven inside the test: the foreign commit moves the hash.
    expect(analysisHash(g1)).not.toBe(analysisHash(g0));

    fake.afterNextRead = () => {
      fake.graph = g1;
      fake.rows.set(FOREIGN, { id: `row-${FOREIGN}`, request_hash: 'sha256:foreign' });
    };

    const { status, body } = await send(ABOVE_CAP_BUDGET, MINE);

    // The base read saw G0 (the foreign commit ran after it)…
    expect(fake.loadGraphCalls).toBe(1);
    // …and a subsequent read returns G1: the stored hash HAS moved.
    const readAfter = await fakeStore.loadGraph(SCENARIO_ID);
    expect(analysisHash(readAfter)).toBe(analysisHash(g1));
    expect(analysisHash(readAfter)).not.toBe(analysisHash(g0));

    // My reply does not follow the hash: no applied patch, no postimage.
    expect(status).toBe(200);
    expectNoCommitEvidence(body);
    expect(body.graph_hash).toBeUndefined();
    // And nothing of mine carried a graph — the move was entirely foreign.
    expect(appendsFor(MINE).every((w) => w.graph == null)).toBe(true);
    expect(rawValueOf(readAfter, 'f-budget')).toBe(40000);
  });

  // ── P7 — replay of an already-committed request ──────────────────────────

  it('P7: a replay of MY already-committed request, after a foreign writer moved the target, answers noop reconciled to the stored value (idempotent replay — open design question)', async () => {
    const first = await send(SET_BUDGET_50K, MINE);
    expect(first.status).toBe(200);
    expect(graphPatches(first.body)[0]?.status).toBe('applied');

    const foreign = await send(SET_BUDGET_70K, FOREIGN);
    expect(foreign.status).toBe(200);
    const storedBeforeRetry = jsonCopy(fake.graph);
    expect(rawValueOf(storedBeforeRetry, 'f-budget')).toBe(70000);

    // The client lost my reply and retries the IDENTICAL request.
    const retry = await send(SET_BUDGET_50K, MINE);

    // Precondition: the store classified it as a replay (same turn_id, same
    // request_hash) and wrote nothing.
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(2);
    expect(mineWrites[1]?.request_hash).toBe(mineWrites[0]?.request_hash);
    expect(fake.replayed).toEqual([MINE]);
    expect(identityOf(fake.graph)).toBe(identityOf(storedBeforeRetry));

    // Today's deliberate answer: noop, with `after` = the AUTHORITATIVE current
    // state (the foreign 70,000), never the value this request asked for.
    expect(retry.status).toBe(200);
    const patches = graphPatches(retry.body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('noop');
    expect((patches[0]?.after as Record<string, unknown> | null)?.raw_value).toBe(70000);

    // ⚠ `noop` IS NOT THE WHOLE OWN-WRITE STORY ON A REPLAY. Measured 24 Sep on
    // this exact fixture (a one-off probe, deliberately NOT asserted here): the
    // same reply still carries `draft_graph` with f-budget = 50,000 and a
    // `graph_hash` equal to the hash of the retry's UNWRITTEN bytes, while the
    // store holds 70,000 and the prose says "currently £70k". Cause, read at
    // HEAD: on a replay `commitDirectAnswer` still returns `persistedGraph` /
    // `persistedAnalysisGraphHash` for bytes it never wrote (commit.ts:2064-2065),
    // and `dispatchFactorValueEdit` stamps both onto the reply
    // (dispatch.ts:1906-1910). Reported as a finding, not pinned.
  });
});
