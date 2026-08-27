import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { generateChips, type ChipGeneratorInput } from '../chip-generator.js';
import {
  selectCanonicalAnalysisState,
  type ReadinessLike,
} from '../../context/canonical-analysis-state.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import {
  cappedScenarioAnalysisFactSet,
  completeScenarioAnalysisFactSet,
  degradedScenarioAnalysisFactSet,
  reconcileTestScenarioAnalysisFactSet,
} from '../../__tests__/support/scenario-analysis-fact-set.js';
import { SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../../context/reconcile-scenario-analysis-facts.js';
import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';

const SCENARIO_ID = '00000000-0000-4000-8000-000000000001';
const READY: ReadinessLike = {
  status: 'ready',
  blockers: [],
  model_adjustments: [],
  goal_node_id: 'goal',
};
const READY_PAYLOAD = {
  status: 'ready',
  blockers: [],
  options: [],
  goal_node_id: 'goal',
} as ChipGeneratorInput['analysisReady'];

const MUTATION: HandlerFact = {
  fact_type: 'set_factor_value',
  fact_version: 1,
  noop: false,
  result: {
    target_id: 'factor-1',
    status: 'applied',
    before: { value: 1 },
    after: { value: 2 },
  },
};

function analysisFact(status: 'partial' | 'refused'): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: status === 'refused' ? null : 'option-1',
      summary:
        status === 'refused'
          ? 'Analysis attempt was refused before computation.'
          : 'A partial analysis result was shown.',
      enrichment: { analysis_status: status },
    },
  } as HandlerFact;
}

function successfulAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'option-1',
      summary: 'Option 1 currently leads.',
      graph_hash_at_run: 'current-graph',
      computed_at: '2026-08-27T12:00:00.000Z',
      win_probabilities: { 'option-1': 0.6, 'option-2': 0.4 },
      enrichment: { analysis_status: 'completed' },
    },
  } as HandlerFact;
}

const ANALYSIS_PROJECTION: ContextPackAnalysis = {
  status: 'complete',
  leading_option: { label: 'Option 1', probability: 0.6 },
  runner_up: { label: 'Option 2', probability: 0.4 },
  margin_pp: 20,
  robustness_band: 'stable',
  top_drivers: [],
  fragile_edges: [],
};

function canonicalState(options: {
  handlerFacts?: readonly HandlerFact[];
  priorFacts?: readonly HandlerFact[];
  readOk: boolean;
}) {
  return selectCanonicalAnalysisState({
    handlerFacts: options.handlerFacts ?? [],
    priorFacts: options.priorFacts ?? [],
    readiness: READY,
    currentGraphHash: 'current-graph',
    priorFactsReadOk: options.readOk,
  });
}

function runChips(overrides: Partial<ChipGeneratorInput> = {}) {
  return generateChips({
    stage: 'analyse',
    handlerFacts: [],
    priorFacts: [],
    analysis: null,
    analysisReady: READY_PAYLOAD,
    validationRegistry: HANDLER_VALIDATION_REGISTRY,
    ...overrides,
  });
}

function runChipIds(overrides: Partial<ChipGeneratorInput> = {}) {
  return runChips(overrides).map((chip) => chip.id);
}

