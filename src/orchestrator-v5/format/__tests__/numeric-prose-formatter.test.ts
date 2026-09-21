import { describe, expect, it } from 'vitest';
import {
  formatNumericProse,
  translateSensitivityLanguage,
  suppressStructuralEdgeLanguage,
  sanitiseAssistantTextProse,
} from '../numeric-prose-formatter.js';

describe('formatNumericProse — probability whitelist', () => {
  it('rewrites "0.862 probability"', () => {
    const r = formatNumericProse('Option A wins with a 0.862 probability of reaching the goal.');
    expect(r.text).toContain('86% probability');
    expect(r.text).not.toContain('0.862');
    expect(r.rewrites).toBe(1);
  });

  it('rewrites "probability of success is around 0.74"', () => {
    const r = formatNumericProse('The probability of success is around 0.74.');
    expect(r.text).toContain('probability of success is around 74%');
    expect(r.text).not.toContain('0.74');
    expect(r.rewrites).toBe(1);
  });

  it('rewrites simple "probability of 0.74"', () => {
    const r = formatNumericProse('The probability of 0.74 across both runs.');
    expect(r.text).toContain('probability of 74%');
    expect(r.text).not.toContain('0.74');
    expect(r.rewrites).toBe(1);
  });

  it('rewrites "probability is 0.50"', () => {
    const r = formatNumericProse('Probability is 0.50 across both runs.');
    expect(r.text).toContain('Probability is 50%');
    expect(r.text).not.toMatch(/\b0\.50\b/);
  });

  it('rewrites "likelihood of failure is 0.12"', () => {
    const r = formatNumericProse('The likelihood of failure is 0.12.');
    expect(r.text).toContain('likelihood of failure is 12%');
    expect(r.text).not.toContain('0.12');
  });

  it('rewrites "chance of 0.862"', () => {
    const r = formatNumericProse('There is a chance of 0.45 the bid wins.');
    expect(r.text).toContain('chance of 45%');
    expect(r.text).not.toContain('0.45');
  });

  it('rewrites "probability: 0.862"', () => {
    const r = formatNumericProse('Probability: 0.91 for Option B.');
    expect(r.text).toContain('Probability 91%');
    expect(r.text).not.toContain('0.91');
  });

  it('rewrites "win probability: 0.91"', () => {
    const r = formatNumericProse('Win probability: 0.91 for Option B.');
    expect(r.text).toContain('Win probability 91%');
    expect(r.text).not.toContain('0.91');
  });

  it('rewrites "goal probability = 0.62"', () => {
    const r = formatNumericProse('Goal probability = 0.62 in the latest run.');
    expect(r.text).toContain('Goal probability 62%');
    expect(r.text).not.toContain('0.62');
  });

  it('rewrites "outcome probability of 0.33"', () => {
    const r = formatNumericProse('The outcome probability of 0.33 holds across sweeps.');
    expect(r.text).toContain('outcome probability of 33%');
    expect(r.text).not.toContain('0.33');
  });

  it('is idempotent — second pass preserves output', () => {
    const once = formatNumericProse('Probability is 0.50.');
    const twice = formatNumericProse(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.rewrites).toBe(0);
  });

  it('skips parentheticals (CI)', () => {
    const r = formatNumericProse('The forecast band (0.95 confidence interval) covers both runs.');
    expect(r.text).toBe('The forecast band (0.95 confidence interval) covers both runs.');
    expect(r.rewrites).toBe(0);
  });

  it('returns input unchanged on empty / null', () => {
    expect(formatNumericProse('').text).toBe('');
    // @ts-expect-error covering defensive null path
    expect(formatNumericProse(null).text).toBe('');
  });
});

