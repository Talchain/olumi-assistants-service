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

const REFERENT = `(?:(${BARE_REFERENTS.join('|')})\\s+)?`;

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
 * The value token.
 *
 * ⚠ `\\.\\d+` IS A SEPARATE ALTERNATIVE, and its absence was a real gap:
 * "Set it to .12." was pinned as dropped purely because the pattern demanded a
 * leading digit. A user writing a bare decimal is not expressing a different
 * intent.
 *
 * No unit, no currency symbol, no percent sign — the whole-message anchoring
 * below is what refuses "12%", "3 months" and "£5000" without this module
 * maintaining a vocabulary list for any of them.
 */
const NUMBER = `(\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)`;

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
 *   · "0.12"                   — a bare number with NO verb and NO referent.
 *     Nothing in CEE records which slot the previous turn asked about (the ask
 *     turn is not even committed to `v5_conversation_turns`), so a bare number
 *     cannot be attributed to a slot without a guess. This one is a GENUINE
 *     capability gap and its enabling change is named below.
 *   · "Set it to 0.12 for the subcontracting option." — NAMES A TARGET, so the
 *     edit lane owns it. Correctly refused, and it must stay refused.
 *
 * ⭐ THE ENABLING CHANGE for the bare-number case, reported rather than
 * attempted: an outstanding-ask record carrying the option and factor ids, so an
 * elliptical answer has an antecedent. Two typed precedents already exist
 * (`pending-action.ts`'s `clarify_v2_round.asked_dimensions` and
 * `elicit_target_baseline.target_id` — the latter's own comment says "no pending
 * question, no elliptical binding, fail closed"). It is a persistence-seam
 * change and is out of this lane's scope per the scope-expansion rule.
 */
export const MISSING_VALUE_ANSWER_KNOWN_DROPPED: readonly string[] = [
  'Set it to about 0.12.',
  'Set it to a third.',
  '0.12',
  'Set it to 0.12 for the subcontracting option.',
];

export type MissingValueAnswer =
  | {
      readonly kind: 'numeric';
      /** The value exactly as the user wrote it — never reformatted. */
      readonly valueText: string;
      readonly referent: string | null;
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
export function readMissingValueAnswer(message: string): MissingValueAnswer | null {
  if (typeof message !== 'string') return null;
  const text = normalise(message);
  if (text.length === 0) return null;

  for (const re of NUMERIC_ANSWER_PATTERNS) {
    const m = re.exec(text);
    if (m === null) continue;
    // Group order differs per alternative (the `use` form has no referent), so
    // the value is the LAST captured group and the referent the one before it
    // when there are two. Read positionally rather than by index literal, or a
    // fourth pattern would silently bind the wrong group.
    const groups = m.slice(1);
    const valueText = groups[groups.length - 1];
    if (valueText === undefined) continue;
    const referent = groups.length > 1 ? (groups[groups.length - 2] ?? null) : null;
    return { kind: 'numeric', valueText, referent };
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
export function messageAnswersMissingValueAsk(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (readMissingValueAnswer(message) !== null) return true;
  // A hedged or targeted numeric answer: unbindable, unmistakably an answer.
  return /\b(?:set|change|update|adjust|make|put|use)\b[^.?!]*\d/.test(normalise(message));
}
