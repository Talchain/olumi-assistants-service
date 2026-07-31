/**
 * Capability layer P1 — the structured lens COMPANION block, end to end.
 *
 * WHAT THIS PINS. `compose.ts::rebuildPhase3BlocksFresh` now attaches a
 * structured artefact beside the P0 lens suggestion, for the lens `selectLens`
 * actually chose. This file drives the whole funnel through
 * `composeToolCallResponse` + `OlumiResponseSchema.parse`, so every assertion is
 * about what reaches THE WIRE, not about a builder in isolation.
 *
 * THE FOUR ARMS (build brief §3):
 *   1. ARRIVES  — fresh turn, pre_mortem lens ⇒ an `exercise` block on the wire,
 *                 with content BYTE-IDENTICAL to the producer's own strings.
 *   2. STALE    — the stale lifecycle branch ⇒ no companion.
 *   3. WRONG LENS — a fixture whose flip-risk lens outranks pre_mortem ⇒ no
 *                 companion, from the SAME decision_review prose.
 *   4. WITHHELD — an unlicensed claim verdict ⇒ no companion (and no leaked
 *                 designation), while the licensed twin proves the fixture can
 *                 produce one.
 *
 * EVERY ABSENCE ASSERTION IS PAIRED WITH A PRESENCE (CLAUDE.md trap 13). Arms
 * 2/3/4 each vary exactly ONE input away from a fixture proven in arm 1 to emit
 * the block — so "absent" can never pass because the harness stopped working.
 * `expectedCompanionInputsPresent()` is the shared guard: it asserts the
 * PRODUCER prose the block is built from is present in the fixture, so a fixture
 * edit that silently removes the content fails loudly rather than turning every
 * absence assertion vacuous.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../../compose.js';
import type { FreshnessDerivation } from '../../context/freshness.js';
import { log } from '../../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRAPH_HASH = 'gh_capability_p1_0001';
const DIVERGED_GRAPH_HASH = 'gh_capability_p1_diverged';

const FACTOR_DELIVERY = { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' };
const FACTOR_COST = { id: 'fac_cost_overrun', label: 'Cost overrun', kind: 'factor' };

/**
 * The producer's own pre-mortem object. These EXACT strings are what the wire
 * must carry — the assertions below compare against these constants, never
 * against a literal retyped in the expectation (a literal that happens to match
 * proves nothing about provenance).
 *
 * `failure_scenario` names a graph node ("Delivery risk") so `buildPreMortemCard`
 * clears its own ANCHOR rule; the exercise inherits that card's survival.
 */
const PRODUCER_PRE_MORTEM = {
  failure_scenario:
    'Delivery risk was underestimated and the rollout slipped past the window the team had planned for.',
  warning_signs: [
    'Sprint burndown flattens for two consecutive weeks.',
    'The integration partner stops answering scheduling requests.',
  ],
  mitigation: 'Book a mid-point checkpoint with the integration partner before committing budget.',
  review_trigger: 'Reconvene if the integration partner misses the checkpoint.',
  grounded_in: ['fac_delivery_risk'],
} as const;

const DECISION_REVIEW: Record<string, unknown> = {
  narrative_summary: 'The two plans are close together on the evidence available.',
  story_headlines: {},
  robustness_explanation: { summary: 'Mixed.', primary_risk: null },
  readiness_rationale: 'Usable but not solid.',
  evidence_enhancements: {},
  scenario_contexts: {},
  flip_thresholds: [],
  bias_findings: [],
  key_assumptions: [],
  decision_quality_prompts: [],
  pre_mortem: PRODUCER_PRE_MORTEM,
  produced_at: '2026-07-31T09:00:00.000Z',
};

interface FactOptions {
  /** `false` ⇒ the withheld claim arm. */
  readonly mayNameLeadingOption?: boolean;
  /** Overrides `decision_review` wholesale. */
  readonly decisionReview?: Record<string, unknown>;
  /**
   * `true` ⇒ give one factor an `isolated` flip-risk category, which makes
   * `selectLens` pick `sensitivity_flip_risk` (rule 1a, highest priority) and so
   * NOT `pre_mortem`. The decision_review prose is untouched — the lens choice
   * is the only thing that varies.
   */
  readonly flipRiskIsolated?: boolean;
  readonly graphHash?: string;
}

