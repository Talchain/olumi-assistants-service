/**
 * A REUSED-ID CONFLICT ON `structural_add` MUST NOT ANSWER SUCCESS FOR AN ADD
 * THAT WAS NEVER WRITTEN.
 *
 * Written RED-first against staging d567638d (the fix is in
 * `system-events/dispatch.ts`). No case is marked `.fails` / `.skip` / `.todo`:
 * a red that is hidden is a red nobody fixes.
 *
 * THE CLAIM (Codex, #63 5821693599). `structural_add` is the NODE writer
 * (`dispatchStructuralAdd`; edges are `structural_add_edge`). Its post-commit
 * receipt check attests success from `commitResult.graphPersisted` plus the
 * committed graph containing the new node. Read at d567638d:
 *   · `commit.ts:2062` — `const graphPersisted = writesGraph;` and `:2065`
 *     `persistedGraph: writesGraph ? graphForStore : null`. `writesGraph`
 *     (`commit.ts:1184`) is `graphWasProvided(metadata.graph)` — "a graph was
 *     PROVIDED", not "a graph LANDED". Neither line reads
 *     `appendOutcome.priorTurnConflict`.
 *   · `commit.ts:1635-1780` — on `replayedPriorTurn || priorTurnConflict` it
 *     rewrites the PROSE ("I did not make that change … Nothing was written."),
 *     any `graph_patch` to `noop`, and strips the receipt on a conflict. A
 *     structural add carries NO `graph_patch` (`structural-add.ts:710-713`,
 *     `:762` `blocks: []`), so the prose is the only carrier that branch fixes.
 *   · `system-events/dispatch.ts:2843-2846` takes `persistedGraph` /
 *     `graphPersisted` from the commit; `:2896-2912` passes the receipt check
 *     (`addLanded` on the CANDIDATE); `:2929-2933` stamps `graph_hash` and
 *     `draft_graph` from them; `:2964-2973` logs "structural_add committed …
 *     new entry verified in the persisted bytes"; `:2975-2983` returns
 *     `commitPerformed: true`, `analysisReady` and `graph` from the candidate.
 *   · `structural-add.ts:710-713`: for an add, "the receipt is the `draft_graph`
 *     applied-graph field `dispatch.ts` stamps from the COMMITTED bytes". So a
 *     `draft_graph` carrying the new node IS the add's success receipt.
 *
 * THE CASES (same route, same CAS-honouring fake, only the store's verdict differs):
 *   CONTRAST — a FIRST attempt adds node X: it lands, and the reply's
 *     `draft_graph` / `graph_hash` describe the stored bytes, which hold X.
 *   DEFECT A — R1 (turn T) adds X and commits; R2 REUSES turn T to add a
 *     DIFFERENT node Y. The store signals `priorTurnConflict` and writes nothing,
 *     so Y is absent from the store. R2's reply must not carry a success receipt
 *     for Y: no `draft_graph` holding Y, no `graph_hash` other than the stored
 *     graph's, no "Added" prose, no model-version receipt.
 *   DEFECT B — as A, but a FOREIGN writer adds exactly Y between R2's base read
 *     and its append. The store now holds Y — put there by the foreign writer.
 *     R2 must still claim nothing for itself: no "Added" prose, no receipt. A
 *     snapshot that shows Y is truthful here (the store holds it), so B pins the
 *     CLAIM carriers, not the snapshot.
 *   REPLAY — the SAME request (same turn id, same bytes) whose original commit
 *     landed between the retry's base read and its append (a double submit; once
 *     X is stored, the adapter's stale gate refuses the retry before any append,
 *     so this interleaving is the only way a replay reaches the store). The store
 *     signals `replayedPriorTurn`. The add DID commit, earlier: the reply must say
 *     so ("already been recorded"), may hand back the ORIGINAL receipt, and must
 *     not attest that THIS attempt wrote.
 *   DEFECT A, REREAD FAILED — as A, but commit.ts's post-conflict reread throws:
 *     nothing graph-shaped (no `draft_graph`, `graph_hash`, `analysis_ready`) and
 *     still no success claim. DEFECT A also pins that `analysis_ready` and its
 *     freshness describe the SNAPSHOT, never the unwritten candidate.
 *   REPLAY OF A REFUSAL — a committed `no_persisted_graph` refusal row under turn
 *     T, then the identical request under T once a model exists: the store flags
 *     `replayedPriorTurn`, but X was never written, so "already recorded" is false.
 *   REPLAY OF A REFUSAL, REREAD FAILED — as above, with the reread throwing: the
 *     reply says the change could not be checked, and presents no graph.
 *   REPLAY, CHANGE NO LONGER IN THE MODEL — a genuine replay whose store no longer
 *     holds X: the original receipt is withheld, not presented as proof.
 *   NO PROVIDER — every path is deterministic; the LLM adapter mock and `fetch`
 *     are asserted uncalled.
 *
 * THE FAKE STORE is the CAS-honouring fake of
 * `route-v2-factor-value-edit-replay-postimage.test.ts`
 * (origin/fix/replay-reply-describes-stored-state 07cabcba), copied not imported,
 * which mirrors `supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql`
 * and `session/supabase-store.ts:294-295`:
 *   · REPLAY IS DECIDED BEFORE CAS — an existing (scenario_id, turn_id) writes
 *     nothing; same `request_hash` → `replayedPriorTurn`, different →
 *     `priorTurnConflict` (`session/store.ts:119/131`);
 *   · ATOMIC CAS on the identity hash with the migration's two exemptions.
 * Added here: `readMostRecentPendingActions` (the structural-add dispatcher's
 * strict pending read, `build-turn-context.ts:1679-1690`), and a `conflicted`
 * verdict list so the conflict precondition is asserted, not inferred.
 *
 * MEASURED at d567638d (this file, 24 Sep 2026):
 *   · CONTRAST GREEN; NO PROVIDER GREEN.
 *   · DEFECT A RED on three carriers: `draft_graph` holds Y (never stored);
 *     `graph_hash` is the candidate's hash, not the stored graph's; the
 *     dispatcher logs "committed … verified in the persisted bytes" for Y. The
 *     prose ("I did not make that change … Nothing was written.") and the
 *     receipt (absent) are already correct — `commit.ts`'s conflict branch.
 *     The reply is therefore self-contradictory: prose says nothing was written
 *     while the add's own receipt (`draft_graph`) presents Y as applied.
 *   · DEFECT B: every REPLY carrier is GREEN (same prose/receipt guard; and the
 *     candidate's identity equals the foreign-stored graph's, so the snapshot and
 *     hash happen to be true). Only the dispatcher's internal attestation is RED.
 *
 * MEASURED with #1856 (`CommitResult.thisAttemptWrote`, 07cabcba) merged, before
 * the dispatch.ts gate (24 Sep 2026): the conflict's `persistedGraph` is now the
 * stored snapshot, so DEFECT A turned from a false receipt into a RETRYABLE 500
 * (the receipt check no longer found Y); DEFECT B and REPLAY RED on the
 * dispatcher's "committed … verified" attestation. The fix
 * (`replyForAttemptThatWroteNothing`, gated on `thisAttemptWrote === false`)
 * turns all five cases GREEN.
 *
 * WHAT THIS DELIBERATELY DOES NOT PROVE:
 *   - that the real Postgres function behaves as the fake does; every case
 *     asserts the fake's verdict (landed / conflicted) as a precondition;
 *   - which reply shape a fix should choose (omit `draft_graph`, present the
 *     reread stored graph, or answer 409/422) — every honest shape passes;
 *   - what the UI renders from the reply.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../../../src/orchestrator-v5/context/graph-cas-conflict.js';
import {
  GraphStaleWriteError,
  type AtomicCommittedModelVersionReceipt,
  type SessionAppendOutcome,
  type SessionTurnWrite,
} from '../../../src/orchestrator-v5/session/store.js';
import { log } from '../../../src/utils/telemetry.js';

// ── the persisted model ────────────────────────────────────────────────────
// `structural-add.test.ts`'s fixture: a real, analysable-shaped model.
function buildBaseGraph() {
  return {
    schema_version: '3.0',
    goal_node_id: 'goal_revenue',
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow revenue' },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Unit price',
        category: 'controllable',
        observed_state: { value: 0.4, raw_value: 40000, cap: 100000 },
      },
      {
        id: 'opt_launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    edges: [
      {
        from: 'opt_launch',
        to: 'fac_price',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
    options: [
      {
        id: 'opt_launch',
        label: 'Launch now',
        status: 'ready',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    meta: { roots: ['opt_launch'], leaves: ['goal_revenue'] },
  };
}

// ── the fake canonical store ───────────────────────────────────────────────

interface FakeRow {
  readonly id: string;
  readonly request_hash: string;
  readonly receipt?: AtomicCommittedModelVersionReceipt;
}

const VERSION_IDS = [
  'c0000000-0000-4000-8000-0000000000b1',
  'c0000000-0000-4000-8000-0000000000b2',
  'c0000000-0000-4000-8000-0000000000b3',
] as const;

const fake = {
  graph: buildBaseGraph() as unknown,
  /** `scenarios.user_id IS NOT NULL` — gates the version receipt. */
  owned: false,
  rows: new Map<string, FakeRow>(),
  versions: [] as string[],
  /** Runs once, AFTER the next `loadGraph` has taken its snapshot. */
  afterNextRead: undefined as (() => void) | undefined,
  /**
   * When set to N, the FIRST `loadGraph` made after more than N appends have
   * been attempted throws (once) — i.e. the commit's post-append reread, never
   * the dispatcher's pre-commit base read. Each failure records the append count
   * at the time, so the premise is asserted, not inferred.
   */
  failFirstReadAfterAppends: undefined as number | undefined,
  readFailuresAtAppendCount: [] as number[],
  /** The fake's own verdicts, per turn_id — asserted as preconditions. */
  landed: [] as string[],
  replayed: [] as string[],
  conflicted: [] as string[],
  casRejected: [] as string[],
};

