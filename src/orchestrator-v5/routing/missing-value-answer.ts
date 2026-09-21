/**
 * ROADMAP 2.1267 — THE ASK/ACCEPTANCE PAIRING for a missing effect value.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INVARIANT
 *
 *   A repair ask names the slot it is asking about; an ORDINARY answer to that
 *   ask is recognised; and the SAME UNMODIFIED DEMAND may not be re-issued to a
 *   message this module recognises as an answer. Make progress, or change the
 *   ask — never loop.
 *
 * This module is the ONE owner of "is this message an answer to a missing-value
 * ask, and what does it commit to?". It is imported by
 * `repair-value-binding.ts` (which BINDS the numeric case to a slot) and by
 * `compose/configure-option-clarify-response.ts` (which must not repeat itself
 * at any of its call sites). One owner is what makes the loop structurally
 * impossible rather than fixed at the two sites someone remembered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (NEW-1, journey-breaking)
 *
 * A fresh draft was not analysable, the product demanded a literal template,
 * THE TESTER COMPLIED VERBATIM, and it returned the identical demand word for
 * word. No analysis in 24 minutes across 9 turns.
 *
 * ⚠⚠ AND THE OBVIOUS DIAGNOSIS WAS WRONG — CORRECTED AT THE BYTES, because
 * inheriting it would have produced a fix for a closed defect. The
 * verbatim-repeat for a DIGIT-BEARING answer is ALREADY closed at this tip:
 * `edit-graph-dispatch.ts` passes a termination signal derived from
 * `carriesConfigureOptionValuePayload`, and `shouldInterceptBeforeEditLane`
 * declines a value-bearing message on `value_payload_present`, so the route-level
 * intercept never even sees one. A lane "fixing" that would have changed nothing.
 *
 * WHAT IS STILL LIVE AT THIS TIP, measured by driving the real predicates over
 * the two pinned known-dropped sets (`REPAIR_BARE_VALUE_KNOWN_DROPPED`,
 * `QUALITATIVE_VALUE_KNOWN_DROPPED`) — both predicates return FALSE, i.e. no
 * bind AND no termination, i.e. the identical demand:
 *
 *   "Make it 0.12."   "Use 0.12."   "Set it to .12."
 *   "Set the X option's effect on Y to high"      ← the product's OWN template
 *   "Set the X option's effect on Y to about a third"
 *
 * The last two are the sharpest: the product advises a phrasing, the user
 * answers it in ordinary English with a word instead of a decimal, and the
 * product repeats the demand. That is P8 — asking what you cannot accept —
 * reached through a value slot rather than through a chip.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO READINGS, DELIBERATELY UNEQUAL IN CONSEQUENCE
 *
 *   NUMERIC     → bindable. Feeds a WRITE, so it is whole-message anchored and
 *                 refuses anything carrying a named target, a unit, a hedge or a
 *                 second clause. A false positive here writes to the wrong
 *                 place; a false negative costs one turn.
 *   QUALITATIVE → recognised, NEVER interpreted. "high" is not silently turned
 *                 into 0.8. It stops the demand repeating and lets the ask
 *                 CHANGE — the product quotes the word back, names the slot and
 *                 asks for a number. Guessing the user's number would be the
 *                 fabrication class this wave exists to close (P5).
 *
 * ⭐ That asymmetry is the trap-22f exit applied here: where the answer cannot
 * be determined, make the AMBIGUITY the product rather than guessing. An
 * unparseable answer becomes a coaching moment, not a loop.
 */

import {
  CURRENCY_SYMBOL_SOURCE,
  NUMERIC_SUFFIX_SOURCE,
} from '../context/cqe/rules.js';
import {
  CARDINAL_WORD_VALUES,
  CARDINAL_HUNDRED_WORD,
} from '../../utils/cardinal-words.js';

/**
 * The CLOSED referent set — MOVED here from `repair-value-binding.ts`, not
 * copied (CLAUDE.md trap 12). A member is a phrase that can only point at "the
 * value under discussion", never a contentful noun phrase that might name a
 * graph entity. Extending it is a deliberate act with tests; anything outside
 * falls through to today's routing.
 *
 * "them" / "both" are deliberately ABSENT: a plural referent with one value is
 * a compound intent this module must not flatten.
 */
export const BARE_REFERENTS: readonly string[] = [
  'it',
  'that',
  'this',
  'that one',
  'this one',
  'the value',
  'its value',
  'this value',
  'that value',
  'the effect',
  'the effect value',
  'the missing value',
  'the missing effect value',
];

const REFERENT = `(?:(?<referent>${BARE_REFERENTS.join('|')})\\s+)?`;

/**
 * An affirmative lead, because a human answering a question often agrees first.
 *
 * ⚠ SOURCED FROM THE PINNED KNOWN-DROPPED SET, not from imagination:
 * "Yes, set it to 0.12." was already recorded as a phrasing the estate knew it
 * was dropping. Reading a pinned gap and closing it is the whole point of
 * pinning gaps.
 */
const AFFIRMATIVE_LEAD = `(?:(?:yes|yeah|yep|sure|ok|okay)[,!.]?\\s+)?(?:please\\s+)?`;

/**
 * The digits of the value token.
 *
 * ⚠ `\\.\\d+` IS A SEPARATE ALTERNATIVE, and its absence was a real gap:
 * "Set it to .12." was pinned as dropped purely because the pattern demanded a
 * leading digit. A user writing a bare decimal is not expressing a different
 * intent.
 *
 * No unit and no currency symbol — the whole-message anchoring below is what
 * refuses "3 months" and "£5000" without this module maintaining a vocabulary
 * list for either.
 */
const NUMBER_DIGITS = `\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+`;

/**
 * ⭐⭐ CQE's HEDGE VOCABULARY, MIRRORED — with a DERIVED DRIFT GUARD, because a
 * mirror this estate cannot import must fail loud instead of assuming good
 * (CLAUDE.md trap 12).
 *
 * The estate already owns "which words mark an approximation": `APPROX` in
 * `context/cqe/rules.ts:35`, which CQE uses to set `quantity.approximate`. It is
 * not exported (`CQE_NUMERIC_SOURCE`, `CURRENCY_SYMBOL_SOURCE` and
 * `NUMERIC_SUFFIX_SOURCE` are, for exactly this reason), and that file is not
 * this lane's to change. So the alternatives are copied here VERBATIM and
 * `__tests__/hedge-vocabulary-derived.test.ts` reads `rules.ts`'s source, extracts
 * the `APPROX` literal and REDs if CQE ever gains a hedge word this set lacks.
 * A copy that cannot drift silently is the sanctioned form of a mirror.
 */
const CQE_APPROX_HEDGES = 'roughly|about|approximately|around|nearly|circa';

/**
 * ⭐⭐ THE HEDGE IS ABOUT CONFIDENCE, NOT ABOUT THE VALUE — AND READING THE
 * NUMBER THE USER WROTE IS NOT FABRICATION.
 *
 * ⚠⚠ THIS REVERSES A STATED REFUSAL IN THIS FILE, so the refusal is quoted
 * rather than deleted (trap 14 — a confession must not be tidied into an
 * excuse). `MISSING_VALUE_ANSWER_KNOWN_DROPPED` said of "Set it to about 0.12.":
 *
 *   "a HEDGE. Binding it would record an approximation as an exact user-stated
 *    figure, which is the provenance lie this wave is closing one level up."
 *
 * THE PREMISE IS WRONG, and the distinction it collapses is the one that
 * matters. There are two different acts:
 *   · CHOOSING a number the user did not give ("high" → 0.7) — fabrication, and
 *     it stays banned; `matchBareRepairValue` still refuses every qualitative
 *     reading and the `user_specified` stamp stays truthful.
 *   · READING the number the user DID give, through a hedge word — not
 *     fabrication. `0.12` is the user's figure in "about 0.12" exactly as it is
 *     in "0.12"; the hedge qualifies their CONFIDENCE and this module moves the
 *     figure by nothing.
 * Refusing the second bought no provenance safety and cost the journey: measured
 * on deployed CEE `f18d941` the product's own advised phrasing "0.6, say" read
 * null, and a user answering the product's question in ordinary English cleared
 * the block 0 times in 13.
 *
 * ⭐ WHY THIS IS NOT THE OSCILLATING-PREDICATE PATTERN (trap 22f), which is the
 * standing objection to widening a reader here. The four lost rounds were spent
 * on a predicate that had to decide DIRECTION from prose — genuinely ambiguous,
 * with no anchor. This is a CLOSED FILLER SET inside an unchanged `^…$` anchor:
 * every arm still requires the WHOLE message to be nothing but hedge, number and
 * hedge, so the widening can only ever ADMIT A MESSAGE THAT NAMES NO ENTITY. It
 * cannot creep — the same property the header claims for `BARE_NUMBER_PATTERN`.
 *
 * SOURCED FROM OUTSIDE THIS LANE'S HEAD, every member:
 *   · `CQE_APPROX_HEDGES`                       — the estate's own hedge owner.
 *   · "0.6, say" / "I think 0.6 makes sense."   — `SUGGESTED_PHRASING_KNOWN_DROPPED`
 *     (`compose/configure-option-clarify-response.ts:175`), both captured in
 *     Paul's live session, both pinned there as reply shapes the product could
 *     not read.
 *   · "I'd say", "(ish)", "maybe"               — the 23-journey deployed
 *     measurement that opened this lane.
 *   · "Set it to about 0.12."                   — this file's own pinned set.
 */
const HEDGE_WORD =
  `${CQE_APPROX_HEDGES}`
  // ⭐ `approx` / `approx.` — MEASURED DEAD at `de58cff3`, and it is the
  // ABBREVIATION of `approximately`, which CQE already owns. Admitting the long
  // form and refusing the short one is a spelling accident, not a rule. It is
  // added HERE and not to `CQE_APPROX_HEDGES`, because that constant mirrors
  // CQE's literal and the drift guard asserts CQE ⊆ this set, not equality.
  + `|approx\\.?`
  + `|maybe|perhaps|possibly|probably`
  + `|i'?d say|i would say|i think|i reckon|i guess|i'?d go with`
  + `|let'?s say|lets say|say|call it`;

