/**
 * Side-band answer-text validator — unit tests.
 *
 * Floor per brief §Task 5: 9 tests.
 */

import { describe, expect, it } from 'vitest';

import {
  validateExplanationAnswer,
  type SideBandPriorFact,
} from '../validator-explanation.js';

const RUN_ANALYSIS_FACT: SideBandPriorFact = { fact_type: 'run_analysis', noop: false };
const NOOP_RUN_ANALYSIS_FACT: SideBandPriorFact = { fact_type: 'run_analysis', noop: true };

const VALID_LONG_ANSWER =
  'Engineering Capacity is the leading driver of your Q3 throughput goal because it has the strongest causal footprint across the model at 0.65 strength.';

describe('validateExplanationAnswer', () => {
  it('returns skip:true for non-explanation handlers (e.g. run_analysis)', () => {
    const verdict = validateExplanationAnswer(
      'run_analysis',
      { answer_text: 'irrelevant payload that should be ignored' },
      [],
    );
    expect(verdict.skip).toBe(true);
    expect(verdict.payload).toBeUndefined();
  });

  it('marks valid: explain_from_structure with a >= 80-char clean answer', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text: VALID_LONG_ANSWER,
        evidence_used: ['graph.nodes'],
        cited_fields: ['Engineering Capacity'],
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
    expect(verdict.payload?.answer_validation_error).toBeUndefined();
    expect(verdict.payload?.answer_text).toBe(VALID_LONG_ANSWER);
    expect(verdict.payload?.evidence_used).toEqual(['graph.nodes']);
    expect(verdict.payload?.cited_fields).toEqual(['Engineering Capacity']);
  });

  it('marks invalid (missing) when explanation field is absent on an explanation handler', () => {
    // Reproduces the v40 staging Tests D/E/F shape: bare tool_use with no
    // explanation payload.
    const verdict = validateExplanationAnswer('explain_results', undefined, [
      RUN_ANALYSIS_FACT,
    ]);
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('missing');
    expect(verdict.payload?.answer_text).toBe('');
  });

  it('marks invalid (too_short) when answer_text is < 80 chars', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      { answer_text: 'Engineering Capacity drives your goal.' },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('too_short');
  });

  it('marks invalid (forbidden_internal_term) when answer_text references "node"/"edge"/"handler"', () => {
    const verdicts = [
      validateExplanationAnswer(
        'explain_from_structure',
        {
          answer_text:
            'Looking at the strongest edge in the graph, Engineering Capacity drives Throughput at 0.65 strength.',
        },
        [],
      ),
      validateExplanationAnswer(
        'explain_results',
        {
          answer_text:
            'The handler is reading the projection: Engineering Capacity has the largest sensitivity at 0.65.',
        },
        [RUN_ANALYSIS_FACT],
      ),
      validateExplanationAnswer(
        'explain_from_structure',
        {
          answer_text:
            'Analysing the goal node and traversing each connection shows Engineering Capacity dominates the structure.',
        },
        [],
      ),
    ];
    for (const v of verdicts) {
      expect(v.payload?.answer_text_valid).toBe(false);
      expect(v.payload?.answer_validation_error).toBe('forbidden_internal_term');
    }
  });

  it('Wave 5d: marks invalid for raw decimal coefficients (3+ fractional digits without a unit marker)', () => {
    // The brief's evidence #4 value: an LLM-generated answer containing
    // "-0.7346938775510203" must be rejected. Wave 4 fixed the
    // deterministic fallback formatter; Wave 5d closes the egress hole
    // for Sonnet-generated answer_text.
    const padding =
      ' Engineering Capacity carries the largest influence in the model and the leading option performs best by 14 percentage points.';
    const baselinePriorFacts = [RUN_ANALYSIS_FACT];
    const cases: Array<{ snippet: string }> = [
      { snippet: 'The sensitivity is -0.7346938775510203' },
      { snippet: 'Strength of the link is 0.6789' },
      { snippet: 'Coefficient: 1.234' },
      { snippet: 'Driver carries 0.5678' },
    ];
    for (const { snippet } of cases) {
      const verdict = validateExplanationAnswer(
        'explain_results',
        { answer_text: snippet + padding },
        baselinePriorFacts,
      );
      expect(verdict.payload?.answer_text_valid).toBe(false);
      expect(verdict.payload?.answer_validation_error).toBe('raw_decimal_coefficient');
    }
  });

  it('Wave 5d: passes legitimate decimals followed by unit markers (%, percentage points, pp)', () => {
    const padding =
      ' Engineering Capacity is the strongest driver and the result is meaningful.';
    const baselinePriorFacts = [RUN_ANALYSIS_FACT];
    const cases: Array<{ snippet: string }> = [
      { snippet: 'The leading option performs best with a probability of 62%' },
      { snippet: 'The lead is 14 percentage points' },
      { snippet: 'Margin is 14.5%' },
      { snippet: 'A 5 pp lead is meaningful' },
      { snippet: 'Probability 0.62 is shown as 62.345%' }, // 0.62 only 2 dp; 62.345% has unit marker
    ];
    for (const { snippet } of cases) {
      const verdict = validateExplanationAnswer(
        'explain_results',
        { answer_text: snippet + padding },
        baselinePriorFacts,
      );
      expect(verdict.payload?.answer_validation_error).not.toBe('raw_decimal_coefficient');
    }
  });

  it('Wave 5: marks invalid for identifier-style internal terms (noop / fact_type / BUDGET_TARGET / graph_hash / Zod)', () => {
    // Each of these must be blocked at the validator BEFORE reaching
    // user-facing assistant_text. Padding ensures every answer is well
    // over the 80-char minimum so the only failure path is the
    // forbidden-term gate.
    const padding =
      ' Engineering Capacity carries the largest influence in the model with a probability of 62%.';
    const baselinePriorFacts = [RUN_ANALYSIS_FACT];
    const cases: Array<{ snippet: string }> = [
      { snippet: 'noop branch fired' },
      { snippet: 'the fact_type was unexpected' },
      { snippet: 'BUDGET_TARGET was exceeded' },
      { snippet: 'graph_hash mismatch detected' },
      { snippet: 'Zod parsing failed' },
    ];
    for (const { snippet } of cases) {
      const verdict = validateExplanationAnswer(
        'explain_results',
        { answer_text: snippet + padding },
        baselinePriorFacts,
      );
      expect(verdict.payload?.answer_text_valid).toBe(false);
      expect(verdict.payload?.answer_validation_error).toBe('forbidden_internal_term');
    }
  });

  it('marks invalid (mutation_language_detected) when answer_text reads as an edit', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text:
          'Proposing to add a competitive response risk factor to capture market dynamics across the model.',
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('mutation_language_detected');
  });

  it('returns skip:true (precondition bypass) for explain_results with no analysis fact', () => {
    // Handler renders its existing "no analysis yet" template; side-band
    // validation does not run.
    const verdict = validateExplanationAnswer(
      'explain_results',
      { answer_text: VALID_LONG_ANSWER },
      [],
    );
    expect(verdict.skip).toBe(true);
    expect(verdict.payload).toBeUndefined();
  });

  it('returns skip:true (precondition bypass) for what_would_flip with only a noop run_analysis fact', () => {
    // A noop run_analysis fact (e.g. one persisted by a prior explain turn)
    // does NOT count — only a real PLoT-backed analysis run satisfies the
    // precondition. Mirrors the handler's existing prior_facts filter.
    const verdict = validateExplanationAnswer(
      'what_would_flip',
      { answer_text: VALID_LONG_ANSWER },
      [NOOP_RUN_ANALYSIS_FACT],
    );
    expect(verdict.skip).toBe(true);
  });

  it('does NOT bypass for explain_from_structure (no analysis precondition)', () => {
    // explain_from_structure has no analysis precondition; even with no
    // facts, the side-band check runs.
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      { answer_text: VALID_LONG_ANSWER },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
  });

  it('preserves evidence_used and cited_fields when present even on invalid answers', () => {
    // Telemetry should still see what Sonnet *tried* to cite even when the
    // answer text itself is unusable.
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text: 'too short',
        evidence_used: ['analysis.leading_option'],
        cited_fields: ['Engineering Capacity'],
      },
      [],
    );
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.evidence_used).toEqual(['analysis.leading_option']);
    expect(verdict.payload?.cited_fields).toEqual(['Engineering Capacity']);
  });
});

