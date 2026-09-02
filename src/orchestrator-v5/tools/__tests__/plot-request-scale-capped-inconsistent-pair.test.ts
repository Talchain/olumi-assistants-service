/**
 * THE CAPPED INCONSISTENT PAIR — an intervention normalised against a DIFFERENT
 * cap than its own factor declares, and the dead end it produces.
 *
 * ── THE DEFECT, MEASURED AT THE WIRE (2026-09-02, deployed staging CEE c110c5e3)
 * A fresh guest's draft of the pre-registered B3 brief emitted, on one option:
 *
 *   factor "Copilot Engineering Cost"  observed_state.cap = 10_000_000
 *   intervention                        value = 0.96   raw_value = 960_000   unit "£"
 *
 * `0.96 * 1_000_000 === 960_000` exactly — the model normalised the INTERVENTION's
 * level against a cap of 1e6 while the FACTOR node declares 1e7. Nothing binds the
 * two: the served prompt's CAP SELECTION rule is per-factor and per-value.
 *
 * Consequence in `scaleNumeric` rule 1: `value * cap` (9_600_000) disagrees with
 * `raw_value` (960_000) by 10x, so `inconsistent` is set, `pairProvesUnitForm` is
 * false, and the emission carries NO `unitIntervalEquivalent` — it is UNDEMOTABLE.
 * One undemotable outside value beside one stranded unit-scale sibling makes the
 * whole request `mixedUnresolved`, and `run_analysis` refuses
 * `mixed_scale_unresolved` with copy that admits it has no step to offer.
 *
 * ── WHY THE FIX IS NOT A RELAXATION
 * The module's own deterministic conflict policy already rules that `raw_value` is
 * the explicit user-scale field and WINS over `value * cap`. The emitted VALUE has
 * honoured that since rule 1 was written. The `unitIntervalEquivalent` did not: it
 * was taken from `value` — the field the policy says LOSES. Deriving it from the
 * winning field (`raw_value / cap`) makes the two halves of rule 1 agree about
 * which number is authoritative.
 *
 * It is exactly value-preserving against PLoT. When PLoT's request-level gate fires
 * it computes `raw_value / deriveRange`, and `deriveRange` takes the target factor's
 * `observed_state.cap` at priority 0 (plot-lite-service `src/lib/intervention-
 * normaliser.ts`, re-derived at PLoT staging d37c8cfd). Emitting `raw_value / cap`
 * under a SKIPPED gate therefore hands ISL the identical number.
 *
 * `inconsistent` is still set and still reaches the `inconsistent_scale` diagnostic:
 * the disagreement is surfaced, never silently repaired. Only DEMOTABILITY changes.
 *
 * The fixture is a VERBATIM wire capture (append-only record, trap 14b).
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

describe('capped inconsistent {value, raw_value} pair (verbatim staging capture 2026-09-02)', () => {
  it('the capture still has the shape this suite is about — precondition, pinned in-test', () => {
    const obs = capture.factor_node.observed_state as Record<string, unknown>;
    expect(obs.cap).toBe(CAP);
    expect(capture.intervention.raw_value).toBe(RAW);
    expect(capture.intervention.value).toBe(0.96);
    // The pair really is inconsistent against the factor's declared cap.
    expect((capture.intervention.value as number) * CAP).not.toBeCloseTo(RAW, 0);
  });

  it('carries a unit-interval equivalent derived from raw_value/cap, so it is DEMOTABLE', () => {
    const scaleById = buildFactorScaleMap([capture.factor_node]);
    const r = resolveRawInterventionValue(capture.intervention, scaleById.get(FACTOR_ID));

    // Unchanged: raw_value still wins as the emitted value, and the disagreement
    // is still reported.
    expect(r.rule).toBe('raw_value_used');
    expect(r.value).toBe(RAW);
    expect(r.inconsistent).toBe(true);

    // THE FIX: the unit form comes from the field the conflict policy says wins.
    expect(r.unitIntervalEquivalent).toBeCloseTo(RAW / CAP, 12);
    expect(r.unitIntervalEquivalent).toBe(0.096);
  });

  it('a request mixing it with a stranded unit-scale sibling DEMOTES instead of dead-ending', () => {
    // The sibling supplies the OTHER conjunct of the request-level predicate: a
    // value in [0,1] on a rule outside RAW_SCALE_EMITTING_RULES. A capped factor
    // whose observed_state does not prove the normalised convention yields
    // `ambiguous_no_evidence` — the class PLoT's gate would annihilate, and the
    // reason this request must never ship un-demoted.
    const strandedFactor = {
      id: 'fac_stranded',
      kind: 'factor',
      label: 'Stranded unit-scale factor',
      observed_state: { value: 0.4, cap: 500_000 },
    };
    const nodes = [capture.factor_node, strandedFactor];
    const scaleById = buildFactorScaleMap(nodes);
    expect(resolveRawInterventionValue({ value: 0.5 }, scaleById.get('fac_stranded')).rule).toBe(
      'ambiguous_no_evidence',
    );

    const proj = projectRequestInterventionsToWireScale(
      [{ [FACTOR_ID]: capture.intervention, fac_stranded: { value: 0.5 } }],
      scaleById,
      [new Set<string>()],
    );

    expect(proj.mixedUnresolved).toBe(false);
    expect(proj.demoted).toBe(true);
    expect(proj.allWithinUnitInterval).toBe(true);
    expect(proj.postconditionViolated).toBe(false);
    // The stranded sibling survives VERBATIM — that is the whole point of demoting.
    expect(proj.perOption[0].fac_stranded).toBe(0.5);
    expect(proj.perOption[0][FACTOR_ID]).toBeCloseTo(RAW / CAP, 12);

    expect(decideAnalysisScaleBlock(proj, []).blocked).toBe(false);
  });

  it('FAILS CLOSED when raw_value exceeds the cap — no fabricated unit form', () => {
    const factor = {
      id: 'fac_over',
      kind: 'factor',
      label: 'Over-cap',
      observed_state: { value: 0.5, cap: 1_000 },
    };
    const scaleById = buildFactorScaleMap([factor]);
    // raw_value 5_000 on cap 1_000 has no unit-interval representation.
    const r = resolveRawInterventionValue({ value: 0.5, raw_value: 5_000 }, scaleById.get('fac_over'));
    expect(r.value).toBe(5_000);
    expect(r.unitIntervalEquivalent).toBeUndefined();

    const proj = projectRequestInterventionsToWireScale(
      [{ fac_over: { value: 0.5, raw_value: 5_000 }, fac_stranded2: { value: 0.5 } }],
      buildFactorScaleMap([factor, { id: 'fac_stranded2', kind: 'factor', observed_state: { value: 0.4, cap: 9 } }]),
      [new Set<string>()],
    );
    expect(proj.mixedUnresolved).toBe(true);
    expect(decideAnalysisScaleBlock(proj, []).blocked).toBe(true);
  });
});
