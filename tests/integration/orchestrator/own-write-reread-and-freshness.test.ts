/**
 * OWN-WRITE PROOF — the reread after reload, and the freshness it reports.
 *
 * Product rule (Paul): "Saved" rests ONLY on this operation's own canonical
 * commit result — never on a moved graph hash, never on the target happening
 * to hold the requested value. The commit result is only worth resting on if
 * the reload path reads back exactly what that commit wrote, and tells the
 * truth about the analysis the write just invalidated. That is what this file
 * pins, across the two real routes, over ONE store.
 *
 * WHAT IS PINNED
 *
 *   P8  AUTHORITATIVE REREAD. After a COMMITTED `factor_value_edit`, the reload
 *       read (`POST /assist/v1/scenarios/:id/graph`) serves the exact bytes the
 *       commit handed `store.append`, the edited node (by id) carries the
 *       committed value, and its `graph_hash` equals the edit reply's
 *       `graph_hash` — both equal to the repo's own hash of the appended bytes.
 *       A REFUSED twin leaves the reread on the pre-edit bytes and hash, so the
 *       reread cannot be agreeing with the REQUEST rather than the COMMIT.
 *       A CONCURRENT-WRITER twin lands a foreign graph right AFTER this
 *       commit's append: the reply's `graph_hash` and `draft_graph` still name
 *       THIS commit's bytes (never "whatever the store holds now"), while the
 *       reload serves the foreign bytes and their hash — so a reply hash taken
 *       from a post-commit re-read cannot pass for the commit's own.
 *
 *   P9  FRESHNESS ACROSS THE SAME SEAM, from a REAL prior successful
 *       `run_analysis` fact stamped with the pre-edit analysis hash:
 *         (a) before the edit the read reports `complete_current` + a result;
 *         (b) after the edit the reply says `stale` AND the read reports
 *             `complete_stale` with no `analysis_result`;
 *         (c) a new SUCCESSFUL run stamped with the post-edit hash makes the
 *             read current again, bound to THAT run's timestamp and numbers;
 *         (d) a FAILED / refused run stamped with the post-edit hash — and
 *             NEWER than the successful one, so a status-blind selector would
 *             pick it — does NOT make it current.
 *
 * HOW. One in-memory store fake that BOTH routes read. `append` stores the
 * graph it is handed as jsonb would (a JSON round-trip), and only when the
 * graph is non-null — the same rule as `p_graph: write.graph ?? null` into
 * `append_turn_atomic`'s `IF p_graph IS NOT NULL`. `loadGraph` and
 * `loadGraphAndBriefText` return those stored bytes. `readRecent` serves the
 * rows `append` wrote, newest-first, windowed at `SESSION_READ_WINDOW_DEFAULT`;
 * `readFactsFor` serves the facts on those rows. So neither route can be
 * satisfied by a per-route stub that happens to agree with the assertion.
 *
 * The facts take the store's real round trip, not a shortcut. On write each is
 * projected as `serialiseHandlerFacts` projects it (`payload` = {fact_type,
 * fact_version, result}, `noop` on its own column); on read it is rejoined and
 * run through the strict `HandlerFactSchema`, throwing `SessionReadError` on a
 * failure, as `readFactsWithTurnFor` does (supabase-store.ts). The loader
 * swallows that throw into a `degraded` read, so every failure is also recorded
 * and `afterEach` names it — a fact the real store could not serve cannot pass
 * here as a quiet `unknown`. Every seeded run fact must also parse BEFORE it
 * lands: that is the type the real writer hands `append`.
 *
 * `beforeAll` drives one committed edit and one reread on a SEPARATE scenario
 * id, so the cold start of both routes is paid in the hook (60s budget), not
 * inside the first test's 5s one.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE
 *   · The Supabase RPC. The fake does not model graph CAS, the turn fence,
 *     replay / conflict (`replayedPriorTurn` / `priorTurnConflict`), the
 *     model-version receipt (this is a GUEST scenario — no owner, no receipt)
 *     or `analysis_invalidated_at` (absent ⇒ freshness is decided by hash).
 *   · The 20-row `readRecent` window. Every fixture here stays well inside it,
 *     and each read asserts so; a fact pushed OUT of the window is a separate
 *     fixture with a separate defect.
 *   · The durable scenario-wide fact read (`readScenarioRunAnalysisFactsFor`)
 *     that the MESSAGE-turn path uses. Neither route exercised here reads it:
 *     the read route goes through `loadPriorFactsWithReadState`, and the
 *     system-event branch never builds a turn context. That is asserted, not
 *     assumed — see `afterEach`.
 *   · A concurrent CAS conflict on the value edit. Separate fixture. The
 *     concurrent writer in P8 lands AFTER this commit, so there is no conflict
 *     for the fake to decide.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';

import { SessionReadError, type SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';
import { SESSION_READ_WINDOW_DEFAULT } from '../../../src/orchestrator-v5/session/index.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../utils/mock-session-store.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
/** Only `beforeAll`'s warm-up touches this one — see the header. */
const WARMUP_SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

