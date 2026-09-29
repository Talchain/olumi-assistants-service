/**
 * F2 — a `factor_value_edit` ATOMIC CAS CONFLICT must answer the typed 409 its
 * structural siblings answer, not an untyped retryable 500.
 *
 * ⛔ RED BY DESIGN UNTIL F2 LANDS. Both DEFECT cases below fail today, on their
 * final status/body assertion, and they are meant to. Do NOT mark them
 * `.fails`/`.skip`/`.todo` — a red that cannot be seen is not a fixture, it is
 * a hiding place.
 *
 * THE DEFECT (read at the bytes, `src/orchestrator-v5/system-events/dispatch.ts`):
 * every structural writer's commit catch opens with
 * `if (err instanceof GraphStaleWriteError)` and returns a `graphConflict`, which
 * `route-v2.ts` maps to 409 `GRAPH_DIVERGED` + `refresh_and_reconfirm`,
 * `retryable: false`. `dispatchFactorValueEdit`'s catch has NO such branch: it
 * logs and returns `commitPerformed: false` with no skip reason, and the route
 * answers 500 `system_event_commit_failed`, `retryable: true`. So a value edit
 * that LOST a race to a concurrent writer tells the client to retry the SAME
 * write against a base that has moved — the one instruction guaranteed to lose
 * again — and gives the UI nothing typed to say "your model changed underneath
 * you; refresh".
 *
 * WHY THIS MATTERS FOR "Saved" (Paul's rule): "Saved" rests ONLY on this
 * operation's own canonical commit result. A conflict IS that result — a typed,
 * definite "not saved, and here is why" — so it must reach the client as one,
 * not as an indistinguishable infrastructure failure.
 *
 * THE CONFLICT IS SIMULATED WHOLE, premise included. A CAS conflict means a
 * CONCURRENT WRITER MOVED THE GRAPH between this turn's start-of-turn read and
 * its append. So the armed append first lands a winner's graph (a different
 * turn id, an analysis-affecting change to `f-budget`), THEN rejects this write.
 * That premise is what makes the refresh target discriminating: the typed body
 * must name the WINNER's analysis hash (a fresh read of what the server now
 * holds), which differs from this turn's own CAS base. A fix that echoed the
 * stale base back would tell the UI to "refresh" to the hash it already has
 * and reconfirm against a base that already lost — the retry loop above, typed.
 *
 * BOTH REAL CATEGORIES are exercised, because `conflict_category` must be bound
 * by IDENTITY to the thrown error, and a single category is exactly the value a
 * hardcoding fix would pick. `store.append` raises `GraphStaleWriteError` with
 * `rpc_cas_conflict` from the atomic RPC (OLGC1; `supabase-store.ts`
 * `append_turn_atomic_v3/v4/v5`) and with `analysis_affecting_conflict` from the
 * app-side enforce check before the RPC (`evaluation.category`). Both reach the
 * writer's commit catch the same way.
 *
 * THE PAIR, and why each half is needed:
 *   - CONTRAST (GREEN today, per category): the SAME `GraphStaleWriteError`,
 *     thrown by the SAME fake `store.append` after the SAME concurrent winner, on
 *     `structural_delete` yields the typed 409 — with the thrown category passed
 *     through and the winner's hash as the refresh target. Proves the typed path
 *     exists for siblings, that this harness can observe it, and that the
 *     expectation the DEFECT holds fve to is what a sibling ACTUALLY answers.
 *   - DEFECT (RED today, per category): the SAME conflict on `factor_value_edit`
 *     must yield the SAME typed body. Both are asserted against ONE
 *     expected-shape builder (`typedCasConflict`), so "the same shape" is bound
 *     by construction, not by two hand-copied lists that can drift apart.
 *   - HARNESS CONTROL (GREEN today): the identical fve request with NO conflict
 *     commits (200, applied graph_patch on `f-budget`). Without it, a 500 in the
 *     defect test could be a broken fixture rather than the missing branch.
 *
 * WHAT THIS DELIBERATELY DOES NOT PROVE:
 *   - that the real Supabase store raises `GraphStaleWriteError` for this write
 *     (the fake throws it; `supabase-store.ts` owns that half);
 *   - that nothing of this turn was stored, as an independent fact: the fake
 *     rejects BEFORE its write-through, so the "nothing stored" checks hold by
 *     construction. They are guards against a fix that RETRIES the append (a
 *     second call would land the user's bytes), nothing more;
 *   - the T0 stale-BASE gate — fve carries no client base hash at all; its CAS
 *     base is the server's own start-of-turn read (`dispatch.ts`,
 *     `computeExpectedGraphCasHashes(result.baseGraph)`), which the defect test
 *     pins as a precondition rather than assumes;
 *   - replay / prior-turn-conflict handling (`commit.ts`, `appendOutcome
 *     .replayedPriorTurn` / `.priorTurnConflict`) — the fake append never sets
 *     either flag, so neither path is reached here;
 *   - what copy or UI recovery the client renders for the 409.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';

// ── the persisted model ────────────────────────────────────────────────────
// The route-v2-structural-delete.test.ts fixture, verbatim: its own CONTRAST
// CONTROL proves `factor_value_edit` applies on it, and its atomic-CAS twin
// proves `structural_delete` reaches the store on it. One graph serves both
// writers, so the two conflict bodies differ only in what the WRITER did.
function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    schema_version: 'cee-v3',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
      { id: 'o-wait', kind: 'option', label: 'Wait a quarter' },
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
        from: 'o-launch',
        to: 'g-revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'o-wait',
        to: 'g-revenue',
        strength: { mean: 0.3, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

const appendMock = vi.fn();
let persisted: unknown = buildPersistedGraph();

/**
 * Every write the store ACCEPTED, in order — including a concurrent winner's
 * (see `armAtomicCasConflict`). The fake is write-through (a graph-bearing
 * write replaces `persisted`), and a write that throws never reaches this log,
 * which is the atomic RPC's rollback semantics. So "nothing of mine was stored"
 * is an IDENTITY filter over this log by turn id, plus `persisted` equal to the
 * winner's graph whole.
 */
