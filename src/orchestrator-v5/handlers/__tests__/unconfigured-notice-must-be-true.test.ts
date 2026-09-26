/**
 * A NOTICE THAT NAMES A CAUSE MUST BE BOUND TO THAT CAUSE.
 *
 * ── MEASURED IN A USER SESSION (deployed staging, 23 Sep, scenario `399c2814`)
 * Readiness held exactly ONE issue for thirty-seven minutes:
 *   `OPTION_NEEDS_MAPPING` — since 23 Sep: "Two Developers is linked straight to Coordination
 *   Overhead Risk?" — `repairability: human_input_required`.
 * "Hire a Tech Lead" was `status: ready` throughout.
 *
 * At 23:38:00 the product appended:
 *   "Note: 'Two Developers' does not have effect values yet. Say 'configure the
 *    Two Developers option' … and I'll write in the real numbers."
 *
 * **That was false.** Two Developers already carried effect values on two
 * factors — Delivery Throughput 0.75 and Hiring & Salary Cost £140,000 — and
 * the product had said so itself at 23:15. The user followed the instruction
 * twice; analysis stayed blocked on the edge nobody named.
 *
 * ── THE PREDICATE ──────────────────────────────────────────────────────────
 * `deriveUnconfiguredOptionLabels` selected on `status !== 'ready'`, and
 * `buildUnconfiguredOptionsNotice` then asserted a SPECIFIC fact. Not-ready has
 * several causes (`needs_encoding`, `needs_user_mapping`, …) and only one of
 * them is "no effect values". Trap 19: a claim bound to a predicate another
 * cause satisfies. `option-intervention-write-guard.ts:754` already names this
 * exact sentence as a lie and carries `not_honoured_no_copy` to avoid it.
 *
 * ⚠ SCOPE. These assertions are about WHICH OPTIONS the notice may name. They
 * say nothing about routing — that an "unblock analysis" request reached
 * `adjust_edge_strength` at all is a separate defect with its own fix.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveUnconfiguredOptionLabels,
  buildUnconfiguredOptionsNotice,
  deriveBlockedConfiguredOptions,
  buildBlockedOptionsNotice,
  buildGmHeldAppliedReceipt,
} from '../gm-held-execute.js';

describe('the unconfigured-options notice only names options that are', () => {
  it('EXCLUDES an option that provably HAS effect values — Paul’s exact case', () => {
    const labels = deriveUnconfiguredOptionLabels({
      status: 'needs_user_mapping',
      options: [
        {
          option_id: 'be215545',
          label: 'Two Developers',
          status: 'needs_user_mapping',
          // Blocked by an unmapped EDGE, not by missing values.
          interventions: { fac_throughput: 0.75, fac_hiring_cost: 140000 },
        },
        { option_id: 'e70301eb', label: 'Hire a Tech Lead', status: 'ready' },
      ],
    });
    expect(labels).toEqual([]);
    // …and therefore no false sentence is produced at all.
    expect(buildUnconfiguredOptionsNotice(labels)).toBeNull();
  });

  it('CONTROL: an option with NO effect values is still named', () => {
    const labels = deriveUnconfiguredOptionLabels({
      options: [{ option_id: 'o1', label: 'Do nothing new', status: 'needs_encoding', interventions: {} }],
    });
    expect(labels).toEqual(['Do nothing new']);
    expect(buildUnconfiguredOptionsNotice(labels)).toContain('does not have effect values yet');
  });

  it('CONTROL: absence of the field is NOT proof of absence — behaviour unchanged', () => {
    // The narrow projection predates `interventions`. Where it is missing we
    // cannot prove the option has values, so the notice fires exactly as before.
    const labels = deriveUnconfiguredOptionLabels({
      options: [{ option_id: 'o1', label: 'Legacy shaped option', status: 'needs_user_mapping' }],
    });
    expect(labels).toEqual(['Legacy shaped option']);
  });

  it('CONTROL: a ready option is never named, values or not', () => {
    expect(
      deriveUnconfiguredOptionLabels({
        options: [{ option_id: 'o1', label: 'Ready one', status: 'ready', interventions: {} }],
      }),
    ).toEqual([]);
  });

  it('a mixed board names only the genuinely value-less option', () => {
    const labels = deriveUnconfiguredOptionLabels({
      options: [
        { option_id: 'o1', label: 'Configured but unmapped', status: 'needs_user_mapping', interventions: { f: 0.5 } },
        { option_id: 'o2', label: 'Genuinely empty', status: 'needs_encoding', interventions: {} },
        { option_id: 'o3', label: 'Ready', status: 'ready' },
      ],
    });
    expect(labels).toEqual(['Genuinely empty']);
  });
});

/**
 * ⛔ REMOVING A LIE MUST NOT LEAVE SILENCE. An independent review found that
 * filtering the false "no effect values" sentence left an option that genuinely
 * blocks the analysis with NO surface naming it — and being told nothing is how
 * a user spends thirty-seven minutes on the wrong obligation. The claim is
 * narrowed, not deleted.
 */