/** Hedges that FOLLOW the figure — "0.6ish", "0.6 (ish)", "0.6, say". */
const HEDGE_TAIL_WORD =
  `${CQE_APPROX_HEDGES}`
  + `|ish|or so|or thereabouts|give or take`
  + `|say|maybe|perhaps|i think|i guess|i reckon`
  + `|makes sense|sounds right|feels right|seems right|feels about right`;

/**
 * Zero or more hedge words leading the figure, and zero or more trailing it.
 * `~` is admitted immediately before the digits as the symbol form of the same
 * hedge. Both sides are `*`, so today's un-hedged messages match the identical
 * shape they match now — this is additive by construction, not by inspection.
 */
const HEDGE_LEAD = `(?:(?:${HEDGE_WORD})[,\\s]+)*`;
const HEDGE_TRAIL = `(?:[,\\s]*\\(?(?:${HEDGE_TAIL_WORD})\\)?)*`;

/**
 * ⭐ PERCENT IS A NOTATION, NOT A UNIT — and that is the whole of why it is
 * admitted here while `£`, `k` and "months" are not.
 *
 * An effect value is DIMENSIONLESS on the producer's 0–1 scale
 * (`src/prompts/edit-graph-v6.ts`: "effect values are on the 0-1 scale"). "8%"
 * denotes the dimensionless quantity 0.08 and its divisor — 100 — is carried in
 * the notation itself. Reading it is arithmetic on what the user wrote.
 *
 * ⚠ CONTRAST, AND IT IS THE LINE THAT MUST NOT MOVE: "£40,000" or "3 months" is
 * a HUMAN-SCALE quantity whose divisor is a `scale_frame` — a fact about a
 * FACTOR, owned by `tools/handlers/d1-shared/scale-frame.ts`, and absent for an
 * option effect. Converting one would mean inventing a frame. Those stay
 * refused, and the range check downstream is what keeps a figure the compute
 * would reject (PLoT gates `value < 0 || value > 1`) from ever being written.
 */
const PERCENT_SUFFIX = `\\s*(?:%|per\\s?cent|percent)`;

/**
 * The value token: an optionally-hedged figure, optionally written as a percent.
 * ONE spelling, used by every arm — a second numeric grammar is the copy that
 * rots (trap 12).
 */
const NUMBER =
  `${HEDGE_LEAD}(?:~\\s*)?(?<value>${NUMBER_DIGITS})(?<pct>${PERCENT_SUFFIX})?${HEDGE_TRAIL}`;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐⭐ THE ANSWER FRAME — TWO PARAMETERS, TWO OPPOSITE HARMS, AND THEY MAY
 * NEVER SHARE A WINDOW (CLAUDE.md trap 22b/22f).
 *
 * MEASURED DEAD AT `de58cff3` (this file's own table, plus two more found by an
 * independent reviewer at the same head). Every one is an ordinary reply to the
 * question the product itself asked, and every one got the IDENTICAL demand
 * back:
 *
 *   "it's 30%" · "it's about 30%" · "it is about 30%" · "that would be 30%"
 *   "my guess is 30%" · "it reaches 30%" · "the factor reaches 30%"
 *   "approx 30%" · "just 30%" · "Just 30%"
 *
 * ⚠ THE STANDING OBJECTION, AND WHY IT DOES NOT APPLY. This estate lost NINE
 * consecutive rounds to a natural-language predicate here, each round fixing one
 * direction and reopening the other. The ruling that came out of it is not "never
 * widen" — it is **when a predicate guards two opposite harms it needs TWO
 * PARAMETERS**. So the widening is split, explicitly, and the two halves are
 * named, separately tunable, and pointed at different failures:
 *
 *   ┌─ PARAMETER 1 — {@link FRAME_LEAD}: WHICH FRAMINGS ARE ADMITTED.
 *   │  GUARDS THE **GAP** (a legitimate answer dropped; the user is stuck, which
 *   │  is today's witnessed defect). Widening it admits more real answers and
 *   │  can NEVER admit a new entity, because every member is contentless.
 *   │  Cost of being too NARROW: the loop. Cost of being too WIDE: nothing on
 *   │  its own — a frame carries no noun.
 *   │
 *   └─ PARAMETER 2 — {@link FRAME_SUBJECTS}: WHAT MAY STAND BEFORE THE COPULA.
 *      GUARDS THE **LIE** (binding a number the user meant for a different
 *      quantity). It is a CLOSED set of phrases that can only ever point at "the
 *      value under discussion" — the property {@link BARE_REFERENTS} already
 *      states. `it`, `that`, `my guess`, `the factor` are members;
 *      `Churn rate`, `Handling time`, `revenue`, `headcount` are not and cannot
 *      become members, because a contentful noun phrase MIGHT name a graph
 *      entity and only the graph can tell. Widening THIS is what would produce a
 *      wrong-entity write.
 *
 * **The two cannot be traded off against each other, which is the point.** In
 * the nine oscillating rounds one window had to be both wide enough to catch
 * real answers and narrow enough to refuse foreign ones, so every move traded a
 * gap for a lie. Here, `it's 30%` and `Churn rate is 30%` are separated by
 * PARAMETER 2 alone, and PARAMETER 1 can be widened to the end of English
 * without moving that line by one character.
 *
 * ⚠ AND TWO FURTHER GUARDS DOWNSTREAM ARE UNTOUCHED BY THIS CHANGE — stated
 * because the frame is deliberately NOT doing their jobs:
 *   · the 0–1 RANGE + ORDINAL-SHAPE check (`repair-value-binding.ts:415,443`),
 *     which is what actually refuses `it's 30`, `it's 150%` and `my guess is
 *     £40,000`. The frame admits the SHAPE; the range refuses the VALUE. That is
 *     why `30` bare and `150%` stay refused with the frame in front of them.
 *   · `deriveOnScreenEffectAsk` — no outstanding ask, no antecedent, no bind.
 *
 * ⚠ WHAT IS DELIBERATELY NOT CLOSED: a CONTENTFUL subject
 * ("Churn rate is 30%"). Text alone cannot tell "the factor you asked about is
 * 30%" from "a different factor is 30%", and guessing is the wrong-entity write.
 * Those are pinned in {@link CONTENTFUL_SUBJECT_KNOWN_DROPPED} and this change
 * makes them TERMINATE (the ask changes) instead of looping — the trap-22f exit:
 * where the answer cannot be determined, make the ambiguity the product.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * PARAMETER 1 OF 2 — THE GAP GUARD. Contentless material a person puts in front
 * of the figure. **Every member must be incapable of naming anything**: an
 * adverb, a copula, or a preposition. That property, not a corpus, is what
 * bounds it — a member that could name an entity belongs in PARAMETER 2's
 * question, not this one.
 *
 * `just` is here because it is THE FIRST WORD OF THE PRODUCT'S OWN HINT
 * ({@link MISSING_VALUE_ASK_FORMAT_HINT}: *"Just the percentage is enough…"*)
 * and `just 30%` was measured DEAD at `de58cff3` — the product refusing an echo
 * of the sentence it had just printed.
 */
const FRAME_ADVERB = `just|only|simply|exactly|precisely|literally`;

/**
 * The copulas and reaching-verbs that join a frame subject to the figure.
 * Contentless by the same rule: none of them can introduce a noun.
 * `'s` is written with an optional apostrophe because {@link normalise} folds
 * the typographic form to the straight one.
 */
const FRAME_COPULA =
  `'?s|is|was|be|'?d be|would be|'?ll be|will be|should be|could be`
  + `|reaches|hits|goes to|gets to|comes to|comes out at|ends up at|ends at`
  + `|lands at|sits at|stands at`;

/**
 * PARAMETER 2 OF 2 — THE LIE GUARD. The CLOSED set of subjects a frame may
 * carry.
 *
 * ⛔ **A MEMBER MUST BE A PHRASE THAT CAN ONLY POINT AT THE VALUE THE PRODUCT IS
 * ASKING ABOUT.** That is {@link BARE_REFERENTS}' own stated rule, reused rather
 * than restated (trap 12), plus the small number of definite descriptions of the
 * one slot on screen. Adding a contentful noun phrase here is the wrong-entity
 * write, and no amount of widening PARAMETER 1 can do it.
 *
 * ⚠ `the factor` IS ADMITTED AND `Churn rate` IS NOT, and the difference is not
 * a judgement call: inside a `^…$`-anchored whole-message answer there is no
 * clause to introduce a second antecedent, so "the factor" has exactly one
 * possible referent — the factor named in the question on screen. "Churn rate"
 * names a specific entity that may or may not be that one, and only the graph
 * knows which.
 */
const FRAME_SUBJECTS: readonly string[] = [
  ...BARE_REFERENTS,
  'the factor',
  'that factor',
  'this factor',
  'the level',
  'its level',
  'my guess',
  'my answer',
  'my estimate',
  'my best guess',
  'the answer',
  'the number',
  'the figure',
];

/**
 * The whole frame: an optional adverb, then an optional subject+copula, then an
 * optional `at`/`to`. Every part is optional and every part is contentless, so
 * the empty frame is the shape that binds today and this construct is ADDITIVE
 * BY CONSTRUCTION rather than by inspection — `30%` still matches the identical
 * way it matches now.
 */
const FRAME_LEAD =
  `(?:(?:${FRAME_ADVERB})\\s+)*`
  + `(?:(?:${FRAME_SUBJECTS.join('|')})\\s*(?:${FRAME_COPULA})\\s+)?`
  + `(?:(?:${FRAME_ADVERB})\\s+)*`
  + `(?:(?:at|to|around)\\s+)?`;

/**
 * The BARE NUMBER — the whole message is the figure and nothing else.
 *
 * ⭐ THE SAME `NUMBER` TOKEN, ANCHORED, NOT A SECOND NUMERIC GRAMMAR. A second
 * spelling of "what counts as a number" is the copy that rots (trap 12); this
 * one is built from the token the verb-bearing arms already use, so a change to
 * either reaches both. A trailing full stop is admitted because people type one;
 * NOTHING else is — no unit, no percent sign, no currency symbol, no word. The
 * `^…$` anchor is the whole guard, and it can only ever decline.
 *
 * ⚠ {@link FRAME_LEAD} SITS INSIDE THE ANCHOR, NOT AROUND IT. The message must
 * still be, in its entirety, frame + figure — a unit, a second figure, a named
 * target or any word outside the two closed sets fails the claim exactly as it
 * does today.
 */
const BARE_NUMBER_PATTERN = new RegExp(`^${FRAME_LEAD}${NUMBER}\\s*[.!]*$`);

/**
 * ⭐⭐ THE SPELLED-OUT PERCENTAGE — "Thirty percent", measured DEAD at
 * `de58cff3` and one of the most ordinary replies there is to a question posed
 * in prose.
 *
 * ⭐ A CLOSED LEXICON WITH ARITHMETIC, NOT A PATTERN OVER WORDS — and that is
 * what keeps it out of the oscillating class. It reads INTEGER number-words and
 * nothing else, so the two refusals that matter are STRUCTURAL rather than
 * rules this reader has to get right:
 *   · `half`, `a third`, `a quarter` — WORD FRACTIONS. They are not in the
 *     lexicon and cannot be, so they can never be read. That preserves the
 *     pinned reason in {@link MISSING_VALUE_ANSWER_KNOWN_DROPPED}: parsing "a
 *     third" means choosing between 0.33 and 0.333…, i.e. inventing precision
 *     the user did not give. **This arm invents no precision because it reads no
 *     fractions.**
 *   · anything outside the lexicon — one unknown word and the whole reading
 *     declines. There is no partial credit and no cliff.
 */
/**
 * THE SPELLED-CARDINAL LEXICON — DERIVED, NOT RE-TYPED.
 *
 * `utils/cardinal-words.ts` declares `CARDINAL_WORD_VALUES` "THE CANONICAL
 * SMALL-CARDINAL MAP — the only place a cardinal word below one hundred may be
 * written", and the first cut of this module re-typed all 27 of its keys. That
 * is the two-lists-one-meaning defect this estate pays for repeatedly, and the
 * magnitude union guard caught it (ROADMAP 2.330): a second lexicon spelling
 * `hundred` is exactly what that guard exists to red.
 *
 * So the words come from the canonical map and `hundred` from
 * `CARDINAL_HUNDRED_WORD`. The tens/ones split this reader needs is DERIVED
 * from the values (a tens word is >= 20 and divisible by 10), never re-listed —
 * so a word the canonical map gains is readable here the instant it lands.
 *
 * WHY THIS READER STILL EXISTS beside `parseCardinalAmount`: that parser reads
 * AMOUNTS and closes a group on a scale word (thousand, million). This reads a
 * PERCENTAGE LEVEL, where a scale word must fail rather than multiply — and it
 * does, because no scale word appears in either map below, so
 * `five thousand percent` yields null and is refused. Different question,
 * shared vocabulary.
 *
 * ⚠ ONE DELIBERATE DELTA, a real divergence rather than an oversight.
 * `CARDINAL_WORD_VALUES` omits `zero` on purpose: its docblock records that "a
 * spelled zero target would silently bypass the direction refusal's zero-pair
 * carve-out" for goal AMOUNTS. That hazard does not exist here — this reader
 * answers "what level does the factor reach?", where `zero percent` is a
 * legitimate answer whose digit form `0%` already binds. Refusing the spelled
 * form while accepting the digit form would make one notation behave
 * differently from the other for the same number. The delta is additive and
 * local; it cannot widen the amount grammar.
 */
const SPELLED_ONES: Readonly<Record<string, number>> = Object.freeze({
  ...Object.fromEntries(
    Object.entries(CARDINAL_WORD_VALUES).filter(([, value]) => value < 20),
  ),
  zero: 0,
});

const SPELLED_TENS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CARDINAL_WORD_VALUES).filter(
      ([, value]) => value >= 20 && value % 10 === 0,
    ),
  ),
);

