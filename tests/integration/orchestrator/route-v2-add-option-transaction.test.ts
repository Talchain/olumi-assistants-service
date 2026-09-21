/**
 * Lane C3 — route-level coverage of the typed add-option pre-route.
 *
 * WHY THIS EXISTS (adversarial C2): the pure builder + dispatch handler are
 * unit-tested, but the ROUTE WIRING (the `chip.intent==='add_option'` predicate,
 * the persisted-graph frame load, the held commit with prior-hold threading +
 * supersession, and the benign fall-through) had NO coverage — flipping
 * `isTypedAddOptionChip=false` left every unit test green. These drive the REAL
 * route via `app.inject` so that flip goes RED (verified by the author).
 *
 * `commitDirectAnswer` is mocked to CAPTURE its args (the persisted pending +
 * the threaded prior pendings) — the real durable write is covered by
 * gm-held-execute + the e2e test; here we prove the route hands the right
 * pending to the writer and never silently wipes a prior consent hold (C1).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';

import type { PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';

// ── graphManagementMode override (Proxy preserves every other real config
//    field, so route-v2 never crashes on a missing key) ──────────────────────
const gmHolder = { mode: 'live' as 'off' | 'shadow' | 'live' };
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      features: new Proxy(actual.config.features, {
        get: (t, p) =>
          p === 'graphManagementMode' ? gmHolder.mode : Reflect.get(t, p),
      }),
    },
  };
});

// ── session store (buildTurnContext reads through this; append is unused
//    because commitDirectAnswer is mocked) ─────────────────────────────────
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
const storeHolder: { graph: unknown; priorPendings: PendingAction[] } = {
  graph: GRAPH,
  priorPendings: [],
};
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => storeHolder.priorPendings,
    readMostRecentCoachingState: async () => null,
    hasPriorTurns: async () => false,
    loadGraph: async () => storeHolder.graph,
    loadGraphAndBriefText: async () => ({ graph: storeHolder.graph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ── commitDirectAnswer captured; computeRequestHash / computeSurvivingPriorPendings
//    kept real (route-v2 imports them from the same module) ──────────────────
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

// ── fall-through sinks: whichever path claims a non-routed turn returns a
//    sentinel so the request completes without an LLM call ──────────────────
const FALLTHROUGH = {
  response: {
    response_version: 2 as const,
    assistant_text: 'FALLTHROUGH_SENTINEL',
    blocks: [] as const,
    suggested_actions: [] as const,
    insights: [] as const,
    stage_indicator: 'decide' as const,
  },
  analysisReady: null,
  effectiveGraph: null,
  answerKind: 'functional' as const,
  telemetry: {
    stages_completed: ['orient'], response_emitted: true as const, llm_calls_used: 0,
    commit_performed: true, failure_type: null, wall_clock_ms: 1, turn_class: 'decide',
    intent_class: 'edit', coaching_mode: null, validation_error_code: null,
  },
};
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: vi.fn(async () => FALLTHROUGH),
}));
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js')>();
  return {
    ...actual,
    dispatchEditGraph: vi.fn(async () => ({ response: FALLTHROUGH.response, commitPerformed: true })),
  };
});

const telemetry = await import('../../../src/utils/telemetry.js');
const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { GM_HELD_HANDLER_ID } = await import(
  '../../../src/orchestrator-v5/handlers/edit-graph-referee-gate.js'
);

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

function addOptionPayload(turnId: string, parameters: unknown) {
  return {
    kind: 'message',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    stage: 'decide',
    message: 'Add an option.',
    turn_class: 'decide',
    source: 'chip',
    chip: { intent: 'add_option', parameters },
  };
}

async function post(app: FastifyInstance, payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function addOptionEvents(emitSpy: ReturnType<typeof vi.spyOn>) {
  return (emitSpy.mock.calls as unknown[][])
    .filter((c) => c[0] === 'v5.add_option_transaction')
    .map((c) => c[1] as Record<string, unknown>);
}

describe('route-v2 — typed add-option transaction pre-route (C2)', () => {
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
    commitCalls.length = 0;
    emitSpy = vi.spyOn(telemetry, 'emit');
  });

  it('(a) a real add_option chip → held response + a persisted GM-held pending', async () => {
    const { status, body } = await post(
      app,
      addOptionPayload(randomUUID(), {
        parent_decision_id: 'dec_choice',
        label: 'Outsource to a BPO vendor',
        interventions: [{ factor_id: 'fac_effort', value: 0.55 }],
      }),
    );
    expect(status).toBe(200);
    // The held_proposal block came from OUR pre-route, not the fall-through sink.
    expect(body.assistant_text).not.toContain('FALLTHROUGH_SENTINEL');
    expect(Array.isArray(body.blocks) && body.blocks.some((b: any) => b.type === 'held_proposal')).toBe(true);
    // The pending handed to the durable writer is the executable GM-held batch.
    expect(commitCalls).toHaveLength(1);
    const pending = commitCalls[0]!.meta.pending_actions[0];
    expect(pending.action.inline_patch.handler_id).toBe(GM_HELD_HANDLER_ID);
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'held')).toBe(true);
  });

  it('(a/C1) a live PRIOR consent hold is threaded + supersession-disclosed, never silently wiped', async () => {
    const priorHold: PendingAction = {
      id: 'pa-prior', scenario_id: SCENARIO_ID, chip_id: 'gmh_prioraaaaaa',
      action: {
        kind: 'apply_proposed_change', proposal_ref: 'gmh_prioraaaaaa',
        inline_patch: { handler_id: GM_HELD_HANDLER_ID, params: {}, target_entity_ids: [] },
        public_label: 'Set migration effort to 0.3', public_message: 'Yes',
      },
      preconditions: { graph_hash: 'somepriorhash' },
      expires_at_turn_count: 4, expires_at_iso: '2099-12-31T23:59:59.000Z',
      emitted_at_iso: '2026-07-22T11:00:00.000Z',
    };
    storeHolder.priorPendings = [priorHold];

    const { status, body } = await post(
      app,
      addOptionPayload(randomUUID(), {
        parent_decision_id: 'dec_choice',
        label: 'Outsource',
        interventions: [{ factor_id: 'fac_effort', value: 0.55 }],
      }),
    );
    expect(status).toBe(200);
    // C1: the prior hold is threaded into the commit's carry-forward (not dropped).
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]!.meta.priorPendingActions).toEqual([priorHold]);
    // C1: and the user is TOLD about it (honest supersession copy present).
    expect(body.assistant_text.toLowerCase()).toContain('set migration effort');
  });

  it('(b) GM off → fall-through with fell_through:gm_off telemetry, no held commit', async () => {
    gmHolder.mode = 'off';
    const { status } = await post(
      app,
      addOptionPayload(randomUUID(), {
        parent_decision_id: 'dec_choice', label: 'X', interventions: [{ factor_id: 'fac_effort', value: 0.5 }],
      }),
    );
    expect(status).toBe(200);
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'fell_through:gm_off')).toBe(true);
    // Our pre-route did not commit a held pending (the edit path owns the turn).
    expect(commitCalls).toHaveLength(0);
  });

  it('(b) invalid params (non-decision parent) → fall-through with the classified reason', async () => {
    const { status } = await post(
      app,
      addOptionPayload(randomUUID(), {
        parent_decision_id: 'g_profit', label: 'X', interventions: [{ factor_id: 'fac_effort', value: 0.5 }],
      }),
    );
    expect(status).toBe(200);
    expect(addOptionEvents(emitSpy).some((e) => e.outcome === 'fell_through:parent_not_decision')).toBe(true);
    expect(commitCalls).toHaveLength(0);
  });
});
