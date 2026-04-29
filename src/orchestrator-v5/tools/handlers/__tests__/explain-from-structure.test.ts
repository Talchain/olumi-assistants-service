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
import type { HandlerInvocation } from '../../registry.js';
import type { StructureProjectionSummary } from '../../../context/projection-summaries.js';
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

const STRUCTURE_PROJECTION: StructureProjectionSummary = {
  goal_label: 'Q3 Throughput',
  top_causal_links: [
    { label_from: 'Engineering Capacity', label_to: 'Q3 Throughput', strength: 0.65 },
    { label_from: 'Hiring Cost', label_to: 'Q3 Throughput', strength: -0.42 },
  ],
  named_factor_label: undefined,
  named_factor_pathways: [],
  factor_count: 4,
  option_count: 2,
};

const VALID_ANSWER_TEXT =
  'Engineering Capacity is the strongest direct driver of Q3 Throughput at 0.65 strength, well ahead of any other factor influencing your goal.';

describe('explain_from_structure — answer-carrying contract', () => {
  it('happy path: uses Sonnet answer_text when answer_text_valid is true', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({ optionCount: 2 }),
      explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toBe(VALID_ANSWER_TEXT);
    expect(outcome.suppress_orientation).toBe(true);
  });

  it('bare tool_use regression: missing explanation → fallback contains causal links and factor labels', async () => {
    // Reproduces v40 staging Test E shape (factor-named structural question
    // returned the 39-char SAFE_FALLBACK stub).
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({ optionCount: 2 }),
      explanation: undefined,
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).toContain('Q3 Throughput');
    expect(outcome.assistant_text).not.toBe('Here is what the model structure shows.');
  });

  it('answer_text < 80 chars → fallback used', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({ optionCount: 2 }),
      explanation: {
        answer_text: 'Too short.',
        answer_text_valid: false,
        answer_validation_error: 'too_short',
      },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
  });

  it('named factor pathway included when structureProjection has named_factor_label', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({ optionCount: 2 }),
      explanation: undefined,
      structureProjection: {
        ...STRUCTURE_PROJECTION,
        named_factor_label: 'Engineering Capacity',
        named_factor_pathways: [
          {
            label_from: 'Engineering Capacity',
            label_to: 'Q3 Throughput',
            strength: 0.65,
          },
        ],
      },
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).toContain('Q3 Throughput');
  });

  it('persists a fact that round-trips through the schema', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
      structureProjection: STRUCTURE_PROJECTION,
    });
    const parsed = ExplainFromStructureHandlerFactSchema.safeParse(
      outcome.handler_facts[0],
    );
    expect(parsed.success).toBe(true);
  });

  it('always sets suppress_orientation: true on explanation turns', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: undefined,
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.suppress_orientation).toBe(true);
  });
});

describe('explain_from_structure — diagnostic fields', () => {
  it('Sonnet valid → answer_source=sonnet', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
      structureProjection: STRUCTURE_PROJECTION,
    });
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.answer_source).toBe('sonnet');
      expect(fact.result.fallback_reason).toBeNull();
      expect(fact.result.answer_text_length).toBe(VALID_ANSWER_TEXT.length);
    }
  });

  it('fallback (too_short) → answer_source=deterministic_fallback, fallback_reason=too_short', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: {
        answer_text: 'too short',
        answer_text_valid: false,
        answer_validation_error: 'too_short',
      },
      structureProjection: STRUCTURE_PROJECTION,
    });
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.answer_source).toBe('deterministic_fallback');
      expect(fact.result.fallback_reason).toBe('too_short');
      expect(fact.result.answer_text_length).toBe(outcome.assistant_text.length);
    }
  });

  it('explanation absent → answer_source=deterministic_fallback, fallback_reason=missing', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: undefined,
      structureProjection: STRUCTURE_PROJECTION,
    });
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.answer_source).toBe('deterministic_fallback');
      expect(fact.result.fallback_reason).toBe('missing');
    }
  });
});

describe('explain_from_structure — Test A calibration (validator-rejection failure modes)', () => {
  // Brief task 1: pin the deterministic-fallback behaviour for each of the
  // validator-rejection paths Sonnet can land on for a Test-A-shaped pre-
  // analysis question. The schema-description fix raises Sonnet's compliance
  // floor; these tests guarantee the user sees a non-stub response on the
  // residual failure cases.

  it('200-char clean structural answer → uses Sonnet text verbatim (positive control)', async () => {
    const handler = createExplainFromStructureHandler();
    const longClean =
      'Looking at the model structure, Engineering Capacity is the strongest direct driver of Q3 Throughput, with a causal link strength of 0.65. Hiring Cost contributes a secondary pathway at -0.42 strength.';
    expect(longClean.length).toBeGreaterThanOrEqual(200);
    const outcome = await handler({
      ...makeInvocation(),
      explanation: { answer_text: longClean, answer_text_valid: true },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toBe(longClean);
  });

  it('60-char too_short answer → falls back to projection prose with strength values', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: {
        answer_text: 'Engineering Capacity is the most influential factor here.',
        answer_text_valid: false,
        answer_validation_error: 'too_short',
      },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).toContain('0.65');
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
  });

  it('forbidden_internal_term ("edge"/"node") → falls back without leaking internal vocabulary', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: {
        answer_text:
          'The edge from Engineering Capacity to the goal node has strength 1.0, making it the most influential factor.',
        answer_text_valid: false,
        answer_validation_error: 'forbidden_internal_term',
      },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text.toLowerCase()).not.toMatch(/\bedge\b/);
    expect(outcome.assistant_text.toLowerCase()).not.toMatch(/\bnode\b/);
    // New composer phrasing: "direct influence" / "direct link to" rather
    // than the old "direct links" plural.
    expect(outcome.assistant_text).toMatch(/direct (influence|link)/);
  });

  it('mutation_language_detected ("Proposing to add") → falls back with no proposal verbs', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: {
        answer_text:
          "I'd propose adding a Capacity factor to make this clearer; for now Engineering Capacity is the strongest causal driver in the model.",
        answer_text_valid: false,
        answer_validation_error: 'mutation_language_detected',
      },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text.toLowerCase()).not.toContain('proposing');
    expect(outcome.assistant_text.toLowerCase()).not.toContain('would add');
  });

  it('missing explanation payload → falls back to projection prose (matches Test A staging shape)', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: undefined,
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).toContain('Q3 Throughput');
    expect(outcome.assistant_text).toContain('0.65');
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
  });
});
