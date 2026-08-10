/**
 * REQUEST-LEVEL scale homogeneity for the outbound PLoT payload.
 *
 * THE DEFECT (measured on the deployed quartet CEE cab59b7 / PLoT b9f6b5a / ISL
 * 28fe0c9, 2026-08-10). CEE's egress net answers "is this INTERVENTION raw or
 * normalised?" PER VALUE. PLoT's normalisation gate answers "is this REQUEST raw
 * or normalised?" PER REQUEST. Each is correct alone, and nothing named the two
 * questions apart.
 *
 * So a single factor promoted by rule 2 (`cap_denormalised`, e.g. a capability
 * factor at `{value: 0.35, raw_value: 35, cap: 100}` → 0.8 * 100 = 80) pushes the
 * request above 1 and flips PLoT into cap-normalisation for EVERY factor. The
 * cost interventions CEE deliberately left at unit scale (`ambiguous_no_evidence`
 * — their baselines are £0, and zero is scale-ambiguous, so they can never prove
 * the convention) are then divided by their caps: £0.72 / 25000 ≈ 0.0000288.
 *
 * CONSEQUENCE: the costly option becomes free while keeping its full capability
 * gain. Measured on 4 captured runs — P(Switch) inflated by mean +0.188 (0.7360 →
 * 0.9584 on pre-deploy/s3), the incumbent suppressed 4–7×, and these are exactly
 * the runs shipped as `robustness: high` / `confidence_tier: strong` with NO hedge.
 *
 * PROVEN BY EXECUTION against deployed PLoT b9f6b5a:
 *   all-unit-scale        0.72 / 0.8   → P(Switch) 0.7360333333333333
 *   all-raw-scale         18000 / 80   → P(Switch) 0.7360333333333333  (IDENTICAL)
 *   MIXED (what CEE sent) 0.72 / 80    → P(Switch) 0.9584333333333334  (the defect)
 *   mirror image          18000 / 0.8  → incumbent flips to winning, 0.7158
 * A self-consistent request gives the same answer in EITHER scale; only the mixed
 * request diverges. The mirror image is what proves the gate is REQUEST-level and
 * not per-factor — no amount of reading could settle that.
 *
 * THE FIX IS DEMOTE, and it is chosen for what it ASSUMES, not for the number:
 * promote would have to assert a normalised convention for factors that provably
 * cannot evidence it, so demote (suppress rule 2 for the request) assumes nothing
 * new. Both land on 0.7360 exactly — hence the equivalence pin below.
 *
 * Production rate before the fix, from the existing `intervention_scale_egress`
 * log over 2026-08-03 → 2026-08-10: 48/137 analyses (35.0%) firm-corrupted.
 * `raw_value_used` fired ZERO times in that window, so rule 2 is the only source
 * of >1 values in production.
 */
import { describe, it, expect } from 'vitest';

import {
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
  projectInterventionsToRawScale,
} from '../plot-intervention-scale.js';

// ---------------------------------------------------------------------------
// Fixture: the EXACT shape of captured run `pre-deploy/s3` (the divergent case).
// Bound by IDENTITY (factor ids + the observed_state that grants/denies the
// convention), never by a value predicate another factor could satisfy.
// ---------------------------------------------------------------------------
const CAPABILITY = 'fac_crm_capability';
const SWITCH_COST = 'fac_switch_cost';
const TRAINING = 'fac_training_investment';

/** Percentage-scale capability factor — PROVES the normalised convention (rule 2 fires). */
const capabilityNodePct = {
  id: CAPABILITY,
  kind: 'factor',
  observed_state: { value: 0.35, raw_value: 35, cap: 100, unit: 'scale' },
};
/** Unit-scale twin — raw_value === value, so `baselineRaw > baselineValue` FAILS: rule 2 does NOT fire. */
const capabilityNodeUnit = {
  id: CAPABILITY,
  kind: 'factor',
  observed_state: { value: 0.35, raw_value: 0.35, cap: 1, unit: 'scale' },
};
/** Cost factors baselined at £0 — zero is scale-ambiguous, so these can NEVER prove the convention. */
const costNodes = [
  { id: SWITCH_COST, kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 25000, unit: '£' } },
  { id: TRAINING, kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 10000, unit: '£' } },
];

