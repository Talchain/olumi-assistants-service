/**
 * T1 claim safety — the model's own CONVERSATION HISTORY, in BOTH the forms it
 * reaches the prompt in:
 *
 *   FOURTH CHANNEL — `conversation.recent_turns[].assistant_message`, the prior
 *     turns VERBATIM (#724). The measurement below is this one's.
 *   FIFTH CHANNEL  — `conversation_summary.text`, the stored four-slot ROLLING
 *     SUMMARY of the same conversation (2026-07-27). Same defect one layer up,
 *     same reader, same marker; see the section headed THE FIFTH CHANNEL near
 *     {@link projectConversationSummaryForWithheldClaim} for its own live
 *     evidence and for why the block's structure survives redaction.
 *
 * ONE MODULE, TWO CONSUMERS, DELIBERATELY. The two channels carry the same kind
 * of prose and were leaking the same kind of sentence; giving the summary its
 * own near-identical reader is precisely how this estate's dominant defect
 * (near-identical copies drifting apart) gets built. The wide-vocabulary reader,
 * the splitter, the marker and its inertness probes are shared by CALL, not by
 * copy.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CLOSES, MEASURED RATHER THAN SUPPOSED.
 *
 * `WALK-HISTORIC-PREP-2026-07-27.md` §10, live on build `b35d09de` (i.e. AFTER
 * #721 gated the wire blocks and AFTER #723 gated the decision-records channel):
 * historic scenario `f63ccb45`, a WITHHELD turn, `assistant_text` on **2 of 5**
 * samples —
 *
 *   "Double down on SMB previously led by 17 points, flagged fragile on this
 *    exact assumption from the first run."                        (rep4)
 *   "Your stored lean is Double down on SMB, ahead by 17 percentage points"
 *                                                                 (base)
 *
 * The model was not inventing this. `ContextPack.conversation.recent_turns[]
 * .assistant_message` carries the prior turns' answers VERBATIM, and
 * `buildUserMessage` serialises the whole `conversation` object into the routing
 * prompt via its `...rest` spread. Nothing on that path consults the verdict.
 *
 * ⚠ AND THE MECHANISM SELF-REINFORCES, WHICH IS THE MORE IMPORTANT HALF. A
 * leaked answer is persisted as that turn's `assistant_message` and feeds the
 * NEXT turn's `recent_turns`. Seven of the leaking messages in `f63ccb45`'s
 * history were written by the walk's own probe turns — the probe measurably
 * poisoned the scenario it was measuring (§10.4). One leak permanently raises
 * the leak probability of every subsequent turn on that scenario. Gating the
 * INPUT is what breaks that loop: a leaked sentence still lands in the database
 * (this projection never touches storage — see below), but it can no longer be
 * read back to the model on a turn that withholds.
 *
 * ⚠ THE CONTROL THAT KEEPS THIS HONEST, AND WHY IT DOES NOT WEAKEN THE CASE.
 * Leader language in history is NOT SUFFICIENT to produce a leak: target `c6`
 * carries EIGHT leader-naming stored messages (including "Increase Engineering
 * Budget currently leads by 39 percentage points") and leaked 0/5. The
 * mechanism is recency/saturation of the retrieved window, not mere presence.
 * That refutes "history ⇒ leak"; it does not refute "history is the input the
 * leak is built from". This module removes the INPUT, and its tests therefore
 * pin PACK BYTES — never a model output and never a live leak rate, neither of
 * which a unit test can observe.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY THIS READER IS SEPARATE FROM — AND WIDER THAN — THE EGRESS ALARM'S.
 *
 * THE MEASUREMENT THAT FORCED THE DESIGN. Scored against the shared
 * `LEADER_CLAIM_PATTERNS`, the rep4 leak sentence returns
 * `assistant_text_leader_codes: []` — **ZERO hits**. Checked pattern by
 * pattern: `\bleads\b` misses the PAST TENSE "led"; `\bleading\s+option/` and
 * `\bleading\s+in\b` miss a bare participle; `\b(?:is|are|was|were)\s+ahead\b`
 * and the band adverbs miss "sits ahead of"; `\bahead\s+by\b` does catch the
 * BASE sample and nothing in the rep4 one.
 *
 * So a redaction gate built on the CURRENT shared vocabulary could not catch
 * the sentence that actually leaked. Shipping one would be exactly the
 * guarantee-theatre class this arc exists to close: a gate that reads as a gate
 * and stops nothing.
 *
 * THE ASYMMETRY IS DELIBERATE AND IS ABOUT COST, NOT ABOUT TASTE:
 *
 *   ALARM / ENFORCER (`textNamesLeadingOption` / `textAssertsLeadingOption`)
 *     act on EGRESS. A false positive there either pollutes the residue
 *     telemetry that sizes this whole defect class, or — on the enforcement
 *     readers — DELETES a correct answer the user is entitled to. Those readers
 *     are deliberately precise, and `textAssertsLeadingOption` even blanks
 *     documented false-positive spans ("leads to", "team leads") first.
 *   THIS READER acts on the model's INPUT, and only on PRIOR-TURN assistant
 *     prose. A false positive costs one redacted history sentence — a little
 *     conversational context on a turn where the ranking is withheld anyway.
 *     It deletes nothing the user wrote, nothing on the wire, and nothing from
 *     storage. Bias WIDE.
 *
 * NOT A FORK — A STRICT SUPERSET, BY CONSTRUCTION. {@link historyAssertsLeaderClaim}
 * is `textNamesLeadingOption(s) || HISTORY_WIDE_PATTERNS.some(...)`. It CALLS the
 * shared reader rather than re-listing its patterns, so a phrasing added to the
 * shared vocabulary is in this reader the same day, with no mirror to sync
 * (CLAUDE.md trap #12). The extra family below covers only what the shared set
 * is measurably blind to.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THREE DESIGNS THAT WERE WEIGHED, AND WHY THIS ONE.
 *
 *   (a) SENTENCE-LEVEL redaction of `assistant_message` with a wide vocabulary
 *       — chosen. It removes the ordering claims and keeps everything else the
 *       coach needs to hold a conversation (what the user asked, what was
 *       blocked, which factor is unverified). Its weakness is vocabulary
 *       blindness, and that weakness is bounded by biasing wide and by the
 *       non-vacuity probe below, which fails the module at load if the reader
 *       stops seeing the phrasings that ACTUALLY leaked.
 *   (b) TURN-LEVEL gating — drop `assistant_message` whole for prior turns of
 *       an analysis class. Content-independent, therefore immune to vocabulary
 *       blindness. REJECTED as the primary mechanism for two reasons, both
 *       derived rather than aesthetic: the leaking turns on `f63ccb45` are
 *       `coach`/`converse` answers, not `run_analysis` handler turns, so
 *       "analysis-class" would have to be a hand-kept turn_class/handler_id
 *       list — the mirror of trap #12, with the leaking class already outside
 *       it; and dropping whole answers destroys the reference resolution
 *       ("the second one", "do that") that `recent_turns` exists for.
 *   (c) HYBRID — this module IS the hybrid, in the one respect that matters.
 *       The CONTENT test is (a); the SCOPE is (b)'s content-independent half:
 *       EVERY prior assistant message in the window is examined on a withheld
 *       turn, regardless of turn class, handler id or age. There is no
 *       class list to drift.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ PROJECTION-SIDE ONLY. This module is PURE and touches no store. The
 * persisted `v5_conversation_turns` rows are never mutated, never rewritten and
 * never deleted — the redaction exists only in the pack handed to the model on
 * a turn whose verdict withholds. A permitted turn reads the same rows back
 * BYTE-IDENTICAL. Rewriting history in the database would destroy the audit
 * trail of what the product actually said to a user, which is the one artefact
 * that makes a leak investigable at all.
 */

