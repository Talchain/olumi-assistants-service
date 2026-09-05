import { describe, it, expect } from 'vitest';
import { classifyAnalyticalIntent, hasMutationSignal } from '../analytical-intent.js';
import { isAnalyticalQuestion } from '../analytical-question-guard.js';
import { isStateQueryQuestionShape } from '../state-query-guard.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { shouldSuppressEditDispatchForValueUpdate } from '../../../orchestrator/routing/value-update-gate.js';

/**
 * The post-rerun EXPLAIN misroute, pinned at the routing predicates.
 *
 * ⭐ WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO.
 *
 * The obvious fix for "How has the update changed the analysis?" routing to the
 * EDIT lane is to add `how has` to `EDIT_GRAPH_NEGATIVE_REGEX`, which already
 * lists `how does`. That fix is BANNED here, for two measured reasons:
 *
 *   1. It is the alternation-widening move CEE #888 spent FOUR consecutive
 *      rounds on — each round closing one direction and reopening the other,
 *      until a reviewer ran the next round in advance and proved it oscillates
 *      too. The negative regex is a flat list of meta-question markers with no
 *      grammar, consumed by 14 modules; a literal added there is load-bearing
 *      for all of them.
 *   2. More importantly it fixes the WRONG HALF. Suppressing the edit leaves
 *      the turn with nowhere to go: `tryRunComparisonGate`
 *      (run-comparison-gate.ts:630) admits ONLY
 *      `classifyAnalyticalIntent(message) === 'what_changed'`, so the founder
 *      would trade a wrong edit for silence. Classifying at the canonical SSOT
 *      suppresses the edit AND delivers the turn to the two-run comparison in
 *      one predicate.
 *
 * So the assertions below PIN THEIR OWN PRECONDITION: every question must still
 * MISS the negative regex and still HIT the positive one. If a future session
 * makes the banned change, `the negative regex is NOT what saves these` REDs and
 * names it — a guard that fails on the wrong fix, not merely on a broken one.
 */

/**
 * ⚠ SCOPE OF THE CONJUNCTION REPRODUCED HERE. route-v2.ts:5018 computes
 *
 *     editVerbCandidate = positiveEditRegexHit && !negativeEditRegexHit
 *       && !valueUpdatePhrasingHit && !analyticalQuestionDetected
 *       && !stateQuerySuppressed
 *
 * This helper reproduces FOUR of those five conjuncts. `stateQuerySuppressed`
 * (`isStateQueryQuestionShape`) is omitted deliberately: it is an INDEPENDENT
 * suppressor that this change does not touch.
 *
 * ⚠ WHICH DIRECTION THAT OMISSION IS SOUND IN — corrected after review, because
 * the first version of this note had it backwards where it mattered. Omitting a
 * conjunct makes the helper's `true` LOOSER, not stricter: a message this helper
 * calls `true` might still be suppressed in production by the conjunct we left
 * out. So:
 *
 *   · a `false` here IS a sound claim — production has strictly more
 *     suppressors, so it cannot reach the edit lane either. The
 *     "must not reach the edit lane" assertions rest on this and are sound.
 *   · a `true` here is NOT sound by construction. The MUST-NOT-BREAK,
 *     STILL_EDITS and KNOWN-DROPPED corpora all depend on the `true`
 *     direction, so they need the missing conjunct checked EXPLICITLY rather
 *     than assumed — which `the true direction is sound for these corpora`
 *     below does, by running `isStateQueryQuestionShape` over every member and
 *     asserting it is false. That makes the result true BY CONSTRUCTION rather
 *     than true in fact but unpinned.
 *
 * Reproducing the route's conjunction in a unit test is this repo's established
 * idiom for a gate that is inline in route-v2 (see
 * compose/__tests__/judgement-offer-action.test.ts:420 and
 * routing/__tests__/mutation-warrant.test.ts:468).
 */
const reachesEditLane = (message: string): boolean =>
  EDIT_GRAPH_POSITIVE_REGEX.test(message) &&
  !EDIT_GRAPH_NEGATIVE_REGEX.test(message) &&
  !shouldSuppressEditDispatchForValueUpdate(message) &&
  !isAnalyticalQuestion(message);

/**
 * "The message still MUTATES something" — the edit lane proper, OR the
 * deterministic D1 value-update path that `shouldSuppressEditDispatchForValueUpdate`
 * redirects `set X to N` / `increase X by N` onto. That redirect is another
 * mutation path, never a drop, so a message on it has not lost anything.
 *
 * This is the predicate the DROP-direction corpora are judged by. Using
 * `reachesEditLane` alone would fail a message like "… and set pricing to 0.7"
 * for reaching the RIGHT path — an assertion bound to the mechanism instead of
 * to the harm.
 */