/**
 * Read a run of number-words as one non-negative integer, or `null`.
 *
 * ⚠ IT DOES NOT RANGE-CHECK, DELIBERATELY. "a hundred and fifty percent" reads
 * 150 and is then refused by the SAME 0–1 guard that refuses `150%`
 * (`repair-value-binding.ts:415`) — one owner of "is this figure inside the
 * effect scale", never a second copy here (trap 12). A reader that silently
 * declined out-of-range words would make the two notations behave differently
 * for the same number.
 */
function readSpelledInteger(words: readonly string[]): number | null {
  // Bounded: the longest form this lexicon can spell is "a hundred and
  // twenty five" (five words). A longer run is prose, not a number.
  if (words.length === 0 || words.length > 5) return null;
  let total = 0;
  let current = 0;
  let seenDigitWord = false;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if (word === 'and') {
      // Only ever between a hundred and its remainder.
      if (!seenDigitWord || total === 0 || current !== 0) return null;
      continue;
    }
    if (word === 'a') {
      // "a hundred" only — never a bare "a", and never "a third".
      if (seenDigitWord || words[i + 1] !== CARDINAL_HUNDRED_WORD) return null;
      current = 1;
      seenDigitWord = true;
      continue;
    }
    if (word === CARDINAL_HUNDRED_WORD) {
      if (!seenDigitWord || current === 0 || current > 9) return null;
      total += current * 100;
      current = 0;
      continue;
    }
    const tens = SPELLED_TENS[word];
    if (tens !== undefined) {
      if (current !== 0) return null;
      current = tens;
      seenDigitWord = true;
      continue;
    }
    const ones = SPELLED_ONES[word];
    if (ones !== undefined) {
      if (current !== 0) {
        // "twenty five" — a tens word followed by a unit. Nothing else.
        if (current % 10 !== 0 || current < 20 || ones === 0 || ones > 9) return null;
        current += ones;
        seenDigitWord = true;
        continue;
      }
      current = ones;
      seenDigitWord = true;
      continue;
    }
    return null;
  }
  if (!seenDigitWord) return null;
  return total + current;
}

/**
 * ⚠ THE PERCENT SUFFIX IS REQUIRED ON THIS ARM, AND ITS ABSENCE IS THE GUARD.
 *
 * A digit form has a second legitimate reading — the internal 0–1 spelling
 * (`0.6`) — which is why bare `0.6` binds and bare `30` is refused by range.
 * A spelled-out word has NO such second reading: nobody writes the internal
 * representation in words. So "thirty" alone is not a percentage claim and is
 * not read as one; only "thirty percent" is. This is the twin that keeps the
 * arm from becoming a general word-to-number grab.
 */
const SPELLED_PERCENT_PATTERN = new RegExp(
  `^${FRAME_LEAD}(?<words>[a-z][a-z\\s-]*?)${PERCENT_SUFFIX}${HEDGE_TRAIL}\\s*[.!]*$`,
);

function readSpelledPercent(text: string): NumericClause | null {
  const m = SPELLED_PERCENT_PATTERN.exec(text);
  if (m === null) return null;
  const raw = m.groups?.['words'];
  if (raw === undefined) return null;
  const words = raw.split(/[\s-]+/).filter((w) => w.length > 0);
  const value = readSpelledInteger(words);
  if (value === null) return null;
  return {
    // The user's own words, quoted back — never a digit form they did not type.
    // ⚠ It is ALSO what `isModelUnitEffectValueText` inspects for the ordinal
    // shape, and "thirty percent" is not `/^\d+$/`, so a spelled answer can
    // never be mistaken for a chip ordinal. A digit spelling here would have
    // silently re-opened that collision.
    valueText: raw.trim().length > 0 ? `${raw.trim()} percent` : `${value} percent`,
    modelUnitText: toModelUnitText(String(value), true),
    referent: null,
    percentApplied: true,
  };
}

/**
 * ⭐⭐ THE CANONICAL MODEL-UNIT SPELLING of a read figure — `null` when the text
 * denotes no plain decimal.
 *
 * WHY IT IS ON THE READING AND NOT AT THE CALL SITES. Every consumer that WRITES
 * feeds the figure back through `buildConfigureOptionAdvisedFormat`, whose
 * sentence is re-read by `readOptionEffectValue` — which declines a thousands
 * separator, and CONVERTS a percent to the 0–1 scale rather than declining it.
 * ⚠ The decline-on-`%` this note originally rested on is gone; the canonical
 * spelling is still the right answer, for the stronger reason that the
 * ACKNOWLEDGEMENT must name the figure that landed (0.08), not the token the
 * user typed. Each call site converting for itself is the second spelling that
 * rots (trap 12). One reading, one canonical text.
 *
 * ⚠ THE EXPONENT GUARD IS NOT DECORATION. The consumer takes TEXT, so a value
 * whose shortest round-trip spelling is exponential ("0.00001%" → `1e-7`) must
 * not be produced at all: the writer's own grammar would decline it and the turn
 * would dead-end. Refusing here makes the refusal visible one seam earlier.
 */
export function toModelUnitText(digits: string, isPercent: boolean): string | null {
  const bare = digits.replace(/,/g, '');
  const parsed = Number(bare);
  if (!Number.isFinite(parsed)) return null;
  const text = isPercent ? String(parsed / 100) : bare;
  return /^\d*\.?\d+$/.test(text) ? text : null;
}

/**
 * The bindable forms. `^…$` anchoring is load-bearing: a named target, a
 * trailing clause, a question lead or a compound sentence all fail the claim
 * with no vocabulary list to maintain.
 *
 * Three verb shapes, because English does not use one:
 *   · "set / change / update / adjust / put IT TO 0.12"   — `to` required
 *   · "make IT 0.12"                                      — no `to`
 *   · "use 0.12"                                          — no referent, no `to`
 */
const NUMERIC_ANSWER_PATTERNS: readonly RegExp[] = [
  new RegExp(`^${AFFIRMATIVE_LEAD}(?:set|change|update|adjust|put)\\s+${REFERENT}to\\s+${NUMBER}\\s*[.!]*$`),
  new RegExp(`^${AFFIRMATIVE_LEAD}make\\s+${REFERENT}${NUMBER}\\s*[.!]*$`),
  new RegExp(`^${AFFIRMATIVE_LEAD}use\\s+${NUMBER}\\s*[.!]*$`),
];

