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
 * ── WHAT THE BLOCK ACTUALLY IS — MEASURED, NOT REASONED
 * An earlier revision of this lane "fixed" the dead end by deriving the unit
 * form from `raw_value / cap`, and `plot-request-scale-homogeneity.test.ts`
 * turned red on its own comment:
 *
 *   *"What is genuinely not ours to touch is a pair whose halves DISAGREE —
 *    there the true magnitude is unknown, and the request blocks."*
 *
 * The first revision of THIS file quoted that sentence as the adjudication and
 * concluded "blocking is correct". TWO REVIEWERS REFUTED IT, and the table below
 * was re-derived independently in this lane against the real exported functions
 * and this capture. The intervention is identical in every row; only its
 * NEIGHBOURS change:
 *
 *   request shape                                        emitted          blocked
 *   ─────────────────────────────────────────────────────────────────────────────
 *   the pair alone                                       960000           false
 *   + raw sibling, uncapped factor ({value: 9000})       960000, 9000     false
 *   + capped COHERENT sibling ({0.5, 12500}, cap 25000)  960000, 12500    false
 *   + capped coherent sibling whose RAW magnitude is
 *     itself inside [0,1] ({0.25, 0.5}, cap 2)           960000, 0.5      false
 *   + STRANDED unit-scale sibling ({value: 0.5}, cap 5e5)  960000, 0.5    TRUE
 *
 * So the module does NOT refuse to compute on a pair whose halves disagree. In
 * four of these five shapes it emits the raw magnitude and RUNS. The block is a
 * side-effect of the request-level homogeneity predicate —
 * `mixed = outsideUnitInterval.length > 0 && strandedUnitScale`, then
 * `mixedUnresolved = (mixed && undemotable.length > 0) || …`
 * (`plot-intervention-scale.ts`). Undemotability blocks ONLY when the request is
 * ALSO mixed.
 *
 * THE ADJUDICATION, restated as what is measured: this request blocks BECAUSE an
 * undemotable outside value co-occurs with a STRANDED UNIT-SCALE SIBLING — not
 * because CEE has ruled an inconsistent magnitude untrustworthy. The same pair
 * runs, un-demoted, at 960000, in a request that is not mixed.
 *
 * The narrow invariant the homogeneity suite pins is real and unchanged: do not
 * derive a unit form from a pair whose halves disagree. What was NOT established
 * — and is withdrawn from this file — is the broader principle that CEE refuses
 * to compute on such a magnitude. It computes on it whenever the neighbours
 * allow.
 *
 * ── SO THE FIX STAYS WITHDRAWN, BUT AS AN OPEN QUESTION, NOT A CLOSED ONE
 * Whether the mixed case should keep blocking or should demote by
 * `raw_value / cap` is a DESIGN question for this module's owner, and this suite
 * does not answer it. What is worth knowing before anyone answers it, and its
 * exact provenance:
 *
 *   PLoT `staging` `d37c8cfd`, SOURCE READ ONLY in this lane — no wire witness,
 *   and the DEPLOYED PLoT SHA was not verified. `routes/v2/run.ts:6835` gates
 *   the run path on `needsNormalisation`, which fires on `value < 0 || value > 1`
 *   (`lib/intervention-normaliser.ts:892`); the fired path reaches `deriveRange`,
 *   whose priority 0 is `observed_state.cap` (`:286`), and `normaliseValue`
 *   (`:766`). For THIS factor that is `960000 / 10_000_000 = 0.096` — the same
 *   number a CEE-side demote would emit. IF that read holds on the wire, the open
 *   question is "run vs refuse", not "which number". It has not been measured on
 *   the wire and must not be inherited as settled.
 *
 * The real remedy is still UPSTREAM: bind an intervention's normalising cap to
 * its target factor's declared cap at extraction, so the pair cannot disagree in
 * the first place. Note also, from this capture's own bytes, that ONE persisted
 * factor carries TWO scale authorities that disagree — `scale_frame: 1_000_000`
 * and `observed_state.cap: 10_000_000` — while `buildFactorScaleMap` reads only
 * the cap, and the factor's own baseline pair (`{0.18, 1_800_000}`) is coherent
 * with the cap. Until that is settled a user who hits this shape has no route
 * out, and that is a stated, visible gap rather than a silent one.
 *
 * ── WHAT THIS SUITE PINS
 * An explicit KNOWN-BLOCKED pin, closed against the ENUMERATION rather than the
 * instance that motivated it. For a capped inconsistent pair the outcome space is
 * {mixed → block and name the factor; non-mixed → emit `raw_value` and run}, and
 * BOTH halves are pinned here. A change to `strandedUnitScale`, to
 * `RAW_SCALE_EMITTING_RULES`, or to rule 1's conflict policy therefore cannot
 * move either half silently — including a change that alters WHICH magnitude a
 * non-mixed request computes on, which is the more expensive of the two.
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

  it('THE OTHER HALF OF THE ENUMERATION: with NO stranded unit-scale sibling the SAME pair emits its raw magnitude and RUNS', () => {
    // Closed against the ENUMERATION, not against the instance that motivated
    // the pin. For a capped inconsistent pair the outcome space is
    //   { mixed → block ;  non-mixed → emit raw_value and run }
    // and the test above pins only the first. Nothing about the PAIR differs
    // between the two halves — only its neighbours do — so a change to
    // `strandedUnitScale`, to `RAW_SCALE_EMITTING_RULES`, or to rule 1's
    // conflict policy could otherwise move this half with zero red, including a
    // change to WHICH magnitude a non-mixed request computes on.
    const uncappedRawSibling = {
      id: 'fac_uncapped',
      kind: 'factor',
      label: 'Uncapped raw sibling',
      observed_state: { value: 3_000 },
    };
    const cappedCoherentSibling = {
      id: 'fac_coh',
      kind: 'factor',
      label: 'Capped coherent sibling',
      observed_state: { value: 0.2, raw_value: 5_000, cap: 25_000 },
    };
    // The clause-discriminating neighbour. Its EMITTED value (0.5) is inside
    // [0,1], so the ONLY thing keeping it out of `strandedUnitScale` is that its
    // rule is in `RAW_SCALE_EMITTING_RULES`. Widen that predicate and this shape
    // flips to blocked — which is the point of including it.
    const smallCappedSibling = {
      id: 'fac_ratio',
      kind: 'factor',
      label: 'Capped ratio whose raw magnitude is itself under 1',
      observed_state: { value: 0.25, raw_value: 0.5, cap: 2 },
    };

    // PRECONDITION PINNED IN-TEST: this neighbour is only discriminating while it
    // resolves to a raw-scale-emitting rule AND emits inside [0,1]. Assert both,
    // so a refactor cannot silently reduce the row below to a duplicate of the
    // others while the suite stays green.
    const ratioResolved = resolveRawInterventionValue(
      { value: 0.25, raw_value: 0.5 },
      buildFactorScaleMap([smallCappedSibling]).get('fac_ratio'),
    );
    expect(ratioResolved.rule).toBe('raw_value_used');
    expect(ratioResolved.value).toBe(0.5);

    const shapes: ReadonlyArray<{
      shape: string;
      nodes: unknown[];
      interventions: Record<string, unknown>;
      emitted: Record<string, number>;
    }> = [
      {
        shape: 'the pair alone',
        nodes: [capture.factor_node],
        interventions: { [FACTOR_ID]: capture.intervention },
        emitted: { [FACTOR_ID]: RAW },
      },
      {
        shape: 'plus a raw sibling on an uncapped factor',
        nodes: [capture.factor_node, uncappedRawSibling],
        interventions: { [FACTOR_ID]: capture.intervention, fac_uncapped: { value: 9_000 } },
        emitted: { [FACTOR_ID]: RAW, fac_uncapped: 9_000 },
      },
      {
        shape: 'plus a capped COHERENT sibling',
        nodes: [capture.factor_node, cappedCoherentSibling],
        interventions: {
          [FACTOR_ID]: capture.intervention,
          fac_coh: { value: 0.5, raw_value: 12_500 },
        },
        emitted: { [FACTOR_ID]: RAW, fac_coh: 12_500 },
      },
      {
        shape: 'plus a capped coherent sibling whose RAW magnitude is inside [0,1]',
        nodes: [capture.factor_node, smallCappedSibling],
        interventions: {
          [FACTOR_ID]: capture.intervention,
          fac_ratio: { value: 0.25, raw_value: 0.5 },
        },
        emitted: { [FACTOR_ID]: RAW, fac_ratio: 0.5 },
      },
    ];

    for (const s of shapes) {
      const scaleById = buildFactorScaleMap(s.nodes);
      // The pair is inconsistent in EVERY row — the disagreement is not what
      // changes, so it cannot be what decides the block.
      expect(
        resolveRawInterventionValue(capture.intervention, scaleById.get(FACTOR_ID)).inconsistent,
        `${s.shape}: the pair is still inconsistent`,
      ).toBe(true);

      const proj = projectRequestInterventionsToWireScale([s.interventions], scaleById, [
        new Set<string>(),
      ]);
      const block = decideAnalysisScaleBlock(proj, []);
      // One exact-shape assertion so a conflict-policy change that moved the
      // emitted magnitude (e.g. to `value * cap` = 9_600_000) REDs here, and the
      // failure diff names the shape it happened in.
      expect({
        shape: s.shape,
        emitted: proj.perOption[0],
        demoted: proj.demoted,
        mixedUnresolved: proj.mixedUnresolved,
        unresolvedFactorIds: proj.unresolvedFactorIds,
        blocked: block.blocked,
      }).toEqual({
        shape: s.shape,
        emitted: s.emitted,
        demoted: false,
        mixedUnresolved: false,
        unresolvedFactorIds: [],
        blocked: false,
      });
    }
  });

  it('CONTRAST: holding the stranded sibling fixed, a COHERENT pair demotes and runs — the disagreement is NECESSARY for the block', () => {
    // Identical structure, identical magnitudes, the stranded sibling still
    // present; one difference: value * cap agrees with raw_value. This is the
    // discrimination on the OTHER axis — it proves the block is not caused by
    // the presence of a large number or by the stranded sibling alone.
    // Necessary, not sufficient: the four non-mixed rows above show the same
    // disagreement running when the stranded sibling is absent. BOTH conjuncts
    // are required, and each of these two tests varies exactly one of them.
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
