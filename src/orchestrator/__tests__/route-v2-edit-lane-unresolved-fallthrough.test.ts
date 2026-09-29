/**
 * FULL-ROUTE routing test — the edit lane must be NON-TERMINAL when it
 * resolved nothing.
 *
 * THE MEASURED DEFECT. `editIntentDetected` (route-v2.ts:5340) claims a turn on
 * a bare edit VERB, ~2,700 lines before anything can consult run facts. The
 * edit exit (`:5678 sendFinalised200`) is TERMINAL, and `runTurnExecutor` —
 * where the context pack, and therefore `run_delta`, lives — is only reached
 * when `editIntentDetected` is false. So a comparative question like
 *   "Did my edit change which option comes out ahead?"
 * is answered "Which option should I update?" (`tools/edit-graph.ts:1173`
 * `buildClarificationQuestion` with ZERO alternatives) by a module that never
 * reads run facts at all.
 *
 * THE FIX, and its deliberate narrowness. When `dispatchEditGraph` resolved
 * nothing AND proposed nothing — the `clarify` branch whose target resolution
 * carried NO alternatives, i.e. the exact witnessed shape, a bare question with
 * no chips — the dispatch returns early WITHOUT committing and route-v2 falls
 * through to the turn executor instead of returning. Ambiguous GENUINE edits
 * that today get a useful "Which option: A or B?" with alternatives as chips
 * keep their current route: they resolved something.
 *
 * ⛔ NO PREDICATE CHANGED. The condition is derived from the PRODUCER, not
 * re-stated: `pendingClarification` is assigned at exactly ONE site
 * (`tools/edit-graph.ts:2033/2045`, the `resolutionMode === 'clarify'` branch)
 * and its `candidate_labels` IS `targetResolution.alternatives.map(a => a.label)`.
 * Of the thirteen `appliedGraph: null` returns in that file, exactly one sets
 * `pendingClarification` — so the condition is provably exhaustive AND provably
 * narrow. No regex and no verb list is touched. In particular `&&
 * hasMutationSignal` on `editIntentDetected` is NOT the fix: five consecutive
 * rounds on lexical predicates over natural language each fixed one direction
 * and opened the other.
 *
 * ⭐ THE HAZARD THIS FILE EXISTS TO PIN, and it is fail-open and silent.
 * `dispatchEditGraph` calls `commitDirectAnswer` (`edit-graph-dispatch.ts:4506`)
 * BEFORE returning, and `runTurnExecutor` commits too. A fall-through taken at
 * route-v2 AFTER the dispatch committed would write TWO turn rows for ONE turn,
 * raise no exception, and leave every suite green. That is why the early return
 * is PRE-COMMIT inside the dispatch, and why `commitsOnTheWire()` below counts
 * store appends rather than merely asserting the turn did not error.
 *
 * WHY THE ASSERTIONS BIND BY IDENTITY. Each case asserts
 * `_diagnostic_trace.exit_path` — the EXIT actually taken — not a property of
 * the body that another exit could also satisfy. A routing change that moves a
 * case to a different exit turns this file red instead of quietly re-testing
 * the wrong branch.
 *
 * MUTATION-CHECK (each must RED the named test):
 *  - restore the unconditional `return sendFinalised200(...)` at the edit exit
 *    → 'a bare clarification ... reaches the turn executor' REDs.
 *  - widen the fall-through to any `graph === null`
 *    → 'a resolved edit still exits at edit_graph' REDs.
 *  - place the route-v2 fall-through branch BELOW the `!commitPerformed` 500
 *    → 'a bare clarification ... reaches the turn executor' REDs (500).
 *
 * ⚠ A CLAIM PREVIOUSLY LISTED HERE WAS UNACHIEVABLE AND HAS BEEN REMOVED: that
 * moving the dispatch's early return to AFTER `commitDirectAnswer` would RED
 * 'commits EXACTLY ONCE' in THIS file. It cannot. `dispatchEditGraph` is mocked
 * here, so no mutation of the real dispatch can change anything this file
 * observes, and its commit count can only ever see the EXECUTOR's commit. The
 * double-commit hazard is pinned where it actually lives —
 * `handlers/__tests__/edit-graph-dispatch-unresolved-clarification-fallthrough.test.ts`,
 * which counts `commitDirectAnswer` directly (0 on the fall-through, 1 on both
 * non-fall-through cases). The count asserted below is still worth keeping: it
 * pins that a fall-through yields exactly one commit GIVEN a non-committing
 * dispatch. It is half the guarantee, and only half.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

// A permissive-but-valid graph_state so `isEditGraphShape` holds and the route
// dispatches to the (mocked) edit pipeline.
const GRAPH_STATE = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Launch now' },
    { id: 'goal-g', kind: 'goal', label: 'Grow revenue' },
    {
      id: 'fac-marketing',
      kind: 'factor',
      label: 'Marketing',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
  ],
  edges: [
    {
      from: 'fac-marketing',
      to: 'goal-g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const CLARIFY_RESPONSE = {
  response_version: 2 as const,
  assistant_text: 'Which option should I update?',
  blocks: [] as const,
  suggested_actions: [] as const,
  insights: [] as const,
  stage_indicator: 'analyse' as const,
};

const APPLIED_RESPONSE = {
  ...CLARIFY_RESPONSE,
  assistant_text: 'Edge strength increased.',
};

const dispatchEditGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

/**
 * THE COMMIT COUNTER. `commitDirectAnswer` durably writes through
 * `store.append`, so appends-per-turn IS the commit count on the wire. This is
 * the only observable that can see the double-commit hazard: it raises no
 * exception and changes no status code.
 */
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

