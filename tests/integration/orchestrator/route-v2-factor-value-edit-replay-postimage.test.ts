/**
 * F3 — A REPLAYED `factor_value_edit` MUST NOT PRESENT BYTES THAT WERE NEVER
 * WRITTEN.
 *
 * The DEFECT case below was RED at staging 57f903c4 (commit a05df8f8, fixture
 * only) and is GREEN with F3's `commit.ts` change. It was never marked
 * `.fails` / `.skip` / `.todo`: a red that is hidden is a red nobody fixes.
 *
 * THE PRODUCT RULE (Paul): "Saved" / applied state rests ONLY on this
 * operation's own committed result. The UI renders the reply's top-level
 * `draft_graph` as the APPLIED postimage (dispatch.ts: "the client reconciles
 * that authoritative postimage from the top-level `draft_graph`"), and
 * `graph_hash` as the hash of what is stored. So whatever those two carriers
 * say is, to the user, what was saved.
 *
 * THE DEFECT, measured on this fixture on 24 Sep 2026 (one-off probe, recorded
 * in `route-v2-own-write-proof.test.ts` P7's closing note): request R (turn T,
 * f-budget := £50k) commits; a FOREIGN writer then commits f-budget := £70k;
 * the client lost R's reply and retries R under the SAME turn_id. The store
 * decides "replay" BEFORE CAS and writes nothing. The reply is then internally
 * contradictory:
 *   · `graph_patch` — `noop`, `after.raw_value` = 70,000 (the STORED value) ✔
 *   · `assistant_text` — "That change had already been recorded … currently
 *     £70k" ✔
 *   · `draft_graph` — f-budget raw_value = 50,000 ✘ the re-run CANDIDATE, never
 *     written
 *   · `graph_hash` — the analysis hash of that candidate ✘ not of the stored
 *     graph
 * A client that renders `draft_graph` shows £50k as applied while the store
 * holds £70k — the same "advertised state ≠ persisted state" class that
 * `persistedAnalysisGraphHash` exists to prevent, reached through the replay
 * branch.
 *
 * CAUSE, read at 57f903c4 (derive the lines at your tip — they move):
 *   · `commit.ts:1635-1637` — `if (priorTurnReplay || priorTurnConflict)`
 *     rewrites the graph_patch to `noop` and the prose to the reread current
 *     state …
 *   · … but `commit.ts:2062-2065` still returns
 *     `persistedAnalysisGraphHash` / `persistedGraph: writesGraph ? graphForStore
 *     : null` — `writesGraph` means "a graph was PROVIDED", not "a graph LANDED",
 *     so on a replay both describe the unwritten candidate;
 *   · `system-events/dispatch.ts:1848-1849` takes both, and `:1903-1911` stamps
 *     `graph_hash` and `draft_graph` from them onto the reply.
 *   The store's replay signal is `SessionAppendOutcome.replayedPriorTurn` /
 *   `priorTurnConflict` (`session/store.ts:119/131`; `supabase-store.ts:294-295`).
 *
 * THE PAIR (same request bytes, same pre-state, only the store's verdict differs):
 *   CONTRAST (GREEN before and after F3) — a foreign writer has set £70k; MY request (£50k) is a
 *     FIRST attempt, lands, and the reply's draft_graph / graph_hash describe the
 *     bytes the append stored.
 *   DEFECT (RED before F3) — MY request was already committed; the foreign writer set
 *     £70k; MY request is REPLAYED. The store writes nothing, so the reply may
 *     either omit `draft_graph` or present the STORED f-budget, and any
 *     `graph_hash` must be the hash of the STORED graph. Either shape of fix
 *     passes; presenting the candidate does not.
 *   NO PROVIDER — every path here is deterministic; the LLM adapter mock and
 *     `fetch` are asserted uncalled.
 *
 * THE FAKE STORE is the minimal subset of the CAS-honouring fake in
 * `route-v2-own-write-proof.test.ts` (copied, not imported), which mirrors
 * `supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql` and
 * `src/orchestrator-v5/session/supabase-store.ts`:
 *   · REPLAY IS DECIDED BEFORE CAS — an existing (scenario_id, turn_id) writes
 *     nothing; same `request_hash` → `replayedPriorTurn`, different →
 *     `priorTurnConflict`;
 *   · ATOMIC CAS on the identity hash (`computeExpectedGraphCasHashes`, the
 *     function the real store stamps with), with the migration's idempotent and
 *     unstamped-row exemptions; a conflict throws `GraphStaleWriteError`.
 *   Guest scenario (no version receipts) except the CONFLICT + INTERLEAVING
 *   case, which turns on the sibling's owned-scenario receipt minting so that
 *   its "no receipt" assertion is not vacuous; and a one-shot `afterNextRead`
 *   hook (the sibling's P7b/P10b device) for a foreign commit landing between a
 *   request's base read and its append.
 *
 * WHAT THIS DELIBERATELY DOES NOT PROVE:
 *   - which reply shape F3 should choose (omit `draft_graph`, or re-derive it and
 *     the hash from the reread stored graph) — both pass;
 *   - the `priorTurnConflict` (reused id, DIFFERENT request) arm WITHOUT an
 *     interleaving writer — only the interleaving variant is pinned (CONFLICT +
 *     INTERLEAVING SAME-TARGET WRITE, below);
 *   - that any consumer attests success from `CommitResult.thisAttemptWrote` — the
 *     field is pinned at the commit seam (`commit-this-attempt-wrote.test.ts`);
 *     no dispatcher reads it yet;
 *   - that the real Postgres function behaves as the fake does; each case asserts
 *     the fake's verdict (landed / replayed) as a precondition instead;
 *   - what the UI renders from the reply.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

// ── the persisted model ────────────────────────────────────────────────────
// The sibling file's fixture, unchanged. `f-budget` is the edited target.
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

// ── the fake canonical store (minimal subset of the sibling's) ─────────────

interface FakeRow {
  readonly id: string;
  readonly request_hash: string;
  readonly receipt?: AtomicCommittedModelVersionReceipt;
}

const VERSION_IDS = [
  'c0000000-0000-4000-8000-0000000000a1',
  'c0000000-0000-4000-8000-0000000000a2',
  'c0000000-0000-4000-8000-0000000000a3',
] as const;

const fake = {
  /** `scenarios.graph` — what the next read returns. */
  graph: buildBaseGraph() as unknown,
  /**
   * `scenarios.user_id IS NOT NULL` — gates the version receipt. Off by default
   * (the guest cases above); the CONFLICT + INTERLEAVING case turns it on so
   * its "no receipt" assertion is not vacuous.
   */
  owned: false,
  /** `v5_conversation_turns`, keyed by turn_id (one scenario in this file). */
  rows: new Map<string, FakeRow>(),
  versions: [] as string[],
  /**
   * Runs once, AFTER the next `loadGraph` has taken its snapshot — a foreign
   * commit landing between a request's base read and its append. Copied from
   * the sibling `route-v2-own-write-proof.test.ts` (P7b / P10b).
   */
  afterNextRead: undefined as (() => void) | undefined,
  /** The fake's own verdicts, per turn_id — asserted as preconditions. */
  landed: [] as string[],
  replayed: [] as string[],
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
  fake.casRejected = [];
}