describe('formatNumericProse — negative passthrough', () => {
  it('leaves "86% chance" unchanged', () => {
    const r = formatNumericProse('This option has an 86% chance of reaching the goal.');
    expect(r.text).toBe('This option has an 86% chance of reaching the goal.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves field name "exists_probability" unchanged', () => {
    const r = formatNumericProse('The exists_probability field is preserved on every edge.');
    expect(r.text).toBe('The exists_probability field is preserved on every edge.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves response_hash content unchanged', () => {
    const r = formatNumericProse('The response_hash: 4da7e62f208e was attached.');
    expect(r.text).toBe('The response_hash: 4da7e62f208e was attached.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves version strings unchanged', () => {
    expect(formatNumericProse('Updated to version 0.10.0').text).toBe('Updated to version 0.10.0');
    expect(formatNumericProse('Updated to version 0.11.0').text).toBe('Updated to version 0.11.0');
  });

  it('leaves entity IDs with decimals unchanged', () => {
    expect(formatNumericProse('Factor fac_churn_0.5 was extracted.').text).toBe(
      'Factor fac_churn_0.5 was extracted.',
    );
    expect(formatNumericProse('See opt_001 for context.').text).toBe('See opt_001 for context.');
  });

  it('leaves "(95% CI)" parentheticals unchanged', () => {
    expect(formatNumericProse('Window is (95% CI) wide.').text).toBe('Window is (95% CI) wide.');
  });

  it('leaves percentage-points delta unchanged', () => {
    const r = formatNumericProse('The win-rate moved by -0.40 percentage points.');
    expect(r.text).toBe('The win-rate moved by -0.40 percentage points.');
    expect(r.rewrites).toBe(0);
  });
});

describe('formatNumericProse — delta-context guard on relaxed pattern', () => {
  // Pattern 5 is the lazy "{token} ... {decimal}" rule. When the
  // intervening prose carries a delta verb / noun, the decimal is a
  // magnitude of change rather than a raw probability, so the
  // rewriter must decline.
  it('leaves "probability changed by 0.12" unchanged', () => {
    const r = formatNumericProse('The probability changed by 0.12 between runs.');
    expect(r.text).toBe('The probability changed by 0.12 between runs.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves "probability moved by 0.05" unchanged', () => {
    const r = formatNumericProse('Win probability moved by 0.05 after the change.');
    expect(r.text).toBe('Win probability moved by 0.05 after the change.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves "likelihood shifted by 0.20" unchanged', () => {
    const r = formatNumericProse('The likelihood shifted by 0.20 last week.');
    expect(r.text).toBe('The likelihood shifted by 0.20 last week.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves "probability dropped by 0.10" unchanged', () => {
    const r = formatNumericProse('The probability dropped by 0.10.');
    expect(r.text).toBe('The probability dropped by 0.10.');
    expect(r.rewrites).toBe(0);
  });

  it('leaves "probability delta of 0.08" unchanged', () => {
    const r = formatNumericProse('The probability delta of 0.08 between scenarios is small.');
    expect(r.text).toBe('The probability delta of 0.08 between scenarios is small.');
    expect(r.rewrites).toBe(0);
  });

  it('still rewrites the non-delta neighbour clause when both appear in same input', () => {
    // The delta clause stays raw; the legitimate "probability of X is Y"
    // clause still rewrites.
    const r = formatNumericProse(
      'The probability changed by 0.05. Win probability is 0.74 in the latest run.',
    );
    expect(r.text).toContain('changed by 0.05');
    expect(r.text).toContain('Win probability is 74%');
  });
});

describe('translateSensitivityLanguage — bands × signs × phrasings', () => {
  // Bands by |v|: <0.3 weak, 0.3-0.7 moderate, 0.7-0.95 strong, >=0.95 very strong.
  const cases = [
    { input: 'sensitivity of 0.10', expect: 'a weak sensitivity signal' },
    { input: 'sensitivity of 0.42', expect: 'a moderate sensitivity signal' },
    { input: 'sensitivity of 0.80', expect: 'a strong sensitivity signal' },
    { input: 'sensitivity value of 1.0', expect: 'a very strong sensitivity signal' },
    { input: 'sensitivity of -0.10', expect: 'a negative sensitivity signal' },
    { input: 'sensitivity of -0.40', expect: 'a negative sensitivity signal' },
    { input: 'sensitivity of -0.80', expect: 'a negative sensitivity signal' },
    { input: 'sensitivity value of -1.0', expect: 'a very strong negative sensitivity signal' },
    { input: 'sensitivity is 0.50', expect: 'a moderate sensitivity signal' },
    { input: 'sensitivity: 0.20', expect: 'a weak sensitivity signal' },
    { input: 'sensitivity = -0.50', expect: 'a negative sensitivity signal' },
  ];

  for (const c of cases) {
    it(`"${c.input}" → "${c.expect}"`, () => {
      const r = translateSensitivityLanguage(c.input);
      expect(r.text).toBe(c.expect);
      expect(r.rewrites).toBe(1);
    });
  }

  it('does NOT rewrite delta phrasing "+0.05 sensitivity shift"', () => {
    const r = translateSensitivityLanguage('We saw a +0.05 sensitivity shift after Q2.');
    expect(r.text).toBe('We saw a +0.05 sensitivity shift after Q2.');
    expect(r.rewrites).toBe(0);
  });

  it('is idempotent', () => {
    const once = translateSensitivityLanguage('sensitivity of -0.40');
    const twice = translateSensitivityLanguage(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.rewrites).toBe(0);
  });
});

describe('suppressStructuralEdgeLanguage — rules and rule_ids', () => {
  it('suppresses "carries a strength of N.NN"', () => {
    const r = suppressStructuralEdgeLanguage('The link carries a strength of 0.55.');
    expect(r.text).toContain('is causally linked');
    expect(r.text).not.toContain('strength of 0.55');
    expect(r.matched).toBe(1);
    expect(r.suppressed).toBe(1);
    expect(r.rule_ids).toContain('carries_strength');
  });

  it('suppresses "edge strength of N.NN"', () => {
    const r = suppressStructuralEdgeLanguage('We see edge strength of 0.30 from A to B.');
    expect(r.text).toMatch(/this causal link/i);
    expect(r.text).not.toContain('0.30');
    expect(r.rule_ids).toContain('edge_strength_weight');
  });

  it('suppresses "edge weight 0.30" with article-consumption', () => {
    // Pattern consumes the leading "The"; replacement is capitalised
    // because the article sat at sentence start.
    const r = suppressStructuralEdgeLanguage('The edge weight 0.30 is small.');
    expect(r.text).toBe('This causal link is small.');
    expect(r.suppressed).toBe(1);
    expect(r.missed_grammar).toBe(0);
    expect(r.rule_ids).toContain('edge_strength_weight');
  });

  it('suppresses "causal strength value of N.NN" with article-consumption', () => {
    const r = suppressStructuralEdgeLanguage('The causal strength value of 0.42 is moderate.');
    expect(r.text).toBe('This causal relationship is moderate.');
    expect(r.suppressed).toBe(1);
    expect(r.missed_grammar).toBe(0);
    expect(r.rule_ids).toContain('causal_strength_value');
  });

  it('suppresses bare "edge has strength 1" (context: edge)', () => {
    const r = suppressStructuralEdgeLanguage('The edge has strength 1 in this run.');
    expect(r.text).toContain('this relationship');
    expect(r.text).not.toContain('strength 1');
    expect(r.rule_ids).toContain('bare_strength_int');
  });

  it('LEAVES "team finished in strength 1 form" untouched (no model-term proximity)', () => {
    const input = 'Our team finished in strength 1 form last week.';
    const r = suppressStructuralEdgeLanguage(input);
    expect(r.text).toBe(input);
    expect(r.rule_ids).not.toContain('bare_strength_int');
  });

  it('returns rule_ids deduplicated when one rule fires twice', () => {
    const r = suppressStructuralEdgeLanguage(
      'Edge A carries a strength of 0.55. Edge B carries a strength of 0.62.',
    );
    expect(r.matched).toBe(2);
    expect(r.rule_ids.filter((id) => id === 'carries_strength').length).toBe(1);
  });

  it('is text-idempotent (text unchanged across re-runs)', () => {
    // Note: `matched` may stay non-zero across passes if a rule keeps
    // matching but is always reverted by the grammar guards. The
    // contract is text-stability, not counter-stability.
    const once = suppressStructuralEdgeLanguage('Carries a strength of 0.55.');
    const twice = suppressStructuralEdgeLanguage(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.suppressed).toBe(0);
  });

  it('returns empty result on empty input', () => {
    const r = suppressStructuralEdgeLanguage('');
    expect(r.text).toBe('');
    expect(r.matched).toBe(0);
    expect(r.rule_ids).toEqual([]);
  });
});

describe('suppressStructuralEdgeLanguage — grammar guards prevent ungrammatical output', () => {
  // The article-consuming patterns produce grammatical splices for
  // determiner-led inputs that a naive replacement would have broken
  // ("The this causal link …"). These tests pin the behaviour.
  it('rewrites "The edge weight 0.30 is small" cleanly via article consumption', () => {
    const r = suppressStructuralEdgeLanguage('The edge weight 0.30 is small.');
    expect(r.text).toBe('This causal link is small.');
    expect(r.suppressed).toBe(1);
    expect(r.missed_grammar).toBe(0);
  });

  it('rewrites "The causal strength value of 0.42 is moderate" cleanly via article consumption', () => {
    const r = suppressStructuralEdgeLanguage('The causal strength value of 0.42 is moderate.');
    expect(r.text).toBe('This causal relationship is moderate.');
    expect(r.suppressed).toBe(1);
    expect(r.missed_grammar).toBe(0);
  });

  // The verb-initial guard catches the `carries_strength` rule when
  // it would produce a subject-less verb fragment ("is causally
  // linked.") at sentence start. A later rule may still substitute a
  // noun-phrase replacement on the same span — that's acceptable and
  // not what this test is pinning.
  it('reverts the "is causally linked" splice when it would land sentence-initial', () => {
    // Standalone input where carries_strength is the only matching rule
    // (no surrounding "causal" / "edge" tokens to cue causal_strength_value).
    const input = 'Carries a strength of 0.55.';
    const r = suppressStructuralEdgeLanguage(input);
    // The verb-initial fragment "is causally linked." is rejected; a
    // grammatical splice via the article-aware causal_strength_value
    // rule is also possible. Either way, missed_grammar must record
    // at least one revert because carries_strength fired and was
    // dropped.
    expect(r.missed_grammar).toBeGreaterThanOrEqual(1);
    // The output must not be the broken fragment.
    expect(r.text).not.toBe('is causally linked.');
  });

  it('still rewrites mid-sentence "carries a strength of 0.55" cleanly (subject precedes)', () => {
    const r = suppressStructuralEdgeLanguage(
      'The link from Option A to the outcome carries a strength of 0.55.',
    );
    expect(r.text).toContain('is causally linked');
    expect(r.suppressed).toBeGreaterThanOrEqual(1);
  });
});

describe('translateSensitivityLanguage — exact output for article cases', () => {
  // Article-consuming sensitivity translation: when a leading "a" /
  // "an" / "the" is captured as part of the match, the band label's
  // own leading "a" is stripped and the captured article is preserved
  // verbatim (including its capitalisation). These tests pin the
  // exact splice rather than just asserting absence of doubled
  // articles.
  it('"with a sensitivity value of 1.0" → "with a very strong sensitivity signal"', () => {
    const r = sanitiseAssistantTextProse(
      'Headline driver with a sensitivity value of 1.0 dominates.',
    );
    expect(r.text).toBe(
      'Headline driver with a very strong sensitivity signal dominates.',
    );
  });

  it('"with a sensitivity of -0.40" → "with a negative sensitivity signal"', () => {
    const r = sanitiseAssistantTextProse(
      'Driver shows with a sensitivity of -0.40 in the second run.',
    );
    expect(r.text).toBe(
      'Driver shows with a negative sensitivity signal in the second run.',
    );
  });

  it('"the sensitivity value of 0.42" → "the moderate sensitivity signal"', () => {
    const r = sanitiseAssistantTextProse(
      'We measured the sensitivity value of 0.42 across runs.',
    );
    expect(r.text).toBe(
      'We measured the moderate sensitivity signal across runs.',
    );
  });

  it('sentence-initial "A sensitivity of 0.80 …" preserves capitalisation', () => {
    const r = sanitiseAssistantTextProse('A sensitivity of 0.80 emerged.');
    // The captured article "A " is preserved (capital), the label's
    // leading "a " is stripped, so the result is "A strong sensitivity
    // signal emerged." preserving sentence-initial caps.
    expect(r.text).toBe('A strong sensitivity signal emerged.');
  });
});

describe('suppressStructuralEdgeLanguage — noun-pileup regressions (round 3)', () => {
  // These cases exposed a bug where bare_strength_int consumed an
  // article that was qualifying an adjacent noun, orphaning the noun.
  // The fix: bare_strength_int no longer consumes leading articles;
  // the grammar guard catches the resulting noun pileups and reverts.
  it('"The factor strength 1 is high." reverts (factor would be orphaned)', () => {
    const input = 'The factor strength 1 is high.';
    const r = suppressStructuralEdgeLanguage(input);
    expect(r.text).toBe(input);
    expect(r.missed_grammar).toBeGreaterThanOrEqual(1);
  });

  it('"A strength 1 edge was reported." reverts (edge would be orphaned)', () => {
    const input = 'A strength 1 edge was reported.';
    const r = suppressStructuralEdgeLanguage(input);
    expect(r.text).toBe(input);
    expect(r.missed_grammar).toBeGreaterThanOrEqual(1);
  });

  it('sentence-initial "Carries a strength of 0.55." cleanly text-stable across passes', () => {
    // Consequence of cross-rule revert propagation: once
    // carries_strength is reverted, downstream causal_strength_value
    // can no longer match the inner "a strength of 0.55" span.
    // Result: text unchanged, both rules flagged as missed_grammar.
    const input = 'Carries a strength of 0.55. The other path is fine.';
    const r = suppressStructuralEdgeLanguage(input);
    expect(r.text).toBe(input);
    expect(r.suppressed).toBe(0);
  });
});

describe('formatNumericProse — diagnostic probability terms (round 3)', () => {
  // Pattern 5's relaxed lazy match was over-firing on diagnostic
  // metrics — variance, calibration error, ratio etc. — where the
  // decimal is a magnitude statistic rather than a [0,1] probability.
  // The delta-context guard now also covers these terms.
  it('"probability variance is 0.12" unchanged', () => {
    const r = formatNumericProse('The probability variance is 0.12 across runs.');
    expect(r.text).toBe('The probability variance is 0.12 across runs.');
    expect(r.rewrites).toBe(0);
  });

  it('"probability calibration error is 0.12" unchanged', () => {
    const r = formatNumericProse(
      'The probability calibration error is 0.12 in the latest run.',
    );
    expect(r.text).toBe(
      'The probability calibration error is 0.12 in the latest run.',
    );
    expect(r.rewrites).toBe(0);
  });

  it('"likelihood ratio is 0.42" unchanged', () => {
    const r = formatNumericProse('The likelihood ratio is 0.42 between scenarios.');
    expect(r.text).toBe('The likelihood ratio is 0.42 between scenarios.');
    expect(r.rewrites).toBe(0);
  });

  it('"probability gap of 0.08" unchanged', () => {
    const r = formatNumericProse('The probability gap of 0.08 narrowed.');
    expect(r.text).toBe('The probability gap of 0.08 narrowed.');
    expect(r.rewrites).toBe(0);
  });

  it('"probability coefficient is 0.30" unchanged', () => {
    const r = formatNumericProse('The probability coefficient is 0.30 here.');
    expect(r.text).toBe('The probability coefficient is 0.30 here.');
    expect(r.rewrites).toBe(0);
  });

  it('"likelihood divergence is 0.55" unchanged', () => {
    const r = formatNumericProse('The likelihood divergence is 0.55 across models.');
    expect(r.text).toBe('The likelihood divergence is 0.55 across models.');
    expect(r.rewrites).toBe(0);
  });
});

describe('formatNumericProse — diagnostic-as-metric-head guard preserves event-probability phrases (round 4)', () => {
  // Round 4 sharpening: the diagnostic-noun guard must only block when
  // the diagnostic noun is the metric head (directly adjacent to the
  // probability token). When the diagnostic noun appears as the OBJECT
  // of an "of" clause, it identifies the EVENT whose probability is
  // being reported and the rewrite must proceed.
  it('"probability of error is 0.12" rewrites to "probability of error is 12%"', () => {
    const r = formatNumericProse('The probability of error is 0.12 in the latest run.');
    expect(r.text).toContain('probability of error is 12%');
    expect(r.text).not.toContain('0.12');
    expect(r.rewrites).toBe(1);
  });

  it('"chance of error is 0.12" rewrites to "chance of error is 12%"', () => {
    const r = formatNumericProse('The chance of error is 0.12 across the corpus.');
    expect(r.text).toContain('chance of error is 12%');
    expect(r.text).not.toContain('0.12');
    expect(r.rewrites).toBe(1);
  });

  it('"probability of a gap opening is 0.42" rewrites the trailing decimal', () => {
    const r = formatNumericProse('The probability of a gap opening is 0.42 next quarter.');
    expect(r.text).toContain('42%');
    expect(r.text).not.toContain('0.42');
    expect(r.rewrites).toBe(1);
  });

  it('"likelihood of a calibration drift" still rewrites (calibration is the event noun, not the metric)', () => {
    const r = formatNumericProse('The likelihood of a calibration drift is 0.20 next month.');
    expect(r.text).toContain('20%');
    expect(r.text).not.toContain('0.20');
  });
});

describe('suppressStructuralEdgeLanguage — demonstrative consumption (round 4)', () => {
  // Round 4: structural patterns now consume "this/that/these/those"
  // in addition to "the/a/an", so explanatory prose that opens with
  // "This causal strength value …" splices grammatically rather than
  // producing "This this causal relationship …" (which would be
  // reverted by the determiner-pileup guard, leaving the raw decimal
  // visible).
  it('"This causal strength value of 0.42 is moderate." → "This causal relationship is moderate."', () => {
    const r = suppressStructuralEdgeLanguage('This causal strength value of 0.42 is moderate.');
    expect(r.text).toBe('This causal relationship is moderate.');
    expect(r.suppressed).toBe(1);
    expect(r.missed_grammar).toBe(0);
  });

  it('"This edge strength of 0.42 is moderate." → "This causal link is moderate."', () => {
    const r = suppressStructuralEdgeLanguage('This edge strength of 0.42 is moderate.');
    expect(r.text).toBe('This causal link is moderate.');
    expect(r.suppressed).toBe(1);
    expect(r.missed_grammar).toBe(0);
  });

  it('"That edge weight 0.30 is small." → "This causal link is small." preserves substitution case', () => {
    // "That" sits at sentence start → replacement capitalised.
    const r = suppressStructuralEdgeLanguage('That edge weight 0.30 is small.');
    expect(r.text).toBe('This causal link is small.');
    expect(r.suppressed).toBe(1);
  });
});

describe('suppressStructuralEdgeLanguage — relationship-noun pileup guard (round 4)', () => {
  // Round 4: bare_strength_int does not consume the leading article,
  // so "The relationship strength 1 is high" naively splices to "The
  // relationship this relationship is high." The pileup guard must
  // catch this — `relationship` is now in the first noun-set.
  it('"The relationship strength 1 is high." reverts (would produce "relationship this relationship")', () => {
    const input = 'The relationship strength 1 is high.';
    const r = suppressStructuralEdgeLanguage(input);
    expect(r.text).toBe(input);
    expect(r.missed_grammar).toBeGreaterThanOrEqual(1);
  });

  it('"The link strength 1 is small." reverts similarly', () => {
    const input = 'The link strength 1 is small.';
    const r = suppressStructuralEdgeLanguage(input);
    expect(r.text).toBe(input);
    expect(r.missed_grammar).toBeGreaterThanOrEqual(1);
  });
});

describe('sanitiseAssistantTextProse — combined ordering structural → sensitivity → numeric', () => {
  it('handles all three classes in one pass', () => {
    const input =
      'Option A performs best with 0.862 probability and the edge carries a strength of 0.55, with a sensitivity value of 1.0.';
    const r = sanitiseAssistantTextProse(input);
    expect(r.text).toContain('86% probability');
    expect(r.text).toContain('is causally linked');
    expect(r.text).toContain('a very strong sensitivity signal');
    expect(r.text).not.toContain('0.862');
    expect(r.text).not.toContain('strength of 0.55');
    expect(r.text).not.toContain('sensitivity value of 1.0');
    expect(r.probability_rewrites).toBeGreaterThanOrEqual(1);
    expect(r.sensitivity_rewrites).toBeGreaterThanOrEqual(1);
    expect(r.structural_matches).toBeGreaterThanOrEqual(1);
    expect(r.structural_suppressed).toBeGreaterThanOrEqual(1);
    expect(r.structural_rule_ids).toContain('carries_strength');
  });

  it('is text-idempotent on combined output (text stable across re-runs)', () => {
    // structural_matches may stay non-zero on the second pass if a
    // structural rule keeps matching but is always reverted by the
    // grammar guards. The contract is text-stability + zero
    // probability/sensitivity rewrites + zero NEW suppressions.
    const input = 'Probability of 0.74. Carries a strength of 0.30. Sensitivity of -0.5.';
    const once = sanitiseAssistantTextProse(input);
    const twice = sanitiseAssistantTextProse(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.probability_rewrites).toBe(0);
    expect(twice.sensitivity_rewrites).toBe(0);
    expect(twice.structural_suppressed).toBe(0);
  });

  it('returns zero counters and unchanged text for empty input', () => {
    const r = sanitiseAssistantTextProse('');
    expect(r.text).toBe('');
    expect(r.probability_rewrites).toBe(0);
    expect(r.sensitivity_rewrites).toBe(0);
    expect(r.structural_matches).toBe(0);
    expect(r.structural_rule_ids).toEqual([]);
  });

  it('runs structural before numeric so 0.55 inside "strength of 0.55" is removed first', () => {
    // If numeric ran first it would NOT match "strength of 0.55" because
    // the pattern targets probability tokens. But structural-first means
    // the decimal disappears with the phrase, so post-structural numeric
    // sees no orphan "0.55".
    const input = 'The link carries a strength of 0.55 across both runs.';
    const r = sanitiseAssistantTextProse(input);
    expect(r.text).not.toContain('0.55');
    expect(r.probability_rewrites).toBe(0);
  });
});