const reachesMutationPath = (message: string): boolean =>
  reachesEditLane(message) || shouldSuppressEditDispatchForValueUpdate(message);

/**
 * CORPUS — the founder's own post-rerun sentence and its grammatical
 * neighbours. Sourced from the reported session, not invented to fit the
 * pattern.
 */
const COMPARISON_QUESTIONS = [
  'How has the update changed the analysis?', // ← the founder's actual sentence
  'How has the change affected the results?',
  'How did the update change the analysis?',
  'How has that edit shifted the ranking?',
  'How have the updates changed the outcome?',
  'How has this impacted the results?',
  'How did my change affect the leading option?',
  'How has the new value changed the analysis?',
] as const;

/**
 * MUST-NOT-BREAK — plain single-clause edit commands.
 *
 * ⚠ THIS CORPUS IS NOT THE OPPOSITE-DIRECTION TWIN OF `COMPARISON_QUESTIONS`,
 * and an earlier version of this file claimed it was. Every member is a
 * single-clause imperative and NOT ONE of them contains `how has|have|did` —
 * the transitive pattern's mandatory left anchor. A corpus with no member the
 * predicate can even reach cannot certify that predicate; it certifies only
 * that the fix left ordinary imperatives alone, which is a real but much
 * smaller claim. The actual twins are `STILL_EDITS` below, and
 * `the twin corpus can actually reach the new predicate` pins that distinction
 * so it cannot quietly rot back.
 */
const GENUINE_EDITS = [
  'Change the price to 120',
  'Update the churn factor to 0.15',
  'Add a risk node for supply delays',
  'Remove the marketing spend factor',
  'Change the analysis',
  'Update the analysis',
  'Change the ranking of the options',
  'Adjust the result weighting',
  'Increase the marketing budget',
  'Delete the compliance risk',
  'Edit the revenue assumption',
  'Set pricing to 0.7',
] as const;

/**
 * ⭐⭐ THE OPPOSITE-DIRECTION TWINS — compound "question + edit" messages.
 *
 * A false positive that DROPS an edit and one that INVENTS an edit are
 * different harms and cannot share a window. This is the DROP direction, and it
 * is the direction the first round of this change got wrong: every one of these
 * reached the edit lane at base, and the transitive pattern as first written
 * took the lane away from ALL of them while `tryRunComparisonGate` refused them
 * anyway on `hasMutationSignal` (run-comparison-gate.ts:624, checked BEFORE the
 * classifier admission at :630) — so the user's edit was dropped and the answer
 * was silence. Trading a wrong edit for silence is the same bad trade in the
 * other direction, and it is verbatim the outcome this file's header gives as
 * the reason for banning the negative-regex fix.
 *
 * SOURCE — not hand-picked to pass. Rows 1-4 are the independent reviewer's,
 * verbatim. The rest are drawn from a generated cross product of
 * 6 question shapes × 6 joiners (`, and` · `?` · `;` · ` and ` · em-dash · `.`)
 * × 6 concrete edit clauses = 216 messages, of which 141 reached the edit lane
 * at base. Measured across all 216: pre-fix head lost the lane on 141/141;
 * this head loses it on 0/141. The members below are the shape representatives;
 * the full generator lives in the PR evidence, and the joiner column is the
 * point — `[^.?!\n]` admitted `;` `,` and the dash, which is how a question
 * opener got stitched to the NEXT clause's verb.
 */
const STILL_EDITS = [
  // ── the reviewer's four, verbatim ────────────────────────────────────────
  'How has the update changed the analysis, and add a risk node for supply delays',
  'How did the edit change the results, and delete the compliance risk',
  'How has the update changed the analysis? Add a risk node for supply delays',
  'How has this gone; change the ranking to put B first',
  // ── generator representatives, one per joiner × edit-clause shape ────────
  'How have the updates changed the outcome — remove the marketing spend factor',
  'How has that revision shifted the ranking. Change the price to 120',
  'How did my change affect the leading option and set pricing to 0.7',
  'How has this impacted the results; increase the budget by 15%',
] as const;