// ── the persisted model ────────────────────────────────────────────────────
// The value-edit suite's fixture (`route-v2-factor-value-edit.test.ts`), with a
// second option so the seeded analysis compares two real option ids.
// `f-budget` is capped at 100000 with unit £, currently £40,000 (value 0.4).
// The P8 concurrent writer reuses the same model with a different budget.
function buildSeedGraph(budget: { readonly value: number; readonly raw_value: number } = {
  value: 0.4,
  raw_value: 40000,
}) {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: budget.value, raw_value: budget.raw_value, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
      { id: 'o-hold', kind: 'option', label: 'Hold for a quarter' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

/** Derived with the production function over the seed bytes — never typed in. */
const PRE_EDIT_HASH = computeAnalysisAffectingGraphHash(buildSeedGraph() as never)!;

const PRE_RUN_AT = '2026-09-24T09:00:00.000Z';
const POST_RUN_AT = '2026-09-24T09:05:00.000Z';
// NEWER than POST_RUN_AT on purpose: a selector that ignored status would pick it.
const FAILED_RUN_AT = '2026-09-24T09:06:00.000Z';

const PRE_RUN_WIN = { 'o-launch': 0.68, 'o-hold': 0.32 };
const POST_RUN_WIN = { 'o-launch': 0.74, 'o-hold': 0.26 };

/**
 * A committed run. Same shape as `runAnalysisFact` in
 * `src/routes/__tests__/assist.v1.scenario-graph.analysis-read.test.ts`; the
 * status is a parameter because (d) needs a non-success one. NO top-level
 * `turn_id`: the strict `HandlerFactSchema` rejects it, and `landRun` refuses
 * any fact that does not parse.
 */
function runAnalysisFact(opts: {
  readonly graphHash: string;
  readonly computedAt: string;
  readonly win: Record<string, number>;
  readonly analysisStatus: string;
  readonly scenarioId?: string;
}): Record<string, unknown> {
  const [leader] = Object.entries(opts.win).sort((a, b) => b[1] - a[1])[0]!;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: opts.scenarioId ?? SCENARIO_ID,
      leading_option_id: leader,
      summary: 'Launching now leads on the current model.',
      graph_hash_at_run: opts.graphHash,
      computed_at: opts.computedAt,
      win_probabilities: opts.win,
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible',
      },
      enrichment: {
        analysis_status: opts.analysisStatus,
        robustness: { level: 'moderate', near_tie: false },
        option_comparison: Object.entries(opts.win).map(([option_id, p]) => ({
          option_id,
          option_label: option_id,
          win_probability: p,
          outcome_mean: p,
        })),
      },
    },
  };
}

// ── THE ONE STORE BOTH ROUTES READ ──────────────────────────────────────────

/** One `v5_handler_facts` row, in the shape `serialiseHandlerFacts` sends the RPC. */
interface StoredFact {
  readonly handler_id: string;
  readonly action_type: string;
  readonly noop?: boolean;
  readonly payload: unknown;
}

interface FakeRow {
  readonly id: string;
  readonly turn_id: string;
  readonly handler_id: string | null;
  readonly handler_facts: readonly StoredFact[];
}

/** jsonb semantics: what a JSONB column hands back is a parse of what went in. */
function jsonb<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

