/**
 * Clarify v2 — MEASURED STRINGS THAT MORE THAN ONE SPEC DEPENDS ON.
 *
 * These are RECORDS of adjudicated behaviour, not fixtures to keep current:
 * append to them, never edit them (trap 14b — a corpus that pins what the
 * product once did, or what a reviewer once adjudicated, is evidence).
 *
 * ⚠ WHY THIS MODULE EXISTS, and why it is NOT a spec file (#928 round 4).
 * The over-detection sentence was MIRRORED: `clarify-v2.draft-first.test.ts`
 * carried its own copy of the bytes that `clarify-v2.rubric-fail-closed.test.ts`
 * records, with nothing tying the two together — the hand-maintained mirror
 * (trap 12) sitting inside the fixture that proves the honesty property.
 *
 * The obvious repair — have one spec import the other — was MEASURED AND
 * REJECTED: importing a `.test.ts` module EXECUTES its `describe` blocks in the
 * importing file too, so the fail-closed suite ran TWICE (draft-first collected
 * 42 → 109, and the required gate's total rose by exactly 67). Duplicate
 * execution makes per-spec collected counts lie, which is the #636 discipline's
 * whole subject. A shared NON-SPEC module gives the same single source of truth
 * with no execution side effect. Its filename deliberately does not match the
 * test glob.
 */

/**
 * ⭐ THE MEASURED OVER-DETECTION SENTENCE.
 *
 * A human-adjudicated fact about English, from the round-3 reviewer's
 * outside-authored corpus: **this sentence STATES a goal**, while the rubric
 * scores goal MISSING. That PAIRING is what makes it an over-detection, and
 * both halves must be asserted wherever it is used as a discriminating
 * fixture — asserting only that the rubric says MISSING lets the fixture decay
 * into an ordinary missing-goal brief with nothing going red (trap 13b;
 * measured by the round-4 reviewer's `ROT-B` mutant, which left the suite fully
 * green until the missing half was added).
 */
export const MEASURED_OVER_DETECTION_GOAL_SENTENCE = 'Our goal is not just cost but speed.';
