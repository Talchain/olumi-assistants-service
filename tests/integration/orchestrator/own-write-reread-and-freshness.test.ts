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
 *   · A concurrent CAS conflict on the value edit. Separate fixture.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';
import { SESSION_READ_WINDOW_DEFAULT } from '../../../src/orchestrator-v5/session/index.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../utils/mock-session-store.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';

// ── the persisted model ────────────────────────────────────────────────────
// The value-edit suite's fixture (`route-v2-factor-value-edit.test.ts`), with a
// second option so the seeded analysis compares two real option ids.
// `f-budget` is capped at 100000 with unit £, currently £40,000 (value 0.4).
function buildSeedGraph() {
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
 * status is a parameter because (d) needs a non-success one.
 */
function runAnalysisFact(opts: {
  readonly graphHash: string;
  readonly computedAt: string;
  readonly win: Record<string, number>;
  readonly analysisStatus: string;
}): Record<string, unknown> {
  const [leader] = Object.entries(opts.win).sort((a, b) => b[1] - a[1])[0]!;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    turn_id: 'turn_autorun',
    result: {
      scenario_id: SCENARIO_ID,
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

interface FakeRow {
  readonly id: string;
  readonly turn_id: string;
  readonly handler_id: string | null;
  readonly handler_facts: readonly unknown[];
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

function insertRow(turnId: string, handlerId: string | null, facts: readonly unknown[]): string {
  db.seq += 1;
  const id = `row-${String(db.seq).padStart(4, '0')}`;
  db.rows.unshift({ id, turn_id: turnId, handler_id: handlerId, handler_facts: jsonb(facts) });
  return id;
}

/** Every write the routes make lands here; the spy keeps the exact argument. */
const appendSpy = vi.fn(async (write: SessionTurnWrite) => {
  if (write.graph != null) db.graph = jsonb(write.graph);
  return { id: insertRow(write.turn_id, write.handler_id, write.handler_facts) };
});

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
  readFactsFor: async (rowIds: readonly string[]) =>
    db.rows.filter((r) => rowIds.includes(r.id)).flatMap((r) => jsonb(r.handler_facts)) as never,
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

async function editValue(app: FastifyInstance, event: Record<string, unknown>) {
  const turnId = nextTurnId();
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'system_event',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      event: { kind: 'factor_value_edit', ...event },
    },
  });
  return { res, body: JSON.parse(res.body) as Record<string, any>, turnId };
}

/** The reload read — the path a browser takes after a refresh. */
async function reread(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: `/assist/v1/scenarios/${SCENARIO_ID}/graph`,
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

function nodeById(graph: unknown, id: string) {
  const nodes = ((graph as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
    id: string;
    observed_state?: Record<string, unknown>;
  }>;
  return nodes.find((n) => n.id === id);
}

/** A run lands the way a run does: its own turn row, carrying its fact. */
function landRun(fact: Record<string, unknown>): void {
  insertRow(nextTurnId(), 'run_analysis', [fact]);
}

// ── the suite ───────────────────────────────────────────────────────────────

describe('own write — the reload reread and the freshness it reports', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await scenarioGraphRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendSpy.mockClear();
    llmChatMock.mockClear();
    for (const fn of Object.values(unmodelledReads)) fn.mockClear();
    windowOverflowed = false;
    db.graph = jsonb(buildSeedGraph());
    db.rows = [];
    // The REAL prior run: a successful fact stamped with the pre-edit hash.
    landRun(
      runAnalysisFact({
        graphHash: PRE_EDIT_HASH,
        computedAt: PRE_RUN_AT,
        win: PRE_RUN_WIN,
        analysisStatus: 'computed',
      }),
    );
  });

  afterEach(() => {
    expect(windowOverflowed, 'a fixture left the 20-row readRecent window').toBe(false);
    for (const [name, fn] of Object.entries(unmodelledReads)) {
      expect(fn, `${name} is not modelled by this fake and must not be read`).not.toHaveBeenCalled();
    }
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  // ── P8 — the authoritative reread ───────────────────────────────────────

  describe('P8 — the reload serves the bytes THIS commit wrote', () => {
    it('after a committed value edit, the reread carries the committed value by node id and the reply’s own graph_hash', async () => {
      const { res, body, turnId } = await editValue(app, {
        target_id: 'f-budget',
        value: 0.5,
        raw_value: 50000,
        unit: '£',
      });
      expect(res.statusCode).toBe(200);

      // The commit result the "Saved" claim rests on: an APPLIED patch on MY target.
      const patch = (body.blocks as Array<Record<string, unknown>>).find((b) => b.type === 'graph_patch');
      expect(patch?.target_id).toBe('f-budget');
      expect(patch?.status).toBe('applied');

      // The bytes this turn handed the atomic write, and the repo's own hash of them.
      const committed = writeFor(turnId).graph;
      expect(committed).toBeDefined();
      const committedHash = computeAnalysisAffectingGraphHash(committed as never);
      expect(committedHash).not.toBe(PRE_EDIT_HASH);
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
      const { res, body } = await editValue(app, {
        target_id: 'f-budget',
        value: 0.5,
        raw_value: 50000,
        unit: '£',
      });
      expect(res.statusCode).toBe(200);
      expect(body.graph_hash).not.toBe(PRE_EDIT_HASH);
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
      const { body } = await editValue(app, {
        target_id: 'f-budget',
        value: 0.5,
        raw_value: 50000,
        unit: '£',
      });
      const postEditHash = body.graph_hash as string;
      expect(postEditHash).not.toBe(PRE_EDIT_HASH);

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
        const { body } = await editValue(app, {
          target_id: 'f-budget',
          value: 0.5,
          raw_value: 50000,
          unit: '£',
        });
        const postEditHash = body.graph_hash as string;
        expect(postEditHash).not.toBe(PRE_EDIT_HASH);

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
  });
});
