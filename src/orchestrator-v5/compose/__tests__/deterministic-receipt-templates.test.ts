/**
 * THE DETERMINISTIC RECEIPT TEMPLATES ARE DOCTRINE-CLEAN — classified as
 * TEMPLATES, with their label slots slot-shaped, so no label content ever
 * participates in the classification.
 *
 * ── WHY THIS FILE EXISTS, AND WHAT IT REPLACED ─────────────────────────────
 *
 * A reproduced defect (Codex audit finding 2): the deterministic mutation path
 * interpolates a persisted graph label into a receipt
 * (`Updated ${label} from X to Y.`), COMMITS it, and only then runs the egress
 * guard. A user whose factor is named "Advisable" durably commits their change
 * and is shown the neutral fallback instead of their receipt — and one named
 * "Recommended Spend" had the receipt silently rewritten to "Suggested Spend",
 * naming a factor that does not exist.
 *
 * ⚠ THE FIRST FIX FOR THIS WAS WRONG AND HAS BEEN REVERTED IN FULL. It masked
 * user-origin spans in the COMPOSED string before classifying. Review found the
 * premise false at its root, and every finding reproduced at the bytes:
 *
 *   · a label that is merely a FRAGMENT of a banned frame disabled that frame
 *     across the whole response — label "Best Bet" made CEE's own
 *     "Your Best Bet: Hire a tech lead." ship clean; so did "advisable",
 *     "best", "choice", "should choose", "is the";
 *   · `Prompts/canonical/draft_graph.txt` instructs the LLM to author node
 *     labels, so graph labels are predominantly MODEL-authored — the masking
 *     handed the model an exemption list it wrote itself, making the
 *     classifier's blind spots model-controllable;
 *   · the `Zq${i}Zq` placeholder scheme collided with a label of that shape and
 *     reintroduced exactly the corruption the change existed to fix.
 *
 * The correct principle — and the one originally instructed — is to classify
 * the FIXED TEMPLATE, never the composed string. Then label content cannot
 * participate in classification BY CONSTRUCTION: no masking, no placeholders,
 * no collision, no exemption list, nothing the model can influence.
 *
 * ── WHAT THIS FILE DOES AND DOES NOT GUARANTEE — read precisely ────────────
 *
 * PROVES: every deterministic receipt template CEE authors is doctrine-clean
 * and forbidden-phrase-clean with its label slots slot-shaped. That is the
 * static half of the principle, and it is the precondition for any future
 * runtime exemption being safe: a runtime rule that trusts these composers is
 * only sound if their templates are clean, and now that is enforced rather
 * than assumed.
 *
 * ⚠⚠ TWO BLOCKS IN THIS FILE PIN BROKEN BEHAVIOUR ON PURPOSE. READ THIS FIRST.
 *
 * Most of this file asserts what the product SHOULD do. Two blocks do the
 * opposite — they assert what it CURRENTLY does, which is wrong, so the wrong
 * behaviour is characterised rather than forgotten:
 *
 *   · `⚠ KNOWN OPEN DEFECT — CLASS A …`   (a committed receipt is destroyed)
 *   · `⚠ KNOWN FALSE POSITIVES — RIDER F1 …` (compliant sentences are refused)
 *
 * NEITHER IS AN ENDORSEMENT. A green run of those two blocks means the defect
 * is still present, not that the behaviour is correct. When either is fixed the
 * block goes RED, and that RED is the signal to delete the pin and record the
 * fix — it is not a regression.
 *
 * WHERE THE OPEN WORK IS TRACKED. Class A is rowed by the orchestrator off the
 * #780 review as a DEPLOYED defect that remains open, with the carrier design
 * (composer → handler outcome → turn-executor finaliser →
 * `commit.ts:durablePublicAssistantText`) as the fix plan. The row was opened
 * after this file was written, so it is deliberately NOT cited by number here —
 * a fabricated number is worse than none. The durable, checkable anchors are:
 *   · `PHASE0-EVIDENCE-2026-07-28/fix-2229-coach-routing.md` — Part 2 (the
 *     original reproduction) and Part 3 (the review, the revert, and the ruling
 *     that Class A stays open);
 *   · PR #780 body — the measured before/after for every shape;
 *   · `PHASE0-EVIDENCE-2026-07-28/codex-audit-a-2026-08-02.md` finding 2 — the
 *     independent audit that found it.
 * Grep `CLASS A` in ROADMAP.md for the row once it lands.
 *
 * DOES NOT PROVE: that a composed receipt survives the runtime egress guard.
 * It does not — the Class A defect is STILL LIVE at this tip and is reproduced
 * below rather than hidden. Fixing it needs the guard to receive the template
 * at the point of classification, which needs a carrier from the composer
 * through the handler outcome to the finaliser and to `commit.ts`. That plumbing
 * is NOT in this PR. Stating the boundary here rather than in a commit message
 * because this file is where someone will come looking.
 */

