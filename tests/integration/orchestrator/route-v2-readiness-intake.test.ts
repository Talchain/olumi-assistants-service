/**
 * Route-level tests for the S2-L1 typed readiness/coaching intake arm and the
 * §2g totality fix (route-v2.ts).
 *
 * What this pins END-TO-END through the route (not just the composer unit):
 *   1. A `source='chip_click'` + `chip.action_type='analysis_readiness'` turn
 *      is consumed ON ITS TYPE — routed to the readiness/coaching arm, never
 *      the draft heuristic, never the deterministic-chip dispatcher, never the
 *      canned framing prompt.
 *   2. FRESH canvas → the honest process-meta fresh-canvas answer, reached by
 *      the type (the unification).
 *   3. POPULATED canvas (persisted graph) → sensible readiness coaching keyed
 *      on the persisted graph, NOT the fresh-canvas compose path. (This is the
 *      critic-flagged populated-canvas acceptance test: it reads the PERSISTED
 *      scenario graph via the same authority the run_analysis chip uses, not
 *      the HTTP body.)
 *   4. §2g totality: a typed chip_click with a valid, non-whitelisted,
 *      non-readiness action_type (e.g. a mutation type) falls through to
 *      TurnExecutor, NOT the framing prompt.
 *
 * Mutation-check anchors are documented per test — reverting the route-v2 arm
 * turns these RED (see the throwaway-worktree mutation section in the PR body).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// Real whitelist predicate via importOriginal (a hand-listed re-implementation
// would drift silently — trap 12); mock ONLY the dispatch function so we can
// assert it is NOT called for analysis_readiness / non-whitelisted types.
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

// Settable persisted scenario graph. The readiness arm reads the PERSISTED
// graph via loadPersistedScenarioStateStrict → getSessionStore().
// loadGraphAndBriefText. A module-scoped holder lets each test set the graph
// the store returns; default null (fresh canvas).
const persistedGraphHolder: { graph: unknown } = { graph: null };

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: appendMock,
        loadGraphAndBriefText: async () => ({
          graph: persistedGraphHolder.graph,
          briefText: null,
        }),
      }),
    resetSessionStoreForTests: () => {},
  };
});

// Minimal LLM adapter for TurnExecutor fall-through paths (§2g).
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only fallthrough response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only fallthrough response' }],
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
const { PROCESS_META_ANSWER_MARKER } = await import(
  '../../../src/orchestrator-v5/routing/process-meta-intake.js'
);
const { READINESS_OPEN_MARKER, READINESS_GOAL_MISSING_MARKER } = await import(
  '../../../src/orchestrator-v5/routing/readiness-intake.js'
);

const FRAMING_PROMPT = 'I need a single decision question';

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `66666666-6666-4666-8666-${String(turnCounter).padStart(12, '0')}`;
}

interface InjectOpts {
  readonly message: string;
  readonly source?: 'composer' | 'chip' | 'chip_click';
  readonly chip?: { action_type?: string };
  readonly stage?: 'frame' | 'analyse' | 'decide' | 'review';
}

describe('POST /orchestrate/v2/turn — S2-L1 typed readiness/coaching arm + §2g', () => {
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
    dispatchDraftGraphMock.mockReset();
    dispatchDeterministicChipClickMock.mockReset();
    appendMock.mockClear();
    persistedGraphHolder.graph = null;
  });

  async function inject(opts: InjectOpts) {
    return app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: opts.stage ?? 'frame',
        message: opts.message,
        turn_class: 'frame',
        source: opts.source ?? 'chip_click',
        ...(opts.chip ? { chip: opts.chip } : {}),
      },
    });
  }

  // ------------------------------------------------------------------
  // 1. FRESH canvas: analysis_readiness chip_click → the honest fresh-canvas
  //    answer, reached BY THE TYPE (unification with the string mirror).
  // ------------------------------------------------------------------
  it('analysis_readiness chip_click on a fresh canvas → process-meta answer (by type)', async () => {
    persistedGraphHolder.graph = null; // fresh
    const res = await inject({
      message: 'What should I check before running the first analysis?',
      source: 'chip_click',
      chip: { action_type: 'analysis_readiness' },
    });
    expect(res.statusCode).toBe(200);
    // Consumed on its type: not drafted, not the deterministic dispatcher.
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(dispatchDeterministicChipClickMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
    // Never the framing prompt (the misfire class this lane retires).
    expect(body.assistant_text).not.toContain(FRAMING_PROMPT);
  });

  it('analysis_readiness routes by TYPE even when the message is NOT a mirror string', async () => {
    // A message that neither matches a PRODUCT_COACHING_PROMPTS entry nor the
    // typed pattern — the string mirror would NOT catch it; the TYPE does.
    persistedGraphHolder.graph = null;
    const res = await inject({
      message: 'am i ready?',
      source: 'chip_click',
      chip: { action_type: 'analysis_readiness' },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
    expect(body.assistant_text).not.toContain(FRAMING_PROMPT);
  });

  // ------------------------------------------------------------------
  // 2. POPULATED canvas (critic-flagged acceptance): the arm reads the
  //    PERSISTED graph and delivers readiness coaching, NOT the fresh answer.
  // ------------------------------------------------------------------
  it('analysis_readiness on a POPULATED canvas → readiness coaching, not the fresh-canvas answer', async () => {
    // Persisted graph: a goal + a single option → open readiness items
    // (too few options, option needs mapping, goal threshold missing).
    persistedGraphHolder.graph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
        { id: 'opt_1', kind: 'option', label: 'Option A' },
      ],
      edges: [],
    };
    const res = await inject({
      message: 'am i ready to run this?',
      source: 'chip_click',
      chip: { action_type: 'analysis_readiness' },
      stage: 'analyse',
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(dispatchDeterministicChipClickMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Sensible populated-canvas coaching (the reviewed summariseReadiness prose)...
    expect(body.assistant_text).toContain(READINESS_OPEN_MARKER);
    // ...and NEVER the fresh-canvas "no model on the canvas yet" answer, which
    // would be wrong here (the canvas IS populated), nor the framing prompt.
    expect(body.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
    expect(body.assistant_text).not.toContain(FRAMING_PROMPT);
  });

  it('analysis_readiness on a populated canvas with NO goal → names the missing goal', async () => {
    persistedGraphHolder.graph = {
      nodes: [
        { id: 'opt_1', kind: 'option', label: 'Option A' },
        { id: 'opt_2', kind: 'option', label: 'Option B' },
      ],
      edges: [],
    };
    const res = await inject({
      message: 'ready?',
      source: 'chip_click',
      chip: { action_type: 'analysis_readiness' },
      stage: 'analyse',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(READINESS_GOAL_MISSING_MARKER);
    expect(body.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
  });

  // ------------------------------------------------------------------
  // 3. §2g totality: a typed chip_click with a valid, non-whitelisted,
  //    non-readiness action_type (a MUTATION type here) reaches TurnExecutor,
  //    NOT the canned framing prompt. Complements the compare_options case
  //    pinned in route-v2-process-meta-intake.test.ts.
  // ------------------------------------------------------------------
  it('§2g: chip_click set_factor_value (non-whitelisted mutation) → TurnExecutor, not framing prompt', async () => {
    persistedGraphHolder.graph = null;
    const res = await inject({
      message: 'Set the churn factor and tell me whether to raise price or hold?',
      source: 'chip_click',
      chip: { action_type: 'set_factor_value' },
    });
    // Exact-status pin (trap 13): 200 distinguishes a routed answer from a
    // harness 500; the negative content assertions distinguish TurnExecutor
    // from the two deterministic guard outputs. The mutation-family compose
    // text inside TurnExecutor is not exact-pinned here (it varies by the
    // mutation path and is not what §2g asserts) — the compare_options case in
    // route-v2-process-meta-intake.test.ts exact-pins the explain-family text.
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    // set_factor_value is a mutation type — NOT whitelisted for deterministic
    // dispatch (needs validated proposal parameters) — so the dispatcher is
    // not invoked; it falls through to TurnExecutor via the §2g totality.
    expect(dispatchDeterministicChipClickMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    // Reached TurnExecutor, NOT the frame-stage no-brief guard's framing
    // prompt (the retired misfire) and NOT the process-meta deflection.
    expect(body.assistant_text).not.toContain(FRAMING_PROMPT);
    expect(body.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
  });
});