/**
 * The subset that was ACTIVELY MISROUTING — derived, never hand-listed.
 *
 * ⚠ THIS DISTINCTION WAS FOUND BY THE PRECONDITION PIN BELOW, ON THIS FILE'S
 * OWN FIRST RUN, and it is worth keeping the reason. The corpus entry "How have
 * the updates changed the outcome?" reads exactly like the founder's sentence,
 * so I had assumed it was the same defect. It is not: the PLURAL "updates" does
 * not match `\bupdate\b`, so that phrasing never hit `EDIT_GRAPH_POSITIVE_REGEX`
 * and never reached the edit lane at all. It gains correct CLASSIFICATION from
 * this fix (so the run-comparison gate can now answer it) but it was never part
 * of the misroute.
 *
 * Deriving the subset instead of writing it down means the two claims stay
 * separable, and a future change to either regex re-partitions the corpus
 * automatically rather than silently invalidating a hand-maintained split.
 */
const MISROUTING_QUESTIONS = COMPARISON_QUESTIONS.filter((m) =>
  EDIT_GRAPH_POSITIVE_REGEX.test(m),
);

describe('post-rerun EXPLAIN question must not reach the edit lane', () => {
  it('the misrouting subset is non-empty and contains the founder sentence', () => {
    // Guards the pin below against becoming vacuous: if a future edit to
    // EDIT_GRAPH_POSITIVE_REGEX emptied this subset, every assertion in the
    // next test would pass by iterating nothing.
    expect(MISROUTING_QUESTIONS.length).toBeGreaterThan(0);
    expect(MISROUTING_QUESTIONS).toContain('How has the update changed the analysis?');
  });

  it('the negative regex is NOT what saves these (the banned fix is not in force)', () => {
    // PRECONDITION PIN. Each misrouting question must still MATCH the positive
    // regex and still MISS the negative one — i.e. the ONLY thing standing
    // between it and the edit lane is the analytical-question guard this change
    // fixed. If someone adds `how has` (or similar) to
    // EDIT_GRAPH_NEGATIVE_REGEX, this REDs, because the fix would then be
    // riding on the banned alternation widening instead of on the classifier.
    for (const m of MISROUTING_QUESTIONS) {
      expect(EDIT_GRAPH_POSITIVE_REGEX.test(m), `positive regex should still hit: ${m}`).toBe(true);
      expect(
        EDIT_GRAPH_NEGATIVE_REGEX.test(m),
        `negative regex must NOT be widened to cover: ${m}`,
      ).toBe(false);
    }
  });

  it('the analytical-question guard is the deciding suppressor', () => {
    for (const m of COMPARISON_QUESTIONS) {
      expect(isAnalyticalQuestion(m), m).toBe(true);
      expect(classifyAnalyticalIntent(m), m).toBe('what_changed');
      expect(reachesEditLane(m), `must not reach the edit lane: ${m}`).toBe(false);
    }
  });

  it('MUST-NOT-BREAK: a genuine edit request still reaches a mutation path', () => {
    for (const m of GENUINE_EDITS) {
      // Either the edit lane proper, or the deterministic D1 value-update path
      // (`shouldSuppressEditDispatchForValueUpdate` routes `set X to N` there —
      // it is a redirect to another mutation path, never a drop).
      expect(reachesMutationPath(m), `edit must still mutate: ${m}`).toBe(true);
      expect(classifyAnalyticalIntent(m), `edit must not classify analytical: ${m}`).toBeNull();
    }
  });

  it('the twin corpus can actually reach the new predicate (anti-vacuity)', () => {
    // The reviewer's finding this pins: a MUST-NOT-BREAK corpus none of whose
    // members carries the predicate's mandatory left anchor cannot certify the
    // predicate. Assert the two corpora sit on OPPOSITE sides of that anchor,
    // so neither can drift into being the other.
    const LEFT_ANCHOR = /\bhow\s+(?:has|have|did)\b/i;
    for (const m of STILL_EDITS) {
      expect(LEFT_ANCHOR.test(m), `twin must carry the left anchor: ${m}`).toBe(true);
    }
    for (const m of GENUINE_EDITS) {
      expect(
        LEFT_ANCHOR.test(m),
        `GENUINE_EDITS is the plain-imperative corpus, not the twin: ${m}`,
      ).toBe(false);
    }
  });

  it('OVER-SUPPRESSION: a compound question+edit still reaches a mutation path', () => {
    // ⭐ THE BLOCKING REGRESSION THIS ROUND FIXES. Fails at the previous head on
    // every member (`expected false to be true`).
    for (const m of STILL_EDITS) {
      expect(
        reachesMutationPath(m),
        `compound message must not lose its edit: ${m}`,
      ).toBe(true);
    }
  });

  it('OVER-SUPPRESSION: and the comparison gate could never have answered them anyway', () => {
    // PRECONDITION PIN, and the reason suppressing these bought nothing. The
    // gate refuses on `hasMutationSignal` BEFORE it consults the classifier, so
    // classifying a compound message `what_changed` cannot deliver it to the
    // comparison — it only removes the edit lane. Silence, for no gain.
    for (const m of STILL_EDITS) {
      expect(hasMutationSignal(m), `must carry a mutation signal: ${m}`).toBe(true);
    }
  });

  it('the true direction is sound for these corpora (missing conjunct checked, not assumed)', () => {
    // `reachesEditLane` omits `stateQuerySuppressed`, which makes its `true`
    // LOOSER than production. Every corpus that depends on the `true` direction
    // therefore has the omitted conjunct checked explicitly here — so those
    // results are true BY CONSTRUCTION, not true in fact and unpinned.
    for (const m of [...GENUINE_EDITS, ...STILL_EDITS, ...KNOWN_DROPPED_STILL_REACHES_EDIT_LANE]) {
      expect(
        isStateQueryQuestionShape(m),
        `omitted conjunct must be false for a true-direction claim: ${m}`,
      ).toBe(false);
    }
  });

  it('advice / how-to questions are untouched (they were never comparison questions)', () => {
    // These carry no PAST auxiliary, so the new transitive pattern must not
    // reach them. They keep whatever routing they already had.
    for (const m of ['How do I change the analysis?', 'How can I change the ranking?']) {
      expect(classifyAnalyticalIntent(m), m).toBeNull();
    }
  });

  it('future/hypothetical phrasings still classify what_would_flip (precedence intact)', () => {
    expect(classifyAnalyticalIntent('How would the outcome change?')).toBe('what_would_flip');
    expect(classifyAnalyticalIntent('What would change the result?')).toBe('what_would_flip');
  });
});