import type {
  ContextPackConversation,
  ContextPackConversationTurn,
} from './context-pack-assembler.js';
import { textNamesLeadingOption } from '../compose/leading-option-egress-guard.js';
import {
  splitIntoRedactableUnits,
  replaceAssertingUnits,
} from '../compose/redactable-units.js';
import type { ContextPackConversationSummary } from '../rolling-summary/inject.js';
import {
  ROLLING_SUMMARY_SLOTS,
  ROLLING_SUMMARY_SLOT_LABELS,
} from '../rolling-summary/summary-types.js';

/**
 * The neutral stand-in for one redacted history sentence.
 *
 * SAYS WHAT IS ABSENT AND WHY, and nothing about the result. Never-silent, for
 * the same reason the withheld input note is: a hole in a prior answer invites
 * the model either to reconstruct it or to tell the user their history is
 * missing. It carries no option label, no number and no verdict jargon.
 *
 * ⚠ THE WORDING IS CONSTRAINED FROM BOTH SIDES, and both constraints are
 * checked at module load ({@link assertMarkerIsInert}):
 *   1. it must not trip the shared ALARM vocabulary — otherwise the input gate
 *      would inject the exact residue the output alarm measures, on every
 *      withheld turn with history, and the only symptom would be an alarm rate
 *      nobody had a reason to look at (the same trap
 *      `withheld-leader-projection.ts` records hitting with "out in front");
 *   2. it must not trip THIS module's own wider reader — otherwise redaction
 *      would not be idempotent, and a marker would be re-redacted into a
 *      marker-of-a-marker the first time a pack was projected twice.
 */
export const WITHHELD_HISTORY_REDACTION_MARKER =
  '[prior discussion of analysis results omitted while the result is re-checked]';

