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

const appendMock = vi.fn(async (write: { graph?: unknown }) => ({
  id: 'mock-row-id',
  ...(write.graph != null
    ? { graph_write_disposition: 'accepted_insert' as const }
    : {}),
}));
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
  // vague edits. Pins the positive phrase-gate added in the
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

  // Test #3d — PR #194 review-2 correction. Reviewer-flagged false
  // positives the broad-token shape gate produced: `try` and
  // standalone modifiers `better`/`different` matched anywhere,
  // intercepting benign retry / acknowledgement / option-
  // exploration traffic. The phrase-based grammar fixes verb+object
  // together — `try` alone is not enough, neither is `better`.
  // Test #6d — PR #194 review-3 correction. Advice-seeking value-edit
  // questions ("What should I set X to?", "What should I increase
  // by?") must route to TurnExecutor / post-analysis advice, NOT
  // edit_graph. Verified by direct execution that
  // `isValueUpdatePhrasing` returns FALSE for these shapes (the
  // missing space-separated value after `to`/`by`), so without the
  // analytical pattern they slip through.
  it.each([
    'What should I set Hiring and Salary Cost to?',
    'What should I increase Revenue by?',
    'What should I lower cost to?',
    'What should we set?',
    'What should I increase?',
    'What should we lower?',
  ])('advice-seeking value question "%s" → dispatch NOT called; analytical suppression fires', async (message) => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message,
        turn_id: '11111111-1111-4111-8111-1111111111d3',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(findEvent('v5.edit_graph.analytical_question_suppressed')).toBeDefined();
  });

  // Test #6e — concrete value edit with a value MUST still deflect via
  // `isValueUpdatePhrasing` (PR #192 path), NOT trigger the new
  // analytical telemetry (which only fires when the analytical guard
  // is THE deciding factor). Regression guard for the tighter
  // `analytical_question_suppressed` emit condition.
  it('"What should I set X to 100?" → value-update gate deflects; analytical telemetry NOT emitted', async () => {
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'What should I set Hiring and Salary Cost to 100?',
        turn_id: '11111111-1111-4111-8111-1111111111d4',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // The tighter emit condition (PR #194 review-1) requires
    // `!valueUpdate`. With value-update true, this telemetry MUST
    // NOT fire even though the analytical guard would have matched.
    expect(emittedNames()).not.toContain('v5.edit_graph.analytical_question_suppressed');
  });

  it.each([
    'Sounds better',
    'That is better',
    'Try again',
    'Try running analysis again',
    'Try Option B',
    'Maybe different',
    'Different',
  ])('reviewer false-positive "%s" → no intercept (review-2 regression guard)', async (message) => {
    // Some of these don't match EDIT_GRAPH_POSITIVE_REGEX either,
    // so they wouldn't have reached `dispatchEditGraph` even
    // before this fix; the assertion the user cares about is that
    // the vague-edit intercept doesn't fire and steer them into
    // deterministic clarification.
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message,
        turn_id: '11111111-1111-4111-8111-1111111111d2',
      }),
    });
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
    expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
  });

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
  // `computeAnalysisAffectingGraphHash` AND the status is one of
  // the canonical successful statuses (completed / computed /
  // complete / success), the clarification appends "Your last
  // analysis is still current." Pure derivation — no session-store
  // / Supabase read on the intercept path.
  //
  // PR #194 review-2 correction — covers all four canonical
  // statuses (was previously 'success' only, which is rare on the
  // production wire; the codebase uses 'completed' / 'computed' /
  // 'complete' — see analysis-state.ts:187).
  it.each(['completed', 'computed', 'complete', 'success'])(
    'vague intercept + analysisState (status=%s, hash matches) → appends "Your last analysis is still current."',
    async (status) => {
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
            analysis_status: status,
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
    },
  );

  // PR #194 review-2 correction — non-canonical / failed statuses
  // MUST NOT trigger the freshness copy, even when the hash
  // matches. Honesty contract: only restate freshness for an
  // analysis the request itself proves is successful.
  it.each(['partial', 'failed', 'pending', 'unknown', ''])(
    'vague intercept + analysisState (status=%s, hash matches) → freshness sentence OMITTED',
    async (status) => {
      const { computeAnalysisAffectingGraphHash } = await import(
        '../../../src/orchestrator-v5/context/graph-hash.js'
      );
      const liveHash = computeAnalysisAffectingGraphHash(GRAPH_STATE as never);
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          ...payload({
            message: 'Make this better',
            turn_id: '11111111-1111-4111-8111-1111111111e2',
          }),
          analysis_state: {
            analysis_status: status,
            meta: { graph_hash_at_run: liveHash },
          },
        },
      });
      expect(res.statusCode).toBe(200);
      const intercept = findEvent('v5.edit_graph.intercepted_vague_edit');
      expect(intercept).toBeDefined();
      expect(intercept!.prior_analysis_is_fresh).toBe(false);
      const body = JSON.parse(res.body);
      expect(body.assistant_text).not.toContain('still current');
    },
  );

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

  // ──────────────────────────────────────────────────────────────────
  // V5 post-analysis exploration intercept — end-to-end coverage
  // for the new `tryPostAnalysisLabelIntercept` route-v2 wiring and
  // the deterministic composer in
  // `routing/post-analysis-label-intercept.ts`. Covers:
  //   - Predicate A (bare label) — forward-looking gate.
  //   - Predicate B (legacy `Change <label> —`) — the EXACT observed
  //     staging failure shape.
  //   - The Touch-4 chip-message rewrite — new chip messages must NOT
  //     trip `EDIT_GRAPH_POSITIVE_REGEX` so a click falls through to
  //     TurnExecutor instead of re-entering edit_graph.
  // ──────────────────────────────────────────────────────────────────
  describe('V5 post-analysis label intercept (Predicates A + B)', () => {
    /**
     * Build the request body for a post-analysis turn where prior
     * analysis is fresh — Predicate A AND Predicate B require this.
     * Computes the live graph hash so `isPriorAnalysisFreshFromRequest`
     * returns true.
     */
    async function postAnalysisPayload(
      message: string,
      turnId = '11111111-1111-4111-8111-111111111ee0',
    ): Promise<Record<string, unknown>> {
      const { computeAnalysisAffectingGraphHash } = await import(
        '../../../src/orchestrator-v5/context/graph-hash.js'
      );
      const liveHash = computeAnalysisAffectingGraphHash(GRAPH_STATE as never);
      return {
        ...payload({ message, turn_id: turnId }),
        analysis_state: {
          analysis_status: 'completed',
          meta: {
            graph_hash_at_run: liveHash,
            seed_used: 0,
            n_samples: 0,
            response_hash: '',
          },
        },
      };
    }

    // Case 1 — Predicate A: bare label click.
    it('bare known label "Hiring and Salary Cost" → intercepted; NO edit_graph dispatch; three chips emitted', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: await postAnalysisPayload('Hiring and Salary Cost'),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();

      const intercept = findEvent('v5.post_analysis_label_intercept');
      expect(intercept).toBeDefined();
      expect(intercept!.predicate).toBe('bare_label');
      expect(intercept!.match_kind).toBe('exact');
      expect(intercept!.node_kind).toBe('factor');
      expect(intercept!.chips_emitted).toBe(3);

      // No no-op recovery should fire — the intercept short-circuited
      // BEFORE V4 LLM was called.
      expect(emittedNames()).not.toContain('v5.edit_graph.no_op_recovery');

      const body = JSON.parse(res.body);
      expect(body.assistant_text).toContain('Hiring and Salary Cost');
      expect(body.suggested_actions).toHaveLength(3);
      const actionTypes = body.suggested_actions.map(
        (a: { action_type?: string | null }) => a.action_type ?? null,
      );
      expect(actionTypes).toEqual(['explain_results', 'run_analysis', null]);
    });

    // Case 2 — Predicate B: the EXACT observed staging failure.
    it('legacy "Change Hiring and Salary Cost — " → intercepted; NO edit_graph dispatch; predicate=legacy_fill_in', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: await postAnalysisPayload(
          'Change Hiring and Salary Cost — ',
          '11111111-1111-4111-8111-111111111ee1',
        ),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();

      const intercept = findEvent('v5.post_analysis_label_intercept');
      expect(intercept).toBeDefined();
      expect(intercept!.predicate).toBe('legacy_fill_in');
      expect(intercept!.chips_emitted).toBe(3);
      expect(emittedNames()).not.toContain('v5.edit_graph.no_op_recovery');

      const body = JSON.parse(res.body);
      expect(body.suggested_actions).toHaveLength(3);
    });

    // Predicate gates — without fresh prior, the intercept defers and
    // the message returns to the existing routing chain (no intercept
    // telemetry, no chips from this module).
    it('bare label WITHOUT fresh prior analysis → intercept does NOT fire', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({
          message: 'Hiring and Salary Cost',
          turn_id: '11111111-1111-4111-8111-111111111ee2',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(emittedNames()).not.toContain('v5.post_analysis_label_intercept');
    });

    // Predicate B with a value after the dash must defer so the V4
    // LLM gets the real edit attempt. The downstream path then
    // depends on whether the mock response is wired; here we assert
    // ONLY the intercept's product behaviour (defers) — the
    // downstream 500 vs 200 split is the dispatchEditGraph mock's
    // concern, not the intercept's.
    it('legacy shape WITH value after dash ("Change Revenue — 100") → intercept does NOT fire', async () => {
      dispatchEditGraphMock.mockResolvedValueOnce({
        response: {
          response_version: 2,
          assistant_text: 'ok',
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
        commitPerformed: true,
        graph: null,
      });
      await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: await postAnalysisPayload(
          'Change Revenue — 100',
          '11111111-1111-4111-8111-111111111ee3',
        ),
      });
      expect(emittedNames()).not.toContain('v5.post_analysis_label_intercept');
    });

    // Explicit edit verbs must NEVER be intercepted. Three shapes
    // cover the gate's negative-verb-list: "Set" (line-leading
    // imperative), "Change" (legacy verb), "Adjust" (alternate
    // edit verb). Each must defer; the intercept never fires.
    it.each([
      'Set Revenue to 100',
      'Change Hiring and Salary Cost to 50',
      'Adjust Revenue by 10',
    ])('explicit-edit message "%s" → intercept does NOT fire', async (message) => {
      dispatchEditGraphMock.mockResolvedValue({
        response: {
          response_version: 2,
          assistant_text: 'ok',
          blocks: [],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'analyse',
        },
        commitPerformed: true,
        graph: null,
      });
      await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: await postAnalysisPayload(
          message,
          '11111111-1111-4111-8111-111111111ee4',
        ),
      });
      expect(emittedNames()).not.toContain('v5.post_analysis_label_intercept');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Touch 4 regression — the new chip submit message
  // ("For ${label}, what value should we use?") must NOT re-trigger
  // EDIT_GRAPH_POSITIVE_REGEX. If it did, the click would re-enter
  // edit_graph and reproduce the same closed-loop trap.
  // ──────────────────────────────────────────────────────────────────
  describe('Touch 4 chip-message hardening (regression)', () => {
    it('new buildLabelChip message "For Revenue, what value should we use?" → does NOT dispatch edit_graph', async () => {
      // This is the literal shape a Touch-4-hardened chip would
      // submit. Asserts the message falls through to TurnExecutor
      // (which the test setup's mock LLM router responds to with a
      // bland text reply), NOT into dispatchEditGraph.
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({
          message: 'For Revenue, what value should we use?',
          turn_id: '11111111-1111-4111-8111-111111111ee5',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // add_constraint dead-letter closure — ROUTE WIRING.
  //
  // These are WIRING tests, not predicate tests. `value-update-gate`'s
  // own unit suite proves clause D matches; it CANNOT prove route-v2
  // consults the gate for these shapes. PR #464's lane learned this the
  // hard way: all 12 of its pure-function guard tests passed with the
  // guard UNWIRED — only the chokepoint-wiring tests caught it. The
  // assertion that matters is therefore `dispatchEditGraphMock` never
  // being called: that is the V4 lane whose LLM has no constraint
  // operation and which no-opped every live probe into the
  // "factor, edge, option, or value" clarifier.
  // ────────────────────────────────────────────────────────────────
  describe('add_constraint dead-letter closure (route wiring)', () => {
    it.each([
      // The refusal chip's own replay text, verbatim (under-specified).
      'Add a constraint on Key Talent Attrition.',
      // Live probe 2 — fully specified; proves under-specification was
      // never the cause.
      'Add a constraint on Key Talent Attrition of at most 0.5.',
      // Live probe 3 — a factor target.
      'Add a constraint on Office Rent Cost of at most 0.5.',
    ])('constraint request "%s" → does NOT dispatch to V4 edit_graph', async (message) => {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({
          message,
          turn_id: '11111111-1111-4111-8111-111111111ee6',
        }),
      });
      expect(res.statusCode).toBe(200);
      // The whole defect in one assertion.
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
      // And it must not be swallowed by the Stage-4A clarify intercepts
      // either — those emit the same dead-end copy by another door.
      expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_vague_edit');
      expect(emittedNames()).not.toContain('v5.edit_graph.intercepted_chip_clarify');
    });

    // Anti-over-reach WIRING pin. Clause D must not swallow structural
    // `add` requests, which are add_node territory and MUST keep their
    // existing V4 route (this mirrors test #5 above; asserted here so a
    // future widening of clause D fails loudly rather than silently
    // stealing structural edits from edit_graph).
    it('structural "Add a risk for coordination overhead" → STILL dispatches to edit_graph', async () => {
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
        payload: payload({
          message: 'Add a risk for coordination overhead',
          turn_id: '11111111-1111-4111-8111-111111111ee7',
        }),
      });
      expect(res.statusCode).toBe(200);
      expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    });
  });
});
