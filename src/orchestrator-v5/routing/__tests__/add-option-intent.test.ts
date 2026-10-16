/**
 * add_option TEXT recogniser — the routing corpus.
 *
 * WHAT THIS PINS. `detectAddOptionIntent` decides whether a turn leaves the
 * generic `edit_graph` lane for the focused add-option path. Both directions
 * matter and they are NOT the same risk:
 *   · a MISS costs nothing — the message takes today's edit lane unchanged;
 *   · a FALSE MATCH takes a turn away from a lane that handles it correctly.
 * So the positive corpus proves the capability is reachable by ordinary
 * phrasings, and the negative corpus — which is the load-bearing half — proves
 * every neighbouring intent keeps its existing owner.
 *
 * ⚠ THE CORPUS IS NOT DRAWN FROM THE AUTHOR'S HEAD ALONE (trap 22). The
 * positives include the two sentences the PRODUCT itself emits, imported from
 * their producers rather than re-typed, so chip copy and route cannot drift
 * apart: CEE's widening card (`draft-option-widening-blocks.ts`) and the
 * clarify chip this module builds. The negatives are taken from the phrasings
 * the sibling detectors and the value-update gate already own.
 */
import { describe,expect,it } from 'vitest';



/** The exact `action_prompt` CEE's widening card sends as free text. */






/**
 * ⭐⭐ THE TARGET/LABEL BOUNDARY (independent review of PR #1319, 2 Sep 2026).
 *
 * REPRODUCED before it was fixed: `Add an option to the model` was CLAIMED with
 * label `"Model"`, and `Add an option for the pricing decision` with label
 * `"Pricing decision"` — the product proposing an option named after the thing
 * it was being added to, and in the second case after its own parent decision.
 *
 * ⚠ WHY MY EXISTING GUARDS COULD NOT SEE IT, because that is the transferable
 * part: the id-echo rule holds perfectly here. Every id resolved and echoed its
 * entity's exact label. The WRONG ENTITY was selected, and then labelled
 * correctly — so a guard binding label to id is pointed at the wrong bytes by
 * construction. The fix had to be a different question, asked in two places:
 * "is this a target rather than a name?" (the recogniser, graph-blind) and
 * "is this name already something else on this model?" (the validator,
 * graph-aware).
 *
 * ⭐ EVERY CASE HAS ITS OPPOSITE-DIRECTION TWIN, and the two harms are NOT
 * symmetric: dropping a legitimate add is a GAP (the generic lane still serves
 * the user), minting an option the user never named is a LIE. They must never
 * share one threshold, so the pairs below are asserted together — if a future
 * widening reopens the lie, the left column REDs; if it over-corrects into a
 * gap, the right column REDs.
 */




// ---------------------------------------------------------------------------
// ⭐⭐ THE CLOSED CLASS — the corpus that closes against an ENUMERATION.
//
// WHY THIS EXISTS AND THE PAIRS ABOVE DO NOT REPLACE IT. The first version
// of the target/label screen hand-listed the twelve determiners reproduction
// had turned up, and the pairs above pinned exactly those. English determiners
// are a CLOSED CLASS of ~45, so the class survived one word shorter: measured
// over the corpus below at that commit, 117 of 196 probes still minted the
// user's own container as an option name, and 10 of 10 legitimate verb
// phrasings were dropped in the other direction.
//
// So this corpus is generated from the alphabets rather than typed out, and it
// is written in MATCHED DIRECTIONS throughout: a widening REDs the LIE column,
// an over-correction REDs the GAP column. Neither column alone is evidence.
// ---------------------------------------------------------------------------



















// ---------------------------------------------------------------------------
// ⭐⭐ THE DISCRIMINATORS A MUTANT KIT FORCED, AND WHY THEY ARE NOT
// REDUNDANT WITH THE CASES ABOVE.
//
// Three mutations SURVIVED the first kit against this file: dropping
// `explicitlyNamed` entirely, replacing the `as an option` conjunction with the
// container test alone, and DELETING A NOUN from `CONTAINER_NOUNS`. None was an
// equivalent mutant — each was a real hole:
//   · no explicitly-named case in the corpus mentioned a container, so the
//     screen could be widened to every trigger and nothing noticed;
//   · no verb phrase in the corpus mentioned a container, so `isTargetReference`
//     could be dropped from that branch and nothing noticed;
//   · the container control is GENERATED FROM the alphabet it certifies, so it
//     shrank with the list and stayed green — a derived guard proving the copies
//     agree and never that the list is right.
// A survivor is a claim either way and has to be demonstrated. These are the
// demonstrations.
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// ⭐ THE COORDINATED-INSTRUCTION SCREEN — both columns, measured independently.
// Proposed by an independent reviewer after this PR reverted an edit-verb-only
// screen that collided with "set up a joint venture". This one requires the
// CONJUNCTION BEFORE the verb and excludes `set` and `add`.
// ---------------------------------------------------------------------------
describe('a coordinated second instruction is a DROPPED INSTRUCTION, not a name', () => {




  it('⭐ IMMUNE to the historical ", and" class this estate ruled unwinnable', () => {
    // Four rounds oscillated on a coordination-boundary predicate over ", and".
    // This screen only fires when an EDIT VERB follows the conjunction, so the
    // constraint sentences from that work cannot reach it. Claimed immunity is
    // still a claim — this is the measurement.
    for (const s of [
      'Do not, and this is firm, let gross margin drop below 78%',
      'Do not, under any circumstances, let gross margin drop below 78%',
      'Keep churn under 5%, and margin above 40%',
      'We must not, and I mean this, drop below 78% margin',
      'Hold price, and do not discount',
    ]) {
      expect(
        /\b(?:,\s*)?(?:and|then|and then)\s+(?:remove|delete|drop|rename|replace|update|change|increase|decrease|raise|lower|configure|split|merge|reset|edit|adjust)\b/i.test(s),
        `the screen must not fire on "${s}"`,
      ).toBe(false);
    }
  });




});