/**
 * The phrasings the SHARED vocabulary is measurably blind to, plus the ordering
 * and margin idioms an ordinary answer reaches for.
 *
 * ⚠ EVERY ENTRY HAS A REASON, AND THE FIRST FOUR HAVE A MEASUREMENT. This is
 * not a speculative widening: `WALK-HISTORIC-PREP-2026-07-27.md` §10 scored the
 * live leak text at ZERO hits under `LEADER_CLAIM_PATTERNS`.
 *
 * Deliberately NOT anchored to option labels. A history sentence naming an
 * option AND asserting an ordering is the target, but requiring the label would
 * need the option roster at redaction time — a second derivation of "who is
 * leading" beside the verdict, which is how one response ends up contradicting
 * itself (trap #12). The ORDERING CLAIM alone is the trigger.
 */
const HISTORY_WIDE_PATTERNS: ReadonlyArray<{ readonly code: string; readonly re: RegExp }> = [
  /**
   * ⭐ THE ONE THAT CAUGHT THE LIVE LEAK. `\bleads\b` is present-tense only;
   * the leaking sentence is "previously **led** by 17 points". The whole
   * inflection family is taken, including the bare participle "leading" that
   * `leading_option` / `leading_in` both require a following word for.
   *
   * This DELIBERATELY re-catches "leads to" and "team leads", which
   * `textAssertsLeadingOption` carves out for ENFORCEMENT. That carve-out
   * exists because the enforcer deletes user-facing content; this reader
   * redacts one sentence of prior-turn context on a turn where the ranking is
   * withheld. The cost is not comparable and the bias is therefore opposite.
   */
  { code: 'lead_any_inflection', re: /\b(?:lead|leads|leading|led)\b/i },
  /**
   * "sits **ahead of** enterprise", "comes out ahead", "slightly ahead" — the
   * shared set requires a specific copula or adverb before `ahead`, and a bare
   * one is the common case in prose.
   *
   * `behind` is deliberately NOT bare: "the reasoning behind this" is ordinary
   * coaching English and carries no ordering. Only the positional idioms are
   * taken, including "close behind" — verbatim in the POST-#711/#712 live leak
   * ("…with Standardise on Dell XPS close behind at 34%").
   */
  {
    code: 'positional',
    re: /\b(?:ahead|in\s+front|front[-\s]?runner)\b|\b(?:falls?|fell|falling|sits?|sat|lags?|lagging|trails?|trailing|close|just|not\s+far)\s+behind\b/i,
  },
  /**
   * "the analysis **favours** Standardise on MacBook Pro" — the exact live
   * POST-#713 leak sentence, and absent from the shared set entirely.
   */
  { code: 'favour', re: /\bfavou?r(?:s|ed|ing|ite|ites|able)?\b/i },
  /**
   * "led **by 17 percentage points**" / "a 30 point margin" / "by 12pp". A
   * margin is a statement ABOUT an ordering — the same reasoning that drops
   * `margin` from the model-facing analysis in
   * `context/withheld-leader-projection.ts`. The numeric form is required for
   * the bare `points` variant so an ordinary "three points to consider" is not
   * swept up.
   */
  { code: 'margin', re: /\bmargins?\b/i },
  { code: 'percentage_points', re: /\bpercentage\s+points?\b/i },
  {
    code: 'numeric_gap',
    re: /\bby\s+(?:about\s+|around\s+|roughly\s+|some\s+)?\d+(?:\.\d+)?\s*(?:pp\b|%|per\s?cent|percent|percentage\s+points?|points?\b)/i,
  },
  /**
   * Comparative verbs and superlative designations. `winner(s)` is already in
   * the shared set; a bare `win` / `wins` / `winning` is not, and "this isn't a
   * strong SMB win, it's a fragile one" is verbatim in `f63ccb45`'s stored
   * history.
   *
   * ⚠ THE NEGATIVE LOOKAHEAD IS LOAD-BEARING AND IS NOT A STYLE CHOICE.
   * "Sales Win Rate" is a FACTOR NAME on the very scenario that leaks, and
   * "win probability" is a computed value the withheld doctrine explicitly
   * KEEPS (designation vs data). Sweeping either would redact the sentence that
   * names the blocker — the one piece of content a withheld turn most needs.
   */
  {
    code: 'win_family',
    re: /\bwin(?:s|ning)?\b(?!\s+(?:rate|probabilit|chance|condition|percentage))/i,
  },
  { code: 'beats', re: /\b(?:beats?|beating|outperform(?:s|ed|ing)?|edges?\s+out)\b/i },
  { code: 'comparative_than', re: /\b(?:stronger|weaker|better|worse|higher|lower)\s+than\b/i },
  {
    code: 'superlative_option',
    re: /\b(?:best|strongest|top|preferred|safest|optimal)\s+(?:option|choice|bet|pick|candidate|performer|route|path)\b/i,
  },
  /**
   * The user-facing shorthand for a designation the product itself uses:
   * "your stored **lean**", "the current **pick**", "which one **wins**".
   * `lean` is the live rep4 sentence's own noun in the base sample.
   */
  { code: 'stored_lean', re: /\bleans?\s+(?:towards?|toward)\b|\bstored\s+lean\b/i },
];

