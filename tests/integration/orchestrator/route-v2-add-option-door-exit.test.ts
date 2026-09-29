/**
 * ROADMAP 1.203 R2 — add-option intent-chip routing + exit_path label
 * (A2-ASKS-DIAGNOSIS-2026-07-23, 1.193a + 1.193c). Drives the REAL route via
 * `app.inject`.
 *
 * R2(a) — the executor-door widening. On a STALE / diverged baseline the
 * deterministic add-option transaction fails closed (structural referee, strict
 * trust set) and the add-option arm falls through with `fell_through:not_held`.
 * Before this change the declined chip was CLAIMED by the free-text edit LLM lane
 * (`dispatchEditGraph`, ~13.6s) because the 1.187 door guard keys on `action_type`
 * only and an add_option chip carries `chip.intent`, no `action_type`. After the
 * widening the declined chip reaches TurnExecutor instead — NOT the LLM edit lane.
 * MUTATION-CHECK (revert the `|| isAddOptionIntentChip` widening in route-v2.ts →
 * RED): the "dispatchEditGraph NOT called" assertion fails (the edit lane claims it).
 *
 * R2(d) — the deterministic held transaction stamps `exit_path:'add_option_transaction'`
 * (its own zero-LLM member), not the LLM edit lane's `edit_graph`.
 * MUTATION-CHECK (revert the sendFinalised200 label at route-v2.ts → RED).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

import type { PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';

// ── config: GM live + diagnostic trace on (so exit_path rides the wire body) ──
const gmHolder = { mode: 'live' as 'off' | 'shadow' | 'live' };
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      features: new Proxy(actual.config.features, {
        get: (t, p) =>
          p === 'graphManagementMode'
            ? gmHolder.mode
            : p === 'diagnosticTraceEnabled'
              ? true
              : Reflect.get(t, p),
      }),
    },
  };
});

// ── session store (parameterisable graph / prior turns+facts for staleness) ──
const GRAPH = {
  goal_node_id: 'g_profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g_profit', kind: 'goal', label: 'Profit' },
    { id: 'dec_choice', kind: 'decision', label: 'Which platform' },
    { id: 'fac_effort', kind: 'factor', label: 'Migration effort', observed_state: { value: 0.4 } },
  ],
  edges: [
    { from: 'fac_effort', to: 'g_profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};
const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
// A prior run_analysis fact whose graph_hash_at_run is DIVERGED from the current
// persisted graph → deriveAnalysisFreshness returns 'stale'.
const STALE_PRIOR_TURN = {
  id: 'row-prior-1',
  turn_id: 'client-turn-prior',
  scenario_id: SCENARIO_ID,
  turn_class: 'handler',
  handler_id: 'run_analysis',
  created_at: '2026-07-22T10:00:00.000Z',
};
const STALE_RUN_ANALYSIS_FACT = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_x',
    summary: 'Ran analysis.',
    graph_hash_at_run: 'gh_diverged_stale_00000001',
    enrichment: { confidence_tier: 'fair' },
  },
};
const storeHolder: {
  graph: unknown;
  priorPendings: PendingAction[];
  turns: unknown[];
  facts: unknown[];
} = { graph: GRAPH, priorPendings: [], turns: [], facts: [] };
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => storeHolder.turns,
    readFactsFor: async () => storeHolder.facts,
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => storeHolder.priorPendings,
    readMostRecentCoachingState: async () => null,
    hasPriorTurns: async () => storeHolder.turns.length > 0,
    loadGraph: async () => storeHolder.graph,
    loadGraphAndBriefText: async () => ({ graph: storeHolder.graph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ── commitDirectAnswer captured (the durable write is covered elsewhere) ──────
const commitCalls: Array<{ response: any; meta: any }> = [];
vi.mock('../../../src/orchestrator-v5/commit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/commit.js')>();
  return {
    ...actual,
    commitDirectAnswer: async (response: any, meta: any) => {
      commitCalls.push({ response, meta });
      return { response, persistedRowId: 'mock-row-id' };
    },
  };
});

// ── executor + edit-lane sinks, exposed so we can assert WHICH path claimed ──
const FALLTHROUGH_RESPONSE = {
  response_version: 2 as const,
  assistant_text: 'FALLTHROUGH_SENTINEL',
  blocks: [] as const,
  suggested_actions: [] as const,
  insights: [] as const,
  stage_indicator: 'decide' as const,
};
const runTurnExecutorMock = vi.fn(async () => ({
  response: FALLTHROUGH_RESPONSE,
  analysisReady: null,
  effectiveGraph: null,
  answerKind: 'functional' as const,
  telemetry: {
    stages_completed: ['orient'], response_emitted: true as const, llm_calls_used: 0,
    commit_performed: true, failure_type: null, wall_clock_ms: 1, turn_class: 'decide',
    intent_class: 'edit', coaching_mode: null, validation_error_code: null,
  },
}));
const dispatchEditGraphMock = vi.fn(async () => ({ response: FALLTHROUGH_RESPONSE, commitPerformed: true }));
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js')>();
  return { ...actual, dispatchEditGraph: dispatchEditGraphMock };
});

const telemetry = await import('../../../src/utils/telemetry.js');
const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

function addOptionPayload(parameters: unknown) {
  return {
    kind: 'message',
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    stage: 'decide',
    // Edit-shaped rendered copy (leads with "Add") — A2's evidence shape, so the
    // free-text edit lane's positive regex matches and WOULD claim it without the
    // door widening.
    message: 'Add an option to outsource to a BPO vendor.',
    turn_class: 'decide',
    source: 'chip',
    chip: {
      intent: 'add_option',
      parameters,
    },
  };
}
const VALID_PARAMS = {
  parent_decision_id: 'dec_choice',
  label: 'Outsource to a BPO vendor',
  interventions: [{ factor_id: 'fac_effort', value: 0.55 }],
};

async function post(app: FastifyInstance, payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}
function addOptionEvents(emitSpy: ReturnType<typeof vi.spyOn>) {
  return (emitSpy.mock.calls as unknown[][])
    .filter((c) => c[0] === 'v5.add_option_transaction')
    .map((c) => c[1] as Record<string, unknown>);
}

describe('route-v2 — add-option intent-chip door + exit_path (R2)', () => {
  let app: FastifyInstance;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    gmHolder.mode = 'live';
    storeHolder.graph = GRAPH;
    storeHolder.priorPendings = [];
    storeHolder.turns = [];
    storeHolder.facts = [];
    commitCalls.length = 0;
    runTurnExecutorMock.mockClear();
    dispatchEditGraphMock.mockClear();
    emitSpy = vi.spyOn(telemetry, 'emit');
  });

  /**
   * ⭐⭐ FLIPPED BY RULING A4 (Paul, 2026-08-05) — AND THE ARM IT EXERCISED IS
   * NOW UNREACHABLE FROM THIS INPUT, WHICH IS SAID RATHER THAN PAPERED OVER.
   *
   * The executor door (#658) exists to keep ONE case away from the 13.6s LLM
   * edit lane: a typed add_option chip whose deterministic transaction declined
   * `not_held` because the frame was stale. A4 removed that decline — a stale
   * analysis is a property of the RESULTS and never a reason to refuse a
   * structural add — so the chip now HOLDS and the user gets the real confirm
   * chip on a zero-LLM turn. Strictly better than either branch of the old
   * fork: no edit lane, no executor, no LLM call at all.
   *
   * ⚠ WHAT THIS MEANS FOR THE DOOR, stated precisely because it is a narrowing
   * and not a removal — DERIVED at the bytes, not inferred from this test:
   * `dispatchAddOptionTransaction` pins `baseGraphHash: input.currentGraphHash`
   * (add-option-dispatch.ts), so the base-hash rung can never diverge on this
   * path; `add_option` is held-by-design in every referee branch except
   * `GRAPH_INVARIANT_VIOLATED` (referee.ts R7); and after A4 no freshness value
   * yields a non-held governing. So `not_held` here now means exactly ONE
   * thing: an integrity REJECT. The door's routing for that case is unchanged
   * by A4 (it behaved identically before), and the two F1 tests below still pin
   * that only `not_held` takes it. Whether an integrity reject belongs at the
   * executor rather than the edit lane is a separate question, deliberately not
   * answered in this diff.
   */
  it('(a) ⭐ A4: a STALE-baseline add_option chip HOLDS — no edit lane, no executor, no LLM call', async () => {
    // Diverged baseline: a prior run_analysis fact whose graph hash != current.
    storeHolder.turns = [STALE_PRIOR_TURN];
    storeHolder.facts = [STALE_RUN_ANALYSIS_FACT];

    const { status, body } = await post(app, addOptionPayload(VALID_PARAMS));
    expect(status).toBe(200);

    // The deterministic transaction HELD (identity: the exact telemetry
    // outcome, not "some add_option event fired").
    const outcomes = addOptionEvents(emitSpy).map((e) => String(e.outcome));
    expect(outcomes).toContain('held');
    expect(outcomes.some((o) => o.startsWith('fell_through'))).toBe(false);
    // Neither fallback ran: the turn resolved deterministically.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
    // The user is left with a real confirm affordance, not a refusal.
    const blocks = (body.blocks ?? []) as Array<{ type?: string }>;
    expect(blocks.some((b) => b.type === 'held_proposal')).toBe(true);
  });

  // ── egress-F1 (2026-07-24): the door exclusion is NARROWED to `not_held`. The
  // gm_off / malformed-spec legs regain their pre-#658 fallback (the free-text
  // edit lane); only the stale/diverged referee decline routes to the executor.
  // MUTATION-CHECK: revert route-v2's `let isNonReadinessTypedChipClickForExecutor`
  // back to `|| isAddOptionIntentChip` → these two go RED (the executor claims
  // the turn away from the edit lane, dispatchEditGraph never runs). ──

  it('(F1-gm_off) a GM-off add_option chip regains the edit lane (NOT stranded at the executor)', async () => {
    gmHolder.mode = 'off';
    const { status } = await post(app, addOptionPayload(VALID_PARAMS));
    expect(status).toBe(200);
    // The arm fell through for gm_off …
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'fell_through:gm_off')).toBe(true);
    // … to the free-text EDIT lane (its only working fallback — the executor has
    // no add-option capability), NOT the executor door.
    expect(dispatchEditGraphMock).toHaveBeenCalled();
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
  });

  it('(F1-malformed) a malformed-spec add_option chip regains the edit lane (NOT stranded at the executor)', async () => {
    // GM live, but the parameters cannot build a transaction → skip with a
    // built.reason (NOT not_held) → edit-lane fallback.
    const { status } = await post(app, addOptionPayload({ label: 'nope' }));
    expect(status).toBe(200);
    const events = addOptionEvents(emitSpy);
    expect(
      events.some((e) => String(e.outcome).startsWith('fell_through') && e.outcome !== 'fell_through:not_held'),
    ).toBe(true);
    expect(dispatchEditGraphMock).toHaveBeenCalled();
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
  });

  it('(d) a fresh/held add_option transaction stamps exit_path:add_option_transaction', async () => {
    // No prior facts → freshness 'none' (trusted for structural) → HELD transaction.
    const { status, body } = await post(app, addOptionPayload(VALID_PARAMS));
    expect(status).toBe(200);
    // The held proposal came from our pre-route, not a fall-through sink.
    expect(body.assistant_text).not.toContain('FALLTHROUGH_SENTINEL');
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'held')).toBe(true);
    // The wire diagnostic trace carries the dedicated zero-LLM exit label.
    expect(body._diagnostic_trace?.exit_path).toBe('add_option_transaction');
    // Neither LLM path ran.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });
});
