/**
 * format-analysis-for-context — display-safe analysis projection tests
 * (brief brief-display-safe-analysis A2 v2).
 *
 * The formatter is the upstream boundary that prevents raw analysis
 * floats from reaching Sonnet. These tests pin:
 *   - probability rendering (`0.862` → `"86%"`)
 *   - sensitivity-band phrasing across boundaries + near-zero
 *   - structural fragile-edge passthrough (labels only)
 *   - omission semantics (no `null` keys when source is missing)
 *   - the structural no-raw-floats invariant (recursive walk asserts
 *     no `number` field at any depth — strongest test in the brief)
 */

import { describe, expect, it } from 'vitest';

import type {
  ContextPackAnalysis,
  ContextPackAnalysisDriver,
  ContextPackAnalysisFragileEdge,
} from '../../context/context-pack-assembler.js';
import {
  formatAnalysisForContext,
  influencePhrase,
  type DisplaySafeAnalysis,
} from '../format-analysis-for-context.js';
import { sanitiseAssistantTextProse } from '../numeric-prose-formatter.js';

function rawDriver(label: string, sensitivityValue: number): ContextPackAnalysisDriver {
  return { factor_label: label, sensitivity_value: sensitivityValue };
}

function rawAnalysis(overrides: Partial<ContextPackAnalysis> = {}): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: { label: 'Option A', probability: 0.862 },
    runner_up: { label: 'Option B', probability: 0.791 },
    margin_pp: 7.1,
    robustness_band: 'moderate',
    top_drivers: [rawDriver('Price', 1.0), rawDriver('Demand', -0.4)],
    fragile_edges: [],
    ...overrides,
  };
}

/**
 * Recursive structural assertion: walk every value at every depth and
 * verify nothing is a `number`. Display-safe values are strings,
 * arrays of strings, or nested objects — never floats.
 */
function assertNoNumbersAnywhere(value: unknown, path: string = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    throw new Error(`Found number at ${path}: ${value}`);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNumbersAnywhere(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoNumbersAnywhere(v, `${path}.${k}`);
    }
    return;
  }
}

describe('formatAnalysisForContext', () => {
  it('returns null when raw analysis is null', () => {
    expect(formatAnalysisForContext(null)).toBeNull();
  });

  it('formats probabilities as integer percent strings', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        leading_option: { label: 'Option A', probability: 0.862 },
        runner_up: { label: 'Option B', probability: 0.5 },
      }),
    );
    expect(out!.leading_option).toEqual({ label: 'Option A', win_probability: '86%' });
    expect(out!.runner_up).toEqual({ label: 'Option B', win_probability: '50%' });
  });

  it('omits leading_option / runner_up when source is missing (no null fields)', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({ leading_option: null, runner_up: null }),
    );
    expect(out!).not.toHaveProperty('leading_option');
    expect(out!).not.toHaveProperty('runner_up');
  });

  it('renders margin_pp via formatPercentagePoints (singular at 1, omits at 0)', () => {
    const seven = formatAnalysisForContext(rawAnalysis({ margin_pp: 7 }));
    expect(seven!.margin).toBe('7 percentage points');

    const rounded = formatAnalysisForContext(rawAnalysis({ margin_pp: 7.6 }));
    expect(rounded!.margin).toBe('8 percentage points');

    const one = formatAnalysisForContext(rawAnalysis({ margin_pp: 1 }));
    expect(one!.margin).toBe('1 percentage point');

    const zero = formatAnalysisForContext(rawAnalysis({ margin_pp: 0 }));
    expect(zero!).not.toHaveProperty('margin');

    const missing = formatAnalysisForContext(rawAnalysis({ margin_pp: null }));
    expect(missing!).not.toHaveProperty('margin');
  });

  it('passes robustness_band through verbatim', () => {
    for (const band of ['fragile', 'moderate', 'stable', 'highly_stable'] as const) {
      const out = formatAnalysisForContext(rawAnalysis({ robustness_band: band }));
      expect(out!.robustness_band).toBe(band);
    }
  });

  it('omits robustness_band when source is null', () => {
    const out = formatAnalysisForContext(rawAnalysis({ robustness_band: null }));
    expect(out!).not.toHaveProperty('robustness_band');
  });

  it('translates top_drivers into decision-language influence phrases', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        top_drivers: [
          rawDriver('Price', 1.0),
          rawDriver('Demand', -0.4),
          rawDriver('Risk', 0.85),
        ],
      }),
    );
    expect(out!.top_drivers).toEqual([
      { label: 'Price', influence: 'very strong positive influence' },
      { label: 'Demand', influence: 'moderate negative influence' },
      { label: 'Risk', influence: 'strong positive influence' },
    ]);
  });

  it('omits top_drivers when source is empty', () => {
    const out = formatAnalysisForContext(rawAnalysis({ top_drivers: [] }));
    expect(out!).not.toHaveProperty('top_drivers');
  });

  it('passes structured fragile_edges through — labels only, no numerics', () => {
    const fragile: ContextPackAnalysisFragileEdge[] = [
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
      { from_label: 'Pricing', to_label: 'Conversion' },
    ];
    const out = formatAnalysisForContext(rawAnalysis({ fragile_edges: fragile }));
    expect(out!.fragile_edges).toEqual([
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
      { from_label: 'Pricing', to_label: 'Conversion' },
    ]);
  });

  it('omits fragile_edges when the source array is empty', () => {
    const empty = formatAnalysisForContext(rawAnalysis({ fragile_edges: [] }));
    expect(empty!).not.toHaveProperty('fragile_edges');
  });

  it('full analysis: every field formatted together, no raw floats survive', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
      }),
    );
    expect(out).toEqual<DisplaySafeAnalysis>({
      status: 'complete',
      leading_option: { label: 'Option A', win_probability: '86%' },
      runner_up: { label: 'Option B', win_probability: '79%' },
      margin: '7 percentage points',
      robustness_band: 'moderate',
      top_drivers: [
        { label: 'Price', influence: 'very strong positive influence' },
        { label: 'Demand', influence: 'moderate negative influence' },
      ],
      fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
    });

    // Pattern check (regex from brief).
    expect(JSON.stringify(out)).not.toMatch(/\b0\.\d{2,}/);

    // Structural check (recursive walk — strongest invariant).
    assertNoNumbersAnywhere(out);
  });

  it('JSON.stringify recursively contains no raw floats', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        leading_option: { label: 'A', probability: 0.123456 },
        runner_up: { label: 'B', probability: 0.999 },
        margin_pp: 12.4,
        top_drivers: [rawDriver('F1', -0.55), rawDriver('F2', 0.1234)],
        fragile_edges: [{ from_label: 'X', to_label: 'Y' }],
      }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/\b0\.\d{2,}/);
    expect(json).not.toContain('sensitivity_value');
    expect(json).not.toContain('strength');
    expect(json).not.toContain('exists_probability');
    assertNoNumbersAnywhere(out);
  });
});

