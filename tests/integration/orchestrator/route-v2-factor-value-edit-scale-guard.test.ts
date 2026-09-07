/**
 * Scale guard at the real factor_value_edit route and canonical commit seam.
 *
 * These are constructed contract fixtures, not deployed UI captures. The
 * store below reloads only graphs handed to append; it is an in-process
 * persistence witness, not a Supabase/browser/wire or UI-reachability claim.
 * Valid edits also pass that reloaded graph to the production run_analysis
 * handler with a fake transport, capturing its actual final PLoT request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PLoTClient } from '../../../src/orchestrator/plot-client.js';
import type { HandlerInvocation } from '../../../src/orchestrator-v5/tools/registry.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

type ObservedState = {
  value: number;
  raw_value?: number;
  cap?: number;
  unit?: string;
  source?: string;
};
type Node = {
  id: string;
  kind: string;
  label: string;
  observed_state?: ObservedState;
  scale_frame?: number;
  [key: string]: unknown;
};
type Graph = {
  goal_node_id: string;
  nodes: Node[];
  edges: Array<Record<string, unknown>>;
  options: Array<Record<string, unknown>>;
};

const TARGET_ID = 'f-edited';
const NEIGHBOUR_ID = 'f-untouched';
const SCENARIO_ID = '66666666-6666-4666-8666-666666666666';
const TURN_ID = '77777777-7777-4777-8777-777777777777';

function graphFor(observed: ObservedState, scaleFrame?: number): Graph {
  const factorLabel = scaleFrame !== undefined
    ? 'Recurring platform licence cost'
    : observed.unit === '%'
      ? 'Customer churn'
      : observed.cap === 1 ? 'Billing accuracy' : 'Marketing budget';
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET_ID, kind: 'factor', label: factorLabel,
        observed_state: { ...observed, source: 'cee_inference' },
        ...(scaleFrame === undefined ? {} : { scale_frame: scaleFrame }),
      },
      // Same label: only the requested ID may move or earn user authorship.
      {
        id: NEIGHBOUR_ID, kind: 'factor', label: factorLabel,
        observed_state: { value: 0.2, raw_value: 0.2, cap: 1, source: 'cee_inference' },
      },
      { id: 'o-configured', kind: 'option', label: 'Increase marketing' },
      { id: 'o-hold', kind: 'option', label: 'No change (status quo)', is_baseline: true },
    ],
    edges: [TARGET_ID, NEIGHBOUR_ID].map((from) => ({
      from, to: 'g-revenue', strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9, effect_direction: 'positive',
    })),
    options: [
      {
        id: 'o-configured', option_id: 'o-configured', label: 'Increase marketing',
        interventions: { [TARGET_ID]: { value: 0.6 }, [NEIGHBOUR_ID]: { value: 0.2 } },
      },
      {
        id: 'o-hold', option_id: 'o-hold', label: 'No change (status quo)',
        is_baseline: true, interventions: {},
      },
    ],
  };
}

let persisted: Graph;
const appendMock = vi.fn();
const loadGraphMock = vi.fn(async () => structuredClone(persisted));
const llmChatMock = vi.fn();
const plotRunMock = vi.fn();
const validatePatchMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: await loadGraphMock(), briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/orchestrator/plot-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/orchestrator/plot-client.js')>(),
  createPLoTClient: () => ({ run: plotRunMock, validatePatch: validatePatchMock }),
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
const { createRunAnalysisHandler } = await import('../../../src/orchestrator-v5/tools/handlers/run-analysis.js');

function observedState(graph: Graph, id = TARGET_ID): ObservedState {
  const matches = graph.nodes.filter((node) => node.id === id);
  expect(matches, `exactly one canonical target ${id}`).toHaveLength(1);
  expect(matches[0]?.observed_state).toBeDefined();
  return matches[0]!.observed_state!;
}

function committedGraphs(): Graph[] {
  return appendMock.mock.calls.flatMap(([arg]) => {
    const input = arg as { graph?: Graph };
    return input.graph ? [input.graph] : [];
  });
}

function expectSameNumber(actual: number, intended: number): void {
  // Absolute decimal tolerances would accept the tiny 1000x regression.
  if (intended === 0) expect(actual).toBe(0);
  else expect(Math.abs((actual - intended) / intended)).toBeLessThan(1e-12);
}

async function expectRerunUsesReloadedValue(intended: number): Promise<void> {
  const reloaded = await loadGraphMock();
  const handler = createRunAnalysisHandler({
    plotClient: { run: plotRunMock, validatePatch: validatePatchMock } as unknown as PLoTClient,
    scenarioReader: async () => ({
      graph: reloaded, rawPersistedGraph: reloaded,
      options: reloaded.options, goal_node_id: reloaded.goal_node_id,
    }),
  });
  const payload = {
    kind: 'message', scenario_id: SCENARIO_ID, turn_id: TURN_ID,
    message: 'run analysis', turn_class: 'decide', stage: 'analyse',
  };
  await handler({
    context: {
      session_id: SCENARIO_ID, stage: 'analyse', request_id: 'scale-guard-rerun',
      entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: payload.message }],
      budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: reloaded,
    },
    payload, requestId: 'scale-guard-rerun', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(plotRunMock).toHaveBeenCalledTimes(1);
  const sent = plotRunMock.mock.calls[0]![0] as {
    graph: Graph; options: Array<{ id?: string; option_id?: string; interventions: Record<string, number> }>;
  };
  expectSameNumber(observedState(sent.graph).value, intended);
  const hold = sent.options.find((option) => (option.option_id ?? option.id) === 'o-hold');
  expect(hold, 'the real analysis handler must submit the status quo').toBeDefined();
  expectSameNumber(hold!.interventions[TARGET_ID]!, intended);
}

describe('POST /orchestrate/v2/turn — refuse ambiguous scale without laundering authorship', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    vi.clearAllMocks();
    appendMock.mockImplementation(async (arg: { graph?: Graph }) => {
      if (arg.graph !== undefined) persisted = structuredClone(arg.graph);
      return { id: 'scale-guard-turn-row' };
    });
    plotRunMock.mockResolvedValue({
      meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:scale-guard' },
      results: [{ option_id: 'o-configured', option_label: 'Increase marketing', win_probability: 0.6 }],
      response_hash: 'sha256:scale-guard', analysis_status: 'completed',
    });
  });

  async function edit(event: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST', url: '/orchestrate/v2/turn',
      payload: {
        kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: TURN_ID, stage: 'analyse',
        event: { kind: 'factor_value_edit', target_id: TARGET_ID, ...event },
      },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as {
      assistant_text: string; blocks: Array<Record<string, unknown>>; graph_hash?: string;
      suggested_actions?: Array<{ id: string; label: string; message: string }>;
    };
  }

  const refusals = [
    {
      name: 'contradictory stored frame and observed pair refuse even when fallback would preserve the number',
      graph: () => graphFor({ value: 0.5, raw_value: 50000, unit: '£' }, 1000000),
      event: { value: 0.85 },
    },
    {
      name: 'bare 0.85 on frame-only 100000 refuses the observed 100000x transformation',
      graph: () => graphFor({ value: 0.5 }, 100000), event: { value: 0.85 },
    },
    {
      name: 'tiny inconsistent structured pair refuses a 1000x mismatch below the old absolute tolerance',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 8.5e-7, raw_value: 0.000085, unit: '£' },
    },
    {
      name: 'exact zero cannot silently replace a stated tiny nonzero model value',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 8.5e-10, raw_value: 0, unit: '£' },
    },
  ];

  for (const { name, graph, event } of refusals) it(name, async () => {
    persisted = graph();
    const before = await loadGraphMock();
    const body = await edit(event);
    // Soft assertions expose both value and attribution errors on pristine.
    expect.soft(committedGraphs(), 'refusal must commit no canonical graph').toEqual([]);
    const committedFacts = appendMock.mock.calls.flatMap(([arg]) =>
      (arg as { handler_facts?: Array<{ fact_type?: string }> }).handler_facts ?? []);
    expect.soft(committedFacts.some((fact) => fact.fact_type === 'set_factor_value')).toBe(false);
    expect.soft(await loadGraphMock(), 'reload must retain the entire prior canonical model').toEqual(before);
    expect.soft(computeAnalysisAffectingGraphHash(await loadGraphMock() as never))
      .toBe(computeAnalysisAffectingGraphHash(before as never));
    expect.soft(observedState(await loadGraphMock()).source).toBe('cee_inference');
    expect.soft(observedState(await loadGraphMock(), NEIGHBOUR_ID)).toEqual(observedState(before, NEIGHBOUR_ID));
    expect.soft(body.assistant_text).toMatch(/haven't changed anything/i);
    expect.soft(body.blocks.some((block) => block.type === 'graph_patch' && block.status === 'applied')).toBe(false);
    expect.soft(body.blocks.some((block) => block.type === 'analysis_result')).toBe(false);
    expect.soft(llmChatMock).not.toHaveBeenCalled();
    expect.soft(plotRunMock).not.toHaveBeenCalled();
    expect.soft(validatePatchMock).not.toHaveBeenCalled();
  });

  const validEdits = [
    {
      name: 'coherent capless recorded frame accepts an explicitly supplied zero',
      graph: () => graphFor({ value: 0.5, raw_value: 50000, unit: '£' }, 100000),
      event: { value: 0, raw_value: 0, unit: '£' }, intended: 0, raw: 0,
    },
    {
      name: 'explicit unit-interval contract accepts model 0.85 unchanged',
      graph: () => graphFor({ value: 0.5, raw_value: 0.5, cap: 1 }),
      event: { value: 0.85 }, intended: 0.85, raw: 0.85,
    },
    {
      name: 'explicit 12 percent becomes canonical 0.12 without a 100x error',
      graph: () => graphFor({ value: 0.4, raw_value: 40, cap: 100, unit: '%' }),
      event: { value: 0.12, raw_value: 12, unit: '%' }, intended: 0.12, raw: 12,
    },
    {
      name: 'explicit £85000 on cap 100000 becomes canonical 0.85',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 0.85, raw_value: 85000, unit: '£' }, intended: 0.85, raw: 85000,
    },
    {
      name: 'legitimate tiny £0.85 remains canonical 0.0000085 with honest user attribution',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 0.0000085, raw_value: 0.85, unit: '£' }, intended: 0.0000085, raw: 0.85,
    },
    {
      name: 'legitimate tiny counterpart £0.000085 remains canonical 8.5e-10',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 8.5e-10, raw_value: 0.000085, unit: '£' }, intended: 8.5e-10, raw: 0.000085,
    },
    {
      name: 'fully specified zero remains a valid zero',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 0, raw_value: 0, unit: '£' }, intended: 0, raw: 0,
    },
    {
      name: 'ordinary one-third floating point roundoff still accepts the coherent pair',
      graph: () => graphFor({ value: 0.5, raw_value: 1.5, cap: 3, unit: '£' }),
      event: { value: 0.3333333333333333, raw_value: 1, unit: '£' }, intended: 1 / 3, raw: 1,
    },
  ];

  // ⚠⚠ RESOLVED KNOWN DIVERGENCE — ONE INPUT CLASS, TWO SHIPPED ANSWERS,
  // SETTLED BY PAUL ON 2026-09-07: **REFUSE AND ASK.**
  //
  // ⭐ THE HISTORY BELOW IS KEPT DELIBERATELY AND MUST NOT BE TIDIED AWAY. It
  // is the record of what this product actually did and why the question
  // reached a decision at all (CLAUDE.md trap 14b — a record of shipped
  // behaviour is EVIDENCE, and rewriting it leaves the suite agreeing with a
  // history that never happened). What changed is the ASSERTION, which now
  // pins the ruled answer instead of the live one; the account of the
  // disagreement is unchanged.
  //
  // The class: a bare value >= 1, no `raw_value`, no `unit`, on a CAPLESS
  // factor with a resolvable `scale_frame`.
  //   · This PR (#1272, authored 31 Aug 13:40) asserted REFUSE — "the guard is
  //     not a small-number ban": 2 on a 100000 frame is an unverifiable
  //     100000x transformation, so do not guess.
  //   · #1280 (merged 31 Aug 18:06, DEPLOYED) asserted ACCEPT — capless amount
  //     editors send raw magnitudes in `value`, so 2 on a 50000 frame is the
  //     raw amount 2 and canonically 0.00004. Its own suite pins exactly that.
  // Both were defensible; they could not both hold. The conflict lane declined
  // to invent a third rule and escalated instead, which is how the question
  // finally reached Paul — the APPROVE on #1272 was bound to a head whose base
  // did NOT contain #1280, so no reviewer had ever adjudicated it.
  //
  // ⭐ HIS RULING WAS NEITHER: guessing produces the harm he reported (a number
  // you set becoming something you did not mean) and blocking leaves a dead
  // end, so the product ASKS — "8 thousand or 8 million?" — and lets the user
  // keep hold of their own number.
  it('bare 2 on a frame-only 100000 factor REFUSES AND ASKS which magnitude was meant', async () => {
    persisted = graphFor({ value: 0.5 }, 100000);
    const before = await loadGraphMock();
    const body = await edit({ value: 2 });

    // REFUSE: the ask is worthless if the guess already landed.
    expect(committedGraphs(), 'the ruled answer commits no canonical graph').toEqual([]);
    expect(await loadGraphMock(), 'the whole prior model survives').toEqual(before);
    expect(observedState(await loadGraphMock()).source).toBe('cee_inference');

    // ASK: the question, and a chip per reading.
    expect(body.assistant_text).toMatch(/haven't changed anything/i);
    expect(body.assistant_text).toContain('Did you mean 2 or 2 thousand?');
    expect(body.suggested_actions?.map((a) => a.id)).toEqual([
      'chip_prompt_scale_ask_as_typed',
      'chip_prompt_scale_ask_thousand',
    ]);
    expect(body.suggested_actions?.map((a) => a.label)).toEqual(['2', '2 thousand']);
    // The chip names the factor, so the replay turn can find it, and states the
    // amount in full digits so the magnitude is no longer in doubt.
    expect(body.suggested_actions?.map((a) => a.message)).toEqual([
      'Set Recurring platform licence cost to 2.',
      'Set Recurring platform licence cost to 2,000.',
    ]);
  });

  // ⭐ THE LOWER BOUNDARY OF THE ASK, and it is here because a mutant widening
  // the predicate from `>= 1` to `>= 0` SURVIVED the first version of this
  // suite. Zero is the only input class that widening adds — the sub-1 basis
  // guard already claims everything else below 1 and explicitly excludes zero —
  // so with no zero case the boundary was unpinned in exactly one direction.
  //
  // Setting a factor to zero is an ordinary thing to want, it is not ambiguous
  // in scale (zero is zero on every frame), and the ask must not swallow it.
  it('a bare zero on a frame-only factor still commits — the ask does not claim it', async () => {
    persisted = graphFor({ value: 0.5 }, 100000);
    const body = await edit({ value: 0 });
    expect(committedGraphs(), 'zero is not scale-ambiguous').toHaveLength(1);
    expectSameNumber(observedState(await loadGraphMock()).value, 0);
    expect(body.assistant_text).not.toMatch(/Did you mean/i);
  });

  // ⭐⭐ THE ORDER PIN. Four guards share one `── the scale ──` block and their
  // sequence is load-bearing: `resolveScaleFrame` internally calls
  // `checkPairCoherence` and returns `undefined` on `incoherent`, so #1272's
  // incoherent-pair predicate is a STRICT SUBSET of #1280's unresolved-frame
  // predicate. Put the broader one first and the narrower becomes unreachable
  // dead code UNDER A FULLY GREEN SUITE — nothing else in this file would say
  // so, because each guard's own case still refuses, just with the wrong voice.
  //
  // This binds each case to the copy only ITS guard emits, from one shared
  // fixture family, so ANY reordering turns at least one row red. The ask is
  // included because it is the newest member and the same swap would silently
  // hand its class to the sub-1 guard or to #1280's accept.
  it.each([
    {
      what: 'incoherent stored frame vs pair — #1272 guard, must run FIRST',
      graph: () => graphFor({ value: 0.5, raw_value: 50000, unit: '£' }, 1000000),
      event: { value: 0.85 },
      expected: /recorded scale is inconsistent/i,
    },
    {
      what: 'stored frame present but unresolvable — #1280 unresolved-frame guard',
      graph: () => graphFor({ value: 0.5, raw_value: 0.5 }, 0.5),
      event: { value: 0.85 },
      expected: /can't verify this factor's recorded scale/i,
    },
    {
      what: 'bare sub-1 on a resolvable frame — #1280 basis guard',
      graph: () => graphFor({ value: 0.5 }, 100000),
      event: { value: 0.85 },
      expected: /model-scale proportion or an amount/i,
    },
    {
      what: 'bare >=1 on a resolvable frame — the scale ask',
      graph: () => graphFor({ value: 0.5 }, 100000),
      event: { value: 2 },
      expected: /Did you mean 2 or 2 thousand\?/,
    },
  ])('guard order: $what', async ({ graph, event, expected }) => {
    persisted = graph();
    const body = await edit(event);
    expect(committedGraphs()).toEqual([]);
    expect(body.assistant_text).toMatch(expected);
  });

  for (const { name, graph, event, intended, raw } of validEdits) it(name, async () => {
    persisted = graph();
    const before = await loadGraphMock();
    const body = await edit(event);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedGraphs()).toHaveLength(1);
    const reloaded = await loadGraphMock();
    const observed = observedState(reloaded);
    expectSameNumber(observed.value, intended);
    expect(observed.raw_value).toBe(raw);
    expect(observed.source).toBe('user_override');
    expect(observed.cap).toBe(observedState(before).cap);
    expect(observed.unit).toBe(observedState(before).unit);
    expect(observedState(reloaded, NEIGHBOUR_ID)).toEqual(observedState(before, NEIGHBOUR_ID));
    expect(body.blocks).toContainEqual(expect.objectContaining({
      type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: TARGET_ID,
    }));
    expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(reloaded as never));
    expect(body.blocks.some((block) => block.type === 'analysis_result')).toBe(false);
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(plotRunMock).not.toHaveBeenCalled();
    await expectRerunUsesReloadedValue(intended);
  });
});