function resetFake() {
  fake.graph = buildBaseGraph();
  fake.owned = false;
  fake.rows = new Map();
  fake.versions = [];
  fake.afterNextRead = undefined;
  fake.failFirstReadAfterAppends = undefined;
  fake.readFailuresAtAppendCount = [];
  fake.landed = [];
  fake.replayed = [];
  fake.conflicted = [];
  fake.casRejected = [];
}

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
    source_turn_id: write.turn_id,
    parent_version_id: parent,
    root_version_id: fake.versions[0] ?? versionId,
    undo_version_id: parent,
    graph: write.graph,
    event_id: `model_version_created_mutation_${carrier.mutation_id}`,
  };
}

const appendMock = vi.fn(async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => {
  const prior = fake.rows.get(write.turn_id);

  // A non-graph write (a refusal's transcript row) never meets CAS.
  if (write.graph == null) {
    if (prior !== undefined) return { id: prior.id };
    const id = `row-${write.turn_id}`;
    fake.rows.set(write.turn_id, { id, request_hash: write.request_hash });
    return { id };
  }

  // 1. REPLAY BEFORE CAS — an existing (scenario_id, turn_id) writes nothing.
  if (prior !== undefined) {
    const receipt = prior.receipt !== undefined ? { modelVersionReceipt: prior.receipt } : {};
    if (prior.request_hash === write.request_hash) {
      fake.replayed.push(write.turn_id);
      return { id: prior.id, replayedPriorTurn: true, ...receipt };
    }
    fake.conflicted.push(write.turn_id);
    return { id: prior.id, priorTurnConflict: true, ...receipt };
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

  // 3. LAND.
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
  fake.landed.push(write.turn_id);
  return { id, ...(receipt !== undefined ? { modelVersionReceipt: receipt } : {}) };
});

/** Every graph snapshot `loadGraph` handed out, in order (for the interleaving premise). */
const loadGraphSnapshots: unknown[] = [];

const fakeStore = {
  append: appendMock,
  readRecent: async () => [],
  readFactsFor: async () => [],
  readMostRecentPendingActions: async () => [],
  // A COMPLETE, EMPTY durable analysis record: "never analysed" is only provable
  // from the record, never from an empty 20-row window (dispatch.ts
  // `deriveWriteReplyFreshness`).
  readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
  loadGraph: async (_scenarioId: string) => {
    const appendsSoFar = appendMock.mock.calls.length;
    if (fake.failFirstReadAfterAppends !== undefined && appendsSoFar > fake.failFirstReadAfterAppends) {
      fake.failFirstReadAfterAppends = undefined;
      fake.readFailuresAtAppendCount.push(appendsSoFar);
      throw new Error('fake loadGraph: the store could not be read just now');
    }
    const snapshot = jsonCopy(fake.graph);
    loadGraphSnapshots.push(jsonCopy(snapshot));
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

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const MINE = 'a0000000-0000-4000-8000-0000000000f4';
const FOREIGN = 'f0000000-0000-4000-8000-0000000000f4';
const PREP_R1 = 'e0000000-0000-4000-8000-0000000000f4';
const PREP_FOREIGN = 'e1000000-0000-4000-8000-0000000000f4';

const X = { id: 'fac_churn', label: 'Customer churn' } as const;
const Y = { id: 'fac_competitor', label: 'Competitor pricing' } as const;

/**
 * The dispatcher's reply on a replay whose requested change is NOT in the reread
 * snapshot (`replyForAttemptThatWroteNothing`). Pinned verbatim: it is the whole
 * claim the reply makes on that branch.
 */
const REPLAY_CHANGE_NOT_IN_MODEL =
  'Nothing new was written just now, and that change is not in the model at the moment.';
/** …and on a replay whose reread FAILED: the change cannot be checked either way. */
const REPLAY_CHANGE_UNCHECKABLE =
  "Nothing new was written just now, and I couldn't read the model to check whether that change is in it.";

let app: FastifyInstance;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let logInfoSpy: ReturnType<typeof vi.spyOn>;

/** The repo's analysis hash, guarded so a null can never make two sides agree vacuously. */
function analysisHash(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (typeof h !== 'string' || h.length === 0) throw new Error('graph produced no analysis hash — assertion would be vacuous');
  return h;
}

function addEvent(node: { id: string; label: string }, baseGraph: unknown) {
  return {
    kind: 'structural_add',
    node_id: node.id,
    node_kind: 'factor',
    label: node.label,
    base_graph_hash: analysisHash(baseGraph),
  } as const;
}

async function send(event: Record<string, unknown>, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: { kind: 'system_event', turn_id: turnId, scenario_id: SCENARIO_ID, stage: 'frame', event },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

function appendIndicesFor(turnId: string): number[] {
  return appendMock.mock.calls.flatMap((c, i) => (c[0].turn_id === turnId ? [i] : []));
}

async function outcomeAt(index: number): Promise<SessionAppendOutcome> {
  return (await appendMock.mock.results[index]?.value) as SessionAppendOutcome;
}

function nodeIds(graph: unknown): string[] {
  const nodes = ((graph as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{ id?: unknown }>;
  return nodes.map((n) => String(n.id));
}

function hasNode(graph: unknown, id: string): boolean {
  return nodeIds(graph).includes(id);
}

/**
 * The dispatcher's own success attestation for an add, captured from its log
 * (`dispatch.ts:2964-2973`): "V5 structural_add committed — … new entry verified
 * in the persisted bytes …", with `added_node_id`.
 */
function committedAttestationsFor(nodeId: string): number {
  return logInfoSpy.mock.calls.filter((c) => {
    const [obj, msg] = c as [Record<string, unknown> | undefined, unknown];
    return (
      typeof msg === 'string' &&
      msg.startsWith('V5 structural_add committed') &&
      obj?.added_node_id === nodeId
    );
  }).length;
}

function expectNoProviderReached() {
  expect(llmChatMock, 'an LLM adapter was called on a deterministic path').not.toHaveBeenCalled();
  expect(fetchSpy, 'a network call was attempted on a no-provider path').not.toHaveBeenCalled();
}

/** R1: MY first add of X on turn T, on the current fake. */
async function commitR1(): Promise<{ status: number; body: Record<string, unknown> }> {
  const r1 = await send(addEvent(X, fake.graph), MINE);
  expect(r1.status).toBe(200);
  expect(hasNode(fake.graph, X.id)).toBe(true);
  return r1;
}

describe('POST /orchestrate/v2/turn — structural_add under a REUSED turn id answers no success it did not earn', () => {
  beforeAll(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch attempted in a no-provider test');
    });
    logInfoSpy = vi.spyOn(log, 'info');
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
    logInfoSpy.mockRestore();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    fetchSpy.mockClear();
    logInfoSpy.mockClear();
    loadGraphSnapshots.length = 0;
    resetFake();
  });

  // ── CONTRAST ────────────────────────────────────────────────────────────

  it('CONTRAST: a FIRST-attempt structural_add of X lands, and the reply draft_graph / graph_hash describe the stored bytes, which hold X', async () => {
    expect(hasNode(fake.graph, X.id)).toBe(false);
    const { status, body } = await send(addEvent(X, fake.graph), MINE);
    expect(status).toBe(200);

    // Preconditions: one append for MY turn, it LANDED, stored bytes = its bytes.
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(1);
    const mineWrite = appendMock.mock.calls[mineIdx[0]!]![0];
    const outcome = await outcomeAt(mineIdx[0]!);
    expect(outcome.replayedPriorTurn).toBeUndefined();
    expect(outcome.priorTurnConflict).toBeUndefined();
    expect(fake.landed).toEqual([MINE]);
    expect(fake.conflicted).toEqual([]);
    expect(fake.replayed).toEqual([]);
    expect(fake.casRejected).toEqual([]);
    expect(identityOf(fake.graph)).toBe(identityOf(mineWrite.graph));
    expect(hasNode(fake.graph, X.id)).toBe(true);

    // The success receipt, bound to X and the STORED bytes.
    expect(body.draft_graph, 'a landed add must carry its applied postimage').toBeDefined();
    expect(hasNode(body.draft_graph, X.id)).toBe(true);
    expect(body.graph_hash).toBe(analysisHash(fake.graph));
    expect(String(body.assistant_text ?? '')).toContain(`Added '${X.label}'`);
    expect(committedAttestationsFor(X.id)).toBe(1);

    expectNoProviderReached();
  });

  // ── DEFECT A — reused-id conflict, nothing written ─────────────────────

  it('DEFECT A: R2 reuses R1\'s turn id to add a DIFFERENT node Y; the store signals priorTurnConflict and writes nothing, so R2 must not answer success for Y', async () => {
    fake.owned = true;
    const r1 = await commitR1();
    // Control: this fixture DOES mint receipts, so R2's "no receipt" is not vacuous.
    const r1Receipt = r1.body.model_version_receipt as Record<string, unknown> | undefined;
    expect(r1Receipt?.version_id, 'receipt control: R1 on an owned scenario must mint').toBe(VERSION_IDS[0]);
    expect(r1Receipt?.source_turn_id).toBe(MINE);
    const storedAfterR1 = jsonCopy(fake.graph);
    const versionsAfterR1 = [...fake.versions];

    // R2 — a DIFFERENT add under the SAME turn id, on a fresh base hash.
    const r2 = await send(addEvent(Y, storedAfterR1), MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    const r2Idx = mineIdx[1]!;
    const r2Write = appendMock.mock.calls[r2Idx]![0];
    // (a) R2 is a different request, and it reached the append WITH a graph that
    //     holds Y (so it passed every pre-commit gate, including the stale gate);
    expect(r2Write.request_hash).not.toBe(appendMock.mock.calls[mineIdx[0]!]![0].request_hash);
    expect(r2Write.graph, 'R2 must reach the append with a candidate graph').toBeDefined();
    expect(hasNode(r2Write.graph, Y.id)).toBe(true);
    // (b) the store signalled priorTurnConflict and wrote/minted nothing;
    const r2Outcome = await outcomeAt(r2Idx);
    expect(r2Outcome.priorTurnConflict).toBe(true);
    expect(r2Outcome.replayedPriorTurn).toBeUndefined();
    expect(fake.conflicted).toEqual([MINE]);
    expect(fake.landed).toEqual([MINE]);
    expect(fake.replayed).toEqual([]);
    expect(fake.casRejected).toEqual([]);
    expect(fake.versions).toEqual(versionsAfterR1);
    // (c) the store holds X and NOT Y;
    const stored = fake.graph;
    expect(identityOf(stored)).toBe(identityOf(storedAfterR1));
    expect(hasNode(stored, X.id)).toBe(true);
    expect(hasNode(stored, Y.id)).toBe(false);
    // (d) the candidate and the stored graph differ in the analysis hash, so the
    //     graph_hash assertion below discriminates.
    const storedHash = analysisHash(stored);
    const candidateHash = analysisHash(r2Write.graph);
    expect(candidateHash).not.toBe(storedHash);

    const observed =
      `observed: status=${r2.status}, reply draft_graph nodes=[${
        r2.body.draft_graph === undefined ? 'absent' : nodeIds(r2.body.draft_graph).join(',')
      }], reply graph_hash=${String(r2.body.graph_hash)}, stored nodes=[${nodeIds(stored).join(',')}], ` +
      `stored hash=${storedHash}, R2 candidate hash=${candidateHash}, ` +
      `assistant_text=${JSON.stringify(r2.body.assistant_text ?? null)}`;

    // ── NO SUCCESS FOR Y ─────────────────────────────────────────────────────
    // `expect.soft` so each carrier reports on its own: a fix to one must not
    // hide another still being wrong.
    expect.soft(r2.status, `A: a conflict must not be a server failure (${observed})`).toBeLessThan(500);
    const prose = String(r2.body.assistant_text ?? '');
    expect.soft(prose, `A: prose must not confirm the add (${observed})`).not.toContain(`Added '${Y.label}'`);
    expect.soft(prose, `A: prose must not say the add is saved (${observed})`).not.toMatch(/That's saved/);
    expect.soft(
      r2.body.model_version_receipt,
      `A: the handed-back receipt is R1's, not R2's (${observed})`,
    ).toBeUndefined();
    // THE RECEIPT FOR AN ADD is the `draft_graph` postimage (structural-add.ts:710-713).
    if (r2.body.draft_graph !== undefined) {
      expect.soft(
        hasNode(r2.body.draft_graph, Y.id),
        `A: reply draft_graph presents node ${Y.id}, which the store never wrote (${observed})`,
      ).toBe(false);
    }
    if (r2.body.graph_hash !== undefined) {
      expect.soft(
        r2.body.graph_hash,
        `A: reply graph_hash is not the hash of the stored graph (${observed})`,
      ).toBe(storedHash);
    }
    // Conflicts are unchanged by the replay rule: commit.ts's refusal prose stands.
    expect.soft(prose, `A: the conflict keeps commit.ts's refusal prose (${observed})`).toMatch(
      /did not make that change/i,
    );

    // ── THE NON-PROSE CARRIERS DESCRIBE THE SNAPSHOT, NEVER THE CANDIDATE ────
    // (a) readiness is built from the STORED graph (X, no Y). `blockers` and
    //     `readiness_issues` name every unconnected factor by id, so a readiness
    //     built from the unwritten candidate would name Y. X is the present control:
    //     the probe sees factor ids in this very payload.
    const ar = r2.body.analysis_ready as Record<string, unknown> | undefined;
    expect.soft(ar, `A: the no-write reply carries the snapshot's readiness (${observed})`).toBeDefined();
    const factorIdsIn = (field: string): string[] =>
      ((ar?.[field] ?? []) as Array<{ factor_id?: unknown }>)
        .map((entry) => entry.factor_id)
        .filter((id): id is string => typeof id === 'string');
    expect.soft(factorIdsIn('blockers'), `A: present control — readiness names X (${observed})`).toContain(X.id);
    expect.soft(
      factorIdsIn('blockers'),
      `A: analysis_ready.blockers names ${Y.id}, which only the unwritten candidate holds (${observed})`,
    ).not.toContain(Y.id);
    expect.soft(
      factorIdsIn('readiness_issues'),
      `A: analysis_ready.readiness_issues names ${Y.id}, which only the unwritten candidate holds (${observed})`,
    ).not.toContain(Y.id);
    // (b) freshness is derived on this branch, from a healthy (empty) fact read,
    //     against the SNAPSHOT's hash — not the candidate's, and not omitted.
    expect.soft(ar?.freshness, `A: analysis_ready.freshness is derived, not omitted (${observed})`).toBe('none');
    expect.soft(ar?.freshness_reason, `A: freshness comes from the healthy empty read (${observed})`).toBe(
      'no_successful_run_analysis_fact',
    );
    expect.soft(
      ar?.current_graph_hash,
      `A: freshness is derived against the stored graph's hash (${observed})`,
    ).toBe(storedHash);

    // The dispatcher's own attestation (log) — it must not claim Y "verified in
    // the persisted bytes" for an append that wrote nothing.
    expect.soft(
      committedAttestationsFor(Y.id),
      `A: dispatcher logged "structural_add committed … verified in the persisted bytes" for ${Y.id} (${observed})`,
    ).toBe(0);

    expectNoProviderReached();
  });

  // ── DEFECT A, REREAD FAILED — nothing graph-shaped without a snapshot ──

  it('DEFECT A, REREAD FAILED: as A, but commit.ts\'s post-conflict reread of the store throws — the reply presents nothing graph-shaped (no draft_graph, no graph_hash, no analysis_ready) and still claims nothing', async () => {
    fake.owned = true;
    await commitR1();
    const storedAfterR1 = jsonCopy(fake.graph);
    const versionsAfterR1 = [...fake.versions];
    // Arm AFTER R1: the first read made once R2's append has been attempted throws.
    const appendsBeforeR2 = appendMock.mock.calls.length;
    fake.failFirstReadAfterAppends = appendsBeforeR2;

    const r2 = await send(addEvent(Y, storedAfterR1), MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    const r2Idx = mineIdx[1]!;
    expect(r2Idx).toBe(appendsBeforeR2);
    const r2Write = appendMock.mock.calls[r2Idx]![0];
    expect(hasNode(r2Write.graph, Y.id)).toBe(true);
    const r2Outcome = await outcomeAt(r2Idx);
    expect(r2Outcome.priorTurnConflict).toBe(true);
    expect(fake.conflicted).toEqual([MINE]);
    expect(fake.landed).toEqual([MINE]);
    expect(fake.versions).toEqual(versionsAfterR1);
    // (a) exactly one read failed, and it was made AFTER R2's append (the reread),
    //     not R2's pre-commit base read;
    expect(fake.readFailuresAtAppendCount).toEqual([r2Idx + 1]);
    // (b) the store holds X and not Y;
    expect(hasNode(fake.graph, Y.id)).toBe(false);
    const candidateHash = analysisHash(r2Write.graph);
    // (c) present control: the dispatcher took the no-write branch.
    const noWriteLines = logInfoSpy.mock.calls.filter(
      (c) => typeof c[1] === 'string' && (c[1] as string).startsWith('V5 structural_add — this attempt wrote nothing'),
    );
    expect(noWriteLines).toHaveLength(1);

    const observed =
      `observed: status=${r2.status}, reply draft_graph nodes=[${
        r2.body.draft_graph === undefined ? 'absent' : nodeIds(r2.body.draft_graph).join(',')
      }], reply graph_hash=${String(r2.body.graph_hash)}, candidate hash=${candidateHash}, ` +
      `analysis_ready=${r2.body.analysis_ready === undefined ? 'absent' : 'present'}, ` +
      `assistant_text=${JSON.stringify(r2.body.assistant_text ?? null)}`;

    // ── NOTHING GRAPH-SHAPED, NO SUCCESS ────────────────────────────────────
    expect.soft(r2.status, `A-reread: a known no-write is not a server failure (${observed})`).toBe(200);
    expect.soft(
      (noWriteLines[0]![0] as Record<string, unknown>).stored_snapshot_presented,
      `A-reread: the dispatcher presented a snapshot although the reread failed (${observed})`,
    ).toBe(false);
    expect.soft(r2.body.draft_graph, `A-reread: no graph may be presented without a snapshot (${observed})`).toBeUndefined();
    expect.soft(r2.body.graph_hash, `A-reread: no graph_hash may be presented without a snapshot (${observed})`).toBeUndefined();
    expect.soft(r2.body.graph_hash, `A-reread: never the candidate's hash (${observed})`).not.toBe(candidateHash);
    expect.soft(
      r2.body.analysis_ready,
      `A-reread: no readiness may be presented without a snapshot (${observed})`,
    ).toBeUndefined();
    const prose = String(r2.body.assistant_text ?? '');
    expect.soft(prose, `A-reread: the conflict keeps commit.ts's refusal prose (${observed})`).toMatch(
      /did not make that change/i,
    );
    expect.soft(prose, `A-reread: prose must not confirm the add (${observed})`).not.toContain(`Added '${Y.label}'`);
    expect.soft(prose, `A-reread: prose must not say the add is saved (${observed})`).not.toMatch(/That's saved/);
    expect.soft(r2.body.model_version_receipt, `A-reread: no receipt (${observed})`).toBeUndefined();
    expect.soft(committedAttestationsFor(Y.id), `A-reread: no success attestation (${observed})`).toBe(0);

    expectNoProviderReached();
  });

  // ── DEFECT B — reused-id conflict with an interleaved foreign add of Y ─

  it('DEFECT B: as A, but a foreign writer adds exactly Y between R2\'s base read and its append — the store holds Y, and R2 must still claim nothing for itself', async () => {
    // ── derive the foreign writer's bytes through the REAL route ────────────
    // R1-equivalent then a foreign add of Y, on a fresh fake, then discarded, so
    // the interleaved graph is what this route would actually store.
    expect((await send(addEvent(X, fake.graph), PREP_R1)).status).toBe(200);
    const prepAfterR1 = jsonCopy(fake.graph);
    expect((await send(addEvent(Y, prepAfterR1), PREP_FOREIGN)).status).toBe(200);
    expect(fake.landed).toEqual([PREP_R1, PREP_FOREIGN]);
    const foreignGraph = jsonCopy(fake.graph);
    expect(hasNode(foreignGraph, X.id)).toBe(true);
    expect(hasNode(foreignGraph, Y.id)).toBe(true);
    resetFake();
    appendMock.mockClear();
    logInfoSpy.mockClear();
    loadGraphSnapshots.length = 0;

    // ── R1: MY add of X on turn T, OWNED scenario ───────────────────────────
    fake.owned = true;
    const r1 = await commitR1();
    const r1Receipt = r1.body.model_version_receipt as Record<string, unknown> | undefined;
    expect(r1Receipt?.version_id, 'receipt control: R1 on an owned scenario must mint').toBe(VERSION_IDS[0]);
    const storedAfterR1 = jsonCopy(fake.graph);
    const versionsAfterR1 = [...fake.versions];
    // Premise: the foreign bytes build on exactly R1's stored graph.
    expect(identityOf(storedAfterR1)).toBe(identityOf(prepAfterR1));
    expect(identityOf(foreignGraph)).not.toBe(identityOf(storedAfterR1));

    // ── the interleaved foreign write: after R2's base read, before its append ──
    let appendsWhenForeignLanded: number | undefined;
    const readsBeforeR2 = loadGraphSnapshots.length;
    fake.afterNextRead = () => {
      appendsWhenForeignLanded = appendMock.mock.calls.length;
      fake.graph = jsonCopy(foreignGraph);
      fake.rows.set(FOREIGN, { id: `row-${FOREIGN}`, request_hash: 'sha256:foreign-add-y' });
    };

    // ── R2: a DIFFERENT request reusing turn T (add Y) ──────────────────────
    const r2 = await send(addEvent(Y, storedAfterR1), MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    const r2Idx = mineIdx[1]!;
    const r2Write = appendMock.mock.calls[r2Idx]![0];
    // (a) R2 is a different request, built on R1's graph (no Y) — the foreign
    //     write had not landed at R2's base read;
    expect(r2Write.request_hash).not.toBe(appendMock.mock.calls[mineIdx[0]!]![0].request_hash);
    expect(hasNode(loadGraphSnapshots[readsBeforeR2], Y.id)).toBe(false);
    expect(r2Write.graph, 'R2 must reach the append with a candidate graph').toBeDefined();
    expect(hasNode(r2Write.graph, Y.id)).toBe(true);
    // (b) the foreign write landed BEFORE R2's append was attempted;
    expect(fake.afterNextRead, 'the interleaving hook must have run').toBeUndefined();
    expect(fake.rows.has(FOREIGN)).toBe(true);
    expect(appendsWhenForeignLanded).toBe(r2Idx);
    // (c) the store signalled priorTurnConflict for R2 and wrote/minted nothing;
    const r2Outcome = await outcomeAt(r2Idx);
    expect(r2Outcome.priorTurnConflict).toBe(true);
    expect(r2Outcome.modelVersionReceipt?.version_id).toBe(VERSION_IDS[0]);
    expect(fake.conflicted).toEqual([MINE]);
    expect(fake.landed).toEqual([MINE]);
    expect(fake.versions).toEqual(versionsAfterR1);
    // (d) the store holds Y — put there by the FOREIGN writer.
    const stored = fake.graph;
    expect(identityOf(stored)).toBe(identityOf(foreignGraph));
    expect(hasNode(stored, Y.id)).toBe(true);

    const candidateEqualsStored = identityOf(r2Write.graph) === identityOf(stored);
    const observed =
      `observed: status=${r2.status}, reply draft_graph nodes=[${
        r2.body.draft_graph === undefined ? 'absent' : nodeIds(r2.body.draft_graph).join(',')
      }], reply graph_hash=${String(r2.body.graph_hash)}, stored hash=${analysisHash(stored)}, ` +
      `candidate identity == stored identity: ${candidateEqualsStored}, ` +
      `assistant_text=${JSON.stringify(r2.body.assistant_text ?? null)}`;

    // ── R2 CLAIMS NOTHING FOR ITSELF ────────────────────────────────────────
    expect.soft(r2.status, `B: a conflict must not be a server failure (${observed})`).toBeLessThan(500);
    const prose = String(r2.body.assistant_text ?? '');
    expect.soft(prose, `B: prose must not confirm R2's add (${observed})`).not.toContain(`Added '${Y.label}'`);
    expect.soft(prose, `B: prose must not say R2's add is saved (${observed})`).not.toMatch(/That's saved/);
    expect.soft(
      r2.body.model_version_receipt,
      `B: the handed-back receipt is R1's, not R2's (${observed})`,
    ).toBeUndefined();
    // A snapshot that shows Y is truthful here; if one is presented it must be
    // the STORED graph's hash, never a hash of bytes that were not stored.
    if (r2.body.graph_hash !== undefined) {
      expect.soft(
        r2.body.graph_hash,
        `B: reply graph_hash is not the hash of the stored graph (${observed})`,
      ).toBe(analysisHash(stored));
    }
    expect.soft(
      committedAttestationsFor(Y.id),
      `B: dispatcher logged "structural_add committed … verified in the persisted bytes" for ${Y.id} although THIS append wrote nothing (${observed})`,
    ).toBe(0);

    expectNoProviderReached();
  });

  // ── REPLAY — a genuine replay of MY committed add ──────────────────────

  it('REPLAY: the SAME request (same turn id, same bytes) arrives again after my add of X committed in between its base read and its append — the reply says "already recorded", presents the stored graph, hands back the ORIGINAL receipt, and attests nothing for THIS attempt', async () => {
    // A replay only reaches the store if the retry read its base BEFORE the
    // original landed (a double submit): once X is stored, the adapter's stale
    // gate refuses the retry's old `base_graph_hash` before any append. So the
    // original's committed row and bytes are derived through the REAL route on a
    // fresh fake, then installed between the retry's base read and its append.
    fake.owned = true;
    const base = jsonCopy(fake.graph);
    const original = await send(addEvent(X, base), MINE);
    expect(original.status).toBe(200);
    expect(fake.landed).toEqual([MINE]);
    const originalRow = fake.rows.get(MINE);
    expect(originalRow?.receipt?.version_id, 'receipt control: the original on an owned scenario must mint').toBe(
      VERSION_IDS[0],
    );
    const originalGraph = jsonCopy(fake.graph);
    const originalVersions = [...fake.versions];
    expect(hasNode(originalGraph, X.id)).toBe(true);
    resetFake();
    appendMock.mockClear();
    logInfoSpy.mockClear();
    loadGraphSnapshots.length = 0;
    fake.owned = true;

    const readsBeforeRetry = loadGraphSnapshots.length;
    let appendsWhenOriginalLanded: number | undefined;
    fake.afterNextRead = () => {
      appendsWhenOriginalLanded = appendMock.mock.calls.length;
      fake.graph = jsonCopy(originalGraph);
      fake.rows.set(MINE, originalRow!);
      fake.versions = [...originalVersions];
    };

    const retry = await send(addEvent(X, base), MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(1);
    const retryWrite = appendMock.mock.calls[mineIdx[0]!]![0];
    // (a) the retry is the SAME request, built on the pre-add base, and reached
    //     the append with a candidate holding X;
    expect(retryWrite.request_hash).toBe(originalRow!.request_hash);
    expect(hasNode(loadGraphSnapshots[readsBeforeRetry], X.id)).toBe(false);
    expect(hasNode(retryWrite.graph, X.id)).toBe(true);
    // (b) the original had landed before the retry's append was attempted;
    expect(fake.afterNextRead, 'the interleaving hook must have run').toBeUndefined();
    expect(appendsWhenOriginalLanded).toBe(mineIdx[0]);
    // (c) the store signalled a REPLAY and wrote/minted nothing for the retry;
    const outcome = await outcomeAt(mineIdx[0]!);
    expect(outcome.replayedPriorTurn).toBe(true);
    expect(outcome.priorTurnConflict).toBeUndefined();
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.landed).toEqual([]);
    expect(fake.conflicted).toEqual([]);
    expect(fake.casRejected).toEqual([]);
    expect(fake.versions).toEqual(originalVersions);
    // (d) the store holds X — put there by the ORIGINAL commit of this request.
    const stored = fake.graph;
    expect(identityOf(stored)).toBe(identityOf(originalGraph));
    expect(hasNode(stored, X.id)).toBe(true);
    // Present control for the log probe: commit.ts's own replay line was seen.
    const commitReplayLogs = logInfoSpy.mock.calls.filter(
      (c) => typeof c[1] === 'string' && (c[1] as string).startsWith('V5 commit — this turn REPLAYED'),
    ).length;
    expect(commitReplayLogs, 'the log probe must see the commit\'s replay line in this run').toBe(1);

    const observed =
      `observed: status=${retry.status}, reply draft_graph nodes=[${
        retry.body.draft_graph === undefined ? 'absent' : nodeIds(retry.body.draft_graph).join(',')
      }], reply graph_hash=${String(retry.body.graph_hash)}, stored hash=${analysisHash(stored)}, ` +
      `assistant_text=${JSON.stringify(retry.body.assistant_text ?? null)}`;

    // ── TRUTHFUL: already recorded; nothing claimed for THIS attempt ────────
    expect.soft(retry.status, `REPLAY: a replay is not a failure (${observed})`).toBe(200);
    const prose = String(retry.body.assistant_text ?? '');
    expect.soft(prose, `REPLAY: prose must say the add was already recorded (${observed})`).toMatch(
      /already been recorded/i,
    );
    expect.soft(prose, `REPLAY: prose must not refuse a genuine replay (${observed})`).not.toMatch(
      /did not make that change/i,
    );
    expect.soft(prose, `REPLAY: prose must not confirm a NEW add (${observed})`).not.toContain(`Added '${X.label}'`);
    expect.soft(prose, `REPLAY: prose must not say this attempt saved it (${observed})`).not.toMatch(/That's saved/);
    // The ORIGINAL receipt is the only evidence the add committed EARLIER.
    const receipt = retry.body.model_version_receipt as Record<string, unknown> | undefined;
    expect.soft(receipt?.version_id, `REPLAY: the original receipt is handed back (${observed})`).toBe(VERSION_IDS[0]);
    expect.soft(receipt?.source_turn_id, `REPLAY: the receipt is this request's own (${observed})`).toBe(MINE);
    // The stored snapshot, for display — the store genuinely holds X.
    expect.soft(retry.body.draft_graph, `REPLAY: the reply presents the stored graph (${observed})`).toBeDefined();
    expect.soft(hasNode(retry.body.draft_graph, X.id), `REPLAY: stored graph holds X (${observed})`).toBe(true);
    expect.soft(retry.body.graph_hash, `REPLAY: graph_hash is the stored graph's (${observed})`).toBe(
      analysisHash(stored),
    );
    expect.soft(
      committedAttestationsFor(X.id),
      `REPLAY: dispatcher logged "structural_add committed … verified in the persisted bytes" for ${X.id} although THIS append wrote nothing (${observed})`,
    ).toBe(0);

    expectNoProviderReached();
  });

  // ── REPLAY OF A REFUSAL — the store's replay flag is not "it was written" ─

  it('REPLAY OF A REFUSAL: my add of X was REFUSED (no saved model) and that refusal row committed under turn T; once a model exists the identical request under T reaches the store, which flags replayedPriorTurn — X was never written, so the reply must not say "already recorded"', async () => {
    fake.owned = true;
    const base = buildBaseGraph();
    fake.graph = null;

    // ── the refusal, committed under T ──────────────────────────────────────
    const first = await send(addEvent(X, base), MINE);
    expect(first.status).toBe(200);
    expect(String(first.body.assistant_text ?? '')).toMatch(/no saved model/i);
    const firstIdx = appendIndicesFor(MINE);
    expect(firstIdx).toHaveLength(1);
    expect(appendMock.mock.calls[firstIdx[0]!]![0].graph ?? null, 'a refusal writes no graph').toBeNull();
    expect(fake.rows.has(MINE), 'the refusal row committed under T').toBe(true);
    expect(fake.rows.get(MINE)?.receipt).toBeUndefined();
    expect(fake.landed).toEqual([]);
    expect(fake.graph).toBeNull();

    // ── state changes: a model now exists (another turn drafted it), without X ─
    fake.graph = jsonCopy(base);
    const retry = await send(addEvent(X, base), MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    const retryWrite = appendMock.mock.calls[mineIdx[1]!]![0];
    // (a) the SAME request, which now passes every pre-commit gate and reaches the
    //     append with a candidate holding X;
    expect(retryWrite.request_hash).toBe(appendMock.mock.calls[mineIdx[0]!]![0].request_hash);
    expect(hasNode(retryWrite.graph, X.id)).toBe(true);
    // (b) the store flags a REPLAY (same turn id, same request hash) and hands back
    //     no receipt — the prior row is the refusal, which never minted one;
    const outcome = await outcomeAt(mineIdx[1]!);
    expect(outcome.replayedPriorTurn).toBe(true);
    expect(outcome.priorTurnConflict).toBeUndefined();
    expect(outcome.modelVersionReceipt).toBeUndefined();
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.landed).toEqual([]);
    expect(fake.conflicted).toEqual([]);
    expect(fake.casRejected).toEqual([]);
    expect(fake.versions).toEqual([]);
    // (c) X was NEVER written: the store holds the drafted model without it.
    const stored = fake.graph;
    expect(hasNode(stored, X.id)).toBe(false);
    // Present control for the log probe: commit.ts's own replay line was seen.
    const commitReplayLogs = logInfoSpy.mock.calls.filter(
      (c) => typeof c[1] === 'string' && (c[1] as string).startsWith('V5 commit — this turn REPLAYED'),
    ).length;
    expect(commitReplayLogs, 'the log probe must see the commit\'s replay line in this run').toBe(1);

    const observed =
      `observed: status=${retry.status}, reply draft_graph nodes=[${
        retry.body.draft_graph === undefined ? 'absent' : nodeIds(retry.body.draft_graph).join(',')
      }], reply graph_hash=${String(retry.body.graph_hash)}, stored hash=${analysisHash(stored)}, ` +
      `assistant_text=${JSON.stringify(retry.body.assistant_text ?? null)}`;

    // ── TRUTHFUL: nothing written, and the change is not in the model ───────
    expect.soft(retry.status, `REFUSAL-REPLAY: not a server failure (${observed})`).toBe(200);
    const prose = String(retry.body.assistant_text ?? '');
    expect.soft(
      prose,
      `REFUSAL-REPLAY: prose claims the add was already recorded, but X was never written (${observed})`,
    ).not.toMatch(/already been recorded/i);
    expect.soft(prose, `REFUSAL-REPLAY: prose says what is true now (${observed})`).toBe(REPLAY_CHANGE_NOT_IN_MODEL);
    expect.soft(prose, `REFUSAL-REPLAY: prose must not confirm the add (${observed})`).not.toContain(`Added '${X.label}'`);
    expect.soft(prose, `REFUSAL-REPLAY: prose must not say the add is saved (${observed})`).not.toMatch(/That's saved/);
    expect.soft(retry.body.model_version_receipt, `REFUSAL-REPLAY: no receipt (${observed})`).toBeUndefined();
    // The stored snapshot, for display — truthfully without X.
    expect.soft(retry.body.draft_graph, `REFUSAL-REPLAY: the stored graph is presented (${observed})`).toBeDefined();
    expect.soft(hasNode(retry.body.draft_graph, X.id), `REFUSAL-REPLAY: no X on display (${observed})`).toBe(false);
    expect.soft(retry.body.graph_hash, `REFUSAL-REPLAY: the stored graph's hash (${observed})`).toBe(
      analysisHash(stored),
    );
    expect.soft(committedAttestationsFor(X.id), `REFUSAL-REPLAY: no success attestation (${observed})`).toBe(0);

    expectNoProviderReached();
  });

  // ── REPLAY OF A REFUSAL, REREAD FAILED — neither claim can be made ─────

  it('REPLAY OF A REFUSAL, REREAD FAILED: as REPLAY OF A REFUSAL, but commit.ts\'s post-append reread throws — the reply says the change could not be checked, presents nothing graph-shaped, and claims neither "already recorded" nor "not in the model"', async () => {
    fake.owned = true;
    const base = buildBaseGraph();
    fake.graph = null;
    expect((await send(addEvent(X, base), MINE)).status).toBe(200);
    expect(fake.rows.has(MINE), 'the refusal row committed under T').toBe(true);
    fake.graph = jsonCopy(base);
    const appendsBeforeRetry = appendMock.mock.calls.length;
    fake.failFirstReadAfterAppends = appendsBeforeRetry;

    const retry = await send(addEvent(X, base), MINE);

    // ── PREMISE ─────────────────────────────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toEqual([0, appendsBeforeRetry]);
    const outcome = await outcomeAt(appendsBeforeRetry);
    expect(outcome.replayedPriorTurn).toBe(true);
    expect(fake.readFailuresAtAppendCount).toEqual([appendsBeforeRetry + 1]);
    expect(hasNode(fake.graph, X.id)).toBe(false);

    const observed =
      `observed: status=${retry.status}, draft_graph=${retry.body.draft_graph === undefined ? 'absent' : 'present'}, ` +
      `graph_hash=${String(retry.body.graph_hash)}, assistant_text=${JSON.stringify(retry.body.assistant_text ?? null)}`;
    expect.soft(retry.status, `REFUSAL-REPLAY-REREAD: not a server failure (${observed})`).toBe(200);
    expect.soft(String(retry.body.assistant_text ?? ''), `REFUSAL-REPLAY-REREAD: prose (${observed})`).toBe(
      REPLAY_CHANGE_UNCHECKABLE,
    );
    expect.soft(retry.body.model_version_receipt, `REFUSAL-REPLAY-REREAD: no receipt (${observed})`).toBeUndefined();
    expect.soft(retry.body.draft_graph, `REFUSAL-REPLAY-REREAD: no graph (${observed})`).toBeUndefined();
    expect.soft(retry.body.graph_hash, `REFUSAL-REPLAY-REREAD: no graph_hash (${observed})`).toBeUndefined();
    expect.soft(retry.body.analysis_ready, `REFUSAL-REPLAY-REREAD: no readiness (${observed})`).toBeUndefined();
    expect.soft(committedAttestationsFor(X.id), `REFUSAL-REPLAY-REREAD: no attestation (${observed})`).toBe(0);

    expectNoProviderReached();
  });

  // ── REPLAY, CHANGE NO LONGER IN THE MODEL — the original receipt is withheld ─

  it('REPLAY, CHANGE NO LONGER IN THE MODEL: a genuine replay of my committed add of X whose store no longer holds X — the store hands back the ORIGINAL receipt, but the reply must not present it (or "already recorded") as proof of a change the model does not hold', async () => {
    // As REPLAY: derive the original's committed row (with its receipt) through
    // the REAL route, then install it between the retry's base read and its
    // append — but leave the store's graph WITHOUT X (removed since).
    fake.owned = true;
    const base = jsonCopy(fake.graph);
    expect((await send(addEvent(X, base), MINE)).status).toBe(200);
    const originalRow = fake.rows.get(MINE);
    expect(originalRow?.receipt?.version_id, 'receipt control: the original must mint').toBe(VERSION_IDS[0]);
    const originalVersions = [...fake.versions];
    resetFake();
    appendMock.mockClear();
    logInfoSpy.mockClear();
    loadGraphSnapshots.length = 0;
    fake.owned = true;

    fake.afterNextRead = () => {
      fake.rows.set(MINE, originalRow!);
      fake.versions = [...originalVersions];
    };
    const retry = await send(addEvent(X, base), MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(1);
    expect(fake.afterNextRead, 'the interleaving hook must have run').toBeUndefined();
    expect(appendMock.mock.calls[mineIdx[0]!]![0].request_hash).toBe(originalRow!.request_hash);
    const outcome = await outcomeAt(mineIdx[0]!);
    expect(outcome.replayedPriorTurn).toBe(true);
    // The store DID hand back the original receipt — so the reply's lack of one
    // below is the dispatcher withholding it, not a vacuous absence.
    expect(outcome.modelVersionReceipt?.version_id).toBe(VERSION_IDS[0]);
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.landed).toEqual([]);
    const stored = fake.graph;
    expect(hasNode(stored, X.id)).toBe(false);

    const observed =
      `observed: status=${retry.status}, receipt=${JSON.stringify(
        (retry.body.model_version_receipt as { version_id?: unknown } | undefined)?.version_id ?? null,
      )}, assistant_text=${JSON.stringify(retry.body.assistant_text ?? null)}`;

    expect.soft(retry.status, `REPLAY-GONE: not a server failure (${observed})`).toBe(200);
    const prose = String(retry.body.assistant_text ?? '');
    expect.soft(prose, `REPLAY-GONE: "already recorded" with the change absent (${observed})`).not.toMatch(
      /already been recorded/i,
    );
    expect.soft(prose, `REPLAY-GONE: prose says what is true now (${observed})`).toBe(REPLAY_CHANGE_NOT_IN_MODEL);
    expect.soft(
      retry.body.model_version_receipt,
      `REPLAY-GONE: the original receipt is presented as proof of a change the model does not hold (${observed})`,
    ).toBeUndefined();
    expect.soft(hasNode(retry.body.draft_graph, X.id), `REPLAY-GONE: no X on display (${observed})`).toBe(false);
    expect.soft(retry.body.graph_hash, `REPLAY-GONE: the stored graph's hash (${observed})`).toBe(analysisHash(stored));
    expect.soft(committedAttestationsFor(X.id), `REPLAY-GONE: no success attestation (${observed})`).toBe(0);

    expectNoProviderReached();
  });

  // ── NO PROVIDER ─────────────────────────────────────────────────────────

  it('NO PROVIDER: a first add, a reused-id conflicting add and an interleaved foreign add reach neither the LLM adapter nor the network', async () => {
    const r1 = await send(addEvent(X, fake.graph), MINE);
    expect(r1.status).toBeLessThan(500);
    await send(addEvent(Y, fake.graph), MINE);
    await send(addEvent({ id: 'fac_other', label: 'Other factor' }, fake.graph), FOREIGN);
    // Precondition: the paths actually ran — two landings and one conflict.
    expect(fake.landed).toEqual([MINE, FOREIGN]);
    expect(fake.conflicted).toEqual([MINE]);

    expectNoProviderReached();
  });
});