const db = {
  graph: null as unknown,
  /** Newest-first, which is `readRecent`'s order (`created_at DESC`). */
  rows: [] as FakeRow[],
  seq: 0,
};

/** The write-side projection, as `serialiseHandlerFacts` (supabase-store.ts) makes it. */
function serialiseLikeTheStore(facts: readonly unknown[]): StoredFact[] {
  return (facts as Array<{ fact_type: string; fact_version: unknown; noop?: boolean; result: unknown }>).map(
    (f) => ({
      handler_id: f.fact_type,
      action_type: f.fact_type,
      noop: f.noop,
      payload: { fact_type: f.fact_type, fact_version: f.fact_version, result: f.result },
    }),
  );
}

function insertRow(turnId: string, handlerId: string | null, facts: readonly unknown[]): string {
  db.seq += 1;
  const id = `row-${String(db.seq).padStart(4, '0')}`;
  db.rows.unshift({
    id,
    turn_id: turnId,
    handler_id: handlerId,
    handler_facts: jsonb(serialiseLikeTheStore(facts)),
  });
  return id;
}

/**
 * P8's concurrent writer: when set, the NEXT append that writes a graph is
 * followed at once by a foreign turn that overwrites `scenarios.graph` with
 * these bytes. Cleared once it lands, and in `beforeEach`, so it cannot leak.
 */
let foreignGraphAfterNextCommit: unknown = null;

/** Every write the routes make lands here; the spy keeps the exact argument. */
const appendSpy = vi.fn(async (write: SessionTurnWrite) => {
  if (write.graph != null) db.graph = jsonb(write.graph);
  const id = insertRow(write.turn_id, write.handler_id, write.handler_facts);
  if (write.graph != null && foreignGraphAfterNextCommit !== null) {
    db.graph = jsonb(foreignGraphAfterNextCommit);
    insertRow(nextTurnId(), null, []);
    foreignGraphAfterNextCommit = null;
  }
  return { id };
});

/**
 * Every `HandlerFactSchema` failure the fake's fact read hit. The real read
 * THROWS, and `loadPriorFactsWithReadState` turns that into a quiet `degraded`
 * read — so `afterEach` asserts this list is empty rather than trusting a
 * downstream `unknown` to surface it.
 */
const factParseFailures: string[] = [];

/**
 * `readFactsWithTurnFor`'s read side (supabase-store.ts): rejoin `payload` with
 * the `noop` column (payload-side `noop`, then `false`, as fallbacks), then the
 * strict schema parse — a failure throws, it is never skipped.
 */
function readFactsLikeTheStore(rowIds: readonly string[], handlerId?: string): unknown[] {
  const out: unknown[] = [];
  // `db.rows` is newest-first, the real read's `ORDER BY created_at DESC`.
  for (const row of db.rows) {
    if (!rowIds.includes(row.id)) continue;
    for (const stored of jsonb(row.handler_facts)) {
      if (handlerId !== undefined && stored.handler_id !== handlerId) continue;
      const payloadObj =
        stored.payload && typeof stored.payload === 'object' && !Array.isArray(stored.payload)
          ? (stored.payload as Record<string, unknown>)
          : {};
      const noop =
        typeof stored.noop === 'boolean'
          ? stored.noop
          : typeof payloadObj.noop === 'boolean'
            ? payloadObj.noop
            : false;
      const parsed = HandlerFactSchema.safeParse({ ...payloadObj, noop });
      if (!parsed.success) {
        const message = `readFactsWithTurnFor: payload failed HandlerFactSchema — ${parsed.error.message}`;
        factParseFailures.push(message);
        throw new SessionReadError(message, { cause: parsed.error });
      }
      out.push(parsed.data);
    }
  }
  return out;
}

/**
 * Reads the fake does NOT model coherently with its rows. Neither route under
 * test should touch them; if one starts to, `afterEach` goes red and the fake
 * must learn to answer from `db` rather than from a benign empty default.
 */
const unmodelledReads = {
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  readNewestAnalysisFactFor: vi.fn(async () => null),
  readFactsWithTurnFor: vi.fn(async () => []),
};

