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
 *       rejects carries neither). "MY appended bytes" means the PROJECTED bytes
 *       the store received, not the handler's pre-projection copy: the fixture
 *       carries an empty top-level `options: []`, so the persistence projection
 *       appends `o-launch` on every first write and moves the analysis hash —
 *       P1 asserts that premise, so a reply hash of the pre-projection copy
 *       fails it. Owner variant: the version receipt names MY
 *       turn; guest variant: no receipt. Post-append variant: a foreign writer
 *       commits the instant MY append resolves, so the store's hash moves away
 *       from my bytes before the reply is built — and the reply's `graph_hash`
 *       and `draft_graph` are still MY commit's bytes, never a re-read of
 *       whatever the store holds now (the "moved hash" the rule forbids).
 *   P2  a foreign commit BEFORE my base read is composed into my write, and my
 *       patch still names only my target.
 *   P3  a foreign commit AFTER my base read loses me the atomic CAS: no commit
 *       evidence on the reply, nothing of mine stored.
 *   P4  a foreign writer already set my requested value: `noop`, not `applied`,
 *       and no version receipt.
 *   P5  a refusal, bound by identity to the above-cap rejection (the rescale
 *       pending it persists names MY factor and MY value): no commit evidence,
 *       and no append carried a graph.
 *   P6  ⭐ DECISIVE NEGATIVE CONTROL — my edit is REFUSED while a foreign writer
 *       MOVES the stored graph. The stored hash moves; my reply still carries no
 *       commit evidence. The reply discriminates; the hash does not.
 *   P7  a replay of an already-committed request (same turn_id, same request)
 *       after a foreign writer moved the target: the reply's graph_patch block is
 *       `noop` with `after` = the current stored value. P7 claims the PATCH BLOCK
 *       only — see the tracked finding below.
 *   P7b P7 with a foreign write landing BETWEEN the retry's base read and its
 *       append: the patch's `before` (the start-of-turn read) now differs from
 *       the stored value, so `after` = the stored value proves a reply-time
 *       re-read, not a copy of the start-of-turn state. P8b is the same for P8.
 *   P8  a REUSED turn_id carrying a DIFFERENT request (`priorTurnConflict`) on an
 *       owned scenario: the store hands back the PRIOR operation's version
 *       receipt (it shares the turn id, so `source_turn_id === MINE` cannot tell
 *       them apart) and the reply must not carry it; the patch is `noop` at the
 *       stored value; nothing is written. P8 likewise claims the receipt and the
 *       patch block only.
 *
 * ⚠ TRACKED FINDING — NOT PINNED, NOT ASSERTED (production fix first). On a
 *   replay (P7) AND on a conflict (P8), the SAME reply still carries a
 *   `draft_graph` and a `graph_hash` built from the retry's UNWRITTEN bytes,
 *   while the store holds something else. Measured 24 Sep on these exact
 *   fixtures at 5662723c, as RED runs of the assertions this rule demands
 *   (hashes re-measured after `options: []` was added to the fixture; the
 *   prose quotes are from the first measurement, before that change):
 *     P7: draft_graph f-budget = 50,000 while the store holds 70,000 and the
 *         prose says "currently £70k"; graph_hash 2a88e26c7126bd0d = hash of the
 *         retry's unwritten bytes (stored graph: 09d5c5d0448d70b6).
 *     P8: draft_graph f-budget = 70,000 while the store holds 50,000 and the
 *         prose says "Nothing was written. … currently £50k"; graph_hash
 *         09d5c5d0448d70b6 = hash of the unwritten bytes (stored: 2a88e26c7126bd0d).
 *   By `expectNoCommitEvidence`'s own definition that `draft_graph` is commit
 *   evidence for bytes this operation never wrote. Cause, read at HEAD: on a
 *   replay/conflict `commitDirectAnswer` still returns `persistedGraph` /
 *   `persistedAnalysisGraphHash` for the bytes it handed the RPC
 *   (commit.ts:2064-2065), and `dispatchFactorValueEdit` stamps both onto the
 *   reply (dispatch.ts:1906-1910); its `analysis_ready` / freshness derive from
 *   the same bytes (read in the code, not measured here). Deliberately NOT asserted in either direction: pinning it
 *   would bless the defect, and asserting the fix would put a RED test in the
 *   required gate before the production change exists.
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
 *     follow-up F2. P3 asserts 'not 200' plus 'no commit evidence', never a
 *     specific code, so F2's fix cannot break it. The no-evidence checks on the
 *     error body cannot fail at this HEAD (the 500 body carries no patch,
 *     postimage or receipt); they are forward guards for F2's typed 409 body.
 *     What P3 excludes today is a design where a lost CAS answers 200 with an
 *     honest refusal;
 *   - the status CODE of a conflict (200 today) — P8 asserts the receipt and the
 *     patch block, not the code;
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
//
// `options: []` is deliberate: an EMPTY top-level options array next to the
// `o-launch` option node, so `projectGraphForPersistence`
// (`reconcileTopLevelOptionsFromNodes`) appends `o-launch` on the first write
// and the persisted bytes' analysis hash differs from the handler's
// pre-projection copy. Without it the projection is a no-op and P1 cannot tell
// the hash of the bytes the store received from the hash of that copy.
function buildBaseGraph() {
  return {
    goal_node_id: 'g-revenue',
    options: [] as unknown[],
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
  return withForeignValue(base, 'f-price', rawValue);
}

/** `base` with one factor's value moved by a foreign writer (value = raw / cap). */
function withForeignValue(base: unknown, factorId: string, rawValue: number): Record<string, unknown> {
  const g = JSON.parse(JSON.stringify(base)) as {
    nodes: Array<{ id: string; observed_state?: Record<string, unknown> }>;
  };
  const factor = g.nodes.find((n) => n.id === factorId);
  if (factor?.observed_state === undefined) throw new Error(`fixture has no ${factorId} observed_state`);
  const cap = factor.observed_state.cap;
  if (typeof cap !== 'number' || cap <= 0) throw new Error(`fixture ${factorId} has no numeric cap`);
  factor.observed_state = { ...factor.observed_state, raw_value: rawValue, value: rawValue / cap };
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
  /**
   * Runs once, AFTER the next graph append has LANDED and before it returns —
   * i.e. a foreign commit that follows mine, before my reply is built. Receives
   * the bytes that landed so the foreign writer builds on them, as a CAS'd
   * writer must.
   */
  afterNextAppend: undefined as ((landed: unknown) => void) | undefined,
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
  fake.afterNextAppend = undefined;
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
  // 4. A foreign commit that lands AFTER mine (my transaction has committed).
  const following = fake.afterNextAppend;
  fake.afterNextAppend = undefined;
  following?.(jsonCopy(fake.graph));
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
const FOREIGN_2 = 'f0000000-0000-4000-8000-0000000000f2';

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

/** What the store HANDED BACK to each of a turn's appends, in order (a throw is `undefined`). */
function appendOutcomesFor(turnId: string): Array<SessionAppendOutcome | undefined> {
  return appendMock.mock.calls.flatMap((c, i) => {
    if (c[0].turn_id !== turnId) return [];
    const settled = appendMock.mock.settledResults[i];
    return [settled?.type === 'fulfilled' ? settled.value : undefined];
  });
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

    // THE PREMISE, proven inside the test: the persistence projection CHANGED
    // what my append carried — it mirrored `o-launch` into the base's empty
    // `options[]` — and that change moves the analysis hash. So the hash of the
    // bytes the store received is NOT the hash of the handler's pre-projection
    // copy, and the `graph_hash` check below can tell the two apart.
    expect(g0.options).toEqual([]);
    const appendedOptions = (mine?.graph as { options?: Array<{ id?: unknown }> } | undefined)?.options;
    expect((appendedOptions ?? []).map((o) => o.id)).toEqual(['o-launch']);
    expect(analysisHash({ ...(mine?.graph as Record<string, unknown>), options: [] })).not.toBe(
      analysisHash(mine?.graph),
    );

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

  it('P1 post-append: a foreign commit that lands right AFTER my append does not leak into my reply — graph_hash and draft_graph are MY commit\'s bytes, not the store\'s current state', async () => {
    // P1 guest cannot tell "hash of MY bytes" from "hash of whatever the store
    // holds now": nothing lands after my append there, so the two are equal.
    // Here a foreign writer commits on top of my bytes the instant my
    // transaction commits, so the store has MOVED before my reply is built.
    fake.afterNextAppend = (landed) => {
      fake.graph = withForeignPrice(landed, 300);
      fake.rows.set(FOREIGN, { id: `row-${FOREIGN}`, request_hash: 'sha256:foreign' });
    };

    const { status, body } = await send(SET_BUDGET_50K, MINE);
    expect(status).toBe(200);

    // Preconditions: MY append landed (one attempt, no CAS verdict, no replay)
    // carrying MY value on the untouched f-price…
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(1);
    const [mine] = mineWrites;
    expect(fake.rows.has(MINE)).toBe(true);
    expect(fake.casRejected).toEqual([]);
    expect(fake.replayed).toEqual([]);
    expect(rawValueOf(mine?.graph, 'f-budget')).toBe(50000);
    expect(rawValueOf(mine?.graph, 'f-price')).toBe(200);
    // …and THE PREMISE, proven inside the test: the foreign commit landed after
    // mine, so the store's current hash is no longer the hash of MY bytes.
    expect(fake.rows.has(FOREIGN)).toBe(true);
    expect(rawValueOf(fake.graph, 'f-price')).toBe(300);
    expect(rawValueOf(fake.graph, 'f-budget')).toBe(50000);
    expect(analysisHash(fake.graph)).not.toBe(analysisHash(mine?.graph));

    // The reply's commit evidence is THIS commit's result, bound to MY bytes.
    const patches = graphPatches(body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('applied');
    expect(body.graph_hash).toBe(analysisHash(mine?.graph));
    expect(body.graph_hash).not.toBe(analysisHash(fake.graph));
    // The postimage is MY bytes too: my value, and f-price as I wrote it (200),
    // never the foreign 300 that a re-read would have returned.
    expect(rawValueOf(body.draft_graph, 'f-budget')).toBe(50000);
    expect(rawValueOf(body.draft_graph, 'f-price')).toBe(200);
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

    // THE CAUSE, by identity: the refusal is the ABOVE-CAP one. Only a
    // `value_exceeds_cap` rejection mints the consented rescale pending
    // (rescale-cap-pending.ts), and it names the factor and the value refused —
    // an unknown-target or scale-mismatch refusal would carry neither.
    const [refusalWrite] = appendsFor(MINE);
    const rescale = (refusalWrite?.pending_actions ?? []).filter(
      (pa) => pa.chip_id === 'chip_prompt_rescale_extend_cap',
    );
    expect(rescale).toHaveLength(1);
    const action = rescale[0]?.action as Record<string, unknown> | undefined;
    expect(action?.factor_id).toBe('f-budget');
    expect(action?.value).toBe(ABOVE_CAP_BUDGET.raw_value);
    expect(rescale[0]?.preconditions?.target_entity_ids).toEqual(['f-budget']);
    const chips = (body.suggested_actions ?? []) as Array<Record<string, unknown>>;
    expect(chips.map((a) => a.id)).toContain('chip_prompt_rescale_extend_cap');

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

    // THE CAUSE, by identity (as P5): my turn WAS recorded, exactly once, and
    // its row is the ABOVE-CAP refusal — the consented rescale pending names MY
    // factor and MY refused value. Without this, an empty append list would make
    // the `every` below pass vacuously.
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(1);
    const rescale = (mineWrites[0]?.pending_actions ?? []).filter(
      (pa) => pa.chip_id === 'chip_prompt_rescale_extend_cap',
    );
    expect(rescale).toHaveLength(1);
    const action = rescale[0]?.action as Record<string, unknown> | undefined;
    expect(action?.factor_id).toBe('f-budget');
    expect(action?.value).toBe(ABOVE_CAP_BUDGET.raw_value);

    // My reply does not follow the hash: no applied patch, no postimage.
    expect(status).toBe(200);
    expectNoCommitEvidence(body);
    expect(body.graph_hash).toBeUndefined();
    // And nothing of mine carried a graph — the move was entirely foreign.
    expect(appendsFor(MINE)).toHaveLength(1);
    expect(appendsFor(MINE).every((w) => w.graph == null)).toBe(true);
    expect(rawValueOf(readAfter, 'f-budget')).toBe(40000);
  });

  // ── P7 — replay of an already-committed request ──────────────────────────

  it('P7: on a replay of MY already-committed request, after a foreign writer moved the target, the reply\'s graph_patch is noop with after = the stored value (patch block only; idempotent replay — open design question)', async () => {
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

    // ⚠ THE PATCH BLOCK IS NOT THE WHOLE REPLY. The same reply still carries a
    // `draft_graph` and `graph_hash` of the retry's UNWRITTEN bytes — the
    // header's TRACKED FINDING. Deliberately not asserted either way here.
  });

  it('P7b: on a replay, when a foreign write lands BETWEEN the retry\'s base read and its append, the noop patch\'s after is the value stored at reply time — a re-read, not the start-of-turn before', async () => {
    // P7 cannot tell a reply-time re-read from a copy of the start-of-turn read:
    // nothing moves during the retry, so both are 70,000. Here a second foreign
    // writer moves f-budget to 90,000 the instant the retry's base read is served.
    const first = await send(SET_BUDGET_50K, MINE);
    expect(first.status).toBe(200);
    expect(graphPatches(first.body)[0]?.status).toBe('applied');
    const foreign = await send(SET_BUDGET_70K, FOREIGN);
    expect(foreign.status).toBe(200);
    expect(rawValueOf(fake.graph, 'f-budget')).toBe(70000);

    fake.afterNextRead = () => {
      fake.graph = withForeignValue(fake.graph, 'f-budget', 90000);
      fake.rows.set(FOREIGN_2, { id: `row-${FOREIGN_2}`, request_hash: 'sha256:foreign-2' });
    };
    const retry = await send(SET_BUDGET_50K, MINE);

    // Preconditions: the interleaved foreign write ran, the store still
    // classified the retry as a replay (replay precedes CAS) and wrote nothing,
    // so what the store holds at reply time is exactly the foreign 90,000.
    expect(fake.afterNextRead).toBeUndefined();
    expect(fake.rows.has(FOREIGN_2)).toBe(true);
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(2);
    expect(mineWrites[1]?.request_hash).toBe(mineWrites[0]?.request_hash);
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.casRejected).toEqual([]);
    const storedBudget = (fake.graph as { nodes: Array<{ id: string; observed_state?: unknown }> }).nodes.find(
      (n) => n.id === 'f-budget',
    )?.observed_state as Record<string, unknown> | undefined;
    expect(storedBudget?.raw_value).toBe(90000);

    expect(retry.status).toBe(200);
    const patches = graphPatches(retry.body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('noop');
    // THE PREMISE: the patch's `before` is the START-OF-TURN read (70,000), and
    // it differs from what the store holds at reply time.
    const before = patches[0]?.before as Record<string, unknown> | null | undefined;
    expect(before?.raw_value).toBe(70000);
    expect(before?.raw_value).not.toBe(storedBudget?.raw_value);
    // `after` IS the stored observed_state, read at reply time.
    expect(patches[0]?.after).toEqual(storedBudget);
  });

  // ── P8 — a reused turn_id carrying a DIFFERENT request ───────────────────

  it('P8: a reused turn_id carrying a DIFFERENT request writes nothing, and the reply carries NO version receipt — not even the prior operation\'s — and a noop patch at the stored value (receipt and patch block only)', async () => {
    fake.owned = true;
    const first = await send(SET_BUDGET_50K, MINE);
    expect(first.status).toBe(200);
    expect(graphPatches(first.body)[0]?.status).toBe('applied');
    const firstReceipt = first.body.model_version_receipt as Record<string, unknown> | undefined;
    expect(firstReceipt?.version_id).toBe(VERSION_IDS[0]);
    expect(firstReceipt?.source_turn_id).toBe(MINE);
    const versionsAfterFirst = [...fake.versions];
    const storedAfterFirst = jsonCopy(fake.graph);
    expect(rawValueOf(storedAfterFirst, 'f-budget')).toBe(50000);

    // The SAME turn id, a DIFFERENT instruction.
    const reused = await send(SET_BUDGET_70K, MINE);

    // Preconditions: the store classified it as a CONFLICT (same turn_id,
    // different request_hash), wrote nothing, minted nothing — and handed back
    // the PRIOR operation's receipt, whose source_turn_id is also MINE. That is
    // exactly why `source_turn_id === MINE` alone cannot prove a receipt is
    // THIS request's.
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(2);
    expect(rawValueOf(mineWrites[1]?.graph, 'f-budget')).toBe(70000);
    expect(mineWrites[1]?.request_hash).not.toBe(mineWrites[0]?.request_hash);
    expect(fake.replayed).toEqual([MINE]);
    const handedBack = appendOutcomesFor(MINE)[1];
    expect(handedBack?.priorTurnConflict).toBe(true);
    expect(handedBack?.replayedPriorTurn).toBeUndefined();
    expect(handedBack?.modelVersionReceipt?.version_id).toBe(VERSION_IDS[0]);
    expect(handedBack?.modelVersionReceipt?.source_turn_id).toBe(MINE);
    expect(fake.versions).toEqual(versionsAfterFirst);
    expect(identityOf(fake.graph)).toBe(identityOf(storedAfterFirst));
    expect(rawValueOf(fake.graph, 'f-budget')).toBe(50000);

    // No receipt on the reply: the one the store handed back is the EARLIER
    // operation's, and this request committed nothing to be receipted.
    expect(reused.body.model_version_receipt).toBeUndefined();

    // The patch names my target, is `noop`, never `applied`, and reports the
    // AUTHORITATIVE stored value (the earlier 50,000), not the 70,000 asked for.
    const patches = graphPatches(reused.body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('noop');
    expect(patches.filter((p) => p.status === 'applied')).toEqual([]);
    expect((patches[0]?.after as Record<string, unknown> | null)?.raw_value).toBe(50000);

    // ⚠ Status code (200 today) deliberately not pinned. The same reply's
    // `draft_graph` / `graph_hash` of the unwritten 70,000 bytes is the header's
    // TRACKED FINDING — deliberately not asserted either way here.
  });

  it('P8b: on a reused turn_id, when a foreign write lands BETWEEN the base read and the append, the noop patch\'s after is the value stored at reply time — a re-read, not the start-of-turn before', async () => {
    // P8's start-of-turn read and its reply-time read both see 50,000. Here a
    // foreign writer moves f-budget to 90,000 right after the base read.
    fake.owned = true;
    const first = await send(SET_BUDGET_50K, MINE);
    expect(first.status).toBe(200);
    expect(graphPatches(first.body)[0]?.status).toBe('applied');
    expect(rawValueOf(fake.graph, 'f-budget')).toBe(50000);
    const versionsAfterFirst = [...fake.versions];

    fake.afterNextRead = () => {
      fake.graph = withForeignValue(fake.graph, 'f-budget', 90000);
      fake.rows.set(FOREIGN_2, { id: `row-${FOREIGN_2}`, request_hash: 'sha256:foreign-2' });
    };
    const reused = await send(SET_BUDGET_70K, MINE);

    // Preconditions: the interleaved foreign write ran; the store classified the
    // reused id as a CONFLICT (replay precedes CAS), wrote and minted nothing.
    expect(fake.afterNextRead).toBeUndefined();
    expect(fake.rows.has(FOREIGN_2)).toBe(true);
    const mineWrites = appendsFor(MINE);
    expect(mineWrites).toHaveLength(2);
    expect(mineWrites[1]?.request_hash).not.toBe(mineWrites[0]?.request_hash);
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.casRejected).toEqual([]);
    expect(appendOutcomesFor(MINE)[1]?.priorTurnConflict).toBe(true);
    expect(fake.versions).toEqual(versionsAfterFirst);
    const storedBudget = (fake.graph as { nodes: Array<{ id: string; observed_state?: unknown }> }).nodes.find(
      (n) => n.id === 'f-budget',
    )?.observed_state as Record<string, unknown> | undefined;
    expect(storedBudget?.raw_value).toBe(90000);

    expect(reused.body.model_version_receipt).toBeUndefined();
    const patches = graphPatches(reused.body);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.target_id).toBe('f-budget');
    expect(patches[0]?.status).toBe('noop');
    // THE PREMISE: `before` is the START-OF-TURN read (50,000), and it differs
    // from what the store holds at reply time.
    const before = patches[0]?.before as Record<string, unknown> | null | undefined;
    expect(before?.raw_value).toBe(50000);
    expect(before?.raw_value).not.toBe(storedBudget?.raw_value);
    // `after` IS the stored observed_state, read at reply time.
    expect(patches[0]?.after).toEqual(storedBudget);
  });
});
