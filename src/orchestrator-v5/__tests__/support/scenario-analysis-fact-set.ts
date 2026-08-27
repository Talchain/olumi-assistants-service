import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  reconcileScenarioAnalysisFacts,
  SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
  type DurableScenarioAnalysisFactRead,
  type ScenarioAnalysisFactSet,
} from '../../context/reconcile-scenario-analysis-facts.js';

export function reconcileTestScenarioAnalysisFactSet(input: {
  readonly scenarioId: string;
  readonly durableRead?: DurableScenarioAnalysisFactRead;
  readonly hotWindowFacts?: readonly unknown[];
}): ScenarioAnalysisFactSet {
  return reconcileScenarioAnalysisFacts({
    scenarioId: input.scenarioId,
    hotWindowFacts: input.hotWindowFacts ?? [],
    ...(input.durableRead === undefined
      ? {}
      : { durableRead: input.durableRead }),
  });
}

export function completeScenarioAnalysisFactSet(
  scenarioId: string,
  facts: readonly HandlerFact[] = [],
  hotWindowFacts: readonly unknown[] = facts,
): Extract<ScenarioAnalysisFactSet, { readonly status: 'complete' }> {
  const carrier = reconcileTestScenarioAnalysisFactSet({
    scenarioId,
    hotWindowFacts,
    durableRead: {
      status: 'ok',
      scenario_id: scenarioId,
      query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
      total_count: facts.length,
      facts,
    },
  });
  if (carrier.status !== 'complete') {
    throw new Error(`test fixture did not reconcile complete: ${JSON.stringify(carrier)}`);
  }
  return carrier;
}

export function cappedScenarioAnalysisFactSet(
  scenarioId: string,
  fact: HandlerFact,
): Extract<ScenarioAnalysisFactSet, { readonly status: 'capped' }> {
  const facts = Array.from(
    { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT },
    () => fact,
  );
  const carrier = reconcileTestScenarioAnalysisFactSet({
    scenarioId,
    durableRead: {
      status: 'ok',
      scenario_id: scenarioId,
      query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
      total_count: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
      facts,
    },
  });
  if (carrier.status !== 'capped') {
    throw new Error(`test fixture did not reconcile capped: ${JSON.stringify(carrier)}`);
  }
  return carrier;
}

export function degradedScenarioAnalysisFactSet(
  scenarioId: string,
): Extract<ScenarioAnalysisFactSet, { readonly status: 'degraded' }> {
  const carrier = reconcileTestScenarioAnalysisFactSet({
    scenarioId,
    durableRead: { status: 'degraded', reason: 'unavailable' },
  });
  if (carrier.status !== 'degraded') {
    throw new Error(`test fixture did not reconcile degraded: ${carrier.status}`);
  }
  return carrier;
}
