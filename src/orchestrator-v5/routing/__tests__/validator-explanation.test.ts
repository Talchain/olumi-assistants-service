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

describe('Test H ordering rule: staleness caveat must precede figures', () => {
  // Brief task 3: trust contract — when the analysis is loaded from a prior
  // run with unknown freshness, the user reads the staleness caveat before
  // any numeric figure. The validator's rule 6 enforces this ordering.

  const STALENESS = 'loaded_from_prior_run_freshness_unknown';

  it('figures-before-caveat with staleness_reason → invalid (staleness_caveat_must_precede_figures)', () => {
    const verdict = validateExplanationAnswer(
      'explain_results',
      {
        answer_text:
          'Hire Two Senior Engineers Locally leads at 0.926 probability, with an 88.3 percentage point margin over the runner-up. Note that this result is from a prior run with unknown freshness.',
      },
      [{ fact_type: 'run_analysis', noop: false }],
      STALENESS,
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe(
      'staleness_caveat_must_precede_figures',
    );
  });

  it('caveat-before-figures with staleness_reason → valid', () => {
    const verdict = validateExplanationAnswer(
      'explain_results',
      {
        answer_text:
          'Treat the figures below as directional rather than definitive, since the analysis is loaded from a prior run with unknown freshness. Hire Two Senior Engineers Locally leads at 0.926 probability with an 88.3 percentage point margin.',
      },
      [{ fact_type: 'run_analysis', noop: false }],
      STALENESS,
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
    expect(verdict.payload?.answer_validation_error).toBeUndefined();
  });

  it('caveat present, no figures, with staleness_reason → valid (no ordering issue if no figures cited)', () => {
    const longCaveatOnly =
      'The analysis is loaded from a prior run with unknown freshness. Treat the figures as directional rather than definitive — rerun before relying on the headline numbers, especially if the model has changed since.';
    expect(longCaveatOnly.length).toBeGreaterThanOrEqual(80);
    const verdict = validateExplanationAnswer(
      'explain_results',
      { answer_text: longCaveatOnly },
      [{ fact_type: 'run_analysis', noop: false }],
      STALENESS,
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
  });

  it('correct ordering + mutation language → mutation_language_detected wins (rule 4 fires before rule 6)', () => {
    const verdict = validateExplanationAnswer(
      'explain_results',
      {
        answer_text:
          'Treat the figures below as directional rather than definitive — the analysis is loaded from a prior run with unknown freshness. Proposing to add a competitive response factor at 0.5 strength to capture this dynamic in the next run.',
      },
      [{ fact_type: 'run_analysis', noop: false }],
      STALENESS,
    );
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('mutation_language_detected');
  });

  it('correct ordering + forbidden term ("edge") → forbidden_internal_term wins (rule 3 fires before rule 6)', () => {
    const verdict = validateExplanationAnswer(
      'explain_results',
      {
        answer_text:
          'Treat the figures below as directional rather than definitive — the analysis is loaded from a prior run with unknown freshness. The strongest edge has a sensitivity value of 1.0 against the leading option at 0.926 probability.',
      },
      [{ fact_type: 'run_analysis', noop: false }],
      STALENESS,
    );
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('forbidden_internal_term');
  });

  it('explain_from_structure exempt: figures-before-caveat with staleness_reason → valid', () => {
    // Structural answers cite graph link strengths, not analysis figures.
    // The structure projection has no staleness_reason field — even if a
    // staleness_reason is threaded by mistake, rule 6 should skip.
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text:
          'Engineering Capacity is the strongest direct driver at causal link strength 1.0 to the goal, ahead of Delivery Speed at 0.52. Note that the prior analysis is from an earlier run with unknown freshness.',
      },
      [],
      STALENESS,
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
  });

  it('staleness_reason absent (null) + figures only → ordering check skipped, valid', () => {
    const verdict = validateExplanationAnswer(
      'explain_results',
      {
        answer_text:
          'Hire Two Senior Engineers Locally leads at 0.926 probability with an 88.3 percentage point margin over the runner-up.',
      },
      [{ fact_type: 'run_analysis', noop: false }],
      null,
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
  });

  it('British-English "per cent" before caveat with staleness_reason → invalid (numeric detection covers integer-cent phrasing)', () => {
    // Sonnet may absorb the codebase's British-English style and emit
    // "62 per cent" instead of "0.62" or "62%". The bare-decimal pattern
    // would miss the integer-cent phrasing; the percentage-point branch
    // now also matches "per cent".
    const verdict = validateExplanationAnswer(
      'explain_results',
      {
        answer_text:
          'Hire Two Senior Engineers Locally leads at 62 per cent with a meaningful margin over the runner-up. Note that this result is from a prior run with unknown freshness.',
      },
      [{ fact_type: 'run_analysis', noop: false }],
      'loaded_from_prior_run_freshness_unknown',
    );
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe(
      'staleness_caveat_must_precede_figures',
    );
  });
});
