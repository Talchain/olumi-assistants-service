/**
 * Task 3 — route-level tests for V5 edit_graph pre-Sonnet dispatch.
 *
 * Validates the route-v2 branch that delegates natural-language graph
 * edits (message-kind + graph_state + edit-intent keywords) to
 * dispatchEditGraph. Focus is on the trigger heuristic:
 *   - positive regex matches must dispatch.
 *   - negative regex matches must NOT dispatch even if edit verbs also
 *     appear (mutating the graph on a meta-question is the worst failure
 *     mode, so we err toward not dispatching).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchEditGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

// V5 fallthrough mock — when route-v2 chooses TurnExecutor (e.g. because
// the value-update gate suppressed edit_graph dispatch), this mock returns
// a deterministic minimal-valid TurnExecutorRunResult so the integration
// test can assert the 200 production-target envelope without depending on
// a real LLM adapter / Sonnet routing path. Tests that need to exercise
// the real TurnExecutor flow live elsewhere; this file is for routing.
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

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const GRAPH_STATE = {
  nodes: [
    { id: 'opt-1', kind: 'option', label: 'Option A' },
    { id: 'fac-1', kind: 'factor', label: 'Cost' },
  ],
  edges: [{ from: 'fac-1', to: 'opt-1' }],
};

/**
 * Construct a minimal-valid TurnExecutorRunResult so the route-v2 path
 * after the gate / dispatch check can complete without needing a real
 * LLM adapter. The shape mirrors `TurnExecutorRunResult` in
 * `src/orchestrator-v5/turn-executor.ts`.
 *
 * Defaults:
 *   - commit_performed: true (route-v2 does not take the 5xx fail-closed
 *     path — see route-v2.ts:887 onward).
 *   - failure_type: null.
 *   - response: a friendly text-only OlumiResponse a chat renderer can
 *     surface as-is.
 */
