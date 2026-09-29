/**
 * ⭐⭐⭐ C8 — THE DISPATCH PATH ITSELF THREADS THE RUN'S GRAPH.
 *
 * The component's other controls exercise the PROJECTION. That is a real limit
 * and it was named in review: a projection test cannot see the dispatcher
 * handing over the wrong graph, because it is handed the graph directly. Sever
 * the threading in `chip-click-dispatch.ts` and every one of those controls
 * stays green.
 *
 * This file closes that gap the same way `chip-click-dispatch-scaffold-wiring`
 * closed it for `__scaffolded_options`: it drives the REAL
 * `dispatchChipClickRunAnalysis` and asserts what the enricher actually
 * RECEIVED.
 *
 * ⚠ THE FIXTURE'S WHOLE JOB IS THAT THE TWO READS DISAGREE. The run handler's
 * snapshot carries `fac_runway`; the turn-start `context.persistedGraph`
 * carries `fac_morale` instead. If they agreed, this suite would pass on the
 * defect — which is exactly how the original threading shipped reading
 * `context.persistedGraph`: on a turn that does not edit, the two reads are the
 * same object and nothing can tell them apart. The disagreement IS the
 * instrument.
 *
 * Mutation target: change `cachedSnapshot?.rawPersistedGraph ?? context
 * .persistedGraph` back to `context.persistedGraph` in chip-click-dispatch.ts
 * → C8b and C8c go RED, C8d stays green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { _resetConfigCache } from '../../../config/index.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AWAIT_DR_ENV = 'V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW';

/** The graph as it stood at TURN START — before this turn's edit. */
const STALE_TURN_START_GRAPH = {
  nodes: [
    { id: 'fac_morale', kind: 'factor', label: 'Team Morale Only In The Stale Read' },
  ],
  edges: [],
};

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
      session_id: SCENARIO_ID,
      request_id: 'req-test',
      budgets: {
        turn_ms: 30000,
        handler_ms: 20000,
        plot_ms: 15000,
        anthropic_ms: 15000,
        openai_ms: 15000,
      },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: 'A decision brief',
      // ⭐ DELIBERATELY A DIFFERENT GRAPH FROM THE SNAPSHOT'S.
      persistedGraph: STALE_TURN_START_GRAPH,
    })),
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

/** The graph the RUN analysed — note `fac_runway`, absent from the stale read. */
const RUN_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    { id: 'fac_runway', kind: 'factor', label: 'Cash Runway Only In The Run', observed_state: { value: 0.5 } },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

function snapshotWith(rawPersistedGraph: unknown): RunAnalysisScenarioSnapshot {
  return {
    graph: RUN_GRAPH,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
    ],
    goal_node_id: 'goal_revenue',
    ...(rawPersistedGraph === undefined ? {} : { rawPersistedGraph }),
  } as unknown as RunAnalysisScenarioSnapshot;
}

function handlerOk() {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          win_probabilities: { opt_launch: 0.62 },
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
        },
      },
    ],
    llm_calls_used: 0,
  };
}

/** The `runGraph` the dispatcher actually handed the enricher. */
function receivedRunGraph(): unknown {
  expect(enrichRunAnalysisMock, 'the enricher ran at all').toHaveBeenCalledTimes(1);
  return (enrichRunAnalysisMock.mock.calls[0]![0] as { runGraph?: unknown }).runGraph;
}

describe('C8 — the chip dispatch path hands the enricher the RUN\'s graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlerFnMock.mockResolvedValue(handlerOk());
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockImplementation(async (r: unknown) => ({
      response: r,
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    }));
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotWith(RUN_GRAPH));
    process.env[AWAIT_DR_ENV] = 'true';
    _resetConfigCache();
  });

  afterEach(() => {
    delete process.env[AWAIT_DR_ENV];
    _resetConfigCache();
  });

  it('C8a PRECONDITION: the two reads genuinely disagree, so this suite can discriminate', () => {
    const runIds = RUN_GRAPH.nodes.map((n) => n.id);
    const staleIds = STALE_TURN_START_GRAPH.nodes.map((n) => n.id);
    expect(runIds).toContain('fac_runway');
    expect(staleIds).not.toContain('fac_runway');
    expect(staleIds).toContain('fac_morale');
    expect(runIds).not.toContain('fac_morale');
  });

  it('C8b the enricher receives the RUN handler\'s snapshot graph', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-run-graph',
    });
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    // Identity, not a value predicate another object could satisfy.
    expect(receivedRunGraph()).toBe(RUN_GRAPH);
  });

  it('C8c it does NOT receive the turn-start reread', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-not-stale',
    });
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    const received = receivedRunGraph();
    expect(received).not.toBe(STALE_TURN_START_GRAPH);
    expect(
      JSON.stringify(received),
      'the stale read must not reach the reviewing model',
    ).not.toContain('Team Morale Only In The Stale Read');
  });

  it('C8d with no snapshot graph it falls back to the turn-start read — never worse than absent', async () => {
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotWith(undefined));
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-fallback',
    });
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(
      receivedRunGraph(),
      'the pre-existing behaviour survives when the handler produced no snapshot',
    ).toBe(STALE_TURN_START_GRAPH);
  });
});
