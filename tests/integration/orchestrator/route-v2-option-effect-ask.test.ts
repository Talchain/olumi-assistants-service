/**
 * ⭐ ROADMAP 2.1266 / ACCEPTANCE 4 — route-level pin: an option-effect request
 * whose ENTITY is ambiguous is ANSWERED WITH A QUESTION and never dispatched.
 *
 * The write half of 2.1266 binds inside `dispatchEditGraph`. This is the other
 * half, and it has to sit HERE rather than in the dispatcher: once the edit
 * lane has run, the 2.427 recovery copy resolves an option by first-match and
 * speaks about it BY NAME — i.e. the guess is only avoidable before dispatch.
 *
 * Harness mirrors `route-v2-configure-option.test.ts`: `dispatchEditGraph` and
 * `runTurnExecutor` are mocked, so every assertion is purely about WHICH lane
 * the route chose and what it said.
 *
 * ⚠ THIS FILE IMPORTS NO 2.1266 MODULE. That is deliberate: it is
 * pristine-runnable, so the RED it produces at `293da078` is a statement about
 * the PRODUCT's behaviour (the ambiguous sentence is dispatched, and the reply
 * comes from the edit lane) rather than about a missing import.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const turnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: turnExecutorMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
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

const OPTION_A = 'Open the Leeds depot next quarter';
const OPTION_B = 'Expand the Manchester depot instead';
const FACTOR = 'Capital expenditure';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 1, std: 0.01 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

/**
 * A STRICT-PARSEABLE graph: two options, both wired to the same factor, both
 * unconfigured. Strictness matters — the resolver declines on a graph that
 * does not strict-parse, so a sloppy fixture would make this suite green for
 * the wrong reason.
 */
const GRAPH_STATE = {
  nodes: [
    { id: 'dec_depot', kind: 'decision', label: 'Depot capacity' },
    { id: 'opt_leeds', kind: 'option', label: OPTION_A, interventions: {} },
    { id: 'opt_manchester', kind: 'option', label: OPTION_B, interventions: {} },
    {
      id: 'fac_capex',
      kind: 'factor',
      label: FACTOR,
      observed_state: { value: 0.5, source: 'cee_inference', extractionType: 'inferred' },
    },
    { id: 'goal_margin', kind: 'goal', label: 'Margin preservation' },
  ],
  edges: [
    edge('dec_depot', 'opt_leeds'),
    edge('dec_depot', 'opt_manchester'),
    edge('opt_leeds', 'fac_capex'),
    edge('opt_manchester', 'fac_capex'),
    edge('fac_capex', 'goal_margin'),
  ],
};

/**
 * ⭐⭐ THE COLLIDING GRAPH — two options carrying the SAME label, distinct ids.
 *
 * Same shape as `GRAPH_STATE`, and deliberately so: the ONLY difference is that
 * `opt_leeds_dup` repeats `OPTION_A` verbatim. So a difference in outcome
 * between the two fixtures is attributable to the collision and to nothing else.
 */
const COLLIDING_GRAPH_STATE = {
  nodes: [
    { id: 'dec_depot', kind: 'decision', label: 'Depot capacity' },
    { id: 'opt_leeds', kind: 'option', label: OPTION_A, interventions: {} },
    { id: 'opt_leeds_dup', kind: 'option', label: OPTION_A, interventions: {} },
    {
      id: 'fac_capex',
      kind: 'factor',
      label: FACTOR,
      observed_state: { value: 0.5, source: 'cee_inference', extractionType: 'inferred' },
    },
    { id: 'goal_margin', kind: 'goal', label: 'Margin preservation' },
  ],
  edges: [
    edge('dec_depot', 'opt_leeds'),
    edge('dec_depot', 'opt_leeds_dup'),
    edge('opt_leeds', 'fac_capex'),
    edge('opt_leeds_dup', 'fac_capex'),
    edge('fac_capex', 'goal_margin'),
  ],
};

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'edit lane engaged',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function makeTurnExecutorMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'turn-executor path',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    telemetry: {
      stages_completed: ['build_turn_context', 'route', 'execute', 'commit'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 12,
      turn_class: null,
      intent_class: null,
      coaching_mode: null,
      validation_error_code: null,
    },
  };
}

function collidingPayload(message: string): Record<string, unknown> {
  return { ...payload(message), graph_state: COLLIDING_GRAPH_STATE };
}

function payload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '22222222-2222-4222-8222-22222222bb00',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
  };
}