describe('an option blocked for another reason is still named', () => {
  const readiness = {
    options: [
      {
        option_id: 'be215545',
        label: 'Two Developers',
        status: 'needs_user_mapping',
        interventions: { fac_throughput: 0.75, fac_hiring_cost: 140000 },
        status_reason: 'A proposed effect still needs a supported mapping',
      },
      { option_id: 'e70301eb', label: 'Hire a Tech Lead', status: 'ready' },
    ],
  };

  it("names the option and the projection's OWN reason", () => {
    const blocked = deriveBlockedConfiguredOptions(readiness);
    expect(blocked).toEqual([
      { label: 'Two Developers', reason: 'A proposed effect still needs a supported mapping' },
    ]);
    const notice = buildBlockedOptionsNotice(blocked);
    expect(notice).toContain("'Two Developers' isn't settled yet");
    expect(notice).toContain('A proposed effect still needs a supported mapping');
    // ⛔ and it must NOT resurrect the false cause.
    expect(notice).not.toMatch(/effect values/i);
  });

  it("invents no cause when the projection carries none", () => {
    const notice = buildBlockedOptionsNotice([{ label: 'X' }]);
    expect(notice).toBe("Note: 'X' isn't settled yet.");
  });

  it('the applied receipt carries the true notice end to end', () => {
    const text = buildGmHeldAppliedReceipt(
      ["link 'Two Developers' to 'Team Technical Capability'"],
      deriveUnconfiguredOptionLabels(readiness),
      deriveBlockedConfiguredOptions(readiness),
    );
    expect(text).toContain('Confirmed:');
    expect(text).toContain("'Two Developers' isn't settled yet");
    // The measured misdirection must be gone from the whole receipt.
    expect(text).not.toMatch(/does not have effect values/i);
  });

  it('CONTROL: a ready board adds no blocked notice at all', () => {
    const ready = { options: [{ option_id: 'o1', label: 'A', status: 'ready', interventions: { f: 1 } }] };
    expect(deriveBlockedConfiguredOptions(ready)).toEqual([]);
    expect(buildBlockedOptionsNotice([])).toBeNull();
  });

  it('a NULL interventions value does not throw (Object.keys(null) would)', () => {
    // The reviewer's surviving mutant: dropping the `iv === null` conjunct.
    const nulled = {
      options: [{ option_id: 'o1', label: 'Nulled', status: 'needs_user_mapping', interventions: null }],
    } as unknown as { readonly options: readonly never[] };
    expect(() => deriveUnconfiguredOptionLabels(nulled)).not.toThrow();
    expect(deriveUnconfiguredOptionLabels(nulled)).toEqual(['Nulled']);
    expect(() => deriveBlockedConfiguredOptions(nulled)).not.toThrow();
    expect(deriveBlockedConfiguredOptions(nulled)).toEqual([]);
  });
});

/**
 * ⛔ A COUNT IS NOT A DISCLOSURE. The plural branch said "Note: 2 options still
 * block the analysis." — no names, no reasons, nothing to act on — while the
 * receipt still directed the user at a DIFFERENT, unconfigured option whose
 * repair would not unblock anything. A reviewer identified that as reinstating
 * the exact condition this notice exists to remove.
 */
