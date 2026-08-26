/**
 * ⭐⭐ ROADMAP 2.1269 — THE `answered` TERMINATING REPLY MUST NAME A DESTINATION
 * THAT CAN ACTUALLY SAVE.
 *
 * ## The defect
 *
 * The `answered` arm ended with `buildConfigureOptionDirectSetSentence`:
 *
 *   "To set it directly, open "<option>" on the canvas and add <factor> to what
 *    it changes."
 *
 * WITNESSED reaching a real user's read surface verbatim on deployed CEE
 * `c24bfe3` (signed-in wire drive, 14/14 Route-A probes, 2 users, 2 scenarios,
 * `llm_calls: []`, HTTP 200 in 3498 ms):
 *
 *   *"…still has no effect value on CRM Adoption Risk, so that link is not
 *   carrying anything yet. To set it directly, open "replace our current CRM
 *   with HubSpot next quarter" on the canvas and add CRM Adoption Risk to what
 *   it changes."*
 *
 * The canvas cannot save it. DERIVED AT THE SERVED BUNDLE (`ReactFlowGraph-ozVez5O5.js`):
 * `disabled:!0` is a literal there, there are EXACTLY TWO fieldset sites in the
 * whole bundle and BOTH are disabled, there are ZERO `removeAttribute("disabled")`
 * calls and ZERO `createPortal` in `inspector-v2` against a live contrast
 * elsewhere in the same bundle.
 *
 * ⚠⚠ RUNG, STATED EXACTLY: **DERIVED AT THE SERVED BUNDLE — NOT DOM-WITNESSED.**
 * No lane has observed a real `:disabled` computed state in a browser. That is
 * one rung below wire/DOM witness and this header must not be read as claiming
 * it.
 *
 * ## Why these assertions are shaped this way
 *
 * ⭐ THEY PIN THE PROPERTIES, NOT THE BYTES. A spec that asserted the new
 * literal would pass forever while someone reintroduced "the canvas" in a
 * reworded sentence — it would be a tautology restating the diff (CLAUDE.md
 * trap 19 at copy grain). Each `it` below names the PROPERTY that makes the
 * reply true, and each would RED on a reworded false sentence.
 *
 * ⚠ `UNSAVEABLE_SURFACES` is a HAND-WRITTEN corpus and is declared as one. It
 * cannot be derived: the authority that would make it derivable
 * (`sectionWriterNotice.ts`'s `modelOptionIntervention: 'disabled'`) lives in the
 * UI repo and is NOT read as a dependency there either —
 * `InspectorRouter.tsx:335` hardcodes the boolean (rowed). Per trap 12d a
 * hand-written corpus is exactly the instrument that notices a derived list is
 * short, so it is the right shape here — but its epistemics are stated, not
 * hidden.
 */

import { describe, it, expect } from 'vitest';

import {
  composeConfigureOptionClarifyResponse,
  CONFIGURE_OPTION_EXAMPLE_VALUE,
} from '../configure-option-clarify-response.js';

/**
 * A label long enough to be truncated by the UI's own `safeLabel` budget (60
 * chars). The repo's 2026-08-18 capture recorded real option labels of 84-101
 * characters, so this is representative, not adversarial.
 */
const OPTION = 'replace our current CRM with HubSpot next quarter and retire the legacy pipeline';
const FACTOR = 'CRM Adoption Risk';

/** Selects the `answered` terminating branch: a number was given, nothing attached. */
const ANSWERED = `Set the ${OPTION} option's effect on ${FACTOR} to 0.6`;
/** Selects the demand branch — the opposite-direction control. */
const NOT_AN_ANSWER = `Configure ${OPTION}`;

const compose = (message: string) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    message,
    analysisWillProceed: true,
  }).assistant_text;

/**
 * The same branch with the OPTIONAL analysis sentence withheld.
 *
 * ⚠ NOT a convenience. `analysisSentence` legitimately names the option label a
 * second time ("…it will name "<option>" as left out of the comparison"), which
 * is honest description and out of scope here. Counting label occurrences over
 * the full reply would therefore measure that sentence as well as the one under
 * test, and the count would be a number about the wrong thing.
 */
const composeWithoutAnalysisSentence = (message: string) =>
  composeConfigureOptionClarifyResponse({
    optionLabel: OPTION,
    factorLabels: [FACTOR],
    stage: 'analyse',
    message,
  }).assistant_text;

/**
 * Surfaces measured UNABLE to persist an option's effect value at this tip.
 * Each carries its own measurement so a later reader can refute it rather than
 * inherit it.
 */
