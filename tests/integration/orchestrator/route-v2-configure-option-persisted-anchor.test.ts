/**
 * ROADMAP 2.308 / S1 — route-level pin for the configure-option label anchor.
 *
 * `configure-option-persisted-label-anchor.test.ts` pins the resolver in
 * isolation. This file pins the thing that actually broke: the WIRING in
 * `src/orchestrator/route-v2.ts`. The 2.308 defect was never in the detector —
 * the detector's triggers 4 and 5 were correct and unit-tested. What was wrong
 * was WHERE the labels came from and WHEN the graph was loaded, and a
 * unit-level test of the detector cannot see that (trap 16: a symbol proves
 * presence-in-repo, never presence-on-the-live-wire).
 *
 * Every case below sends a turn with **no `graph_state`** — the live-wire
 * shape, verified at the bytes across all eight captured request bodies in the
 * diagnosis — and a persisted `scenarios.graph` that carries the option
 * labels. That is precisely the state in which the label anchor was
 * unreachable before this change.
 *
 * MUTATION SENSITIVITY (this is the point of the file): re-nest the persisted
 * load back inside `if (editIntentDetected)` and case 1 goes RED — remedy #7
 * loses its anchor, `configureOptionIntent` goes false, `editIntentDetected`
 * goes false (the value-update gate already suppressed the edit-verb door),
 * and the turn falls through to TurnExecutor with no dispatch.
 *
 * Harness modelled on `route-v2-edit-graph-recovery.test.ts` (same mocks, same
 * telemetry capture).
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
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
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

const SCENARIO_ID = '44444444-4444-4444-8444-444444444444';

/**
 * The 2.308 scenario, reduced to the nodes the routing decision reads. The
 * option label is the one the tester's remedies named; the factor is the one
 * the add-option turn minted.
 */
const PERSISTED_GRAPH = {
  nodes: [
    { id: 'opt_retention', kind: 'option', label: 'Launch Customer Retention Programme' },
    { id: 'fac_retention_investment', kind: 'factor', label: 'Customer Retention Investment' },
    { id: 'goal_arr', kind: 'goal', label: 'ARR' },
  ],
  edges: [
    { from: 'opt_retention', to: 'fac_retention_investment' },
    { from: 'fac_retention_investment', to: 'goal_arr' },
  ],
};

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function payload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111200',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    // THE LIVE WIRE: no `extensions`, no `graph_state`.
    message,
    turn_class: 'propose',
    source: 'composer',
  };
}

function emittedNames(): string[] {
  return telemetryEvents.map((e) => e.name);
}

function findEvent(name: string): Record<string, unknown> | undefined {
  return telemetryEvents.find((e) => e.name === name)?.payload;
}

describe('POST /orchestrate/v2/turn — 2.308 S1 configure-option persisted label anchor', () => {
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
    loadGraphMock.mockReset();
    loadGraphMock.mockResolvedValue(PERSISTED_GRAPH);
    telemetryEvents.length = 0;
  });

  // ─── The dominant case ────────────────────────────────────────────────
  it('remedy #7 — "Under {option label}, set {factor} to £40,000" — reaches the edit lane', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(
        'Under Launch Customer Retention Programme, set Customer Retention Investment to £40,000',
      ),
    });

    expect(res.statusCode).toBe(200);
    // The routing decision, not just the outcome: the label anchor was
    // consulted, and it came from the PERSISTED graph.
    expect(emittedNames()).toContain('v5.edit_graph.configure_option_labels_loaded');
    expect(findEvent('v5.edit_graph.configure_option_labels_loaded')).toMatchObject({
      matched: true,
    });
    // …and the turn actually dispatched to the one lane that writes option
    // interventions, rather than falling through to the LLM router.
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    // NOTE on the sibling counter: `v5.edit_graph.configure_option_intent_routed`
    // is deliberately NOT asserted here. It is gated on `!positiveEditRegexHit`
    // ("emit only when this gate is the deciding factor"), and these messages
    // DO carry a positive edit verb — the door they were denied was closed by
    // the VALUE-UPDATE gate, not by the absence of a verb. So that counter is
    // silent for precisely the class of turn S1 rescues, and
    // `configure_option_labels_loaded{matched:true}` is the honest meter for
    // this fix. Left as-is rather than widened: changing the condition would
    // alter an existing counter's meaning for reasons outside 2.308.
    expect(emittedNames()).not.toContain('v5.edit_graph.configure_option_intent_routed');
  });

  it('remedy #6 — the compound 0-1 phrasing — reaches the edit lane', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(
        'Under Launch Customer Retention Programme, set Customer Retention Investment to 1 and Customer Churn Rate to 0.2',
      ),
    });

    expect(res.statusCode).toBe(200);
    expect(findEvent('v5.edit_graph.configure_option_labels_loaded')).toMatchObject({
      matched: true,
    });
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });

  // ─── One read per turn (the diagnosis's explicit performance instruction) ──
  it('reads the persisted graph exactly ONCE across the anchor and the edit-lane reload', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(
        'Under Launch Customer Retention Programme, set Customer Retention Investment to £40,000',
      ),
    });

    // Both the label anchor and the graphState reload want `scenarios.graph`.
    // Without the turn-scoped memo this is 2.
    expect(loadGraphMock).toHaveBeenCalledTimes(1);
    // …and the reload still happened (the memo must feed it, not bypass it).
    expect(emittedNames()).toContain('v5.edit_graph.graph_state_reloaded');
  });

  // ─── The read is not added to turns it cannot help ────────────────────
  it('does NOT read the persisted graph for a turn with no configure-shaped payload', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload('Thanks, that all makes sense so far.'),
    });

    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.configure_option_labels_loaded');
  });

  // ─── Blast radius: a plain factor edit must NOT be claimed ────────────
  it('remedy #2 — a plain FACTOR value edit — is NOT claimed by the configure gate', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload('Set Customer Retention Investment to £40,000'),
    });

    // The anchor read is taken (the message is value-set shaped, so the
    // detector cannot rule it out without the labels) …
    expect(emittedNames()).toContain('v5.edit_graph.configure_option_labels_loaded');
    expect(findEvent('v5.edit_graph.configure_option_labels_loaded')).toMatchObject({
      matched: false,
    });
    // … but the verdict is unchanged: it stays off the edit lane, so
    // `set_factor_value` keeps owning plain factor value updates.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.configure_option_intent_routed');
  });

  // ─── A failing labels read must never fail a turn ─────────────────────
  it('a session-store failure during the anchor read degrades, it does not 500 the turn', async () => {
    loadGraphMock.mockRejectedValue(new Error('supabase down'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(
        'Under Launch Customer Retention Programme, set Customer Retention Investment to £40,000',
      ),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // The memo cached the rejection, so the turn did not retry the read.
    expect(loadGraphMock).toHaveBeenCalledTimes(1);
  });
});
