/**
 * L-?? — THE TERMINATING REPLY MUST NAME A LOCUS THAT HAS CONTROLS.
 *
 * ## The defect, witnessed 2026-08-19
 *
 * The terminating branch of `composeConfigureOptionClarifyResponse` ended with:
 *
 *   "To set it directly, open "<option>" on the canvas and enter the value on
 *    its link to <factor>."
 *
 * A witness followed that instruction and reached a dead end. Derived at the UI
 * tip `3f59325aa4e31197516c784c0c6ad1d9a9588c42` (`DecisionGuideAI`, staging):
 *
 *   - The option→factor edge is `isIntervention` in
 *     `src/canvas/ui/inspector-v2/panels/EdgePanel.tsx:180`, and its branch
 *     (`:305-311`, testid `intervention-edge-notice`) renders TWO `<p>` tags
 *     and NOTHING ELSE. There is no input, no slider, no button.
 *   - CONTRAST CONTROL, same file: the causal branch at `:313-472` carries the
 *     strength/existence/std sliders. The probe can see controls where they
 *     exist, so the absence above is real absence and not a blind read.
 *
 * ## ⛔ THE CANVAS ANSWER THIS FILE ORIGINALLY GAVE HAS BEEN REFUTED — 2.1269
 *
 * This header used to continue "the locus that DOES work" and argue that the
 * OPTION panel edits the same field the edge cannot. The field claim is still
 * right — CEE writes `data/interventions/<factorId>` on the OPTION node
 * (`graph-management/__tests__/option-effect-write-apply-chain.test.ts`,
 * `op: 'update_node'`) — but the reachability claim is FALSE at the served
 * bundle, and it was drawn from `OptionPanel.tsx`'s own comment ("Primary
 * editing surface: intervention inputs MUST remain editable"), which is a
 * statement of INTENT that the shipped code no longer honours.
 *
 * DERIVED AT THE SERVED BUNDLE (`ReactFlowGraph-ozVez5O5.js`): `disabled:!0` is a
 * literal there; EXACTLY TWO fieldset sites exist in the whole bundle and BOTH
 * are disabled; ZERO `removeAttribute("disabled")`; ZERO `createPortal` in
 * `inspector-v2`, against a live contrast elsewhere in the same bundle. A forced
 * native write on 2026-08-25 produced ZERO wire calls.
 *
 * ⚠⚠ RUNG, STATED EXACTLY: **DERIVED AT THE SERVED BUNDLE — NOT DOM-WITNESSED.**
 *
 * ⭐ THE LESSON THIS FILE NOW CARRIES: reasoning from a component's own header
 * comment is reading a hand-maintained mirror (trap 12). The 2026-08-19 witness
 * above was direct evidence and has held; the canvas derivation was inference
 * from prose and lasted six days.
 *
 * The convergence point stands unchanged: the locus has ONE owner
 * (`buildConfigureOptionDirectSetSentence`, beside the chip/advised-format
 * builders already declared the single source of configure-option copy), which is
 * precisely why re-pointing it at chat was a one-line change rather than a sweep.
 * The properties of the replacement are pinned in
 * `configure-option-answered-locus-can-save.test.ts`; this file keeps pinning the
 * ORIGINAL witnessed defect, which must never return.
 *
 * ## Why these assertions are shaped this way
 *
 * The positive assertion binds to the EXPORTED BUILDER, not to the sentence
 * string — the string is the thing under change, so matching it would pass on
 * any reword including another false one (CLAUDE.md trap 19: bind by identity).
 * The negative assertion pins the WITNESSED defect specifically: an instruction
 * to enter the value ON THE LINK. It is deliberately narrow. The composer's
 * truthful `linkSentence` ("It is linked to X, and that link has no value yet")
 * DESCRIBES the link and must keep passing — describing the link is honest,
 * directing an action at it is not.
 */

import { describe, it, expect } from 'vitest';

import { composeConfigureOptionClarifyResponse } from '../configure-option-clarify-response.js';
import {
  buildConfigureOptionDirectSetSentence,
  buildConfigureOptionAdvisedFormat,
} from '../../configure-option-chip-text.js';

const OPTION = 'Hire 3 Senior Engineers';
const FACTOR = 'Engineering Delivery Velocity';

/** Verbatim compliance with the product's own advised phrasing — the message
 *  that selects the TERMINATING branch (the branch that carries the locus). */
const ANSWERED = `Set the ${OPTION} option's effect on ${FACTOR} to 0.6`;
/** A message that is NOT an answer — selects the demand branch. */
const NOT_AN_ANSWER = `Configure ${OPTION}`;

const compose = (message: string) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    message,
    analysisWillProceed: true,
  }).assistant_text;

describe('2.1268 — the terminating reply names a locus that has controls', () => {
  it('PRECONDITION — the message under test really does select the terminating branch', () => {
    // Pinned in-test so the assertions below are provably about the terminating
    // branch and not about a branch that merely happens to agree (trap 13b: a
    // discriminator must pin its own precondition).
    const terminating = compose(ANSWERED);
    const demand = compose(NOT_AN_ANSWER);
    expect(terminating).not.toBe(demand);
    expect(terminating).toContain('still has no effect value on');
  });

  it('the direct-set instruction comes from the SINGLE owner, not a local spelling', () => {
    const terminating = compose(ANSWERED);
    // IDENTITY BINDING: the exported builder, not the sentence text. If the
    // composer ever re-spells this sentence locally, this REDs.
    expect(terminating).toContain(buildConfigureOptionDirectSetSentence());
  });

  it('it does NOT direct the user to enter the value on the option→factor LINK', () => {
    const terminating = compose(ANSWERED);
    // The witnessed dead end. `EdgePanel`'s intervention branch has zero
    // controls, so any instruction to enter a value there is false.
    expect(terminating).not.toMatch(/\bon (?:its|the) link\b/i);
    expect(terminating).not.toMatch(/enter the value on\b/i);
  });

  it('it still DESCRIBES the link truthfully in the demand branch — the fix is the locus, not the noun', () => {
    // CONTRAST CONTROL / anti-overreach: the honest descriptive use of "link"
    // must survive. A fix that scrubbed the word everywhere would pass the
    // assertion above while deleting a true sentence.
    const demand = compose(NOT_AN_ANSWER);
    expect(demand).toMatch(/It is linked to/i);
  });

  it('the terminating reply does NOT re-issue the demand (existing decision preserved)', () => {
    // Guards the interaction between this change and the 2.1267 termination
    // decision: the direct-set sentence must not become a restatement of the
    // advised format, which is what the terminating branch exists to stop.
    const terminating = compose(ANSWERED);
    expect(terminating).not.toContain(
      buildConfigureOptionAdvisedFormat(OPTION, FACTOR, '0.6'),
    );
    expect(terminating).not.toContain("option's effect on");
  });
});
