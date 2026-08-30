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
 * The BARE NUMBER — the whole message is the figure and nothing else.
 *
 * ⭐ THE SAME `NUMBER` TOKEN, ANCHORED, NOT A SECOND NUMERIC GRAMMAR. A second
 * spelling of "what counts as a number" is the copy that rots (trap 12); this
 * one is built from the token the verb-bearing arms already use, so a change to
 * either reaches both. A trailing full stop is admitted because people type one;
 * NOTHING else is — no unit, no percent sign, no currency symbol, no word. The
 * `^…$` anchor is the whole guard, and it can only ever decline.
 */
const BARE_NUMBER_PATTERN = new RegExp(`^${NUMBER}\\s*[.!]*$`);

/**
 * ⭐⭐ THE CANONICAL MODEL-UNIT SPELLING of a read figure — `null` when the text
 * denotes no plain decimal.
 *
 * WHY IT IS ON THE READING AND NOT AT THE CALL SITES. Every consumer that WRITES
 * feeds the figure back through `buildConfigureOptionAdvisedFormat`, whose
 * sentence is re-read by `readOptionEffectValue` — which declines a percent sign
 * AND a thousands separator. So a percent reading that reached a writer as "8%"
 * would silently fail to land, and each call site fixing that itself is the
 * second spelling that rots (trap 12). One reading, one canonical text.
 *
 * ⚠ THE EXPONENT GUARD IS NOT DECORATION. The consumer takes TEXT, so a value
 * whose shortest round-trip spelling is exponential ("0.00001%" → `1e-7`) must
 * not be produced at all: the writer's own grammar would decline it and the turn
 * would dead-end. Refusing here makes the refusal visible one seam earlier.
 */
function toModelUnitText(digits: string, isPercent: boolean): string | null {
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
 * ⚠ THE ANCHORS ARE THE ESTATE'S OWN, NOT MINTED HERE. `0%` / `100%` are glossed
 * with the wording `compose/configure-option-clarify-response.ts` already ships
 * ("this option does nothing to it" / "this option drives it fully"). The
 * contract declares `InterventionV3.value` as a bare `z.number()`
 * (`schemas/cee-v3.ts:407`) with the 0–1 bound stated by the PRODUCER
 * (`prompts/edit-graph-v6.ts:116`) — a normalised magnitude with no further
 * scientific interpretation declared, which is what makes a `/100` transform
 * innocent. A stronger anchor wording ("strongest plausible effect") would be a
 * semantic claim no producer backs, so it is not used.
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
 */
export const MISSING_VALUE_ASK_FORMAT_HINT: string =
  `How strong is that effect? Answer as a percentage — ${MISSING_VALUE_ASK_EXEMPLARS[0]!.example} `
  + `if this option does nothing to it, ${MISSING_VALUE_ASK_EXEMPLARS[1]!.example} `
  + 'if it drives it on its own.';

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
    };

function normalise(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
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
      };
    }
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

export function messageAnswersMissingValueAsk(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (readMissingValueAnswer(message) !== null) return true;
  const text = normalise(message);
  // A whole-message quantity the binder cannot use: still an answer.
  if (WHOLE_MESSAGE_QUANTITY.test(text)) return true;
  // A hedged or targeted numeric answer: unbindable, unmistakably an answer.
  return /\b(?:set|change|update|adjust|make|put|use)\b[^.?!]*\d/.test(text);
}