/**
 * Does ONE string assert an ordering between options, for the purposes of
 * REDACTING IT FROM THE MODEL'S INPUT?
 *
 * A STRICT SUPERSET of the shared alarm reader, by CALLING it rather than by
 * copying its patterns — so a phrasing added to `LEADER_CLAIM_PATTERNS` is in
 * this reader on the same commit, with no list to keep in step (CLAUDE.md trap
 * #12: derive, don't mirror). {@link assertReaderIsAStrictSuperset} pins the
 * direction at module load.
 *
 * Every pattern is non-global, so `.test` carries no `lastIndex` state.
 */
export function historyAssertsLeaderClaim(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (textNamesLeadingOption(value)) return true;
  return HISTORY_WIDE_PATTERNS.some(({ re }) => re.test(value));
}

/**
 * Redact the ordering claims from ONE prior-turn assistant message.
 *
 * `null` in ⇒ `null` out. A message with no ordering claim is returned
 * BYTE-IDENTICAL — the same reference, so a caller can compare by identity.
 * That is the anti-over-suppression property, and it is the arm the acceptance
 * criteria weight equally with the leak.
 *
 * CONSECUTIVE MARKERS COLLAPSE. An answer that is wall-to-wall ordering claims
 * would otherwise become a wall of identical markers — noise that reads as a
 * malfunction and eats budget. One marker per contiguous redacted run.
 *
 * ⚠ NEVER RETURNS EMPTY FOR A NON-EMPTY STRING INPUT, and a second consumer now
 * DEPENDS on that. A redacted unit is REPLACED by the marker, never deleted —
 * so a message that is wall-to-wall ordering claims redacts to the marker, not
 * to `''`. The rolling-summary gate rests on this: an emptied slot would render
 * as `(none)`, which the injector documents as "the summariser looked and found
 * none" — an affirmative claim that no settled history exists, i.e. the exact
 * lying-coverage class `retention.ts` was written to stop. Pinned at module load
 * by {@link assertRedactionNeverEmpties}.
 *
 * PURE. Never throws, never mutates.
 *
 * ⚠ THE MECHANICS MOVED, THE PROPERTIES DID NOT (ROADMAP 2.149). The splitter
 * and the replace-and-collapse loop now live in `compose/redactable-units.ts`
 * because the WIRE gate needs the identical three properties (lossless split,
 * byte-identity on clean prose, never-empties) with a different per-unit reader
 * and a different replacement string. Two copies of this loop is exactly the
 * hand-maintained mirror of CLAUDE.md trap #12, so there is one. The four
 * module-load probes at the bottom of THIS file are unchanged and now certify
 * the shared implementation.
 */
export function redactLeaderClaimsFromHistoryMessage(message: string | null): string | null {
  if (message === null || typeof message !== 'string' || message.length === 0) return message;
  return replaceAssertingUnits(
    message,
    historyAssertsLeaderClaim,
    WITHHELD_HISTORY_REDACTION_MARKER,
  );
}

/**
 * Project ONE prior turn for a withheld turn.
 *
 * ⚠ ONLY `assistant_message` IS TOUCHED, and the omission is a decision, not an
 * oversight. `user_message` is the USER'S OWN WORDS. CEE's doctrine is that it
 * must not ASSERT a ranking it has declined to stand behind; a user typing "so
 * SMB is ahead then?" is not CEE making that claim, redacting it would break the
 * reference resolution `recent_turns` exists for, and it would make the coach
 * blind to the very question it is being asked. It is also not the
 * self-reinforcing half: only the ASSISTANT side is written by the model and fed
 * back to the model. The residual is stated in the PR body rather than hidden
 * behind a green test.
 *
 * Returns the SAME OBJECT when nothing was redacted, so an untouched window is
 * untouched by identity and not merely by value.
 */
export function projectConversationTurnForWithheldClaim(
  turn: ContextPackConversationTurn,
): ContextPackConversationTurn {
  const redacted = redactLeaderClaimsFromHistoryMessage(turn.assistant_message);
  if (redacted === turn.assistant_message) return turn;
  return { ...turn, assistant_message: redacted };
}

/**
 * Project the whole `conversation` section for a turn whose verdict WITHHOLDS.
 *
 * The caller owns the permission (`mayNameLeadingOption === false`) and this
 * function assumes it — it does not re-derive the verdict, so the permission and
 * the input it governs describe the same turn (CLAUDE.md trap #12).
 *
 * EVERY turn in the window is examined, regardless of `turn_class` or
 * `handler_id`. That is the content-independent half of the design: there is no
 * class allow-list to go stale, and the turns that actually leaked on
 * `f63ccb45` were coach/converse answers that any such list would have missed.
 *
 * `turn_count`, `last_tool_used` and the `window` disclosure are untouched: they
 * carry no ordering claim, and the window disclosure's honesty about how much
 * history exists is exactly the content a withheld turn still needs.
 *
 * Returns the SAME OBJECT when no turn changed — byte-identity for a
 * leader-free history is a derivation, not a hope.
 *
 * PURE. Never throws, never mutates its input, never touches storage.
 */