describe('Test A diagnosis: explain_from_structure pre-analysis validation paths', () => {
  // Brief task 1 step 0: confirm WHICH validator rule(s) plausibly fire on
  // staging for the Test A turn ("What factor most influences my decision?")
  // before applying the schema-description fix. Each variant simulates a
  // realistic Sonnet response shape; the verdict's answer_validation_error
  // is asserted explicitly so the decision-table root-cause column is
  // evidence-based, not assumed.

  it('variant 1: short structural reply (~50 chars) → too_short', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text: 'Engineering Capacity is the most influential factor.',
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('too_short');
  });

  it('variant 2: medium reply citing the goal "node" and an "edge" → forbidden_internal_term', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text:
          'The edge from Engineering Capacity to the goal node has strength 1.0, making it the most influential factor in the model.',
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('forbidden_internal_term');
  });

  it("variant 3: medium reply with mutation language (\"I'd propose adding\") → mutation_language_detected", () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text:
          "I'd propose adding a Capacity factor to make this clearer; for now Engineering Capacity is the strongest causal driver in the model.",
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('mutation_language_detected');
  });

  it('variant 4 (positive control): 250-char structural reply respecting all rules → valid', () => {
    const longClean =
      'Looking at the model structure, Engineering Capacity is the strongest direct driver, with a causal link strength of 1.0 to the goal. ' +
      'Delivery Speed contributes a secondary pathway at 0.52 strength, while Current Team Size carries a smaller 0.19 contribution.';
    expect(longClean.length).toBeGreaterThanOrEqual(80);
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text: longClean,
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
    expect(verdict.payload?.answer_validation_error).toBeUndefined();
  });
});

// Rule 6 (staleness caveat must precede figures) was removed in the V5
// explain-stabilisation refactor. Ordering is now guaranteed by the
// handler's deterministic `applyStalenessPrefix` helper, not by validator
// regex. Tests for the prefix helper live in `staleness-prefix.test.ts`;
// integration coverage flows through the handler tests in
// `explain-results.test.ts` / `what-would-flip.test.ts`.