// ---------------------------------------------------------------------------
// ⭐ PUNCTUATION IS A SEPARATOR, NOT A NAMING WORD.
// `explicitlyNamed` switches the entire target screen off, so the naming
// alternation is a PERMISSION LIST — and `:` `-` `–` `—` were in it.
// ---------------------------------------------------------------------------






// ---------------------------------------------------------------------------
// ⭐⭐ EVERY ALPHABET CARRIES A HAND-WRITTEN PIN — closing the CLASS, not the
// two instances that were found.
//
// `CONTAINER_NOUNS` and `NAMING_WORDS` were pinned by hand after a mutant proved
// a generated control cannot see its own list shrink: the corpus is built FROM
// the alphabet, so deleting an entry deletes its own test case and the suite
// stays green — the test COUNT dropping by one was the only tell.
//
// The determiner alphabets had exactly the same hole and were left open, which
// is the instance-vs-class error this PR kept demonstrating.
//
// ⚠ AND A SENTENCE COUNTING THE ALPHABETS WAS WRONG WHILE THE PINS BESIDE IT
// WERE RIGHT — twice, in two files, both times understating them. The one it
// missed is `OPTION_NOUN_DETERMINERS`, which BUILDS the recogniser regex and
// was already hand-pinned: `DETERMINER_FRAGMENT` is asserted byte-for-byte
// against the historical literal, with a positive control proving a reorder
// breaks it.
//
// ⭐⭐ THE RULE THAT CAME OUT OF IT, stated exactly, because it has two halves
// and getting either wrong costs a round:
//
//   · DELETE a number that RESTATES A LIST THE READER CAN SEE. It is a
//     hand-maintained mirror with a sample size of one — no test sees it, no
//     reader recounts it. It went wrong four times in this PR: twice by drift,
//     and twice BORN WRONG at authoring ("EIGHT of these are also verbs" beside
//     a parenthetical listing ten; "these three" above a four-entry array —
//     neither ever true at any commit).
//
//   · KEEP a number that COUNTS A CLOSED SET DECLARED ELSEWHERE. The reader
//     cannot recover it from the line, so it carries information. "all five
//     triggers" is this, and a sweep deleted it as though it were a mirror —
//     severing a sentence in the process. THEN PIN IT: see
//     `ALL_ADD_OPTION_TRIGGERS`, whose exhaustiveness the compiler enforces.
//
//   · KEEP dated measurements ("10 of 10 probes lost", "left all 353 green")
//     and quotations. They record what happened and cannot drift; rewriting
//     them would falsify the record.
//
// ⚠ AND THE HONEST SCOPE OF THIS SWEEP, because a claim to have closed a class
// is exactly the kind of sentence that tells the next reader to stop looking.
// It was applied ONCE, to these two files, over the QUANTIFIER forms ("the ten
// pairs", "EIGHT of these", "four punctuation marks") and the DEMONSTRATIVE
// forms ("these three", "all three of these"), each swept with a contrast
// control so an empty result meant something. PROSE IS WRITTEN CONTINUOUSLY, so
// this is a rule applied at a point in time, NOT a permanently closed class —
// the same standing the sampled floor has. The next comment written can
// reintroduce it, and nothing here will notice.
//
// ⭐⭐ AND THE SAME RULE FOR MUTANT CLAIMS, which is the sharper case.
//
// A sentence saying "drop X and these N RED" asserts a DISCRIMINATION — its
// whole job is to state what the suite can detect — so a wrong one claims a
// sensitivity the tests do not have, and a reader checking whether the kit is
// honest reads exactly that line and stops. It is the one comment class where
// being wrong attacks the evidence itself.
//
// All four per-case claims in these two files were re-run against their own
// mutation on 3 Sep 2026 (forms swept: "drop|delete|remove|loosen|unanchor …
// RED", with a contrast control firing on a planted line). THREE were true;
// ONE was wrong — "drop `explicitlyNamed` and these three RED" listed a row
// that cannot RED under that mutation at all. Found by the release-integration
// seat, not by this suite.
//
// Where the claim can be bound to an assertion it now is; where it cannot, it
// says what was measured and when. Same standing as everything else here: a
// rule applied once, not a class that stays closed.
//
// THE LIST IS THE RECORD. The assertions below name every alphabet
// individually, so they cannot disagree with a sentence that states no total.
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// ⭐⭐ A NAMING WORD DOES NOT MAKE A TARGET REFERENCE A NAME.
//
// `explicitlyNamed` switched the target screen OFF for unquoted `called`
// labels, and that exemption was defended by a comment which measurement
// refuted. `Add an option called the model` is a user POINTING AT the model,
// not christening an option — the flagship defect of this PR, one trigger over.
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// ⭐⭐ THE REMAINDER SCREENS ARE INERT ON BOTH INFERRING ARMS.
// An inferred label runs to the first `.!;`, so a trailing tail lands INSIDE
// the label and `screenRemainder` receives "". Every compound/value test in
// this file was written against the QUOTED arm — the one place the remainder is
// real. A guard tested only where it works is not tested.
// ---------------------------------------------------------------------------
