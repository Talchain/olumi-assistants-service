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
    expect(r.text).toContain('this causal link');
    expect(r.text).not.toContain('0.30');
    expect(r.rule_ids).toContain('edge_strength_weight');
  });

  it('suppresses "edge weight 0.30"', () => {
    const r = suppressStructuralEdgeLanguage('The edge weight 0.30 is small.');
    expect(r.text).toContain('this causal link');
    expect(r.rule_ids).toContain('edge_strength_weight');
  });

  it('suppresses "causal strength value of N.NN"', () => {
    const r = suppressStructuralEdgeLanguage('The causal strength value of 0.42 is moderate.');
    expect(r.text).toContain('this causal relationship');
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
