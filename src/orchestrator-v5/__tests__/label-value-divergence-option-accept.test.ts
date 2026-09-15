/**
 * ⭐⭐ THE OPTION DIVERGENCE OFFER MUST HAVE A CONTROL THAT ANSWERS IT.
 *
 * ═══ THE MEASURED DEFECT — deployed CEE `a3b0548d`, wire-level, FRESH session ═══
 * Banked at `output/core-staging-driver/journey-2026-09-15-postmerge/journey-run1/`.
 *
 *   USER    "Change the price rise option so the new price is £69 per month instead of £59."
 *   REPLY   "Heads up — that changed the label text only. The option now reads
 *            '…£69…', but its modelled value is unchanged, so re-running the analysis
 *            will still use £59, not £69. Want me to update the modelled value to £69?"
 *   CHIPS   exactly one, and it does not answer that question:
 *            id="edit_graph_action_0"
 *            label="Configure raising the Pro plan price from £49 to £69 per month …"
 *   STORED  `analysis_ready.options[].raw_interventions` read **59** at frame, edit,
 *           confirm, save, rerun AND reopen. `graph_hash` never moved.
 *
 * So the product asked a direct question and shipped nothing that could say yes.
 * The option branch of `buildLabelValueDivergenceActions` answered it with
 * `buildConfigureOptionChip`, whose own header states it "DELIBERATELY DOES NOT
 * carry a value" — it completes the IDENTIFICATION and leaves the number to the
 * user. The same header records the permission this file exercises: the
 * value-bearing siblings "fire only once the user has supplied one", and here
 * the user supplied it.
 *
 * ═══ WHERE THE FIXTURE COMES FROM (trap 16 / trap 14b) ═══
 * The node shapes below are transcribed from that banked capture — option
 * `619f3099` with TWO intervention slots:
 *   { "6d9a37f3": { value: 0.59, raw_value: 59, unit: "£/month" },
 *     "7852745d": { value: 1,    raw_value: 1,  unit: "release"  } }
 * and factors `6d9a37f3` "Pro Plan Monthly Price" / `7852745d` "with the next
 * Pro feature release". Ids and labels are the capture's own. ⚠ They are
 * TRANSCRIBED, not a byte-copy of the whole graph — said plainly so nobody
 * later inherits this as a dated capture corpus.
 *
 * ═══ WHY UNIT AGREEMENT, AND NOT A LABEL MATCH ═══
 * Two slots, one stated figure. The discriminator is the slot's OWN recorded
 * `unit`, a type check on data the graph already holds — the same discipline
 * LEG 2 of the detector already applies via `unitKindOfToken`, and deliberately
 * not a natural-language match (trap 22f).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19). Revert the option branch of
 * `buildLabelValueDivergenceActions` to the bare `buildConfigureOptionChip` and
 * the ACCEPT tests below MUST go red. The AMBIGUITY test and the FACTOR twin
 * must stay GREEN through that revert — one alone proves sensitivity, the trio
 * proves the binding is to the CANDIDATE COUNT and not to the branch.
 */

import { describe, it, expect } from 'vitest';

import {
  detectLabelValueDivergences,
  buildLabelValueDivergenceActions,
  buildLabelValueDivergenceNote,
} from '../label-value-divergence.js';

const OPTION_ID = '619f3099';
const PRICE_FACTOR = '6d9a37f3';
const PRICE_LABEL = 'Pro Plan Monthly Price';
const RELEASE_FACTOR = '7852745d';
const RELEASE_LABEL = 'with the next Pro feature release';

const PRE_LABEL = 'raising the Pro plan price from £49 to £59 per month with the next Pro feature release';
const POST_LABEL = 'raising the Pro plan price from £49 to £69 per month with the next Pro feature release';

/** `releaseUnit` is the only knob: it decides how many slots are £-denominated. */
function graph(optionLabel: string, releaseUnit: string): unknown {
  return {
    nodes: [
      {
        id: OPTION_ID,
        kind: 'option',
        label: optionLabel,
        is_baseline: false,
        interventions: {
          [PRICE_FACTOR]: { value: 0.59, raw_value: 59, unit: '£/month', source: 'cee_hypothesis' },
          [RELEASE_FACTOR]: { value: 1, raw_value: 1, unit: releaseUnit, source: 'cee_hypothesis' },
        },
      },
      { id: PRICE_FACTOR, kind: 'factor', label: PRICE_LABEL },
      { id: RELEASE_FACTOR, kind: 'factor', label: RELEASE_LABEL },
    ],
  };
}

