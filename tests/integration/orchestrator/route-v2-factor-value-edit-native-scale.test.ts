/**
 * Native-scale admission at the real factor_value_edit route and canonical commit seam.
 *
 * These are source-derived contract controls; retained native carrier provenance is
 * documented per case. This test does not itself mount or drive a browser. The
 * store below reloads only graphs handed to append; it is an in-process
 * persistence witness, not a Supabase/browser/wire or UI-reachability claim.
 * Valid edits also pass that reloaded graph to the production run_analysis
 * handler with a fake transport, capturing its actual final PLoT request.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PLoTClient } from '../../../src/orchestrator/plot-client.js';
import type { HandlerInvocation } from '../../../src/orchestrator-v5/tools/registry.js';
import nativeCarrier from './fixtures/native-factor-scale-carrier.json';
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

const TARGET_ID = nativeCarrier.event.target_id;
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

async function expectRerunUsesReloadedValue(intended: number, allowed = true): Promise<void> {
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
  const run = handler({
    context: {
      session_id: SCENARIO_ID, stage: 'analyse', request_id: 'scale-guard-rerun',
      entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: payload.message }],
      budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: reloaded,
    },
    payload, requestId: 'scale-guard-rerun', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  if (!allowed) {
    await expect(run).rejects.toMatchObject({ name: 'HandlerInvocationFailedError' });
    expect(plotRunMock).not.toHaveBeenCalled();
    return;
  }
  await run;
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
    };
  }

  const refusals = [
    {
      name: 'retained native .85 carrier refuses on the exact recorded 100000-frame target',
      graph: () => {
        const graph = graphFor({ value: 0.5 }, 100000);
        graph.nodes = graph.nodes.map((node) => node.id === TARGET_ID
          ? structuredClone(nativeCarrier.before_node) : node);
        return graph;
      },
      event: nativeCarrier.event,
    },
    {
      name: 'bare 0.85 cannot choose an amount basis from a standalone 200000 frame and stored currency',
      graph: () => graphFor({ value: 0.5, unit: '£' }, 200000),
      event: { value: 0.85, field: 'value' },
    },
    {
      name: 'unitless stored frame also cannot silently divide bare 0.85 by 100000',
      graph: () => graphFor({ value: 0.5 }, 100000),
      event: { value: 0.85, field: 'value' },
    },
    {
      name: 'a stored raw/model pair does not establish the basis of a new bare ratio',
      graph: () => graphFor({ value: 0.5, raw_value: 100000, unit: '£' }, 200000),
      event: { value: 0.85 },
    },
    {
      name: 'whitespace wire unit does not make an ambiguous ratio an explicit amount',
      graph: () => graphFor({ value: 0.5, unit: '£' }, 200000),
      event: { value: 0.85, unit: ' ' },
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
    ...[
      { input: 20000, model: 0.4 },
      { input: 5000, model: 0.1 },
      { input: 40000, model: 0.8 },
    ].map(({ input, model }) => ({
      name: `current UI raw-basis carrier ${input}/${input} stays canonical ${model} on frame 50000`,
      graph: () => graphFor({ value: 0.5, raw_value: 25000, unit: '£' }, 50000),
      event: { value: input, raw_value: input, unit: '£', field: 'value' },
      intended: model, raw: input,
    })),
    ...[
      { input: 20000, model: 0.4 },
      { input: 5000, model: 0.1 },
      { input: 40000, model: 0.8 },
      { input: 1, model: 0.00002 },
      { input: 2, model: 0.00004 },
      { input: 100000, model: 2 },
    ].map(({ input, model }) => ({
      name: `raw amount ${input} on the actual 50000 frame remains canonical ${model}`,
      graph: () => graphFor({ value: 0.5, unit: '£' }, 50000),
      event: { value: input, field: 'value' }, intended: model, raw: input, rerunAllowed: model <= 1,
    })),
    {
      name: 'explicit unit-interval contract accepts model 0.85 unchanged',
      graph: () => graphFor({ value: 0.5, raw_value: 0.5, cap: 1 }),
      event: { value: 0.85 }, intended: 0.85, raw: 0.85,
    },
    {
      name: 'a capped factor preserves the explicit model-only carrier',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 0.85 }, intended: 0.85, raw: 85000,
    },
    {
      name: 'small model input on a capped factor still authorises raw 0.85',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      event: { value: 0.0000085 }, intended: 0.0000085, raw: 0.85,
    },
    {
      name: 'explicit 12 percent stays canonical 0.12',
      graph: () => graphFor({ value: 0.4, raw_value: 40, cap: 100, unit: '%' }),
      event: { value: 0.12, raw_value: 12, unit: '%' }, intended: 0.12, raw: 12,
    },
    {
      name: 'explicit raw 0.85 pounds remains a legitimate tiny amount on a 200000 frame',
      graph: () => graphFor({ value: 0.5, raw_value: 100000, unit: '£' }, 200000),
      event: { value: 0.85, raw_value: 0.85, unit: '£' }, intended: 0.00000425, raw: 0.85,
    },
    {
      name: 'explicit raw 0.85 without a redundant wire unit still declares the raw basis',
      graph: () => graphFor({ value: 0.5, raw_value: 100000, unit: '£' }, 200000),
      event: { value: 0.85, raw_value: 0.85 }, intended: 0.00000425, raw: 0.85,
    },
    {
      name: 'zero on a framed factor does not need a guessed scale',
      graph: () => graphFor({ value: 0.5, unit: '£' }, 200000),
      event: { value: 0 }, intended: 0, raw: 0,
    },
  ];

  for (const { name, graph, event, intended, raw, ...control } of validEdits) it(name, async () => {
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
    expect(reloaded.nodes.find((node) => node.id === TARGET_ID)?.scale_frame)
      .toBe(before.nodes.find((node) => node.id === TARGET_ID)?.scale_frame);
    expect(observedState(reloaded, NEIGHBOUR_ID)).toEqual(observedState(before, NEIGHBOUR_ID));
    expect(body.blocks).toContainEqual(expect.objectContaining({
      type: 'graph_patch', status: 'applied', operation: 'set_factor_value', target_id: TARGET_ID,
    }));
    expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(reloaded as never));
    expect(body.blocks.some((block) => block.type === 'analysis_result')).toBe(false);
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(plotRunMock).not.toHaveBeenCalled();
    await expectRerunUsesReloadedValue(intended, !('rerunAllowed' in control) || control.rerunAllowed);
  });
});
