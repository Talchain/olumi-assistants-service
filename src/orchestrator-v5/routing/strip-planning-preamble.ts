/**
 * ⭐⭐ THE MODEL'S PLANNING MONOLOGUE IS SHIPPING AS THE USER-FACING ANSWER.
 *
 * ── WITNESSED, VERBATIM, IN A USER'S CHAT WINDOW ───────────────────────────
 *   "The user wants two things: change a factor value, and then see what it
 *    does to the comparison. Per rule 9 (one action per turn), I'll handle the
 *    value change first…"
 *
 *   "The user wants me to fill in the open encoding items myself. … rule 9 says
 *    one action per turn. I need to pick the single most useful one…"
 *
 * Third-person references to the user, and an internal system-prompt rule cited
 * by number. Reported in 5 of 7 evaluation briefs.
 *
 * ── WHY IT HAPPENS (derived, 29 Aug 2026, at `de254398`) ───────────────────
 * `route-with-tool-use.ts:1006-1007` names EVERY Anthropic `text` block
 * "orientation" by fiat:
 *
 *     const textBlocks = result.content.filter(b => b.type === 'text');
 *     const joinedText = textBlocks.map(b => b.text).join('\n').trim();
 *
 * and `compose.ts:353-355` makes that string the FIRST PARAGRAPH the user reads
 * on every mutation and run turn. Nothing between the two discriminates
 * pre-action orientation from deliberation. Swept for a stripper — `sanitise.ts`
 * (tags, dashes, schema tokens), `forbidden-user-facing-phrases.ts` (denials,
 * `orchestrator`, `tool call`), `output-safety.ts` (entity slugs),
 * `forbidden-tokens.ts` — **none matches either signature.** There was no
 * planning stripper in the estate.
 *
 * Rule 9 is real and is the SERVED prompt, not a stale copy:
 * `Prompts/canonical/routing.txt:20` — *"9. ONE ACTION PER TURN…"*, manifest
 * `served_version: 120`, `served_hash_verified: true`. The bundled fallback
 * `Prompts/v40.txt:58` numbers the same rule **6**, so a user who sees "rule 9"
 * is reading the served prompt. The prompt tells the model its pre-tool-call
 * text "is not shown" / "can be dropped" on three of four families — an open
 * invitation to use it as a scratchpad — while the code ships it verbatim on
 * the fourth.
 *
 * ── THE TRUNCATION IS THE SAME DEFECT, NOT A SECOND ONE ────────────────────
 * The brief asked this be tested rather than assumed. It holds. A reply ending
 * mid-thought on *"Here's my reasoning for each:"* is not a character cap —
 * there is none on `assistant_text` on this path — and not a token cap:
 * `route-with-tool-use.ts:984-993` DISCARDS the response on
 * `stop_reason === 'max_tokens'` rather than shipping a partial. An Anthropic
 * `text` block simply ENDS where the `tool_use` block begins. The fragment is a
 * planning preamble cut at the moment the model switched to the tool call. So
 * removing the preamble removes the mid-thought endings too: one defect, one
 * fix.
 *
 * ── THE ROOT CAUSE IS UPSTREAM OF THIS FILE, AND IS NOT MINE TO CHANGE ─────
 * `config/index.ts:776` — `coachThinkingDisabled: booleanString.default(true)`,
 * wired at `route-with-tool-use.ts:661-663`. With adaptive thinking off, the
 * deliberation has no structured channel and lands in the plain `text` blocks.
 * The repo's OWN acceptance evidence predicted this and said do not flip:
 * `acceptance-evidence/latency-thinking-disable-2026-07-17/VERDICT.md:38-40` —
 * *"Reasoning leaking into the visible answer… raw deliberation can land in
 * `answer_text`"*. Flipping it back costs the ~9s-vs-~26s latency the flag was
 * taken for, so it is a product decision, not a lane's. **This module is
 * containment, not the cure.** Reported alongside the PR.
 *
 * ── FAILURE DIRECTION ──────────────────────────────────────────────────────
 * Applied only where an empty result is SAFE BY CONSTRUCTION:
 *   · the execute compose path — `compose.ts:355` pushes orientation only
 *     `if (trimmedOrientation)`, and the handler receipt is a separate piece;
 *   · the clarify path — `orientationText || clarification.question`, so an
 *     empty strip falls back to the deterministic question, which is better
 *     than the monologue that was displacing it.
 * NOT applied to the coach / converse `orientation_fallback`
 * (`turn-executor.ts:11307`, `:11476`) or to `text_only`, where the orientation
 * IS the whole answer and emptying it would ship a blank reply.
 *
 * So a false positive costs ONE sentence of decoration on a turn that still
 * carries its receipt; a false negative leaves the leak. Neither can mutate a
 * model or lose an edit.
 *
 * ── MARKER SET ─────────────────────────────────────────────────────────────
 * Only vocabulary that is INTERNAL BY CONSTRUCTION — a user cannot see the
 * numbered rules, and the product never refers to its reader in the third
 * person. Ordinary English that merely resembles planning is deliberately left
 * alone: this estate has burned four consecutive rounds on one natural-language
 * predicate (CLAUDE.md trap 22f), and a stripper is not the place to relearn it.
 *
 * ⛔ KNOWN NOT COVERED, and deliberately: *"I should offer concrete candidate
 * values"* — an announcement of content never delivered. It is ordinary English
 * with no internal marker, and no phrasing rule separates it from a legitimate
 * orientation sentence. Reported rather than guessed at.
 *
 * British English.
 */