describe('chip generator scenario analysis authority', () => {
  it('permits first-run only when complete durable history proves no result exists', () => {
    const state = canonicalState({ readOk: true });
    expect(state.freshness).toBe('none');

    expect(
      runChipIds({
        analysisFactSet: completeScenarioAnalysisFactSet(SCENARIO_ID),
        canonicalState: state,
      }),
    ).toContain('chip_action_run_analysis');
  });

  it.each(['capped', 'degraded'] as const)(
    'suppresses first-run across raw and floor paths when history is %s',
    (status) => {
      const state = canonicalState({ readOk: false });
      expect(state.freshness).toBe('unknown');

      const analyseIds = runChipIds({
        analysisFactSet:
          status === 'capped'
            ? cappedScenarioAnalysisFactSet(
                SCENARIO_ID,
                analysisFact('partial'),
              )
            : degradedScenarioAnalysisFactSet(SCENARIO_ID),
        canonicalState: state,
      });
      const mutationIds = runChipIds({
        handlerFacts: [MUTATION],
        analysisFactSet:
          status === 'capped'
            ? cappedScenarioAnalysisFactSet(
                SCENARIO_ID,
                analysisFact('partial'),
              )
            : degradedScenarioAnalysisFactSet(SCENARIO_ID),
        canonicalState: canonicalState({
          handlerFacts: [MUTATION],
          readOk: false,
        }),
      });
      const floorIds = runChipIds({
        stage: 'frame',
        analysisFactSet:
          status === 'capped'
            ? cappedScenarioAnalysisFactSet(
                SCENARIO_ID,
                analysisFact('partial'),
              )
            : degradedScenarioAnalysisFactSet(SCENARIO_ID),
        canonicalState: state,
      });

      for (const ids of [analyseIds, mutationIds, floorIds]) {
        expect(ids).not.toContain('chip_action_run_analysis');
      }
    },
  );

  it('treats a complete partial result as known analysis, not absence', () => {
    const partial = analysisFact('partial');
    const state = canonicalState({ priorFacts: [partial], readOk: true });
    expect(state.selected_fact_index).toBeNull();
    expect(state.degraded_fact_status).toBe('partial');

    const ids = runChipIds({
      handlerFacts: [MUTATION],
      analysisFactSet: completeScenarioAnalysisFactSet(SCENARIO_ID, [partial]),
      canonicalState: canonicalState({
        handlerFacts: [MUTATION],
        priorFacts: [partial],
        readOk: true,
      }),
    });
    expect(ids).not.toContain('chip_action_run_analysis');
  });

  it('lets a current partial result outrank pre-turn complete absence', () => {
    const partial = analysisFact('partial');
    const ids = runChipIds({
      handlerFacts: [partial],
      analysisFactSet: completeScenarioAnalysisFactSet(SCENARIO_ID),
      canonicalState: canonicalState({
        handlerFacts: [partial],
        readOk: true,
      }),
    });
    expect(ids).not.toContain('chip_action_run_analysis');
  });

  it('treats complete refusal-only history as no displayed result', () => {
    const refusal = analysisFact('refused');
    expect(
      runChipIds({
        analysisFactSet: completeScenarioAnalysisFactSet(SCENARIO_ID, [refusal]),
        canonicalState: canonicalState({
          priorFacts: [refusal],
          readOk: true,
        }),
      }),
    ).toContain('chip_action_run_analysis');
  });

  it('fails weak when direct callers omit or malform the carrier', () => {
    const state = canonicalState({ readOk: true });
    const omitted = runChipIds({ canonicalState: state });
    const malformed = runChipIds({
      canonicalState: state,
      analysisFactSet: {
        status: 'complete',
        facts: [{} as HandlerFact],
      } as never,
    });

    expect(omitted).not.toContain('chip_action_run_analysis');
    expect(malformed).not.toContain('chip_action_run_analysis');
  });

  it('deep-freezes reconciled facts so post-reconcile mutation cannot mint absence', () => {
    const partial = analysisFact('partial');
    const analysisFactSet = completeScenarioAnalysisFactSet(SCENARIO_ID, [
      partial,
    ]);
    expect(Object.isFrozen(analysisFactSet.facts[0])).toBe(true);
    expect(Object.isFrozen(analysisFactSet.facts[0]?.result)).toBe(true);
    expect(() => {
      (analysisFactSet.facts[0] as { noop: boolean }).noop = true;
    }).toThrow(TypeError);
    expect(
      runChipIds({
        analysisFactSet,
        canonicalState: canonicalState({ priorFacts: [partial], readOk: true }),
      }),
    ).not.toContain('chip_action_run_analysis');
  });

  it('keeps executable post-analysis exploration byte-identical after the durable run ages out of the hot window', () => {
    const durable = successfulAnalysisFact();
    const state = canonicalState({ priorFacts: [durable], readOk: true });
    expect(state.freshness).toBe('fresh');
    const shared = {
      analysisFactSet: completeScenarioAnalysisFactSet(SCENARIO_ID, [durable]),
      canonicalState: state,
      analysis: ANALYSIS_PROJECTION,
    };

    const hot = runChips({ ...shared, priorFacts: [durable] });
    const agedOut = runChips({ ...shared, priorFacts: [] });

    expect(agedOut).toEqual(hot);
    expect(agedOut).toHaveLength(1);
    expect(agedOut[0]).toMatchObject({
      id: 'chip_action_what_would_flip',
      action_type: 'what_would_flip',
    });
  });

  it('keeps noop-explanation recovery byte-identical when durable analysis is outside the hot window', () => {
    const durable = successfulAnalysisFact();
    const noopExplanation: HandlerFact = {
      fact_type: 'explain_from_structure',
      fact_version: 1,
      noop: true,
      result: { option_count: 2 },
    } as HandlerFact;
    const state = canonicalState({ priorFacts: [durable], readOk: true });
    const shared = {
      handlerFacts: [noopExplanation],
      analysisFactSet: completeScenarioAnalysisFactSet(SCENARIO_ID, [durable]),
      canonicalState: state,
      analysis: ANALYSIS_PROJECTION,
    };

    const hot = runChips({ ...shared, priorFacts: [durable] });
    const agedOut = runChips({ ...shared, priorFacts: [] });

    expect(agedOut).toEqual(hot);
    expect(agedOut).toHaveLength(1);
    expect(agedOut[0]).toMatchObject({
      id: 'chip_action_what_would_flip',
      action_type: 'what_would_flip',
    });
    expect(agedOut.map((chip) => chip.id)).not.toContain(
      'chip_action_run_analysis',
    );
  });

  it.each([
    {
      label: 'foreign scenario',
      carrier: () =>
        reconcileTestScenarioAnalysisFactSet({
          scenarioId: SCENARIO_ID,
          durableRead: {
            status: 'ok',
            scenario_id: SCENARIO_ID,
            query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
            total_count: 1,
            facts: [
              {
                ...analysisFact('partial'),
                result: {
                  ...analysisFact('partial').result,
                  scenario_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                },
              },
            ],
          },
        }),
    },
    {
      label: 'noop durable row',
      carrier: () =>
        reconcileTestScenarioAnalysisFactSet({
          scenarioId: SCENARIO_ID,
          durableRead: {
            status: 'ok',
            scenario_id: SCENARIO_ID,
            query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
            total_count: 1,
            facts: [{ ...analysisFact('partial'), noop: true }],
          },
        }),
    },
    {
      label: 'count mismatch',
      carrier: () =>
        reconcileTestScenarioAnalysisFactSet({
          scenarioId: SCENARIO_ID,
          durableRead: {
            status: 'ok',
            scenario_id: SCENARIO_ID,
            query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
            total_count: 1,
            facts: [],
          },
        }),
    },
    {
      label: 'snapshot conflict',
      carrier: () =>
        reconcileTestScenarioAnalysisFactSet({
          scenarioId: SCENARIO_ID,
          hotWindowFacts: [analysisFact('partial')],
          durableRead: {
            status: 'ok',
            scenario_id: SCENARIO_ID,
            query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
            total_count: 0,
            facts: [],
          },
        }),
    },
  ])('does not license first-run from a $label carrier', ({ carrier }) => {
    const analysisFactSet = carrier();
    expect(analysisFactSet.status).toBe('degraded');
    expect(
      runChipIds({
        analysisFactSet,
        canonicalState: canonicalState({ readOk: false }),
      }),
    ).not.toContain('chip_action_run_analysis');
  });
});