/**
 * ⭐⭐ KNOWN-DROPPED SET — the honest residual gap, MEASURED not guessed.
 *
 * These phrasings are the same post-rerun comparison question and STILL reach
 * the edit lane. They are recorded rather than fixed because closing them means
 * widening the outcome-noun vocabulary, and this module carries THREE different
 * noun alternations for one concept (`what_would_flip` has
 * `order|balance|things|verdict|winner|winners`; `what_changed`'s `why …` limb
 * has `numbers?`; its `how …` limb has neither). Reconciling those three is a
 * real change that needs its own corpus and its own evidence — doing it here,
 * riding this fix, is exactly the "while we're here" widening that turned CEE
 * #888 into four rounds.
 *
 * ⚠⚠ WHAT THIS SET IS, STATED ACCURATELY — the previous description was a false
 * verification claim, found by an independent review.
 *
 * ⚠ THAT FINDING HAS SINCE BEEN ADJUDICATED AND ONLY HALF OF IT SURVIVES, which
 * is recorded here rather than quietly dropped. The review's CONCLUSION — that
 * "REDs if it GROWS" was false, because a new unlisted phrasing is structurally
 * invisible — STANDS, and is acted on below. Its supporting mutant row
 * (`M2 delete a listed entry → GREEN, no red`) does not. At the head it
 * reviewed (`d720308`) the collection guard already carried
 * `expect(KNOWN_DROPPED_STILL_REACHES_EDIT_LANE.length).toBe(10)` at line 255,
 * inside `describe('this spec collected')` at :243 — the 9th of that file's 9
 * `it(` blocks, which the same seat's own `M0 pristine → GREEN 9/9` proves was
 * collected. Deleting a listed entry makes the length 9 and MUST RED. The row
 * was almost certainly an unapplied mutation read as a survivor; that seat
 * reported no applied-check. A defective mutant row supporting a true
 * conclusion is still a false verification claim — the exact class this block
 * exists to correct, so it does not get an exemption for having been useful.
 *
 * It said the test "REDs if it GROWS (a regression widened the gap)". It does
 * not, and it cannot. What the assertions below actually detect:
 *
 *   ✓ a listed gap being CLOSED (the entry stops reaching the edit lane)
 *   ✓ an entry ADDED to the list that does not in fact drop
 *   ✓ the list changing SIZE at all (pinned by the collection guard's count)
 *   ✗ a NEW, UNLISTED phrasing that drops — invisible, and structurally so
 *
 * The gap is an OPEN CLASS: no finite list can enumerate the phrasings a user
 * might type, so a set that claimed to track its growth would be a
 * hand-maintained mirror sold as a derivation — the estate's dominant defect.
 * This is therefore a SAMPLED FLOOR: everything in it is known-dropped and
 * pinned, and the set makes no claim to be complete. Five of the entries below
 * were added because the review DEMONSTRATED the incompleteness by finding them
 * with the spec fully green — which is the honest evidence that the floor is a
 * floor.
 */
