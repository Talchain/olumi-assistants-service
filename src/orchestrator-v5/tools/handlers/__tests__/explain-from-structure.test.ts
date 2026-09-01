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
  //
  // ⚠ AMENDED 1 Sep 2026. This test previously asserted that the UNMARKED
  // ambiguous verdict still reached the user carrying "Name or select one
  // element" — i.e. it PINNED the witnessed defect in place. Neither ambiguous
  // shape reaches the user now; the guard's real property (never tell a user to
  // do what they have already done) holds a fortiori, and is asserted for both.
  // The DISCRIMINATING contrast between the two copies still lives at the
  // composer level, in explanation-fallback.test.ts ("never asks a user with one
  // resolved selected element to name or select one"), where the branches remain
  // as defence-in-depth — so removing it here does not leave a test that cannot
  // tell the two verdicts apart.
  it('never tells any user with an ambiguous dependency verdict to name or select an element', async () => {
    const handler = createExplainFromStructureHandler();
    for (const evidence of [
      { status: 'ambiguous' } as const,
      { status: 'ambiguous', subject_selection: 'single_resolved' } as const,
    ]) {
      const outcome = await handler({
        ...makeInvocation(),
        structureProjection: STRUCTURE_PROJECTION,
        selectedDependenciesEvidence: evidence,
      });
      expect(outcome.assistant_text.toLowerCase()).not.toContain('select one element');
      expect(outcome.assistant_text).not.toContain('will not guess its relationships');
      // Positive control: the fall-through is a real grounded answer, bound by
      // identity to the projection's own labels — not an empty string that
      // would satisfy every negative assertion above.
      expect(outcome.assistant_text).toContain('Engineering Capacity');
      expect(outcome.assistant_text).toContain('Q3 Throughput');
    }
  });

  it('selected neighbourhood ambiguity and unavailable coverage fail weak instead of restoring authored prose', async () => {
    const handler = createExplainFromStructureHandler();
    const authored =
      'The selected item definitely has a direct relationship from the phased pilot and no other inputs.';
    // ⚠ HOSTILE FIXTURE — the opposite-direction twin of the ambiguous
    // fall-through. `makeInvocation` defaults `structure_query.kind` to
    // 'general', a pairing production cannot produce (an ambiguous verdict only
    // ever accompanies kind 'dependencies'), which is exactly why it is kept:
    // it proves the handler refuses authored prose on an ambiguous verdict on
    // its OWN authority, not by borrowing an invariant from
    // buildSelectedDependenciesEvidence. Deleting the `!ambiguous` conjunct
    // from `useSonnetAnswer` restores the invented "phased pilot" dependency
    // here verbatim.
    const ambiguous = await handler({
      ...makeInvocation(),
      structureProjection: STRUCTURE_PROJECTION,
      explanation: { answer_text: authored, answer_text_valid: true },
      selectedDependenciesEvidence: { status: 'ambiguous' },
    });
    expect(ambiguous.assistant_text).not.toContain('phased pilot');
    expect(ambiguous.assistant_text).not.toBe(authored);
    // …and the fall-through is the grounded projection, bound by identity.
    expect(ambiguous.assistant_text).toContain('Engineering Capacity');

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
 * WITNESSED FAILURE, deployed build, fresh guest session (1 Sep 2026).
 *
 * A falsifier asked, in plain chat, "why do you think investor fit matters
 * here?" against a GOOD drafted model. The router classified
 * `structure_query.kind = 'dependencies'`,
 * `buildSelectedDependenciesEvidence` could not tie the question to exactly
 * one element and returned `{status:'ambiguous'}`, and the handler's gate —
 * which tested PRESENCE of the evidence, not its VERDICT — let that
 * non-verdict outrank every other answer the turn could give. The user got:
 *
 *   "I cannot establish one unique Living Model element and matching
 *    dependency question, so I will not guess its relationships."
 *
 * An ambiguous verdict is the topology authority DECLINING TO SPEAK. It
 * carries no structural fact, so it may not silence the grounded structural
 * explanation. A CONCLUSIVE verdict — `resolved`, or either
 * `coverage_unavailable` reason — still outranks free prose; that gate exists
 * because authored prose invented an unlisted option-to-factor dependency,
 * and nothing here relaxes it.
 */
describe('explain_from_structure — an ambiguous dependency verdict must not outrank the structural answer', () => {
  const WITNESSED_LABEL = 'Fit with target investor thesis and deal size';
  const WITNESSED_GOAL = 'Secure the round on acceptable terms';
  /** Named-factor projection whose only recorded connector is OUTGOING — the
   *  exact canvas shape the falsifier saw beside the refusal. */
  const WITNESSED_PROJECTION: StructureProjectionSummary = {
    relationship_detail_status: 'canonical_strict',
    goal_label: WITNESSED_GOAL,
    top_causal_links: [
      { label_from: WITNESSED_LABEL, label_to: WITNESSED_GOAL, edge_type: 'directed', strength: 0.62 },
    ],
    named_factor_label: WITNESSED_LABEL,
    named_factor_pathways: [
      { label_from: WITNESSED_LABEL, label_to: WITNESSED_GOAL, edge_type: 'directed', strength: 0.62 },
    ],
    factor_count: 5,
    option_count: 3,
  };
  /** The two inhabitants of the `ambiguous` arm of SelectedDependenciesEvidence. */
  const AMBIGUOUS_SHAPES = [
    ['bare', { status: 'ambiguous' } as const],
    ['single_resolved-marked', { status: 'ambiguous', subject_selection: 'single_resolved' } as const],
  ] as const;

  // ── TWIN 1 (the fix direction) ─────────────────────────────────────────
  it.each(AMBIGUOUS_SHAPES)(
    'falls through to the grounded structural answer on an ambiguous verdict (%s)',
    async (_shape, evidence) => {
      const handler = createExplainFromStructureHandler();
      const outcome = await handler({
        ...makeInvocation(),
        structureProjection: WITNESSED_PROJECTION,
        selectedDependenciesEvidence: evidence,
      });

      // The witnessed refusal, bound by its exact emitted sentence.
      expect(outcome.assistant_text).not.toContain(
        'I cannot establish one unique Living Model element and matching dependency question',
      );
      expect(outcome.assistant_text).not.toContain(
        'I cannot tie this dependency question to exactly one element',
      );
      // …replaced by the answer the question actually asked for: what this
      // element DRIVES. Bound by IDENTITY — the exact factor and goal labels,
      // in the exact direction, not by "is it long enough".
      expect(outcome.assistant_text).toContain(
        `Its strongest direct influence runs from ${WITNESSED_LABEL} to ${WITNESSED_GOAL}`,
      );
      expect(outcome.assistant_text).toContain(`${WITNESSED_LABEL} is connected to other elements`);
    },
  );

  it('reports the ambiguous fall-through as a deterministic fallback, not a suppressed answer', async () => {
    const handler = createExplainFromStructureHandler();
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: WITNESSED_PROJECTION,
      selectedDependenciesEvidence: { status: 'ambiguous' },
    });
    expect(outcome.handler_facts[0]).toMatchObject({
      result: { answer_source: 'deterministic_fallback' },
    });
  });

  // Part C — the refusal copy carries schema vocabulary ("dependency
  // question") that the served prompt's Rule 4 forbids, and a prompt cannot
  // govern a hardcoded string. After the gate fix no ambiguous verdict can
  // reach it through the handler, which is the only production consumer of
  // composeSelectedDependenciesEvidenceAnswer.
  it.each(AMBIGUOUS_SHAPES)(
    'never emits schema vocabulary to the user on an ambiguous verdict (%s)',
    async (_shape, evidence) => {
      const handler = createExplainFromStructureHandler();
      const outcome = await handler({
        ...makeInvocation(),
        structureProjection: WITNESSED_PROJECTION,
        selectedDependenciesEvidence: evidence,
      });
      expect(outcome.assistant_text).not.toMatch(/dependency question/i);
      expect(outcome.assistant_text).not.toMatch(/will not guess its relationships/i);
    },
  );

  // ── TWIN 1b (the OTHER direction of the SAME change) ───────────────────
  // Falling through must not become a licence for the model to speak freely
  // about the structure it was just declined on. Faithful to the wire: an
  // ambiguous verdict only ever accompanies `kind: 'dependencies'`, because
  // buildSelectedDependenciesEvidence returns null for every other kind.
  it('an ambiguous verdict falls through to the projection, never to authored prose', async () => {
    const handler = createExplainFromStructureHandler();
    const invented =
      `${WITNESSED_LABEL} is driven by the phased pilot, which feeds it before it reaches the outcome.`;
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: WITNESSED_PROJECTION,
      explanation: { answer_text: invented, answer_text_valid: true },
      proposal: buildProposal({
        structure_query: { kind: 'dependencies', element_id: GOAL_ID },
      }),
      selectedDependenciesEvidence: { status: 'ambiguous' },
    });
    expect(outcome.assistant_text).not.toContain('phased pilot');
    expect(outcome.assistant_text).not.toBe(invented);
    expect(outcome.assistant_text).toContain(
      `Its strongest direct influence runs from ${WITNESSED_LABEL} to ${WITNESSED_GOAL}`,
    );
    expect(outcome.handler_facts[0]).toMatchObject({
      result: { answer_source: 'deterministic_fallback' },
    });
  });

  // ── TWIN 2 (the OPPOSITE direction — the harm the gate exists to stop) ──
  // These are GREEN at pristine and MUST STAY GREEN. Their proof of
  // discrimination is the mutant pair: an over-wide fix that stops consulting
  // structural evidence (or that also excludes a conclusive verdict) turns
  // them RED while Twin 1 stays GREEN. Neither twin alone shows binding.
  it('a CONCLUSIVE resolved verdict still outranks valid prose that invents an unlisted dependency', async () => {
    const handler = createExplainFromStructureHandler();
    const invented =
      `${WITNESSED_LABEL} is driven by the phased pilot, which feeds it before it reaches the outcome.`;
    const outcome = await handler({
      ...makeInvocation(),
      structureProjection: WITNESSED_PROJECTION,
      explanation: { answer_text: invented, answer_text_valid: true },
      proposal: buildProposal({ structure_query: { kind: 'general' } }),
      selectedDependenciesEvidence: {
        status: 'resolved',
        selected_label: WITNESSED_LABEL,
        dependencies: [
          {
            from_label: 'Traction and revenue quality',
            to_label: WITNESSED_LABEL,
            edge_type: 'directed',
            relationship: 'moderate positive link',
          },
        ],
        bidirected: [],
      },
    });
    // Binds by IDENTITY to the canonical dependency, not to a length or a
    // "contains something" predicate another answer could satisfy.
    expect(outcome.assistant_text).toContain(
      `from Traction and revenue quality to ${WITNESSED_LABEL}`,
    );
    expect(outcome.assistant_text).not.toContain('phased pilot');
    expect(outcome.assistant_text).not.toBe(invented);
  });

  it.each([
    ['graph_coverage_unavailable', 'was withheld from this turn'],
    ['structural_semantics_unlicensed', 'cannot safely treat'],
  ] as const)(
    'a CONCLUSIVE coverage_unavailable verdict (%s) still outranks valid prose',
    async (reason, marker) => {
      const handler = createExplainFromStructureHandler();
      const invented =
        `${WITNESSED_LABEL} is driven by the phased pilot and no other inputs.`;
      const outcome = await handler({
        ...makeInvocation(),
        structureProjection: WITNESSED_PROJECTION,
        explanation: { answer_text: invented, answer_text_valid: true },
        proposal: buildProposal({ structure_query: { kind: 'general' } }),
        selectedDependenciesEvidence: { status: 'coverage_unavailable', reason },
      });
      expect(outcome.assistant_text).toContain(marker);
      expect(outcome.assistant_text).not.toContain('phased pilot');
      expect(outcome.assistant_text).not.toBe(invented);
    },
  );
});
