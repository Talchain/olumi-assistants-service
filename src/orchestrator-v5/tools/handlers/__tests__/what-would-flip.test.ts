/**
 * Unit tests for the V5 `what_would_flip` no-op handler.
 *
 * Mirrors `explain-results.test.ts` — same precondition pattern, same
 * accepted_entity_kinds, same template shape — but asserts against the
 * handler-specific fact_type and safe-fallback string. The shared
 * patterns are tested explicitly in both files so a regression in one
 * handler is not masked by a passing test in the other.
 */

import { describe, it, expect } from 'vitest';

import {
  WhatWouldFlipHandlerFactSchema,
  type HandlerFact,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { createWhatWouldFlipHandler } from '../what-would-flip.js';
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

function makeInvocation(
  overrides?: {
    priorFacts?: readonly HandlerFact[];
    optionCount?: number;
    orientationText?: string;
  },
): HandlerInvocation {
  // V5 0.9.0 fix: option_count comes from analysisReady (real graph state).
  const optionCount = overrides?.optionCount ?? 2;
  return {
    context: {
      stage: 'decide',
      entity_registry: {
        option_ids: [],
        goal_id: GOAL_ID,
      },
      capabilities: {},
      messages: [{ role: 'user', content: 'what would change the outcome?' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: overrides?.priorFacts ?? [],
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
    orientationText: overrides?.orientationText ?? 'Looking at what could flip the result.',
    analysisReady: makeAnalysisReady(optionCount),
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

describe('what_would_flip — precondition (analysis fact)', () => {
  it('returns the deterministic template when no run_analysis fact exists', async () => {
    const handler = createWhatWouldFlipHandler();
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
    expect(fact.fact_type).toBe('what_would_flip');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.precondition_unmet).toBe(true);
      expect(fact.result.option_count).toBe(2);
    }
  });

  it('passes precondition when a non-noop run_analysis fact is present', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        orientationText: 'Looking at the flip thresholds.',
      }),
    );
    expect(outcome.suppress_orientation).toBeUndefined();
    expect(outcome.assistant_text).toBe('');
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.precondition_unmet).toBe(false);
    }
  });

  it('fails precondition when only a noop run_analysis fact is present', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(true)],
        optionCount: 2,
      }),
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });
});

describe('what_would_flip — execution', () => {
  it('persists a fact that round-trips through the schema', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [makeRunAnalysisFact(false)] }),
    );
    const parsed = WhatWouldFlipHandlerFactSchema.safeParse(outcome.handler_facts[0]);
    expect(parsed.success).toBe(true);
  });

  it('returns a safe fallback string when orientation is empty (D8 happy path)', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        orientationText: '',
      }),
    );
    expect(outcome.assistant_text).toBe('Here is what could change the outcome.');
    expect(outcome.suppress_orientation).toBeUndefined();
  });

  it('returns assistant_text="" on the happy path (orientation will surface via compose)', async () => {
    const handler = createWhatWouldFlipHandler();
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
