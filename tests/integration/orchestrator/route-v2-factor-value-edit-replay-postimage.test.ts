/**
 * F3 — A REPLAYED `factor_value_edit` MUST NOT PRESENT BYTES THAT WERE NEVER
 * WRITTEN.
 *
 * ⛔ RED BY DESIGN until F3 lands. The DEFECT case below fails on purpose at the
 *    commit this file was written against (staging 57f903c4). It is NOT marked
 *    `.fails` / `.skip` / `.todo`: a red that is hidden is a red nobody fixes.
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
 *   CONTRAST (GREEN today) — a foreign writer has set £70k; MY request (£50k) is a
 *     FIRST attempt, lands, and the reply's draft_graph / graph_hash describe the
 *     bytes the append stored.
 *   DEFECT (RED today) — MY request was already committed; the foreign writer set
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
 *   Guest scenario throughout (no version receipts) — receipts are P1-owner's
 *   concern in the sibling file, not this one's.
 *
 * WHAT THIS DELIBERATELY DOES NOT PROVE:
 *   - which reply shape F3 should choose (omit `draft_graph`, or re-derive it and
 *     the hash from the reread stored graph) — both pass;
 *   - the `priorTurnConflict` (reused id, DIFFERENT request) arm, which shares the
 *     same return path and is expected to share the same fix — not pinned here;
 *   - that the real Postgres function behaves as the fake does; each case asserts
 *     the fake's verdict (landed / replayed) as a precondition instead;
 *   - what the UI renders from the reply.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { computeExpectedGraphCasHashes } from '../../../src/orchestrator-v5/context/graph-cas-conflict.js';
import {
  GraphStaleWriteError,
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
}

const fake = {
  /** `scenarios.graph` — what the next read returns. */
  graph: buildBaseGraph() as unknown,
  /** `v5_conversation_turns`, keyed by turn_id (one scenario in this file). */
  rows: new Map<string, FakeRow>(),
  /** The fake's own verdicts, per turn_id — asserted as preconditions. */
  landed: [] as string[],
  replayed: [] as string[],
  casRejected: [] as string[],
};

function resetFake() {
  fake.graph = buildBaseGraph();
  fake.rows = new Map();
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
    return prior.request_hash === write.request_hash
      ? { id: prior.id, replayedPriorTurn: true }
      : { id: prior.id, priorTurnConflict: true };
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

  // 3. LAND — graph and turn row (guest scenario: no version receipt).
  const id = `row-${write.turn_id}`;
  fake.graph = jsonCopy(write.graph);
  fake.rows.set(write.turn_id, { id, request_hash: write.request_hash });
  fake.landed.push(write.turn_id);
  return { id };
});

const fakeStore = {
  append: appendMock,
  readRecent: async () => [],
  readFactsFor: async () => [],
  // A DB read hands back fresh bytes every time.
  loadGraph: async (_scenarioId: string) => jsonCopy(fake.graph),
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

describe('POST /orchestrate/v2/turn — factor_value_edit REPLAY: the reply presents only bytes the store holds (F3, RED BY DESIGN)', () => {
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

  // ── CONTRAST — GREEN today ───────────────────────────────────────────────

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

  // ── DEFECT — RED today, until F3 ─────────────────────────────────────────

  it('DEFECT (RED until F3): a REPLAY of MY committed edit after a foreign writer set £70k must not present the unwritten £50k candidate as draft_graph or graph_hash', async () => {
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