/**
 * A run_analysis fact whose enrichment drives `selectLens` to `pre_mortem`
 * (rationale CONFIDENCE_NEEDS_WORK) unless `flipRiskIsolated` is set.
 *
 * Lens-priority arithmetic, stated so a fixture edit cannot silently move it:
 *   - rule 1a: no `flip_risk_category` on any factor ⇒ no hit.
 *   - rule 1b: two factors with EQUAL influence_score ⇒ share 0.5, and the
 *     dominance test is STRICT `> 0.5` ⇒ no hit.
 *   - rule 2a: `confidence_tier: 'needs_work'` ⇒ HIT ⇒ lens `pre_mortem`.
 */
function makeFact(options: FactOptions = {}): RunAnalysisHandlerFact {
  const {
    mayNameLeadingOption = true,
    decisionReview = DECISION_REVIEW,
    flipRiskIsolated = false,
    graphHash = GRAPH_HASH,
  } = options;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      win_probabilities: { opt_a: 0.55, opt_b: 0.45 },
      graph_hash_at_run: graphHash,
      computed_at: '2026-07-31T08:59:00.000Z',
      enrichment: {
        graph: { nodes: [FACTOR_DELIVERY, FACTOR_COST] },
        confidence_tier: 'needs_work',
        factor_sensitivity: [
          {
            factor_id: 'fac_delivery_risk',
            influence_score: 0.5,
            influence_rank: 1,
            confidence: 0.5,
            ...(flipRiskIsolated ? { flip_risk_category: 'isolated' } : {}),
          },
          {
            factor_id: 'fac_cost_overrun',
            influence_score: 0.5,
            influence_rank: 2,
            confidence: 0.5,
          },
        ],
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.55 },
          { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.45 },
        ],
        decision_review: decisionReview,
        __cee_claim_safety: {
          may_name_leading_option: mayNameLeadingOption,
          constraint_verdict_state: mayNameLeadingOption
            ? 'evaluated_feasible'
            : 'evaluated_infeasible',
        },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

