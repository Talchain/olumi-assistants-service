/**
 * ⭐ ROADMAP 2.1261 — route-level pin for repair-leg bare-value binding.
 *
 * Reproduces the wire-witnessed A2 journey (deployed #998 `c5e2430`, scenario
 * a05fefcd-3956-4700-879f-6fc8b09e3905): a MISSING_OPTION_VALUE blocker asked
 * the user to choose an effect value, and the fully compliant, unit-free
 * "Set it to 0.12." (req b90d62e0, byte-verbatim below) was re-served the
 * IDENTICAL unit refusal because nothing bound the bare value to the factor
 * under discussion. The graph fixture is the A2 shape reduced to the nodes the
 * decision reads, VALIDATED against `buildCanonicalAnalysisReadyFromGraph`
 * (it derives exactly the witnessed pair of missing_value blockers — a
 * fixture the producer disowns proves nothing, trap 16).
 *
 * RED AT PRISTINE (#998 c5e24307): every case in the first two describes
 * fails on the pre-fix route — the message falls through to TurnExecutor's
 * LLM router (the mocked `chatWithTools` records the call) and no dispatch /
 * disambiguation happens.
 *
 * Harness modelled on `route-v2-configure-option-persisted-anchor.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
const readPendingsMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: readPendingsMock,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'text-only response' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
}));
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const telemetryEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      telemetryEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  };
}

/**
 * The A2 shape: two options, each linked to its own factor. `configured`
 * lists which options already carry an intervention. Validated against
 * `buildCanonicalAnalysisReadyFromGraph`: zero configured → the two
 * witnessed missing_value blockers; opt_pass configured → exactly one;
 * both configured → none.
 */
function buildGraph(configured: readonly ('opt_sub' | 'opt_pass')[] = []) {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Protect margin under new charges' },
      {
        id: 'fac_sub_cost',
        kind: 'factor',
        label: 'Subcontractor cost as share of affected revenue',
        category: 'controllable',
      },
      {
        id: 'fac_price_up',
        kind: 'factor',
        label: 'Customer price increase applied',
        category: 'controllable',
      },
      {
        id: 'opt_sub',
        kind: 'option',
        label: 'subcontracting inner-city deliveries to a green courier',
        ...(configured.includes('opt_sub')
          ? { data: { interventions: { fac_sub_cost: 0.4 } } }
          : {}),
      },
      {
        id: 'opt_pass',
        kind: 'option',
        label: 'paying the daily charges and passing costs to customers',
        ...(configured.includes('opt_pass')
          ? { data: { interventions: { fac_price_up: 0.3 } } }
          : {}),
      },
    ],
    edges: [
      edge('opt_sub', 'fac_sub_cost'),
      edge('opt_pass', 'fac_price_up'),
      edge('fac_sub_cost', 'goal_1'),
      edge('fac_price_up', 'goal_1'),
    ],
  };
}

/** The witnessed trapped message, byte-verbatim (a2-turn3-request.json). */
const TRAPPED_MESSAGE = 'Set it to 0.12.';

const EXPECTED_INSTRUCTION =
  "Set the subcontracting inner-city deliveries to a green courier option's " +
  'effect on Subcontractor cost as share of affected revenue to 0.12.';

let turnCounter = 0;
function payload(message: string): Record<string, unknown> {
  turnCounter += 1;
  return {
    kind: 'message',
    turn_id: `11111111-1111-4111-8111-1111111112${String(turnCounter).padStart(2, '0')}`,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message,
    turn_class: 'frame',
    source: 'composer',
  };
}

function repairEvents() {
  return telemetryEvents.filter(
    (e) => e.name === 'v5.edit_graph.repair_value_binding_resolved',
  );
}

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
  };
}

async function send(app: FastifyInstance, message: string) {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: payload(message),
  });
}