describe('influencePhrase', () => {
  it('classifies positive sensitivities by absolute magnitude', () => {
    expect(influencePhrase(1.0)).toBe('very strong positive influence');
    expect(influencePhrase(0.95)).toBe('very strong positive influence');
    expect(influencePhrase(0.94)).toBe('strong positive influence');
    expect(influencePhrase(0.7)).toBe('strong positive influence');
    expect(influencePhrase(0.5)).toBe('moderate positive influence');
    expect(influencePhrase(0.3)).toBe('moderate positive influence');
    expect(influencePhrase(0.29)).toBe('weak positive influence');
    expect(influencePhrase(0.05)).toBe('weak positive influence');
  });

  it('mirrors bands for negative sensitivities', () => {
    expect(influencePhrase(-0.85)).toBe('strong negative influence');
    expect(influencePhrase(-0.4)).toBe('moderate negative influence');
    expect(influencePhrase(-0.95)).toBe('very strong negative influence');
    expect(influencePhrase(-0.29)).toBe('weak negative influence');
  });

  it('treats near-zero sensitivities as no material influence (no sign)', () => {
    expect(influencePhrase(0.0)).toBe('no material influence');
    expect(influencePhrase(0.01)).toBe('no material influence');
    expect(influencePhrase(-0.02)).toBe('no material influence');
    expect(influencePhrase(0.04)).toBe('no material influence');
    expect(influencePhrase(-0.049)).toBe('no material influence');
  });

  it('non-finite sensitivities resolve to no material influence', () => {
    expect(influencePhrase(Number.NaN)).toBe('no material influence');
    expect(influencePhrase(Number.POSITIVE_INFINITY)).toBe('no material influence');
    expect(influencePhrase(Number.NEGATIVE_INFINITY)).toBe('no material influence');
  });
});

// brief brief-display-safe-analysis A2 — negative test
// Formatted analysis serialised through the Track 2A regex sanitiser must
// produce zero probability_rewrites and zero sensitivity_rewrites. Proves
// the upstream display-safe projection eliminates the defect class
// (raw decimals + raw sensitivities) that the post-compose rewriter targets.
describe('display-safe projection drives Track 2A rewrites to zero', () => {
  it('serialised display-safe analysis is invisible to the Track 2A regex sanitiser', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
      }),
    );
    const serialised = JSON.stringify(out, null, 2);
    const result = sanitiseAssistantTextProse(serialised);
    expect(result.probability_rewrites).toBe(0);
    expect(result.sensitivity_rewrites).toBe(0);
  });

  it('display-safe phrases verbatim do not match the sanitiser regexes', () => {
    const phrases = [
      '"86%"',
      '"79%"',
      '"7 percentage points"',
      '"very strong positive influence"',
      '"moderate negative influence"',
      '"no material influence"',
      '"weak positive influence"',
      '"strong negative influence"',
    ].join(' ');
    const result = sanitiseAssistantTextProse(phrases);
    expect(result.probability_rewrites).toBe(0);
    expect(result.sensitivity_rewrites).toBe(0);
  });
});
