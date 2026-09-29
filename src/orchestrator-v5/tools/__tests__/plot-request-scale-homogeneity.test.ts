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

  it('a CONSISTENT stated pair demotes to its own unit form; an INCONSISTENT one blocks (round-4 refinement)', () => {
    // ROUND 4 SEMANTICS REFINEMENT (was: "never demote a stated raw_value").
    // A consistent pair — value ∈ [0,1] with value * cap ≈ raw_value — is the
    // SAME magnitude in two scales, by the author's own hand. Emitting the unit
    // form is not a rewrite: PLoT was proven (live, b9f6b5a) to produce
    // identical results for the all-unit and all-raw forms of a coherent
    // request. What is genuinely not ours to touch is a pair whose halves
    // DISAGREE — there the true magnitude is unknown, and the request blocks.
    const map = buildFactorScaleMap([capabilityNodePct, ...costNodes]);

    // Consistent: 0.72 * 25000 = 18000 → demotable to 0.72; request coherent.
    const consistent = [
      { [SWITCH_COST]: { value: 0.72, raw_value: 18000 }, [TRAINING]: iv(0.6), [CAPABILITY]: iv(0.8) },
    ];
    const okOut = projectRequestInterventionsToWireScale(consistent, map);
    expect(okOut.demoted, 'a consistent pair must demote with its promoted siblings').toBe(true);
    expect(okOut.perOption[0]?.[SWITCH_COST], 'the unit form of the SAME stated magnitude').toBe(0.72);
    expect(okOut.perOption[0]?.[CAPABILITY]).toBe(0.8);
    expect(okOut.mixedUnresolved).toBe(false);
    expect(okOut.allWithinUnitInterval).toBe(true);

    // Inconsistent: 0.5 * 25000 = 12500 ≠ 18000 → the true magnitude is
    // unknown; nothing may be demoted and the request is surfaced unresolved.
    const inconsistent = [
      { [SWITCH_COST]: { value: 0.5, raw_value: 18000 }, [TRAINING]: iv(0.6), [CAPABILITY]: iv(0.8) },
    ];
    const badOut = projectRequestInterventionsToWireScale(inconsistent, map);
    expect(badOut.demoted, 'an inconsistent pair must block the demote').toBe(false);
    expect(badOut.perOption[0]?.[SWITCH_COST], 'the stated raw survives verbatim').toBe(18000);
    expect(badOut.mixedUnresolved, 'must be surfaced, never silently shipped').toBe(true);
    expect(badOut.unresolvedFactorIds, 'the fixable factor must be named').toContain(SWITCH_COST);
  });

  // -------------------------------------------------------------------------
  // The rules an earlier version of this decision could not see. Both are LIVE:
  // `DEFAULT_ENCODING_MAPS` writes categorical encodings onto option nodes at the
  // draft ingest boundary, and this module's own suite already pins
  // `{ value: 2, rule: 'encoded_verbatim' }`.
  // -------------------------------------------------------------------------
  const encodedIv = (value: number) => ({
    value,
    raw_value: value === 0 ? 'build' : value === 1 ? 'buy' : 'outsource',
    value_type: 'categorical',
    encoding_map: { build: 0, buy: 1, outsource: 2 },
  });
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
      // NEGATIVE magnitudes — reachable via decrease/reduce/cut/lower phrasing, and
      // already pinned by this module's own suite as `{value: -0.4} -> passthrough`.
      // PLoT's gate is `value < 0 || value > 1`, so these trip it exactly as >1 does.
      negative: { node: { id: 'f_g', kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } }, ivs: [iv(-0.4), iv(-2), iv(0.4)] },
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
                  // SPEC, not failure mode: [0,1], both bounds.
                  if (!flat.every((v) => v >= 0 && v <= 1)) demotedStillMixed++;
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

  it('⭐ DIFFERENTIAL: BOTH branches of the guarantee, over the whole corpus including negatives', () => {
    // The previous version of this test asserted `after === before` over two
    // UN-DEMOTABLE cases. That can only hold where no demotion fires, so it was
    // structurally incapable of observing a harmful demote — a guard agreeing with
    // itself. The guarantee has two branches and both must be exercised:
    //   demoted   -> the request ends fully within [0,1] (it achieved its purpose)
    //   otherwise -> output is byte-identical to the pre-fix projection (no harm)
    const shapes: Array<{ node: Record<string, unknown>; ivs: unknown[] }> = [
      { node: { id: 'g_a', kind: 'factor', observed_state: { value: 0.35, raw_value: 35, cap: 100 } }, ivs: [iv(0.8), iv(0.2)] },
      { node: { id: 'g_b', kind: 'factor', observed_state: { value: 0, raw_value: 0, cap: 25000 } }, ivs: [iv(0.72), iv(0)] },
      { node: { id: 'g_c', kind: 'factor', observed_state: { value: 12 } }, ivs: [iv(5000), iv(0.5)] },
      { node: { id: 'g_d', kind: 'factor', observed_state: { value: 1 } }, ivs: [encodedIv(2), encodedIv(1)] },
      { node: { id: 'g_e', kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } }, ivs: [iv(-0.4), iv(-2), iv(0.4)] },
    ];
    const map = buildFactorScaleMap(shapes.map((x) => x.node));
    let demotedBranch = 0;
    let identicalBranch = 0;
    let negativeSeen = 0;
    for (let i = 0; i < shapes.length; i++) {
      for (let j = 0; j < shapes.length; j++) {
        for (const a of shapes[i]!.ivs) {
          for (const b of shapes[j]!.ivs) {
            const req = [{ [shapes[i]!.node.id as string]: a, [shapes[j]!.node.id as string]: b }];
            const before = req.map((r) => projectInterventionsToRawScale(r, map).interventions);
            const out = projectRequestInterventionsToWireScale(req, map);
            const flat = out.perOption.flatMap((o) => Object.values(o));
            if (flat.some((v) => v < 0)) negativeSeen++;
            if (out.demoted) {
              demotedBranch++;
              expect(flat.every((v) => v >= 0 && v <= 1), `demoted but outside [0,1]: ${JSON.stringify(out.perOption)}`).toBe(true);
            } else {
              identicalBranch++;
              expect(out.perOption, 'not demoted, so it must equal the pre-fix projection').toEqual(before);
            }
          }
        }
      }
    }
    // Both branches must actually be exercised, and negatives must be present —
    // otherwise this test is blind in exactly the way its predecessor was.
    expect(demotedBranch, 'the demoted branch must be exercised').toBeGreaterThan(0);
    expect(identicalBranch, 'the identical branch must be exercised').toBeGreaterThan(0);
    expect(negativeSeen, 'the corpus MUST contain negative magnitudes').toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------

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

  it('by_rule_above_one makes the A1 corruption DERIVABLE from the diagnostic (it used to classify CLEAN)', () => {
    // The pre-existing diagnostic carried rule COUNTS and factor ids and no magnitudes,
    // so it could not tell that an encoded `2` had crossed PLoT's gate threshold. This
    // request has zero cap_denormalised, so the old classifier scored it CLEAN while a
    // £0-baselined cost was being divided by 25000.
    const req = [{ [CATEGORY]: encodedIv(2), [SWITCH_COST]: iv(0.72) }];
    const map = buildFactorScaleMap([categoryNode, ...costNodes]);
    const out = projectRequestInterventionsToWireScale(req, map);

    expect(out.outsideUnitIntervalByRule, 'the encoded category outside [0,1] must be counted, by rule').toEqual({
      encoded_verbatim: 1,
    });
    // The classifier a log consumer can now write, with no magnitudes involved:
    const anyOutside = Object.values(out.outsideUnitIntervalByRule).reduce((a, b) => a + b, 0) > 0;
    const strandedSibling = out.conversions.some((c) => c.rule === 'ambiguous_no_evidence');
    expect(anyOutside && strandedSibling, 'A1 must now classify as CORRUPTED').toBe(true);
  });

  it('by_rule_above_one carries counts only, and is empty for a genuinely clean request', () => {
    const map = buildFactorScaleMap([capabilityNodeUnit, ...costNodes]);
    const out = projectRequestInterventionsToWireScale(perOptionRawObjects, map);
    expect(out.outsideUnitIntervalByRule, 'an all-unit-scale request has nothing outside [0,1]').toEqual({});
    // Magnitude-free: every value in the record is a count, never a magnitude.
    for (const v of Object.values(out.outsideUnitIntervalByRule)) expect(Number.isInteger(v)).toBe(true);
  });

  it('counts the EMITTED values, so a successful demotion leaves nothing above 1', () => {
    // pre-deploy/s3 shape: rule 2 promotes capability to 80, then demotion undoes it.
    const out = projectRequestInterventionsToWireScale(
      perOptionRawObjects,
      buildFactorScaleMap([capabilityNodePct, ...costNodes]),
    );
    expect(out.demoted).toBe(true);
    expect(
      out.outsideUnitIntervalByRule,
      'after a successful demote nothing reaches PLoT outside [0,1], so the count must be empty',
    ).toEqual({});
  });

  it('⭐ NEGATIVE CLASS: a negative magnitude is undemotable and must NOT be reported as clean', () => {
    // PLoT's gate is sign-symmetric (`value < 0 || value > 1`), so -0.4 flips it exactly
    // as 80 does. An earlier revision tested only `> 1`, demoted anyway, and drove a
    // £72,000 cost from a CORRECT 0.72 to 0.0000072 — 100,000x suppressed — while
    // self-reporting demoted:true, mixedUnresolved:false, allWithinUnitInterval:true.
    const NEG = 'fac_headcount_change';
    const COSTBIG = 'fac_migration_cost';
    const nodes = [
      { id: NEG, kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } },
      { id: COSTBIG, kind: 'factor', observed_state: { value: 0.35, raw_value: 35000, cap: 100000 } },
      ...costNodes,
    ];
    const map = buildFactorScaleMap(nodes);
    const req = [{ [NEG]: iv(-0.4), [COSTBIG]: iv(0.72), [SWITCH_COST]: iv(0.3) }];
    // Pin the precondition: the negative really does resolve to a passthrough below 0.
    const rules = projectInterventionsToRawScale(req[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === NEG)?.rule).toBe('passthrough');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.demoted, 'a negative is a magnitude CEE does not own — must NOT demote').toBe(false);
    expect(out.perOption[0]?.[NEG], 'the negative must survive verbatim').toBe(-0.4);
    expect(out.perOption[0]?.[COSTBIG], 'the correct promotion must survive').toBe(72000);
    expect(
      out.allWithinUnitInterval,
      'a request carrying -0.4 is NOT within [0,1] — reporting true here is the whole defect',
    ).toBe(false);
    expect(out.outsideUnitIntervalByRule, 'the negative must be counted').toEqual({
      passthrough: 1,
      cap_denormalised: 1,
    });
    expect(out.mixedUnresolved, 'must be surfaced, not silently shipped as clean').toBe(true);
  });

  it('the postcondition is written against the SPEC [0,1], so it sees a negative', () => {
    expect(isDemotionPostconditionViolated(true, false)).toBe(true);
    // Guard the exact asymmetry that shipped: a wire holding -0.4 must not read "within".
    const map = buildFactorScaleMap([{ id: 'n1', kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } }, capabilityNodePct, ...costNodes]);
    const out = projectRequestInterventionsToWireScale([{ n1: iv(-0.4), [CAPABILITY]: iv(0.8), [SWITCH_COST]: iv(0.3) }], map);
    expect(out.allWithinUnitInterval).toBe(false);
  });

  it('M12 DISCRIMINATOR: a request whose ONLY out-of-range value is NEGATIVE must not read "within [0,1]"', () => {
    // The previous negative test also carried 72000, so `v <= 1` was already false and
    // the LOWER bound was never exercised — the test could not tell the two predicates
    // apart. Here nothing exceeds 1, so only a sign-symmetric bound can be correct.
    // This is exactly the shape where CEE self-reported wire_all_within_unit_interval: true.
    const NEG = 'fac_headcount_change';
    const map = buildFactorScaleMap([
      { id: NEG, kind: 'factor', observed_state: { value: 0.2, raw_value: 5000, cap: 25000 } },
      ...costNodes,
    ]);
    const req = [{ [NEG]: iv(-0.4), [SWITCH_COST]: iv(0.3) }];
    const out = projectRequestInterventionsToWireScale(req, map);
    const flat = out.perOption.flatMap((o) => Object.values(o));
    // Pin the precondition: nothing here is above 1, so `v <= 1` alone would pass.
    expect(flat.some((v) => v > 1), 'no value may exceed 1 or this stops discriminating').toBe(false);
    expect(flat.some((v) => v < 0), 'a negative must be present').toBe(true);
    expect(
      out.allWithinUnitInterval,
      'the wire holds -0.4; reporting it as within [0,1] is the exact defect that shipped',
    ).toBe(false);
    expect(out.outsideUnitIntervalByRule, 'the negative must be counted').toEqual({ passthrough: 1 });
  });

  it('M14 DISCRIMINATOR: a NEGATIVE no_cap sibling strands nothing, so it must not warn', () => {
    // Without the `>= 0` lower bound on stranded siblings this would classify as mixed
    // and warn. Nothing is annihilated: the sibling has no cap to be divided by, and
    // the promoted factor round-trips.
    const NOCAP = 'fac_headcount_change';
    const map = buildFactorScaleMap([
      { id: NOCAP, kind: 'factor', observed_state: { value: 12 } },
      capabilityNodePct,
    ]);
    const req = [{ [NOCAP]: iv(-0.4), [CAPABILITY]: iv(0.8) }];
    const rules = projectInterventionsToRawScale(req[0]!, map).conversions;
    expect(rules.find((c) => c.factor_id === NOCAP)?.rule).toBe('no_cap');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.perOption[0]?.[CAPABILITY], 'the correct promotion survives').toBe(80);
    expect(out.perOption[0]?.[NOCAP]).toBe(-0.4);
    expect(out.demoted).toBe(false);
    expect(
      out.mixedUnresolved,
      'a negative no_cap sibling is not stranded at unit scale — nothing to warn about',
    ).toBe(false);
  });

  it('an ENCODED code outside [0,1] is unresolvable even with no stranded sibling — it fires the gate and is rescaled by it', () => {
    // Measured at PLoT b9f6b5a: {f_pv: 80000, f_en: 2} fires the gate and ISL
    // receives the code as 1 — "outsource" silently became "buy". No demote can
    // help (a code has no unit form), and no stranded sibling is needed for the
    // corruption: the code corrupts ITSELF.
    const map = buildFactorScaleMap([capabilityNodePct, categoryNode]);
    const req = [{ [CAPABILITY]: iv(0.8), [CATEGORY]: encodedIv(2) }];
    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.demoted).toBe(false);
    expect(out.mixedUnresolved, 'a code that cannot cross the wire faithfully must be surfaced').toBe(true);
    expect(out.unresolvedFactorIds).toContain(CATEGORY);

    // Twin: the same code WITHIN [0,1] beside the same promotion is stranded-
    // mixed (already covered) — and codes 0/1 with no outside sibling ship fine.
    const okReq = [{ [CATEGORY]: encodedIv(1) }];
    const okOut = projectRequestInterventionsToWireScale(okReq, map);
    expect(okOut.mixedUnresolved, 'a code within [0,1] with no gate-firing sibling is fine').toBe(false);
  });

  it('M20 DISCRIMINATOR: the same-factor exemption applies to NO-CAP factors only — a CAPPED ambiguous factor is stranded even when it fires the gate itself', () => {
    // Why the asymmetry is real, derived from PLoT deriveRange (b9f6b5a):
    //   - a NO-CAP factor normalises by a range derived from its OWN values
    //     (spread/baseline tiers) — values on both sides of 1 are treated
    //     coherently within their own scale;
    //   - a CAPPED factor ALWAYS divides by its cap (tier 0, authoritative).
    //     An unproven 0.72 on a 25000-cap factor is annihilated to 0.0000288
    //     no matter WHICH factor fired the gate — including its own.
    // Widening the exemption to capped factors ships exactly that corruption.
    const map = buildFactorScaleMap(costNodes); // f: cap 25000, £0 baseline (no evidence)
    const req = [
      { [SWITCH_COST]: iv(1.2) },  // raw-looking on the SAME factor — fires the gate
      { [SWITCH_COST]: iv(0.72) }, // unproven [0,1] on the SAME factor
    ];
    const rules = req.map((r) => projectInterventionsToRawScale(r, map).conversions[0]?.rule);
    expect(rules[0]).toBe('passthrough');
    expect(rules[1]).toBe('ambiguous_no_evidence');

    const out = projectRequestInterventionsToWireScale(req, map);
    expect(out.demoted).toBe(false);
    expect(
      out.mixedUnresolved,
      'a capped ambiguous value is cap-divided regardless of which factor fired the gate — must be surfaced',
    ).toBe(true);

    // The exemption's positive half stays pinned: the same shape on a NO-CAP
    // factor ships raw (its range derives from its own values).
    const noCapMap = buildFactorScaleMap([{ id: SWITCH_COST, kind: 'factor', observed_state: { value: 12 } }]);
    const noCapOut = projectRequestInterventionsToWireScale(req, noCapMap);
    expect(noCapOut.mixedUnresolved, 'a no-cap factor with values astride 1 declares its own raw-ness').toBe(false);
  });

  it('⭐ RATIFIED (round 5): a USER-AUTHORED no-cap factor astride 1 is INTENDED relative-comparison semantics — never blocked', () => {
    // PINNED SO THE NEXT LANE CANNOT RE-LITIGATE THIS BLIND.
    //
    // A round-4b attempt removed the same-factor exemption outright, on the
    // reading that PLoT "corrupts" the unit-scale member of such a pair. Measured
    // against the real normaliser at b9f6b5a7, values [1.2, 0.9] on a no-cap
    // factor:  deriveRange -> { min: 0.84, max: 1.26, source: 'inferred_spread' }
    //          ISL receives 0.857 and 0.1428 — ORDERING PRESERVED, ratios not.
    // A no-cap factor has NO absolute reference; PLoT deliberately derives one
    // from the values themselves and denormalises outputs on the way back. So
    // "ISL must receive 0.9 verbatim" was an ASSUMPTION, never a stated contract,
    // and this is ratified as intended relative comparison (orchestrator ruling,
    // round 5). Removing the exemption broke 102 tests across 8 files on exactly
    // this shape — `{ fac_price: 1.2 }` vs `{ fac_price: 0.9 }`, the most ordinary
    // two-option comparison in the product.
    //
    // The deeper ISL no-cap semantics write-up is rowed to PR2, not to this lane.
    const noCapMap = buildFactorScaleMap([{ id: SWITCH_COST, kind: 'factor', observed_state: { value: 12 } }]);
    const req = [{ [SWITCH_COST]: iv(1.2) }, { [SWITCH_COST]: iv(0.9) }];
    // PIN THE PRECONDITION: both emissions are no_cap and they really do straddle 1.
    const rules = req.map((r) => projectInterventionsToRawScale(r, noCapMap).conversions[0]?.rule);
    expect(rules).toEqual(['no_cap', 'no_cap']);

    const out = projectRequestInterventionsToWireScale(req, noCapMap);
    expect(
      out.mixedUnresolved,
      'a user-authored value set defines its own comparison frame — blocking it is the round-4b regression',
    ).toBe(false);
    expect(out.demoted, 'and nothing is rewritten').toBe(false);
  });

  it('⭐ M20c (round 5): a CEE-SYNTHESISED value must not establish the scale frame for a user value', () => {
    // THE RULING: a value CEE manufactured is not evidence about the user's request.
    //
    // `gateAnalysableOptions` fills an unconfigured option from each factor's
    // observed_state, so a no-cap factor gains CEE's own raw neutral (12) beside the
    // user's unit-scale 0.5. That placeholder then satisfied the same-factor
    // exemption — CEE manufacturing the evidence that exempted the user's value from
    // protection. Measured against real PLoT b9f6b5a7: the user's 0.5 reaches ISL as
    // 0.03496 (14.3x suppression) while CEE self-reported `mixedUnresolved: false`.
    //
    // Note the contrast with the RATIFIED case directly above: identical wire
    // numbers, opposite verdicts — because the difference is PROVENANCE, not shape.
    const noCapNode = { id: SWITCH_COST, kind: 'factor', observed_state: { value: 12 } };
    const map = buildFactorScaleMap([capabilityNodePct, noCapNode]);
    const req = [
      { [CAPABILITY]: iv(0.8), [SWITCH_COST]: iv(0.5) },                        // the user's option
      { [CAPABILITY]: { value: 0.35, raw_value: 35 }, [SWITCH_COST]: iv(12) },  // scaffolded neutrals
    ];
    // PIN THE PRECONDITIONS: the user's 0.5 reaches the wire unpromoted, and the
    // synthesised neutral really is the value pushing the factor outside [0,1].
    expect(projectInterventionsToRawScale(req[0]!, map).interventions[SWITCH_COST]).toBe(0.5);
    expect(projectInterventionsToRawScale(req[1]!, map).interventions[SWITCH_COST]).toBe(12);

    // Option index 1 is CEE-synthesised in its entirety.
    const out = projectRequestInterventionsToWireScale(req, map, [
      new Set<string>(),
      new Set([CAPABILITY, SWITCH_COST]),
    ]);
    expect(
      out.mixedUnresolved,
      "a scaffolded placeholder is not a declaration — the user's unit-scale value is still stranded",
    ).toBe(true);
    expect(out.unresolvedFactorIds, 'the ask must name the factor the user can fix').toContain(SWITCH_COST);
  });

  /**
   * ⭐ THE PER-OPTION COUNT IS INDEXED BY `optionIndex`, NOT BY A REFERENCE SCAN.
   *
   * `outsideUnitIntervalByRule` used to look its emitted map up with
   * `perOption[resolved.indexOf(entries)]` — an O(n) reference scan per
   * intervention. It now reads the `optionIndex` stamped on every entry at
   * pass 1.
   *
   * ⚠ THIS IS A PARITY PIN, NOT A DISCRIMINATING MUTANT, AND SAYING SO IS THE
   * POINT (trap 13c). `resolved` is built with `.map`, so every option's entry
   * array is a FRESH reference and `indexOf` could never have returned the
   * wrong index in practice — the old form was correct, merely quadratic and
   * one aliasing away from being wrong. So no mutant bites this line, and a
   * reader must not infer from a green suite that the index is guarded. What
   * this test DOES buy is that the per-option counting stays correct on a
   * MULTI-OPTION request whose options emit DIFFERENT values on the same
   * factors — computed here from the emitted maps independently of the
   * production counter, so a future indexing change that consulted the wrong
   * option's map would RED.
   */
  it('counts outside-unit-interval emissions per option, indexed by optionIndex', () => {
    const map = buildFactorScaleMap([capabilityNodePct, ...costNodes]);

    // A request that is NOT demotable, so the promoted values survive to the
    // count: an explicit raw_value CEE does not own blocks the demote.
    const req = [
      { [CAPABILITY]: iv(0.6), [SWITCH_COST]: { value: 0.36, raw_value: 9000 } },
      { [CAPABILITY]: iv(0.35), [SWITCH_COST]: { value: 0.5, raw_value: 12500 } },
      { [CAPABILITY]: iv(0.8), [TRAINING]: { value: 0.6, raw_value: 6000 } },
    ];
    const out = projectRequestInterventionsToWireScale(req, map);

    // PIN THE PRECONDITION (trap 13b): the three option maps must be DISTINCT,
    // or reading the wrong one would be undetectable and this proves nothing.
    expect(out.perOption).toHaveLength(3);
    expect(new Set(out.perOption.map((o) => JSON.stringify(o))).size).toBe(3);

    // Derived from the emitted maps themselves — the same question the
    // production counter asks, computed independently of its implementation.
    const expected: Record<string, number> = {};
    for (let i = 0; i < req.length; i++) {
      for (const [factorId, emitted] of Object.entries(out.perOption[i]!)) {
        if (emitted < 0 || emitted > 1) {
          const rule = projectInterventionsToRawScale(req[i]!, map).conversions.find(
            (c) => c.factor_id === factorId,
          )!.rule;
          expected[rule] = (expected[rule] ?? 0) + 1;
        }
      }
    }
    expect(Object.values(expected).reduce((a, b) => a + b, 0), 'the fixture must put something outside [0,1]').toBeGreaterThan(0);
    expect(out.outsideUnitIntervalByRule).toEqual(expected);
  });
});
