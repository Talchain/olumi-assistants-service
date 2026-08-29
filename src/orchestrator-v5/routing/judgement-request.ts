/**
 * ⭐⭐ "DO YOU ACTUALLY DISAGREE WITH ANYTHING I SAID?" — A REQUEST FOR OLUMI'S
 * OWN JUDGEMENT, AND NO DETERMINISTIC ARM HOLDS ONE.
 *
 * ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
 * Measured at `de254398` by executing the predicates (`.tmp/probe-routing.ts`,
 * 29 Aug 2026). A seven-brief evaluation ran an A/B on ONE scenario, one build,
 * one model:
 *
 *   user  → "Do you actually disagree with anything I said?"
 *   olumi → a FIGURE-ACCOUNTING AUDIT: "I found 8 stated figures. 0 of them are
 *           carried in the model…". Not one word of disagreement.
 *
 *   user  → "Argue the opposite case as strongly as you can."
 *   olumi → "The unit cost comparison may be measuring the wrong thing… the
 *           'highest unit cost' framing may be doing more persuasive work than
 *           it deserves…"   ← the capability, reached
 *
 * `isBriefAuditQuestion` returns TRUE on the first one. Traced at the bytes:
 * the AUDIT FRAME matches on `do you`, and the BRIEF REFERENT matches on
 * **"anything I said"** — a pattern written for *"did you keep what I told
 * you?"*, satisfied by the commonest phrase in ordinary English discourse. The
 * arm then claims the turn and answers with a manifest tally at `llm_calls: 0`.
 *
 * The same shape, one arm along:
 *
 *   user  → "Why is Enterprise ACV target in the model, and how confident are
 *            you in it?"
 *   olumi → "\"Enterprise ACV target\" was my suggestion, not something you
 *            wrote."   (67 characters, `llm_calls: 0`)
 *
 * `isStructureOriginQuestion` matches on `why is … in the model`, which is
 * correct — origin IS half of what was asked. The provenance record answers
 * that half and is silent on the other, and the arm returns unconditionally, so
 * the half it cannot answer is simply dropped. Reported failing 8 times out of
 * 8.
 *
 * ── THE QUESTION THIS MODULE ANSWERS (trap 21, written down first) ──────────
 * NOT "is this about the brief?" (that is `isBriefAuditQuestion`) and NOT "is
 * this about an element's origin?" (that is `isStructureOriginQuestion`).
 * Exactly one thing:
 *
 *   **Is the user asking Olumi for its OWN stance, opinion or evaluation?**
 *
 * Neither a not-modelled manifest nor a provenance stamp contains a judgement.
 * They are records of FACT — what survived, where it came from. So a message
 * that asks for one is, by construction, a message neither deterministic arm
 * can answer, whatever else it also asks for.
 *
 * ── WHY A BROAD PREDICATE IS SAFE HERE, AND WHY THAT IS UNUSUAL ─────────────
 * CEE #888 burned four consecutive rounds on one natural-language predicate,
 * each round fixing one direction and reopening the other, because the
 * predicate guarded TWO OPPOSITE HARMS under one window (CLAUDE.md trap 22b).
 * **That structure is absent here, and the absence is provable rather than
 * argued:**
 *
 *   · This predicate has exactly ONE consumer — `tryStateQueryGuard`, at the
 *     two ANSWERING arms — where its only effect is `{ matched: false }`.
 *   · `isStateQueryQuestionShape`, the PROTECTIVE predicate that denies a
 *     mutation warrant (`mutation-warrant.ts:1052`) and suppresses `edit_graph`
 *     dispatch (`route-v2.ts:4879`), **does not consult this module and is
 *     byte-identical to before.** Pinned by execution over the whole corpus in
 *     `judgement-request.test.ts` — not by inspection.
 *
 * So a false positive costs a FALL-THROUGH TO THE REASONING LAYER, and nothing
 * else. It cannot mutate a model, cannot lose a user's edit, and cannot stop a
 * genuine edit dispatching. The failure direction is UNIFORM, which is the one
 * condition under which widening a natural-language predicate is not a bet.
 *
 * And the fall-through is not a consolation prize: `structure-origin-answer.ts`
 * records that the reasoning-layer cell produced *"the best provenance answer
 * witnessed on either build"*, and the A/B above shows it answering the
 * challenge questions well when it is allowed to see them.
 *
 * ── THE ONE REAL COST, STATED RATHER THAN PAPERED OVER ──────────────────────
 * `brief-audit-answer.ts` exists because explanation layers *"re-read the brief
 * (or nothing) rather than the model"* (loss class 7). Declining a GENUINE
 * audit question to the LLM re-opens that. So the brief-audit arm applies this
 * predicate together with a second conjunct — `hasDispositionVerb` — and
 * declines only when the message attributes NO handling action to the system:
 *
 *   "Do you agree you left out my deadline?"  → `left out` → still AUDITED
 *   "Do you actually disagree with anything I said?" → no disposition → DECLINED
 *
 * The origin arm needs no such conjunct: its answer is a single provenance
 * sentence, and the reasoning layer is measured to answer origin questions at
 * least as well.
 *
 * ── SHAPE OF THE PATTERNS ──────────────────────────────────────────────────
 * Every stance pattern is anchored to a SECOND-PERSON frame (`you …`), so the
 * user asserting their own view ("I disagree with the framing") is not read as
 * asking for ours. Every evaluation pattern is anchored to an interrogative or
 * a modal, so a statement of fact ("the estimate is reliable") is not read as a
 * request to appraise one.
 *
 * British English.
 */