describe('every blocked option is named, not counted', () => {
  const two = [
    { label: 'Two Developers', reason: 'A proposed effect still needs a supported mapping' },
    { label: 'Hire Contractors', reason: 'An effect target is unresolved' },
  ];

  it('names both options AND both reasons', () => {
    const notice = buildBlockedOptionsNotice(two) as string;
    expect(notice).toContain('Two Developers');
    expect(notice).toContain('Hire Contractors');
    expect(notice).toContain('A proposed effect still needs a supported mapping');
    expect(notice).toContain('An effect target is unresolved');
  });

  /**
   * ⛔ THE MULTI-ENTRY NOTICE WAS AMBIGUOUS, AND THE SEPARATORS ARE CHARACTERS
   * REAL CONTENT CONTAINS.
   *
   * Shipped in #1855 and live on staging until this fix. Unquoted, a label of
   * "Phase 1 — pilot" and a reason ending "; then train" render as:
   *
   *   2 options aren't settled yet: Phase 1 — pilot; Hire; then train.
   *
   * — three apparent items for two options, and no way for the user to tell
   * which option is meant. The SINGLE-entry branch has always quoted; only the
   * multi-entry branch, where the ambiguity can actually arise, lacked it.
   */
  it('⭐ each option is FENCED, so a label containing the separators stays legible', () => {
    const notice = buildBlockedOptionsNotice([
      { option_id: 'o1', label: 'Phase 1 — pilot', reason: 'needs a mapping; then train', is_question: false },
      { option_id: 'o2', label: 'Hire', reason: 'needs a value', is_question: false },
    ] as never) as string;
    expect(notice).toContain("'Phase 1 — pilot'");
    expect(notice).toContain("'Hire'");
    // The count and the number of fenced labels must agree — that agreement is
    // what makes the sentence readable, and it is what was broken.
    const fenced = (notice.match(/'[^']+'/g) ?? []).length;
    expect(fenced, 'every named option is fenced').toBe(2);
  });

  it('CONTROL: the single-entry branch quoted all along — unchanged', () => {
    const notice = buildBlockedOptionsNotice([
      { option_id: 'o1', label: 'Hire', reason: 'needs a value', is_question: false },
    ] as never) as string;
    expect(notice).toContain("'Hire'");
  });

  it('a bare count with no names is never emitted', () => {
    const notice = buildBlockedOptionsNotice(two) as string;
    expect(notice).not.toMatch(/^\d+ options aren't settled yet:?$/);
  });

  it('names an option even when its reason is absent', () => {
    const notice = buildBlockedOptionsNotice([{ label: 'A' }, { label: 'B' }]) as string;
    expect(notice).toContain('A');
    expect(notice).toContain('B');
  });
});

/**
 * ⛔ ASK THE QUESTION, DO NOT REPORT THE DIAGNOSIS.
 *
 * An independent audit found this notice reaching PAST `user_questions` — the
 * producer's own answerable prose, already on the same payload — to interpolate
 * `status_reason`, which the schema documents as a DEBUGGING field.
 *
 * Measured on real persisted graphs, the two fields differ completely:
 *   status_reason  : "A proposed effect still needs a supported mapping"
 *                    (identical boilerplate on every option)
 *   user_questions : "How does 9-day Fortnight change Coordination and Handover
 *                     Risk?" / "What value should «factor» be set to for option
 *                     «option»?"
 *
 * Olumi's job is to surface the judgement the team has not yet made. Only the
 * question does that; the diagnosis asks them to decode our internals.
 */
describe('the notice asks the payload\u2019s own question', () => {
  const withQuestion = {
    options: [
      {
        option_id: 'o1', label: '9-day Fortnight', status: 'needs_user_mapping',
        interventions: { f: 0.5 },
        status_reason: 'A proposed effect still needs a supported mapping',
        user_questions: ['How does 9-day Fortnight change Coordination and Handover Risk?'],
      },
    ],
  };

  it('prefers user_questions over the debugging field', () => {
    const [b] = deriveBlockedConfiguredOptions(withQuestion);
    expect(b.reason).toBe('How does 9-day Fortnight change Coordination and Handover Risk?');
    expect(b.is_question).toBe(true);
    const notice = buildBlockedOptionsNotice([b]) as string;
    expect(notice).toContain('How does 9-day Fortnight change Coordination and Handover Risk');
    // ⛔ the debugging diagnosis must not reach the user
    expect(notice).not.toContain('supported mapping');
  });

  it('CONTROL: falls back to status_reason only when no question exists', () => {
    const [b] = deriveBlockedConfiguredOptions({
      options: [{ option_id: 'o1', label: 'X', status: 'needs_encoding',
                  interventions: { f: 1 }, status_reason: 'some diagnosis' }],
    });
    expect(b.reason).toBe('some diagnosis');
    expect(b.is_question).toBeUndefined();
  });

  it('an empty user_questions array does not mask the fallback', () => {
    const [b] = deriveBlockedConfiguredOptions({
      options: [{ option_id: 'o1', label: 'X', status: 'needs_encoding',
                  interventions: { f: 1 }, user_questions: ['   '], status_reason: 'some diagnosis' }],
    });
    expect(b.reason).toBe('some diagnosis');
  });

  /**
   * ⛔ THE INVARIANT RAN ON ONE BRANCH AND THE PRODUCT USES THE OTHER.
   *
   * This assertion existed, and passed, while `buildBlockedOptionsNotice`
   * could still be reverted to literally "Note: 2 options still block the
   * analysis" — because it only ever called the builder with a SINGLE entry,
   * and the multi-entry branch is a separate `return`. Measured over real
   * persisted graphs the split is 7 single / 27 multi, so **79% of live
   * notices took the unguarded branch**. A surviving mutant found it; reading
   * the test did not.
   *
   * It is now driven by entry count so every emitting branch is covered.
   */
  it.each([1, 2, 3])('the notice never frames the option as blocking a machine (%i entries)', (n) => {
    const [b] = deriveBlockedConfiguredOptions(withQuestion);
    const entries = Array.from({ length: n }, (_, i) => ({ ...b, label: `Option ${i + 1}` }));
    const notice = buildBlockedOptionsNotice(entries) as string;
    expect(notice).not.toMatch(/block(s|ing)? the analysis/i);
    expect(notice).toMatch(/(isn't|aren't) settled yet/i);
    // Every emitting branch names what it is talking about — a bare count is
    // the failure this notice was built to remove.
    for (const e of entries) expect(notice).toContain(e.label);
  });

  /**
   * ⛔ BOUND BY IDENTITY, NOT BY A VALUE THE FALL-THROUGH ALSO SATISFIES.
   * "contains the question text" is true of the diagnosis branch too whenever
   * the diagnosis happens to be a question, so it cannot witness WHICH branch
   * ran. The discriminator is the branch's own shape: the question form leads
   * with the label and carries an em dash; the fall-through is prefixed
   * "Note:".
   */
  it('the question-lead form is the one that ran, not merely the right words', () => {
    const [q] = deriveBlockedConfiguredOptions(withQuestion);
    const lead = buildBlockedOptionsNotice([q]) as string;
    expect(lead.startsWith("'")).toBe(true);
    expect(lead).not.toMatch(/^Note:/);
    expect(lead).toContain(' — ');

    // CONTRAST: same builder, no question — the other branch, discriminably.
    const fallback = buildBlockedOptionsNotice([
      { ...q, is_question: false, reason: 'a diagnosis' },
    ]) as string;
    expect(fallback).toMatch(/^Note:/);
  });

  /**
   * The terminator is conditional: a `user_questions` entry ends in '?', and
   * `sentence()` strips each entry's own full stop in the multi-entry join.
   * Appending unconditionally gives "?."; appending nothing leaves the notice
   * running into the text the receipt joins after it.
   */
  it('every notice ends in exactly one terminal mark, question or not', () => {
    const [q] = deriveBlockedConfiguredOptions(withQuestion);
    const cases = [
      buildBlockedOptionsNotice([q]),
      buildBlockedOptionsNotice([{ ...q, is_question: false, reason: 'a diagnosis' }]),
      buildBlockedOptionsNotice([q, { ...q, label: 'Second' }]),
      buildBlockedOptionsNotice([{ ...q, is_question: false, reason: undefined }]),
      // ⛔ THE DISCRIMINATING CASE. Every case above happens to end in '?' or
      // in the single-entry template's own '.', so all of them pass with the
      // terminator removed entirely — a mutant proved it. `sentence()` strips a
      // trailing '.' from each entry, so a multi-entry notice whose LAST reason
      // ends in a full stop is the only shape that witnesses the append.
      buildBlockedOptionsNotice([
        { ...q, is_question: false, label: 'First', reason: 'one reason.' },
        { ...q, is_question: false, label: 'Second', reason: 'another reason.' },
      ]),
    ] as string[];
    for (const c of cases) {
      expect(c).toMatch(/[.!?]$/);
      expect(c).not.toMatch(/[.!?]{2}$/);
    }
  });
});
