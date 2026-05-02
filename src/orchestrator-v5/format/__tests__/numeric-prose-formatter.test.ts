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

  it('is idempotent', () => {
    const once = suppressStructuralEdgeLanguage('Carries a strength of 0.55.');
    const twice = suppressStructuralEdgeLanguage(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.matched).toBe(0);
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

describe('translateSensitivityLanguage — grammar guard via combined sanitiser', () => {
  // The standalone translate function naively replaces the matched
  // span; combined with surrounding "with a …" prose this can
  // produce "with a a very strong sensitivity signal". The combined
  // sanitiseAssistantTextProse should produce grammatical output. We
  // assert against the combined helper since that is the user-facing
  // entry point.
  it('produces clean output for "with a sensitivity value of 1.0"', () => {
    const r = sanitiseAssistantTextProse('Headline driver with a sensitivity value of 1.0 dominates.');
    // Either the formatter produces a clean splice ("with a very strong …")
    // or a self-contained one ("a very strong …") — the assertion is
    // that no doubled article appears.
    expect(r.text).not.toMatch(/\b(a|an|the)\s+(a|an|the)\b/i);
    expect(r.sensitivity_rewrites).toBeGreaterThanOrEqual(0);
  });

  it('produces clean output for "with a sensitivity of -0.40"', () => {
    const r = sanitiseAssistantTextProse('Driver shows with a sensitivity of -0.40 in the second run.');
    expect(r.text).not.toMatch(/\b(a|an|the)\s+(a|an|the)\b/i);
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

  it('is idempotent on combined output', () => {
    const input = 'Probability of 0.74. Carries a strength of 0.30. Sensitivity of -0.5.';
    const once = sanitiseAssistantTextProse(input);
    const twice = sanitiseAssistantTextProse(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.probability_rewrites).toBe(0);
    expect(twice.sensitivity_rewrites).toBe(0);
    expect(twice.structural_matches).toBe(0);
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
