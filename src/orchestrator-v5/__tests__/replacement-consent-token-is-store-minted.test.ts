/**
 * ⭐⭐ THE CONSENT TOKEN MUST BE MINTED FROM THE STORE, NEVER FROM THE REQUEST.
 *
 * This pins a defect I had already written and banked before it was caught.
 *
 * I fed the controller's `modelRevision` from
 * `computeAnalysisAffectingGraphHash(extensions.graphState)` — the INGRESS
 * graph — and argued that if it disagreed with the store's view, the refusal
 * would "arrive as data on the first real turn".
 *
 * **It would have arrived on every turn.** The store does not hold the ingress
 * graph; it holds a PROJECTION of it, and the three persist passes
 * (`commit.ts:1124-1136`) mutate exactly the fields the hash covers. Measured
 * by the data layer on verbatim bytes with the real functions:
 * `ingress c373cbdfb844909d → persisted 4dadc7e6510ec272`, DIFFERENT, with
 * controls discriminating. The same two-source mismatch has already shipped
 * once as a false `GRAPH_DIVERGED` (`response-finaliser.ts:436-445`).
 *
 * ⭐ The general form, which is the part worth keeping: **making a failure
 * observable is a virtue only when the failure is RARE.** A 100% refusal rate
 * wearing a reasonable sentence does not need an instrument.
 *
 * ⚠ WHY A TEST AND NOT JUST THE SIGNATURE. `currentModelRevision` takes no
 * graph parameter, which makes the mistake hard to repeat — but the tokens are
 * opaque strings, so nothing downstream can tell a store-derived hash from an
 * ingress-derived one. Anyone could reintroduce a local `??` fallback or hash
 * the ingress graph by hand and every type would still check. This asserts the
 * VALUE, which is the only level the defect is visible at.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const SCENARIO_ID = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';

/** What the BROWSER posts. */
const INGRESS_GRAPH = {
  nodes: [
    { id: 'g-rev', kind: 'goal', label: 'Grow revenue' },
    { id: 'f-spend', kind: 'factor', label: 'Marketing spend' },
    { id: 'opt-a', kind: 'option', label: 'Expand', interventions: { 'f-spend': 0.4 } },
  ],
  edges: [
    { from: 'f-spend', to: 'g-rev', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
  ],
};

/**
 * What the STORE holds — the same model after persistence has run. It differs
 * by one extra option, which is enough to move the hash. The real divergence
 * is a projection artefact; reproducing the projection here would mirror
 * someone else's measurement (trap 12), so this stands in for it with a
 * difference the hash demonstrably sees — asserted below, not assumed.
 */
const STORE_GRAPH = {
  ...INGRESS_GRAPH,
  nodes: [...INGRESS_GRAPH.nodes, { id: 'opt-b', kind: 'option', label: 'Hold', is_baseline: true }],
};

/**
 * The durable replacement-state store refuses to build without credentials —
 * by design, so a user's agreement cannot land on an instance that never saw
 * the offer. Stubbed rather than supplying fake credentials: this file is
 * about which GRAPH the consent token is derived from, and nothing here
 * exercises state persistence.
 */
vi.mock('../replacement/wiring.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getReplacementStateStore: () => ({
      load: async () => ({ state: null, revision: null }),
      save: async () => undefined,
    }),
    anthropicChatWithTools: () => async () => ({ content: [], stop_reason: 'end_turn' }),
  };
});

const handleReplacementTurnMock = vi.fn();
vi.mock('../replacement/turn-entry.js', () => ({
  handleReplacementTurn: (...args: unknown[]) => handleReplacementTurnMock(...args),
}));

let storeGraph: unknown = STORE_GRAPH;
const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
    readRecentAppliedMutationFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => storeGraph,
    loadGraphAndBriefText: async () => ({ graph: storeGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

function post(app: FastifyInstance) {
  return app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: 'c0c01111-c0c0-4c0c-8c0c-c0c0c0c01111',
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      turn_class: 'frame',
      message: 'What should I be weighing up here?',
      source: 'composer',
      graph_state: INGRESS_GRAPH,
    },
  });
}

