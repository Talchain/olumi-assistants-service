/**
 * Unit tests for the V5 `explain_from_structure` no-op handler.
 *
 * Covers the registration-level invariants alongside the four core
 * behaviours the brief specifies: validator acceptance, validator rejection,
 * fact persistence, and orientation pass-through. Includes the
 * decision-node misroute test (D7), the empty-orientation guard (D8), and
 * the wire entity-kind enum coverage so the validator's accepted-kinds set
 * stays in sync with the proposal schema.
 */

import { describe, it, expect } from 'vitest';

import {
  ExplainFromStructureHandlerFactSchema,
  type HandlerFact,
} from '@talchain/schemas/orchestrator';

import { createExplainFromStructureHandler } from '../explain-from-structure.js';
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

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'req-explain-from-structure';
const GOAL_ID = 'goal_node_1';
const DECISION_NODE_ID = 'node_decision_1';

const STUB_SCENARIO_READER: ScenarioReader = () =>
  Promise.reject(new Error('not exercised'));
const STUB_PLOT_CLIENT: PLoTClient = {
  run: () => Promise.reject(new Error('not exercised')),
  validatePatch: () => Promise.reject(new Error('not exercised')),
} as unknown as PLoTClient;

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
  overrides?: Partial<HandlerInvocation> & {
    priorFacts?: readonly HandlerFact[];
    optionCount?: number;
    goalId?: string | null;
    orientationText?: string;
    /** Set true to omit analysisReady (exercises the entity_registry fallback). */
    omitAnalysisReady?: boolean;
    /** Forces the entity_registry stub to a non-empty value (fallback test). */
    fallbackOptionIds?: readonly string[];
  },
): HandlerInvocation {
  const optionCount = overrides?.optionCount ?? 2;
  return {
    context: {
      stage: 'frame',
      entity_registry: {
        option_ids: overrides?.fallbackOptionIds ?? [],
        goal_id: overrides?.goalId ?? GOAL_ID,
      },
      capabilities: {},
      messages: [{ role: 'user', content: 'what factor most influences my decision?' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: overrides?.priorFacts ?? [],
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'what factor most influences my decision?',
      turn_class: 'frame',
      stage: 'frame',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: overrides?.orientationText ?? 'Looking at the structure of your decision graph.',
    analysisReady: overrides?.omitAnalysisReady ? undefined : makeAnalysisReady(optionCount),
    ...overrides,
  };
}

function buildProposal(overrides?: Partial<ProposalAction>): ProposalAction {
  return {
    handler_id: 'explain_from_structure',
    entity: {
      id: GOAL_ID,
      kind: 'goal',
      label: 'Goal',
      resolution_status: 'resolved',
      resolution_method: 'context_inference',
    },
    parameters: [],
    cited_context_fields: [],
    ...overrides,
  };
}

describe('explain_from_structure — registration', () => {
  it('is registered in the default V5 handler registry', () => {
    const registry = createRegistry({
      scenarioReader: STUB_SCENARIO_READER,
      plotClient: STUB_PLOT_CLIENT,
    });
    expect(resolveHandler(registry, 'explain_from_structure')).not.toBeNull();
  });

  it('declares accepted_entity_kinds = [goal, option] in the validation registry', () => {
    const decl = HANDLER_VALIDATION_REGISTRY.explain_from_structure;
    expect(decl).toBeDefined();
    expect(decl?.accepted_entity_kinds).toEqual(['goal', 'option']);
  });
});

describe('explain_from_structure — validator', () => {
  it('accepts a goal-kind proposal', () => {
    const result = validateToolCall(buildProposal(), undefined, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('accepts an option-kind proposal', () => {
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: 'opt_1',
          kind: 'option',
          label: 'Option A',
          resolution_status: 'resolved',
          resolution_method: 'label_match',
        },
      }),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a node-kind proposal with ENTITY_KIND_MISMATCH (kind=node is too broad — covers decision/outcome/risk)', () => {
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: DECISION_NODE_ID,
          kind: 'node',
          label: 'Decision',
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

  it('rejects a constraint-kind proposal with ENTITY_KIND_MISMATCH', () => {
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: 'c_1',
          kind: 'constraint',
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

describe('explain_from_structure — execution', () => {
  it('returns a noop fact and uses Sonnet orientation as assistant_text', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome: HandlerOutcome = await handler(
      makeInvocation({ optionCount: 2 }),
    );
    expect(outcome.assistant_text).toBe('');
    expect(outcome.handler_facts).toHaveLength(1);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('explain_from_structure');
    expect(fact.noop).toBe(true);
    expect(fact.fact_version).toBe(1);
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.option_count).toBe(2);
    }
    expect(outcome.llm_calls_used).toBe(0);
    expect(outcome.suppress_orientation).toBeUndefined();
  });

  it('persists a fact that round-trips through the schema (D9 invariant)', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler(makeInvocation());
    const parsed = ExplainFromStructureHandlerFactSchema.safeParse(
      outcome.handler_facts[0],
    );
    expect(parsed.success).toBe(true);
  });

  it('returns a safe fallback string when orientation is empty (D8)', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler(makeInvocation({ orientationText: '   ' }));
    expect(outcome.assistant_text).toBe('Here is what the model structure shows.');
    expect(outcome.suppress_orientation).toBeUndefined();
  });

  it('records option_count = 0 when analysisReady has zero options', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler(makeInvocation({ optionCount: 0 }));
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.option_count).toBe(0);
    }
  });

  it('falls back to entity_registry when analysisReady is undefined', async () => {
    // Defensive fallback for the chip-click path (no routing layer, no
    // analysisReady threading) and any edge case where the structural
    // readiness payload is unavailable.
    const handler = createExplainFromStructureHandler();
    const outcome = await handler(
      makeInvocation({
        omitAnalysisReady: true,
        fallbackOptionIds: ['opt_1', 'opt_2', 'opt_3'],
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.option_count).toBe(3);
    }
  });
});