const UNSAVEABLE_SURFACES: ReadonlyArray<readonly [string, RegExp]> = [
  // Served bundle: both fieldset sites `disabled:!0`; a forced native write on
  // 2026-08-25 produced ZERO wire calls.
  ['the canvas option panel', /\bcanvas\b/i],
  // `editConnectedIds` is built from FACTOR nodes only (`ModelTabV2Panel.tsx:216-220`),
  // so `editorAvailable` is false for every option and `ValueCell` renders a
  // `<span>`; `modelOptionIntervention: 'disabled'` makes the intervention
  // targets inert too. Measured at `d0e24ccc`.
  ['the Model tab', /\bmodel tab\b/i],
  // `model-tab/OptionsSection.tsx:321-330` renders a real `InlineEdit`, but it is
  // DEAD: `ModelTabBody.tsx:120` `LEGACY_DETAILED_EDITOR_MOUNTED = false`.
  ['the options section', /\boptions section\b/i],
  // The witnessed 2026-08-19 dead end: `EdgePanel`'s intervention branch renders
  // two `<p>` tags and no controls.
  ['the option→factor link panel', /\benter the value on\b/i],
];

describe('2.1269 — the answered reply sends the user somewhere that can save', () => {
  it('PRECONDITION — the message really does select the `answered` terminating branch', () => {
    // Trap 13b: a discriminator must pin its own precondition, or every
    // assertion below could be passing about a branch that merely agrees.
    const terminating = compose(ANSWERED);
    const demand = compose(NOT_AN_ANSWER);
    expect(terminating).not.toBe(demand);
    expect(terminating).toContain('still has no effect value on');
  });

  it.each(UNSAVEABLE_SURFACES)(
    'does NOT direct the user to %s, which cannot persist the value',
    (_name, pattern) => {
      expect(compose(ANSWERED)).not.toMatch(pattern);
    },
  );

  it('commits to performing the write itself — the only destination witnessed to land one', () => {
    // The property that makes the reply TRUE, not merely inoffensive. Deleting
    // the surface name without offering a working destination would satisfy
    // every negative assertion above and still leave the user stranded.
    expect(compose(ANSWERED)).toMatch(/\bI'?ll set\b/i);
  });

  it('asks for the NUMBER ALONE — it never asks the user to reproduce the option label', () => {
    // ⭐ THE LABEL-TRUNCATION REASON. The UI's `safeLabel` truncates option
    // labels at 60 characters, and `resolveOptionEffectWrite` returns
    // `option_not_named` on a truncated label — so a user who copies the label
    // AS THE PRODUCT RENDERS IT cannot name it back. Chat works for the
    // BARE-NUMBER form and fails for the label-bearing form.
    //
    // Bound as a COUNT, not a ban: sentence 1 names the option once and that is
    // honest description. What must not exist is a SECOND, action-directed
    // repetition inviting the user to retype it.
    const reply = composeWithoutAnalysisSentence(ANSWERED);
    // Pin the precondition of the count itself: this really is the two-sentence
    // form, so a 1 below is the direct-set sentence being label-free and not the
    // analysis sentence silently going missing.
    expect(reply).toContain('still has no effect value on');
    expect(reply).not.toMatch(/left out of the comparison/i);
    expect(reply.split(OPTION).length - 1).toBe(1);
  });

  it('carries a DECIMAL exemplar, and it is the estate-wide one', () => {
    // `matchBareRepairValue` REFUSES a bare integer as "an ordinal in disguise"
    // (a naked `1` measured binding as 1.0 where the user meant "the first
    // one"), so copy inviting "1" would invite a token that will not bind.
    const terminating = compose(ANSWERED);
    expect(terminating).toMatch(/\b\d+\.\d+\b/);
    // Derived, not transcribed: if the shipped example value moves, this moves
    // with it instead of pinning a literal that has drifted (trap 12).
    expect(terminating).toContain(CONFIGURE_OPTION_EXAMPLE_VALUE);
    expect(CONFIGURE_OPTION_EXAMPLE_VALUE).toMatch(/\b\d+\.\d+\b/);
  });

  it('CONTRAST CONTROL — the honest descriptive sentences survive', () => {
    // Anti-overreach (trap 22b: one predicate, two opposite harms). A fix that
    // scrubbed "link" or the option label everywhere would pass every negative
    // assertion above while deleting true sentences. These point the opposite
    // way and MUST stay green.
    const terminating = compose(ANSWERED);
    expect(terminating).toContain(`"${OPTION}" still has no effect value on ${FACTOR}`);
    expect(terminating).toMatch(/that link is not carrying anything yet/i);
    expect(compose(NOT_AN_ANSWER)).toMatch(/It is linked to/i);
  });
});