/**
 * ⭐⭐ THE CLAUSE ANCHOR — the numeric arm's `^` becomes "start of message, OR
 * the start of the FINAL sentence-level clause".
 *
 * WITNESSED (18 Aug 2026 composed model-compiler journey, deployed CEE
 * `585f8dce` / UI `dd089a50`, fresh guest). Olumi asked, on screen, for one
 * option×factor effect value. The user answered in ordinary English:
 *
 *   "Doubling down on enterprise sales would push sales headcount up a lot -
 *    set it to 0.8."
 *
 * The final clause IS the whole-message form this module already claims. The
 * `^` anchor refused it for carrying context, the turn fell to the value-update
 * path, and the product refused the answer to its own question (P8).
 *
 * ⚠⚠ THE COMMA WAS EXCLUDED, AND THAT EXCLUSION WAS THE WHOLE JOURNEY'S
 * FAILURE ON THE VERY NEXT RUN. THE ORIGINAL RULE IS QUOTED HERE VERBATIM
 * BECAUSE IT WAS RIGHT ABOUT THE HARM AND WRONG ABOUT WHERE THE GUARD LIVES:
 *
 *   "WHY A SENTENCE-LEVEL BREAK AND NOT A COMMA, stated as a rule rather than
 *    tuned to a corpus (P7). A comma CONTINUES a clause, so a bare referent
 *    after one routinely binds to something that clause just introduced —
 *    *"For the hybrid option, set it to 0.8"* means the hybrid option's
 *    effect, and reading the prose as mere context there would be the
 *    wrong-entity write in a new costume."
 *
 * WITNESSED AGAIN on the COMPOSED journey of 18 Aug 2026, **deployed CEE
 * `4a513781` — i.e. with #1034 AND #1035 already merged and live** — fresh
 * guest, 22:19:00Z (`olumi-docs/feedback-2026-08-16/
 * COMPOSED-JOURNEY-WITNESS-2026-08-18-B.md`, LINK 4). Olumi asked for the
 * effect of option `4abad64d` on factor `3a75cabd`. The user answered:
 *
 *   "That would push sales headcount up a lot, set it to 0.8."
 *
 * ONE CHARACTER of difference from the sentence #1035 was built for — a comma
 * where the previous run's user happened to type a dash. This reader returned
 * `null`, so route-v2's answered-ask pre-route never opened and rule 3c was
 * unreachable however correct it was; the turn fell to the FACTOR-BASELINE
 * pre-route, which emitted a factor clarify, whose pending then wrote
 * `3a75cabd.observed_state.value` `0.5 → 0.8` — the one value that had to stay
 * untouched — while `interventions` stayed empty and the blocker survived by
 * identity. **A punctuation mark decided which ENTITY got written.** Measured
 * at pristine `877affe2` before this change:
 * `readMissingValueAnswer("That would push sales headcount up a lot, set it to
 * 0.8.")` → `null`; `resolveOptionEffectWrite(...)` → `not_effect_framed_intent`.
 *
 * ⭐⭐ THE COMMA IS NOW A BREAK, AND THE HARM THE OLD RULE NAMED IS GUARDED
 * WHERE IT WAS ALWAYS ACTUALLY GUARDED — AT THE GRAPH, NOT AT THE PUNCTUATION.
 * This is the trap-22f exit applied to its own earlier ruling: the estate does
 * not settle "does this clause introduce the referent's antecedent?" with a
 * better punctuation rule. It settles it by asking the GRAPH whether the prose
 * points at any entity outside the pair the product is asking about — which is
 * `resolveOptionEffectWrite`'s conjunct (d), and which already ran on the whole
 * message, comma or no comma. MEASURED, not argued (see the specs):
 *
 *   "For the hybrid option, set it to 0.8."      → still DECLINES. Conjunct (a):
 *       the message carries the word "option", so the SHIPPED classifier claims
 *       it (`option_value_set`, the W1 class) and rule 3c is unreachable. The
 *       old rule's own canonical example is refused by a guard that predates it.
 *   "<sibling factor named in full> …, set it to 0.2."  → DECLINES,
 *       `answer_points_elsewhere` (conjunct (d), factor axis).
 *   "<the goal named in full> …, set it to 0.8."        → DECLINES,
 *       `answer_points_elsewhere` — every NON-OPTION node is checked, not just
 *       sibling factors.
 *   "The team disagrees, set the <factor> baseline to 0.8." → DECLINES,
 *       `baseline_framing`.
 *
 * ⚠ WHAT THIS GENUINELY WIDENS, stated rather than papered over. Conjunct (d)
 * matches labels WORD-BOUNDED AND IN FULL, so a leading clause that refers to
 * an entity only PARTIALLY ("burn rate is the worry, set it to 0.2", where the
 * label is "Burn rate level") is invisible to it and the answer binds to the
 * asked pair. That residual already existed for sentence breaks and is pinned
 * as `ANSWERED_ASK_RESOLVED_LIMIT`; admitting commas enlarges its reach. It is
 * bounded and VISIBLE rather than silent — `formatOptionEffectWriteAck` names
 * the option and factor that moved — and closing it needs the partial/synonym
 * entity reader that CLAUDE.md trap 22f forbids adding.
 *
 * A full stop, `!`, `?`, `;`, a comma or a spaced dash all END a clause for this
 * reader; the preceding words are context and the referent's only antecedent is
 * the question the product asked.
 *
 * ⚠⚠ `(?<!\d)[.!?;](?!\d)` — AND THE FIRST VERSION OF THIS COMMENT WAS WRONG,
 * WHICH IS WHY THE MUTANT FOR IT SURVIVED. It claimed that without the
 * lookarounds `"set it to 0.8."` splits into `"set it to 0"` and `"8."`.
 * MEASURED: it does not. The break already requires `\s+` AFTER the
 * punctuation, and a decimal point is followed by a digit, so the decimal case
 * is protected by the whitespace requirement and the lookarounds are redundant
 * for it. Deleting them left the whole 215-test battery GREEN.
 *
 * THE LOOKAROUNDS' REAL JOB, derived by finding what actually discriminates
 * them: a number that ENDS a clause. *"We agreed 0.5. Set it to 0.8."* — the
 * stop after `0.5` IS followed by whitespace, so without the lookbehind it
 * becomes a break and the message binds. It is kept, and kept in the DECLINING
 * direction: a message carrying a second figure the reader cannot account for
 * is one this write path should not claim. Pinned by that case, not by the
 * decimal one.
 *
 * ⭐ The correction is the lesson (trap 13c): the mutant did not find a missing
 * test, it found a FALSE CLAIM ABOUT OUR OWN GUARD. A survivor is a claim
 * either way and had to be measured, not argued.
 *
 * ⚠ THE WHOLE-MESSAGE READING IS TRIED FIRST AND IS UNCHANGED, so every message
 * that binds today binds identically today — including "Yes. Set it to 0.12.",
 * whose affirmative lead the whole-message pattern already absorbs and which a
 * split-first reading would have demoted to context-bearing. This relaxation is
 * strictly ADDITIVE by construction, not by inspection.
 */
const CLAUSE_BREAK = /(?<!\d)[.!?;,](?!\d)\s+|\s+[\u2014\u2013-]\s+/g;

function splitTrailingClause(text: string): {
  readonly leadingContext: string;
  readonly clause: string;
} {
  const re = new RegExp(CLAUSE_BREAK.source, 'g');
  let breakStart = -1;
  let breakEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    breakStart = match.index;
    breakEnd = match.index + match[0].length;
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  if (breakStart < 0) return { leadingContext: '', clause: text };
  return {
    leadingContext: text.slice(0, breakStart).trim(),
    clause: text.slice(breakEnd).trim(),
  };
}

/**
 * A QUALITATIVE answer: an assignment whose value slot carries no digit.
 *
 * ⭐ DERIVED FROM THE PRODUCT'S OWN TEMPLATE SHAPE, NOT FROM A WORD LIST (P7).
 * `buildConfigureOptionAdvisedFormat` emits "Set the {option} option's effect on
 * {factor} to {value}", so the answer the product invites is "…to <something>".
 * A closed vocabulary of qualitative words ("high", "roughly half", …) would be
 * a hand-maintained mirror that goes stale the first time a user writes a word
 * nobody listed (trap 12); the SHAPE is stable and the word is irrelevant,
 * because this reading never interprets it.
 *
 * A named target is TOLERATED here — unlike the numeric arm — precisely because
 * the product asked for one. Nothing is written on this branch, so tolerance
 * costs nothing.
 *
 * The tail is capped and must END the message, so it cannot swallow a clause.
 */
