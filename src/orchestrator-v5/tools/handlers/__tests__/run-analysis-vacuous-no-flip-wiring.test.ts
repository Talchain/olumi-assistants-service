/**
 * THE WIRING PIN for P2 — the run_analysis handler must hand the headline the
 * set of factors EVERY option sets, or the vacuous "no single factor we tested
 * would change the order" keeps shipping.
 *
 * `headline-vacuous-no-flip.test.ts` proves the headline's rule. It cannot prove
 * the handler PASSES the set: delete the `factorIdsSetByEveryOption:` line from
 * `run-analysis.ts` and every assertion there stays green while the product
 * ships the defect (chronic failure #1 — built, not plugged in). This file
 * EXECUTES the handler, modelled on `run-analysis-unset-option-effect-wiring.test.ts`
 * (two stubbed deps: `plotClient`, `scenarioReader`).
 *
 * ARM 1 is the defect shape (every option sets both tested factors). ARM 2 is
 * the DISCRIMINATING TWIN (one option leaves a tested factor free): the same
 * handler must still state the finding there, so ARM 1 cannot pass against a
 * build that simply never says it.
 *
 * Status ladder: TESTED. Stubbed PLoT is not a wire witness.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_REQUEST_ID = 'req-vacuous-no-flip-wiring';

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const factor = (id: string, label: string) => ({
  id,
  kind: 'factor',
  label,
  category: 'controllable',
  observed_state: { value: 0.5, cap: 1 },
});

const option = (id: string, label: string, interventions: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  interventions,
});

/** ARM 1 — every option sets BOTH tested factors (Paul's shape). */
const EVERY_OPTION_SETS_EVERY_FACTOR = {
  version: '1',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Hit the delivery date' },
    { id: 'decision', kind: 'decision', label: 'Delivery plan' },
    factor('fac_scope', 'Scope'),
    factor('fac_capacity', 'Team capacity'),
    option('opt_reduce', 'Reduce scope', { fac_scope: 0.4, fac_capacity: 0.5 }),
    option('opt_contract', 'Hire a contractor', { fac_scope: 0.8, fac_capacity: 0.8 }),
    option('opt_sq', 'Status quo', { fac_scope: 0.8, fac_capacity: 0.5 }),
  ],
  edges: [
    v3Edge('e1', 'decision', 'opt_reduce'),
    v3Edge('e2', 'decision', 'opt_contract'),
    v3Edge('e3', 'decision', 'opt_sq'),
    v3Edge('e4', 'opt_reduce', 'fac_scope'),
    v3Edge('e5', 'opt_reduce', 'fac_capacity'),
    v3Edge('e6', 'opt_contract', 'fac_scope'),
    v3Edge('e7', 'opt_contract', 'fac_capacity'),
    v3Edge('e8', 'opt_sq', 'fac_scope'),
    v3Edge('e9', 'opt_sq', 'fac_capacity'),
    v3Edge('e10', 'fac_scope', 'goal'),
    v3Edge('e11', 'fac_capacity', 'goal'),
  ],
};

/** ARM 2 — identical, except the status quo leaves Team capacity free. */
const ONE_OPTION_LEAVES_A_FACTOR_FREE = {
  ...EVERY_OPTION_SETS_EVERY_FACTOR,
  nodes: EVERY_OPTION_SETS_EVERY_FACTOR.nodes.map((n) =>
    n.id === 'opt_sq' ? option('opt_sq', 'Status quo', { fac_scope: 0.8 }) : n,
  ),
  edges: EVERY_OPTION_SETS_EVERY_FACTOR.edges.filter((e) => e.id !== 'e9'),
};

function makeScenarioReader(graph: Record<string, unknown>): ScenarioReader {
  const snapshot = {
    graph,
    options: (graph.nodes as Array<Record<string, unknown>>).filter((n) => n.kind === 'option'),
    goal_node_id: 'goal',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  return (() => Promise.resolve(snapshot)) as ScenarioReader;
}

/** Not robust, and every flip row ATTESTS no flip — the 2.278 posture. */
function makePlotClient(): PLoTClient {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'vacuous-no-flip-wiring' },
    response_hash: 'vacuous-no-flip-wiring',
    analysis_status: 'computed',
    option_comparison: [
      { option_id: 'opt_reduce', option_label: 'Reduce scope', win_probability: 0.62, status: 'computed' },
      { option_id: 'opt_contract', option_label: 'Hire a contractor', win_probability: 0.25, status: 'computed' },
      { option_id: 'opt_sq', option_label: 'Status quo', win_probability: 0.13, status: 'computed' },
    ],
    factor_sensitivity: [],
    robustness: { is_robust: false, level: 'low' },
    flip_thresholds: [
      { factor_id: 'fac_scope', factor_label: 'Scope', current_value: 0.5, flip_value: null, flip_reason: 'structurally_invariant' },
      { factor_id: 'fac_capacity', factor_label: 'Team capacity', current_value: 0.5, flip_value: null, flip_reason: 'structurally_invariant' },
    ],
  } as unknown as V2RunResponseEnvelope;
  return {
    run: vi.fn(() => Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope)),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  };
}

async function runAndReadSummary(graph: Record<string, unknown>): Promise<string> {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(),
    scenarioReader: makeScenarioReader(graph),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error(`expected a run_analysis fact, got ${String(fact?.fact_type)}`);
  }
  return fact.result.summary ?? '';
}

/** The literal clause a user reads. Hand-written: a derived guard proves agreement, not correctness. */
const NO_FLIP_CLAIM = 'no single factor we tested would change the order';

/** The egress grammar costs seconds per call on the no-flip sentence (see headline-vacuous-no-flip.test.ts). */
const GRAMMAR_BUDGET_MS = 30_000;

describe('wiring — run_analysis hands the headline the every-option factor set (P2)', () => {
  it('⭐ ARM 1 — every option sets every tested factor ⇒ the vacuous claim is NOT in the summary', async () => {
    const summary = await runAndReadSummary(EVERY_OPTION_SETS_EVERY_FACTOR);
    // Precondition: the robustness verdict rides, so an absence below is not vacuous.
    expect(summary).toContain('The result is not yet robust');
    expect(summary).not.toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  it('⭐ ARM 2 (DISCRIMINATING TWIN) — one option leaves a tested factor free ⇒ the finding is stated', async () => {
    const summary = await runAndReadSummary(ONE_OPTION_LEAVES_A_FACTOR_FREE);
    expect(summary).toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);
});
