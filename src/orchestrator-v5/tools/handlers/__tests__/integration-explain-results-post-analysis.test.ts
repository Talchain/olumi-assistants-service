/**
 * Integration test: `explain_results` after a prior non-noop `run_analysis`
 * fact must NOT emit a "Run analysis" chip.
 *
 * Regression coverage for the V5 0.9.0 facts_absent fix. The original chip
 * rule (`deriveProjectionStatus`) consulted only the CURRENT turn's
 * `handlerFacts`. On a post-analysis explain_results turn, the current
 * fact is the noop `explain_results` fact and the original signal would
 * have falsely classified projection status as `facts_absent`, emitting
 * a misleading "Run analysis" chip. The fix routes status through
 * `priorFacts` AND the populated analysis projection — either signal of
 * "real analysis exists" suffices.
 *
 * This integration test wires the actual handler + chip-generator
 * together (no mocks, no TurnExecutor scaffolding) and asserts the wire
 * shape.
 */

import { describe, it, expect } from 'vitest';

import type {
  HandlerFact,
  RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { createExplainResultsHandler } from '../explain-results.js';
import type { HandlerInvocation } from '../../registry.js';
import { generateChips } from '../../../compose/chip-generator.js';
import type { ContextPackAnalysis } from '../../../context/context-pack-assembler.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';

const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-explain-results-post-analysis';
const GOAL_ID = 'goal_node_1';

function priorRunAnalysisFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_1',
      summary: 'Analysis complete from a prior turn.',
      win_probabilities: { opt_1: 0.62, opt_2: 0.38 },
    },
  };
}

function populatedAnalysis(): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: { label: 'Option 1', probability: 0.62 },
    runner_up: { label: 'Option 2', probability: 0.38 },
    margin_pp: 24,
    robustness_band: 'stable',
    top_drivers: [],
    fragile_edges: [],
    staleness_reason: null,
  };
}

function populatedProjection(): AnalysisProjectionSummary {
  return {
    status: 'complete',
    leading_option: { label: 'Option 1', probability: 0.62 },
    runner_up: { label: 'Option 2', probability: 0.38 },
    margin_pp: 24,
    robustness_band: 'stable',
    top_drivers: [],
    staleness_reason: null,
  };
}

function makePostAnalysisInvocation(
  priorFacts: readonly HandlerFact[],
  options?: { withProjection?: boolean },
): HandlerInvocation {
  // P0 V5 golden-path repair: post-analysis explain turns have a non-null
  // analysisProjection in production (the turn-executor builds it for
  // explanation handlers). The handler's defensive guard treats a null
  // projection as missing analysis, so test fixtures simulating a real
  // post-analysis turn must include it. Default to producing one.
  const withProjection = options?.withProjection ?? true;
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'why did opt_1 win?' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: priorFacts,
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't_post_analysis',
      scenario_id: SCENARIO_ID,
      message: 'why did opt_1 win?',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: 'opt_1 leads because of strong cost and velocity drivers.',
    analysisReady: {
      options: [
        { option_id: 'opt_1', label: 'Option 1', status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_2', label: 'Option 2', status: 'ready', interventions: { f: 1 } },
      ],
      goal_node_id: GOAL_ID,
      status: 'ready',
    },
    analysisProjection: withProjection ? populatedProjection() : undefined,
  };
}

describe('integration: explain_results post-analysis chip surfacing', () => {
  it('handler runs as no-op when prior run_analysis fact exists', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makePostAnalysisInvocation([priorRunAnalysisFact()]),
    );
    // Answer-carrying contract (post-Commit-4): the handler now always
    // owns the user-visible string and always sets suppress_orientation:
    // true. Without an explanation payload + analysisProjection, the
    // handler composes the generic "could not be summarised" line —
    // covered in dedicated explain-results tests; here we only check the
    // no-op fact and the suppression flag.
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('explain_results');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(false);
    }
  });

  it('chip-generator does NOT emit "Run analysis" when explain_results runs after prior analysis', async () => {
    const handler = createExplainResultsHandler();
    const invocation = makePostAnalysisInvocation([priorRunAnalysisFact()]);
    const outcome = await handler(invocation);

    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: outcome.handler_facts,
      priorFacts: invocation.context.prior_facts,
      analysis: populatedAnalysis(),
      analysisReady: invocation.analysisReady,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });

    for (const chip of chips) {
      expect(chip.action_type).not.toBe('run_analysis');
    }
  });

  it('chip-generator continues to emit "Run analysis" when no prior analysis exists', async () => {
    // Sanity check the flip side: the facts_absent rule still fires when
    // there really is no prior analysis. Critical to keep — the bug fix
    // must not silently break the original use case.
    const handler = createExplainResultsHandler();
    const invocation = makePostAnalysisInvocation([]); // no prior facts
    const outcome = await handler(invocation);

    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: outcome.handler_facts,
      priorFacts: [],
      analysis: null,
      analysisReady: invocation.analysisReady,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });

    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });

  it('regression: analysis projection populated but priorFacts empty → both handler precondition AND chip rule treat as missing analysis (single source of truth)', async () => {
    // Failure mode this guards against: a UI bypass path arrives with
    // `analysis` populated upstream but no persisted run_analysis fact in
    // the handler's prior_facts view. Earlier iterations had the chip rule
    // suppress "Run analysis" while the handler returned the
    // precondition-fail template — user stranded with "no analysis" text
    // and no recovery action. V5 0.9.0 fix: both signals key off
    // priorFacts only.
    const handler = createExplainResultsHandler();
    const invocation = makePostAnalysisInvocation([]); // no prior facts

    // Handler fails precondition (single source of truth = prior_facts).
    const outcome = await handler(invocation);
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }

    // Chip rule agrees — emits Run analysis even though analysis projection
    // is populated upstream, because no fact = facts_absent.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: outcome.handler_facts,
      priorFacts: [],
      analysis: populatedAnalysis(), // populated upstream, but no fact
      analysisReady: invocation.analysisReady,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });
});