export function projectConversationForWithheldClaim(
  conversation: ContextPackConversation,
): ContextPackConversation {
  const projected = conversation.recent_turns.map(projectConversationTurnForWithheldClaim);
  const changed = projected.some((turn, i) => turn !== conversation.recent_turns[i]);
  if (!changed) return conversation;
  return { ...conversation, recent_turns: projected };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FIFTH CHANNEL — the ROLLING SUMMARY (`ContextPack.conversation_summary`).
//
// The same defect, one layer up. `scenarios.rolling_summary` is a haiku-written
// digest of the conversation, and the summariser RECORDED the leader claim into
// it. Live read on scenario `f63ccb45`, the `RESOLVED` slot, verbatim:
//
//   "Current analysis shows Double Down on SMB leading 52% vs Enterprise 35%,
//    but result is fragile and sensitive to sales win rate assumptions."
//
// …three sentences above that same summary's own "No ranking can be put
// forward…". The stored summary CONTRADICTS ITSELF, and `inject.ts` renders the
// whole four-slot block into `conversation_summary.text`, which `buildUserMessage`
// serialises into the routing prompt beside an instruction to treat it as the
// conversation's working notes. Nothing on that path consulted the verdict.
//
// ⚠ MEASURED, NOT SUPPOSED, AND IT IS THE SAME MEASUREMENT THAT FORCED #724'S
// READER: `textNamesLeadingOption` scores that sentence FALSE — `\bleads\b` is
// present-tense and this is the bare participle "leading 52%", which
// `leading_option` and `leading_in` both require a following word for. The
// shared alarm is blind to the string sitting in the live summary; the wider
// reader above catches it on `lead_any_inflection`. A gate built on the shared
// vocabulary would have been theatre here too.
//
// ⭐ WHY THIS IS A PROJECTION AND NOT A SUMMARISER FIX (A1's ruling). The whole
// arc gates PROJECTIONS and never mutates stored data — the persisted summary is
// the audit trail of what the product actually recorded, and rewriting it is how
// a leak becomes uninvestigable. Whether the summariser should record leader
// claims AT ALL is a separate, larger question (it is a summariser-contract
// change with its own blast radius, and it cannot help the summaries already
// stored); it is assessed in the PR body as a follow-up, deliberately not
// implemented here.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The rendered slot-line prefixes, DERIVED from the injector's own label
 * vocabulary rather than re-listed (CLAUDE.md trap #12).
 *
 * `inject.ts` renders exactly `${ROLLING_SUMMARY_SLOT_LABELS[slot]}: ${content}`,
 * one line per slot, in `ROLLING_SUMMARY_SLOTS` order. Splitting the label off
 * before redacting is what makes "never make the block unparseable" a
 * DERIVATION: the label bytes are never handed to the reader, so no pattern can
 * ever consume one, and the line count is invariant under projection.
 */
const SUMMARY_SLOT_LINE_PREFIXES: readonly string[] = Object.freeze(
  ROLLING_SUMMARY_SLOTS.map((slot) => `${ROLLING_SUMMARY_SLOT_LABELS[slot]}: `),
);

/**
 * Redact the ordering claims out of ONE rendered four-slot block.
 *
 * ⚠ THE FOUR-SLOT CONTRACT IS PRESERVED BY CONSTRUCTION, THREE WAYS:
 *
 *   1. LABELS ARE NEVER TOUCHED. Each line is split at its known prefix and
 *      only the CONTENT is redacted, so `RESOLVED:` cannot be eaten by a
 *      pattern that happened to match across it.
 *   2. THE LINE COUNT IS INVARIANT. Redaction is per-line and lossless-joined,
 *      so a four-line block stays a four-line block (five with the
 *      `history_capped` disclosure).
 *   3. NO SLOT CAN BECOME EMPTY. A redacted unit is REPLACED by the marker, so
 *      even a slot whose every sentence is an ordering claim renders
 *      `RESOLVED: [prior discussion …]` — never `RESOLVED: (none)`. That
 *      distinction is load-bearing and is not cosmetic: `inject.ts` documents
 *      the bare `(none)` on a non-floor summary as "the summariser looked and
 *      found none", so emptying a slot would make this gate MINT the affirmative
 *      false claim that no settled history exists — the lying-coverage class,
 *      reintroduced by the fix for a different one. Pinned at module load.
 *
 * A line matching no known prefix (only the `history_capped` disclosure today)
 * is redacted whole, as ordinary prose. That is the safe default: an
 * unrecognised line is content, and content is what this gate exists to check.
 *
 * PURE. Byte-identical (same reference) when no line carried a claim.
 */
export function redactLeaderClaimsFromSummaryBlock(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let changed = false;
  const lines = text.split('\n').map((line) => {
    const prefix = SUMMARY_SLOT_LINE_PREFIXES.find((p) => line.startsWith(p));
    const body = prefix === undefined ? line : line.slice(prefix.length);
    // `?? body` is a type narrowing, not a fallback: the redactor returns null
    // only for a null input, and `body` is always a string here.
    const redacted = redactLeaderClaimsFromHistoryMessage(body) ?? body;
    if (redacted !== body) changed = true;
    return prefix === undefined ? redacted : `${prefix}${redacted}`;
  });
  return changed ? lines.join('\n') : text;
}

/**
 * Project the `conversation_summary` section for a turn whose verdict WITHHOLDS.
 *
 * The caller owns the permission and this function assumes it — it does not
 * re-derive the verdict, so the permission and the input it governs describe the
 * same turn (CLAUDE.md trap #12).
 *
 * ONLY `text` IS TOUCHED. `current_to_turn_id`, `lag_turns` and `stale` are
 * structural metadata carrying no ordering claim, and `note` is CEE'S OWN
 * authored copy (the staleness / floor / memory-hole disclosures) — constants
 * written by this repo, not model output, and redacting them would degrade the
 * honesty disclosures this section exists to carry. The memory-hole refusal path
 * already ships `text: ''`, which this leaves untouched.
 *
 * Returns the SAME OBJECT when nothing changed — byte-identity for a
 * leader-free summary is a derivation, not a hope.
 *
 * PURE. Never throws, never mutates, never touches storage.
 */
export function projectConversationSummaryForWithheldClaim(
  summary: ContextPackConversationSummary,
): ContextPackConversationSummary {
  const redacted = redactLeaderClaimsFromSummaryBlock(summary.text);
  if (redacted === summary.text) return summary;
  return { ...summary, text: redacted };
}

/**
 * BUILD-TIME PROBE 1 — the marker this gate INJECTS must be inert under BOTH
 * readers.
 *
 * Same mechanism and rationale as
 * `context/withheld-leader-projection.ts`'s `assertInjectedNoteIsLeaderFree` and
 * `compose/withheld-claim-projection.ts`'s
 * `assertWithheldAnalysisSummaryIsLeaderFree`.
 *
 *   vs the ALARM  — a marker that tripped `LEADER_CLAIM_PATTERNS` would inject
 *                   the exact residue the output alarm measures into every
 *                   withheld prompt carrying history.
 *   vs THIS reader — a marker that tripped the wider set would not be
 *                   IDEMPOTENT: projecting an already-projected pack would
 *                   redact the marker into another marker.
 *
 * Runs at module load and throws, so a violation fails the process at startup
 * and every test that imports the seam (CLAUDE.md trap #12: a mirror must fail
 * loud, never assume-good).
 */
function assertMarkerIsInert(): void {
  if (textNamesLeadingOption(WITHHELD_HISTORY_REDACTION_MARKER)) {
    throw new Error(
      'withheld-history-redaction: WITHHELD_HISTORY_REDACTION_MARKER trips the shared leader ' +
        'vocabulary (compose/leading-option-egress-guard.ts LEADER_CLAIM_PATTERNS). The input ' +
        'gate would inject the exact residue the output alarm measures, on every withheld turn ' +
        'that carries history. Reword the marker — do not narrow the pattern set, which is ' +
        'shared with the alarm.',
    );
  }
  if (historyAssertsLeaderClaim(WITHHELD_HISTORY_REDACTION_MARKER)) {
    throw new Error(
      'withheld-history-redaction: the marker trips this module\'s own reader, so redaction is ' +
        'not idempotent — a re-projected pack would replace the marker with a marker. Reword it.',
    );
  }
  // Idempotence, exercised rather than argued: redacting the marker is a no-op.
  if (redactLeaderClaimsFromHistoryMessage(WITHHELD_HISTORY_REDACTION_MARKER) !==
    WITHHELD_HISTORY_REDACTION_MARKER) {
    throw new Error(
      'withheld-history-redaction: redaction is not idempotent on its own marker.',
    );
  }
}

/**
 * BUILD-TIME PROBE 2 — NON-VACUITY, against the sentences that ACTUALLY LEAKED.
 *
 * ⭐ THIS IS THE PROBE THAT MATTERS, and it exists because the obvious
 * implementation of this gate — reuse the shared vocabulary — CANNOT catch the
 * live leak. `WALK-HISTORIC-PREP-2026-07-27.md` §10 scored the rep4 sentence at
 * ZERO hits under `LEADER_CLAIM_PATTERNS`. A gate that cannot see the string
 * that leaked is guarantee theatre (CLAUDE.md trap 13: an absence assertion must
 * first prove it can see a PRESENCE).
 *
 * The corpus is the LIVE TEXT, verbatim from the archive, not a paraphrase — a
 * paraphrase would prove that the reader catches what its author was thinking
 * about while writing it, which is the one thing that never fails.
 */
const LIVE_LEAK_CORPUS: readonly string[] = Object.freeze([
  // build b35d09de, phase-post-b35d09de-rep4/c5 — ZERO shared-vocabulary hits.
  'Double down on SMB previously led by 17 points, flagged fragile on this exact assumption from the first run.',
  // build b35d09de, phase-post-b35d09de/c5 — shared vocabulary saw this one.
  'Your stored lean is Double down on SMB, ahead by 17 percentage points, but that lean was flagged fragile from the first run and stays that way until checked.',
  // f63ccb45 stored history, the ORIGINAL 2026-07-13 user session (§10.3).
  'Double Down on SMB currently leads by 17 percentage points, but treat this as provisional.',
  "This isn't a strong SMB win, it's a fragile one.",
  // The POST-#713 walk's case5.clarify leak — the `favours` phrasing.
  'The analysis currently favours Standardise on MacBook Pro, with a probability of 56%.',
  // c6's stored history (§10.3) — the control target that never leaked, whose
  // history is nevertheless full of the input this gate removes.
  'Increase Engineering Budget currently leads by 39 percentage points.',
]);

/**
 * Prose that must SURVIVE. The over-suppression arm of the probe: a reader that
 * redacts everything is as useless as one that redacts nothing, and the failure
 * would be invisible because the leak test would still pass.
 */
const MUST_SURVIVE_CORPUS: readonly string[] = Object.freeze([
  'The connection from sales win rate to revenue growth is still unverified against real pipeline numbers.',
  'What would firm this up is real enterprise figures from your pipeline.',
  'You have asked this several times now, and the blocker has not changed.',
  'Is the hesitation about how reversible the enterprise move is once you start?',
]);

function assertReaderSeesTheLiveLeakAndSparesOrdinaryProse(): void {
  for (const sentence of LIVE_LEAK_CORPUS) {
    if (!historyAssertsLeaderClaim(sentence)) {
      throw new Error(
        'withheld-history-redaction: the reader does not see a sentence that LEAKED ON LIVE ' +
          `STAGING — ${JSON.stringify(sentence.slice(0, 80))}. The gate is inert against the ` +
          'defect it exists to close. Widen HISTORY_WIDE_PATTERNS; do not soften this probe.',
      );
    }
    if (redactLeaderClaimsFromHistoryMessage(sentence) === sentence) {
      throw new Error(
        'withheld-history-redaction: the reader SEES a live leak sentence but the redactor ' +
          `returns it unchanged — ${JSON.stringify(sentence.slice(0, 80))}. The splitter and the ` +
          'reader disagree; a hit that produces no redaction is theatre.',
      );
    }
  }
  for (const sentence of MUST_SURVIVE_CORPUS) {
    if (historyAssertsLeaderClaim(sentence)) {
      throw new Error(
        'withheld-history-redaction: the reader flags ordinary coaching prose — ' +
          `${JSON.stringify(sentence.slice(0, 80))}. Over-suppression is weighted equally with ` +
          'the leak; narrow the offending pattern.',
      );
    }
  }
}

/**
 * BUILD-TIME PROBE 3 — the reader really is a STRICT SUPERSET of the shared one,
 * and the splitter really is LOSSLESS.
 *
 * The superset property is what lets this module widen the vocabulary without
 * forking it. It holds by construction (the `||` in
 * {@link historyAssertsLeaderClaim}), and it is exercised anyway: a future edit
 * that "optimises" the call away into a copied pattern list would keep
 * compiling and would silently reintroduce the mirror.
 *
 * The lossless-split property is what makes "no claim ⇒ byte-identical" a
 * derivation. A splitter that dropped a space would make every history message
 * differ from its input, and the over-suppression control would be measuring a
 * different thing than it claims.
 */
function assertSupersetAndLosslessSplit(): void {
  const sharedOnly = 'The MacBook Pro comes out ahead, leading in 44% of simulations.';
  if (!textNamesLeadingOption(sharedOnly) || !historyAssertsLeaderClaim(sharedOnly)) {
    throw new Error(
      'withheld-history-redaction: historyAssertsLeaderClaim is no longer a superset of the ' +
        'shared alarm reader. It must CALL textNamesLeadingOption, never copy its patterns.',
    );
  }
  const sample =
    'Line one has no claim.  Line one continues.\n\n• A bullet, with no claim either.\nTrailing line without terminal punctuation';
  if (splitIntoRedactableUnits(sample).join('') !== sample) {
    throw new Error(
      'withheld-history-redaction: splitIntoRedactableUnits is lossy. The byte-identity ' +
        'guarantee for leader-free history rests on join(units) === input.',
    );
  }
  if (redactLeaderClaimsFromHistoryMessage(sample) !== sample) {
    throw new Error(
      'withheld-history-redaction: leader-free prose was altered. Byte-identity on a ' +
        'claim-free message is the anti-over-suppression property.',
    );
  }
}

/**
 * BUILD-TIME PROBE 4 — REDACTION NEVER EMPTIES, and the FOUR-SLOT BLOCK STAYS
 * STRUCTURALLY INTACT.
 *
 * ⭐ THE PROPERTY THE ROLLING-SUMMARY GATE RESTS ON, exercised rather than
 * argued. Every sentence that actually leaked is redacted to a NON-EMPTY string
 * containing the marker. A future "optimisation" that dropped a claim unit
 * instead of replacing it would keep compiling, would keep every leak assertion
 * green, and would silently start rendering `RESOLVED: (none)` on withheld turns
 * — an affirmative claim that no settled history exists, minted by the gate.
 *
 * The block arm is a real four-slot render (the shape `inject.ts` produces) with
 * a slot whose ENTIRE content is an ordering claim — the worst case — and it
 * pins that the labels, the line count and the slot order all survive.
 */
function assertRedactionNeverEmpties(): void {
  for (const sentence of LIVE_LEAK_CORPUS) {
    const redacted = redactLeaderClaimsFromHistoryMessage(sentence);
    if (redacted === null || redacted.length === 0) {
      throw new Error(
        'withheld-history-redaction: redaction EMPTIED a non-empty message — ' +
          `${JSON.stringify(sentence.slice(0, 80))}. A redacted unit must be REPLACED by the ` +
          'marker, never deleted: the rolling-summary gate would otherwise render an emptied ' +
          'slot as "(none)", which the injector documents as an affirmative "found none".',
      );
    }
    if (!redacted.includes(WITHHELD_HISTORY_REDACTION_MARKER)) {
      throw new Error(
        'withheld-history-redaction: a redacted message carries no marker — the redaction is ' +
          'silent, and a hole in prior context invites the model to reconstruct it.',
      );
    }
  }

  // The worst case for the block: RESOLVED is nothing but an ordering claim.
  const block = [
    'DECISION FRAME: Whether to double down on SMB or move upmarket.',
    'CONSTRAINTS & PREFERENCES: Keep the existing team. [t:f63ccb45]',
    'RESOLVED: Double Down on SMB is leading. [t:f63ccb45]',
    'OPEN: Is the sales win rate link verified?',
  ].join('\n');
  const projected = redactLeaderClaimsFromSummaryBlock(block);
  const before = block.split('\n');
  const after = projected.split('\n');
  if (after.length !== before.length) {
    throw new Error(
      'withheld-history-redaction: projecting a four-slot block changed the LINE COUNT ' +
        `(${before.length} → ${after.length}). The block would no longer render as four slots.`,
    );
  }
  for (const [i, prefix] of SUMMARY_SLOT_LINE_PREFIXES.entries()) {
    if (!after[i]!.startsWith(prefix)) {
      throw new Error(
        `withheld-history-redaction: slot line ${i} lost its label — expected the projected ` +
          `block to still start line ${i} with ${JSON.stringify(prefix)}, got ` +
          `${JSON.stringify(after[i]!.slice(0, 40))}. Redaction must never consume a slot label.`,
      );
    }
  }
  const resolved = after[ROLLING_SUMMARY_SLOTS.indexOf('RESOLVED')]!;
  if (resolved.includes('leading')) {
    throw new Error(
      'withheld-history-redaction: the ordering claim survived the block projection. The gate ' +
        'is inert against the content it exists to remove.',
    );
  }
  if (resolved.includes('(none)')) {
    throw new Error(
      'withheld-history-redaction: a fully-redacted slot rendered as "(none)". The injector ' +
        'documents the bare marker on a non-floor summary as "the summariser looked and found ' +
        'none" — this gate would be MINTING that affirmative claim. It must render the marker.',
    );
  }
  if (!resolved.includes(WITHHELD_HISTORY_REDACTION_MARKER)) {
    throw new Error(
      'withheld-history-redaction: a fully-redacted slot carries no marker — the absence is ' +
        'silent, which is the one thing the four-slot block must never be.',
    );
  }
  // Byte-identity for a claim-free block — the over-suppression arm, and the
  // property that makes a permitted-vs-withheld comparison meaningful.
  const clean = [
    'DECISION FRAME: Whether to double down on SMB or move upmarket.',
    'CONSTRAINTS & PREFERENCES: Keep the existing team. [t:f63ccb45]',
    'RESOLVED: (none)',
    'OPEN: Is the sales win rate link verified?',
  ].join('\n');
  if (redactLeaderClaimsFromSummaryBlock(clean) !== clean) {
    throw new Error(
      'withheld-history-redaction: a claim-free four-slot block was altered. Byte-identity on ' +
        'claim-free content is the anti-over-suppression property.',
    );
  }
}

assertMarkerIsInert();
assertReaderSeesTheLiveLeakAndSparesOrdinaryProse();
assertSupersetAndLosslessSplit();
assertRedactionNeverEmpties();
