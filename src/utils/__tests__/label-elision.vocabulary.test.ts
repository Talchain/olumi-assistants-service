/**
 * DANGLING_TAIL_WORDS — the COMPLETENESS half (platform trap 12 / 12d).
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `label-elision.test.ts` pins this rule's BEHAVIOUR, and pins it well: the
 * back-off, the four tail classes, case folding, the budget guarantee, the
 * content-word direction, and the known limit. What no test in this estate
 * pinned is the VOCABULARY. Its behavioural cases exercise eight or so distinct
 * words between them, so ~90 of the entries below could be deleted — or a new
 * one added — and every one of those tests stays GREEN. That is the
 * hand-maintained mirror this platform pays for repeatedly, arriving fresh.
 *
 * ── THE DIRECTION THAT MATTERS, WHICH IS NOT THE OBVIOUS ONE ───────────────
 * A word MISSING here is a GAP: an elision keeps a dangling tail. Cosmetic.
 * A word ADDED here is NOT its mirror image. The set is consulted to REJECT
 * candidate heads, so a CONTENT word added to it makes the back-off cut PAST a
 * word the user wrote — falsifying the "can NEVER delete a content word" claim
 * that is the whole safety argument for the rule. The guard is therefore aimed
 * primarily at ADDITIONS, and asserts membership EXACTLY so that an add, a
 * removal, or an add-and-remove SWAP all RED. (A size or count check would be
 * blind to the swap — the within-file-swap blindness that got past a ratchet
 * on the UI in July.)
 *
 * ── WHAT THIS GUARD CLAIMS, AND WHAT IT CANNOT ─────────────────────────────
 * It claims: this vocabulary cannot change without a reviewer looking at the
 * change. It does NOT claim the vocabulary is COMPLETE or CORRECT, and no test
 * here could — a closed-class inventory of English is a judgement, not a
 * computation, and importing a part-of-speech lexicon to adjudicate it is
 * refused for the same reason `label-elision.ts` refuses the second-token
 * extension: it trades one silent harm for another. Pretending otherwise here
 * would be the pre-blessed false label of trap 7b, inside the guard written to
 * prevent it.
 *
 * ── DIVISION OF LABOUR (12d — do not delete "the redundant half") ──────────
 *   · MEMBERSHIP pins WHICH words are in the set. Blind to a word that is
 *     present but can never fire.
 *   · SHAPE pins that every word is REACHABLE by the predicate's own
 *     normalisation. It is the only half that catches a MULTI-WORD entry:
 *     a behavioural round-trip does NOT, because `'as well as'` matches on its
 *     trailing `as`, which is separately a member. Demonstrated by mutation,
 *     not assumed.
 *   · ROUND-TRIP pins that the predicate still applies the set to real text,
 *     including the punctuation stripping nothing else in this suite covers.
 */

import { describe, expect, it } from 'vitest';

import { DANGLING_TAIL_WORDS, endsOnDanglingWord } from '../label-elision.js';

/**
 * The pinned vocabulary, in the SAME four groups the module declares it in, so
 * a diff here is legible to a reviewer as "a determiner was added" rather than
 * as an unattributed string moving. Order is NOT asserted — this is compared as
 * a set — so regrouping is free and only MEMBERSHIP REDs.
 */
const PINNED_DETERMINERS = [
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'another', 'each', 'every',
  'some', 'any', 'no', 'my', 'your', 'our', 'their', 'its', 'his', 'her', 'both',
  'either', 'neither', 'such', 'which', 'what',
] as const;

const PINNED_PREPOSITIONS = [
  'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'into', 'onto',
  'over', 'under', 'about', 'across', 'through', 'between', 'among', 'during',
  'before', 'after', 'against', 'per', 'via', 'without', 'within', 'upon',
  'toward', 'towards', 'beyond', 'beneath', 'besides', 'despite', 'than',
] as const;

const PINNED_CONJUNCTIONS = [
  'and', 'or', 'but', 'nor', 'so', 'yet', 'plus', 'if', 'while', 'when',
  'whereas', 'because', 'as', 'whether', 'unless', 'until', 'since',
] as const;

const PINNED_AUXILIARIES = [
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'will', 'would',
  'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'do', 'does',
  'did', 'has', 'have', 'had', 'not',
] as const;

const PINNED: readonly string[] = [
  ...PINNED_DETERMINERS,
  ...PINNED_PREPOSITIONS,
  ...PINNED_CONJUNCTIONS,
  ...PINNED_AUXILIARIES,
];

describe('DANGLING_TAIL_WORDS — MEMBERSHIP is pinned exactly', () => {
  it('pins its own list without duplicates, so the comparison below means something', () => {
    // Guards the guard: a word repeated across two groups would silently shrink
    // the pinned set and make the equality below agree for the wrong reason.
    expect(new Set(PINNED).size, 'the pinned list repeats a word').toBe(PINNED.length);
  });

  it('holds EXACTLY the pinned vocabulary — an addition, a removal or a SWAP all RED here', () => {
    expect([...DANGLING_TAIL_WORDS].sort()).toEqual([...PINNED].sort());
  });
});

describe('DANGLING_TAIL_WORDS — every entry can actually FIRE', () => {
  it('is shaped for the predicate: one token, lowercase, letters only', () => {
    /**
     * `endsOnDanglingWord` splits on whitespace, lowercases, and strips
     * non-alphanumerics from both ends before the lookup. An entry that is
     * multi-word, capitalised or punctuated therefore can NEVER be matched by
     * it — it is dead weight that reads as coverage. This is the ONLY half of
     * this file that catches a multi-word entry (see the header).
     */
    for (const word of DANGLING_TAIL_WORDS) {
      expect(
        /^[a-z]+$/.test(word),
        `${JSON.stringify(word)} can never be matched: the predicate compares a single ` +
          'lowercased, punctuation-stripped token, so this entry is dead',
      ).toBe(true);
    }
  });

  it('is applied by the predicate to real text, bare and punctuated', () => {
    for (const word of DANGLING_TAIL_WORDS) {
      expect(
        endsOnDanglingWord(`hold the line ${word}`),
        `${JSON.stringify(word)} is in the set but the predicate does not fire on it`,
      ).toBe(true);
      expect(
        endsOnDanglingWord(`hold the line ${word},`),
        `${JSON.stringify(word)} stops matching once punctuation follows it — the ` +
          'normalisation no longer strips a trailing comma',
      ).toBe(true);
    }
  });
});
