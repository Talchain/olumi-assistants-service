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
 *   · "0.12"                   — a bare number with NO verb and NO referent.
 *     Nothing in CEE records which slot the previous turn asked about (the ask
 *     turn is not even committed to `v5_conversation_turns`), so a bare number
 *     cannot be attributed to a slot without a guess. This one is a GENUINE
 *     capability gap and its enabling change is named below.
 *   · "Set it to 0.12 for the subcontracting option." — NAMES A TARGET, so the
 *     edit lane owns it. Correctly refused, and it must stay refused.
 *
 * ⚠ THE COMMA-LED ANSWER IS NO LONGER IN THIS SET and never was in it by name;
 * it was excluded by CLAUSE_BREAK instead. See the CLAUSE_BREAK header for the
 * 18 Aug RUN-B witness that forced the change and for the four twins that prove
 * the harm is still guarded — at the graph, not at the punctuation.
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

export type MissingValueAnswer =
  | {
      readonly kind: 'numeric';
      /** The value exactly as the user wrote it — never reformatted. */
      readonly valueText: string;
      readonly referent: string | null;
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
function readNumericClause(
  text: string,
): { readonly valueText: string; readonly referent: string | null } | null {
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
    return { valueText, referent };
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
  if (whole !== null) return { kind: 'numeric', ...whole, leadingContext: '' };

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
      return { kind: 'numeric', ...trailing, leadingContext };
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
export function messageAnswersMissingValueAsk(message: string): boolean {
  if (typeof message !== 'string') return false;
  if (readMissingValueAnswer(message) !== null) return true;
  // A hedged or targeted numeric answer: unbindable, unmistakably an answer.
  return /\b(?:set|change|update|adjust|make|put|use)\b[^.?!]*\d/.test(normalise(message));
}
