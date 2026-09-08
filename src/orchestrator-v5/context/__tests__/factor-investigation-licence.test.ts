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

  // ═══════════════════════════════════════════════════════════════════════
  // F3 — ABSENCE IS NOT ZERO, ON THE FLIP FIELD TOO.
  //
  // This block replaces a test that asserted the OPPOSITE ("an absent
  // rank_flip_rate lets the negligible category carry the claim alone"). That
  // assertion pinned the defect: `foundNoReordering` read
  // `rankFlipRate === null ? true`, so a factor with NO flip measurement at all
  // received the STRONGEST verdict available.
  //
  // Both conjuncts fail open on absence, which is why one absence was not
  // enough to catch it:
  //   - `flip_risk_category` is PLoT's fragile-edge adjacency test and returns
  //     'negligible' from an EARLY RETURN when there are no fragile edges;
  //   - an absent `rank_flip_rate` is simply no measurement.
  // Two absences were being combined into a positive finding.
  //
  // MEASURED over the whole repo corpus (35 envelopes / 113 factor_sensitivity
  // rows, 2026-09-05): rows reaching `no_reordering_found` via an ABSENT rate
  // = 2 (both in analysis-result-live-2026-09-03.json, NEITHER carrying a
  // `flip_thresholds` row); rows reaching it on a PRESENT zero = 0. The
  // strongest claim the product can make was reachable ONLY through missing
  // evidence.
  // ═══════════════════════════════════════════════════════════════════════

  it('F3: an ABSENT rank_flip_rate is NOT stability — the negligible category cannot carry the claim alone', () => {
    expect(
      classifyFactorInvestigation({
        factor_id: 'z',
        factor_label: 'z',
        value_of_information: 0,
        flip_risk_category: 'negligible',
      }),
    ).toBe('no_information_value');
  });

  it('F3 OPPOSITE-DIRECTION TWIN: a PRESENT zero rank_flip_rate still earns the stronger verdict', () => {
    // The twin matters as much as the case above. A fix that closed the
    // absence hole by refusing the strong verdict ALWAYS would silence a
    // statement the producer genuinely licensed — a gap traded for a lie.
    // Identical entry, one field added.
    expect(
      classifyFactorInvestigation({
        factor_id: 'z',
        factor_label: 'z',
        value_of_information: 0,
        flip_risk_category: 'negligible',
        rank_flip_rate: 0,
      }),
    ).toBe('no_reordering_found');
  });

  it('F3: the two live 2026-09-03 rows that reached the strong claim on absent evidence now do not', () => {
    // Byte-for-byte from src/orchestrator-v5/compose/__tests__/fixtures/
    // analysis-result-live-2026-09-03.json — the rows the cold review named.
    // Bound by factor_id (trap #19: never by a value another row could match).
    for (const factorId of ['099f7ecf', '4fcb676f']) {
      expect(
        classifyFactorInvestigation({
          factor_id: factorId,
          factor_label: `live factor ${factorId}`,
          value_of_information: 0,
          evpi_percentage_points: 0,
          evpi_method: 'heuristic',
          flip_risk_category: 'negligible',
          // rank_flip_rate ABSENT, exactly as in the capture; and neither row
          // has a flip_thresholds entry, so no flip search was ever run.
        }),
      ).toBe('no_information_value');
    }
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

// ═════════════════════════════════════════════════════════════════════════
// THE MAGNITUDE — carried so a claim's strength can match its evidence.
//
// The exact-zero verdicts leave every positively-scored factor projected
// EXACTLY as before, which is the shape that produced the witnessed harm. The
// magnitude is strictly additive: it suppresses nothing and gates nothing.
// ═════════════════════════════════════════════════════════════════════════
describe('factor investigation — magnitude passthrough', () => {
  it('carries evpi_percentage_points and value_of_information on an INFORMATIVE factor', () => {
    const signals = deriveFactorInvestigationFromEnrichment({
      factor_sensitivity: [INFORMATIVE_CHURN],
    });
    const churn = signalFor(signals, 'churn-response-42');
    expect(churn.verdict).toBe('informative');
    expect(churn.evpi_percentage_points).toBe(4.2);
    expect(churn.value_of_information).toBe(0.18);
  });

  it('carries the magnitude on the zero-scored factors too, without changing their verdict', () => {
    const signals = deriveFactorInvestigationFromEnrichment({
      factor_sensitivity: [WITNESSED_COORDINATION_OVERHEAD],
    });
    const witnessed = signalFor(signals, 'coord-overhead-01');
    expect(witnessed.evpi_percentage_points).toBe(0);
    expect(witnessed.value_of_information).toBe(0);
    // OPPOSITE-DIRECTION TWIN of the additive claim: adding a magnitude must
    // not have moved the verdict this module already got right.
    expect(witnessed.verdict).toBe('no_reordering_found');
  });

  it('ABSENCE IS NOT ZERO: a producer that emitted no magnitude yields null, never 0', () => {
    const signals = deriveFactorInvestigationFromEnrichment({
      factor_sensitivity: [LEGACY_UNSCORED],
    });
    const legacy = signalFor(signals, 'legacy-factor-77');
    expect(legacy.verdict).toBe('unscored');
    // `null`, not `0` — the whole defect class this module exists to remove.
    expect(legacy.evpi_percentage_points).toBeNull();
    expect(legacy.value_of_information).toBeNull();
  });

  it('a non-finite magnitude is read as absent, not as a number', () => {
    const signals = deriveFactorInvestigationFromEnrichment({
      factor_sensitivity: [
        {
          factor_id: 'nan-factor',
          factor_label: 'NaN factor',
          value_of_information: 0.5,
          evpi_percentage_points: Number.NaN,
        },
      ],
    });
    const row = signalFor(signals, 'nan-factor');
    expect(row.evpi_percentage_points).toBeNull();
    // CONTRAST inside the same case: the finite sibling still arrives.
    expect(row.value_of_information).toBe(0.5);
  });
});