const QUALITATIVE_ANSWER_PATTERN =
  /\b(?:set|change|update|adjust|make|put|use)\b[^.?!]*\bto\s+([a-z][a-z'\s-]{0,28})\s*[.!]*$/;

/**
 * Phrasings this module KNOWINGLY DOES NOT BIND, pinned as data so the suite
 * REDs if the set GROWS or SHRINKS (trap 22f's honest-gap protocol).
 *
 * Each is a deliberate refusal with a stated reason, not an oversight:
 *
 *   · "Set it to about 0.12."  — a HEDGE. Binding it would record an
 *     approximation as an exact user-stated figure, which is the provenance lie
 *     this wave is closing one level up.
 *   · "Set it to a third."     — a word number. Parsing it means choosing
 *     between 0.33 and 0.333…, i.e. inventing precision the user did not give.
 *   · ⚠⚠ "0.12" — A BARE NUMBER — HAS LEFT THIS SET, AND THE REASON IT WAS HERE
 *     WAS FALSE. The stated reason was *"Nothing in CEE records which slot the
 *     previous turn asked about (the ask turn is not even committed to
 *     `v5_conversation_turns`)"*, and the enabling change was reported as an
 *     outstanding-ask RECORD. **Measured at this tip: the record already exists
 *     and no persistence change was needed.** `deriveAskedEffectPair` reads the
 *     asked pair off the HEAD of the canonical blocker list. The premise
 *     conflated the ask TURN (uncommitted, and irrelevant) with the asked SLOT
 *     (a fact about the PERSISTED GRAPH, still present on the next turn exactly
 *     BECAUSE the answer has not been written yet). A gap can be pinned for
 *     years behind a reason nobody re-derived; this one was pinned behind a
 *     premise that a sibling module had already refuted in code.
 *   · "Set it to 0.12 for the subcontracting option." — NAMES A TARGET, so the
 *     edit lane owns it. Correctly refused, and it must stay refused.
 *
 * ⚠ THE COMMA-LED ANSWER IS NO LONGER IN THIS SET and never was in it by name;
 * it was excluded by CLAUSE_BREAK instead. See the CLAUSE_BREAK header for the
 * 18 Aug RUN-B witness that forced the change and for the four twins that prove
 * the harm is still guarded — at the graph, not at the punctuation.
 *
 * ⭐ THE BARE-NUMBER CASE IS NOW CLOSED, and the enabling change turned out to
 * be a READ, not a write: `deriveAskedEffectPair` over the persisted graph's
 * head blocker. `elliptical: true` marks the reading so no consumer can bind it
 * without that antecedent. The refusal that remains for its NEIGHBOURS — hedges
 * and word-numbers — is unchanged and is about PROVENANCE, not about slots.
 */
export const MISSING_VALUE_ANSWER_KNOWN_DROPPED: readonly string[] = [
  // ⚠⚠ "Set it to about 0.12." HAS LEFT THIS SET. Its stated reason — *"a HEDGE.
  // Binding it would record an approximation as an exact user-stated figure"* —
  // conflated CHOOSING a number the user did not give with READING the one they
  // did. The full argument, and what stays banned, is in the `HEDGE_WORD` header.
  // Measured cost of the refusal: the product's own advised phrasing "0.6, say"
  // read null on deployed `f18d941`, and a natural answer cleared the block 0/13.
  'Set it to a third.',
  'Set it to 0.12 for the subcontracting option.',
  // ⭐ ADDED 19 Aug 2026 BECAUSE A MUTANT SURVIVED AND HAD TO BE SETTLED BY
  // EXECUTION, NOT ARGUED (trap 13c). Deleting `CLAUSE_BREAK`'s trailing
  // `\s+` requirement (`\s+` → `\s*`) left the whole battery GREEN. MEASURED,
  // the ONLY thing it discriminates is punctuation with NO following space:
  //   "…up a lot,set it to 0.8."  original → no break;  mutant → binds.
  // ⚠ AND IT DISCRIMINATES THE SAME WAY AT PRISTINE, on the `.` form
  // ("the costs are fixed.set it to 0.12."), so the `\s+` conjunct was
  // ALREADY unguarded before this lane added the comma — a pre-existing
  // coverage gap on a conjunct this change never touched, now pinned rather
  // than left as a silent survivor. Kept in the DECLINING direction: a
  // space-less break is where run-together tokens live, and widening a
  // conjunct this lane did not come to change is the "while we're here" work
  // the scope rule prohibits.
  'It went up a lot,set it to 0.12.',
];

/**
 * ⭐⭐ THE PHRASE THE ASK TEACHES for "this option leaves that factor alone".
 *
 * It is the FIRST member of {@link MISSING_VALUE_NO_CHANGE_PHRASES} rather than
 * a second spelling beside it, so the sentence the product prints and the set
 * the reader accepts cannot drift (trap 12 — the ask is DERIVED from the
 * vocabulary, never written next to it).
 */
export const MISSING_VALUE_NO_CHANGE_PHRASE = 'no change';

/**
 * ⭐⭐⭐ THE NO-CHANGE VOCABULARY — an EXACT, ANCHORED SET, deliberately not a
 * pattern.
 *
 * ⚠⚠ THIS IS ONE HALF OF A TWO-HARM SEAM AND THE HALVES CANNOT SHARE A WINDOW
 * (trap 22b). The two opposite harms:
 *   · a user meaning **"this option doesn't touch that factor"** must NEVER
 *     produce an intervention of `0` — that would set a real cost, duration or
 *     headcount to zero (see the ISL measurements in the ask hint's header);
 *   · a user meaning **"this drives it to zero"** must NEVER produce "no
 *     intervention" — that would silently discard a genuine, decision-relevant
 *     effect.
 * Both directions are pinned in `__tests__/missing-value-answer.test.ts`, each
 * with its opposite-direction twin, because a corpus that tests one direction is
 * a guard watching one door.
 *
 * ⭐ WHY AN EXACT SET AND NOT A REGEX. English puts "nothing" on BOTH sides of
 * this line — *"it does nothing **to** it"* is no change, *"it drives it **to**
 * nothing"* is zero — and they differ by one preposition. A loose pattern over
 * that is the natural-language predicate this estate lost four consecutive
 * rounds to (trap 22f), each round fixing one direction and reopening the other.
 * An exact set has no cliff and can only ever DECLINE: a phrasing outside it
 * falls through to today's behaviour, which is the demand repeating — a gap, not
 * a lie. Members are added on measured evidence, never on imagination.
 *
 * ⚠ THE LIST IS THE DATA. Nothing derives a phrase from a rule here; the ask
 * sentence quotes member [0] and the reader matches the whole set.
 */
export const MISSING_VALUE_NO_CHANGE_PHRASES: readonly string[] = [
  MISSING_VALUE_NO_CHANGE_PHRASE,
  'no effect',
  'unchanged',
  'it stays the same',
  'stays the same',
  'it does not change',
  'it doesn\'t change',
  'it does nothing to it',
  'does nothing to it',
  'it leaves it unchanged',
  'leaves it unchanged',
  'it does not affect it',
  'it doesn\'t affect it',
  'does not affect it',
  'doesn\'t affect it',
];

/**
 * Optional openers a person puts in front of one of the phrases above. Stripped
 * before the exact-set match so the SET stays the readable data and does not
 * have to enumerate every subject a user might choose.
 */
const NO_CHANGE_OPENERS: readonly string[] = [
  'this option ',
  'the option ',
  'that option ',
  'it ',
];

/**
 * Read the whole message as "this option leaves that factor alone", or `null`.
 *
 * ⚠ WHOLE-MESSAGE ONLY, by the same reasoning as {@link BARE_NUMBER_PATTERN}:
 * anchored, so a verb, a figure, a referent or a second clause all fail the
 * claim. It cannot creep, and it runs AFTER every numeric reading, so a message
 * carrying a digit can never reach it.
 */
function readNoChange(text: string): boolean {
  const stripped = text.replace(/[.!]+$/u, '').trim();
  if (MISSING_VALUE_NO_CHANGE_PHRASES.includes(stripped)) return true;
  for (const opener of NO_CHANGE_OPENERS) {
    if (stripped.startsWith(opener)) {
      const rest = stripped.slice(opener.length).trim();
      if (MISSING_VALUE_NO_CHANGE_PHRASES.includes(rest)) return true;
    }
  }
  return false;
}

/**
 * ⭐⭐ THE FORMS THE ASK MAY OFFER — and they live HERE, in the module that
 * decides acceptance, because P8 is "never ask what you cannot accept".
 *
 * THE DEFECT THIS CLOSES. `coaching/readiness-recovery.ts`'s effect-value ask
 * read, in its entirety: *"Next, choose the missing effect value for "X" on "Y"
 * so the comparison can be prepared."* It names the slot and says NOTHING about
 * what an answer looks like — no scale, no bound, no example — so a tester
 * cannot know a figure outside 0–1 will be refused. The estate's own record of
 * where that leads is `SUGGESTED_PHRASING_KNOWN_DROPPED`: a copy that advertised
 * `— 0.6, say.` while all three readers returned null on it.
 *
 * ⚠ SO THE EXEMPLARS ARE THE DATA AND THE SENTENCE IS DERIVED FROM THEM, never
 * the other way round (trap 12). `__tests__/ask-copy-acceptance-pairing.test.ts`
 * drives {@link readMissingValueAnswer} over this exact array and REDs if any
 * member fails to read as a numeric answer inside the 0–1 effect scale — so the
 * copy cannot advertise a phrasing the binder refuses, in either direction.
 */
export const MISSING_VALUE_ASK_EXEMPLARS: readonly {
  /** What this shape is, for the report and for the spec's failure messages. */
  readonly form: string;
  /** A message of that shape, driven through the real binder by the spec. */
  readonly example: string;
}[] = [
  { form: 'the low anchor the ask names', example: '0%' },
  { form: 'the high anchor the ask names', example: '100%' },
  { form: 'an ordinary percentage answer', example: '60%' },
  { form: 'a hedged percentage answer', example: 'about 60%' },
  // ⭐ STILL ACCEPTED, DELIBERATELY NOT ADVERTISED. The internal representation
  // keeps working for anyone who knows it (and for every replayed chip message
  // the estate already emits), but the ASK never teaches it — see the hint.
  { form: 'the internal representation, unadvertised', example: '0.6' },
];

/**
 * ⭐⭐⭐ THE HUMAN/INTERNAL REPRESENTATION BOUNDARY — the estate's ONE spelling
 * of "how do I answer this?", and the reason it says PERCENTAGE and never `0.6`.
 *
 * ⚠⚠ THIS IS A PRODUCT RULING, NOT A PARSER CONVENIENCE (founder, 30 Aug 2026):
 * **a strategic user must never be asked to understand Olumi's internal
 * normalised coefficient scale.** `0.6` is our representation. Asking for it
 * because the parser happens to read it is a workaround wearing a fix's clothes,
 * and manual testing already found it unintuitive. The anchors are human
 * (`0%` … `100%`); the transform to the internal value is deterministic and
 * ours to perform.
 *
 * ⭐ WHY A UNIT AND NOT A MAGNITUDE HEURISTIC — the trap this design closes.
 * If the binder accepted a bare `60` as 0.60 *and* a bare `0.6` as 0.60, there
 * would be TWO SCALES UNDER ONE NAME, separable only by a magnitude rule with a
 * hard cliff at 1 — and then **`1` is genuinely ambiguous: 1.0 (full effect) or
 * 1% (almost none)?** Whichever the code picks, some user means the other, and
 * the error is 100×. That is the two-arbitrary-constants-with-cliffs shape this
 * estate lost four consecutive rounds to. **The `%` is written BY THE USER, so
 * `60%` → 0.6 is a representation transform, not an inference**, and bare `0.6`
 * keeps its meaning untouched. No cliff exists anywhere.
 *
 * ⚠ THE RESIDUAL, STATED: a user who types a bare `60` MEANING 60% is refused.
 * That is a GAP, not a lie — and the refusal copy names the fix, so it costs one
 * turn rather than dead-ending.
 *
 * ⚠⚠⚠ THE ANCHOR GLOSS WAS FALSE, AND IT WAS THE MOST DANGEROUS SENTENCE IN
 * THIS MODULE. CORRECTED 30 Aug 2026 (Codex, `CHANGES_REQUIRED` on #1217) —
 * corrected IN PLACE rather than deleted, because the estate's own record of
 * how this gloss got here is what stops it coming back (trap 14).
 *
 * The withdrawn text said the anchors were "the estate's own, not minted here",
 * glossed `0%` as *"this option does nothing to it"* and `100%` as *"it drives
 * it fully"*, and reasoned that a `/100` transform is innocent because the
 * contract declares `InterventionV3.value` as a bare `z.number()`. The
 * ARITHMETIC half of that is still true. **The MEANING half was wrong, and the
 * inherited gloss it borrowed was wrong too — a false label faithfully copied
 * from a sibling composer is still a false label.**
 *
 * ⭐⭐⭐ WHAT THE NUMBER ACTUALLY IS — SETTLED BY EXECUTION, NOT BY READING.
 * Measured against the EXACT deployed ISL `28fe0c950f6ca5737f4555c863353d37b734dddf`,
 * `SCMEvaluatorV2` imported directly from
 * `src/services/robustness_analyzer_v2.py` (SHA-256
 * `823263f081eb26ee820653c91d6252cdb655742fb37a96538e75ecf84e08cf77`) — the real
 * class, not a reimplementation:
 *
 *   · `evaluate`'s own docstring (`:1409`) defines the parameter as **`do(X=x)`**.
 *   · `:1428-1431` OVERWRITE the node's structural equation:
 *       `node_values[node_id] = interventions[node_id]`  // "Interventional
 *                                                        //  value overrides
 *                                                        //  structural equations"
 *   · Baseline 0.6, unit-strength factor→goal edge:
 *       no intervention → 0.6 · `do(x=0)` → **0** · `do(x=0.6)` → 0.6 · `do(x=1)` → 1
 *   · CONTROL, zero edge strength, `do(x=1)` → 0 (the probe is not blind).
 *   · CONTROL, baseline 0.8 with `do(x=0.3)` → **0.3, not 0.24** — the baseline is
 *     OVERWRITTEN, never scaled.
 *   · FOUR-WAY DISCRIMINATOR (baseline 0.8, `do(x=0.5)`, strength 0.5), chosen so
 *     every rival reading predicts a DIFFERENT number: absolute assignment → 0.25 ·
 *     change-from-baseline → 0.65 · baseline multiplier → 0.20 · causal strength →
 *     0.40. **MEASURED 0.25.** The other three are refuted by that single run.
 *
 * **So the value is an ABSOLUTE ASSIGNMENT OF THE FACTOR'S OWN LEVEL.** It is not
 * causal strength, and it is not change-from-baseline. Those are three different
 * quantities and the withdrawn copy conflated all three.
 *
 * ⛔ THE EXECUTION CONSEQUENCE, which is why this was a blocker and not a nit:
 * a colleague who followed the advertised anchor — *"0% if this option does
 * nothing to it"* — **SET A REAL COST, DURATION OR HEADCOUNT TO ZERO** and
 * materially changed their own analysis. The parser reading `0%` correctly never
 * made the sentence true. ISL range-checks the value NOWHERE on this path
 * (`InterventionOption.interventions` is a bare `Dict[str, float]`,
 * `models/robustness_v2.py:607`), so nothing downstream would have caught it.
 *
 * ⭐ THE CORRECTED ANCHORS SAY WHAT THE NUMBER DOES: `0%` is the factor FALLING
 * TO ZERO, `100%` is it reaching the TOP OF ITS SCALE. The percentage is of the
 * FACTOR'S OWN SCALE (pass 3d's `scale_frame` divisor — `records/projector.ts`),
 * never of "the effect". The `/100` arithmetic is untouched; only the claim about
 * what the resulting number MEANS has changed.
 *
 * ⚠ AND IT CARRIES NO SPECIMEN MID-SCALE VALUE. An earlier cut of this sentence
 * quoted exemplars verbatim and was caught by an EXISTING guard —
 * `coaching/__tests__/post-draft-narrative.test.ts`, *"leaves the value for the
 * user to choose"*. That guard is right and was not weakened: a copyable figure
 * in the first thing a user reads is a number put in their mouth, and it would
 * then be stamped `user_specified`. Only the ANCHORS appear.
 *
 * ⚠ PAIRED WITH ACCEPTANCE, ALWAYS. Every `example` in the list above must BIND
 * through the real binder — asserted in
 * `__tests__/ask-copy-acceptance-pairing.test.ts` — so the ask cannot advertise a
 * form the product refuses (P8).
 *
 * ⛔⛔⛔ THE ASK DOES NOT OFFER "no change", AND REMOVING THAT CLAUSE IS THE
 * POINT — the reader still RECOGNISES it, the ask simply stops INVITING it.
 *
 * This lane shipped `Say "no change" if the option leaves it alone.` and it was
 * an invitation the product cannot honour. Measured end to end: `kind:
 * 'no_change'` has ONE consumer, whose two call sites are gated on
 * `detectConfigureOptionIntent`, and **0 of 225 accepted no-change phrasings
 * match that detector** (positive control fired, fabricated control declined).
 * The honest reply appeared in **0 of 8** live compositions. The invitation and
 * the qualitative refusal even contradicted each other inside one message:
 *   "I can't put 'no change' on that link — the effect value has to be a
 *    number… Say 'no change' if the option leaves it alone."
 *
 * **A product that invites an answer it cannot process is worse than one that
 * never offers it** — it spends the user's turn and their goodwill, and it is
 * precisely the ask-invariant failure this PR exists to fix, turned inward.
 *
 * ⚠⚠ AND WHY THIS PR'S OWN P8 GUARD COULD NOT SEE IT — worth stating, because
 * the guard is otherwise the strongest thing here: **P8 checks the READER, not
 * the ROUTE.** `ask-copy-acceptance-pairing.test.ts` drives
 * {@link readMissingValueAnswer} and proves every advertised form is
 * *recognised*. Recognition is necessary and NOWHERE NEAR sufficient: an
 * invitation can be perfectly readable and still reach no consumer that acts on
 * it. A form may only be ADVERTISED once its route is witnessed end to end, not
 * once its reader returns non-null.
 *
 * The recognition stays (someone will say it anyway, and they get an honest
 * answer instead of the demand repeating). Re-advertising it needs a write path
 * for an EMPTY intervention, which CEE does not have — rowed, not hidden.
 *
 * ⭐⭐ "NO CHANGE" AND "ZERO" ARE DIFFERENT ANSWERS AND THE ASK NOW OFFERS BOTH.
 * They were previously inexpressible and indistinguishable in the WORST possible
 * arrangement: the ask taught `0%` as the way to say "no effect" (binding the
 * factor to zero — the harm above), while every genuine no-change phrasing read
 * `null` and the demand simply repeated. Measured at pristine `a77979ec`:
 * `"no change"`, `"no effect"`, `"it does nothing to it"`, `"this option does
 * nothing to it"`, `"it leaves it unchanged"` → **all five `null`.**
 *
 * ⚠⚠ AND WHY `no_change` IS A DISTINCT KIND RATHER THAN THE BASELINE VALUE.
 * The obvious implementation — write `do(X = the factor's current level)` — is
 * WRONG, and this was settled by execution against the same deployed ISL, not
 * reasoned. An intervention REPLACES the node's per-draw sample (`:1429`
 * short-circuits before the `factor_values` lookup at `:1438`), so pinning at
 * the baseline preserves the MEAN and destroys the VARIANCE. Measured on the
 * real Monte Carlo loop, n=4000, seed 424242, `x ~ normal(0.6, 0.15)`:
 *
 *   `interventions={}`   → mean 0.602552, std **0.149197**
 *   `do(x=0.6)`          → mean 0.599466, std **0.000401**   ← 372× collapse
 *
 * So writing the baseline would make the option look maximally robust **for a
 * reason that has nothing to do with the decision** — a confident wrong number,
 * which is the one thing this product may never produce. ISL already ships the
 * honest primitive: an EMPTY `interventions={}` evaluates on the sampled draws.
 * Recording `no_change` as its own reading keeps that door open and, until the
 * write path can act on it, keeps the product from silently choosing either
 * wrong answer on the user's behalf.
 */
/**
 * ⭐⭐⭐ IT NOW STATES THE ANSWER SHAPE, AND THAT IS THE HALF THAT WAS MISSING.
 *
 * The sentence above this one explained what the number MEANS. It never said
 * what a REPLY should LOOK like — so the product posed a prose question and
 * accepted only a bare figure, and the two forms were never introduced to each
 * other. Measured at pristine `fa2c9e93`, reader AND route, one live claimant:
 *
 *   BINDS      `30%` · `about 30%` · `roughly 30%` · `maybe 30%` · `I think 30%`
 *              · `set it to 30%` · `0%` · `100%` · `0.6`
 *   DEAD-END   `it's about 30%` · `it's 30%` · `that would be 30%`
 *              · `my guess is 30%` · `Churn rate is 30%` · `Handling time is 30%`
 *              · `it reaches 30%` · `Thirty percent` · `approx 30%`
 *
 * Sixteen ordinary answers to the product's own question where the IDENTICAL
 * demand repeats. That is the witnessed *"three attempts running now haven't
 * landed"* loop, and every one of them is a sentence a person would actually
 * type in reply to a question phrased as prose.
 *
 * ⛔ THE FIX IS NOT A WIDER PARSER. That was tried and parked after five rounds
 * that each fixed one direction and reopened another (trap 22f); the estate's
 * ruling is to **make the product ask for exactly what it can consume**. The
 * binder consumes a bare percentage, so the ask now says *bare percentage* —
 * five words, at the one place that owns this copy.
 *
 * ⚠ IT STAYS HUMAN, DELIBERATELY. It names a PERCENTAGE, never the internal
 * normalised scale (the founder ruling above), and it carries NO mid-scale
 * specimen — a copyable figure in the first thing a user reads is a number put
 * in their mouth, and it would then be stamped `user_specified`. Only the two
 * anchors appear, and they are interpolated from the exemplar list rather than
 * spelled beside it, so the sentence cannot drift from the forms the spec
 * drives through the real binder.
 *
 * ⚠ WHAT IT DOES NOT CLAIM. Instructing the shape does not make the dead-end
 * phrasings bind; it stops the product INVITING them. The dead-end set is
 * pinned exactly in `__tests__/ask-copy-acceptance-pairing.test.ts` so it REDs
 * if it grows or shrinks — a gap recorded in the suite is honest, a gap
 * invisible to it is how the five rounds happened.
 */
export const MISSING_VALUE_ASK_FORMAT_HINT: string =
  'Just the percentage is enough — it is the level the factor reaches, '
  + 'not how much it moves: '
  + `${MISSING_VALUE_ASK_EXEMPLARS[0]!.example} means zero, `
  + `${MISSING_VALUE_ASK_EXEMPLARS[1]!.example} means its top.`;

export type MissingValueAnswer =
  | {
      readonly kind: 'numeric';
      /**
       * The value as the user wrote it — never rescaled. A percent sign is
       * carried ("8%"); only the whitespace inside the token is collapsed.
       * This is the form to QUOTE BACK, never the form to write.
       */
      readonly valueText: string;
      /**
       * ⭐ THE CANONICAL 0–1 SPELLING a writer must use — `"0.08"` for `"8%"`,
       * `"40000"` for `"40,000"` — or `null` when the text denotes no plain
       * decimal. See {@link toModelUnitText}. It is NOT range-checked here: this
       * module is a text reader and the 0–1 bound belongs to the consumer that
       * knows the slot (`repair-value-binding.ts`).
       */
      readonly modelUnitText: string | null;
      readonly referent: string | null;
      /**
       * ⭐⭐ THE MESSAGE IS A BARE NUMBER — no verb, no referent, nothing else.
       *
       * `true` means this reading carries NO antecedent of its own: the slot
       * cannot come from the sentence, because there is no sentence. A consumer
       * that resolves its slot FROM THE MESSAGE must refuse an elliptical
       * reading outright; only a consumer holding the product's own outstanding
       * ask may bind it. `matchBareRepairValue` refuses it for exactly that
       * reason, and `resolveRepairValueBinding` routes it to
       * `deriveAskedEffectPair` instead of to the sole-missing-pair rule.
       *
       * ⚠ THE FIELD EXISTS SO THE DISTINCTION CANNOT BE LOST AT A CALL SITE.
       * A second predicate ("is this message just a number?") in a second module
       * is how this estate loses seams (trap 12); one reading with the
       * distinction recorded ON it cannot drift, and a consumer that ignores the
       * field is choosing to bind without an antecedent VISIBLY rather than
       * silently.
       */
      readonly elliptical: boolean;
      /**
       * ⭐⭐⭐ DID THIS READING DIVIDE BY 100? — the reader's OWN answer, so no
       * consumer has to guess from the text.
       *
       * ⚠⚠ IT EXISTS BECAUSE A CONSUMER GUESSED AND WAS WRONG, TWICE OVER.
       * `configure-option-clarify-response.ts` gated its "did you mean a
       * percentage?" offer on `valueText.includes('%')` — a HAND-MAINTAINED
       * MIRROR of this module's percent detection (trap 12). It had already
       * drifted from the thing it mirrors by TWO spellings, because
       * {@link PERCENT_SUFFIX} admits `percent` and `per cent` as well as the
       * glyph. Measured at the head that introduced the mirror:
       *
       *   "Set it to 150 percent."  → modelUnitText 1.5, no `%` CHARACTER
       *   composed: "If you meant 1.5% of its full scale …"
       *
       * The user wrote 150 percent and the product offered them 1.5% — the
       * SAME 100× harm, in the same sentence, as the defect that gate was
       * added to close.
       *
       * ⭐ THE FIX IS NOT ANOTHER SPELLING IN THE GATE — adding `percent` to
       * the consumer maintains the mirror and it drifts again on the next
       * notation. There is ONE owner of "was this a percentage?", and it is the
       * reader that performed the division. Consumers ASK; they never re-derive.
       * Anything downstream that needs the question answered reads this field.
       */
      readonly percentApplied: boolean;
      /**
       * ⭐ THE PROSE THAT PRECEDED THE ANSWERING CLAUSE, normalised — `''` when
       * the message is, in its entirety, the answer.
       *
       * WHY IT IS ON THE READING AND NOT A SECOND FUNCTION (trap 21 — name the
       * concepts apart, do not build a second reader). Two consumers need
       * DIFFERENT answers to "did the user answer?", and the difference is
       * exactly this field:
       *   · `matchBareRepairValue` may bind ONLY the whole-message form, because
       *     its caller resolves the slot from "exactly one pair is missing" and
       *     has no reader for what the prose points at. It requires `''`.
       *   · `resolveOptionEffectWrite`'s rule 3c binds a context-bearing answer,
       *     because it FIRST checks the prose against the graph's own entities
       *     and against the pair the product is asking about.
       * A second grammar in a second module is how this estate loses seams
       * (trap 12); one reading with the distinction recorded on it cannot drift.
       */
      readonly leadingContext: string;
    }
  | {
      readonly kind: 'qualitative';
      /** The user's own words, quoted back. NEVER mapped to a number. */
      readonly term: string;
    }
  | {
      /**
       * ⭐⭐⭐ "THIS OPTION LEAVES THAT FACTOR ALONE" — a THIRD kind, and the
       * whole point is that it is neither of the other two.
       *
       * It is NOT `numeric` with a value of `0`: zero is an absolute assignment
       * that drives the factor TO zero (`do(X=0)`, measured on deployed ISL
       * `28fe0c95` — see the ask hint's header). It is NOT `qualitative`
       * either: a qualitative term is a word we decline to interpret, whereas
       * this one is fully understood — we simply cannot ACT on it yet.
       *
       * ⚠ A CONSUMER MUST NOT SUBSTITUTE A NUMBER FOR IT, AND THAT INCLUDES THE
       * FACTOR'S OWN BASELINE. Writing `do(X = baseline)` preserves the mean and
       * destroys the variance (std 0.149197 → 0.000401 on the real Monte Carlo
       * loop, n=4000) — the option would read as maximally robust for a reason
       * unrelated to the decision. The honest primitive is ISL's empty
       * `interventions={}`; until a write path can express that, a consumer says
       * so plainly rather than choosing a wrong number on the user's behalf.
       */
      readonly kind: 'no_change';
      /** The user's own words, quoted back — never rewritten. */
      readonly term: string;
    };

/**
 * ⚠ THE TYPOGRAPHIC APOSTROPHE IS FOLDED TO THE STRAIGHT ONE, and it is not
 * cosmetic. macOS, iOS and every word processor substitute `’` (U+2019) as the
 * user types, so `it’s 30%` is what actually arrives on the wire while every
 * pattern in this file — and `MISSING_VALUE_NO_CHANGE_PHRASES`' `it doesn't
 * change` — is written with `'`. Without this fold the frame below would read
 * the keyboard the developer used rather than the one the user has.
 *
 * It can only ever ADMIT: no pattern here matches `’`, so no message that binds
 * today stops binding.
 */
function normalise(message: string): string {
  return message
    .toLowerCase()
    .replace(/[‘’ʼ]/gu, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read the message as an answer to a missing-value ask. PURE, no graph, no
 * state — a text predicate only, so a caller can never mistake it for evidence
 * about WHICH slot is outstanding.
 *
 * Numeric is tried first: a digit-bearing answer is bindable and must not be
 * demoted to the clarify branch.
 */
interface NumericClause {
  readonly valueText: string;
  readonly modelUnitText: string | null;
  readonly referent: string | null;
  readonly percentApplied: boolean;
}

/**
 * ⚠ GROUPS ARE READ BY NAME, NOT BY POSITION, and that is a correction rather
 * than a tidy-up. The previous reader took "the value is the LAST captured
 * group and the referent the one before it" — true only while every alternative
 * captured exactly one or two groups. The percent capture makes that false, and
 * a positional reader would have silently bound the percent marker as the value
 * on one arm and the referent on another. Names cannot come apart from what they
 * name.
 */
function readNumericClause(text: string): NumericClause | null {
  for (const re of NUMERIC_ANSWER_PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    const digits = m.groups?.['value'];
    if (digits === undefined) continue;
    const percent = m.groups?.['pct'];
    const isPercent = percent !== undefined;
    return {
      // The user's own token, whitespace inside it collapsed ("8 %" → "8%").
      valueText: isPercent ? `${digits}${percent.trim()}` : digits,
      modelUnitText: toModelUnitText(digits, isPercent),
      referent: m.groups?.['referent'] ?? null,
      percentApplied: isPercent,
    };
  }
  return null;
}

export function readMissingValueAnswer(message: string): MissingValueAnswer | null {
  if (typeof message !== 'string') return null;
  const text = normalise(message);
  if (text.length === 0) return null;

  // (1) TODAY'S READING, UNCHANGED AND FIRST. Anything that binds at this tip
  // binds identically, with `leadingContext: ''`.
  const whole = readNumericClause(text);
  if (whole !== null) return { kind: 'numeric', ...whole, leadingContext: '', elliptical: false };

  // (1b) ⭐⭐ THE BARE NUMBER — "0.6", and nothing else in the message.
  //
  // PINNED-DROPPED UNTIL NOW, BY NAME ('0.12'), with the stated reason
  // "Nothing in CEE records which slot the previous turn asked about … This one
  // is a GENUINE capability gap and its enabling change is named below", and the
  // named enabling change was "an outstanding-ask record carrying the option and
  // factor ids". ⚠ THAT PREMISE IS REFUTED AT THIS TIP AND THE RECORD ALREADY
  // EXISTS: `deriveAskedEffectPair` (`repair-value-binding.ts`) reads the pair
  // the product is asking about off the HEAD of the canonical blocker list —
  // the SAME element `coaching/readiness-recovery.ts:194,242` composes the
  // on-screen question from. The antecedent never needed the ask TURN, which is
  // indeed uncommitted; it needed the asked SLOT, which is a fact about the
  // PERSISTED GRAPH and is therefore still there on the next turn precisely
  // BECAUSE nothing was written. No persistence-seam change is required.
  //
  // ⚠ THIS READING CARRIES NO ANTECEDENT AND MUST NEVER BE BOUND WITHOUT ONE.
  // It is anchored to the WHOLE message, so it cannot creep: a verb, a unit, a
  // referent, a second clause or any other word all fail the claim. That is why
  // it is marked `elliptical` rather than being returned as an ordinary numeric
  // answer — the slot is the CALLER's problem, and a caller that resolves slots
  // from the sentence has nothing to resolve from.
  const bare = BARE_NUMBER_PATTERN.exec(text);
  if (bare !== null) {
    const digits = bare.groups?.['value'];
    if (digits !== undefined) {
      const percent = bare.groups?.['pct'];
      const isPercent = percent !== undefined;
      return {
        kind: 'numeric',
        valueText: isPercent ? `${digits}${percent.trim()}` : digits,
        modelUnitText: toModelUnitText(digits, isPercent),
        referent: null,
        leadingContext: '',
        elliptical: true,
        percentApplied: isPercent,
      };
    }
  }

  // (1c) ⭐⭐ THE SPELLED-OUT PERCENTAGE — "thirty percent".
  //
  // It sits with the other WHOLE-MESSAGE readings and carries the same
  // `elliptical: true`, for the same reason: the message is frame plus figure
  // and nothing else, so its only antecedent is the question on screen. It runs
  // AFTER both digit arms, so no message carrying a digit can ever reach it.
  const spelled = readSpelledPercent(text);
  if (spelled !== null) {
    return { kind: 'numeric', ...spelled, leadingContext: '', elliptical: true };
  }

  // (2) THE ANSWER CARRIED CONTEXT. The final sentence-level clause is the
  // SAME grammar — no new patterns, no widened vocabulary (see CLAUSE_BREAK).
  //
  // ⭐ THE REFERENT IS REQUIRED HERE AND OPTIONAL ABOVE, and the asymmetry is
  // the safety. "Use 0.8." alone is unmistakably an answer because there is
  // nothing else in the message; "…so the CAC picture is grim - use 0.8."
  // carries a whole clause the value might belong to instead. A bare referent
  // from the CLOSED set ("it", "that", "the value", …) is the one construction
  // that cannot name a graph entity, which is what leaves the product's own
  // outstanding question as the only antecedent. Refused shapes are pinned in
  // `ANSWERED_ASK_KNOWN_DROPPED`.
  const { leadingContext, clause } = splitTrailingClause(text);
  if (leadingContext.length > 0 && clause.length > 0) {
    const trailing = readNumericClause(clause);
    if (trailing !== null && trailing.referent !== null) {
      return { kind: 'numeric', ...trailing, leadingContext, elliptical: false };
    }
  }

  // (3) ⭐⭐ "NO CHANGE" — LAST AMONG THE NUMERIC ARMS BY CONSTRUCTION, AND THAT
  // ORDER IS THE SAFETY.
  //
  // Every numeric reading above has already declined by the time this runs, so a
  // message carrying a figure can NEVER be read as no-change: `"0%"`, `"set it
  // to 0"` and `"down to zero"` are claimed upstream (or, for the last, decline
  // everywhere) and never reach here. That is the opposite-direction twin
  // enforced STRUCTURALLY rather than by a rule this function has to get right —
  // the zero direction cannot be stolen by the no-change direction because it is
  // resolved first.
  //
  // It sits ABOVE the qualitative arm because "no change" is a phrase we
  // UNDERSTAND, not a word we decline to interpret. Demoting it to qualitative
  // would quote it back and re-ask for a number, which is exactly the loop this
  // reading exists to end.
  if (readNoChange(text)) {
    return { kind: 'no_change', term: normalise(message).replace(/[.!]+$/u, '').trim() };
  }

  const q = QUALITATIVE_ANSWER_PATTERN.exec(text);
  if (q !== null) {
    const term = (q[1] ?? '').trim();
    if (term.length > 0) return { kind: 'qualitative', term };
  }
  return null;
}

/**
 * ⭐⭐ THE TERMINATING PREDICATE — the one question every ask-emitting composer
 * must consult before repeating itself.
 *
 * TRUE means "the user has answered; do not re-issue the same demand". It is
 * deliberately WIDER than {@link readMissingValueAnswer}: termination and
 * binding are different questions with different costs (trap 21 — name the two
 * concepts apart). A message the numeric arm refuses to BIND (a hedge, a named
 * target, a word) is still unmistakably an ANSWER, and repeating the demand at
 * it is the defect.
 *
 * ⚠ THE ONLY SAFE DIRECTION FOR THIS PREDICATE IS WIDE. A false positive means
 * the product says something more useful than the demand it was about to
 * repeat; a false negative is the witnessed loop. That is why the pinned
 * known-dropped set above — which is about BINDING — must not be read as a list
 * of messages this returns false for. The suite pins that every one of them
 * terminates.
 */
/**
 * ⭐⭐ A BARE HUMAN-SCALE QUANTITY — "£40,000", "40k", "3 months", "8%".
 *
 * ⚠ FOUND BY A TWIN THAT FAILED, NOT BY INSPECTION. This module's termination
 * predicate required a VERB before a digit, so a user answering the on-screen
 * effect-value question with **"£40,000"** — a wrong-scale answer, but
 * unmistakably an answer — satisfied neither arm, and the composer repeated the
 * identical demand at them. That is P8 reached through the most likely wrong
 * answer to the question the product just asked.
 *
 * The currency and magnitude alphabets are IMPORTED from CQE, which exports
 * them for exactly this reason; re-spelling either is the drift `rules.ts`'s own
 * header records twice (`¥`, bare-`b`).
 *
 * ⚠ THIS WIDENS TERMINATION ONLY, NEVER BINDING — and the asymmetry is the
 * safety, stated in this predicate's own header: a false positive means the
 * product says something more useful than the demand it was about to repeat; a
 * false negative is the witnessed loop. `readMissingValueAnswer` is untouched,
 * so nothing here can reach a write.
 */
const WHOLE_MESSAGE_QUANTITY = new RegExp(
  `^${HEDGE_LEAD}(?:${CURRENCY_SYMBOL_SOURCE})?\\s*(?:${NUMBER_DIGITS})`
  + `(?:\\s*(?:${NUMERIC_SUFFIX_SOURCE}|%|per\\s?cent|percent))?`
  + `(?:\\s+[a-z]+)?${HEDGE_TRAIL}\\s*[.!]*$`,
);

/**
 * ⭐⭐⭐ A CONTENTFUL SUBJECT STATING A QUANTITY — "Churn rate is 30%".
 *
 * ⛔ THIS TERMINATES AND MUST NEVER BIND, AND THE ASYMMETRY IS THE WHOLE
 * DESIGN. Text alone cannot separate the two readings:
 *   · the user naming THE FACTOR THE PRODUCT ASKED ABOUT — a perfect answer;
 *   · the user naming A DIFFERENT quantity — where binding it is the
 *     wrong-entity write, i.e. the LIE this seam's PARAMETER 2 exists to refuse.
 * They are the same string. Only the graph knows which, and this module is PURE
 * by contract ("no graph, no state") — so it declines to choose.
 *
 * ⭐ THE TRAP-22f EXIT, APPLIED: where the answer cannot be determined, make the
 * AMBIGUITY THE PRODUCT. Terminating without binding is exactly that — the
 * product stops repeating the identical demand and gets to CHANGE the ask
 * instead, which is the one honest move available. It is also the safe
 * direction by this predicate's own header: a false positive here means the
 * product says something more useful than the demand it was about to repeat.
 *
 * ⚠ IT REQUIRES A COPULA AND A MESSAGE-FINAL QUANTITY, so it cannot claim a
 * question ("what is missing?") or an instruction ("run the analysis"), neither
 * of which ends in a figure.
 */
const FRAMED_QUANTITY_LEAD =
  `\\b(?:${FRAME_COPULA})\\s+(?:(?:${FRAME_ADVERB})\\s+)*(?:(?:at|to|around)\\s+)?`
  + `${HEDGE_LEAD}(?:~\\s*)?`;

/**
 * ⚠ TWO ARMS, AND THE DIGIT/WORD SPLIT IS LOAD-BEARING RATHER THAN TIDY.
 *
 * The WORD arm must require the percent notation, because without it
 * "that would be fine" — a copula followed by a word — would terminate, and
 * termination would stop being earned by an ANSWER. The DIGIT arm does not need
 * that guard: a message ending in a figure after a copula is a quantity however
 * it is spelled, so a unit is admitted there ("it's 8 minutes", "my guess is
 * £40,000" — both wrong-scale, both unmistakably answers, both looping at
 * `de58cff3`).
 */
const CONTENTFUL_SUBJECT_QUANTITY = new RegExp(
  `(?:`
  + `${FRAMED_QUANTITY_LEAD}(?:${CURRENCY_SYMBOL_SOURCE})?\\s*(?:${NUMBER_DIGITS})`
  + `(?:\\s*(?:${NUMERIC_SUFFIX_SOURCE}|%|per\\s?cent|percent))?(?:\\s+[a-z]+)?`
  + `|`
  + `${FRAMED_QUANTITY_LEAD}[a-z][a-z\\s-]*?${PERCENT_SUFFIX}`
  + `)`
  + `${HEDGE_TRAIL}\\s*[.!]*$`,
);

/**
 * The phrasings this module RECOGNISES AS ANSWERS AND DELIBERATELY DOES NOT
 * BIND, pinned as data so the suite REDs if the set GROWS or SHRINKS (trap 22f's
 * honest-gap protocol).
 *
 * ⚠ THIS IS A DIFFERENT SET FROM {@link MISSING_VALUE_ANSWER_KNOWN_DROPPED},
 * and the difference is the point (trap 21 — name the concepts apart). That set
 * is about messages the reader returns `null` for. This one is about messages
 * the reader still returns `null` for **while the product no longer loops at
 * them** — a gap that costs one turn and a changed ask, not a dead end.
 *
 * Every member is a CONTENTFUL SUBJECT, i.e. exactly the class PARAMETER 2
 * refuses. Closing them needs the graph, which this module does not have.
 */
export const CONTENTFUL_SUBJECT_KNOWN_DROPPED: readonly string[] = [
  'Churn rate is 30%',
  'Churn rate is at 30%',
  'Handling time is 30%',
];

export function messageAnswersMissingValueAsk(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (readMissingValueAnswer(message) !== null) return true;
  const text = normalise(message);
  // A whole-message quantity the binder cannot use: still an answer.
  if (WHOLE_MESSAGE_QUANTITY.test(text)) return true;
  // A named quantity the binder must not claim: still unmistakably an answer.
  if (CONTENTFUL_SUBJECT_QUANTITY.test(text)) return true;
  // A hedged or targeted numeric answer: unbindable, unmistakably an answer.
  return /\b(?:set|change|update|adjust|make|put|use)\b[^.?!]*\d/.test(text);
}
