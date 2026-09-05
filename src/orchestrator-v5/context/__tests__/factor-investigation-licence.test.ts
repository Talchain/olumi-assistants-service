/**
 * factor-investigation-licence — "may the product invite the user to go and
 * investigate THIS factor?"
 *
 * ⭐ THE CORPUS IS NOT FROM THE AUTHOR'S HEAD (trap #22). Every numeric fixture
 * below is copied from producer output:
 *
 *   - the witnessed harm (deployed build, 2026-09-04 22:44–23:28Z): "Team
 *     coordination overhead", `sensitivity_score: -0.35`,
 *     `value_of_information: 0`, `flip_risk_category: "negligible"`,
 *     `rank_flip_rate: 0`, `evpi_method: "heuristic"`,
 *     `range_derivation_source: "default"`;
 *   - the 2026-09-03 live capture
 *     (`compose/__tests__/fixtures/analysis-result-live-2026-09-03.json`):
 *     "UK Market Saturation" carries `flip_risk_category: "negligible"` AND
 *     `rank_flip_rate: 0.25` — the two flip fields DISAGREE on real output, so
 *     the category alone must not license "nothing would change the order".
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY (factor_id / exact label), never by a
 * value predicate another factor could satisfy (trap #19). Each fixture below
 * carries a distinct id precisely so a passing test cannot be passing about
 * the wrong row.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyFactorInvestigation,
  deriveFactorInvestigationFromEnrichment,
  type FactorInvestigationSignal,
} from '../factor-investigation-licence.js';

/** The witnessed factor, byte-for-byte from the 2026-09-04 session. */
const WITNESSED_COORDINATION_OVERHEAD = {
  factor_id: 'coord-overhead-01',
  factor_label: 'Team coordination overhead',
  sensitivity_score: -0.35,
  value_of_information: 0,
  evpi_percentage_points: 0,
  evpi_method: 'heuristic',
  flip_risk_category: 'negligible',
  rank_flip_rate: 0,
  range_derivation_source: 'default',
} as const;

/** From the 2026-09-03 live capture — negligible category, NON-zero flip rate. */
const LIVE_UK_MARKET_SATURATION = {
  factor_id: '7355a203',
  factor_label: 'UK Market Saturation',
  sensitivity_score: 0.2891304347826087,
  value_of_information: 0,
  evpi_percentage_points: 0,
  evpi_method: 'heuristic',
  flip_risk_category: 'negligible',
  rank_flip_rate: 0.25,
  range_derivation_source: 'default',
} as const;

/** A factor the options themselves set — the DIFFERENT true sentence. */
const OPTION_CONTROLLED_INVESTMENT = {
  factor_id: 'investment-level-09',
  factor_label: 'Investment level',
  sensitivity_score: 0,
  value_of_information: 0,
  zero_reason: 'intervention_override',
  flip_risk_category: 'negligible',
  rank_flip_rate: 0,
} as const;

/** A factor that genuinely IS worth investigating — must keep today's behaviour. */
const INFORMATIVE_CHURN = {
  factor_id: 'churn-response-42',
  factor_label: 'Churn response to price',
  sensitivity_score: 0.41,
  value_of_information: 0.18,
  evpi_percentage_points: 4.2,
  evpi_method: 'monte_carlo',
  flip_risk_category: 'material',
  rank_flip_rate: 0.31,
  range_derivation_source: 'user_supplied',
} as const;

/** An older producer: no value-of-information field at all. */
const LEGACY_UNSCORED = {
  factor_id: 'legacy-factor-77',
  factor_label: 'Legacy factor',
  sensitivity_score: 0.22,
} as const;

function signalFor(
  signals: readonly FactorInvestigationSignal[],
  factorId: string,
): FactorInvestigationSignal {
  const found = signals.find((s) => s.factor_id === factorId);
  if (found === undefined) {
    throw new Error(`no signal for factor_id ${factorId} — fixture/binding drift`);
  }
  return found;
}