function makeTurnExecutorMockResult(overrides: { assistantText?: string } = {}) {
  const assistantText =
    overrides.assistantText ??
    'Could you tell me which factor that update should affect, and what value it should take?';
  return {
    response: {
      response_version: 2 as const,
      assistant_text: assistantText,
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

function makeEditGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Applied edit — graph now has 2 nodes and 1 edges.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
  };
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '11111111-1111-4111-8111-11111111aa00',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'Change factor cost weight',
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — edit_graph dispatch', () => {
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
    // Default: TurnExecutor returns a benign 200-shaped envelope. Tests
    // that need a different shape override per-call.
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult());
  });

  it('positive edit keyword + graph_state + analyse stage → dispatches', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Reduce the weight of the cost factor' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Applied edit');
  });

  it('decide stage with edit keyword → dispatches', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        stage: 'decide',
        turn_class: 'decide',
        message: 'Add a constraint on time-to-launch',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
  });

  it('VALUE-UPDATE GATE: original failing categorical phrase routes to TurnExecutor and produces a deterministic 200 recoverable envelope', async () => {
    // P0 review-feedback test (2026-05, hardened round 3). The exact user
    // prompt that surfaced the staging "Something went wrong" UX previously
    // dispatched to edit_graph, where the LLM produced unparseable JSON
    // and the repair loop also failed. After the value-update gate it
    // falls through to TurnExecutor (Sonnet's tool-use path).
    //
    // The test mocks TurnExecutor with a minimal-valid friendly-text
    // response so the production-target path can be asserted
    // deterministically: HTTP 200, parseable OlumiResponse, friendly
    // assistant_text, no fatal error block. No 5xx fallback — a 5xx
    // would be a regression in the routing or response composition.
    const friendlyClarification =
      'Which factor should that update affect, and what value should it take?';
    turnExecutorMock.mockResolvedValueOnce(
      makeTurnExecutorMockResult({ assistantText: friendlyClarification }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        turn_id: '11111111-1111-4111-8111-11111111aa07',
        message:
          'All of our developers are middleweight, so please update the existing team maturity to be mid-weight developers',
      }),
    });

    // (1) edit_graph dispatcher MUST NOT have been invoked.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();

    // (2) TurnExecutor (the fallthrough target) WAS invoked exactly once.
    expect(turnExecutorMock).toHaveBeenCalledTimes(1);

    // (3) Production-target HTTP envelope: deterministic 200.
    expect(res.statusCode).toBe(200);

    // (4) Body parses as JSON.
    const body = JSON.parse(res.body) as {
      assistant_text: string;
      blocks: Array<{ type: string; severity?: string }>;
      suggested_actions: unknown[];
    };

    // (5) Friendly assistant_text from the mocked TurnExecutor reaches
    // the wire verbatim (after egress validation / response-finaliser).
    expect(body.assistant_text).toBe(friendlyClarification);

    // (6) NO fatal `error` block — that would render as the legacy
    // "Something went wrong on our side" copy in the UI's
    // severity-aware response router.
    const fatalErrorBlock = body.blocks.find(
      (b) => b.type === 'error' && b.severity === 'error',
    );
    expect(fatalErrorBlock).toBeUndefined();
  });

  it('NEGATIVE guard: "explain" + edit verb → NOT dispatched', async () => {
    // "explain how to remove the cost factor" contains `remove` (edit verb)
    // AND `explain` (non-edit phrasing). Non-edit wins — this is a
    // meta-question, not an edit command.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Explain how to remove the cost factor please',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // Fallthrough to TurnExecutor; may 200 or 500 in test env.
    expect([200, 500]).toContain(res.statusCode);
  });

  it('NEGATIVE guard: "what would" + edit verb → NOT dispatched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'What would it change if I reduce cost by 20%?',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('no graph_state → NOT dispatched (nothing to edit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111aa05',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Change the cost factor',
        turn_class: 'propose',
        source: 'composer',
      },
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('stage=frame with graph_state + edit verb → DISPATCHES (stage gate removed)', async () => {
    // The stage check was removed: presence of a graph is the load-bearing
    // precondition. Frame-stage edits are now dispatched if all other gates
    // pass (graph_state present, edit verb, no negative phrasing).
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        stage: 'frame',
        turn_class: 'frame',
        message: 'Change the factor weight',
      }),
    });
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect([200, 500]).toContain(res.statusCode);
  });

  it('message without edit keyword → NOT dispatched', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Tell me about this graph structure',
      }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('edit dispatch commit failure → 500 BoundaryError', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce({
      response: makeEditGraphMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Reduce cost factor' }),
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('edit_graph_commit_failed');
  });

  it('edit dispatcher throws → 500 BoundaryError', async () => {
    dispatchEditGraphMock.mockRejectedValueOnce(new Error('pipeline blew up'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Increase factor weight' }),
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('edit_graph_pipeline_threw');
  });

  // ------------------------------------------------------------------
  // Regression: phrasings that might trip edit_graph trigger
  // ------------------------------------------------------------------
  // Positive guard: EDIT_INTENT_REGEX (verbs like change/reduce/add).
  // Negative guard: NON_EDIT_INTENT_REGEX (explain/what would/why) — if
  // it matches, dispatch is SUPPRESSED even when an edit verb is
  // present. Mutating the graph on a meta-question is the worst failure
  // mode, so we err toward NOT dispatching. These regression cases
  // document the exact boundaries.
  describe('regression phrasings — current trigger behaviour', () => {
    const cases = [
      {
        label: 'positive: "raise" (synonym of increase)',
        message: 'Raise the strength of the market risk edge',
        expectDispatch: true,
      },
      {
        // P0 fix (2026-05): "Lower X by Y" is a value-update phrasing,
        // same shape as "decrease the cost by half" — moved off the
        // fragile edit_graph LLM JSON path onto the D1 / Sonnet
        // tool-use path via EDIT_GRAPH_VALUE_UPDATE_REGEX. The previous
        // assertion (dispatch=true) reflected legacy behaviour where
        // "lower" was treated as a structural verb regardless of value
        // shape; the new policy honours the value-update structure.
        label: 'suppressed: "lower X by Y" — value update, not structural',
        message: 'Lower the cost factor by a notch',
        expectDispatch: false,
      },
      {
        label: 'positive: "tweak"',
        message: 'Tweak the probability on the regulatory edge slightly',
        expectDispatch: true,
      },
      {
        label: 'suppressed: "explain why" + edit verb',
        message: 'Explain why I should reduce the cost factor before acting',
        expectDispatch: false,
      },
      {
        label: 'suppressed: "tell me how" + edit verb',
        message: 'Tell me how to add a constraint on schedule',
        expectDispatch: false,
      },
      {
        label: 'suppressed: "compare options" alone',
        message: 'Compare options A and B for me',
        expectDispatch: false,
      },
      {
        label: 'KNOWN FALSE NEGATIVE: passive mutation request',
        message: 'Regulatory factor should be weighted less heavily overall',
        expectDispatch: false,
      },
      // ──────────────────────────────────────────────────────────────
      // Frame-stage false-positive guard cases — added when the stage
      // gate was removed from isEditGraphShape. Without these, frame-
      // stage conversational/figurative use of edit verbs would falsely
      // dispatch and mutate the graph.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'suppressed: figurative "add" — "add some context"',
        message: 'Let me add some context about our constraints',
        expectDispatch: false,
      },
      {
        label: 'suppressed: phrasal "set up"',
        message: "I'd like to set up the decision properly first",
        expectDispatch: false,
      },
      {
        label: 'suppressed: figurative "remove doubt"',
        message: 'Let me remove any doubt about the timeline',
        expectDispatch: false,
      },
      {
        label: 'suppressed: phrasal "set aside"',
        message: 'Set aside the cost factor for now',
        expectDispatch: false,
      },
      {
        label: 'suppressed: meta "reduce complexity"',
        message: 'Reduce complexity by focusing on the main issue',
        expectDispatch: false,
      },
      {
        label: 'suppressed: idiomatic "change my mind"',
        message: "Change my mind — let's think about this differently",
        expectDispatch: false,
      },
      {
        label: 'suppressed: meta "update our approach"',
        message: 'Update our approach to include risk',
        expectDispatch: false,
      },
      {
        label: 'suppressed: UI command "delete this thread"',
        message: 'Delete this thread and start fresh',
        expectDispatch: false,
      },
      // Sanity: legitimate edits still dispatch despite expanded negative regex.
      {
        label: 'positive: "Add an option for contract hiring"',
        message: 'Add an option for contract hiring',
        expectDispatch: true,
      },
      {
        label: 'positive: "Increase the budget to 300k"',
        message: 'Increase the budget to 300k',
        expectDispatch: true,
      },

      // ──────────────────────────────────────────────────────────────
      // P0 fix (2026-05) — value-update negative gate. Phrasings that
      // express a value change for a single factor must NOT dispatch
      // edit_graph; they belong on the deterministic D1 / Sonnet
      // tool-use path. See EDIT_GRAPH_VALUE_UPDATE_REGEX in route-v2.ts.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'suppressed: value-update "set churn to 5%"',
        message: 'set churn to 5%',
        expectDispatch: false,
      },
      {
        label: 'suppressed: value-update "update existing team maturity to mid-weight developers"',
        message: 'update existing team maturity to mid-weight developers',
        expectDispatch: false,
      },
      {
        label: 'suppressed: value-update "update the existing team maturity to be mid-weight developers"',
        message: 'update the existing team maturity to be mid-weight developers',
        expectDispatch: false,
      },
      {
        label: 'suppressed: value-update "increase price by 10%"',
        message: 'increase price by 10%',
        expectDispatch: false,
      },
      {
        label: 'suppressed: value-update "decrease the cost by half"',
        message: 'decrease the cost by half',
        expectDispatch: false,
      },
      {
        label:
          'suppressed: value-update with leading preamble (regression: original failing user request)',
        message:
          'All of our developers are middleweight, so please update the existing team maturity to be mid-weight developers',
        expectDispatch: false,
      },

      // Lock-in: structural edits MUST still dispatch despite the new gate.
      {
        label: 'positive: structural "update the model to include market dynamics" (NOT value-update)',
        message: 'update the model to include market dynamics',
        expectDispatch: true,
      },

      // ──────────────────────────────────────────────────────────────
      // Filler-after-`to` regression locks (review feedback, 2026-05).
      // The structural-verb scan window after `to ` looks ahead 0-3
      // tokens for include|add|contain|cover|incorporate|comprise|
      // encompass|capture|reflect. These cases assert that adverbial
      // fillers between `to` and the structural verb still preserve
      // the edit_graph route.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'positive: structural with filler "to also include"',
        message: 'update the model to also include market dynamics',
        expectDispatch: true,
      },
      {
        label: 'positive: structural with filler "to better reflect"',
        message: 'update the model to better reflect market dynamics',
        expectDispatch: true,
      },
      {
        label: 'positive: structural with filler "to just capture"',
        message: 'update the model to just capture supply risk',
        expectDispatch: true,
      },
      {
        label: 'positive: structural with filler "to actually incorporate"',
        message: 'update the model to actually incorporate market dynamics',
        expectDispatch: true,
      },
      {
        label: 'positive: structural with filler "to now contain"',
        message: 'update the model to now contain churn factor',
        expectDispatch: true,
      },

      // ──────────────────────────────────────────────────────────────
      // Kind-change filler regression locks (review feedback, 2026-05).
      // Phrasings of the form "set/update X to (be|become) (a|an|the)?
      // <KIND>" must remain on the edit_graph route — they are
      // structural reclassification, not value updates. The kind-target
      // lookahead uses the same 0-3 token scan window as the structural
      // lookahead so adverbial fillers like "be" and "become" do not
      // sneak the message into the value-update gate.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'positive: kind change "to be a factor"',
        message: 'set goal to be a factor',
        expectDispatch: true,
      },
      {
        label: 'positive: kind change "to be an outcome"',
        message: 'update risk X to be an outcome',
        expectDispatch: true,
      },
      {
        label: 'positive: kind change "to become a decision"',
        message: 'update the model to become a decision',
        expectDispatch: true,
      },
      {
        label: 'positive: kind change "to become an option"',
        message: 'update node X to become an option',
        expectDispatch: true,
      },
      {
        label: 'positive: kind change "to factor" (no article)',
        message: 'set X to factor',
        expectDispatch: true,
      },

      // ──────────────────────────────────────────────────────────────
      // Meta-noun guard regression locks (review feedback round 3,
      // 2026-05). When the verb's object is "model" / "graph" /
      // "diagram", the request is a whole-graph quality / structural
      // change. The gate's META_NOUN_GUARD lookahead rejects these
      // BEFORE the value-update structure could match.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'positive: meta-noun "the model" + quality "to be more realistic"',
        message: 'update the model to be more realistic',
        expectDispatch: true,
      },
      {
        label: 'positive: meta-noun "the model" + quality "to be more complete"',
        message: 'update the model to be more complete',
        expectDispatch: true,
      },
      {
        label: 'positive: meta-noun "the model" + "to better represent churn"',
        message: 'update the model to better represent churn',
        expectDispatch: true,
      },
      {
        label: 'positive: meta-noun "the graph" + quality',
        message: 'update the graph to be more accurate',
        expectDispatch: true,
      },
      {
        label: 'positive: meta-noun "the diagram" + quality',
        message: 'update the diagram to be cleaner',
        expectDispatch: true,
      },
      {
        label: 'positive: meta-noun "model" without article',
        message: 'update model to better reflect market dynamics',
        expectDispatch: true,
      },

      // ──────────────────────────────────────────────────────────────
      // Plural kind targets (review feedback round 3). Same kind-change
      // semantics as singulars; the kind keyword list now includes
      // plurals so these stay on the edit_graph route.
      // ──────────────────────────────────────────────────────────────
      {
        label: 'positive: plural kind "to be risks"',
        message: 'set X to be risks',
        expectDispatch: true,
      },
      {
        label: 'positive: plural kind "to become options"',
        message: 'update nodes to become options',
        expectDispatch: true,
      },
      {
        label: 'positive: plural kind "to be factors"',
        message: 'set the goals to be factors',
        expectDispatch: true,
      },

      {
        label: 'positive: kind change "change risk X to outcome" (NOT value-update)',
        message: 'change risk X to outcome',
        expectDispatch: true,
      },
      {
        label: 'positive: structural remove "remove salary cost pressure"',
        message: 'remove salary cost pressure',
        expectDispatch: true,
      },
      {
        label: 'positive: structural add "add market competition as a factor"',
        message: 'add market competition as a factor',
        expectDispatch: true,
      },
      {
        label: 'positive: edge-strength "raise the strength of the market risk edge" (no `by`, kept on edit_graph)',
        message: 'raise the strength of the market risk edge',
        expectDispatch: true,
      },
      {
        label: 'positive: A4 deterministic clarification path "Add team dynamics as a risk" (still goes to edit_graph dispatcher)',
        message: 'Add team dynamics as a risk',
        expectDispatch: true,
      },
    ];

    let turnIdSuffix = 0;
    for (const c of cases) {
      it(`${c.label}`, async () => {
        if (c.expectDispatch) {
          dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
        }
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: payload({
            turn_id: `11111111-1111-4111-8111-11111eee11${String(turnIdSuffix++).padStart(2, '0')}`,
            message: c.message,
          }),
        });
        if (c.expectDispatch) {
          expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
        } else {
          expect(dispatchEditGraphMock).not.toHaveBeenCalled();
        }
        expect([200, 500]).toContain(res.statusCode);
      });
    }
  });
});
