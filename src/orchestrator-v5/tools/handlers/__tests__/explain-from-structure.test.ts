/**
 * Unit tests for the V5 `explain_from_structure` no-op handler.
 *
 * Covers the registration-level invariants alongside the core behaviours:
 * validator acceptance, validator rejection, fact persistence, and the
 * deterministic structure answer (the authored-explanation input was never
 * fed at runtime and is gone). Includes the decision-node misroute test (D7)
 * and the wire entity-kind enum coverage so the validator's accepted-kinds
 * set stays in sync with the proposal schema.
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
import type { ProposalAction, StructureQuery } from '../../../routing/types.js';
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
      scenarioBriefText: null,
      persistedGraph: null,
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
    proposal: buildProposal({ structure_query: { kind: 'general' } }),
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

  it('declares accepted_entity_kinds = [goal, option, node] in the validation registry', () => {
    const decl = HANDLER_VALIDATION_REGISTRY.explain_from_structure;
    expect(decl).toBeDefined();
    expect(decl?.accepted_entity_kinds).toEqual(['goal', 'option', 'node']);
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

  it('accepts a node-kind proposal (kind=node covers factor/decision/outcome/risk/action — V5 routeability fix)', () => {
    // V5 Chip Routeability Contract lane: factor/decision/outcome/risk/action all
    // collapse to wire-kind 'node'. The handler ignores the entity and
    // explains the whole structure, so a node target is a valid thing to ask
    // it to explain. Previously this returned ENTITY_KIND_MISMATCH and the
    // user saw the generic "I wasn't sure what you meant" dead-end. With graph
    // undefined the graph-resolved kind cross-check is skipped; the widened
    // structural gate alone admits the node proposal.
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
    expect(result.valid).toBe(true);
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
  relationship_detail_status: 'canonical_strict',
  goal_label: 'Q3 Throughput',
  top_causal_links: [
    { label_from: 'Engineering Capacity', label_to: 'Q3 Throughput', edge_type: 'directed', strength: 0.65 },
    { label_from: 'Hiring Cost', label_to: 'Q3 Throughput', edge_type: 'directed', strength: -0.42 },
  ],
  named_factor_label: undefined,
  named_factor_pathways: [],
  factor_count: 4,
  option_count: 2,
};

describe('explain_from_structure — answer contract (deterministic, from the structure projection)', () => {
  // REBOUND (consolidates "a dependencies / outgoing_influence query never uses valid authored prose",
  // "legacy omission cannot let an authored relationship claim bypass typed authority" and "a
  // direct_relationship / reachability query never uses valid authored prose"): the authored answer was
  // never fed at runtime and is gone, so the kind gate's negatives now hold structurally. The live claim
  // kept: every structure_query kind, and none, composes the deterministic projection.
  it('every structure_query kind (and none) composes the deterministic projection answer', async () => {
    const handler = createExplainFromStructureHandler();
    const queries: Array<StructureQuery | undefined> = [
      { kind: 'general' },
      { kind: 'dependencies', element_id: 'node_sales_rep_time' },
      { kind: 'outgoing_influence', element_id: 'node_sales_rep_time' },
      { kind: 'direct_relationship', element_ids: ['node_integration', 'node_flexibility'] },
      {
        kind: 'reachability',
        source_element_id: 'node_integration',
        target_element_id: 'node_flexibility',
      },
      undefined,
    ];
    for (const structure_query of queries) {
      const label = structure_query?.kind ?? 'none';
      const outcome = await handler({
        ...makeInvocation({ optionCount: 4, proposal: buildProposal({ structure_query }) }),
        structureProjection: STRUCTURE_PROJECTION,
      });
      expect(outcome.assistant_text, label).toContain('Engineering Capacity');
      expect(outcome.assistant_text, label).toContain('Q3 Throughput');
      expect(outcome.handler_facts[0], label).toMatchObject({
        result: { answer_source: 'deterministic_fallback', fallback_reason: 'missing' },
      });
    }
  });

  it('bare tool_use regression: fallback contains causal links and factor labels', async () => {
    // Reproduces v40 staging Test E shape (factor-named structural question
    // returned the 39-char SAFE_FALLBACK stub).
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({ optionCount: 2 }),
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).toContain('Q3 Throughput');
    expect(outcome.assistant_text).not.toBe('Here is what the model structure shows.');
  });

  it('named factor pathway included when structureProjection has named_factor_label', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({ optionCount: 2 }),
      structureProjection: {
        ...STRUCTURE_PROJECTION,
        named_factor_label: 'Engineering Capacity',
        named_factor_pathways: [
          {
            label_from: 'Engineering Capacity',
            label_to: 'Q3 Throughput',
            edge_type: 'directed',
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
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.suppress_orientation).toBe(true);
  });
});

describe('explain_from_structure — diagnostic fields', () => {
  it('answer_source=deterministic_fallback, fallback_reason=missing, length matches text', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.handler_facts[0]).toMatchObject({
      fact_type: 'explain_from_structure',
      result: {
        answer_source: 'deterministic_fallback',
        fallback_reason: 'missing',
        answer_text_length: outcome.assistant_text.length,
      },
    });
  });
});

describe('explain_from_structure — Test A calibration (deterministic projection prose)', () => {
  // Pins the deterministic answer for a Test-A-shaped pre-analysis question:
  // non-stub, bucketed strength words, no internal vocabulary, no proposal
  // verbs. (The rows that fed a rejected authored answer first went with the
  // never-fed explanation path; their assertions on the projection prose are
  // kept here.)

  // REBOUND (was "forbidden_internal_term → falls back without leaking internal vocabulary").
  it('projection prose never says "edge" or "node"', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text.toLowerCase()).not.toMatch(/\bedge\b/);
    expect(outcome.assistant_text.toLowerCase()).not.toMatch(/\bnode\b/);
    // New composer phrasing: "direct influence" / "direct link to" rather
    // than the old "direct links" plural.
    expect(outcome.assistant_text).toMatch(/direct (influence|link)/);
  });

  // REBOUND (was "mutation_language_detected → falls back with no proposal verbs").
  it('projection prose carries no proposal verbs', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text.toLowerCase()).not.toContain('proposing');
    expect(outcome.assistant_text.toLowerCase()).not.toContain('would add');
  });

  it('projection prose renders strength as bucketed words, no raw decimals (matches Test A staging shape)', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).toContain('Q3 Throughput');
    // Wave 4: edge strength rendered as bucketed magnitude word.
    expect(outcome.assistant_text).toMatch(/(weak|moderate|strong|very strong) (direct )?link/);
    expect(outcome.assistant_text).not.toMatch(/-?\d+\.\d/);
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
  });
});
