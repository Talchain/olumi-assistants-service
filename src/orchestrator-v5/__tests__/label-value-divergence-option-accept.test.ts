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

  it('ONE £-denominated slot ⇒ a VALUE-BEARING accept chip naming that slot', () => {
    const divs = divergences('release');
    expect(divs[0]!.optionValueCandidates).toEqual([
      { factorId: PRICE_FACTOR, factorLabel: PRICE_LABEL },
    ]);

    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions).toHaveLength(1);
    // THE CLAIM: the chip carries the user's own figure and names the slot.
    expect(actions[0]!.label).toBe(`Apply £69 to ${PRICE_LABEL}`);
    expect(actions[0]!.prompt).toContain('£69');
    // Routable spelling, owned by buildConfigureOptionAdvisedFormat — it must
    // anchor on the literal word "option" or it cannot return to the lane that
    // offered it (configure-option-chip-text.ts states this at length).
    expect(actions[0]!.prompt).toMatch(/option/i);
    expect(actions[0]!.prompt).toContain(PRICE_LABEL);
  });

  it('and the note asks about THAT slot, not about "the modelled value"', () => {
    const note = buildLabelValueDivergenceNote(divergences('release'))!;
    expect(note).toContain('£59');
    expect(note).toContain('£69');
    expect(note).toContain(`Want me to set ${PRICE_LABEL} to £69`);
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
