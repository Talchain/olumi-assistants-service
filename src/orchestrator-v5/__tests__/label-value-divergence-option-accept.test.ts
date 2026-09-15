/**
 * ⭐ THE OPTION DIVERGENCE NOTE MUST NOT OFFER A MOVE NOTHING CAN MAKE.
 *
 * ═══ THE MEASURED DEFECT — deployed `a3b0548d`, wire-level, FRESH ═══
 * Banked at `output/core-staging-driver/journey-2026-09-15-postmerge/journey-run1/`.
 *
 *   USER    "Change the price rise option so the new price is £69 per month instead of £59."
 *   REPLY   "Heads up — that changed the label text only. The option now reads
 *            '…£69…', but its modelled value is unchanged, so re-running the
 *            analysis will still use £59, not £69.
 *            **Want me to update the modelled value to £69?**"
 *   CHIPS   exactly one, and it does not answer that question:
 *            "Configure raising the Pro plan price from £49 to £69 per month …"
 *   STORED  `raw_interventions` read 59 at frame, edit, confirm, save, rerun AND
 *           reopen. `graph_hash` never moved.
 *
 * A sentence TRUTHFUL ABOUT A STATE is not the same as one EXECUTABLE AS AN
 * ACTION. The disclosure was true; the offer had no control behind it.
 *
 * ═══ ⛔ WHAT THIS FILE NO LONGER CLAIMS, AND WHY ═══
 * An earlier version of this change emitted a value-bearing accept chip. It was
 * WITHDRAWN after an independent review, and the reasons are recorded here so
 * nobody rebuilds it from the same premise:
 *
 *  1. WHOSE NUMBER IS IT? `detectLabelValueDivergences`'s complete inputs are the
 *     operations and the pre/post graphs — it NEVER SEES THE USER'S MESSAGE. The
 *     figure comes from the MODEL'S rename, so a label-only op introducing "£69"
 *     produces the same offer whether the user asked for £69, asked for something
 *     else, or gave no number. The permission the chip rested on — the
 *     value-bearing siblings "fire only once the user has supplied one" — is not
 *     established here.
 *  2. WHICH SLOT IS IT? Unit agreement can compare only currency-NESS, because
 *     `unit` is an optional FREE STRING in the shared contract. Executed by the
 *     reviewer: the same figure was offered to an annual-budget slot and to a USD
 *     slot.
 *  3. AND IT COULD NOT ROUTE ANYWAY. Executed against
 *     `routing/option-effect-write.ts`: the writer REFUSES a currency amount, and
 *     `VALUE_ASSIGNMENT` is GLOBAL so it finds "to £69" inside the option's OWN
 *     label — which a divergence guarantees carries a currency figure — and nulls
 *     the message. A chip that does not route drops the turn to the edit LLM.
 *
 * So the note asks, and the identification chip stays. That closes the measured
 * defect and claims nothing this module cannot establish.
 */

import { describe, it, expect } from 'vitest';

import {
  detectLabelValueDivergences,
  buildLabelValueDivergenceActions,
  buildLabelValueDivergenceNote,
} from '../label-value-divergence.js';
import { buildConfigureOptionChip } from '../configure-option-chip-text.js';

const OPTION_ID = '619f3099';
const PRICE_FACTOR = '6d9a37f3';
const PRICE_LABEL = 'Pro Plan Monthly Price';
const RELEASE_FACTOR = '7852745d';
const RELEASE_LABEL = 'with the next Pro feature release';

const PRE_LABEL = 'raising the Pro plan price from £49 to £59 per month with the next Pro feature release';
const POST_LABEL = 'raising the Pro plan price from £49 to £69 per month with the next Pro feature release';

/** Transcribed from the banked capture; `releaseUnit` decides how many slots are £. */
function graph(optionLabel: string, releaseUnit: string): unknown {
  return {
    nodes: [
      {
        id: OPTION_ID, kind: 'option', label: optionLabel, is_baseline: false,
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

const renameOp = {
  op: 'update_node', path: OPTION_ID,
  value: { label: POST_LABEL }, old_value: { label: PRE_LABEL },
};

function divergences(releaseUnit: string) {
  return detectLabelValueDivergences([renameOp], graph(PRE_LABEL, releaseUnit), graph(POST_LABEL, releaseUnit));
}

describe('the divergence note asks rather than offering a move it cannot make', () => {
  it('PRECONDITION — the rename really is a label-only divergence on an OPTION', () => {
    // Pinned in-test (trap 13b): without this every assertion below could pass
    // vacuously by asserting over an empty array.
    const divs = divergences('release');
    expect(divs).toHaveLength(1);
    expect(divs[0]!.isOption).toBe(true);
    expect(divs[0]!.newValueToken).toBe('£69');
    expect(divs[0]!.oldValueToken).toBe('£59');
  });

  it('THE CLAIM: the note does NOT offer to update the modelled value', () => {
    // The measured sentence, gone. This is the whole defect.
    const note = buildLabelValueDivergenceNote(divergences('release'))!;
    expect(note).not.toContain('Want me to update the modelled value');
    // The DISCLOSURE survives untouched — surgery, not demolition. It is the P0
    // this module exists for and must not be collateral.
    expect(note).toContain('changed the label text only');
    expect(note).toContain('£59');
    expect(note).toContain('£69');
    // And it asks, so the turn is not merely silent about the gap.
    expect(note).toMatch(/tell me which/i);
  });

  it('the option keeps its IDENTIFICATION control, which is answerable', () => {
    const actions = buildLabelValueDivergenceActions(divergences('release'));
    expect(actions).toHaveLength(1);
    // ⛔ BOUND BY IDENTITY to the composer, not by a pattern over the text
    // (trap 19). A pattern is the wrong instrument here and I got it wrong once:
    // the identification chip EMBEDS the option's own label, which a divergence
    // guarantees carries a currency figure, so "contains no £N" fails on correct
    // behaviour. What must hold is that this is the IDENTIFICATION chip verbatim
    // — the withdrawn value-bearing variant would not satisfy this.
    const identification = buildConfigureOptionChip(divergences('release')[0]!.label);
    expect(actions[0]!.label).toBe(identification.label);
    expect(actions[0]!.prompt).toBe(identification.message);
  });

  it('AMBIGUITY: two £-denominated slots are NAMED in the ask, not guessed between', () => {
    const divs = divergences('£/month');
    expect(divs[0]!.optionValueCandidates).toHaveLength(2);
    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note).toContain(PRICE_LABEL);
    expect(note).toContain(RELEASE_LABEL);
    expect(note).toContain('tell me which one £69 belongs to');
  });

  it('FACTOR TWIN: the factor branch is untouched — it already had a value control', () => {
    // Proof the change is bound to the OPTION branch and not to the module. The
    // factor branch's prompt is value-bearing and legitimately so: it targets a
    // factor directly, with no option-slot ambiguity to resolve.
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
    expect(actions[0]!.prompt).toBe('set Pro Plan Monthly Price (£69) to £69');
    // The factor note still OFFERS, because that branch has a control.
    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note).toContain('Want me to update the modelled value to £69?');
  });
});
