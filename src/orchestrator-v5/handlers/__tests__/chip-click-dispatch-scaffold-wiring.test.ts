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
import type { OmittedOptionRecord, ScaffoldedOptionRecord } from '../../coaching/scaffold-disclosure.js';

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

/**
 * The options the run LEFT OUT — identity and label only, because nothing was
 * minted for them. This, not the held status quo, is the configure chip's
 * source since the no-rank ruling.
 */
const EXCLUDED_RECORDS: readonly OmittedOptionRecord[] = [
  { option_id: 'opt_new', label: 'New Option' },
];

/**
 * Mocked handler outcome for a success run that held the status quo AND
 * excluded an option. The carrier is injected deliberately so this suite
 * isolates dispatch threading into the real chip consumer; canonical
 * readiness is still derived independently from READY_GRAPH.
 */
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
    // ⚠ THE SECOND CHANNEL, ADDED BY THE NO-RANK RULING (2026-08-14). The run
    // HELD the status quo (above) AND EXCLUDED an option with no values set.
    // The configure chip is built from THIS one, because a held status quo has
    // nothing to configure. Both are emitted here because the real handler
    // emits both on a run that did each.
    __excluded_options: EXCLUDED_RECORDS,
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

  it('a non-ready run that EXCLUDED an option offers only its CONFIGURE recovery on the real dispatch path', async () => {
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
    expect(chips).toHaveLength(1);
    expect(
      chips.some((chip) =>
        [
          'chip_action_explain_results',
          'chip_action_what_would_flip',
          'chip_prompt_validate_decision',
        ].includes(chip.id),
      ),
    ).toBe(false);
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

  it('untouched run: no configure chip, no scaffoldedOptions on the enricher input (byte-identical wiring)', async () => {
    // BOTH channels must be stripped. Dropping only `__scaffolded_options`
    // would leave `__excluded_options` behind and the configure chip would
    // still fire — which is the point: the chip's source is the EXCLUDED
    // channel now, so the "nothing happened" control has to speak to it.
    const { __scaffolded_options: _omit, __excluded_options: _omit2, ...plain } = scaffoldedHandlerOk();
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
    expect('excludedOptions' in (enrichRunAnalysisMock.mock.calls[0][0] as object)).toBe(false);
  });

  it('⭐ a run that ONLY held the status quo offers NO configure chip', () => {
    // The discriminating twin of the first spec: same dispatch path, same
    // handler, only the excluded channel removed. A held status quo needs no
    // repair, so prescribing one would be a futile step — the same defect the
    // baseline-hold disclosure deliberately avoids.
    const { __excluded_options: _omit, ...heldOnly } = scaffoldedHandlerOk();
    handlerFnMock.mockResolvedValue(heldOnly);
    return dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-held-only',
    }).then((out) => {
      if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
      expect(
        out.response.suggested_actions.some((c) => c.id === 'chip_prompt_configure_option'),
      ).toBe(false);
    });
  });
});