import { describe, expect, it } from 'vitest';

import {
  applyEgressForbiddenPhraseGuard,
  findForbiddenPhraseHit,
} from '../forbidden-user-facing-phrases.js';
import * as receipts from '../../tools/handlers/d1-shared/format-confirmation.js';

// ---------------------------------------------------------------------------
// Template derivation.
//
// Each template is DERIVED by invoking the real formatter with a sentinel in
// every user-controlled (label) position, then replacing the sentinel with a
// slot marker. So the skeleton is the formatter's ACTUAL literal structure, not
// a transcription of it: reword a receipt and the template here changes with
// it. Numbers are left concrete — a number cannot form a doctrine frame, and
// the point of the exercise is to hold CEE's own WORDS to the doctrine.
// ---------------------------------------------------------------------------

const SLOT = 'ZZSLOTZZ';
const SLOT2 = 'ZZSLOTTWOZZ';

function slotShape(text: string): string {
  return text.split(SLOT2).join('{label}').split(SLOT).join('{label}');
}

/**
 * The receipt formatters, each invoked with slot sentinels.
 *
 * ⚠ HAND-WRITTEN, AND THEREFORE GUARDED. This is a mirror of the module's
 * exports, so it will drift the moment someone adds a formatter — the drift
 * test below DERIVES the export list and fails loudly rather than letting a new
 * receipt ship unclassified (CLAUDE.md trap 12: where you cannot derive, the
 * mirror must fail loud, never assume-good).
 */
const TEMPLATE_PRODUCERS: Readonly<Record<string, () => string>> = {
  formatFactorChange: () =>
    receipts.formatFactorChange({
      label: SLOT,
      before: { raw_value: 1 },
      after: { raw_value: 2 },
    }),
  formatFactorValueSet: () =>
    receipts.formatFactorValueSet({ label: SLOT, after: { raw_value: 2 } }),
  formatFactorValueUnchanged: () =>
    receipts.formatFactorValueUnchanged({ label: SLOT, after: { raw_value: 2 } }),
  formatConstraintAdded: () =>
    receipts.formatConstraintAdded({ targetLabel: SLOT, operator: '>=', value: 2 }),
  formatConstraintUpdated: () =>
    receipts.formatConstraintUpdated({ targetLabel: SLOT, operator: '<=', value: 2 }),
  formatConstraintUnchanged: () =>
    receipts.formatConstraintUnchanged({ targetLabel: SLOT, operator: '>=', value: 2 }),
  formatConstraintLabelUpdated: () =>
    receipts.formatConstraintLabelUpdated({ targetLabel: SLOT, operator: '>=', value: 2 }),
  formatBaselineNoted: () =>
    receipts.formatBaselineNoted({ targetLabel: SLOT, value: 12, unit: '%' }),
  // ROADMAP 2.918 — the baseline elicitation question (the mint receipt's
  // interrogative dual, appended on the mintable-and-baseline-less cell).
  formatBaselineElicitation: () => receipts.formatBaselineElicitation({ targetLabel: SLOT }),
  formatGoalTargetSet: () => receipts.formatGoalTargetSet({ goalLabel: SLOT, value: 2 }),
  formatGoalTargetUnchanged: () =>
    receipts.formatGoalTargetUnchanged({ goalLabel: SLOT, value: 2 }),
  formatEdgeAdjustment: () =>
    receipts.formatEdgeAdjustment({
      fromLabel: SLOT,
      toLabel: SLOT2,
      beforeMean: 0.3,
      afterMean: 0.8,
    }),
  formatEdgeStrengthUnchanged: () =>
    receipts.formatEdgeStrengthUnchanged({ fromLabel: SLOT, toLabel: SLOT2, mean: 0.5 }),
};

/** Exported helpers that are NOT user-facing receipts, with the reason. */
const NON_RECEIPT_EXPORTS: Readonly<Record<string, string>> = {
  formatValueWithUnit:
    'a number+unit renderer used BY the receipt formatters; it emits no CEE prose of its own',
};

