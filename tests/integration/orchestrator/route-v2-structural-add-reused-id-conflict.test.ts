/**
 * A REUSED-ID CONFLICT ON `structural_add` MUST NOT ANSWER SUCCESS FOR AN ADD
 * THAT WAS NEVER WRITTEN.
 *
 * FIXTURE ONLY — no production change. Written RED-first against staging
 * d567638d. No case is marked `.fails` / `.skip` / `.todo`: a red that is hidden
 * is a red nobody fixes.
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
  loadGraph: async (_scenarioId: string) => {
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
    // The dispatcher's own attestation (log) — it must not claim Y "verified in
    // the persisted bytes" for an append that wrote nothing.
    expect.soft(
      committedAttestationsFor(Y.id),
      `A: dispatcher logged "structural_add committed … verified in the persisted bytes" for ${Y.id} (${observed})`,
    ).toBe(0);

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
