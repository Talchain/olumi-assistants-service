/**
 * Unit tests for the V5 `explain_results` answer-carrying handler.
 *
 * Covers registration, validator accept/reject, fact persistence,
 * the precondition pass/fail paths (with the critical non-noop filter),
 * and the new answer-carrying contract: happy path consumes
 * `invocation.explanation.answer_text`, fallback path composes a
 * deterministic response from `invocation.analysisProjection`.
 */

import { describe, it, expect } from 'vitest';

import {
  ExplainResultsHandlerFactSchema,
  type HandlerFact,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { createExplainResultsHandler } from '../explain-results.js';
import type {
  HandlerInvocation,
} from '../../registry.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';
import { validateToolCall } from '../../../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { createRegistry, resolveHandler } from '../../registry.js';
import type { ScenarioReader } from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-explain-results';
const GOAL_ID = 'goal_node_1';

const STUB_SCENARIO_READER: ScenarioReader = () =>
  Promise.reject(new Error('not exercised'));
const STUB_PLOT_CLIENT: PLoTClient = {
  run: () => Promise.reject(new Error('not exercised')),
  validatePatch: () => Promise.reject(new Error('not exercised')),
} as unknown as PLoTClient;

function makeRunAnalysisFact(noop = false): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_1',
      summary: 'Analysis complete.',
    },
  };
}

function makeAnalysisReady(optionCount: number): HandlerInvocation['analysisReady'] {
  return {
    options: Array.from({ length: optionCount }, (_, i) => ({
      option_id: `opt_${i + 1}`,
      label: `Option ${i + 1}`,
      status: 'ready',
      interventions: { f: 1 },
    })),
    goal_node_id: GOAL_ID,
    status: 'ready',
  };
}

const ANALYSIS_PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
    { factor_label: 'Hiring Cost', sensitivity_value: -0.42 },
  ],
  staleness_reason: null,
};

function makeInvocation(
  overrides?: {
    priorFacts?: readonly HandlerFact[];
    optionCount?: number;
    explanation?: HandlerInvocation['explanation'];
    analysisProjection?: AnalysisProjectionSummary;
  },
): HandlerInvocation {
  const optionCount = overrides?.optionCount ?? 2;
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
      prior_facts: overrides?.priorFacts ?? [],
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'why did opt_1 win?',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: makeAnalysisReady(optionCount),
    explanation: overrides?.explanation,
    analysisProjection: overrides?.analysisProjection,
  };
}

function buildProposal(overrides?: Partial<ProposalAction>): ProposalAction {
  return {
    handler_id: 'explain_results',
    entity: {
      id: 'opt_1',
      kind: 'option',
      label: 'Option 1',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [],
    cited_context_fields: [],
    ...overrides,
  };
}

const VALID_ANSWER_TEXT =
  'Hire Senior Engineer leads at 62 per cent because Engineering Capacity carries the strongest sensitivity in the model, well ahead of the runner-up.';

describe('explain_results — registration', () => {
  it('is registered in the default V5 handler registry', () => {
    const registry = createRegistry({
      scenarioReader: STUB_SCENARIO_READER,
      plotClient: STUB_PLOT_CLIENT,
    });
    expect(resolveHandler(registry, 'explain_results')).not.toBeNull();
  });

  it('declares accepted_entity_kinds = [goal, option] in the validation registry', () => {
    const decl = HANDLER_VALIDATION_REGISTRY.explain_results;
    expect(decl).toBeDefined();
    expect(decl?.accepted_entity_kinds).toEqual(['goal', 'option']);
  });
});

describe('explain_results — validator', () => {
  it('accepts an option-kind proposal', () => {
    const result = validateToolCall(buildProposal(), undefined, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('rejects a node-kind proposal with ENTITY_KIND_MISMATCH', () => {
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: 'node_dec_1',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'kind_inference',
        },
      }),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
    }
  });
});

describe('explain_results — precondition (analysis fact)', () => {
  it('returns the deterministic template when no run_analysis fact exists', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeInvocation({ priorFacts: [], optionCount: 2 }));
    expect(outcome.assistant_text).toBe(
      'No analysis has been run on your model yet. ' +
        'The graph has 2 options configured ' +
        'and is ready to analyse. Would you like me to run the analysis?',
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('explain_results');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });

  it('fails precondition when only a noop run_analysis fact is present', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [makeRunAnalysisFact(true)], optionCount: 2 }),
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });
});

describe('explain_results — answer-carrying contract', () => {
  it('happy path: uses Sonnet answer_text when answer_text_valid is true', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: VALID_ANSWER_TEXT,
          answer_text_valid: true,
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toBe(VALID_ANSWER_TEXT);
    expect(outcome.suppress_orientation).toBe(true);
    expect(outcome.llm_calls_used).toBe(0);
  });

  it('bare tool_use regression: missing explanation → deterministic fallback with leading option + driver', async () => {
    // Reproduces the v40 staging Test D failure shape: explanation is
    // absent (Sonnet emitted bare tool_use). The handler must NOT return
    // the old 32-char SAFE_FALLBACK stub; it must compose a useful
    // response from the analysis projection.
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
    expect(outcome.assistant_text).toContain('Hire Senior Engineer');
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).not.toBe('Here is what the analysis shows.');
  });

  it('invalid answer_text → deterministic fallback (probability + driver from projection)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: 'too short',
          answer_text_valid: false,
          answer_validation_error: 'too_short',
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toContain('Hire Senior Engineer');
    expect(outcome.assistant_text).toContain('62 per cent');
    expect(outcome.assistant_text).toContain('Engineering Capacity');
  });

  it('persists a fact that round-trips through the schema on the happy path', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: VALID_ANSWER_TEXT,
          answer_text_valid: true,
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const parsed = ExplainResultsHandlerFactSchema.safeParse(outcome.handler_facts[0]);
    expect(parsed.success).toBe(true);
  });

  it('always sets suppress_orientation: true on explanation turns (handler owns the user-visible string)', async () => {
    const handler = createExplainResultsHandler();
    const valid = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fallback = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(valid.suppress_orientation).toBe(true);
    expect(fallback.suppress_orientation).toBe(true);
  });
});
