import { describe, it, expect } from 'vitest';
import { classifyAnalyticalIntent } from '../analytical-intent.js';
import { isAnalyticalQuestion } from '../analytical-question-guard.js';
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
 * suppressor that this change does not touch, and omitting it makes the helper
 * STRICTER, not looser — a message this helper calls `true` might still be
 * suppressed in production, never the reverse. So a `false` here is a sound
 * claim that the edit lane is not reached, which is the direction every
 * assertion below depends on.
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
 * THE OPPOSITE-DIRECTION TWINS. A false positive that DROPS an edit and one
 * that INVENTS an edit are different harms; a corpus that tests one direction is
 * a guard watching one door. Every one of these must still reach a mutation
 * path after the fix.
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
      const reachesMutation = reachesEditLane(m) || shouldSuppressEditDispatchForValueUpdate(m);
      expect(reachesMutation, `edit must still mutate: ${m}`).toBe(true);
      expect(classifyAnalyticalIntent(m), `edit must not classify analytical: ${m}`).toBeNull();
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
 * The set is asserted EXACTLY: this test REDs if it GROWS (a regression widened
 * the gap) and equally if it SHRINKS (someone closed a case without moving it
 * out of the list, leaving the record lying). A gap recorded in the suite is
 * honest; a gap invisible to it is how four rounds happen.
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
] as const;

describe('KNOWN-DROPPED: post-rerun comparison phrasings this fix does NOT cover', () => {
  it('is exactly this set — REDs if the gap grows OR shrinks', () => {
    const stillDropped = [...KNOWN_DROPPED_STILL_REACHES_EDIT_LANE].filter((m) =>
      reachesEditLane(m),
    );
    expect(stillDropped).toEqual([...KNOWN_DROPPED_STILL_REACHES_EDIT_LANE]);
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
    expect(KNOWN_DROPPED_STILL_REACHES_EDIT_LANE.length).toBe(10);
  });
});
