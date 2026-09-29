/**
 * Route-level pin for the edge-chip door (ROADMAP 1.187 / task #30 — the
 * HARD GATE before Lane U). Converged locus of TWO independent Fable reviews
 * (#635 attack residual, #639 attack line 1).
 *
 * DEFECT (pre-existing, latent until the UI ships typed mutation-chip
 * producers): a `chip_click` whose rendered copy is edge-edit-shaped
 * ("Adjust the influence of Price on Revenue to 0.8") matches
 * EDIT_GRAPH_POSITIVE_REGEX (via `adjust`) and is claimed by the edit lane's
 * `dispatchEditGraph` at route-v2 BEFORE runTurnExecutor — so the C2 typed-chip
 * reader (`buildTypedChipMutationProposal`, which owns `adjust_edge_strength`)
 * never sees the typed `chip.parameters`. This defeats the typed deterministic
 * path for `adjust_edge_strength` chips.
 *
 * FIX: thread the EXISTING `isNonReadinessTypedChipClickForExecutor` guard
 * into the `editIntentDetected` claim gate so a typed mutation chip_click is
 * never claimed by the edit lane and always reaches turn-executor (where the
 * C2 pre-route + #639 fall-through contract own it).
 *
 * This suite pins the ROUTING gate (edit lane vs turn-executor). The C2
 * reader's own behaviour on `chip.parameters` is tested by the
 * typed-chip-mutation-proposal unit suite; here `runTurnExecutor` is mocked,
 * so a call to it IS the proof the turn reached turn-executor rather than the
 * edit lane.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// -------- Mocks --------
// The edit lane (WRONG destination for a typed mutation chip) and the
// turn-executor (RIGHT destination) are both mocked so the routing decision is
// observable without a real LLM / Sonnet path.
const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const turnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: turnExecutorMock,
}));

// Deterministic chip-click dispatcher — mock ONLY the dispatch fn; keep the
// real whitelist predicate via importOriginal so a hand-listed re-implementation
// cannot drift silently (derive-don't-mirror; the whitelist is exactly
// {run_analysis}, and `adjust_edge_strength` is deliberately NOT in it).
const dispatchDeterministicChipClickMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js')
  >();
  return {
    ...actual,
    dispatchDeterministicChipClick: dispatchDeterministicChipClickMock,
  };
});

// COMPLETE shared store mock (ROADMAP 1.148 — derive, don't mirror). The
// route's proposal-confirm resolver reads `readMostRecentPendingActions` on the
// chip_click replay-candidate path; a hand-rolled store lacking it would throw
// and degrade the resolver to `suppress` (editIntentDetected=false), masking
// the very defect this suite must reproduce RED. The complete store returns an
// empty pendings list, so the resolver returns `pass` and edit routing proceeds
// untouched pre-fix.
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () => createMockSessionStore({ append: appendMock }),
    resetSessionStoreForTests: () => {},
  };
});

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

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
// Edge fac-1 → opt-1 so the chip's typed parameters name a real edge (faithful
// to a live producer). Routing does not depend on it, but a realistic bag keeps
// the fixture honest.
const GRAPH_STATE = {
  nodes: [
    { id: 'opt-1', kind: 'option', label: 'Option A' },
    { id: 'fac-1', kind: 'factor', label: 'Cost' },
  ],
  edges: [{ from: 'fac-1', to: 'opt-1' }],
};

// The task's canonical edge-edit-shaped copy. It hits EDIT_GRAPH_POSITIVE_REGEX
// via `adjust`, is NOT value-update-suppressed (`adjust` is not a set/update-`to`
// nor an increase/decrease-`by` verb), carries a numeric `0.8` (so the vague-edit
// guard stands down), and is not analytical / state-query / negative — i.e. a
// genuine edit-lane candidate. That is exactly why the edit lane wrongly claims
// the chip form before the fix.
const EDGE_EDIT_COPY = 'Adjust the influence of Price on Revenue to 0.8';

let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `66666666-6666-4666-8666-${String(turnCounter).padStart(12, '0')}`;
}

function makeTurnExecutorMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'turn-executor reached',
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

describe('POST /orchestrate/v2/turn — edge-chip door (typed mutation chip vs edit lane)', () => {
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
    turnExecutorMock.mockReset();
    turnExecutorMock.mockResolvedValue(makeTurnExecutorMockResult());
    dispatchDeterministicChipClickMock.mockReset();
    appendMock.mockClear();
  });

  // ------------------------------------------------------------------
  // RED-FIRST — the defect. A typed `adjust_edge_strength` chip_click with
  // typed parameters and edge-edit-shaped copy must reach turn-executor (the
  // C2 typed-chip reader), NOT the edit lane. Before the fix this test FAILS
  // by the edit lane claiming it (dispatchEditGraph called).
  // ------------------------------------------------------------------
  it('typed adjust_edge_strength chip_click reaches turn-executor, NOT dispatchEditGraph', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: EDGE_EDIT_COPY,
        turn_class: 'propose',
        source: 'chip_click',
        graph_state: GRAPH_STATE,
        chip: {
          action_type: 'adjust_edge_strength',
          parameters: { from: 'fac-1', to: 'opt-1', value: 0.8 },
        },
      },
    });
    // adjust_edge_strength is NOT whitelisted (whitelist = {run_analysis}), so
    // the deterministic dispatcher never runs.
    expect(dispatchDeterministicChipClickMock).not.toHaveBeenCalled();
    // THE PIN: the edit lane must NOT claim a typed mutation chip.
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    // And it lands in turn-executor, where the C2 pre-route reads the typed
    // parameters and the #639 fall-through contract owns it.
    expect(turnExecutorMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toBe('turn-executor reached');
  });

  // A second typed mutation action_type on the chip form — same routing law
  // (set_factor_value is also a TYPED_CHIP_MUTATION_ACTION_TYPE). Guards the
  // fix at the action_type level, not just one literal.
  it('typed set_factor_value chip_click also reaches turn-executor, NOT the edit lane', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        // Edit-verb-bearing copy that hits the positive regex via `set`/`change`
        // but is NOT value-update-suppressed here (kind-target phrasing is kept
        // on the edit route by the gate) — a genuine edit-lane candidate in
        // typed-text form, so the chip form would be wrongly claimed pre-fix.
        message: 'Change the weight of the Cost factor',
        turn_class: 'propose',
        source: 'chip_click',
        graph_state: GRAPH_STATE,
        chip: {
          action_type: 'set_factor_value',
          parameters: { target_id: 'fac-1', value: 0.4 },
        },
      },
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(turnExecutorMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  // ------------------------------------------------------------------
  // POSITIVE CONTROL (a) — the guard is CHIP-ONLY. Genuine user-TYPED text
  // (source='composer') with the SAME edge-edit-shaped copy is STILL claimed
  // by the edit lane, exactly as before the fix. The threading must not leak
  // into the typed-text edit path.
  // ------------------------------------------------------------------
  it('composer typed text with the same edit-verb copy is STILL claimed by the edit lane', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: EDGE_EDIT_COPY,
        turn_class: 'propose',
        source: 'composer',
        graph_state: GRAPH_STATE,
      },
    });
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Applied edit');
  });

  // POSITIVE CONTROL (a′) — an ANONYMOUS chip (source='chip', no typed
  // action_type) carrying edit-verb copy is NOT a typed chip_click, so the
  // guard does not apply and the edit lane still claims it. This pins that the
  // discriminant is `source==='chip_click' && a typed action_type`, not the
  // mere presence of a chip envelope.
  it('anonymous chip (no typed action_type) with edit-verb copy is STILL claimed by the edit lane', async () => {
    dispatchEditGraphMock.mockResolvedValueOnce(makeEditGraphMockResult());
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: EDGE_EDIT_COPY,
        turn_class: 'propose',
        source: 'chip',
        graph_state: GRAPH_STATE,
      },
    });
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(turnExecutorMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