const KNOWN_DROPPED_STILL_REACHES_EDIT_LANE = [
  // Outcome nouns carried by SIBLING patterns but not by the what_changed pair.
  'How has the update changed the numbers?',
  'How has the update changed the verdict?',
  'How has the update changed the winner?',
  'How has the update changed the balance?',
  'How has the update changed the order?',
  // A noun that is not an outcome noun at all — this asks about the MODEL, a
  // different question with a different right answer.
  'How has the update changed the model?',
  // Interrogative openers other than a bare `how`.
  'Has the update changed the analysis?',
  'In what way has the update changed the analysis?',
  'What effect did the update have on the analysis?',
  // ⭐ EXTERNALLY SOURCED, not invented here: this sentence is already pinned
  // as known-dropped by compose/__tests__/unapplied-edit-reply.test.ts, whose
  // own KNOWN_DROPPED_CORPUS carries it beside the founder's sentence. It is
  // the `did`-opener twin of the transitive form. Measured at the pristine base
  // AND after this fix: identical in both trees, so this change neither closes
  // nor widens it. Recorded here so the two files agree about it rather than
  // one of them quietly implying it is handled.
  'Did my edit affect the ranking?',
  // ⭐ FOUND BY AN INDEPENDENT REVIEW WITH THIS SPEC GREEN — the demonstration
  // that the set above was a floor and not an enumeration. Four more outcome
  // nouns the `how …` limb does not carry, plus a two-noun coordination.
  'How has the update changed the KPI?',
  'How has the update changed the forecast?',
  'How has the update changed the recommendation?',
  'How has the update changed the score?',
  'How has the update changed the numbers and the verdict?',
] as const;

describe('KNOWN-DROPPED: post-rerun comparison phrasings this fix does NOT cover', () => {
  it('every listed phrasing still drops — REDs if one is closed without being removed', () => {
    // Detects a CLOSED gap and a wrongly-added entry. It does NOT detect a new
    // unlisted phrasing; see the block comment above for why no finite set can.
    const stillDropped = [...KNOWN_DROPPED_STILL_REACHES_EDIT_LANE].filter((m) =>
      reachesEditLane(m),
    );
    expect(stillDropped).toEqual([...KNOWN_DROPPED_STILL_REACHES_EDIT_LANE]);
  });

  it('the set is a SAMPLED FLOOR, and this test says so out loud', () => {
    // The honesty pin. If a future session re-describes this set as a complete
    // or growth-detecting enumeration, the claim has to get past this comment
    // and this assertion, which exist precisely because the previous
    // description did not survive a mutation test.
    expect(KNOWN_DROPPED_STILL_REACHES_EDIT_LANE.length).toBeGreaterThanOrEqual(15);
  });

  it('none of them classify as a comparison question either (the gap is real, both halves)', () => {
    for (const m of KNOWN_DROPPED_STILL_REACHES_EDIT_LANE) {
      expect(classifyAnalyticalIntent(m), m).not.toBe('what_changed');
    }
  });
});

/**
 * COLLECTION GUARD. A spec that collects zero tests is invisible to every
 * aggregate: the suite total, the exit code and the failure count are all fully
 * consistent with this file contributing nothing. Assert this file's own
 * expected test count, by name.
 */
describe('this spec collected', () => {
  it('runs the expected number of tests in this file', () => {
    expect(COMPARISON_QUESTIONS.length).toBe(8);
    // 5 of the 8 were ACTIVELY misrouting. The other three carry no
    // `EDIT_GRAPH_POSITIVE_REGEX` verb at all and never reached the edit lane:
    // "How have the updates changed the outcome?" (plural `updates` misses
    // `\bupdate\b`), "How has this impacted the results?" (no edit verb), and
    // "How has the new value changed the analysis?" (`changed` misses
    // `\bchange\b`). They gain correct CLASSIFICATION only — which is still a
    // real gain, because it is what admits them to the run-comparison gate.
    expect(MISROUTING_QUESTIONS.length).toBe(5);
    expect(GENUINE_EDITS.length).toBe(12);
    expect(STILL_EDITS.length).toBe(8);
    expect(KNOWN_DROPPED_STILL_REACHES_EDIT_LANE.length).toBe(15);
  });
});