describe('classifyFactorInvestigation', () => {
  it('THE WITNESSED HARM: zero VoI + negligible flip + zero rank-flip ⇒ no_reordering_found', () => {
    expect(classifyFactorInvestigation({ ...WITNESSED_COORDINATION_OVERHEAD })).toBe(
      'no_reordering_found',
    );
  });

  it('a NON-ZERO rank_flip_rate refutes the reordering claim even when the category says negligible', () => {
    // Live producer output: the two fields disagree. The weaker verdict must win.
    expect(classifyFactorInvestigation({ ...LIVE_UK_MARKET_SATURATION })).toBe(
      'no_information_value',
    );
  });

  it('intervention_override is named APART from a generic zero, and wins over it', () => {
    // This entry ALSO has value_of_information: 0. If the generic zero won, the
    // specific and more useful sentence would be lost on exactly the factors
    // that have one.
    expect(classifyFactorInvestigation({ ...OPTION_CONTROLLED_INVESTMENT })).toBe(
      'option_controlled',
    );
  });

  it('a factor with real value of information stays informative — the gate must NOT suppress everything', () => {
    expect(classifyFactorInvestigation({ ...INFORMATIVE_CHURN })).toBe('informative');
  });

  it('ABSENCE IS NEVER ZERO: no VoI field at all ⇒ unscored, not no_information_value', () => {
    expect(classifyFactorInvestigation({ ...LEGACY_UNSCORED })).toBe('unscored');
  });

  it('a positive VoI is informative even when every flip field says negligible', () => {
    expect(
      classifyFactorInvestigation({
        factor_id: 'x',
        factor_label: 'x',
        value_of_information: 0.02,
        flip_risk_category: 'negligible',
        rank_flip_rate: 0,
      }),
    ).toBe('informative');
  });

  it('falls back to evpi_percentage_points only when value_of_information is absent', () => {
    expect(
      classifyFactorInvestigation({
        factor_id: 'y',
        factor_label: 'y',
        evpi_percentage_points: 0,
        flip_risk_category: 'negligible',
        rank_flip_rate: 0,
      }),
    ).toBe('no_reordering_found');
    expect(
      classifyFactorInvestigation({
        factor_id: 'y2',
        factor_label: 'y2',
        evpi_percentage_points: 3.4,
      }),
    ).toBe('informative');
  });

  it('an absent rank_flip_rate lets the negligible category carry the claim alone', () => {
    expect(
      classifyFactorInvestigation({
        factor_id: 'z',
        factor_label: 'z',
        value_of_information: 0,
        flip_risk_category: 'negligible',
      }),
    ).toBe('no_reordering_found');
  });

  it('zero VoI with NO flip evidence at all is the weaker verdict, not the stronger one', () => {
    expect(
      classifyFactorInvestigation({
        factor_id: 'w',
        factor_label: 'w',
        value_of_information: 0,
      }),
    ).toBe('no_information_value');
  });
});

describe('deriveFactorInvestigationFromEnrichment', () => {
  const enrichment = {
    factor_sensitivity: [
      WITNESSED_COORDINATION_OVERHEAD,
      LIVE_UK_MARKET_SATURATION,
      OPTION_CONTROLLED_INVESTMENT,
      INFORMATIVE_CHURN,
      LEGACY_UNSCORED,
    ],
  };

  it('classifies every row, bound by factor_id', () => {
    const signals = deriveFactorInvestigationFromEnrichment(enrichment);
    expect(signals).toHaveLength(5);
    expect(signalFor(signals, 'coord-overhead-01').verdict).toBe('no_reordering_found');
    expect(signalFor(signals, '7355a203').verdict).toBe('no_information_value');
    expect(signalFor(signals, 'investment-level-09').verdict).toBe('option_controlled');
    expect(signalFor(signals, 'churn-response-42').verdict).toBe('informative');
    expect(signalFor(signals, 'legacy-factor-77').verdict).toBe('unscored');
  });

  it('flags a heuristic/default-range basis so the honest sentence can disclose its own strength', () => {
    const signals = deriveFactorInvestigationFromEnrichment(enrichment);
    // heuristic method AND default range
    expect(signalFor(signals, 'coord-overhead-01').heuristic_basis).toBe(true);
    // monte_carlo + user_supplied ⇒ not heuristic
    expect(signalFor(signals, 'churn-response-42').heuristic_basis).toBe(false);
  });

  it('carries the label and tolerates a missing id without inventing one', () => {
    const signals = deriveFactorInvestigationFromEnrichment({
      factor_sensitivity: [{ factor_label: 'No id here', value_of_information: 0 }],
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.factor_id).toBeNull();
    expect(signals[0]?.factor_label).toBe('No id here');
  });

  it('returns empty for a malformed or absent envelope rather than throwing', () => {
    expect(deriveFactorInvestigationFromEnrichment(null)).toEqual([]);
    expect(deriveFactorInvestigationFromEnrichment(undefined)).toEqual([]);
    expect(deriveFactorInvestigationFromEnrichment({})).toEqual([]);
    expect(deriveFactorInvestigationFromEnrichment({ factor_sensitivity: 'nope' })).toEqual([]);
    expect(deriveFactorInvestigationFromEnrichment([])).toEqual([]);
  });

  it('skips unlabelled rows (nothing true can be said about a factor with no name)', () => {
    const signals = deriveFactorInvestigationFromEnrichment({
      factor_sensitivity: [{ factor_id: 'no-label', value_of_information: 0 }, null, 42],
    });
    expect(signals).toEqual([]);
  });
});
