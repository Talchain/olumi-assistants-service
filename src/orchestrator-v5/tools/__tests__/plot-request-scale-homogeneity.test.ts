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
  isDemotionPostconditionViolated,
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
      out.mixedUnresolved,
      'the un-demotable mixed case must be surfaced, never silently shipped',
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The rules an earlier version of this decision could not see. Both are LIVE:
  // `DEFAULT_ENCODING_MAPS` writes categorical encodings onto option nodes at the
  // draft ingest boundary, and this module's own suite already pins
  // `{ value: 2, rule: 'encoded_verbatim' }`.
  // -------------------------------------------------------------------------
  const encodedIv = (value: number) => ({ value, value_type: 'categorical', encoding_map: { build: 0, buy: 1, outsource: 2 } });
  const CATEGORY = 'fac_build_vs_buy';
  const categoryNode = { id: CATEGORY, kind: 'factor', observed_state: { value: 1 } };

  it('A1: an ENCODED category above 1 flips the gate with no promotion — must be surfaced, never silently shipped', () => {
    const req = [{ [CATEGORY]: encodedIv(2), [SWITCH_COST]: iv(0.72) }];
    const map = buildFactorScaleMap([categoryNode, ...costNodes]);
    // Pin the precondition: the encoded value really does resolve verbatim, above 1.
    const rules = projectInterventionsToRawScale(req[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === CATEGORY)?.rule).toBe('encoded_verbatim');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.perOption[0]?.[CATEGORY], 'an encoded category must never be rewritten').toBe(2);
    expect(out.demoted, 'an encoded category is not ours to demote').toBe(false);
    expect(
      out.mixedUnresolved,
      'a request whose gate is flipped by an encoded category, stranding a unit-scale cost, MUST warn',
    ).toBe(true);
  });

  it('A2 (THE REGRESSION): encoded category + rule-2 promotion — must NOT demote, and must not undo a correct promotion', () => {
    // An earlier version demoted here, taking capability from a CORRECT 80 (→0.8 at
    // PLoT) to 0.8 (→0.008): correct-to-100x-suppressed, worse than doing nothing.
    const req = [{ [CATEGORY]: encodedIv(2), [CAPABILITY]: iv(0.8), [SWITCH_COST]: iv(0.72) }];
    const map = buildFactorScaleMap([categoryNode, capabilityNodePct, ...costNodes]);
    const rules = projectInterventionsToRawScale(req[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === CATEGORY)?.rule).toBe('encoded_verbatim');
    expect(rules.find((c) => c.factor_id === CAPABILITY)?.rule).toBe('cap_denormalised');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.demoted, 'must NOT demote when an un-ownable value above 1 is present').toBe(false);
    expect(
      out.perOption[0]?.[CAPABILITY],
      'capability must keep its correct raw value 80 — demoting it here is worse than the defect',
    ).toBe(80);
    expect(out.perOption[0]?.[CATEGORY]).toBe(2);
    expect(out.mixedUnresolved, 'still mixed and unresolved — must warn').toBe(true);
  });

  it('A3: a no_cap value ABOVE 1 is not a stranded unit-scale sibling — no un-achievable demote', () => {
    const NOCAP = 'fac_headcount';
    const req = [{ [NOCAP]: iv(5000), [CAPABILITY]: iv(0.8), [SWITCH_COST]: iv(0.72) }];
    const map = buildFactorScaleMap([{ id: NOCAP, kind: 'factor', observed_state: { value: 12 } }, capabilityNodePct, ...costNodes]);
    const rules = projectInterventionsToRawScale(req[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === NOCAP)?.rule).toBe('no_cap');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.demoted, 'demotion could never make this request homogeneous').toBe(false);
    expect(out.perOption[0]?.[CAPABILITY], 'the correct promotion must survive').toBe(80);
    expect(out.mixedUnresolved).toBe(true);
  });

  it('⭐ POSTCONDITION IS AN INVARIANT, not a log line: exhaustive differential over the whole rule space', () => {
    // Independently generated corpus — NOT the 13 captures, and not the reviewer's
    // numbers, which are deliberately not inherited. Every combination of the six
    // emitting rules across 2 options x 3 factors.
    const factorShapes: Record<string, { node: Record<string, unknown>; ivs: unknown[] }> = {
      provesConvention: { node: { id: 'f_a', kind: 'factor', observed_state: { value: 0.35, raw_value: 35, cap: 100 } }, ivs: [iv(0.8), iv(0.35), iv(0)] },
      zeroBaselineCap: { node: { id: 'f_b', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 25000 } }, ivs: [iv(0.72), iv(0.5), iv(0)] },
      noCap: { node: { id: 'f_c', kind: 'factor', observed_state: { value: 12 } }, ivs: [iv(5000), iv(0.5)] },
      encoded: { node: { id: 'f_d', kind: 'factor', observed_state: { value: 1 } }, ivs: [encodedIv(2), encodedIv(0), encodedIv(1)] },
      statedRaw: { node: { id: 'f_e', kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } }, ivs: [{ value: 0.72, raw_value: 18000 }, { value: 0.2, raw_value: 5000 }] },
      alreadyRaw: { node: { id: 'f_f', kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } }, ivs: [iv(9000), iv(0.4)] },
    };
    const names = Object.keys(factorShapes);
    const nodes = names.map((n) => factorShapes[n]!.node);
    const map = buildFactorScaleMap(nodes);

    let requests = 0;
    let demotedCount = 0;
    let demotedStillMixed = 0;
    let violations = 0;
    // every unordered TRIPLE of factor shapes x every intervention magnitude of each
    for (let i = 0; i < names.length; i++) {
      for (let j = i; j < names.length; j++) {
        for (let k = j; k < names.length; k++) {
          const A = factorShapes[names[i]!]!;
          const B = factorShapes[names[j]!]!;
          const C = factorShapes[names[k]!]!;
          for (const ivA of A.ivs) {
            for (const ivB of B.ivs) {
              for (const ivC of C.ivs) {
                const idA = A.node.id as string;
                const idB = B.node.id as string;
                const idC = C.node.id as string;
                const req = [{ [idA]: ivA, [idB]: ivB, [idC]: ivC }, { [idA]: ivA, [idC]: ivC }];
                const out = projectRequestInterventionsToWireScale(req, map);
                requests++;
                if (out.postconditionViolated) violations++;
                if (out.demoted) {
                  demotedCount++;
                  const flat = out.perOption.flatMap((o) => Object.values(o));
                  if (!flat.every((v) => v <= 1)) demotedStillMixed++;
                }
              }
            }
          }
        }
      }
    }
    console.log(`[differential] requests=${requests} demoted=${demotedCount} demotedStillMixed=${demotedStillMixed} postconditionViolations=${violations}`);
    // Assert the corpus is real before believing any agreement (trap 13).
    expect(requests, 'corpus must be non-trivial').toBeGreaterThan(200);
    expect(demotedCount, 'the corpus must actually exercise the demote path').toBeGreaterThan(0);
    // THE INVARIANT.
    expect(demotedStillMixed, 'every demoted request MUST end up within [0,1]').toBe(0);
    expect(violations, 'postcondition must never be violated').toBe(0);
  });

  it('⭐ DIFFERENTIAL: the fix never makes a factor worse than doing nothing', () => {
    // The failure this replaces was correct-to-100x-suppressed. So the guarantee we
    // assert is comparative, against the PRE-FIX projection, not absolute.
    const encoded = (v: number) => encodedIv(v);
    const cases: Array<[string, Record<string, unknown>[], Record<string, unknown>[]]> = [
      ['encoded+promotion+cost', [{ f_d: encoded(2), f_a: iv(0.8), f_b: iv(0.72) }], [{ id: 'f_d', kind: 'factor', observed_state: { value: 1 } }, { id: 'f_a', kind: 'factor', observed_state: { value: 0.35, raw_value: 35, cap: 100 } }, { id: 'f_b', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 25000 } }]],
      ['nocap+promotion+cost', [{ f_c: iv(5000), f_a: iv(0.8), f_b: iv(0.72) }], [{ id: 'f_c', kind: 'factor', observed_state: { value: 12 } }, { id: 'f_a', kind: 'factor', observed_state: { value: 0.35, raw_value: 35, cap: 100 } }, { id: 'f_b', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 25000 } }]],
    ];
    for (const [label, req, nodes] of cases) {
      const map = buildFactorScaleMap(nodes);
      const before = req.map((r) => projectInterventionsToRawScale(r, map).interventions);
      const after = projectRequestInterventionsToWireScale(req as Record<string, unknown>[], map).perOption;
      expect(Object.keys(before[0]!).length, `${label}: empty corpus would be vacuous`).toBeGreaterThan(0);
      expect(after, `${label}: an un-demotable request must be left exactly as the pre-fix projection had it`).toEqual(before);
    }
  });

  it('M8 DISCRIMINATOR: a no_cap value ABOVE 1 with no <=1 sibling strands nothing, so it must NOT warn', () => {
    // Without the `<= 1` numeric guard on stranded siblings this request would be
    // classified mixed and warn. Nothing here can be annihilated: the only sibling
    // has no cap for PLoT to divide by, and the promoted factor round-trips.
    const NOCAP = 'fac_headcount';
    const req = [{ [NOCAP]: iv(5000), [CAPABILITY]: iv(0.8) }];
    const map = buildFactorScaleMap([{ id: NOCAP, kind: 'factor', observed_state: { value: 12 } }, capabilityNodePct]);
    const rules = projectInterventionsToRawScale(req[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === NOCAP)?.rule).toBe('no_cap');
    expect(rules.find((c) => c.factor_id === CAPABILITY)?.rule).toBe('cap_denormalised');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.demoted).toBe(false);
    expect(out.perOption[0]?.[CAPABILITY], 'the correct promotion survives').toBe(80);
    expect(
      out.mixedUnresolved,
      'no sibling is stranded at unit scale, so there is nothing to warn about',
    ).toBe(false);
  });

  it('the demotion postcondition predicate is pinned directly (it is unreachable through the caller)', () => {
    expect(isDemotionPostconditionViolated(true, false), 'demote chosen + still mixed = violation').toBe(true);
    expect(isDemotionPostconditionViolated(true, true)).toBe(false);
    expect(isDemotionPostconditionViolated(false, false), 'no demote chosen = no claim made = no violation').toBe(false);
    expect(isDemotionPostconditionViolated(false, true)).toBe(false);
  });
});
