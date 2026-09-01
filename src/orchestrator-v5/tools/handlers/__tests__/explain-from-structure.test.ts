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
import {
  composeSelectedDependenciesEvidenceAnswer,
  composeStructuralPairEvidenceAnswer,
} from '../explanation-fallback.js';
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

  it('selected canonical neighbourhood outranks valid prose that invents an unlisted relationship', async () => {
    const handler = createExplainFromStructureHandler();
    const invented =
      'Sales rep time depends on automation, and the phased pilot directly feeds into automation before it reaches the outcome.';
    const outcome = await handler({
      ...makeInvocation({ optionCount: 4 }),
      explanation: { answer_text: invented, answer_text_valid: true },
      selectedDependenciesEvidence: {
        status: 'resolved',
        selected_label: 'Sales rep time on selling activities',
        dependencies: [
          {
            from_label: 'Sales process automation level',
            to_label: 'Sales rep time on selling activities',
            edge_type: 'directed',
            relationship: 'moderate positive link',
          },
          {
            from_label: 'CRM adoption and usability',
            to_label: 'Sales rep time on selling activities',
            edge_type: 'directed',
            relationship: 'moderate positive link',
          },
        ],
        bidirected: [],
      },
    });

    expect(outcome.assistant_text).toContain(
      'from Sales process automation level to Sales rep time on selling activities',
    );
    expect(outcome.assistant_text).toContain(
      'from CRM adoption and usability to Sales rep time on selling activities',
    );
    expect(outcome.assistant_text).not.toContain('phased pilot');
    expect(outcome.assistant_text).not.toBe(invented);
    expect(outcome.handler_facts[0]).toMatchObject({
      result: { answer_source: 'deterministic_fallback', fallback_reason: null },
    });
  });

  it('renders zero incoming coverage narrowly and keeps bidirected associations non-causal', async () => {
    const handler = createExplainFromStructureHandler();
    const none = await handler({
      ...makeInvocation(),
      selectedDependenciesEvidence: {
        status: 'resolved',
        selected_label: 'Sales rep time on selling activities',
        dependencies: [],
        bidirected: [],
      },
    });
    expect(none.assistant_text).toContain('no direct incoming dependency');
    expect(none.assistant_text).toContain('does not prove');

    const bidirected = await handler({
      ...makeInvocation(),
      selectedDependenciesEvidence: {
        status: 'resolved',
        selected_label: 'Sales rep time on selling activities',
        dependencies: [],
        bidirected: [{
          from_label: 'Ramp and disruption time',
          to_label: 'Sales rep time on selling activities',
          edge_type: 'bidirected',
          relationship: 'moderate co-movement',
        }],
      },
    });
    expect(bidirected.assistant_text).toContain('is bidirected');
    expect(bidirected.assistant_text).toContain('does not license causal influence');
    expect(bidirected.assistant_text).not.toContain('direct, directed connector');
  });

  // PR #1229 review guard (4), at the surface the user actually reads.
  it('does not tell a user with one resolved selected element to name or select one', async () => {
    const handler = createExplainFromStructureHandler();
    const marked = await handler({
      ...makeInvocation(),
      selectedDependenciesEvidence: {
        status: 'ambiguous', subject_selection: 'single_resolved',
      },
    });
    expect(marked.assistant_text.toLowerCase()).not.toContain('name it, or select it');
    expect(marked.assistant_text).toContain('will not guess at what connects to it');
    // In-suite CONTRAST: the unmarked verdict still carries the instruction.
    const unmarked = await handler({
      ...makeInvocation(),
      selectedDependenciesEvidence: { status: 'ambiguous' },
    });
    expect(unmarked.assistant_text).toContain('name it, or select it on the canvas');
  });

  it('selected neighbourhood ambiguity and unavailable coverage fail weak instead of restoring authored prose', async () => {
    const handler = createExplainFromStructureHandler();
    const authored =
      'The selected item definitely has a direct relationship from the phased pilot and no other inputs.';
    const ambiguous = await handler({
      ...makeInvocation(),
      explanation: { answer_text: authored, answer_text_valid: true },
      selectedDependenciesEvidence: { status: 'ambiguous' },
    });
    expect(ambiguous.assistant_text).toContain('will not guess at what connects to it');
    expect(ambiguous.assistant_text).not.toBe(authored);

    const unavailable = await handler({
      ...makeInvocation(),
      explanation: { answer_text: authored, answer_text_valid: true },
      selectedDependenciesEvidence: {
        status: 'coverage_unavailable',
        reason: 'graph_coverage_unavailable',
      },
    });
    expect(unavailable.assistant_text).toContain('was withheld from this turn');
    expect(unavailable.assistant_text).not.toContain('phased pilot');

    const structural = await handler({
      ...makeInvocation(),
      explanation: { answer_text: authored, answer_text_valid: true },
      selectedDependenciesEvidence: {
        status: 'coverage_unavailable',
        reason: 'structural_semantics_unlicensed',
      },
    });
    expect(structural.assistant_text).toContain('structural connector');
    expect(structural.assistant_text).toContain('cannot safely treat');
    expect(structural.assistant_text).not.toContain('was withheld');
    expect(structural.assistant_text).not.toContain('phased pilot');
  });

  it('legacy omission cannot let an authored relationship claim bypass typed authority', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation({
        optionCount: 2,
        proposal: buildProposal({ structure_query: undefined }),
      }),
      explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
      structureProjection: STRUCTURE_PROJECTION,
    });

    expect(outcome.assistant_text).not.toBe(VALID_ANSWER_TEXT);
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.handler_facts[0]).toMatchObject({
      result: {
        answer_source: 'deterministic_fallback',
        fallback_reason: 'missing',
      },
    });
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

  it('canonical pair evidence outranks a form-valid Sonnet answer that invents a path', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: {
        answer_text:
          'Enterprise Integration Investment reaches Preserve Strategic Flexibility through Enterprise Revenue Expansion, so the saved model establishes a two-step path between them.',
        answer_text_valid: true,
      },
      structureProjection: STRUCTURE_PROJECTION,
      structuralPairEvidence: {
        status: 'no_direct',
        first_label: 'Enterprise Integration Investment',
        second_label: 'Preserve Strategic Flexibility',
      },
    });
    expect(outcome.assistant_text).toContain('lists no direct connector');
    expect(outcome.assistant_text).toContain(
      'does not decide the separate reachability question',
    );
    expect(outcome.assistant_text).not.toContain('Enterprise Revenue Expansion');
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.answer_source).toBe('deterministic_fallback');
      expect(fact.result.fallback_reason).toBeNull();
    }
  });

  it('canonical pair evidence also outranks the direction-erasing generic fallback', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: {
        answer_text: 'The edge wording is rejected before it can reach the user.',
        answer_text_valid: false,
        answer_validation_error: 'forbidden_internal_term',
      },
      structureProjection: {
        ...STRUCTURE_PROJECTION,
        named_factor_label: 'Enterprise Integration Investment',
        named_factor_pathways: [
          {
            label_from: 'Enterprise Integrations',
            label_to: 'Enterprise Integration Investment',
            edge_type: 'directed',
            strength: 1,
          },
        ],
      },
      structuralPairEvidence: {
        status: 'direct',
        first_label: 'Enterprise Revenue Expansion',
        second_label: 'Enterprise Integration Investment',
        coverage: 'complete',
        relationships: [
          {
            from_label: 'Enterprise Integration Investment',
            to_label: 'Enterprise Revenue Expansion',
            edge_type: 'directed',
            relationship: 'moderate positive link',
            coefficient_confidence: 'moderate',
          },
        ],
      },
    });
    expect(outcome.assistant_text).toContain(
      'from Enterprise Integration Investment to Enterprise Revenue Expansion, not the reverse',
    );
    expect(outcome.assistant_text).not.toContain('Enterprise Integrations');
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
    // Wave 4: edge strength rendered as bucketed magnitude word, not
    // a raw decimal. 0.65 → "very strong link".
    expect(outcome.assistant_text).toMatch(/(weak|moderate|strong|very strong) (direct )?link/);
    expect(outcome.assistant_text).not.toMatch(/-?\d+\.\d/);
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
    // Wave 4: edge strength rendered as bucketed magnitude word.
    expect(outcome.assistant_text).toMatch(/(weak|moderate|strong|very strong) (direct )?link/);
    expect(outcome.assistant_text).not.toMatch(/-?\d+\.\d/);
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
  });
});

