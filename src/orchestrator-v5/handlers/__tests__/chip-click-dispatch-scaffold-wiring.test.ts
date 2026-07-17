/**
 * D-ask-1 (2.11 P0-1) — M4: LIVE WIRING of `__scaffolded_options` on the
 * chip-click dispatch path.
 *
 * The scaffolded-run disclosure surfaces (configure chip FIRST + the
 * decision_review disclosure channel) are threaded from
 * `HandlerOutcome.__scaffolded_options` at the DISPATCH call sites. The
 * chip-generator- and enricher-level suites prove the CONSUMERS work when
 * fed the records, but severing the dispatch threading itself left
 * everything green — this file closes that gap: it drives the REAL
 * `dispatchChipClickRunAnalysis` (real generateChips, real compose, real
 * validation registry) with a handler outcome carrying scaffold records.
 *
 * Mutation target (M4, chip path): delete either `__scaffolded_options`
 * spread in chip-click-dispatch.ts (the generateChips input or the
 * enricher input) → the corresponding test here goes RED.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';
import type { ScaffoldedOptionRecord } from '../../coaching/scaffold-disclosure.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { _resetConfigCache } from '../../../config/index.js';

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
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
      persistedGraph: null,
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

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AWAIT_DR_ENV = 'V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW';

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

const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    {
      id: 'opt_launch',
      kind: 'option',
      label: 'Launch now',
      interventions: { fac_marketing: 0.7 },
    },
    { id: 'opt_new', kind: 'option', label: 'New Option' },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_new', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

function snapshotFor(graph: GraphV3T): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_new', option_id: 'opt_new', label: 'New Option', interventions: {} },
    ],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: graph,
  };
}

const SCAFFOLD_RECORDS: readonly ScaffoldedOptionRecord[] = [
  {
    option_id: 'opt_new',
    label: 'New Option',
    factor_ids: ['fac_marketing'],
    value_defaulted: true,
  },
];

/** Handler outcome for a SCAFFOLDED success run (as the real handler emits). */
function scaffoldedHandlerOk() {
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
          win_probabilities: { opt_launch: 0.62, opt_new: 0.38 },
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
        },
      },
    ],
    llm_calls_used: 0,
    __scaffolded_options: SCAFFOLD_RECORDS,
  };
}

describe('chip-click-dispatch — D-ask-1 scaffold live wiring (M4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlerFnMock.mockResolvedValue(scaffoldedHandlerOk());
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    });
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));
  });

  afterEach(() => {
    delete process.env[AWAIT_DR_ENV];
    _resetConfigCache();
  });

  it('a scaffolded run offers the CONFIGURE chip FIRST on the real dispatch path (real generateChips, no injection)', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-scaffold-chip',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    const chips = out.response.suggested_actions;
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]).toMatchObject({
      id: 'chip_prompt_configure_option',
      label: 'Configure New Option',
      message: 'Help me configure New Option.',
    });
  });

  it('threads scaffoldedOptions into the decision_review enricher input (P1-2, chip-path call site)', async () => {
    process.env[AWAIT_DR_ENV] = 'true';
    _resetConfigCache();

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-scaffold-dr',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(enrichRunAnalysisMock).toHaveBeenCalledTimes(1);
    const enricherInput = enrichRunAnalysisMock.mock.calls[0][0] as {
      scaffoldedOptions?: readonly ScaffoldedOptionRecord[];
    };
    expect(enricherInput.scaffoldedOptions).toEqual(SCAFFOLD_RECORDS);
  });

  it('non-scaffolded run: no configure chip, no scaffoldedOptions on the enricher input (byte-identical wiring)', async () => {
    const { __scaffolded_options: _omit, ...plain } = scaffoldedHandlerOk();
    handlerFnMock.mockResolvedValue(plain);
    process.env[AWAIT_DR_ENV] = 'true';
    _resetConfigCache();

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-no-scaffold',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(
      out.response.suggested_actions.some((c) => c.id === 'chip_prompt_configure_option'),
    ).toBe(false);
    expect(enrichRunAnalysisMock).toHaveBeenCalledTimes(1);
    expect('scaffoldedOptions' in (enrichRunAnalysisMock.mock.calls[0][0] as object)).toBe(false);
  });
});