/**
 * Sentence boundary that does NOT cut at a decimal point.
 *
 * ⚠ `£1.5 million` split on a bare `[.!?]` is how a magnitude guard was fed the
 * string `1` and could not fire (CLAUDE.md trap 22). The delimiter must be
 * followed by whitespace AND an opening character, which a decimal never is.
 */
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=["'([]?[A-Z])/;

/**
 * An internal system-prompt rule, cited by number. The user cannot see the
 * numbered rules, so any reference to one is deliberation that escaped.
 *
 * Both witnessed forms are covered: *"Per rule 9 (one action per turn), …"* and
 * *"rule 9 says one action per turn"*. Bare `rule 9` is NOT matched on its own —
 * a user's model may legitimately discuss a numbered rule of a real regulation.
 */
const RULE_CITATION_PATTERNS: readonly RegExp[] = [
  /\b(?:as\s+)?per\s+rules?\s+\d+\b/i,
  /\brules?\s+\d+\s+(?:says?|states?|requires?|means?|is\b|applies\b)/i,
  /\brules?\s+\d+\s*\(/i,
];

/**
 * The product speaking ABOUT its reader rather than TO them.
 *
 * Bound to a mental or communicative verb so a model legitimately containing
 * "the user" — a user-journey factor, a user-base estimate — is untouched.
 */
const THIRD_PERSON_USER_PATTERNS: readonly RegExp[] = [
  /\bthe\s+user\s+(?:wants?|is\s+asking|asked|asks|has\s+asked|needs?|would\s+like|is\s+trying|said|means|expects?)\b/i,
];

/**
 * Routing vocabulary that only exists inside the orchestrator's own frame.
 */
const ROUTING_SELF_TALK_PATTERNS: readonly RegExp[] = [
  /\bone\s+action\s+per\s+turn\b/i,
  /\bi\s+can\s+only\s+(?:route|dispatch|handle)\s+one\b/i,
];

const PLANNING_PATTERNS: readonly RegExp[] = [
  ...RULE_CITATION_PATTERNS,
  ...THIRD_PERSON_USER_PATTERNS,
  ...ROUTING_SELF_TALK_PATTERNS,
];

/** Exported so a spec can assert the marker set without re-deriving it. */
export function isPlanningText(text: string): boolean {
  return PLANNING_PATTERNS.some((p) => p.test(text));
}

/**
 * Remove the model's planning deliberation from pre-tool-call text.
 *
 * ⭐⭐ THE DECISION IS WHOLE-BLOCK, NOT PER-SENTENCE, AND THE FIRST DRAFT WAS
 * PER-SENTENCE AND WORSE. Filtering sentences left the unmarked residue of the
 * same monologue behind — *"I need to pick the single most useful one…"*,
 * *"Here's my reasoning for each:"* — so the user still read half a thought,
 * which is the defect. The claim this rests on is about the CHANNEL, not about
 * phrasing: on a mutation or run turn the model either ORIENTS ("I'll update
 * the target to £45k now") or NARRATES ITS PLAN. It does not do both in one
 * text block, and the witnessed leaks are 100% narration. So a single internal
 * marker condemns the block.
 *
 * Returns `''` when the block was deliberation — the correct result at both
 * call sites (see the failure-direction note above), and why this must NOT be
 * wired into a path where the orientation is the whole answer.
 */
export function stripPlanningPreamble(text: string): string {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  if (isPlanningText(trimmed)) return '';
  return dropDanglingAnnouncement(trimmed);
}

/**
 * ⭐ A SECOND, INDEPENDENT STRUCTURAL RULE — and it is a fact about this
 * channel, not a phrasing heuristic.
 *
 * An Anthropic `text` block ENDS where the `tool_use` block begins. So a block
 * whose last sentence ends in a colon announced a list that went into the TOOL
 * CALL and can never reach the user: *"Here's my reasoning for each:"* and then
 * nothing, which is exactly the reply the evaluation saw stop dead. The
 * announcement is not truncated prose to be recovered — its content is
 * structurally elsewhere.
 *
 * Scoped to the FINAL sentence only, so an ordinary mid-block colon
 * (*"Two things: I'll change the value, then re-run."*) is untouched.
 */
function dropDanglingAnnouncement(trimmed: string): string {
  if (!trimmed.endsWith(':')) return trimmed;
  const sentences = trimmed.split(SENTENCE_SPLIT);
  sentences.pop();
  return sentences.join(' ').trim();
}
