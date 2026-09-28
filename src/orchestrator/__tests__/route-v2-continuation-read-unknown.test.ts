/**
 * ROADMAP 2.717 — AN UNREADABLE CONTINUATION CHECK NEVER LETS A DRAFT
 * OVERWRITE A STORED MODEL.
 *
 * ── The invariant, stated against the SPEC ──
 * A user's persisted model is replaced wholesale ONLY when something has
 * positively established that there is no model to lose (or the user asked
 * for a draft explicitly). "The store could not tell me" is NOT that
 * evidence.
 *
 * ── Why the route is the last line ──
 * The draft commit carries NO expected graph hash, deliberately
 * (`draft-graph-dispatch.ts`, "A3 graph CAS observe-mode: the draft path is
 * DELIBERATELY uninstrumented"). Its only protection against drafting OVER a
 * model is the route's continuation guard (`isContinuationScenario`) and the
 * persisted-model check behind it (`noModelDraftUnstrand`), which runs ONLY
 * on a continuation. Both reads behind the guard — `loadHasPriorTurns` and
 * `loadHasOtherAdmittedLiveTurn` — used to answer `false` on a store error,
 * so one transient read failure classified a live decision as FRESH and a
 * brief-shaped composer message drafted over it (writer audit 27 Sep,
 * finding 6).
 *
 * ── The designed fix (row 2.717): not a flip ──
 * `catch → true` would strand genuine new decisions. The reads answer
 * `'yes' | 'no' | 'unknown'`, and `unknown` takes the NON-DESTRUCTIVE branch:
 * it is treated as a continuation, so the persisted-model check runs and
 * only a positively-read "no model, no draft in flight" can lift the guard.
 * `explicitGenerateDraft` bypasses the guard, so an explicit Generate Draft
 * still drafts. The third neighbour `loadDraftLossStands` fails to `false`
 * in the CONSERVATIVE direction and is pinned unchanged here.
 *
 * ── The harness ──
 * Real route; the session store is a small STATEFUL fake: `storedGraph` is
 * scenarios.graph. `dispatchDraftGraph` is mocked as the committing writer —
 * it writes its draft through the same `append({ graph })` door with no
 * expected hash, exactly as the real dispatcher's commit does — so "the
 * stored graph is unchanged" is observable, and the fresh-scenario CONTROL
 * proves the harness CAN see an overwrite.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import { GraphV3 } from '../../schemas/cee-v3.js';

// ── The stateful fake store ────────────────────────────────────────────────
/** scenarios.graph for SCENARIO_ID. */
let storedGraph: unknown | null = null;
/** Every graph written through the store's commit door, in order. */
const graphWrites: unknown[] = [];

type ReadBehaviour = boolean | 'throws';
let hasPriorTurnsBehaviour: ReadBehaviour = false;
let hasOtherAdmittedLiveTurnBehaviour: ReadBehaviour = false;
let draftLossStandsBehaviour: ReadBehaviour = false;
let loadGraphThrows = false;
/** When true the store omits the three optional continuation methods (legacy mocks). */
let omitOptionalContinuationMethods = false;

function readOrThrow(behaviour: ReadBehaviour, what: string): boolean {
  if (behaviour === 'throws') throw new Error(`session store unreachable (${what})`);
  return behaviour;
}

const appendMock = vi.fn(async (write: { graph?: unknown }) => {
  if (write.graph !== undefined) {
    graphWrites.push(write.graph);
    storedGraph = write.graph;
  }
  return { id: 'mock-row-id' };
});
const loadGraphMock = vi.fn(async () => {
  if (loadGraphThrows) throw new Error('session store unreachable (loadGraph)');
  return storedGraph;
});
const hasPriorTurnsMock = vi.fn(async () => readOrThrow(hasPriorTurnsBehaviour, 'hasPriorTurns'));
const hasOtherAdmittedLiveTurnMock = vi.fn(async () =>
  readOrThrow(hasOtherAdmittedLiveTurnBehaviour, 'hasOtherAdmittedLiveTurn'),
);
const scenarioDraftLossStandsMock = vi.fn(async () =>
  readOrThrow(draftLossStandsBehaviour, 'scenarioDraftLossStands'),
);

vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async (_id: string, graph: unknown) => {
      graphWrites.push(graph);
      storedGraph = graph;
    },
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => {
      if (loadGraphThrows) throw new Error('session store unreachable (loadGraphAndBriefText)');
      return { graph: storedGraph, briefText: null };
    },
    readMostRecentPendingActions: async () => [],
    markGraphWriteFailed: async () => undefined,
    ...(omitOptionalContinuationMethods
      ? {}
      : {
          hasPriorTurns: hasPriorTurnsMock,
          hasOtherAdmittedLiveTurn: hasOtherAdmittedLiveTurnMock,
          scenarioDraftLossStands: scenarioDraftLossStandsMock,
        }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// ── dispatchDraftGraph: the committing writer (no expected hash) ──────────
const DRAFTED_GRAPH = {
  nodes: [
    { id: 'opt-drafted', kind: 'option', label: 'A freshly drafted option' },
    { id: 'goal-drafted', kind: 'goal', label: 'A freshly drafted goal' },
  ],
  edges: [],
};
const dispatchDraftGraphMock = vi.fn(async (params: { payload: { scenario_id: string } }) => {
  // Mirrors draft-graph-dispatch.ts's commit: the new graph is written
  // wholesale through the store's atomic append, with no expected hash.
  const store = (await import('../../orchestrator-v5/session/index.js')).getSessionStore();
  await store.append({ scenario_id: params.payload.scenario_id, graph: DRAFTED_GRAPH } as never);
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted the model.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
    graph: DRAFTED_GRAPH,
  };
});
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'Executor reply.' }],
  usage: { input_tokens: 1, output_tokens: 1 },
}));
vi.mock('../../adapters/llm/router.js', () => ({
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

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');
const { loadHasPriorTurns, loadHasOtherAdmittedLiveTurn, loadDraftLossStands } = await import(
  '../../orchestrator-v5/build-turn-context.js'
);

const SCENARIO_ID = '27172717-2717-4717-8717-271727172717';
const TURN_ID = '99999999-9999-4999-8999-999999992717';
const REQUEST_ID = 'req-2717';

/**
 * A decision brief: draft-shaped by `isDraftShapedText` (length + decision
 * verb), not process-meta — so the ONLY thing that can stop it drafting is
 * the continuation guard.
 */
const BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

/** The user's model: a strict GraphV3 with a user-authored factor observation. */
const USER_MODEL = {
  nodes: [
    { id: 'opt-a', kind: 'option', label: 'Hire a senior tech lead' },
    { id: 'goal-g', kind: 'goal', label: 'Ship the platform rebuild' },
    {
      id: 'fac-f',
      kind: 'factor',
      label: 'Delivery velocity',
      observed_state: { value: 0.1, raw_value: 5, cap: 50 },
    },
  ],
  edges: [
    {
      from: 'fac-f',
      to: 'goal-g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};
{
  const parsed = GraphV3.safeParse(USER_MODEL);
  if (!parsed.success) {
    throw new Error('Fixture failed GraphV3.safeParse: ' + JSON.stringify(parsed.error.issues));
  }
}

function messagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message: BRIEF,
    source: 'composer',
    ...overrides,
  };
}

describe('ROADMAP 2.717 — an unreadable continuation check never lets a draft overwrite a stored model', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    _resetConfigCache();
  });
  beforeEach(() => {
    dispatchDraftGraphMock.mockClear();
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    loadGraphMock.mockClear();
    hasPriorTurnsMock.mockClear();
    hasOtherAdmittedLiveTurnMock.mockClear();
    scenarioDraftLossStandsMock.mockClear();
    storedGraph = null;
    graphWrites.length = 0;
    hasPriorTurnsBehaviour = false;
    hasOtherAdmittedLiveTurnBehaviour = false;
    draftLossStandsBehaviour = false;
    loadGraphThrows = false;
    omitOptionalContinuationMethods = false;
  });

  async function sendBrief(overrides: Record<string, unknown> = {}) {
    return app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: messagePayload(overrides) });
  }

  /** The user's model survived: same object, no graph written, no draft dispatched. */
  function expectModelUntouched() {
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(graphWrites).toEqual([]);
    expect(storedGraph).toBe(USER_MODEL);
  }

  // ═══ THE DEFECT ROWS ═════════════════════════════════════════════════════

  it('(a) the prior-turns read THROWS on a scenario with a stored model: a brief does not overwrite it', async () => {
    storedGraph = USER_MODEL;
    hasPriorTurnsBehaviour = 'throws';
    hasOtherAdmittedLiveTurnBehaviour = false;

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expectModelUntouched();
    // The unknown answer took the continuation branch, so the persisted-model
    // check RAN — for THIS scenario (identity-bound).
    expect(loadGraphMock).toHaveBeenCalledWith(SCENARIO_ID);
  });

  it('(b) the in-flight-turn read THROWS on a scenario with a stored model: a brief does not overwrite it', async () => {
    storedGraph = USER_MODEL;
    hasPriorTurnsBehaviour = false; // the fence is read only when this is a clean "no"
    hasOtherAdmittedLiveTurnBehaviour = 'throws';

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expectModelUntouched();
    // Identity-bound: the failed read was THIS scenario's fence, excluding
    // THIS turn. (No persisted-model read is needed here: an unknown fence
    // already refuses the lift, whatever the model check would say.)
    expect(hasOtherAdmittedLiveTurnMock).toHaveBeenCalledWith(SCENARIO_ID, TURN_ID);
  });

  it('(a+b) BOTH reads throw (the audit\'s RED): a brief does not overwrite the stored model', async () => {
    storedGraph = USER_MODEL;
    hasPriorTurnsBehaviour = 'throws';
    hasOtherAdmittedLiveTurnBehaviour = 'throws';

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expectModelUntouched();
  });

  it('(a2) the prior-turns read throws AND the persisted-model read throws: the guard holds (fail-closed)', async () => {
    storedGraph = USER_MODEL;
    hasPriorTurnsBehaviour = 'throws';
    loadGraphThrows = true;

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expectModelUntouched();
  });

  it('(b2) prior turns exist, NO stored model, and the in-flight read throws: no lift — a draft may be in flight (invariant 3)', async () => {
    // A draft admitted seconds ago has nothing persisted yet; its commit
    // carries no expected hash either, so a second draft would race it.
    storedGraph = null;
    hasPriorTurnsBehaviour = true;
    hasOtherAdmittedLiveTurnBehaviour = 'throws';

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(graphWrites).toEqual([]);
    expect(hasOtherAdmittedLiveTurnMock).toHaveBeenCalledWith(SCENARIO_ID, TURN_ID);
  });

  // ═══ CONTROLS — a genuine new decision is never stranded ════════════════

  it('(c) CONTROL: a genuinely fresh scenario (reads succeed, no turns, no graph) still drafts — and the harness SEES the write', async () => {
    storedGraph = null;
    hasPriorTurnsBehaviour = false;
    hasOtherAdmittedLiveTurnBehaviour = false;

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    // Positive control for the overwrite detector used by (a)/(b).
    expect(graphWrites).toEqual([DRAFTED_GRAPH]);
    expect(storedGraph).toBe(DRAFTED_GRAPH);
  });

  it('(c2) CONTROL: the prior-turns read throws but the model check POSITIVELY reads "no model, nothing in flight" — the brief drafts', async () => {
    storedGraph = null;
    hasPriorTurnsBehaviour = 'throws';
    hasOtherAdmittedLiveTurnBehaviour = false;

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(storedGraph).toBe(DRAFTED_GRAPH);
  });

  it('(d) CONTROL: an explicit Generate Draft still drafts when a continuation read is unknown', async () => {
    storedGraph = null;
    hasPriorTurnsBehaviour = 'throws';
    hasOtherAdmittedLiveTurnBehaviour = 'throws';

    const res = await sendBrief({ generate_model: true });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(storedGraph).toBe(DRAFTED_GRAPH);
  });

  it('CONTROL: shape still governs — a clean-read continuation WITH a model refuses the draft (the guard\'s own case)', async () => {
    storedGraph = USER_MODEL;
    hasPriorTurnsBehaviour = true;
    hasOtherAdmittedLiveTurnBehaviour = false;

    const res = await sendBrief();

    expect(res.statusCode).toBe(200);
    expectModelUntouched();
  });

  // ═══ THE THREE-STATE READS, at the loader ═══════════════════════════════

  it('loadHasPriorTurns answers yes / no / unknown — a thrown read is UNKNOWN, never "no"', async () => {
    hasPriorTurnsBehaviour = true;
    expect(await loadHasPriorTurns(SCENARIO_ID, REQUEST_ID)).toBe('yes');
    hasPriorTurnsBehaviour = false;
    expect(await loadHasPriorTurns(SCENARIO_ID, REQUEST_ID)).toBe('no');
    hasPriorTurnsBehaviour = 'throws';
    expect(await loadHasPriorTurns(SCENARIO_ID, REQUEST_ID)).toBe('unknown');
    // A store WITHOUT the method (legacy mocks) keeps today's answer.
    omitOptionalContinuationMethods = true;
    expect(await loadHasPriorTurns(SCENARIO_ID, REQUEST_ID)).toBe('no');
  });

  it('loadHasOtherAdmittedLiveTurn answers yes / no / unknown — a thrown read is UNKNOWN, never "no"', async () => {
    hasOtherAdmittedLiveTurnBehaviour = true;
    expect(await loadHasOtherAdmittedLiveTurn(SCENARIO_ID, TURN_ID, REQUEST_ID)).toBe('yes');
    hasOtherAdmittedLiveTurnBehaviour = false;
    expect(await loadHasOtherAdmittedLiveTurn(SCENARIO_ID, TURN_ID, REQUEST_ID)).toBe('no');
    hasOtherAdmittedLiveTurnBehaviour = 'throws';
    expect(await loadHasOtherAdmittedLiveTurn(SCENARIO_ID, TURN_ID, REQUEST_ID)).toBe('unknown');
    expect(hasOtherAdmittedLiveTurnMock).toHaveBeenLastCalledWith(SCENARIO_ID, TURN_ID);
    omitOptionalContinuationMethods = true;
    expect(await loadHasOtherAdmittedLiveTurn(SCENARIO_ID, TURN_ID, REQUEST_ID)).toBe('no');
  });

  // ═══ (e) THE CONSERVATIVE NEIGHBOUR IS NOT FLIPPED ══════════════════════

  it('(e) loadDraftLossStands keeps its CONSERVATIVE fail direction: a thrown read is boolean false (no notice, no unstrand)', async () => {
    draftLossStandsBehaviour = 'throws';
    expect(await loadDraftLossStands(SCENARIO_ID, REQUEST_ID)).toBe(false);
    draftLossStandsBehaviour = true;
    expect(await loadDraftLossStands(SCENARIO_ID, REQUEST_ID)).toBe(true);
    draftLossStandsBehaviour = false;
    expect(await loadDraftLossStands(SCENARIO_ID, REQUEST_ID)).toBe(false);
    omitOptionalContinuationMethods = true;
    expect(await loadDraftLossStands(SCENARIO_ID, REQUEST_ID)).toBe(false);
  });
});