// The fall-through case REACHES the turn executor, which routes through the
// LLM. Mocked so this file measures ROUTING, not model behaviour.
const routeWithToolUseMock = vi.fn();
vi.mock('../../orchestrator-v5/routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../orchestrator-v5/routing/route-with-tool-use.js')
  >('../../orchestrator-v5/routing/route-with-tool-use.js');
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

function converseTextOnly(text: string) {
  return {
    type: 'text_only' as const,
    text,
    inferredIntent: 'converse',
    llmCallCount: 1,
    droppedActions: [],
    orientationText: '',
    rawResult: {
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'mock',
      latencyMs: 0,
    },
  };
}

// Dynamic, NOT a static top-level import: `route-v2.js` pulls in
// `turn-executor.js`, which imports the modules mocked above.
const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

/**
 * The witnessed message. `positiveEditRegexHit` is TRUE on the bare verb
 * "change", so the edit lane claims it — this is the exact traffic the fix
 * hands to the layer that holds the run facts.
 */
const COMPARATIVE_MESSAGE = 'Did my edit change which option comes out ahead?';
const PLAIN_EDIT_MESSAGE = 'Add a risk for supplier delays affecting the launch';

function payload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '88888888-8888-4888-8888-888888888888',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message,
    turn_class: 'decide',
    source: 'composer',
    graph_state: GRAPH_STATE,
  };
}

async function post(app: FastifyInstance, message: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: payload(message),
  });
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(res.body) as Record<string, any>;
  } catch {
    body = {};
  }
  return { status: res.statusCode, body };
}

/** The EXIT actually taken, off the wire. Identity, not a value predicate. */
function exitPathOnTheWire(body: Record<string, any>): unknown {
  return body._diagnostic_trace?.exit_path;
}

/** Durable commits this turn performed. */
function commitsOnTheWire(): number {
  return appendMock.mock.calls.length;
}

describe('POST /orchestrate/v2/turn — the edit lane is NON-TERMINAL when it resolved nothing', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
    vi.stubEnv('CEE_DIAGNOSTIC_TRACE_ENABLED', 'true');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  beforeEach(() => {
    appendMock.mockClear();
    dispatchEditGraphMock.mockClear();
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(converseTextOnly('Here is what moved.'));
  });

  it('a bare clarification (zero candidate labels) does NOT end the turn at edit_graph — it reaches the turn executor', async () => {
    // The dispatch resolved nothing and proposed nothing, and — critically —
    // did NOT commit (that is what the pre-commit early return guarantees).
    dispatchEditGraphMock.mockResolvedValue({
      response: CLARIFY_RESPONSE,
      commitPerformed: false,
      graph: null,
      unresolvedClarificationFellThrough: true,
    });

    const { status, body } = await post(app, COMPARATIVE_MESSAGE);

    // The edit lane WAS reached (so this case is not being intercepted earlier
    // and silently re-tested somewhere else).
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    // It did not become a 500 — the fall-through branch sits ABOVE the
    // `!commitPerformed` boundary error.
    expect(status).toBe(200);
    // THE FIX, bound by identity: the turn exited at the EXECUTOR, which is
    // where the context pack — and therefore `run_delta` — lives.
    expect(exitPathOnTheWire(body)).toBe('turn_executor');
    expect(exitPathOnTheWire(body)).not.toBe('edit_graph');
    // And the executor actually ran.
    expect(routeWithToolUseMock).toHaveBeenCalled();
  });

  it('a fall-through turn commits EXACTLY ONCE', async () => {
    // The double-commit hazard is FAIL-OPEN and SILENT: two rows, no
    // exception, green suite. Counting is the only way to see it.
    dispatchEditGraphMock.mockResolvedValue({
      response: CLARIFY_RESPONSE,
      commitPerformed: false,
      graph: null,
      unresolvedClarificationFellThrough: true,
    });

    const { status } = await post(app, COMPARATIVE_MESSAGE);

    expect(status).toBe(200);
    expect(commitsOnTheWire()).toBe(1);
  });

  it('a resolved edit still exits at edit_graph — the fall-through does not widen', async () => {
    // graph === null here too, deliberately: a GM-blocked or goal-target-
    // withheld mutation also returns a null graph. Only the bare-clarification
    // flag may fall through, so `graph === null` alone must NOT.
    dispatchEditGraphMock.mockResolvedValue({
      response: APPLIED_RESPONSE,
      commitPerformed: true,
      graph: null,
    });

    const { status, body } = await post(app, PLAIN_EDIT_MESSAGE);

    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(status).toBe(200);
    expect(exitPathOnTheWire(body)).toBe('edit_graph');
    expect(routeWithToolUseMock).not.toHaveBeenCalled();
  });

  it('a commit failure still returns 500 — the fall-through branch does not swallow it', async () => {
    dispatchEditGraphMock.mockResolvedValue({
      response: CLARIFY_RESPONSE,
      commitPerformed: false,
      graph: null,
    });

    const { status } = await post(app, PLAIN_EDIT_MESSAGE);

    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(status).toBe(500);
  });
});