let landed: Array<{ turn_id?: string; graph?: unknown }> = [];

function installWriteThroughAppend() {
  appendMock.mockImplementation(async (write: { turn_id?: string; graph?: unknown }) => {
    if (write.graph !== undefined && write.graph !== null) persisted = write.graph;
    landed.push(write);
    return { id: 'mock-row-id' };
  });
}

// The structural-delete harness's store: the factor-value-edit harness's store
// plus `readMostRecentPendingActions`, which the structural writer reads
// integrity-STRICTLY before any append. The fve writer does not need it, and
// that file's own fve contrast control shows it is inert for fve.
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// The ORIENT step is the only thing that reaches the LLM. Both writers are
// deterministic; asserting it was never called keeps them on that path.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
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

const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';
const TURN_ID_BASE = '77777777-7777-4777-8777-7777777777';

/**
 * The two categories `store.append` really throws `GraphStaleWriteError` with
 * (`supabase-store.ts`): the atomic RPC's `OLGC1` → `rpc_cas_conflict`, and the
 * app-side pre-RPC enforce check → `analysis_affecting_conflict`. Kept as plain
 * strings: `GraphStaleWriteError.conflict_category` is typed `string`, and
 * `GraphCasConflictCategory` does not contain `rpc_cas_conflict`, so there is no
 * single closed type to bind these to.
 *
 * Each case carries its own two-hex turn-id suffix, so every request in the
 * file is a distinct turn and its writes can be found by identity.
 */
const CONFLICT_CASES = [
  { category: 'rpc_cas_conflict', contrastSuffix: '01', defectSuffix: '03' },
  { category: 'analysis_affecting_conflict', contrastSuffix: '11', defectSuffix: '13' },
] as const;

/** The turn id of the concurrent writer that WON the race. Never this file's own. */
const CONCURRENT_WINNER_TURN_ID = '88888888-8888-4888-8888-888888888888';

/**
 * The 64-hex IDENTITY hash the error carries. It has no wire emitter, so it
 * must never be echoed as the refresh target — the typed body answers in
 * ANALYSIS space from a fresh read (`readClientRecoverableBaseHash`).
 */
const IDENTITY_SENTINEL = 'f'.repeat(64);

function turnId(suffix: string): string {
  // Two HEX chars: the last UUID group must be 12 hex digits or the payload
  // fails boundary validation with 422 (measured in the structural-delete file).
  return `${TURN_ID_BASE}${suffix.padStart(2, '0')}`;
}

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: turnId(suffix),
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

let app: FastifyInstance;

async function post(event: Record<string, unknown>, suffix: string) {
  return await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: payloadFor(event, suffix),
  });
}

/**
 * The analysis-affecting hash of the ORIGINAL persisted model, from the repo's
 * own hash function. Guarded: a null would make every hash assertion below
 * compare null to null and pass for the wrong reason.
 */
function preEditAnalysisHash(): string {
  const hash = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never);
  if (hash === null) {
    throw new Error('fixture graph produced no analysis-affecting hash — the CAS assertions would be vacuous');
  }
  return hash;
}

/**
 * The concurrent writer's graph: the persisted model with `f-budget` moved
 * 0.4 → 0.45 (raw 40000 → 45000). An ANALYSIS-AFFECTING change, so its analysis
 * hash differs from the pre-edit one; and not the user's 0.5 / 50000, so the
 * winner's bytes can never be mistaken for this turn's.
 */