describe('every deterministic receipt TEMPLATE is doctrine-clean', () => {
  for (const [name, produce] of Object.entries(TEMPLATE_PRODUCERS)) {
    it(`${name}`, () => {
      const template = slotShape(produce());

      // Anti-vacuity: if the sentinel never appeared, the "template" is just a
      // literal string and the slot-shaping proved nothing.
      expect(template, `${name}: no slot marker — sentinel substitution failed`).toContain(
        '{label}',
      );
      // And the sentinel must be GONE, or a doctrine frame could hide behind it.
      expect(template).not.toContain(SLOT);

      expect(
        findForbiddenPhraseHit(template),
        `${name} composes user-facing copy that trips the forbidden-phrase guard: ` +
          JSON.stringify(template),
      ).toBeNull();
      expect(applyEgressForbiddenPhraseGuard(template).remedy).toBe('none');
    });
  }

  it('DRIFT GUARD: every exported formatter is classified or documented as a non-receipt', () => {
    const exported = Object.entries(receipts)
      .filter(([name, value]) => typeof value === 'function' && name.startsWith('format'))
      .map(([name]) => name)
      .sort();

    // Anti-vacuity — a broken import would make the filter empty and every
    // assertion below pass by finding nothing.
    expect(exported.length, 'no formatters found — the import is broken').toBeGreaterThan(5);

    const accounted = new Set([
      ...Object.keys(TEMPLATE_PRODUCERS),
      ...Object.keys(NON_RECEIPT_EXPORTS),
    ]);
    const unaccounted = exported.filter((n) => !accounted.has(n));
    expect(
      unaccounted,
      'A receipt formatter was added without a template classification. Add it to ' +
        'TEMPLATE_PRODUCERS (with slot sentinels in every label position), or to ' +
        'NON_RECEIPT_EXPORTS with the reason it emits no user-facing prose.',
    ).toEqual([]);

    // The other direction: a producer for a formatter that no longer exists is
    // a stale mirror entry, and would silently reduce coverage.
    const stale = [...accounted].filter((n) => !exported.includes(n));
    expect(stale, 'stale entries naming formatters that no longer exist').toEqual([]);
  });

  it('POSITIVE CONTROL: this check can FAIL — a dirty template is detected', () => {
    // Rule 13. Without this, "all templates clean" could be true because the
    // classifier stopped working, not because the templates are clean.
    expect(findForbiddenPhraseHit('Updated {label}: this is the best choice.')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// REGRESSION PINS for the three defects the reverted approach INTRODUCED.
//
// These are not hypotheticals — every string here was measured returning the
// WRONG answer at the reverted head. They are pinned so the approach cannot be
// reintroduced without going red.
// ---------------------------------------------------------------------------

describe('REVERTED APPROACH — B1: an intra-sentence negator must NOT excuse a later crowning', () => {
  // The reverted change bounded its negation scope with /[.!?;\n]|—|--/ — no
  // comma, no colon, no coordinator. So any negator earlier in the SENTENCE
  // excused every doctrine hit after it. Hedge-then-crown is the most common
  // LLM shape, which made this the live path, not an edge case. All nine
  // measured returning `null` at the reverted head; all nine are fatal here.
  const HEDGE_THEN_CROWN = [
    'Option A is not cheap, but Option A is the clear best choice.',
    'Not only is Option A cheap, Option A is the clear best choice.',
    'Cost is not the issue: Option A is the clear best choice.',
    'Although Option A is not cheap, Option A is the clear best choice.',
    'It is not untrue that Option A is the clear best choice.',
    'Option A is never expensive and Option A is your best bet.',
    'While it is not risky, Option A is the way to go.',
    'Nobody said it was not close, yet Option A is advisable.',
    'This is not a close call, so you should choose Option A.',
  ];
  for (const text of HEDGE_THEN_CROWN) {
    it(`still fatal: ${text}`, () => {
      expect(findForbiddenPhraseHit(text)).not.toBeNull();
    });
  }
});

describe('REVERTED APPROACH — B2: a label FRAGMENT must NOT disable a frame', () => {
  // Under the reverted masking, a graph label that was merely a SUBSTRING of a
  // banned frame removed that frame from the whole response. Each pair below
  // measured `remedy: 'none'` at the reverted head. There is no graph input to
  // this API any more, which is the point — the shapes are pinned so a future
  // "just mask the labels" attempt has to explain itself.
  const CEE_AUTHORED_DIRECTIVES = [
    'Your Best Bet: Hire a tech lead.',
    'Increase price to £59 is advisable at this time.',
    'Increase price to £59 is the clear best choice.',
    'You should choose Option A.',
    'Option A is the optimal route for this goal.',
  ];
  for (const text of CEE_AUTHORED_DIRECTIVES) {
    it(`still fatal regardless of any label content: ${text}`, () => {
      expect(applyEgressForbiddenPhraseGuard(text).remedy).toBe('fallback_replacement');
    });
  }
});

describe('REVERTED APPROACH — B3: no placeholder scheme, so no placeholder collision', () => {
  it('a label-shaped token is not special to the guard', () => {
    // The reverted scheme replaced spans with `Zq${i}Zq` and restored them in
    // index order, so a label literally named "Zq0Zq" corrupted the receipt it
    // was meant to protect — durably, via commit.ts. Measured output at the
    // reverted head, for a graph carrying labels ["Recommended Spend","Zq0Zq"]:
    //   in : "Updated Recommended Spend from 1 to 2. The recommendation stands."
    //   out: "Updated Zq0Zq from 1 to 2. The leading option stands."
    //
    // ⚠ PRECISION, because the reviewer's one-line repro needed one more
    // ingredient than stated: the corruption only surfaces when the guard takes
    // a REWRITE branch, since the clean branch returns the ORIGINAL string. The
    // shorter case ("Updated Recommended Spend from 1 to 2." alone) returned
    // `remedy: 'none'` and was NOT corrupted. The defect is real; its minimal
    // trigger is a second forbidden term in the CEE-authored part.
    const text = 'Updated Zq0Zq from 1 to 2.';
    expect(applyEgressForbiddenPhraseGuard(text).remedy).toBe('none');
    expect(applyEgressForbiddenPhraseGuard(text).text).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// CLASS A — STILL LIVE. Reproduced, not hidden.
// ---------------------------------------------------------------------------

describe('⚠ KNOWN OPEN DEFECT — CLASS A: a committed receipt is destroyed by its own label (characterisation, NOT desired behaviour)', () => {
  // ⚠ EVERY ASSERTION IN THIS BLOCK PINS BEHAVIOUR THAT IS WRONG. It is a
  // CHARACTERISATION of an open defect, never an approval of it. The write has
  // already been committed by the time the guard fires, so the user's change is
  // real and the product denies it — that is the bug, and these tests describe
  // its exact shape so a future fix can be checked against it.
  //
  // A GREEN RUN HERE MEANS THE DEFECT IS STILL PRESENT. When it is fixed this
  // block goes RED; that RED is the expected signal to DELETE these pins and
  // record the fix. It is not a regression and must not be "repaired" by
  // loosening an assertion.
  //
  // Tracked as an open, DEPLOYED defect (rowed by the orchestrator off the #780
  // review). Anchors, since the row number postdates this file: see the file
  // header — `PHASE0-EVIDENCE-2026-07-28/fix-2229-coach-routing.md` Parts 2-3,
  // PR #780, and codex-audit-a-2026-08-02.md finding 2.
  //
  // Correct fix (rowed, NOT in this PR): give the egress guard the TEMPLATE at
  // the point of classification — a carrier from the composer through the
  // handler outcome to the turn-executor finaliser and to
  // `commit.ts:durablePublicAssistantText`. The static half of that fix — the
  // guarantee that those templates are clean — is the first describe block in
  // this file.
  const DESTROYED_BY_THEIR_OWN_LABEL = [
    'Advisable',
    'The Way To Go',
    'Your Best Bet',
    'I Should Choose',
  ];
  for (const label of DESTROYED_BY_THEIR_OWN_LABEL) {
    it(`KNOWN OPEN DEFECT (characterisation, not desired behaviour): a factor named "${label}" still loses its receipt`, () => {
      const receipt = receipts.formatFactorChange({
        label,
        before: { raw_value: 1 },
        after: { raw_value: 2 },
      });
      expect(
        applyEgressForbiddenPhraseGuard(receipt).remedy,
        'PINNING A DEFECT, NOT APPROVING IT: the user committed this change and ' +
          'is shown the neutral fallback instead of their receipt. If this line ' +
          'goes RED the defect is FIXED — delete the pin, do not loosen it.',
      ).toBe('fallback_replacement');
    });
  }

  it('KNOWN OPEN DEFECT (characterisation, not desired behaviour): a factor named "Recommended Spend" is still silently RENAMED on the wire', () => {
    const receipt = receipts.formatFactorChange({
      label: 'Recommended Spend',
      before: { raw_value: 1 },
      after: { raw_value: 2 },
    });
    const guarded = applyEgressForbiddenPhraseGuard(receipt);
    // ⚠ Worse than erasure, and pinned for exactly that reason: this ships as a
    // CORRECT-LOOKING receipt for a factor that does not exist. Characterised,
    // not endorsed. RED here means fixed — delete the pin.
    expect(guarded.remedy).toBe('terminology_rewrite');
    expect(guarded.text).toBe('Updated Suggested Spend from 1 to 2.');
  });
});

// ---------------------------------------------------------------------------
// RIDER F1 — the five review sentences, ALL as documented known false
// positives, each with its LIVE CONSEQUENCE stated at the pin.
// ---------------------------------------------------------------------------

describe('⚠ KNOWN FALSE POSITIVES — RIDER F1: compliant sentences the guard refuses (characterisation, NOT desired behaviour)', () => {
  // ⚠ EVERY ASSERTION IN THIS BLOCK PINS BEHAVIOUR THAT IS WRONG — five
  // doctrine-COMPLIANT sentences that the guard refuses. Characterisation of an
  // accepted cost, never an endorsement. A green run means the product still
  // cannot say them. If a future change makes one sayable, THAT LINE GOES RED
  // and the correct response is to delete the pin, not to restore the refusal.
  //
  // ⚠ ZERO of the five are narrowed, and that is a deliberate reversal of the
  // earlier attempt in this PR, which narrowed four of them with lookarounds.
  //
  // THE RULING, and the reason: on a founder-BINDING doctrine the failure modes
  // are NOT symmetric. A false NEGATIVE ships a crowning — the product breaks
  // its promise, silently, and nobody sees it. A false POSITIVE replaces one
  // response with the neutral fallback — visible, recoverable, and the user can
  // ask again. A regex will keep leaking clause structure; review found nine
  // shapes in the negation attempt alone and there will be more. So the
  // patterns stand unchanged and the cost is recorded here instead.
  //
  // LIVE CONSEQUENCE OF EACH PIN BELOW: the user loses the WHOLE response. The
  // egress remedy for this class is whole-response replacement with
  // "Let me know what you'd like me to do next" — not a redaction of the
  // offending sentence. A coaching turn that says any of these is erased.
  const REFUSED_BUT_COMPLIANT: ReadonlyArray<readonly [string, string]> = [
    [
      'No single option is the best choice here — the analysis has not run yet.',
      'SUBJECT negation. The pattern-1 lookahead reads only the token directly ' +
        'after the copula, so it never sees "No single option".',
    ],
    [
      'Neither option is clearly the better choice on this evidence.',
      'subject negation with an adverb between copula and superlative',
    ],
    [
      'Which option is the best choice depends on your risk tolerance.',
      'nominal-subject frame: the clause is the SUBJECT of "depends", asserting ' +
        'nothing and deferring to the user',
    ],
    [
      'List the criteria you should pick before comparing options.',
      'objectless choice verb: the object of "pick" is the fronted "the criteria", ' +
        'so it directs a process, not a choice',
    ],
    [
      'Running a sensitivity analysis first gives you the best chance of catching a hidden dependency.',
      'METHOD coaching, explicitly permitted (manifest §3.2c). The only ' +
        'distinguishing feature from the real violation "Increase price to £59 ' +
        'gives you the best chance of £20k MRR" is whether the SUBJECT is a ' +
        'method or an option — invisible to a regex. Every candidate narrowing ' +
        'false-NEGATIVED on "Choosing Option A gives you the best chance of £20k ' +
        'MRR", a real directive.',
    ],
  ];

  for (const [text, why] of REFUSED_BUT_COMPLIANT) {
    it(`KNOWN FALSE POSITIVE (characterisation, not desired behaviour) — the user loses the whole response: ${text}`, () => {
      expect(
        findForbiddenPhraseHit(text),
        `PINNING AN ACCEPTED COST, NOT APPROVING IT. This sentence is compliant: ${why} ` +
          'RED here means the guard learned to allow it — delete the pin.',
      ).not.toBeNull();
      expect(applyEgressForbiddenPhraseGuard(text).remedy).toBe('fallback_replacement');
    });
  }

  it('the honest fix needs a non-regex signal, and one now exists in the estate', () => {
    // Not an assertion about the guard — a note anchored where the next person
    // will read it. Four of the five turn on the SUBJECT of the clause (option
    // vs method vs interrogative), which a lexical pattern cannot see. The
    // routing/validation layer already resolves option and goal labels for a
    // turn, so a clause-level subject classifier has a real signal available to
    // it rather than needing NLP from scratch. Rowed; not attempted here.
    expect(REFUSED_BUT_COMPLIANT.length).toBe(5);
  });
});
