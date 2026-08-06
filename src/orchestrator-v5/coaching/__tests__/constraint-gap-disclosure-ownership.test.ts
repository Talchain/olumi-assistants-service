/**
 * ROADMAP 2.653 (I-C) — a limit the system could not check is disclosed as
 * OURS to resolve, and the offer it makes is one we can keep.
 *
 * WITNESSED DEFECT (walk-2634 J5/J6, reproduced byte-identically in
 * `consent-witness-findings-2026-08-07.md` §2). The primary analysis message
 * read, verbatim:
 *
 *   "One of the conditions you set was not checked: “churn could rise floor”.
 *    The analysis engine could not evaluate it against this model, so no option
 *    can be put forward yet. Re-state that limit against a measure recorded in
 *    the same units as the limit, then run the analysis again."
 *
 * Three claims, in one sentence each, and all three were wrong for the session
 * they were shown in:
 *
 *   1. ATTRIBUTION — "the conditions you set". The tester set nothing. CEE's
 *      own brief extractor minted the row from "customer churn could rise above
 *      3%" and showed it to them for the first time inside this message.
 *   2. OWNERSHIP — "the analysis engine could not evaluate it" names a third
 *      party the user cannot reach, for a failure that begins in this service.
 *   3. PRESCRIPTION — a UNITS repair, for a constraint whose defect was its
 *      SIGN. No restatement in any units could ever have fixed it; the
 *      Work-through-it exercise had to say so on the third prompt.
 *
 * The rule was already in this module, applied to a different voice:
 * `unresolvedRepairStep` is documented as "deliberately NOT the units advice
 * above… telling the user to fix their units would assert a diagnosis this
 * state exists precisely because CEE cannot make". These tests hold the
 * `unevaluated` voice to the same standard, and pin the capability its new
 * offer claims so that the offer cannot outlive the handler that keeps it.
 */
import { describe, it, expect } from 'vitest';

import { buildConstraintDisclosureFromState } from '../constraint-gap-disclosure.js';
import { composeWithheldReasonTail } from '../../compose/withheld-reason-tail.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../../routing/mutation-consent.js';
import { getDefaultRegistry } from '../../tools/registry.js';

const ONE = [{ constraint_id: 'c1', label: 'Keep churn at or below 3%' }] as const;
const MANY = [
  { constraint_id: 'c1', label: 'Keep churn at or below 3%' },
  { constraint_id: 'c2', label: 'Keep costs at or below £50,000' },
] as const;

/** Every user-facing string the `unevaluated` state can put on a screen. */
function everyUnevaluatedVoice(): string[] {
  return [
    buildConstraintDisclosureFromState('unevaluated', ONE),
    buildConstraintDisclosureFromState('unevaluated', MANY),
    buildConstraintDisclosureFromState('unevaluated', [
      { constraint_id: 'c1', label: null },
    ]),
    composeWithheldReasonTail('unevaluated', ONE)?.text ?? '',
    composeWithheldReasonTail('unevaluated', [])?.text ?? '',
  ].filter((s) => s.length > 0);
}

describe('2.653 I-C — the unevaluated voice makes no authorship claim', () => {
  it('says nothing about who set the limit, on EVERY surface that speaks this state', () => {
    // Both surfaces, because a user reaches either one and a fix confined to the
    // primary message would leave the identical claim witnessable on the tail.
    const voices = everyUnevaluatedVoice();
    expect(voices.length).toBeGreaterThanOrEqual(5);
    for (const text of voices) {
      expect(text).not.toMatch(/conditions? you set/i);
      expect(text).not.toMatch(/\byou (?:set|wrote|chose|specified)\b/i);
    }
  });

  it('and still identifies WHOSE model the limit sits on, so it is not vague', () => {
    // The replacement must not be a retreat into anonymity: withdrawing a false
    // claim by saying nothing at all would leave the user unable to tell which
    // model the message is about.
    for (const text of everyUnevaluatedVoice()) {
      expect(text).toMatch(/on your model/i);
    }
  });
});

describe('2.653 I-C — the failure is stated as ours, and no diagnosis is asserted', () => {
  it('never prescribes a units repair', () => {
    // The exact prescription the walk received, for a defect it could not fix.
    for (const text of everyUnevaluatedVoice()) {
      expect(text).not.toMatch(/same units/i);
      expect(text).not.toMatch(/Re-state that limit/i);
    }
  });

  it('does not hand the failure to "the analysis engine"', () => {
    for (const text of everyUnevaluatedVoice()) {
      expect(text).not.toMatch(/the analysis engine could not evaluate/i);
    }
  });

  it('the primary message says what WE could not do', () => {
    const text = buildConstraintDisclosureFromState('unevaluated', ONE);
    expect(text).toContain('We could not line it up with anything this analysis measures');
  });

  it('the identity_unresolved voice is untouched and still distinct from this one', () => {
    // Trap 13b: rewriting one voice must not quietly collapse it into its
    // sibling. These two states make different statements and each of them
    // costs the user something different; a message that could be either is a
    // message that answers neither.
    const unevaluated = buildConstraintDisclosureFromState('unevaluated', ONE);
    const unresolved = buildConstraintDisclosureFromState('identity_unresolved', ONE);
    expect(unresolved).not.toContain('could not be checked');
    expect(unresolved).toContain('could not be matched');
    expect(unevaluated).not.toContain('could not be matched');
  });
});

describe('2.653 I-C — the offer is one the product can keep', () => {
  it('offers to record the limit the user describes', () => {
    for (const text of everyUnevaluatedVoice()) {
      expect(text).toContain('Tell me the limit you meant in your own words and I will record it');
    }
  });

  it('⭐ THE CAPABILITY CLAIM IS PINNED TO THE LIVE HANDLER REGISTRY', () => {
    // "I will record it" is `add_constraint`. If that handler is ever
    // unregistered, this copy becomes the exact defect class ROADMAP 2.663 was
    // opened for — a capability sentence that is false on the deployment
    // serving it — and the walk already caught the product denying, two turns
    // after doing, a thing it could do. So the claim REDs here rather than
    // shipping dark.
    expect(GRAPH_MUTATING_HANDLER_IDS).toContain('add_constraint');
    expect([...getDefaultRegistry().keys()]).toContain('add_constraint');
  });

  it('⭐ AND IT DISCLOSES THE RESIDUAL — the bad row stays, because nothing can remove it', () => {
    // ROADMAP 2.659: there is no conversational remove/replace-constraint
    // operation, so a correction APPENDS beside the defective row. The walk
    // watched the product do exactly that silently and turn one unevaluable
    // constraint into two, both then blamed on the user. Saying so is the INV-2
    // discipline #836 established — a repair that cannot touch the defective
    // row must disclose that the row remains.
    for (const text of everyUnevaluatedVoice()) {
      expect(text).toContain('this one stays on the model');
    }
    // The claim must be TRUE at this tip: no remove-constraint handler exists.
    expect([...getDefaultRegistry().keys()]).not.toContain('remove_constraint');
  });

  it('still tells the user the run has to happen again', () => {
    for (const text of everyUnevaluatedVoice()) {
      expect(text).toMatch(/run the analysis again/i);
    }
  });
});
