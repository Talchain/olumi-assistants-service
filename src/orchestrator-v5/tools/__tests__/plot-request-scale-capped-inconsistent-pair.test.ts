/**
 * THE CAPPED INCONSISTENT PAIR — a KNOWN, PINNED DEAD END, recorded rather than fixed.
 *
 * ── WHAT THE PRODUCT DOES TO A USER, measured at the wire
 * Deployed staging CEE `c110c5e3`, 2026-09-02, fresh guest, pre-registered brief
 * B3. The draft emitted, on one option:
 *
 *   factor "Copilot Engineering Cost"  observed_state.cap = 10_000_000
 *   intervention                        value = 0.96   raw_value = 960_000   unit "£"
 *
 * `0.96 * 1_000_000 === 960_000` EXACTLY: the model normalised the INTERVENTION's
 * level against a cap of 1e6 while the FACTOR node declares 1e7. Nothing binds the
 * two — the served prompt's CAP SELECTION rule is per-factor and per-value, so the
 * cap used for an intervention's level is not constrained to the cap stored on its
 * target factor. The two halves of the pair then disagree by 10x.
 *
 * `scaleNumeric` rule 1 flags `inconsistent`, withholds `unitIntervalEquivalent`,
 * and the emission becomes UNDEMOTABLE. Put one stranded unit-scale sibling beside
 * it and the whole request is `mixedUnresolved` — `run_analysis` refuses
 * `mixed_scale_unresolved`, with copy that admits *"I don't have a step I can
 * promise will clear it"*. Witnessed as a fresh-guest dead end the same day.
 *
 * ── WHY THIS SUITE PINS THE BLOCK RATHER THAN REMOVING IT
 * An earlier revision of this lane "fixed" it by deriving the unit form from
 * `raw_value / cap`, reasoning that rule 1's own conflict policy makes `raw_value`
 * the winner. That reasoning was WRONG, and `plot-request-scale-homogeneity.test.ts`
 * caught it:
 *
 *   *"What is genuinely not ours to touch is a pair whose halves DISAGREE — there
 *    the true magnitude is unknown, and the request blocks."*
 *
 * The conflict policy answers *"which number do we EMIT when we must emit one?"*.
 * It does NOT answer *"do we know enough to ASSERT this magnitude's unit form?"*.
 * Those are two questions under one name, and collapsing them is the estate's
 * signature defect — committed here while claiming to fix an instance of it.
 * With `{value: 0.96, raw_value: 960_000}` the author's own two numbers are 10x
 * apart; picking one and computing would ship a confidently wrong result. Blocking
 * is correct.
 *
 * ── SO THE GAP IS RECORDED, NOT PAPERED OVER
 * This is an explicit KNOWN-BLOCKED pin: the suite stays green for the RIGHT
 * reason, and it REDs if the behaviour changes in either direction — if the block
 * silently disappears (someone demotes an ambiguous pair) or if a case that should
 * still block stops being named. The real remedy is UPSTREAM: bind an
 * intervention's normalising cap to its target factor's declared cap at
 * extraction, so the pair cannot disagree in the first place. Until then a user who
 * hits this shape has no route out, and that is a stated, visible gap rather than a
 * silent one.
 *
 * The fixture is a VERBATIM wire capture (append-only record, CLAUDE.md trap 14b).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import {
  resolveRawInterventionValue,
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
  decideAnalysisScaleBlock,
} from '../plot-intervention-scale.js';

const capture = JSON.parse(
  readFileSync(
    new URL('./fixtures/staging-capped-inconsistent-pair-capture-2026-09-02.json', import.meta.url),
    'utf8',
  ),
) as {
  factor_node: Record<string, unknown>;
  factor_id: string;
  intervention: Record<string, unknown>;
};

const FACTOR_ID = capture.factor_id;
const CAP = 10_000_000;
const RAW = 960_000;

describe('capped inconsistent {value, raw_value} pair — KNOWN BLOCKED (staging capture 2026-09-02)', () => {
  it('PRECONDITION, pinned in-test: the capture still has the shape this suite is about', () => {
    const obs = capture.factor_node.observed_state as Record<string, unknown>;
    expect(obs.cap).toBe(CAP);
    expect(capture.intervention.raw_value).toBe(RAW);
    expect(capture.intervention.value).toBe(0.96);
    // The disagreement is real and it is 10x — not a rounding artefact.
    expect((capture.intervention.value as number) * CAP).toBe(9_600_000);
    // And it is exactly a cap-of-1e6 normalisation, which is what identifies the
    // upstream defect (the intervention's cap is not the factor's cap).
    expect((capture.intervention.value as number) * 1_000_000).toBeCloseTo(RAW, 6);
  });

  it('is flagged inconsistent, emits the raw magnitude, and carries NO unit form', () => {
    const scaleById = buildFactorScaleMap([capture.factor_node]);
    const r = resolveRawInterventionValue(capture.intervention, scaleById.get(FACTOR_ID));

    expect(r.rule).toBe('raw_value_used');
    expect(r.value).toBe(RAW);
    expect(r.inconsistent).toBe(true);
    // THE PIN: no unit form is asserted for a pair whose halves disagree.
    expect(r.unitIntervalEquivalent).toBeUndefined();
  });

  it('THE DEAD END: beside a stranded unit-scale sibling the whole request blocks, and names the factor', () => {
    const strandedFactor = {
      id: 'fac_stranded',
      kind: 'factor',
      label: 'Stranded unit-scale factor',
      observed_state: { value: 0.4, cap: 500_000 },
    };
    const scaleById = buildFactorScaleMap([capture.factor_node, strandedFactor]);
    // The sibling supplies the other conjunct: a [0,1] value on a rule outside
    // RAW_SCALE_EMITTING_RULES — the class PLoT's fired gate would annihilate.
    expect(resolveRawInterventionValue({ value: 0.5 }, scaleById.get('fac_stranded')).rule).toBe(
      'ambiguous_no_evidence',
    );

    const proj = projectRequestInterventionsToWireScale(
      [{ [FACTOR_ID]: capture.intervention, fac_stranded: { value: 0.5 } }],
      scaleById,
      [new Set<string>()],
    );

    expect(proj.mixedUnresolved).toBe(true);
    expect(proj.demoted).toBe(false);
    // The user-facing consequence, asserted rather than described.
    const block = decideAnalysisScaleBlock(proj, []);
    expect(block.blocked).toBe(true);
    expect((block as { reason_code?: string }).reason_code).toBe('mixed_scale_unresolved');
    // The factor the user would be told about is the one CEE cannot resolve.
    expect(proj.unresolvedFactorIds).toContain(FACTOR_ID);
  });

  it('CONTRAST: the SAME shape with a COHERENT pair demotes and runs — so the block is about the disagreement, not about money', () => {
    // Identical structure, identical magnitudes, one difference: value * cap
    // agrees with raw_value. This is the discrimination — it proves the block
    // above is caused by the inconsistency and not by the presence of a large
    // number or by the stranded sibling alone.
    const coherentFactor = {
      id: 'fac_cost',
      kind: 'factor',
      label: 'Coherent cost',
      observed_state: { value: 0.096, raw_value: RAW, cap: CAP },
    };
    const strandedFactor = {
      id: 'fac_stranded',
      kind: 'factor',
      label: 'Stranded unit-scale factor',
      observed_state: { value: 0.4, cap: 500_000 },
    };
    const scaleById = buildFactorScaleMap([coherentFactor, strandedFactor]);
    const proj = projectRequestInterventionsToWireScale(
      [{ fac_cost: { value: 0.096, raw_value: RAW }, fac_stranded: { value: 0.5 } }],
      scaleById,
      [new Set<string>()],
    );

    expect(proj.mixedUnresolved).toBe(false);
    expect(proj.demoted).toBe(true);
    expect(proj.allWithinUnitInterval).toBe(true);
    expect(proj.perOption[0].fac_cost).toBeCloseTo(0.096, 12);
    // The stranded sibling survives verbatim — what demotion exists to protect.
    expect(proj.perOption[0].fac_stranded).toBe(0.5);
    expect(decideAnalysisScaleBlock(proj, []).blocked).toBe(false);
  });
});