/**
 * ⭐⭐⭐ THE REFUSAL WAS RIGHT AND ITS WORDS WERE NOT — captured 1 Sep 2026,
 * deployed staging, turn 4 of four.
 *
 *   USER "You only have one factor… explain why you produced this model."
 *   CEE  "I cannot establish one unique Living Model element and matching
 *         dependency question, so I will not guess its relationships. Name or
 *         select one element and ask again."
 *
 * ⚠⚠ A CORRECTED PREMISE, MEASURED RATHER THAN ARGUED. The change this lane was
 * briefed to make — exclude `status === 'ambiguous'` from the handler's evidence
 * gate so the non-verdict stops displacing the deterministic projection — was
 * IMPLEMENTED AND RUN. It turns an honest refusal into a CONFIDENT ANSWER TO A
 * DIFFERENT QUESTION, and four route-level guards in
 * `../../../__tests__/b2-bounded-answer-routing.integration.test.ts` go RED on it:
 *
 *   · does not let another existing canonical object replace the object
 *     explicitly named in the dependency question
 *   · does not let a query/entity identity disagreement replace the object
 *     explicitly named in the dependency question
 *   · does not treat a valid dependency proposal as a referent for an unselected
 *     deictic question
 *   · fails weak when the selected identity conflicts with the model-typed
 *     dependency subject
 *
 * In every one the user named or selected a SPECIFIC element, the identity could
 * not be established, and the projection then described whatever relationships it
 * could see — e.g. *"Replace CRM has the strongest visible direct influence on
 * Sales Rep Adoption Rate…"* in answer to *"What does 'Reach 1,500 paid teams'
 * depend on?"*. That is the inverse defect and the worse one, because it is
 * confident. The verdict therefore stays authoritative and only the WORDS change.
 *
 * ⚠ SO TURN 4 IS NOT FIXED BY THIS COMMIT, and its root cause is named rather
 * than papered over: the router proposed `structure_query.kind: 'dependencies'`
 * for a whole-model question whose correct kind is `general`. A `general` query
 * produces no dependency evidence at all — derived over the whole StructureQuery
 * union in `routing/__tests__/structural-pair-evidence.test.ts` — so with the
 * right kind the user would have received the structural explanation they asked
 * for. That is a ROUTER change, with its own corpus and its own blast radius.
 */