let windowOverflowed = false;

const store = createMockSessionStore({
  ...unmodelledReads,
  append: appendSpy as never,
  readRecent: async (scenarioId: string, limit?: number) => {
    const window = limit ?? SESSION_READ_WINDOW_DEFAULT;
    // Every fixture here must sit well inside the window — see the header.
    if (db.rows.length >= window) windowOverflowed = true;
    return db.rows.slice(0, window).map((r, i) =>
      makeSessionTurnRow({
        id: r.id,
        scenario_id: scenarioId,
        turn_id: r.turn_id,
        turn_class: r.handler_id === null ? 'direct_answer' : 'handler',
        handler_id: r.handler_id as never,
        created_at: new Date(Date.UTC(2026, 8, 24, 12, 0, 0) - i * 1000).toISOString(),
      }),
    );
  },
  readFactsFor: async (rowIds: readonly string[], handlerId?: string) =>
    readFactsLikeTheStore(rowIds, handlerId) as never,
  loadGraph: async () => jsonb(db.graph),
  loadGraphAndBriefText: async () => ({ graph: jsonb(db.graph), briefText: null }),
  scenarioExists: async () => true,
  // GUEST scenario: no owner, so the ownership pre-flight admits an anonymous
  // caller on both routes and no model-version receipt is minted.
  ensureScenarioExists: async () => ({ user_id: null }),
  getScenarioOwner: async () => null,
});

vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>()),
  getSessionStore: () => store,
  resetSessionStoreForTests: () => {},
}));

// TurnExecutor's ORIENT step is the only thing that reaches the LLM. Asserting
// this was never called proves every edit here stayed deterministic.
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
const { default: scenarioGraphRoute } = await import('../../../src/routes/assist.v1.scenario-graph.js');

// ── helpers ─────────────────────────────────────────────────────────────────

let turnSeq = 0;
function nextTurnId(): string {
  turnSeq += 1;
  return `44444444-4444-4444-8444-${String(turnSeq).padStart(12, '0')}`;
}

async function editValue(
  app: FastifyInstance,
  event: Record<string, unknown>,
  scenarioId: string = SCENARIO_ID,
) {
  const turnId = nextTurnId();
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'system_event',
      turn_id: turnId,
      scenario_id: scenarioId,
      stage: 'analyse',
      event: { kind: 'factor_value_edit', ...event },
    },
  });
  return { res, body: JSON.parse(res.body) as Record<string, any>, turnId };
}