/** The rename the user's edit produced: label moves £59 → £69, no value op. */
const renameOp = {
  op: 'update_node',
  path: OPTION_ID,
  value: { label: POST_LABEL },
  old_value: { label: PRE_LABEL },
};

function divergences(releaseUnit: string) {
  return detectLabelValueDivergences(
    [renameOp],
    graph(PRE_LABEL, releaseUnit),
    graph(POST_LABEL, releaseUnit),
  );
}

describe('an option divergence offers a control that answers its own question', () => {
  it('PRECONDITION — the rename really is a label-only divergence on an OPTION', () => {
    // Pinned in-test (trap 13b): if this stopped producing a divergence, every
    // assertion below would pass vacuously by asserting over an empty array.
    const divs = divergences('release');
    expect(divs).toHaveLength(1);
    expect(divs[0]!.isOption).toBe(true);
    expect(divs[0]!.newValueToken).toBe('£69');
    expect(divs[0]!.oldValueToken).toBe('£59');
  });

  it('⛔ KNOWN-DROPPED: a label spelling "to £69" cannot be offered an accept chip', () => {
    // MEASURED, and the reason this class is pinned rather than hidden.
    // `VALUE_ASSIGNMENT` (routing/option-effect-write.ts:400) is GLOBAL, so it
    // finds "to £69" inside THE OPTION'S OWN LABEL — which a label/value
    // divergence GUARANTEES carries a currency figure — sees a currency, and
    // returns null for the whole message. No sentence naming this option can
    // route, so no accept control exists for it.
    //
    // The first cut shipped a chip here anyway, on the composer header's claim
    // that the message "routes back to the lane that offered it". It does not:
    // a chip that fails to route DROPS THE TURN TO THE EDIT LLM, the
    // wrong-entity-write path. Offering it was worse than offering nothing.
    const divs = divergences('release');
    expect(divs[0]!.optionValueCandidates).toHaveLength(1);
    expect(divs[0]!.optionValueCandidates[0]!.factorLabel).toBe(PRICE_LABEL);
    // The slot is identified; the SENTENCE is what is unavailable.
    expect(divs[0]!.optionValueCandidates[0]!.routableMessage).toBeNull();

    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.label).not.toMatch(/^Apply /);
  });

  it('and the note ASKS rather than offering, because no control exists', () => {
    // Copy and control in lockstep — both read `acceptableCandidate`. An offer
    // beside a control that cannot make the move is the defect being closed.
    const note = buildLabelValueDivergenceNote(divergences('release'))!;
    expect(note).toContain('£59');
    expect(note).toContain('£69');
    expect(note).not.toContain('Want me to set');
    expect(note).toMatch(/tell me which value|tell me which one/i);
  });

  /**
   * ⭐⭐ THE POSITIVE CONTROL, and the most important test in this file.
   *
   * Everything above proves the accept chip correctly DOES NOT fire. Without a
   * case where it DOES, this whole change could be dead code that never emits
   * anything — this estate's most-repeated failure, and exactly what the
   * known-dropped case above would disguise.
   *
   * The discriminator is the LABEL's spelling, measured: a label carrying its
   * figure in parentheses rather than after "to" leaves no `to £N` for the
   * router's global regex to trip on, so the composed sentence routes.
   */
  function parenGraph(): unknown {
    const g = {
      nodes: [
        {
          id: OPTION_ID, kind: 'option', label: PAREN_PRE, is_baseline: false,
          interventions: {
            [PRICE_FACTOR]: { value: 0.59, raw_value: 59, unit: '£/month', source: 'cee_hypothesis' },
          },
        },
        {
          id: PRICE_FACTOR, kind: 'factor', label: PRICE_LABEL,
          // cap + a PROVEN normalised convention: value*cap ≈ raw_value, non-zero
          // baseline. A cap alone is deliberately not enough.
          observed_state: { value: 0.49, raw_value: 49, baseline: 49, cap: 100, unit: '£' },
        },
      ],
    };
    return g;
  }
  const PAREN_PRE = 'Pro plan price rise (£59/month)';
  const PAREN_POST = 'Pro plan price rise (£69/month)';

  it('POSITIVE CONTROL: a label with no "to £N" DOES get a routable accept chip', () => {
    const divs = detectLabelValueDivergences(
      [{ op: 'update_node', path: OPTION_ID, value: { label: PAREN_POST },
         old_value: { label: PAREN_PRE } }],
      parenGraph(),
      JSON.parse(JSON.stringify(parenGraph()).replace(PAREN_PRE, PAREN_POST)),
    );
    expect(divs).toHaveLength(1);
    expect(divs[0]!.newValueToken).toBe('£69');

    const only = divs[0]!.optionValueCandidates[0];
    expect(only).toBeDefined();
    // THE CLAIM: a sentence exists AND the real router resolves it to 69/100.
    expect(only!.routableMessage).not.toBeNull();
    expect(only!.routableMessage).toContain('0.69');
    // ⚠ The VALUE is the level, not the user's figure — the writer refuses a
    // currency amount. The £69 that remains is inside the option's own LABEL,
    // which is the option's identity and must be there for the router to bind.
    // What must NOT appear is the routing-killer shape "to £N", which is the
    // measured reason the captured label above can never be offered a chip.
    expect(only!.routableMessage).not.toMatch(/\bto\s+£\d/);
    expect(only!.routableMessage).toMatch(/\bto\s+0\.69\b/);

    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions[0]!.label).toBe(`Apply £69 to ${PRICE_LABEL}`);
    expect(actions[0]!.prompt).toBe(only!.routableMessage);

    // And the note OFFERS here, because the control exists — the lockstep.
    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note).toContain(`Want me to set ${PRICE_LABEL} to £69`);
  });

  it('⭐ THE ROUND TRIP IS LOAD-BEARING: a VALID cap + an unroutable label ⇒ no chip', () => {
    // ⛔ THE CASE A MUTANT EXPOSED. Every other unroutable fixture here fails at
    // the CAP check first, so skipping the round trip left the suite green and
    // the guard was pinned by nothing. This is the only combination that reaches
    // it: a factor with a proven convention (so a level IS derivable) on an
    // option whose label spells "to £69" (so no sentence naming it can route).
    //
    // Without the round trip this emits a chip that returns NULL at the router
    // and drops the turn to the edit LLM — the wrong-entity-write path.
    const TO_PRE = 'Raise the Pro plan price to £59';
    const TO_POST = 'Raise the Pro plan price to £69';
    const g = {
      nodes: [
        {
          id: OPTION_ID, kind: 'option', label: TO_PRE, is_baseline: false,
          interventions: {
            [PRICE_FACTOR]: { value: 0.59, raw_value: 59, unit: '£/month', source: 'cee_hypothesis' },
          },
        },
        {
          id: PRICE_FACTOR, kind: 'factor', label: PRICE_LABEL,
          observed_state: { value: 0.49, raw_value: 49, baseline: 49, cap: 100, unit: '£' },
        },
      ],
    };
    const divs = detectLabelValueDivergences(
      [{ op: 'update_node', path: OPTION_ID, value: { label: TO_POST }, old_value: { label: TO_PRE } }],
      g,
      JSON.parse(JSON.stringify(g).replace(TO_PRE, TO_POST)),
    );
    expect(divs).toHaveLength(1);
    const only = divs[0]!.optionValueCandidates[0];
    // PRECONDITION: the cap IS usable here — otherwise this test would pass for
    // the wrong reason, which is exactly how the guard went unpinned.
    expect(only).toBeDefined();
    expect(only!.factorLabel).toBe(PRICE_LABEL);
    // THE CLAIM: a level is derivable, and the sentence STILL does not route.
    expect(only!.routableMessage).toBeNull();
    expect(buildLabelValueDivergenceActions(divs)[0]!.label).not.toMatch(/^Apply /);
  });

  it('⭐ A CAP IS NOT PROOF: cap present but ZERO baseline ⇒ no chip', () => {
    // ⛔ A SECOND CASE A MUTANT EXPOSED. Dropping the `normalisedConvention`
    // requirement left the suite green, because the only negative fixture removed
    // observed_state ENTIRELY and failed at the cap check first. So the evidence
    // gate was pinned by nothing.
    //
    // A zero baseline is scale-ambiguous — 0 == 0/anything — so it carries no
    // evidence that this factor is stored downscaled, and buildFactorScaleMap
    // correctly refuses to grant the convention. Dividing by the cap anyway would
    // put a fabricated magnitude one click away behind a control that reads as a
    // recommendation. The routable label makes this reach the convention check
    // rather than dying earlier.
    const g = {
      nodes: [
        {
          id: OPTION_ID, kind: 'option', label: PAREN_PRE, is_baseline: false,
          interventions: {
            [PRICE_FACTOR]: { value: 0.59, raw_value: 59, unit: '£/month', source: 'cee_hypothesis' },
          },
        },
        {
          id: PRICE_FACTOR, kind: 'factor', label: PRICE_LABEL,
          // cap IS present — and the baseline is zero, so it proves nothing.
          observed_state: { value: 0, raw_value: 0, baseline: 0, cap: 100, unit: '£' },
        },
      ],
    };
    const divs = detectLabelValueDivergences(
      [{ op: 'update_node', path: OPTION_ID, value: { label: PAREN_POST }, old_value: { label: PAREN_PRE } }],
      g,
      JSON.parse(JSON.stringify(g).replace(PAREN_PRE, PAREN_POST)),
    );
    expect(divs).toHaveLength(1);
    const only = divs[0]!.optionValueCandidates[0];
    expect(only).toBeDefined();
    expect(only!.routableMessage).toBeNull();
    expect(buildLabelValueDivergenceActions(divs)[0]!.label).not.toMatch(/^Apply /);
  });

  it('NO CAP ⇒ no chip, even with a routable label — a level cannot be derived', () => {
    // The majority state on real graphs. Without a proven convention there is no
    // defensible level, and inventing one puts a fabricated magnitude a click away.
    const g = JSON.parse(JSON.stringify(parenGraph())) as { nodes: Record<string, unknown>[] };
    for (const n of g.nodes) if (n.id === PRICE_FACTOR) n.observed_state = { value: 0.49, unit: '£' };
    const divs = detectLabelValueDivergences(
      [{ op: 'update_node', path: OPTION_ID, value: { label: PAREN_POST },
         old_value: { label: PAREN_PRE } }],
      g, JSON.parse(JSON.stringify(g).replace(PAREN_PRE, PAREN_POST)),
    );
    expect(divs).toHaveLength(1);
    expect(divs[0]!.optionValueCandidates[0]?.routableMessage ?? null).toBeNull();
    expect(buildLabelValueDivergenceActions(divs)[0]!.label).not.toMatch(/^Apply /);
  });

  it('AMBIGUITY TWIN: two £-denominated slots ⇒ NO value chip, and the note ASKS', () => {
    // The opposite direction, and the one that must not regress: with two slots
    // measured the same way, carrying the figure on a chip would put a
    // fabricated intervention one click away behind a control that reads as a
    // recommendation — the exact harm the identification chip exists to prevent.
    const divs = divergences('£/month');
    expect(divs[0]!.optionValueCandidates).toHaveLength(2);

    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions).toHaveLength(1);
    // ⚠ Assert the SHAPE, not the absence of the figure: the identification
    // chip echoes the option's own label, which legitimately now contains £69.
    // Asserting `not.toContain('£69')` would fail on correct behaviour.
    expect(actions[0]!.label).not.toMatch(/^Apply /);
    expect(actions[0]!.label).toMatch(/^Configure /);

    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note).toContain('tell me which one £69 belongs to');
    expect(note).not.toContain('Want me to update the modelled value');
  });

  it('FACTOR TWIN: the factor branch is untouched by any of this', () => {
    // It already shipped a value-bearing prompt and must keep doing so — proof
    // the change is bound to the OPTION branch and not to the module.
    const divs = detectLabelValueDivergences(
      [{ op: 'update_node', path: PRICE_FACTOR, value: { label: 'Pro Plan Monthly Price (£69)' },
         old_value: { label: PRICE_LABEL } }],
      { nodes: [{ id: PRICE_FACTOR, kind: 'factor', label: PRICE_LABEL,
                  observed_state: { value: 0.59, raw_value: 59, unit: '£' } }] },
      { nodes: [{ id: PRICE_FACTOR, kind: 'factor', label: 'Pro Plan Monthly Price (£69)',
                  observed_state: { value: 0.59, raw_value: 59, unit: '£' } }] },
    );
    expect(divs).toHaveLength(1);
    expect(divs[0]!.isOption).toBe(false);
    expect(divs[0]!.optionValueCandidates).toEqual([]);
    const actions = buildLabelValueDivergenceActions(divs);
    // The factor branch names the POST label — unchanged, pre-existing behaviour.
    expect(actions[0]!.prompt).toBe('set Pro Plan Monthly Price (£69) to £69');
  });
});
