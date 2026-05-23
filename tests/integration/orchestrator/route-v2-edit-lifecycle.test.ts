/**
 * V5 edit lifecycle recovery v1 — route-v2 integration smoke.
 *
 * Drives `POST /orchestrate/v2/turn` end-to-end with a mocked LLM
 * adapter + session store and asserts that the two new pre-LLM
 * intercepts (chip-simplify, vague-edit-guard) short-circuit
 * BEFORE `dispatchEditGraph` is called. Also pins the negative
 * cases — concrete value edits and structural add-risk requests
 * continue to reach their existing routes — and the telemetry
 * distinguishes the three lifecycle outcomes.
 *
 * Mocking strategy mirrors `route-v2-edit-graph-recovery.test.ts`:
 *   - LLM router → deterministic stub (no network).
 *   - dispatchEditGraph → mock; we assert call counts.
 *   - session store → empty facts / null graph; the intercepts'
 *     freshness derivation degrades gracefully to null.
 *   - telemetry sink → recorded so we can pin event identity.
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
const readFactsForMock = vi.fn().mockResolvedValue([]);
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: readFactsForMock,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
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
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
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
              if (featProp === 'orchestratorV5') return true;
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

const GRAPH_STATE = {
  nodes: [
    { id: 'opt-1', kind: 'option', label: 'Option A — Hire now' },
    { id: 'fac-1', kind: 'factor', label: 'Hiring and Salary Cost' },
    { id: 'fac-2', kind: 'factor', label: 'Revenue' },
  ],
  edges: [
    { from: 'fac-1', to: 'opt-1' },
    { from: 'fac-2', to: 'opt-1' },
  ],
};

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-111111111111',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}

function emittedNames(): string[] {
  return telemetryEvents.map((e) => e.name);
}

function findEvent(name: string): Record<string, unknown> | undefined {
  return telemetryEvents.find((e) => e.name === name)?.payload;
}

describe('POST /orchestrate/v2/turn — V5 edit lifecycle recovery v1 intercepts', () => {
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
    readFactsForMock.mockReset().mockResolvedValue([]);
    telemetryEvents.length = 0;
  });

  // Test #1 (from the user's enumerated test list)
  it('legacy "Try a simpler version of this change." → does NOT call edit_graph; emits intercepted_chip_clarify', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Try a simpler version of this change.' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    const intercept = findEvent('v5.edit_graph.intercepted_chip_clarify');
    expect(intercept).toBeDefined();
    expect(intercept!.source).toBe('exact_text');

    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('The model is unchanged so far.');
    expect(body.assistant_text).toContain('apply it directly');
    expect(Array.isArray(body.suggested_actions)).toBe(true);
    expect(body.suggested_actions.length).toBeGreaterThan(0);
  });

  // Test #3
  it('vague edit "Edit this somehow" → does NOT call edit_graph; emits intercepted_vague_edit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Edit this somehow' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    const intercept = findEvent('v5.edit_graph.intercepted_vague_edit');
    expect(intercept).toBeDefined();
    expect(typeof intercept!.chips_emitted).toBe('number');

    const body = JSON.parse(res.body);
    expect(body.suggested_actions.length).toBeGreaterThan(0);
  });

  // Test #3b — PR #194 review correction. The brief listed these
  // examples as required intercepts; the prior wiring required
  // `EDIT_GRAPH_POSITIVE_REGEX` to fire first (which misses `make`,
  // `improve`, `try`), so these phrases used to fall through to
  // TurnExecutor instead of deterministic clarification. The fix:
  // run the vague-edit guard BEFORE editIntentDetected and add a
  // positive shape gate to the guard so it doesn't over-claim
  // conversational messages.
  it.each([
    'Make the model better',
    'Try something different',
    'Improve this',
  ])('vague improvement "%s" → intercepted (review-required example)', async (message) => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message,
        turn_id: '11111111-1111-4111-8111-1111111111d0',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).toContain('v5.edit_graph.intercepted_vague_edit');
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('The model is unchanged so far.');
  });

  // Test #3c — conversational messages MUST NOT be intercepted as
  // vague edits. Pins the new positive shape gate added in the
  // PR #194 review correction.
  it.each(['Hello', 'Tell me a joke', 'Thanks', 'Goodbye'])(
    'conversational "%s" → neither vague nor chip intercept fires',
    async (message) => {
      await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({
          message,
          turn_id: '11111111-1111-4111-8111-1111111111d1',
        }),
      });
      expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
      expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    },
  );

  // Test #4 — concrete value edits MUST keep their existing route.
  // Route-v2 suppresses `dispatchEditGraph` via `isValueUpdatePhrasing`
  // (pre-existing PR #192 gate) and falls through to TurnExecutor; the
  // deterministic value-update pre-route fires inside TurnExecutor.
  // This test asserts the contract this PR owns: the new intercepts
  // did NOT fire. We do not assert the wire status — TurnExecutor
  // fall-through in this mocked environment is exercised by other
  // suites (route-v2 golden-path, deterministic-value-update
  // integration).
  it('concrete value edit "Set Hiring and Salary Cost to £100,000" → neither new intercept fires', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Set Hiring and Salary Cost to £100,000' }),
    });
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  // Test #5 — structural add-risk edits MUST still dispatch (the V4
  // handler's pre-LLM A4 classifier catches them inside
  // dispatchEditGraph; not our concern here).
  it('"Add a risk for coordination overhead" → still dispatches to edit_graph (no intercept)', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Tell me what drives the new risk.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Add a risk for coordination overhead' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
  });

  // Test #6 — analytical questions MUST NOT be routed to edit_graph.
  // With the analytical-question guard wired into the
  // `editIntentDetected` predicate, "What could change the outcome?"
  // no longer reaches `dispatchEditGraph`; the turn falls through to
  // TurnExecutor where the post-analysis advice gate /
  // `what_would_flip` handler owns the response. Telemetry signal
  // `v5.edit_graph.analytical_question_suppressed` fires.
  it('"What could change the outcome?" → analytical-question guard suppresses dispatch', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'What could change the outcome?' }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
    const suppressed = findEvent('v5.edit_graph.analytical_question_suppressed');
    expect(suppressed).toBeDefined();
  });

  // Test #6b — additional analytical variants must also be suppressed.
  // Pin the wider grammar this PR ships, not just one literal phrase.
  // Includes the exact "How could the outcome move?" phrasing
  // (previously only adjacent variants were asserted).
  it.each([
    'What could change the outcome?',
    'What would change the outcome?',
    'What might shift the result?',
    'What would move the result?',
    'What would need to change for another option to win?',
    'How could another option win?',
    'How could the outcome change?',
    'How could the outcome move?', // PR #194 review correction — exact phrase
    'What should I change?', // PR #194 review correction — advice question
    'What should we update?', // PR #194 review correction — advice question
  ])('analytical variant "%s" → dispatch NOT called', async (message) => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message,
        turn_id: '11111111-1111-4111-8111-1111111111aa',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
  });

  // Test #6d — PR #194 review correction. The
  // `analytical_question_suppressed` telemetry MUST NOT fire when
  // `EDIT_GRAPH_NEGATIVE_REGEX` would already have suppressed the
  // message on its own (e.g. "what would..." is in the negative
  // regex). Previously the emit fired on any positive-regex +
  // analytical hit, overstating the new guard's contribution.
  it('"What would change the outcome?" → analytical_question_suppressed does NOT fire (negative regex already suppresses)', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'What would change the outcome?',
        turn_id: '11111111-1111-4111-8111-1111111111d2',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.analytical_question_suppressed');
  });

  // Test #6c — concrete edits remain unaffected by the new guard.
  // Regression assertion that the analytical-question suppression
  // does NOT block real value-edit instructions; PR #192 path stays
  // untouched.
  it.each([
    'Change Hiring and Salary Cost to £100,000.',
    'Change Hiring and Salary Cost from £80,000 to £100,000.',
    'Set Technical Leadership Capacity to 1.',
    'Add a risk for coordination overhead.',
  ])('concrete edit "%s" → analytical guard does NOT suppress (no analytical telemetry)', async (message) => {
    dispatchEditGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'mock dispatch reply',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
    });
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message,
        turn_id: '11111111-1111-4111-8111-1111111111bb',
      }),
    });
    expect(emittedNames()).not.toContain('v5.edit_graph.analytical_question_suppressed');
  });

  // Test #4 from the user's enumerated list — what_would_flip chip
  // metadata. When the UI sends a chip-click with
  // `chip.action_type === 'what_would_flip'`, route-v2 dispatches it
  // via `dispatchDeterministicChipClick` BEFORE editIntentDetected is
  // computed. Neither the new analytical guard nor the chip-simplify
  // intercept run on this path — the chip-click branch owns the
  // response. Pin this here so a future refactor of dispatch order
  // doesn't silently regress the chip-click contract.
  it('what_would_flip chip-click → routes through chip-click branch, not edit_graph', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'What would change the outcome?',
        source: 'chip_click',
        chip: { action_type: 'what_would_flip' },
        turn_id: '11111111-1111-4111-8111-1111111111cc',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
    // The analytical guard MAY have fired before the chip-click
    // branch claimed the turn — we don't assert that either way to
    // keep this test focused on the chip-click contract.
  });

  // Test #14 — telemetry must distinguish the three lifecycle outcomes.
  it('telemetry events are unique to each branch (chip_clarify vs vague_edit vs no_op)', async () => {
    // Branch A: chip_clarify
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Try a simpler version of this change.',
        turn_id: '11111111-1111-4111-8111-111111111aaa',
      }),
    });
    const aNames = emittedNames();
    expect(aNames).toContain('v5.edit_graph.intercepted_chip_clarify');
    expect(aNames).not.toContain('v5.edit_graph.intercepted_vague_edit');

    telemetryEvents.length = 0;
    dispatchEditGraphMock.mockReset();

    // Branch B: vague_edit
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Tweak this for me',
        turn_id: '11111111-1111-4111-8111-111111111bbb',
      }),
    });
    const bNames = emittedNames();
    expect(bNames).toContain('v5.edit_graph.intercepted_vague_edit');
    expect(bNames).not.toContain('v5.edit_graph.intercepted_chip_clarify');
  });

  // PR #194 review correction — prior fresh analysis copy.
  // When the request carries an analysisState whose
  // `meta.graph_hash_at_run` matches the request graph's
  // `computeAnalysisAffectingGraphHash`, the clarification appends
  // "Your last analysis is still current." Pure derivation — no
  // session-store / Supabase read on the intercept path.
  it('vague intercept + analysisState matching graph_hash_at_run → appends "Your last analysis is still current."', async () => {
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../../src/orchestrator-v5/context/graph-hash.js'
    );
    const liveHash = computeAnalysisAffectingGraphHash(GRAPH_STATE as never);
    expect(liveHash).toBeTruthy();
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        ...payload({
          message: 'Make this better',
          turn_id: '11111111-1111-4111-8111-1111111111e0',
        }),
        analysis_state: {
          analysis_status: 'success',
          meta: {
            graph_hash_at_run: liveHash,
            seed_used: 0,
            n_samples: 0,
            response_hash: '',
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    const intercept = findEvent('v5.edit_graph.intercepted_vague_edit');
    expect(intercept).toBeDefined();
    expect(intercept!.prior_analysis_is_fresh).toBe(true);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Your last analysis is still current.');
  });

  // PR #194 review correction — when analysisState is absent OR its
  // graph_hash_at_run does not match the request graph, the
  // freshness sentence MUST be omitted (honesty contract — never
  // restate a freshness we cannot prove from the request).
  it('vague intercept + no analysisState → omits freshness sentence', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Make this better',
        turn_id: '11111111-1111-4111-8111-1111111111e1',
      }),
    });
    expect(res.statusCode).toBe(200);
    const intercept = findEvent('v5.edit_graph.intercepted_vague_edit');
    expect(intercept!.prior_analysis_is_fresh).toBe(false);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toContain('still current');
  });
});