function buildConcurrentWinnerGraph() {
  const graph = buildPersistedGraph();
  const budget = graph.nodes.find((n) => n.id === 'f-budget') as {
    observed_state: Record<string, unknown>;
  };
  budget.observed_state = { ...budget.observed_state, value: 0.45, raw_value: 45000 };
  return graph;
}

/** The winner's analysis-affecting hash, from the repo's own hash function. Guarded as above. */
function winnerAnalysisHash(): string {
  const hash = computeAnalysisAffectingGraphHash(buildConcurrentWinnerGraph() as never);
  if (hash === null) {
    throw new Error('winner graph produced no analysis-affecting hash — the refresh-target assertion would be vacuous');
  }
  return hash;
}

/**
 * The NEXT store.append LOSES A RACE. The concurrent winner's write lands first
 * (it is accepted, so it goes on `landed` and replaces `persisted`), then THIS
 * write is rejected exactly as the store rejects it — before its own bytes reach
 * the write-through, which is the atomic RPC's rollback.
 */
function armAtomicCasConflict(category: string) {
  appendMock.mockImplementationOnce(async () => {
    const winner = buildConcurrentWinnerGraph();
    persisted = winner;
    landed.push({ turn_id: CONCURRENT_WINNER_TURN_ID, graph: winner });
    throw new GraphStaleWriteError(`simulated ${category} graph CAS conflict`, {
      conflict_category: category,
      expected_base_graph_hash: IDENTITY_SENTINEL,
    });
  });
}

/** The only write the store should hold after a lost race: the winner's, whole. */
function winnerOnly() {
  return [{ turn_id: CONCURRENT_WINNER_TURN_ID, graph: buildConcurrentWinnerGraph() }];
}

/**
 * The fields of a system-event CAS-conflict answer, projected from the reply.
 * `request_id` is left out on purpose: it is per-request by design and says
 * nothing about the conflict.
 */
function conflictProjection(res: { statusCode: number; body: string }) {
  const body = JSON.parse(res.body) as Record<string, unknown>;
  return {
    status: res.statusCode,
    error: body.error,
    boundary: body.boundary,
    direction: body.direction,
    validator: body.validator,
    retryable: body.retryable,
    details: body.details,
  };
}

/**
 * THE ONE EXPECTED SHAPE both writers are held to — read at HEAD from
 * `route-v2.ts` (the `sysResult.graphConflict !== undefined` branch, built by
 * `buildCommitFailureBoundaryError`). `details` is compared WHOLE, so an extra
 * key or a missing one fails too. `event_kind` varies because the route stamps
 * the ingress event's own kind; `conflict_category` varies because it must be
 * the thrown error's own.
 */
function typedCasConflict(eventKind: string, category: string) {
  return {
    status: 409,
    error: 'GRAPH_DIVERGED',
    boundary: 'B1',
    direction: 'egress',
    validator: 'turn_commit',
    retryable: false,
    details: {
      retryable: false,
      reason: 'graph_write_conflict',
      failure_type: 'GRAPH_DIVERGED',
      event_kind: eventKind,
      recovery_action: 'refresh_and_reconfirm',
      // Bound by IDENTITY to the category the thrown error carried.
      conflict_category: category,
      // Analysis space, of the CONCURRENT WINNER's graph — what the server holds
      // NOW, from a fresh read. Never this turn's stale start-of-turn CAS base
      // (the pre-edit hash, which already lost), and never the 64-hex identity
      // sentinel the error carried.
      expected_base_graph_hash: winnerAnalysisHash(),
      stage: 'analyse',
    },
  };
}