describe('the replacement controller binds consent to the STORE, not the request', () => {
  let app: FastifyInstance;
  let priorFlag: string | undefined;

  beforeAll(async () => {
    priorFlag = process.env.CEE_REPLACEMENT_COACH_ENABLED;
    process.env.CEE_REPLACEMENT_COACH_ENABLED = 'true';
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    if (priorFlag === undefined) delete process.env.CEE_REPLACEMENT_COACH_ENABLED;
    else process.env.CEE_REPLACEMENT_COACH_ENABLED = priorFlag;
    _resetConfigCache();
  });
  beforeEach(() => {
    storeGraph = STORE_GRAPH;
    handleReplacementTurnMock.mockReset();
    handleReplacementTurnMock.mockResolvedValue({
      assistantText: 'Noted.',
      trace: { correlation_id: 'c', controller: 'replacement', refusals: [] },
      state: { version: 1, memory: { items: [] }, proposals: [] },
      applied: [],
      mustReconcile: [],
      toolsCalled: [],
      iterations: 1,
      incomplete: false,
    });
    appendMock.mockClear();
  });

  /**
   * ⚠ THE PRECONDITION, ASSERTED IN-TEST. If these two hashes were equal the
   * whole file would pass while proving nothing — the classic guard that
   * agrees with itself. This makes the fixture's discriminating power a
   * checked fact rather than an assumption.
   */
  it('the two graphs hash DIFFERENTLY — without this, nothing below discriminates', () => {
    const ingress = computeAnalysisAffectingGraphHash(INGRESS_GRAPH as never);
    const store = computeAnalysisAffectingGraphHash(STORE_GRAPH as never);
    expect(ingress, 'the ingress graph must hash to something').not.toBeNull();
    expect(store, 'the store graph must hash to something').not.toBeNull();
    expect(store).not.toBe(ingress);
  });

  it('⭐ the token handed to the controller is the STORE-derived one', async () => {
    const res = await post(app);
    if (res.statusCode !== 200) {
      // Surfaced on failure only: a bare `expected 500 to be 200` tells you
      // nothing about WHY, and this route's failures are all typed.
      expect(res.body, 'the route errored — body included so the cause is visible').toBe('');
    }
    expect(res.statusCode).toBe(200);
    expect(handleReplacementTurnMock, 'the controller must have been reached').toHaveBeenCalledTimes(1);

    const passed = handleReplacementTurnMock.mock.calls[0]![0] as { modelRevision: string };
    expect(passed.modelRevision).toBe(computeAnalysisAffectingGraphHash(STORE_GRAPH as never));
    // ⛔ THE DEFECT, NAMED: the ingress-derived token is what I nearly shipped.
    expect(passed.modelRevision).not.toBe(computeAnalysisAffectingGraphHash(INGRESS_GRAPH as never));
    // …and never a manufactured sentinel.
    expect(passed.modelRevision).not.toBe('graph-unhashable');
  });

  it('a null mint DECLINES the turn rather than inventing a base for a model that is not there', async () => {
    storeGraph = null; // the store holds nothing, though the request carries a graph

    const withFlagOn = await post(app);

    // ⭐ THE ONLY CLAIM THIS TEST MAKES is that the replacement controller did
    // not run.
    expect(
      handleReplacementTurnMock,
      'with no persisted model there is no base a proposal could bind to — the controller must not run',
    ).not.toHaveBeenCalled();

    // ⚠ AND THE CONTROL, because "it declined and then something failed" is
    // not the same claim as "declining caused a failure", and I would
    // otherwise be reporting the second while having measured the first.
    // Whatever the retired path does with a scenario holding no persisted
    // graph is ITS pre-existing behaviour: with the flag OFF the same request
    // travels the same path and must end the same way.
    process.env.CEE_REPLACEMENT_COACH_ENABLED = 'false';
    _resetConfigCache();
    const flagOff = Fastify();
    await ceeOrchestratorRouteV2(flagOff);
    await flagOff.ready();
    try {
      const withFlagOff = await post(flagOff);
      expect(
        withFlagOff.statusCode,
        'declining must leave the turn exactly where the flag-off build leaves it — no worse',
      ).toBe(withFlagOn.statusCode);
    } finally {
      await flagOff.close();
      process.env.CEE_REPLACEMENT_COACH_ENABLED = 'true';
      _resetConfigCache();
    }
  });

  it('the writer port is injected, which is what makes the accept tool exist at all', async () => {
    await post(app);
    const deps = handleReplacementTurnMock.mock.calls[0]![1] as { applyOperations?: unknown };
    expect(
      typeof deps.applyOperations,
      'absent means read-only: no accept_proposal tool is offered, so the layer cannot save',
    ).toBe('function');
  });
});