describe('POST /orchestrate/v2/turn — 2.1261 repair-leg bare-value binding', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    loadGraphMock.mockReset();
    readPendingsMock.mockReset();
    readPendingsMock.mockResolvedValue([]);
    telemetryEvents.length = 0;
  });

  // ── THE WITNESSED DEAD END, FIXED: two pairs missing → deterministic ASK ──

  it('the trapped message with TWO missing pairs gets a disambiguation naming both — no LLM, no refusal loop', async () => {
    loadGraphMock.mockResolvedValue(buildGraph());
    const res = await send(app, TRAPPED_MESSAGE);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // The witnessed canned refusal must be gone…
    expect(body.assistant_text).not.toContain('applying a value in %');
    // …replaced by an ask that names BOTH candidate pairs and the user value.
    expect(body.assistant_text).toContain('0.12');
    expect(body.assistant_text).toContain('Subcontractor cost as share of affected revenue');
    expect(body.assistant_text).toContain('Customer price increase applied');

    // One executable chip per pair, each carrying the user's value.
    expect(body.suggested_actions).toHaveLength(2);
    expect(body.suggested_actions[0].message).toBe(EXPECTED_INSTRUCTION);
    expect(body.suggested_actions[1].message).toContain('Customer price increase applied');
    expect(body.suggested_actions[1].message).toContain('0.12');

    // Deterministic: no routing LLM call, no edit dispatch.
    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    // The decision is observable.
    expect(repairEvents()).toHaveLength(1);
    expect(repairEvents()[0]!.payload).toMatchObject({ outcome: 'ask', pair_count: 2 });

    // Gate-reason integrity: readiness for the UNCHANGED graph rides the turn.
    expect(body.analysis_ready).toBeDefined();
  });

  // ── EXACTLY ONE PAIR MISSING → BIND through the edit lane ─────────────────

  it('the trapped message with ONE missing pair BINDS: edit lane dispatched with the advised-format instruction', async () => {
    loadGraphMock.mockResolvedValue(buildGraph(['opt_pass']));
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());

    const res = await send(app, TRAPPED_MESSAGE);

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const dispatchArgs = dispatchEditGraphMock.mock.calls[0]![0] as {
      payload: { message: string };
      editInstructionOverride?: string;
    };
    // The binding instruction is the probe-P1 advised format with the USER's
    // value; the payload's message stays the user's own bytes.
    expect(dispatchArgs.editInstructionOverride).toBe(EXPECTED_INSTRUCTION);
    expect(dispatchArgs.payload.message).toBe(TRAPPED_MESSAGE);

    expect(chatWithToolsMock).not.toHaveBeenCalled();
    expect(repairEvents()).toHaveLength(1);
    expect(repairEvents()[0]!.payload).toMatchObject({ outcome: 'bind', pair_count: 1 });
  });

  // ── OPPOSITE-DIRECTION TWINS: every one must keep today's route ───────────

  it('the witnessed turn-2 unit message is NEVER claimed — its honest refusal path stays reachable', async () => {
    loadGraphMock.mockResolvedValue(buildGraph());
    await send(app, 'The subcontractor cost should be 12% of revenue on the affected routes.');
    expect(repairEvents()).toHaveLength(0);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  it('a unit-bearing "Set it to 12%." is never claimed', async () => {
    loadGraphMock.mockResolvedValue(buildGraph(['opt_pass']));
    await send(app, 'Set it to 12%.');
    expect(repairEvents()).toHaveLength(0);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  it('with NOTHING missing the bare value is not claimed — no repair context, no invented referent', async () => {
    loadGraphMock.mockResolvedValue(buildGraph(['opt_sub', 'opt_pass']));
    const res = await send(app, TRAPPED_MESSAGE);
    expect(res.statusCode).toBe(200);
    expect(repairEvents()).toHaveLength(0);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // The pre-existing route answers the turn; the ask shape never appears.
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toMatch(/more than one effect value/i);
  });

  it('a live set_factor_value pending withdraws the claim — an open value clarification owns the turn', async () => {
    loadGraphMock.mockResolvedValue(buildGraph(['opt_pass']));
    readPendingsMock.mockResolvedValue([
      {
        id: 'pa-1',
        scenario_id: SCENARIO_ID,
        chip_id: 'chip-1',
        action: { kind: 'set_factor_value', factor_id: 'fac_sub_cost', value: 0.5, operator: 'set' },
        preconditions: {},
        expires_at_turn_count: 2,
        expires_at_iso: new Date(Date.now() + 60_000).toISOString(),
        emitted_at_iso: new Date().toISOString(),
      },
    ]);
    await send(app, TRAPPED_MESSAGE);
    expect(repairEvents()).toHaveLength(0);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  it('a pendings read failure withdraws the claim rather than failing the turn', async () => {
    loadGraphMock.mockResolvedValue(buildGraph(['opt_pass']));
    readPendingsMock.mockRejectedValue(new Error('store down'));
    const res = await send(app, TRAPPED_MESSAGE);
    expect(res.statusCode).toBe(200);
    expect(repairEvents()).toHaveLength(0);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });
});