/**
 * Family 1 — STANCE. Does Olumi agree with, or object to, the user's material?
 *
 * The `(?:\w+\s+){0,3}` gap after `you` admits the adverbs and auxiliaries real
 * users type — *"do you **actually** disagree"*, *"have you **at any point**
 * pushed back"* — without letting the verb float free of the frame. Measured in
 * WORDS because the verb is the head of the frame's complement; it is a
 * grammatical claim, not a tuning knob (CLAUDE.md trap 22f is explicit that two
 * arbitrary length constants with hard cliffs is how the four-round oscillation
 * happened).
 */
const STANCE_PATTERNS: readonly RegExp[] = [
  // "do you actually disagree", "would you disagree", "you agree with all that"
  /\byou\s+(?:\w+\s+){0,3}(?:dis)?agree\b/i,
  // "have you pushed back on anything I said", "would you push back"
  /\byou\s+(?:\w+\s+){0,3}push(?:ed|ing)?\s+back\b/i,
  // "do you object to any of it", "did you take issue with the framing"
  /\byou\s+(?:\w+\s+){0,3}(?:object(?:ed)?\s+to|took?\s+issue\s+with)\b/i,
  // "what would you challenge", "did you question any of my numbers",
  // "have you critiqued / disputed / contested any of this"
  /\byou\s+(?:\w+\s+){0,3}(?:challeng(?:e|ed)|critiqu(?:e|ed)|disput(?:e|ed)|contest(?:ed)?|refut(?:e|ed)|rebut(?:ted)?|question(?:ed)?)\b/i,
  // "are you convinced", "were you persuaded by that"
  /\byou\s+(?:\w+\s+){0,3}(?:convinced|persuaded|sold\s+on|unconvinced)\b/i,
  // "do you buy the argument", "do you buy that"
  /\byou\s+(?:\w+\s+){0,3}buy\b[^?.!\n]{0,40}\b(?:argument|case|claim|logic|reasoning|premise|it|that|this)\b/i,
  // "where do you think I am wrong", "do you think that is right"
  /\byou\s+think\b[^?.!\n]{0,60}\b(?:wrong|right|mistaken|flawed|weak|off)\b/i,
];

/**
 * Family 2 — EVALUATION. How good / how sure is the thing being discussed?
 *
 * These are the second half of the compound origin questions the origin arm
 * silently dropped. Each is interrogative or modal-anchored, so an ordinary
 * declarative carrying the same words is not admitted.
 */
const EVALUATION_PATTERNS: readonly RegExp[] = [
  // "how confident are you in it", "how sure are you", "how certain is that"
  /\bhow\s+(?:confident|sure|certain|convinced)\b/i,
  // "how strong is the evidence", "how good is that estimate",
  // "how reliable is it", "how solid is the case"
  /\bhow\s+(?:strong|weak|good|solid|reliable|robust|shaky|firm)\b/i,
  // "how much should I trust it", "how far can we rely on that"
  /\bhow\s+(?:much|far)\b[^?.!\n]{0,40}\b(?:trust|rely|believe)\b/i,
  // "should I trust that", "can we trust this number"
  /\b(?:should|can|could)\s+(?:i|we)\s+(?:\w+\s+){0,2}(?:trust|rely\s+on|believe)\b/i,
  // "Is it credible?", "…, and is that estimate actually defensible?",
  // "Are these numbers reliable?", "Is the hybrid option even plausible?"
  //
  // ⚠ THE COPULA MUST BE INVERTED, AND THE FIRST DRAFT OF THIS PATTERN WAS NOT
  // — caught by execution, not by inspection. Without the clause-boundary
  // prefix it matched the DECLARATIVE *"The ARR figure is reliable."*, which is
  // a statement, not a request to appraise one. Subject-verb inversion after a
  // clause boundary is the grammatical marker of a polar interrogative in
  // English; that is the conjunct, not a length constant. Pinned by the
  // negative row in `judgement-request.test.ts`.
  /(?:^|[,;?]|\band|\bbut|\bor|\bso)\s*(?:is|are|was|were)\s+(?:it|that|this|these|those|they|the|my|our|your|any)\b[^?.!\n]{0,60}\b(?:credible|reliable|defensible|plausible|justified|well[-\s]?founded|trustworthy|robust)\b/i,
  // "what do you make of it", "what do you make of that"
  /\bwhat\s+do\s+you\s+make\s+of\b/i,
  // "do you stand by that", "do you actually believe it",
  // "would you back that number"
  /\b(?:do|would|did|can)\s+you\s+(?:\w+\s+){0,2}(?:stand\s+by|believe|back|endorse|defend)\b/i,
];

/**
 * Does this message ask Olumi for its OWN stance, opinion or evaluation?
 *
 * ⚠ CONSUMED ONLY AS A DECLINE. Adding a consumer that does anything other than
 * fall through to the reasoning layer changes this module's failure direction
 * from uniform to two-sided, which is the structure that cost four rounds on
 * `mutation-warrant`. If you need this signal on a path that mutates,
 * suppresses, or claims a turn, STOP and report rather than reusing it.
 */
export function asksForOwnJudgement(message: string): boolean {
  if (typeof message !== 'string' || message.length === 0) return false;
  return (
    STANCE_PATTERNS.some((p) => p.test(message)) ||
    EVALUATION_PATTERNS.some((p) => p.test(message))
  );
}