describe('POST /orchestrate/v2/turn — an ambiguous option-effect request asks', () => {
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
    dispatchEditGraphMock.mockResolvedValue(makeEditGraphMockResult());
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult());
    appendMock.mockClear();
  });

  it('names both options, writes nothing, and never dispatches the edit lane', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(
        `Set the ${OPTION_A} option's effect and the ${OPTION_B} option's effect on ${FACTOR} to 0.4.`,
      ),
    });

    expect(res.statusCode).toBe(200);
    // The guess is only avoidable before dispatch — so the dispatch must not
    // happen at all.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(turnExecutorMock).not.toHaveBeenCalled();

    const body = res.json() as {
      assistant_text: string;
      suggested_actions: Array<{ label: string; message?: string }>;
    };
    expect(body.assistant_text).toContain(OPTION_A);
    expect(body.assistant_text).toContain(OPTION_B);
    expect(body.assistant_text).toContain('not changed the model');
    // P8: a direct answer is one click away, in the phrasing the product
    // itself advises.
    expect(body.suggested_actions.length).toBeGreaterThan(0);
    for (const action of body.suggested_actions) {
      expect(action.message).toContain("option's effect on");
      expect(action.message).toContain('0.4');
    }
  });

  it('OPPOSITE-DIRECTION TWIN — an UNAMBIGUOUS request is dispatched, not asked', async () => {
    // Without this twin the assertions above would pass on a route that
    // answered every option-effect turn with a question.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(`Set the ${OPTION_A} option's effect on ${FACTOR} to 0.4.`),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect((res.json() as { assistant_text: string }).assistant_text).toBe('edit lane engaged');
  });

  // ══════════════════════════════════════════════════════════════════════
  // ⭐⭐ THE DUPLICATE-OPTION-LABEL EXIT, AT THE ROUTE.
  //
  // ⚠ WHY THIS BLOCK EXISTS AS A ROUTE TEST AND NOT ONLY A RESOLVER TEST.
  // The resolver spec proves `label_collision` is RETURNED. It cannot prove the
  // route HANDLES it — and an unhandled `label_collision` does not fail loudly:
  // it falls past this block to `dispatchEditGraph`, i.e. the wrong-entity-write
  // path the whole seam exists to close. Measured: neutralising the route's
  // collision branch left the full required gate byte-identical to pristine
  // (1,868 files / 32,917 passed), so a tidy-up deleting it would have restored
  // the defect AND made it silent, under a fully green suite. The positive
  // control for that measurement is the sibling ask branch in this same block,
  // whose equivalent mutation REDs the first test in this file.
  //
  // So the load-bearing assertion here is `dispatchEditGraphMock` NOT called.
  // Everything else is corroboration.
  describe('two options share one label — the escape exit', () => {
    it('answers with the escape coaching and NEVER reaches the edit lane', async () => {
      // PRECONDITION PINNED, not assumed: two DISTINCT option ids carrying ONE
      // label. A fixture that silently collapsed them would make every
      // assertion below pass for the wrong reason.
      const options = COLLIDING_GRAPH_STATE.nodes.filter((n) => n.kind === 'option');
      expect(options).toHaveLength(2);
      expect(new Set(options.map((n) => n.id)).size).toBe(2);
      expect(new Set(options.map((n) => n.label)).size).toBe(1);

      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: collidingPayload(
          `Set the ${OPTION_A} option's effect on ${FACTOR} to 0.4.`,
        ),
      });

      expect(res.statusCode).toBe(200);
      // ⭐ THE ONE THAT MATTERS. An unhandled collision falls through to here.
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
      expect(turnExecutorMock).not.toHaveBeenCalled();

      const body = res.json() as {
        assistant_text: string;
        suggested_actions: Array<{ label: string; message?: string }>;
      };
      expect(body.assistant_text).toContain('share the name');
      expect(body.assistant_text).toContain('not changed the model');
      // The route the copy names, and the label quoted exactly ONCE — the old
      // ask's whole failure was repeating one string as if that distinguished it.
      // DELETE, not rename: rename is dark in the UI at the deployed tip, so
      // naming it would swap this dead end for a new one.
      expect(body.assistant_text.toLowerCase()).toContain('press delete');
      expect(body.assistant_text.split(OPTION_A)).toHaveLength(2);
      // ⚠ NO CHIP. Every label-spelled chip re-enters the collision; this is the
      // difference from the sibling ask above, which ships chips deliberately.
      expect(body.suggested_actions).toHaveLength(0);
    });

    it('OPPOSITE-DIRECTION TWIN — DISTINCT labels still reach the chip-bearing ask, not this exit', async () => {
      // Without this twin the block above would pass on a route that answered
      // every ambiguous option-effect turn with the rename copy, silently
      // withdrawing the chips the distinct-label ask is supposed to offer.
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload(
          `Set the ${OPTION_A} option's effect and the ${OPTION_B} option's effect on ${FACTOR} to 0.4.`,
        ),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        assistant_text: string;
        suggested_actions: Array<{ label: string }>;
      };
      expect(body.assistant_text).not.toContain('share the name');
      expect(body.suggested_actions.length).toBeGreaterThan(0);
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    });
  });

  it('OPPOSITE-DIRECTION TWIN — an ordinary edit is dispatched, not asked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload('Add a factor for driver retention.'),
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });
});