/** The identity hash the real store stamps on `scenarios.graph_identity_hash`. */
function identityOf(graph: unknown): string | null {
  return computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash;
}

function jsonCopy<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** The sibling file's receipt minter, unchanged (the migration's `source_turn_id` = the write's turn id). */
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
    fake.replayed.push(write.turn_id);
    // As the real RPC does: the durable row's receipt comes back with it.
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
  fake.landed.push(write.turn_id);
  return { id, ...(receipt !== undefined ? { modelVersionReceipt: receipt } : {}) };
});

const fakeStore = {
  append: appendMock,
  readRecent: async () => [],
  readFactsFor: async () => [],
  // A DB read hands back fresh bytes every time; the snapshot is taken BEFORE
  // any interleaved foreign commit runs, which is what "after my base read" means.
  loadGraph: async (_scenarioId: string) => {
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

// ORIENT is the only step that reaches the LLM; every path here stays
// deterministic, and the NO PROVIDER case asserts this mock is never called.
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

const SCENARIO_ID = '44444444-4444-4444-8444-444444444444';
// Distinct, valid v4 UUIDs: MINE is this operation, FOREIGN is another writer.
const MINE = 'a0000000-0000-4000-8000-0000000000f3';
const FOREIGN = 'f0000000-0000-4000-8000-0000000000f3';

const TARGET = 'f-budget';
const REQUESTED_RAW = 50000;
const FOREIGN_RAW = 70000;
const SET_BUDGET_50K = { kind: 'factor_value_edit', target_id: TARGET, value: 0.5, raw_value: REQUESTED_RAW, unit: '£' } as const;
const SET_BUDGET_70K = { kind: 'factor_value_edit', target_id: TARGET, value: 0.7, raw_value: FOREIGN_RAW, unit: '£' } as const;
// CONFLICT + INTERLEAVING: R2 reuses MINE asking for £60k, and a foreign writer
// sets exactly £60k in between. PREP only derives that foreign writer's bytes.
const R2_RAW = 60000;
const SET_BUDGET_60K = { kind: 'factor_value_edit', target_id: TARGET, value: 0.6, raw_value: R2_RAW, unit: '£' } as const;
const PREP = 'e0000000-0000-4000-8000-0000000000f3';

let app: FastifyInstance;
// Belt and braces for "no provider": any real SDK call goes through fetch.
let fetchSpy: ReturnType<typeof vi.spyOn>;

async function send(event: Record<string, unknown>, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: { kind: 'system_event', turn_id: turnId, scenario_id: SCENARIO_ID, stage: 'analyse', event },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

/** Indices (into appendMock.mock.calls) of every append ATTEMPTED for a turn. */
function appendIndicesFor(turnId: string): number[] {
  return appendMock.mock.calls.flatMap((c, i) => (c[0].turn_id === turnId ? [i] : []));
}

/** What the store RETURNED to the commit for the append at that index. */
async function outcomeAt(index: number): Promise<SessionAppendOutcome> {
  return (await appendMock.mock.results[index]?.value) as SessionAppendOutcome;
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

function expectNoProviderReached() {
  expect(llmChatMock, 'an LLM adapter was called on a deterministic path').not.toHaveBeenCalled();
  expect(fetchSpy, 'a network call was attempted on a no-provider path').not.toHaveBeenCalled();
}

describe('POST /orchestrate/v2/turn — factor_value_edit REPLAY: the reply presents only bytes the store holds (F3)', () => {
  beforeAll(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch attempted in a no-provider test');
    });
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fetchSpy.mockRestore();
  });

  beforeEach(() => {
    appendMock.mockClear();
    llmChatMock.mockClear();
    fetchSpy.mockClear();
    resetFake();
  });

  // ── CONTRAST — GREEN before and after F3 ───────────────────────────────────────────────

  it('CONTRAST: a FIRST attempt of the edit (after a foreign writer set £70k) lands, and the reply draft_graph / graph_hash describe the bytes the append stored', async () => {
    const foreign = await send(SET_BUDGET_70K, FOREIGN);
    expect(foreign.status).toBe(200);
    expect(rawValueOf(fake.graph, TARGET)).toBe(FOREIGN_RAW);

    const { status, body } = await send(SET_BUDGET_50K, MINE);
    expect(status).toBe(200);

    // Preconditions: exactly one append for MY turn, it LANDED (not a replay),
    // and the stored bytes are the bytes it carried.
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(1);
    const mineWrite = appendMock.mock.calls[mineIdx[0]!]![0];
    const outcome = await outcomeAt(mineIdx[0]!);
    expect(outcome.replayedPriorTurn).toBeUndefined();
    expect(outcome.priorTurnConflict).toBeUndefined();
    expect(fake.landed).toEqual([FOREIGN, MINE]);
    expect(fake.replayed).toEqual([]);
    expect(fake.casRejected).toEqual([]);
    expect(identityOf(fake.graph)).toBe(identityOf(mineWrite.graph));
    const stored = fake.graph;
    expect(rawValueOf(stored, TARGET)).toBe(REQUESTED_RAW);

    // The reply's patch and postimage, bound to MY target and the STORED bytes.
    const patches = graphPatches(body);
    expect(patches.map((p) => p.target_id)).toEqual([TARGET]);
    expect(patches[0]?.status).toBe('applied');
    expect(body.draft_graph, 'a landed edit must carry its applied postimage').toBeDefined();
    expect(rawValueOf(body.draft_graph, TARGET)).toBe(REQUESTED_RAW);
    expect(rawValueOf(body.draft_graph, TARGET)).toBe(rawValueOf(stored, TARGET));
    expect(body.graph_hash).toBe(analysisHash(stored));

    expectNoProviderReached();
  });

  // ── DEFECT — RED before F3 ─────────────────────────────────────────

  it('DEFECT (RED before F3): a REPLAY of MY committed edit after a foreign writer set £70k must not present the unwritten £50k candidate as draft_graph or graph_hash', async () => {
    const first = await send(SET_BUDGET_50K, MINE);
    expect(first.status).toBe(200);
    expect(graphPatches(first.body)[0]?.status).toBe('applied');

    const foreign = await send(SET_BUDGET_70K, FOREIGN);
    expect(foreign.status).toBe(200);

    // The client lost MY reply and retries the IDENTICAL request.
    const storedBeforeRetry = jsonCopy(fake.graph);
    const retry = await send(SET_BUDGET_50K, MINE);

    // ── PREMISE, proven inside the test ─────────────────────────────────────
    // (a) the store signalled a replay for MY turn and wrote nothing;
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    const retryIdx = mineIdx[1]!;
    const retryWrite = appendMock.mock.calls[retryIdx]![0];
    expect(retryWrite.request_hash).toBe(appendMock.mock.calls[mineIdx[0]!]![0].request_hash);
    expect((await outcomeAt(retryIdx)).replayedPriorTurn).toBe(true);
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.landed).toEqual([MINE, FOREIGN]);
    expect(identityOf(fake.graph)).toBe(identityOf(storedBeforeRetry));
    // (b) the stored value is NOT the requested value;
    const stored = fake.graph;
    const storedRaw = rawValueOf(stored, TARGET);
    expect(storedRaw).toBe(FOREIGN_RAW);
    expect(storedRaw).not.toBe(REQUESTED_RAW);
    // (c) the replay's re-run candidate — the bytes the store REFUSED — differs
    //     from the stored graph in the analysis hash, so the hash check below
    //     discriminates.
    expect(rawValueOf(retryWrite.graph, TARGET)).toBe(REQUESTED_RAW);
    const storedHash = analysisHash(stored);
    const candidateHash = analysisHash(retryWrite.graph);
    expect(candidateHash).not.toBe(storedHash);

    // Today's replay reconciliation on the patch and prose (already correct —
    // pinned so a fix to the postimage cannot regress them).
    expect(retry.status).toBe(200);
    const patches = graphPatches(retry.body);
    expect(patches.map((p) => p.target_id)).toEqual([TARGET]);
    expect(patches[0]?.status).toBe('noop');
    expect((patches[0]?.after as Record<string, unknown> | null)?.raw_value).toBe(storedRaw);

    // ── THE DEFECT ──────────────────────────────────────────────────────────
    // The reply may omit `draft_graph`, or present the STORED target — never
    // the candidate the store never wrote.
    const replyDraftRaw = retry.body.draft_graph === undefined ? undefined : rawValueOf(retry.body.draft_graph, TARGET);
    const observed =
      `observed: reply draft_graph ${TARGET}.raw_value=${String(replyDraftRaw)}, ` +
      `reply graph_hash=${String(retry.body.graph_hash)}, ` +
      `stored ${TARGET}.raw_value=${String(storedRaw)}, stored graph hash=${storedHash}, ` +
      `replay-candidate hash=${candidateHash}`;
    // `expect.soft` so each carrier reports on its own: a fix to one must not
    // hide the other still being wrong.
    if (retry.body.draft_graph !== undefined) {
      expect.soft(
        replyDraftRaw,
        `F3: reply presents bytes that were never written — draft_graph ${TARGET} is the replay candidate, not the stored value (${observed})`,
      ).toBe(storedRaw);
    }
    if (retry.body.graph_hash !== undefined) {
      expect.soft(
        retry.body.graph_hash,
        `F3: reply presents bytes that were never written — graph_hash is not the hash of the stored graph (${observed})`,
      ).toBe(storedHash);
    }

    // ── THE SHAPE F3 CHOSE ──────────────────────────────────────────────────
    // `commit.ts` hands back its authoritative reread on a replay, so the reply
    // PRESENTS the stored graph rather than omitting it: the UI reconciles to
    // what is actually stored (£70k) instead of keeping an optimistic £50k. Pinned
    // here so a later "just omit both carriers" change is a visible decision.
    expect(retry.body.draft_graph, `F3 shape: the reply presents the stored graph (${observed})`).toBeDefined();
    expect(replyDraftRaw).toBe(storedRaw);
    expect(retry.body.graph_hash, `F3 shape: graph_hash is the stored graph's hash (${observed})`).toBe(storedHash);

    expectNoProviderReached();
  });

  // ── REGRESSION GUARD — the path that works today must not move (RC 5821175162) ──
  //
  // A genuine replay with NO interleaving writer: my request committed, nobody
  // else wrote, the client lost my reply and retried. The store holds exactly my
  // first attempt's postimage, so the retry must present the SAME `draft_graph`
  // and `graph_hash` as my first reply, byte for byte (bound by sha256 of the
  // serialised wire field). GREEN before and after F3.
  //
  // ⚠ WHICH MUTANT THIS CAN AND CANNOT CATCH. On this path the re-run candidate
  //   and the stored bytes are equal (premise (c) below proves it), so "return
  //   the candidate on replay" is indistinguishable here BY CONSTRUCTION. That
  //   mutant is killed by the DEFECT case above, where a foreign writer makes
  //   them differ. What this case catches is a fix that MOVES the working path:
  //   omitting the postimage on replay (null), or hashing a different projection.
  it('REGRESSION GUARD: a genuine replay with no interleaving writer presents the same draft_graph and graph_hash as my first reply, byte for byte', async () => {
    const first = await send(SET_BUDGET_50K, MINE);
    expect(first.status).toBe(200);
    expect(graphPatches(first.body)[0]?.status).toBe('applied');
    expect(first.body.draft_graph).toBeDefined();
    expect(typeof first.body.graph_hash).toBe('string');

    const storedBeforeRetry = jsonCopy(fake.graph);
    const retry = await send(SET_BUDGET_50K, MINE);

    // ── PREMISE ─────────────────────────────────────────────────────────────
    // (a) a replay of MY turn, nothing written, nobody else wrote;
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    expect((await outcomeAt(mineIdx[1]!)).replayedPriorTurn).toBe(true);
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.landed).toEqual([MINE]);
    expect(identityOf(fake.graph)).toBe(identityOf(storedBeforeRetry));
    // (b) the store holds my first attempt's bytes;
    expect(identityOf(fake.graph)).toBe(identityOf(appendMock.mock.calls[mineIdx[0]!]![0].graph));
    // (c) the candidate equals the stored graph in the analysis hash (why the
    //     candidate mutant cannot discriminate here).
    expect(analysisHash(appendMock.mock.calls[mineIdx[1]!]![0].graph)).toBe(analysisHash(fake.graph));

    // ── THE GUARD ───────────────────────────────────────────────────────────
    expect(retry.status).toBe(200);
    expect(graphPatches(retry.body)[0]?.status).toBe('noop');
    const sha = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    expect(retry.body.draft_graph, 'the replay must still present a postimage').toBeDefined();
    expect(sha(retry.body.draft_graph)).toBe(sha(first.body.draft_graph));
    expect(retry.body.graph_hash).toBe(first.body.graph_hash);
    expect(retry.body.graph_hash).toBe(analysisHash(fake.graph));

    expectNoProviderReached();
  });

  // ── CONFLICT + INTERLEAVING SAME-TARGET WRITE (Codex 5821693599) ──────────
  //
  // THE OBJECTION: on a reused-id conflict the reply's snapshot is the reread
  // stored graph (right, for display). If ANOTHER writer has meanwhile set the
  // SAME target to the SAME value this request asked for, that snapshot holds
  // "my" value — and a consumer that attests success from "a graph was provided
  // AND the snapshot contains my change" is satisfied for the wrong operation.
  //
  // THIS CASE pins the reply for exactly that interleaving: R2's reply makes NO
  // success claim (noop patch, no receipt, "did not make that change") while its
  // draft_graph / graph_hash are the STORED snapshot, which shows the value R2
  // asked for. The snapshot may agree with R2; R2 still claims nothing.
  //
  // ⚠ WHAT THIS DOES NOT PROVE. On this path (`factor_value_edit`) the reply was
  //   already correct before `CommitResult.thisAttemptWrote` existed — the
  //   commit's conflict branch rewrites the patch, receipt and prose itself, and
  //   the dispatcher does not read the new field. This is a reply-level pin, not
  //   a RED test for the field; the field's RED is the commit-level file
  //   `src/orchestrator-v5/__tests__/commit-this-attempt-wrote.test.ts`. The
  //   structural-add consumer Codex named is a separate follow-up.
  it('CONFLICT + INTERLEAVING SAME-TARGET WRITE: a reused turn id (R2, £60k) makes no success claim even though a foreign writer set exactly £60k between R2\'s base read and its append, and the reply presents that STORED snapshot', async () => {
    // ── derive the foreign writer's bytes through the REAL route ────────────
    // A foreign factor_value_edit(£60k), run on a fresh fake and then discarded,
    // so the interleaved graph is what this route would actually store rather
    // than a hand-edited copy (display fields included).
    fake.owned = false;
    expect((await send(SET_BUDGET_60K, PREP)).status).toBe(200);
    expect(fake.landed).toEqual([PREP]);
    const foreignGraph = jsonCopy(fake.graph);
    expect(rawValueOf(foreignGraph, TARGET)).toBe(R2_RAW);
    resetFake();
    appendMock.mockClear();

    // ── R1: MY request (turn T, £50k) commits on an OWNED scenario ─────────
    fake.owned = true;
    const r1 = await send(SET_BUDGET_50K, MINE);
    expect(r1.status).toBe(200);
    expect(graphPatches(r1.body)[0]?.status).toBe('applied');
    // Control: this fixture DOES mint receipts, so R2's "no receipt" is not vacuous.
    const r1Receipt = r1.body.model_version_receipt as Record<string, unknown> | undefined;
    expect(r1Receipt?.version_id).toBe(VERSION_IDS[0]);
    expect(r1Receipt?.source_turn_id).toBe(MINE);
    const storedAfterR1 = jsonCopy(fake.graph);
    expect(rawValueOf(storedAfterR1, TARGET)).toBe(REQUESTED_RAW);
    const versionsAfterR1 = [...fake.versions];

    // Premise on the foreign bytes: they are R1's stored graph with ONLY the
    // target moved — what a CAS'd writer building on R1's commit would store.
    const without = (g: unknown) => {
      const c = jsonCopy(g) as { nodes: Array<{ id: string }> };
      c.nodes = c.nodes.filter((n) => n.id !== TARGET);
      return c;
    };
    expect(without(foreignGraph)).toEqual(without(storedAfterR1));
    expect(identityOf(foreignGraph)).not.toBe(identityOf(storedAfterR1));

    // ── the interleaved foreign write: after R2's base read, before its append ──
    let appendsWhenForeignLanded: number | undefined;
    fake.afterNextRead = () => {
      appendsWhenForeignLanded = appendMock.mock.calls.length;
      fake.graph = jsonCopy(foreignGraph);
      fake.rows.set(FOREIGN, { id: `row-${FOREIGN}`, request_hash: 'sha256:foreign-60k' });
    };

    // ── R2: a DIFFERENT request reusing turn T (£60k) ─────────────────────────
    const r2 = await send(SET_BUDGET_60K, MINE);

    // ── PREMISE, proven inside the test ──────────────────────────────────────
    const mineIdx = appendIndicesFor(MINE);
    expect(mineIdx).toHaveLength(2);
    const r2Idx = mineIdx[1]!;
    const r2Write = appendMock.mock.calls[r2Idx]![0];
    // (a) R2 is a DIFFERENT request under the same turn id, asking for £60k;
    expect(r2Write.request_hash).not.toBe(appendMock.mock.calls[mineIdx[0]!]![0].request_hash);
    expect(rawValueOf(r2Write.graph, TARGET)).toBe(R2_RAW);
    // (b) the foreign write landed, and it landed BEFORE R2's append was attempted;
    expect(fake.afterNextRead, 'the interleaving hook must have run').toBeUndefined();
    expect(fake.rows.has(FOREIGN)).toBe(true);
    expect(appendsWhenForeignLanded).toBe(r2Idx);
    // (c) the store signalled priorTurnConflict for R2, handed back R1's receipt,
    //     and wrote and minted nothing;
    const r2Outcome = await outcomeAt(r2Idx);
    expect(r2Outcome.priorTurnConflict).toBe(true);
    expect(r2Outcome.replayedPriorTurn).toBeUndefined();
    expect(r2Outcome.modelVersionReceipt?.version_id).toBe(VERSION_IDS[0]);
    expect(fake.replayed).toEqual([MINE]);
    expect(fake.landed).toEqual([MINE]);
    expect(fake.casRejected).toEqual([]);
    expect(fake.versions).toEqual(versionsAfterR1);
    // (d) the stored value now EQUALS what R2 asked for — set by the foreign writer.
    const stored = fake.graph;
    expect(identityOf(stored)).toBe(identityOf(foreignGraph));
    expect(rawValueOf(stored, TARGET)).toBe(R2_RAW);

    // ── R2 MAKES NO SUCCESS CLAIM ─────────────────────────────────────────────
    expect(r2.status).toBe(200);
    const patches = graphPatches(r2.body);
    expect(patches.map((p) => p.target_id)).toEqual([TARGET]);
    expect(patches[0]?.status).toBe('noop');
    expect(patches.filter((p) => p.status === 'applied')).toEqual([]);
    expect(r2.body.model_version_receipt, 'the handed-back receipt is R1\'s, not R2\'s').toBeUndefined();
    const prose = String(r2.body.assistant_text ?? '');
    expect(prose).toMatch(/did not make that change/i);
    expect(prose).not.toMatch(/already been recorded/i);
    expect(prose).not.toMatch(/\bUpdated\b/i);

    // ── …WHILE THE SNAPSHOT IS THE STORED GRAPH, WHICH SHOWS R2's VALUE ──────
    expect(r2.body.draft_graph, 'the reply presents the stored snapshot (F3)').toBeDefined();
    expect(rawValueOf(r2.body.draft_graph, TARGET)).toBe(rawValueOf(stored, TARGET));
    expect(rawValueOf(r2.body.draft_graph, TARGET)).toBe(R2_RAW);
    expect(r2.body.graph_hash).toBe(analysisHash(stored));

    expectNoProviderReached();
  });

  // ── NO PROVIDER ──────────────────────────────────────────────────────────

  it('NO PROVIDER: a first commit, a foreign commit and a replay reach neither the LLM adapter nor the network', async () => {
    expect((await send(SET_BUDGET_50K, MINE)).status).toBe(200);
    expect((await send(SET_BUDGET_70K, FOREIGN)).status).toBe(200);
    expect((await send(SET_BUDGET_50K, MINE)).status).toBe(200);
    // Precondition: all three paths actually ran — two landings and one replay.
    expect(fake.landed).toEqual([MINE, FOREIGN]);
    expect(fake.replayed).toEqual([MINE]);

    expectNoProviderReached();
  });
});
