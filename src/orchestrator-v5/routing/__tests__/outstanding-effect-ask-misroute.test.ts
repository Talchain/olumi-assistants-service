/**
 * ⭐⭐ THE PRODUCT OFFERED — AND APPLIED — A WRITE TO A DIFFERENT FIELD OF THE
 * PAIR IT WAS ASKING ABOUT. Fresh-guest browser witness, 20 Aug 2026
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/golden-journey-runs/
 *   2026-08-20-fresh-guest-browser-witness/`), deployed CEE `65445df`,
 * UI `7153fbd7`.
 *
 * ── DEFECT A (captured verbatim on screen, `shots/07-adjust-this-link-chip.png`)
 * Olumi asked: *"Next, choose the missing effect value for "double down on
 * mid-market…" on "Self-serve product investment"…"*. The user answered
 * *"I would say it drives self-serve product investment fairly strongly, about
 * 0.6."* and the product replied:
 *
 *   "Nothing has been changed. You did not ask me to edit the model, so I have
 *    not - but changing the strength of "double down on mid-market with a
 *    lower-priced self-serve tier→Self-serve product investment" to 0.6 looks
 *    like it would help. Say the word and I will make it."   [chip: Adjust this link]
 *
 * The chip wrote edge STRENGTH (1 → 0.6), reported "Applied", and readiness did
 * not move (`options_ready` 0/4). The edge it names IS the option × factor pair
 * of the blocker the product had just put on screen.
 *
 * ── DEFECT B (`PLAIN-LANGUAGE-TESTS.txt` test C)
 * *"Set its effect on Enterprise sales investment to 0.7"* wrote the FACTOR's
 * own value (0.5 → 0.7) and reported "Applied". Measured at this tip:
 * `detectConfigureOptionIntent` returns `{matched:false, labelAnchorWouldDecide:
 * true}` — the classifier's own report that an option ANCHOR, and nothing else,
 * is what it is missing. `impliesOptionInterventionEdit` returns false for the
 * same reason (its header names the pronoun gap at
 * `option-intervention-guard.ts:282-285`).
 *
 * ── WHAT THIS MODULE ASSERTS
 * ONE question: *would this proposal write a DIFFERENT FIELD of an option ×
 * factor pair the product is CURRENTLY asking for an effect value on?* It adds
 * NO natural-language predicate of its own — the effect framing comes from the
 * shipped classifier's own `labelAnchorWouldDecideTrigger`, and the pair set
 * comes from `deriveMissingEffectPairs`, the estate's ONE owner of "which pairs
 * is the product saying it has no value for" (`repair-value-binding.ts`).
 *
 * TRAP 19 — every assertion binds by IDENTITY: the blocker code, the option id,
 * the factor id, the handler id. Never by a value predicate.
 * TRAP 22b — every claimed case carries its OPPOSITE-DIRECTION TWIN: a
 * legitimate factor-baseline edit on the SAME factor must still write.
 */
import { describe,expect,it } from 'vitest';

import { readFileSync } from 'node:fs';



// The CAPTURED graph — a real drafted model, never authored here (trap 16).
const CAPTURED_GRAPH = (
  JSON.parse(
    readFileSync(
      new URL('../../__tests__/fixtures/witness-2026-08-18/model-compiler-option-effect.json', import.meta.url),
      'utf8',
    ),
  ) as { draft_graph: unknown; ids: Record<string, string> }
);


const OPT_LABEL_CAPTURED = CAPTURED_GRAPH.ids.option_label!;
const FAC_LABEL_CAPTURED = CAPTURED_GRAPH.ids.factor_label!;

// ---------------------------------------------------------------------------
// THE WITNESSED GRAPH IDENTITIES, copied from the capture's readiness payload
// (`turns/002-200-…graph_readiness.json`). Ids and labels verbatim.
// ---------------------------------------------------------------------------

















/**
 * The readiness payload's blocker list, in the `code` spelling the witnessed
 * capture carries. `deriveMissingEffectPairs` reads BOTH spellings; a case
 * below pins the other one so this module cannot become sensitive to which
 * projection it was handed.
 */