/** The reload read — the path a browser takes after a refresh. */
async function reread(app: FastifyInstance, scenarioId: string = SCENARIO_ID) {
  const res = await app.inject({
    method: 'POST',
    url: `/assist/v1/scenarios/${scenarioId}/graph`,
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, any>;
}

/** The exact write THIS turn handed the store, found by the turn's own id. */
function writeFor(turnId: string): SessionTurnWrite {
  const writes = appendSpy.mock.calls.map((c) => c[0]).filter((w) => w.turn_id === turnId);
  expect(writes, `exactly one append for turn ${turnId}`).toHaveLength(1);
  return writes[0]!;
}

/**
 * The repo's own analysis hash of the graph THIS turn handed `append` — a
 * string, or the premise is broken (a `null` would slip past `not.toBe(PRE)`).
 */
function committedHashFor(turnId: string): string {
  const committed = writeFor(turnId).graph;
  expect(committed, `turn ${turnId} handed append a graph`).toBeDefined();
  const hash = computeAnalysisAffectingGraphHash(committed as never);
  expect(typeof hash).toBe('string');
  expect(hash).not.toBe(PRE_EDIT_HASH);
  return hash as string;
}

function nodeById(graph: unknown, id: string) {
  const nodes = ((graph as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
    id: string;
    observed_state?: Record<string, unknown>;
  }>;
  return nodes.find((n) => n.id === id);
}

/**
 * A run lands the way a run does: its own turn row, carrying its fact. The fact
 * must be a `HandlerFact` first — the type the real writer hands `append`.
 */
function landRun(fact: Record<string, unknown>): void {
  const parsed = HandlerFactSchema.safeParse(fact);
  expect(parsed.success, parsed.success ? '' : parsed.error.message).toBe(true);
  insertRow(nextTurnId(), 'run_analysis', [fact]);
}

const EDIT_TO_50K = { target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' } as const;

/** The seed state every test starts from: the pre-edit graph + ONE prior successful run. */
function resetStore(scenarioId: string = SCENARIO_ID): void {
  appendSpy.mockClear();
  llmChatMock.mockClear();
  for (const fn of Object.values(unmodelledReads)) fn.mockClear();
  windowOverflowed = false;
  factParseFailures.length = 0;
  foreignGraphAfterNextCommit = null;
  db.graph = jsonb(buildSeedGraph());
  db.rows = [];
  // The REAL prior run: a successful fact stamped with the pre-edit hash.
  landRun(
    runAnalysisFact({
      graphHash: PRE_EDIT_HASH,
      computedAt: PRE_RUN_AT,
      win: PRE_RUN_WIN,
      analysisStatus: 'computed',
      scenarioId,
    }),
  );
}

// ── the suite ───────────────────────────────────────────────────────────────

describe('own write — the reload reread and the freshness it reports', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await scenarioGraphRoute(app);
    await app.ready();

    // WARM-UP, on its own scenario id: one committed edit and one reread, so
    // both routes' cold start is paid here and not by the first test. Asserted,
    // so a broken warm-up fails loudly instead of warming nothing.
    resetStore(WARMUP_SCENARIO_ID);
    const warm = await editValue(app, EDIT_TO_50K, WARMUP_SCENARIO_ID);
    expect(warm.res.statusCode).toBe(200);
    expect(
      (warm.body.blocks as Array<Record<string, unknown>>).find((b) => b.type === 'graph_patch')?.status,
    ).toBe('applied');
    expect((await reread(app, WARMUP_SCENARIO_ID)).graph_present).toBe(true);
    expect(factParseFailures).toEqual([]);
    // `beforeEach` resets the store and every spy before the first test.
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    expect(factParseFailures, 'a stored fact failed HandlerFactSchema on the store read').toEqual([]);
    expect(windowOverflowed, 'a fixture left the 20-row readRecent window').toBe(false);
    for (const [name, fn] of Object.entries(unmodelledReads)) {
      expect(fn, `${name} is not modelled by this fake and must not be read`).not.toHaveBeenCalled();
    }
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  // ── P8 — the authoritative reread ───────────────────────────────────────

  describe('P8 — the reload serves the bytes THIS commit wrote', () => {
    it('after a committed value edit, the reread carries the committed value by node id and the reply’s own graph_hash', async () => {
      const { res, body, turnId } = await editValue(app, EDIT_TO_50K);
      expect(res.statusCode).toBe(200);

      // The commit result the "Saved" claim rests on: an APPLIED patch on MY target.
      const patch = (body.blocks as Array<Record<string, unknown>>).find((b) => b.type === 'graph_patch');
      expect(patch?.target_id).toBe('f-budget');
      expect(patch?.status).toBe('applied');

      // The bytes this turn handed the atomic write, and the repo's own hash of them.
      const committed = writeFor(turnId).graph;
      const committedHash = committedHashFor(turnId);
      expect(body.graph_hash).toBe(committedHash);

      const read = await reread(app);
      expect(read.graph_present).toBe(true);
      // The WHOLE graph is the one this commit wrote — not a graph that merely
      // agrees on the edited field.
      expect(read.graph).toEqual(committed);
      const budget = nodeById(read.graph, 'f-budget');
      expect(budget?.observed_state?.raw_value).toBe(50000);
      expect(budget?.observed_state?.value).toBeCloseTo(0.5, 10);
      expect(budget?.observed_state?.cap).toBe(100000);
      // The reload's write base IS the edit reply's hash: the next edit's CAS
      // precondition cannot disagree with what the user was just told.
      expect(read.graph_hash).toBe(body.graph_hash);
    });

    it('CONCURRENT WRITER — a foreign graph landing right after this commit moves the store, yet the reply’s graph_hash and draft_graph still name THIS commit’s bytes', async () => {
      // Another writer's graph: the same model with f-budget at £60,000. It
      // lands in the gap between this commit's append resolving and the reply
      // being built — so "hash what the store holds now" and "hash what THIS
      // commit wrote" give different answers, and only the second is the rule.
      const foreignGraph = buildSeedGraph({ value: 0.6, raw_value: 60000 });
      foreignGraphAfterNextCommit = foreignGraph;

      const { res, body, turnId } = await editValue(app, EDIT_TO_50K);
      expect(res.statusCode).toBe(200);

      // PREMISES, asserted rather than assumed: the foreign writer landed after
      // this turn's append, and its hash differs from this commit's.
      expect(foreignGraphAfterNextCommit).toBeNull();
      expect(db.rows[0]!.turn_id).not.toBe(turnId);
      expect(db.rows[1]!.turn_id).toBe(turnId);
      const committedHash = committedHashFor(turnId);
      const foreignHash = computeAnalysisAffectingGraphHash(foreignGraph as never);
      expect(typeof foreignHash).toBe('string');
      expect(foreignHash).not.toBe(committedHash);
      expect(foreignHash).not.toBe(PRE_EDIT_HASH);
      expect(computeAnalysisAffectingGraphHash(db.graph as never)).toBe(foreignHash);

      const patch = (body.blocks as Array<Record<string, unknown>>).find((b) => b.type === 'graph_patch');
      expect(patch?.target_id).toBe('f-budget');
      expect(patch?.status).toBe('applied');

      // THE RULE: the reply names MY commit's bytes, not the store's current ones.
      expect(body.graph_hash).toBe(committedHash);
      // …and so does the postimage the client reconciles, by node id.
      const wireBudget = nodeById(body.draft_graph, 'f-budget');
      expect(wireBudget?.observed_state?.raw_value).toBe(50000);
      expect(wireBudget?.observed_state?.value).toBeCloseTo(0.5, 10);

      // The reload, by contrast, is authoritative about the STORE: it serves the
      // foreign bytes and their hash, and never adopts the reply's.
      const read = await reread(app);
      expect(read.graph).toEqual(jsonb(foreignGraph));
      expect(read.graph_hash).toBe(foreignHash);
      expect(read.graph_hash).not.toBe(body.graph_hash);
    });

    it('CONTRAST — a refused edit leaves the reread on the pre-edit bytes and hash', async () => {
      const { res, body, turnId } = await editValue(app, {
        // £250,000 against a £100,000 cap — refused, never clamped.
        target_id: 'f-budget',
        value: 2.5,
        raw_value: 250000,
        unit: '£',
      });
      expect(res.statusCode).toBe(200);
      expect(body.blocks).toEqual([]);
      // The reply side of the refusal twin is as strict as the reread side: no
      // postimage of the requested value may ride on a refusal.
      expect(body.draft_graph).toBeUndefined();
      // Committed as a turn, but with no graph.
      expect(writeFor(turnId).graph).toBeUndefined();

      const read = await reread(app);
      expect(read.graph).toEqual(buildSeedGraph());
      expect(nodeById(read.graph, 'f-budget')?.observed_state?.raw_value).toBe(40000);
      expect(read.graph_hash).toBe(PRE_EDIT_HASH);
    });
  });

  // ── P9 — freshness across the same seam ─────────────────────────────────

  describe('P9 — freshness follows the committed hash, and only a SUCCESSFUL run restores it', () => {
    it('(a) before any edit, the read reports the prior run as current, with its result', async () => {
      const read = await reread(app);
      expect(read.graph_hash).toBe(PRE_EDIT_HASH);
      expect(read.analysis_state.run_state).toEqual({
        kind: 'complete_current',
        computed_at: PRE_RUN_AT,
      });
      expect(read.analysis_result).not.toBeNull();
      expect(read.analysis_result.type).toBe('analysis_result');
      expect(read.analysis_result.win_probabilities).toEqual(PRE_RUN_WIN);
    });

    it('(b) a committed value edit makes the reply say `stale` AND the reload read report complete_stale with no result', async () => {
      const { res, body, turnId } = await editValue(app, EDIT_TO_50K);
      expect(res.statusCode).toBe(200);
      expect(body.graph_hash).toBe(committedHashFor(turnId));
      expect(body.analysis_ready.freshness).toBe('stale');

      const read = await reread(app);
      expect(read.graph_hash).toBe(body.graph_hash);
      // Bound to the PRE-edit run's own timestamp: the stale verdict is about
      // THAT run against THIS commit, not a generic "something is stale".
      expect(read.analysis_state.run_state).toEqual({
        kind: 'complete_stale',
        computed_at: PRE_RUN_AT,
        cause: 'graph_changed',
      });
      expect(read.analysis_result).toBeNull();
    });

    it('(c) a new SUCCESSFUL run stamped with the post-edit hash makes the reload current again', async () => {
      const { body, turnId } = await editValue(app, EDIT_TO_50K);
      // The post-edit hash is the repo's hash of the bytes THIS commit wrote —
      // what a run reading the stored graph would stamp — and the reply agrees.
      const postEditHash = committedHashFor(turnId);
      expect(body.graph_hash).toBe(postEditHash);

      landRun(
        runAnalysisFact({
          graphHash: postEditHash,
          computedAt: POST_RUN_AT,
          win: POST_RUN_WIN,
          analysisStatus: 'computed',
        }),
      );

      const read = await reread(app);
      expect(read.graph_hash).toBe(postEditHash);
      // THE NEW run, by its own timestamp and its own numbers — not the old one.
      expect(read.analysis_state.run_state).toEqual({
        kind: 'complete_current',
        computed_at: POST_RUN_AT,
      });
      expect(read.analysis_result).not.toBeNull();
      expect(read.analysis_result.win_probabilities).toEqual(POST_RUN_WIN);
    });

    it.each(['failed', 'refused'])(
      '(d) a run with analysis_status %s stamped with the post-edit hash does NOT make the reload current',
      async (analysisStatus) => {
        const { body, turnId } = await editValue(app, EDIT_TO_50K);
        const postEditHash = committedHashFor(turnId);
        expect(body.graph_hash).toBe(postEditHash);

        landRun(
          runAnalysisFact({
            graphHash: postEditHash,
            computedAt: FAILED_RUN_AT,
            win: POST_RUN_WIN,
            analysisStatus,
          }),
        );

        const read = await reread(app);
        expect(read.graph_hash).toBe(postEditHash);
        // Still the PRE-edit run, still stale: the newer non-success fact carries
        // the matching hash and is exactly what a status-blind selector would pick.
        expect(read.analysis_state.run_state).toEqual({
          kind: 'complete_stale',
          computed_at: PRE_RUN_AT,
          cause: 'graph_changed',
        });
        expect(read.analysis_result).toBeNull();
      },
    );

    // (b) proves the reply says `stale` after an edit. On its own it cannot tell a
    // hash comparison from "any committed edit is stale", which is exactly the
    // "stale because the hash moved" reasoning the product rule forbids. The
    // contrast: edit away (stale), then edit BACK to the analysed value. The
    // committed bytes hash to the run's hash again, so the reply must say `fresh`.
    // A constant-`stale` reply goes RED here (verifier mutant M8b).
    it('(e) editing back to the analysed value makes the edit reply say fresh, and the reload current', async () => {
      const away = await editValue(app, EDIT_TO_50K);
      expect(away.res.statusCode).toBe(200);
      expect(away.body.analysis_ready.freshness).toBe('stale');

      const back = await editValue(app, { target_id: 'f-budget', value: 0.4, raw_value: 40000, unit: '£' });
      expect(back.res.statusCode).toBe(200);
      const backGraph = writeFor(back.turnId).graph;
      expect(backGraph).toBeDefined();
      // Premise, proven rather than assumed: the committed bytes hash back to the
      // hash the prior run was stamped with.
      expect(computeAnalysisAffectingGraphHash(backGraph as never)).toBe(PRE_EDIT_HASH);
      expect(back.body.graph_hash).toBe(PRE_EDIT_HASH);
      expect(back.body.analysis_ready.freshness).toBe('fresh');

      const read = await reread(app);
      expect(read.analysis_state.run_state).toEqual({ kind: 'complete_current', computed_at: PRE_RUN_AT });
    });
  });
});
