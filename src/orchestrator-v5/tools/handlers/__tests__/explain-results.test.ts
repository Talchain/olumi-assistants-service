/**
 * Unit tests for the V5 `explain_results` no-op handler.
 *
 * Covers registration, validator accept/reject, fact persistence,
 * orientation pass-through, the precondition pass/fail paths (with the
 * critical non-noop filter), and the empty-orientation guard.
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
  HandlerOutcome,
} from '../../registry.js';
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

function makeInvocation(
  overrides?: {
    priorFacts?: readonly HandlerFact[];
    optionCount?: number;
    orientationText?: string;
  },
): HandlerInvocation {
  // V5 0.9.0 fix: option_count comes from analysisReady (real graph state),
  // not entity_registry (wire stub, always empty in production).
  const optionCount = overrides?.optionCount ?? 2;
  return {
    context: {
      stage: 'analyse',
      entity_registry: {
        option_ids: [],
        goal_id: GOAL_ID,
      },
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
    orientationText: overrides?.orientationText ?? "Looking at why opt_1 leads.",
    analysisReady: makeAnalysisReady(optionCount),
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

  it('accepts a goal-kind proposal', () => {
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: GOAL_ID,
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'context_inference',
        },
      }),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a node-kind proposal with ENTITY_KIND_MISMATCH (analysis-grounded — must target goal/option)', () => {
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

  it('rejects an edge-kind proposal with ENTITY_KIND_MISMATCH', () => {
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: 'e_1',
          kind: 'edge',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
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
    const outcome = await handler(
      makeInvocation({ priorFacts: [], optionCount: 2 }),
    );
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
      expect(fact.result.option_count).toBe(2);
    }
  });

  it('uses singular "option" in the template when option_count === 1', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [], optionCount: 1 }),
    );
    expect(outcome.assistant_text).toContain('1 option configured');
    expect(outcome.assistant_text).not.toContain('1 options');
  });

  it('passes precondition when a non-noop run_analysis fact is present', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        orientationText: 'Looking at the analysis results.',
      }),
    );
    expect(outcome.suppress_orientation).toBeUndefined();
    expect(outcome.assistant_text).toBe('');
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(false);
    }
  });

  it('fails precondition when only a noop run_analysis fact is present (D4 critical filter)', async () => {
    // A noop run_analysis fact must NOT satisfy the precondition — only a
    // real PLoT-backed analysis run produces the projection data the
    // explanation handler is asked to ground in. Mirrors the chip-generator
    // rule.
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(true)],
        optionCount: 2,
      }),
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });

  it('fails precondition when prior_facts contains only a noop explain_results fact', async () => {
    const noopExplainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: true, option_count: 2 },
    };
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [noopExplainFact], optionCount: 2 }),
    );
    expect(outcome.suppress_orientation).toBe(true);
  });
});

describe('explain_results — execution', () => {
  it('persists a fact that round-trips through the schema', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [makeRunAnalysisFact(false)] }),
    );
    const parsed = ExplainResultsHandlerFactSchema.safeParse(outcome.handler_facts[0]);
    expect(parsed.success).toBe(true);
  });

  it('returns a safe fallback string when orientation is empty (D8 happy path)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        orientationText: '',
      }),
    );
    expect(outcome.assistant_text).toBe('Here is what the analysis shows.');
    expect(outcome.suppress_orientation).toBeUndefined();
  });

  it('returns assistant_text="" on the happy path (orientation will surface via compose)', async () => {
    const handler = createExplainResultsHandler();
    const outcome: HandlerOutcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        orientationText: 'Sonnet wrote this orientation.',
      }),
    );
    expect(outcome.assistant_text).toBe('');
    expect(outcome.llm_calls_used).toBe(0);
  });
});