describe('⭐⭐ THE WITNESS\'S TWIN — a chip-originated turn is matched on IDENTITY ALONE', () => {
  /**
   * REVIEW FINDING, measured at `1b4e2c1a`. The demotion chips are minted from
   * ONE path with copy that is CONTENT-FREE BY DESIGN
   * (`compose/warrant-demotion.ts:50-52`). Neither message carries `effect`,
   * `intervention` or `configure` — so a prose-gated factor arm could never fire
   * on a chip click, while its edge twin refused. Two arms, one harm, opposite
   * verdicts: trap 21 inside one change.
   *
   * These strings are the chip copy VERBATIM, so the spec REDs if that copy is
   * ever edited into something this guard happens to classify — which would make
   * the test pass for the wrong reason.
   */
  const CHIP_SET_VALUE = 'Set that value in my model.';
  const CHIP_ADJUST_LINK = 'Adjust that link in my model.';





  it('POSITIVE CONTROL — the chip copy really is content-free (it carries no effect vocabulary)', () => {
    // Trap 13: without this, the case above could pass because the copy happens
    // to be effect-framed, and the identity path would never be exercised.
    for (const copy of [CHIP_SET_VALUE, CHIP_ADJUST_LINK]) {
      expect(copy.toLowerCase()).not.toMatch(/\b(effects?|interventions?|configur)/);
    }
  });




});

/**
 * ⭐⭐ THE CORRECTION CHIP'S GAP IS EXACTLY THIS SET.
 *
 * A review swept hostile OPTION-LABEL classes through the offered replay — option
 * labels are the USER'S OWN brief fragments, so this input space is not one I
 * control and a corpus from my own head could not certify it (trap 22). Eleven
 * classes bind correctly; ONE breaks, because a second `to <number>` span in the
 * label defeats the value reader.
 *
 * `buildVerifiedCorrectionReplay` closes the CLASS rather than the case by asking
 * the writer itself. These sets pin the outcome in BOTH directions, following the
 * estate's existing pattern (`option-rephrase-merge.corpus.test.ts`):
 *   · MUST_OFFER  going RED catches the gap GROWING (something stopped working);
 *   · KNOWN_DROPPED length-equality catches it SHRINKING (something started
 *     working, and the row should be deleted rather than the assertion loosened);
 *   · disjointness catches a shape being claimed by both at once.
 */
const CORRECTION_LABEL_MUST_OFFER: readonly { readonly name: string; readonly label: string }[] = [
  { name: 'captured baseline', label: OPT_LABEL_CAPTURED },
  { name: 'full stop inside', label: 'double down on enterprise sales. phase two' },
  { name: 'decimal inside', label: 'double down on enterprise sales at 1.5x quota' },
  { name: 'apostrophe inside', label: "double down on enterprise sales (Q3's push)" },
  { name: 'percent inside', label: 'double down on enterprise sales (12% uplift)' },
  { name: 'contains the factor label', label: `double down on ${FAC_LABEL_CAPTURED}` },
  { name: 'contains the advised phrase', label: "double down on the option's effect on sales" },
];

const CORRECTION_LABEL_KNOWN_DROPPED: readonly {
  readonly name: string;
  readonly label: string;
  readonly why: string;
}[] = [
  {
    name: 'label ends with a second "to <number>" span',
    label: 'raise the enterprise seat minimum from 2 to 5',
    why:
      'the value reader is anchored on `to <number>`; a second span in the OPTION LABEL makes the '
      + 'sentence carry two, so `resolveOptionEffectWrite` declines no_single_unit_scale_value. '
      + 'The mint-time gate drops the chip and the copy asks instead — a dead-end affordance is '
      + 'the class this estate has already paid for twice.',
  },
];

describe('the correction chip is offered for EXACTLY the shapes that work', () => {








  it('⭐ MUST-OFFER and KNOWN-DROPPED are DISJOINT — a label cannot be both', () => {
    const offered = new Set(CORRECTION_LABEL_MUST_OFFER.map((m) => m.label));
    for (const { label } of CORRECTION_LABEL_KNOWN_DROPPED) expect(offered.has(label)).toBe(false);
  });

  it('⭐ every KNOWN-DROPPED row states WHY — a gap without a reason is a to-do', () => {
    expect(CORRECTION_LABEL_KNOWN_DROPPED.length).toBeGreaterThanOrEqual(1);
    for (const row of CORRECTION_LABEL_KNOWN_DROPPED) {
      expect(row.why.length).toBeGreaterThan(40);
    }
  });
});