const iv = (value: number) => ({ value, source: 'cee_hypothesis' });
/** The three captured options, verbatim magnitudes from pre-deploy/s3. */
const perOptionRawObjects = [
  { [SWITCH_COST]: iv(0.36), [TRAINING]: iv(0.3), [CAPABILITY]: iv(0.6) },
  { [SWITCH_COST]: iv(0), [TRAINING]: iv(0), [CAPABILITY]: iv(0.35) },
  { [SWITCH_COST]: iv(0.72), [TRAINING]: iv(0.6), [CAPABILITY]: iv(0.8) },
];

const project = (nodes: unknown[]) =>
  projectRequestInterventionsToWireScale(perOptionRawObjects, buildFactorScaleMap(nodes));

describe('projectRequestInterventionsToWireScale — request-level homogeneity (the 4/13 divergence)', () => {
  it('PIN THE PRECONDITION: the pct-scale fixture really does trigger rule 2 and the unit twin really does not', () => {
    // Without this the whole suite could pass while the fixture reproduces NOTHING
    // (trap 13b: a discriminator whose discrimination depends on an unpinned fixture).
    const pctRules = projectInterventionsToRawScale(
      perOptionRawObjects[2]!,
      buildFactorScaleMap([capabilityNodePct, ...costNodes]),
    ).conversions;
    expect(
      pctRules.find((c) => c.factor_id === CAPABILITY)?.rule,
      'pct-scale capability factor must resolve via cap_denormalised — otherwise this fixture proves nothing',
    ).toBe('cap_denormalised');
    expect(
      pctRules.find((c) => c.factor_id === SWITCH_COST)?.rule,
      'a £0-baselined cost factor must resolve via ambiguous_no_evidence — it cannot evidence the convention',
    ).toBe('ambiguous_no_evidence');

    const unitRules = projectInterventionsToRawScale(
      perOptionRawObjects[2]!,
      buildFactorScaleMap([capabilityNodeUnit, ...costNodes]),
    ).conversions;
    expect(
      unitRules.find((c) => c.factor_id === CAPABILITY)?.rule,
      'unit-scale capability twin must NOT trigger cap_denormalised — else the two arms are not discriminating',
    ).not.toBe('cap_denormalised');
  });

  it('demotes the whole request when rule 2 would leave unit-scale siblings behind', () => {
    const out = project([capabilityNodePct, ...costNodes]);

    expect(out.demoted, 'a mixed-scale request MUST be demoted to one scale').toBe(true);
    // The capability intervention is the one rule 2 promoted: it must come back to unit scale.
    expect(
      out.perOption[2]?.[CAPABILITY],
      'capability must be emitted at unit scale (0.8), not the rule-2 product 80',
    ).toBe(0.8);
    expect(out.perOption[0]?.[CAPABILITY]).toBe(0.6);
    expect(out.perOption[1]?.[CAPABILITY]).toBe(0.35);
    // The cost interventions were never promoted and must be untouched.
    expect(out.perOption[2]?.[SWITCH_COST], 'switching cost must stay at its drafted unit value').toBe(0.72);
    expect(out.perOption[2]?.[TRAINING]).toBe(0.6);
  });

  it('emits a HOMOGENEOUS request: after demotion no value exceeds 1, so PLoT skips normalisation', () => {
    const out = project([capabilityNodePct, ...costNodes]);
    const all = out.perOption.flatMap((o) => Object.values(o));
    expect(all.length, 'zero interventions would make this assertion vacuous').toBe(9);
    expect(
      all.every((v) => v <= 1),
      `every emitted value must be <= 1 so PLoT's request-level gate skips; got ${JSON.stringify(all)}`,
    ).toBe(true);
    expect(out.allWithinUnitInterval).toBe(true);
  });

  it('does NOT demote when EVERY capped factor proves the convention — a consistently-raw request is already coherent', () => {
    // Covers the second conjunct of the demote condition (`unitScaleSiblings`).
    // Without this the conjunct is a guard agreeing with itself: nothing would
    // notice if it were deleted, and deleting it would demote correct raw requests.
    const allProving = [
      capabilityNodePct,
      { id: SWITCH_COST, kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000, unit: '£' } },
      { id: TRAINING, kind: 'factor', observed_state: { value: 0.2, raw_value: 2000, cap: 10000, unit: '£' } },
    ];
    const map = buildFactorScaleMap(allProving);
    const rules = projectInterventionsToRawScale(perOptionRawObjects[2]!, map).conversions;
    // Pin the precondition: all three really do resolve via rule 2 here.
    expect(rules.every((c) => c.rule === 'cap_denormalised'), JSON.stringify(rules)).toBe(true);

    const out = projectRequestInterventionsToWireScale(perOptionRawObjects, map);
    expect(out.demoted, 'a consistently-raw request must NOT be demoted').toBe(false);
    expect(out.perOption[2]?.[CAPABILITY], 'capability stays raw at 80').toBe(80);
    expect(out.perOption[2]?.[SWITCH_COST], 'switching cost stays raw at 18000').toBe(18000);
    expect(out.allWithinUnitInterval, 'a raw request is coherent but NOT within [0,1]').toBe(false);
  });

  it('DISCRIMINATING TWIN: an already-homogeneous request is left byte-identical (the regression guard)', () => {
    // This is the half that matters most — the 9/13 that already reproduce must not move.
    const out = project([capabilityNodeUnit, ...costNodes]);
    expect(out.demoted, 'a request with no cap_denormalised must NOT be demoted').toBe(false);
    const legacy = perOptionRawObjects.map(
      (o) => projectInterventionsToRawScale(o, buildFactorScaleMap([capabilityNodeUnit, ...costNodes])).interventions,
    );
    expect(
      out.perOption,
      'an already-homogeneous request must be byte-identical to the pre-fix projection',
    ).toEqual(legacy);
  });

  it('EQUIVALENCE PIN: demote and promote agree, so a future change cannot silently pick the other convention', () => {
    // Measured against deployed PLoT b9f6b5a: all-unit and all-raw both give
    // P(Switch) = 0.7360333333333333. The wire values differ by exactly the cap.
    const out = project([capabilityNodePct, ...costNodes]);
    const caps: Record<string, number> = { [SWITCH_COST]: 25000, [TRAINING]: 10000, [CAPABILITY]: 100 };
    const promoted = out.perOption.map((o) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * caps[k]!])),
    );
    expect(promoted[2]?.[CAPABILITY], 'promote of the demoted value must recover the rule-2 product').toBe(80);
    expect(promoted[2]?.[SWITCH_COST]).toBe(18000);
    for (const opt of promoted) {
      for (const v of Object.values(opt)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('does NOT demote a genuinely user-stated raw scale (rule 1) — that would corrupt a stated magnitude', () => {
    // raw_value is the explicit user-scale field; CEE is not its author and must not rewrite it.
    // TRAINING stays unit-scale (ambiguous_no_evidence) so the request IS genuinely
    // mixed — otherwise this case would pass for the wrong reason (no mixture at all).
    const withStatedRaw = [
      { [SWITCH_COST]: { value: 0.72, raw_value: 18000 }, [TRAINING]: iv(0.6), [CAPABILITY]: iv(0.8) },
    ];
    const map = buildFactorScaleMap([capabilityNodePct, ...costNodes]);
    const out = projectRequestInterventionsToWireScale(withStatedRaw, map);
    // Pin the precondition: this payload really is mixed AND really does carry a stated raw > 1.
    const rules = projectInterventionsToRawScale(withStatedRaw[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === SWITCH_COST)?.rule).toBe('raw_value_used');
    expect(rules.find((c) => c.factor_id === TRAINING)?.rule).toBe('ambiguous_no_evidence');
    expect(rules.find((c) => c.factor_id === CAPABILITY)?.rule).toBe('cap_denormalised');
    expect(out.demoted, 'a request carrying an explicit raw_value must not be demoted').toBe(false);
    expect(out.perOption[0]?.[SWITCH_COST], 'a user-stated raw magnitude must survive verbatim').toBe(18000);
    expect(
      out.blockedByStatedRawScale,
      'the un-demotable mixed case must be surfaced, never silently shipped',
    ).toBe(true);
  });
});