function budgetRawValue(graph: unknown): unknown {
  const nodes = ((graph as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
    id: string;
    observed_state?: { raw_value?: unknown };
  }>;
  return nodes.find((n) => n.id === 'f-budget')?.observed_state?.raw_value;
}

const FVE_EVENT = {
  kind: 'factor_value_edit',
  target_id: 'f-budget',
  value: 0.5,
  raw_value: 50000,
  unit: '£',
} as const;

describe('POST /orchestrate/v2/turn — an atomic CAS conflict on factor_value_edit (F2)', () => {
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockReset();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
    landed = [];
    installWriteThroughAppend();
  });

  // ══ CONTRAST — GREEN today ═══════════════════════════════════════════════

  it.each(CONFLICT_CASES)(
    'CONTRAST [$category]: a structural_delete that loses a CAS race (append throws GraphStaleWriteError after a concurrent winner lands) answers the typed 409 GRAPH_DIVERGED with the thrown category and the winner’s hash',
    async ({ category, contrastSuffix }) => {
      // Premise: the winner really moved the analysis hash. Without this the
      // refresh-target assertion cannot tell a fresh read from a stale echo.
      expect(winnerAnalysisHash()).not.toBe(preEditAnalysisHash());

      armAtomicCasConflict(category);
      const res = await post(
        {
          kind: 'structural_delete',
          removed_node_ids: ['o-launch'],
          removed_edges: [],
          // A VALID base, so the T0 stale-base gate passes and the request
          // genuinely reaches the atomic append — this is the CAS limb, not the
          // stale-base twin.
          base_graph_hash: preEditAnalysisHash(),
        },
        contrastSuffix,
      );

      // Precondition: the conflict was raised on the append, not somewhere else.
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(llmChatMock).not.toHaveBeenCalled();

      expect(conflictProjection(res)).toEqual(typedCasConflict('structural_delete', category));

      // Only the winner's write is held; the delete this turn attempted is not.
      // (Guaranteed by the fake unless a fix re-appends — see the header.)
      expect(landed.filter((w) => w.turn_id === turnId(contrastSuffix))).toEqual([]);
      expect(landed).toEqual(winnerOnly());
      expect(persisted).toEqual(buildConcurrentWinnerGraph());
    },
  );

  // ══ HARNESS CONTROL — GREEN today ════════════════════════════════════════

  it('HARNESS CONTROL: the same factor_value_edit with NO conflict commits — 200 and an applied graph_patch on f-budget', async () => {
    const res = await post(FVE_EVENT, '02');

    expect(res.statusCode).toBe(200);
    expect(llmChatMock).not.toHaveBeenCalled();

    // The write landed, carrying this turn's id and the requested value.
    expect(landed).toHaveLength(1);
    expect(landed[0]?.turn_id).toBe(turnId('02'));
    expect(budgetRawValue(landed[0]?.graph)).toBe(50000);

    const body = JSON.parse(res.body) as {
      blocks: Array<Record<string, unknown>>;
      graph_hash?: unknown;
    };
    const patch = body.blocks.find((b) => b.type === 'graph_patch');
    expect(patch?.target_id).toBe('f-budget');
    expect(patch?.status).toBe('applied');
    // The advertised hash is the hash of the bytes handed to the store.
    expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(landed[0]?.graph as never));
  });

  // ══ DEFECT — RED today, by design ════════════════════════════════════════

  it.each(CONFLICT_CASES)(
    'DEFECT (F2) [$category]: a factor_value_edit that loses a CAS race (append throws GraphStaleWriteError after a concurrent winner lands) answers the SAME typed 409 GRAPH_DIVERGED, with the thrown category and the winner’s hash, and nothing of it is stored',
    async ({ category, defectSuffix }) => {
      // Premise: the winner really moved the analysis hash (see CONTRAST).
      expect(winnerAnalysisHash()).not.toBe(preEditAnalysisHash());

      armAtomicCasConflict(category);
      const res = await post(FVE_EVENT, defectSuffix);

      // ── preconditions: the conflict is on THIS operation's own commit ────
      // Exactly one append, carrying this turn's id and the user's value…
      expect(appendMock).toHaveBeenCalledTimes(1);
      const attempted = appendMock.mock.calls[0]?.[0] as {
        turn_id?: string;
        graph?: unknown;
        expectedGraphAnalysisHash?: unknown;
      };
      expect(attempted.turn_id).toBe(turnId(defectSuffix));
      expect(budgetRawValue(attempted.graph)).toBe(50000);
      // …whose CAS base is the server's own start-of-turn read of the original
      // model (fve carries no client base hash). So the conflict is a real
      // compare-and-swap loss, not a stale client assertion — and that base is
      // exactly the hash the typed body must NOT hand back as the refresh target.
      expect(attempted.expectedGraphAnalysisHash).toBe(preEditAnalysisHash());
      expect(llmChatMock).not.toHaveBeenCalled();

      // ── nothing of mine was stored ───────────────────────────────────────
      // Guaranteed by the fake unless a fix RETRIES the append (which the
      // call-count precondition above already refuses); kept as the guard that
      // names what a retry would break. The store holds the winner's graph
      // whole — the user's 50000 is not in it.
      expect(landed.filter((w) => w.turn_id === turnId(defectSuffix))).toEqual([]);
      expect(landed).toEqual(winnerOnly());
      expect(persisted).toEqual(buildConcurrentWinnerGraph());

      // ── THE DEFECT ───────────────────────────────────────────────────────
      expect(
        conflictProjection(res),
        `F2 DEFECT [${category}]: a factor_value_edit graph CAS conflict (store.append threw ` +
          'GraphStaleWriteError after a concurrent write) must answer the typed 409 GRAPH_DIVERGED / ' +
          'refresh_and_reconfirm / retryable:false that structural writers answer, carrying the ' +
          "thrown conflict_category and a FRESH read of the winner's analysis hash — " +
          'dispatchFactorValueEdit has no GraphStaleWriteError branch, so the route answers an ' +
          'untyped 500 system_event_commit_failed with retryable:true',
      ).toEqual(typedCasConflict('factor_value_edit', category));
    },
  );
});