const BASE_INPUT = {
  answerKind: 'functional' as const,
  orientation: 'Running the analysis.',
  confirmation: 'Ran analysis on your current scenario.',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

interface ExerciseOnWire {
  readonly type: 'exercise';
  readonly exercise_kind: string;
  readonly warning_signs?: readonly string[];
  readonly mitigation?: string;
  readonly review_trigger?: string;
  readonly failure_scenario?: string;
  readonly freshness: string;
  readonly graph_hash_at_generation?: string;
  readonly signal_id: string;
  readonly target_refs: ReadonlyArray<{ id: string; label: string; kind: string }>;
}

function composeCurrentTurn(fact: HandlerFact): ReturnType<typeof OlumiResponseSchema.parse> {
  return OlumiResponseSchema.parse(
    composeToolCallResponse({ ...BASE_INPUT, handlerFacts: [fact] }),
  );
}

function exercisesOf(
  response: ReturnType<typeof OlumiResponseSchema.parse>,
): readonly ExerciseOnWire[] {
  return response.blocks.filter(
    (b): b is typeof b & ExerciseOnWire => b.type === 'exercise',
  ) as unknown as readonly ExerciseOnWire[];
}

/**
 * The shared non-vacuity guard. Asserts the fixture still carries the producer
 * content the companion is BUILT FROM, so an "absent" assertion downstream is
 * about the gate under test and never about an emptied fixture.
 */
function expectedCompanionInputsPresent(dr: Record<string, unknown>): void {
  const pm = dr.pre_mortem as Record<string, unknown> | undefined;
  expect(pm, 'fixture must carry decision_review.pre_mortem').toBeDefined();
  expect(Array.isArray(pm?.warning_signs) && (pm.warning_signs as unknown[]).length).toBeGreaterThan(0);
  expect(typeof pm?.mitigation === 'string' && (pm.mitigation as string).length).toBeGreaterThan(0);
}

// ===========================================================================
// ARM 1 — the block ARRIVES, and its content is the producer's
// ===========================================================================

describe('capability P1 — pre_mortem lens companion ARRIVES on the wire', () => {
  it('emits exactly one exercise block on a fresh, licensed analysis turn', () => {
    expectedCompanionInputsPresent(DECISION_REVIEW);
    const exercises = exercisesOf(composeCurrentTurn(makeFact()));
    expect(exercises).toHaveLength(1);
    expect(exercises[0]!.exercise_kind).toBe('pre_mortem');
  });

  it('carries the PRODUCER strings verbatim — no CEE-authored copy, no numbers', () => {
    const block = exercisesOf(composeCurrentTurn(makeFact()))[0]!;

    // Compared against the fixture CONSTANT, not a retyped literal: this is a
    // provenance assertion, not a spelling one.
    expect(block.warning_signs).toEqual([...PRODUCER_PRE_MORTEM.warning_signs]);
    expect(block.mitigation).toBe(PRODUCER_PRE_MORTEM.mitigation);
    expect(block.review_trigger).toBe(PRODUCER_PRE_MORTEM.review_trigger);

    // ANTI-FABRICATION. Every user-facing string on this block must be a
    // substring-identical member of the producer's own object. A builder that
    // synthesised, templated or interpolated ANY prose fails here.
    const producerStrings = new Set<string>([
      ...PRODUCER_PRE_MORTEM.warning_signs,
      PRODUCER_PRE_MORTEM.mitigation,
      PRODUCER_PRE_MORTEM.review_trigger,
      PRODUCER_PRE_MORTEM.failure_scenario,
    ]);
    for (const value of [
      ...(block.warning_signs ?? []),
      ...(block.mitigation === undefined ? [] : [block.mitigation]),
      ...(block.review_trigger === undefined ? [] : [block.review_trigger]),
      ...(block.failure_scenario === undefined ? [] : [block.failure_scenario]),
    ]) {
      expect(producerStrings.has(value), `not a producer string: ${value}`).toBe(true);
    }

    // The block carries NO numeric field at all — the fabrication surface is
    // absent by construction, not merely unfabricated today.
    for (const value of Object.values(block as unknown as Record<string, unknown>)) {
      expect(typeof value).not.toBe('number');
    }
  });

  it('surfaces the three producer fields the pre_mortem review card DISCARDS', () => {
    const response = composeCurrentTurn(makeFact());
    const card = response.blocks.find(
      (b) => b.type === 'review_card' && b.card_kind === 'pre_mortem',
    ) as { body: string } | undefined;
    expect(card, 'the review card is the companion’s precondition').toBeDefined();

    // The card renders failure_scenario only. The exercise is NEW content, not a
    // second rendering — if this ever inverts, the two cards are duplicates.
    expect(card!.body).toContain('rollout slipped past the window');
    expect(card!.body).not.toContain(PRODUCER_PRE_MORTEM.mitigation);
    expect(card!.body).not.toContain(PRODUCER_PRE_MORTEM.warning_signs[0]);

    const block = exercisesOf(response)[0]!;
    expect(block.failure_scenario).toBeUndefined();
  });

  it('stamps fresh lifecycle metadata and inherits the card’s resolved target_refs', () => {
    const response = composeCurrentTurn(makeFact());
    const block = exercisesOf(response)[0]!;
    expect(block.freshness).toBe('fresh');
    expect(block.graph_hash_at_generation).toBe(GRAPH_HASH);
    expect(block.signal_id).toBe(`exercise:pre_mortem:${GRAPH_HASH}`);

    const card = response.blocks.find(
      (b) => b.type === 'review_card' && b.card_kind === 'pre_mortem',
    ) as { target_refs: ReadonlyArray<{ id: string }> };
    expect(block.target_refs).toEqual(card.target_refs);
    expect(block.target_refs.map((r) => r.id)).toEqual(['fac_delivery_risk']);
  });

  it('rides beside the P0 lens suggestion, never instead of it', () => {
    const response = composeCurrentTurn(makeFact());
    const lensBlock = response.blocks.find(
      (b) => b.type === 'coaching' && b.signal_id.startsWith('coach:lens:'),
    );
    expect(lensBlock, 'the companion must not replace the P0 suggestion').toBeDefined();
    expect(exercisesOf(response)).toHaveLength(1);
  });
});

// ===========================================================================
// ARM 2 — STALE branch
// ===========================================================================

describe('capability P1 — companion is ABSENT on the stale branch', () => {
  it('emits no exercise when the prior fact’s graph hash has diverged', () => {
    expectedCompanionInputsPresent(DECISION_REVIEW);
    const priorFact = makeFact();
    const staleness: FreshnessDerivation = {
      freshness: 'stale',
      reason: 'graph_hash_diverged',
      selected_fact_index: 0,
      graph_hash_at_run: GRAPH_HASH,
      current_graph_hash: DIVERGED_GRAPH_HASH,
      computed_at: '2026-07-31T08:59:00.000Z',
    };
    const response = OlumiResponseSchema.parse(
      composeToolCallResponse({
        ...BASE_INPUT,
        stage: 'decide',
        handlerFacts: [],
        lifecycle: {
          priorFacts: [priorFact],
          freshness: staleness,
          requestId: 'req-p1-stale',
          scenarioId: SCENARIO_ID,
        },
      }),
    );
    expect(exercisesOf(response)).toHaveLength(0);
  });

  it('POSITIVE CONTROL — the identical prior fact DOES emit one on the fresh verdict', () => {
    const priorFact = makeFact();
    const response = OlumiResponseSchema.parse(
      composeToolCallResponse({
        ...BASE_INPUT,
        stage: 'decide',
        handlerFacts: [],
        lifecycle: {
          priorFacts: [priorFact],
          freshness: {
            freshness: 'fresh',
            reason: 'graph_hash_match',
            selected_fact_index: 0,
            graph_hash_at_run: GRAPH_HASH,
            current_graph_hash: GRAPH_HASH,
            computed_at: '2026-07-31T08:59:00.000Z',
          },
          requestId: 'req-p1-fresh',
          scenarioId: SCENARIO_ID,
        },
      }),
    );
    expect(exercisesOf(response)).toHaveLength(1);
  });
});

// ===========================================================================
// ARM 3 — the lens did not select pre_mortem
// ===========================================================================

describe('capability P1 — companion is ABSENT when the lens selects something else', () => {
  it('emits no exercise when flip-risk outranks pre_mortem, from the SAME prose', () => {
    expectedCompanionInputsPresent(DECISION_REVIEW);
    const response = composeCurrentTurn(makeFact({ flipRiskIsolated: true }));

    // The lens really did move — otherwise this test would pass by testing the
    // arm-1 configuration under a different name.
    const lensBlock = response.blocks.find(
      (b) => b.type === 'coaching' && b.signal_id.startsWith('coach:lens:'),
    ) as { signal_id: string } | undefined;
    expect(lensBlock?.signal_id).toContain('coach:lens:sensitivity_flip_risk');

    expect(exercisesOf(response)).toHaveLength(0);

    // …and the pre-mortem PROSE is still on the response, so the absence is the
    // lens gate and not a missing fixture.
    expect(
      response.blocks.some((b) => b.type === 'review_card' && b.card_kind === 'pre_mortem'),
    ).toBe(true);
  });

  it('POSITIVE CONTROL — the same fixture WITHOUT the flip-risk flag emits one', () => {
    const response = composeCurrentTurn(makeFact({ flipRiskIsolated: false }));
    const lensBlock = response.blocks.find(
      (b) => b.type === 'coaching' && b.signal_id.startsWith('coach:lens:'),
    ) as { signal_id: string } | undefined;
    expect(lensBlock?.signal_id).toContain('coach:lens:pre_mortem');
    expect(exercisesOf(response)).toHaveLength(1);
  });
});

// ===========================================================================
// ARM 4 — the withheld claim verdict
// ===========================================================================

describe('capability P1 — companion is ABSENT on a withheld claim verdict', () => {
  it('emits no exercise when the fact says the leading option may not be named', () => {
    expectedCompanionInputsPresent(DECISION_REVIEW);
    const response = composeCurrentTurn(makeFact({ mayNameLeadingOption: false }));

    // The withheld arm really was taken: the P0 lens suggestion
    // (coaching_kind 'strengthen') is dropped by the same funnel.
    expect(
      response.blocks.some(
        (b) => b.type === 'coaching' && b.coaching_kind === 'strengthen',
      ),
      'withheld arm not reached — the strengthen block survived',
    ).toBe(false);

    expect(exercisesOf(response)).toHaveLength(0);
  });

  it('POSITIVE CONTROL — the licensed twin of that fixture emits one', () => {
    const response = composeCurrentTurn(makeFact({ mayNameLeadingOption: true }));
    expect(exercisesOf(response)).toHaveLength(1);
  });

  it('fails CLOSED on an UNSTAMPED fact (verdict unknown ≠ verdict permitted)', () => {
    const fact = makeFact();
    delete (
      (fact.result as Record<string, unknown>).enrichment as Record<string, unknown>
    ).__cee_claim_safety;
    expect(exercisesOf(composeCurrentTurn(fact))).toHaveLength(0);
  });
});

// ===========================================================================
// Content-honesty arms — the block is never an empty shell
// ===========================================================================

describe('capability P1 — the companion refuses to ship an empty shell', () => {
  it('emits nothing when the producer supplied no warning_signs / mitigation / review_trigger', () => {
    const dr = {
      ...DECISION_REVIEW,
      pre_mortem: {
        failure_scenario: PRODUCER_PRE_MORTEM.failure_scenario,
        grounded_in: PRODUCER_PRE_MORTEM.grounded_in,
      },
    };
    const response = composeCurrentTurn(makeFact({ decisionReview: dr }));
    // The card (built from failure_scenario) still ships — so the fixture is
    // live and only the companion's own content gate fired.
    expect(
      response.blocks.some((b) => b.type === 'review_card' && b.card_kind === 'pre_mortem'),
    ).toBe(true);
    expect(exercisesOf(response)).toHaveLength(0);
  });

  it('drops whole (never partial) when a warning sign fails the prose guard', () => {
    const dr = {
      ...DECISION_REVIEW,
      pre_mortem: {
        ...PRODUCER_PRE_MORTEM,
        warning_signs: ['Sprint burndown flattens.', 'fac_delivery_risk stops moving.'],
      },
    };
    const response = composeCurrentTurn(makeFact({ decisionReview: dr }));
    expect(exercisesOf(response)).toHaveLength(0);
  });

  it('POSITIVE CONTROL — restoring the producer content restores the block', () => {
    expect(exercisesOf(composeCurrentTurn(makeFact()))).toHaveLength(1);
  });

  it('inherits the review card’s drop rules — a grounding lookup miss kills both', () => {
    const dr = {
      ...DECISION_REVIEW,
      pre_mortem: { ...PRODUCER_PRE_MORTEM, grounded_in: ['fac_does_not_exist'] },
    };
    const response = composeCurrentTurn(makeFact({ decisionReview: dr }));
    expect(
      response.blocks.some((b) => b.type === 'review_card' && b.card_kind === 'pre_mortem'),
      'precondition: the card itself must have been dropped',
    ).toBe(false);
    expect(exercisesOf(response)).toHaveLength(0);
  });
});

// ===========================================================================
// The alarm must describe the WIRE, not the builder
// ===========================================================================

describe('capability P1 — the emitted-telemetry event is wire-truthful', () => {
  let sink: Array<Record<string, unknown>>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sink = [];
    infoSpy = vi.spyOn(log, 'info').mockImplementation((obj: unknown) => {
      if (obj !== null && typeof obj === 'object') sink.push(obj as Record<string, unknown>);
      return log;
    });
  });
  afterEach(() => {
    infoSpy.mockRestore();
  });

  const companionEvents = (): Array<Record<string, unknown>> =>
    sink.filter((e) => e.event === 'v5.capability.lens_companion_emitted');

  it('fires exactly once when the block reaches the wire', () => {
    const response = composeCurrentTurn(makeFact());
    expect(exercisesOf(response)).toHaveLength(1);
    const events = companionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.lens_id).toBe('pre_mortem');
    expect(events[0]!.block_type).toBe('exercise');
    expect(events[0]!.graph_hash_at_generation).toBe(GRAPH_HASH);
  });

  it('does NOT fire on the withheld arm, where the block is built and then dropped', () => {
    // The block IS constructed on this path (the producer content is present and
    // the review card precondition holds on the permitted twin) — so a builder-
    // site event would fire here. It must not: the user never sees the block.
    const response = composeCurrentTurn(makeFact({ mayNameLeadingOption: false }));
    expect(exercisesOf(response)).toHaveLength(0);
    expect(companionEvents()).toHaveLength(0);
  });
});