describe('explain_from_structure — the ambiguous refusal speaks the user’s language', () => {
  /** OUR words for OUR data structures. None may reach a user. */
  const INTERNAL_VOCABULARY = [
    'Living Model element',
    'dependency question',
    'subject_selection',
    'coverage_unavailable',
    'structure_query',
  ];

  it('⭐ THE CAPTURED COPY: neither ambiguous flavour leaks internal vocabulary', async () => {
    const handler = createExplainFromStructureHandler();
    for (const evidence of [
      { status: 'ambiguous' } as const,
      { status: 'ambiguous', subject_selection: 'single_resolved' } as const,
    ]) {
      const outcome = await handler({
        ...makeInvocation(),
        selectedDependenciesEvidence: evidence,
        structureProjection: STRUCTURE_PROJECTION,
      });
      for (const phrase of INTERNAL_VOCABULARY) {
        expect(
          outcome.assistant_text,
          `internal vocabulary reached the user (${evidence.subject_selection ?? 'unmarked'}): ${phrase}`,
        ).not.toContain(phrase);
      }
      // POSITIVE CONTROL for the probe: the copy IS the ambiguous copy, so the
      // absences above are about a string that exists rather than about silence.
      expect(outcome.assistant_text).toContain('will not guess at what connects to it');
    }
  });

  it('⭐ THE OPPOSITE DIRECTION: the refusal still REFUSES — it names no relationship', async () => {
    // The whole reason the verdict was left authoritative. A refusal that
    // started describing the model would be the inverse defect.
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
      selectedDependenciesEvidence: { status: 'ambiguous' },
      structureProjection: STRUCTURE_PROJECTION,
    });
    expect(outcome.assistant_text).not.toContain('Engineering Capacity');
    expect(outcome.assistant_text).not.toContain('Q3 Throughput');
    expect(outcome.assistant_text).not.toBe(VALID_ANSWER_TEXT);
    expect(outcome.handler_facts[0]).toMatchObject({
      result: { answer_source: 'deterministic_fallback', fallback_reason: null },
    });
  });

  it('⭐ THE OPPOSITE DIRECTION: an ANSWERING verdict still answers, in full', async () => {
    // CONTRAST CONTROL for the two cases above: `resolved` and
    // `coverage_unavailable` are untouched, so the copy change cannot have been
    // a blanket silencing of this composer.
    const handler = createExplainFromStructureHandler();
    const resolved = await handler({
      ...makeInvocation(),
      selectedDependenciesEvidence: {
        status: 'resolved',
        selected_label: 'Sales rep time on selling activities',
        dependencies: [],
        bidirected: [],
      },
    });
    expect(resolved.assistant_text).toContain('no direct incoming dependency');
    const withheld = await handler({
      ...makeInvocation(),
      selectedDependenciesEvidence: {
        status: 'coverage_unavailable', reason: 'graph_coverage_unavailable',
      },
    });
    expect(withheld.assistant_text).toContain('was withheld from this turn');
  });

  it('⚠ THE SIBLING PATH IS NOT FIXED, AND THE SUITE SAYS SO RATHER THAN HIDING IT', () => {
    // Trap 22f's honest-gap protocol: a gap recorded in the suite is honest; a
    // gap invisible to it is how the next session inherits a false "all clear".
    // `composeStructuralPairEvidenceAnswer` still leaks the same vocabulary on
    // `direct_relationship` / `reachability` queries. When it is fixed, this
    // case REDs and is replaced by its positive twin.
    expect(composeStructuralPairEvidenceAnswer({ status: 'ambiguous' }))
      .toContain('two unique Living Model elements');
    // And the composer this commit DID fix no longer does — the discrimination
    // that makes the line above a record of a real gap, not of a blind probe.
    expect(composeSelectedDependenciesEvidenceAnswer({ status: 'ambiguous' }))
      .not.toContain('Living Model element');
  });
});
