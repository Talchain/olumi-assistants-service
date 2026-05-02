/**
 * Unit tests for the V5 `what_would_flip` answer-carrying handler.
 *
 * Mirrors `explain-results.test.ts` — same precondition + answer-carrying
 * pattern, same accepted_entity_kinds — but asserts against the
 * handler-specific fact_type and fallback content.
 */

import { describe, it, expect } from 'vitest';

import {
  WhatWouldFlipHandlerFactSchema,
  type HandlerFact,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { createWhatWouldFlipHandler } from '../what-would-flip.js';
import type { HandlerInvocation } from '../../registry.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';
import { validateToolCall } from '../../../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { createRegistry, resolveHandler } from '../../registry.js';
import type { ScenarioReader } from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'req-what-would-flip';
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
      stage: 'decide',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'what would change the outcome?' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: overrides?.priorFacts ?? [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'what would change the outcome?',
      turn_class: 'decide',
      stage: 'decide',
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
    handler_id: 'what_would_flip',
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
  'For Hire Two Mid-Level to overtake the leader, Engineering Capacity would need to drop materially given the current 35 percentage point margin and stable robustness.';

describe('what_would_flip — registration', () => {
  it('is registered in the default V5 handler registry', () => {
    const registry = createRegistry({
      scenarioReader: STUB_SCENARIO_READER,
      plotClient: STUB_PLOT_CLIENT,
    });
    expect(resolveHandler(registry, 'what_would_flip')).not.toBeNull();
  });

  it('declares accepted_entity_kinds = [goal, option] in the validation registry', () => {
    const decl = HANDLER_VALIDATION_REGISTRY.what_would_flip;
    expect(decl).toBeDefined();
    expect(decl?.accepted_entity_kinds).toEqual(['goal', 'option']);
  });
});

describe('what_would_flip — validator', () => {
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

describe('what_would_flip — precondition (analysis fact)', () => {
  it('returns the deterministic template when no run_analysis fact exists', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(makeInvocation({ priorFacts: [], optionCount: 2 }));
    expect(outcome.assistant_text).toBe(
      'No analysis has been run on your model yet. ' +
        'The graph has 2 options configured ' +
        'and is ready to analyse. Would you like me to run the analysis?',
    );
    expect(outcome.suppress_orientation).toBe(true);
  });

  it('fails precondition when only a noop run_analysis fact is present', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [makeRunAnalysisFact(true)], optionCount: 2 }),
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });
});

describe('what_would_flip — answer-carrying contract', () => {
  it('happy path: uses Sonnet answer_text when answer_text_valid is true', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toBe(VALID_ANSWER_TEXT);
    expect(outcome.suppress_orientation).toBe(true);
  });

  it('bare tool_use regression: missing explanation → fallback contains margin and driver', async () => {
    // Reproduces the v40 staging Test F failure shape.
    const handler = createWhatWouldFlipHandler();
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
    expect(outcome.assistant_text).not.toBe('Here is what could change the outcome.');
  });

  it('answer_text containing mutation language → fallback used', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: 'Proposing to add a new factor would shift the outcome significantly across the model.',
          answer_text_valid: false,
          answer_validation_error: 'mutation_language_detected',
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).not.toContain('Proposing to add');
    expect(outcome.assistant_text).toContain('Hire Senior Engineer');
  });

  it('fallback cites runner-up and margin from the projection', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toContain('Hire Two Mid-Level');
    expect(outcome.assistant_text).toContain('35');
  });

  it('persists a fact that round-trips through the schema on the happy path', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const parsed = WhatWouldFlipHandlerFactSchema.safeParse(outcome.handler_facts[0]);
    expect(parsed.success).toBe(true);
  });

  it('always sets suppress_orientation: true on explanation turns', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.suppress_orientation).toBe(true);
  });
});

describe('what_would_flip — diagnostic fields', () => {
  it('Sonnet valid → answer_source=sonnet', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.answer_source).toBe('sonnet');
      expect(fact.result.fallback_reason).toBeNull();
      expect(fact.result.answer_text_length).toBe(VALID_ANSWER_TEXT.length);
    }
  });

  it('Sonnet invalid (forbidden_internal_term) → fallback_reason=forbidden_internal_term', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: 'leaks internal term',
          answer_text_valid: false,
          answer_validation_error: 'forbidden_internal_term',
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.answer_source).toBe('deterministic_fallback');
      expect(fact.result.fallback_reason).toBe('forbidden_internal_term');
    }
  });

  it('precondition fail → answer_source=precondition_template, fallback_reason explicitly null', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [], optionCount: 2 }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.answer_source).toBe('precondition_template');
      expect(fact.result.fallback_reason).toBeNull();
      expect(fact.result.answer_text_length).toBe(outcome.assistant_text.length);
    }
  });
});
