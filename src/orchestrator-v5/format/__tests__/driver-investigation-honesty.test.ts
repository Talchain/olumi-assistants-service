/**
 * THE COMPOSITION SITE MUST SEE THE PRODUCER'S INVESTIGATION VERDICT.
 *
 * ⭐ THE WITNESSED HARM (deployed build, 2026-09-04 22:44–23:28Z). Across eight
 * analysis narrations the product's single actionable recommendation was always
 * "Team coordination overhead" — "run a short pilot", "could easily shift which
 * hiring option leads" — while the engine scored that same factor
 * `value_of_information: 0`, `flip_risk_category: "negligible"`,
 * `rank_flip_rate: 0`.
 *
 * ROOT CAUSE, at the bytes: `formatDriver` rendered `{label, influence}` and
 * nothing else, so the LLM was handed "moderate negative influence" with NO
 * counter-evidence. These tests pin that the display-safe projection now
 * carries the producer's own verdict beside the influence band.
 *
 * ⚠ THIS SUITE DOES NOT TEST LLM PROSE. It tests the DETERMINISTIC projection —
 * the only thing a test can bound. A regex over generated narration would be a
 * predicate over natural language, which this estate has repeatedly shown
 * oscillates (trap 22f).
 *
 * ⚠ ASSERTIONS BIND BY IDENTITY — each driver has a distinct label and the
 * lookup is by exact label, so a passing assertion cannot be passing about a
 * different driver (trap #19).
 */

import { describe, expect, it } from 'vitest';

import type { ContextPackAnalysis } from '../../context/context-pack-assembler.js';
import { formatAnalysisForContext } from '../format-analysis-for-context.js';

/**
 * Build a minimal analysis carrying the named drivers. Everything else is held
 * constant so a difference in the output is attributable to the drivers alone.
 */
function analysisWithDrivers(
  drivers: ContextPackAnalysis['top_drivers'],
): ContextPackAnalysis {
  return {
    status: 'ok',
    leading_option: { label: 'Hire a Tech Lead', probability: 0.58 },
    runner_up: { label: 'Hire two developers', probability: 0.42 },
    margin_pp: 16,
    robustness_band: 'moderate',
    top_drivers: drivers,
    fragile_edges: [],
  };
}

function driverNamed(
  out: ReturnType<typeof formatAnalysisForContext>,
  label: string,
): Record<string, unknown> {
  const found = (out?.top_drivers ?? []).find(
    (d) => (d as { label: string }).label === label,
  );
  if (found === undefined) {
    throw new Error(`driver "${label}" absent from the projection — binding drift`);
  }
  return found as unknown as Record<string, unknown>;
}

describe('display-safe drivers carry the producer investigation verdict', () => {
  it('THE WITNESSED CASE: a zero-VoI, no-reordering driver says what IS true, and does not go silent', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        {
          factor_label: 'Team coordination overhead',
          sensitivity_value: -0.35,
          investigation_verdict: 'no_reordering_found',
          investigation_basis_heuristic: true,
        },
      ]),
    );
    const driver = driverNamed(out, 'Team coordination overhead');

    // The influence band is UNCHANGED — this factor really does matter to the
    // outcome. What changes is that the model can no longer infer "so go and
    // investigate it".
    expect(driver.influence).toBe('moderate negative influence');

    const investigation = String(driver.investigation ?? '');
    expect(investigation.length).toBeGreaterThan(0);
    // The true statement is available and must be made.
    expect(investigation).toContain('nothing we tested would change which option leads');
    // The heuristic basis is disclosed rather than asserted as settled fact.
    expect(investigation).toContain('heuristic');
  });

  it('a NON-ZERO VoI driver keeps today\'s behaviour — the gate must not suppress everything', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        {
          factor_label: 'Churn response to price',
          sensitivity_value: 0.41,
          investigation_verdict: 'informative',
        },
      ]),
    );
    const driver = driverNamed(out, 'Churn response to price');
    // Band derived from `influence-bands.ts` (|v| in [0.3, 0.7) ⇒ moderate),
    // not from the author's head — trap 13c.
    expect(driver.influence).toBe('moderate positive influence');
    // Key ABSENT, not an empty string: byte-identical to the pre-fix projection.
    expect('investigation' in driver).toBe(false);
  });

  it('an option-controlled factor gets a DIFFERENT sentence, not the generic one', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        {
          factor_label: 'Investment level',
          sensitivity_value: 0,
          investigation_verdict: 'option_controlled',
        },
      ]),
    );
    const investigation = String(driverNamed(out, 'Investment level').investigation ?? '');
    expect(investigation).toContain('every option sets its own value');
    // It is NOT the uninformative sentence — this factor is not free to vary,
    // which is a different fact with a different remedy.
    expect(investigation).not.toContain('nothing we tested would change which option leads');
  });

  it('zero VoI WITHOUT a settled ordering makes the weaker claim only', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        {
          factor_label: 'UK Market Saturation',
          sensitivity_value: 0.29,
          investigation_verdict: 'no_information_value',
          investigation_basis_heuristic: true,
        },
      ]),
    );
    const investigation = String(driverNamed(out, 'UK Market Saturation').investigation ?? '');
    expect(investigation).toContain('no measured value');
    // Must NOT overclaim that the ordering is settled — the producer's own
    // rank_flip_rate (0.25 in the live capture) refutes that.
    expect(investigation).not.toContain('nothing we tested would change which option leads');
  });

  it('an unscored driver (older producer) is byte-identical to the pre-fix projection', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        { factor_label: 'Legacy factor', sensitivity_value: 0.22, investigation_verdict: 'unscored' },
      ]),
    );
    expect(driverNamed(out, 'Legacy factor')).toEqual({
      label: 'Legacy factor',
      influence: 'weak positive influence',
    });
  });

  it('a driver with NO verdict field at all is byte-identical to the pre-fix projection', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([{ factor_label: 'Untouched', sensitivity_value: 0.22 }]),
    );
    expect(driverNamed(out, 'Untouched')).toEqual({
      label: 'Untouched',
      influence: 'weak positive influence',
    });
  });

  it('DISCRIMINATION: two drivers in one analysis get their OWN verdicts, not a shared one', () => {
    // The pair is the point: a projection that stamped every driver with the
    // same phrase would pass each single-driver test above and fail here.
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        {
          factor_label: 'Team coordination overhead',
          sensitivity_value: -0.35,
          investigation_verdict: 'no_reordering_found',
          investigation_basis_heuristic: true,
        },
        {
          factor_label: 'Churn response to price',
          sensitivity_value: 0.41,
          investigation_verdict: 'informative',
        },
      ]),
    );
    expect(String(driverNamed(out, 'Team coordination overhead').investigation ?? '')).toContain(
      'nothing we tested would change which option leads',
    );
    expect('investigation' in driverNamed(out, 'Churn response to price')).toBe(false);
  });

  it('the no-raw-numbers invariant still holds for the new field', () => {
    const out = formatAnalysisForContext(
      analysisWithDrivers([
        {
          factor_label: 'Team coordination overhead',
          sensitivity_value: -0.35,
          investigation_verdict: 'no_reordering_found',
          investigation_basis_heuristic: true,
        },
      ]),
    );
    const investigation = driverNamed(out, 'Team coordination overhead').investigation;
    expect(typeof investigation).toBe('string');
    expect(String(investigation)).not.toMatch(/\d/);
  });
});
