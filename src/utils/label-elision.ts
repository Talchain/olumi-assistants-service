/**
 * ⭐ THE CANONICAL OWNER OF USER-LABEL ELISION IN CEE.
 *
 * WHAT THIS OWNS
 * --------------
 * One question, and only this one: *given a user-authored SHORT LABEL (an
 * option / goal / factor / risk name) that does not fit a display budget,
 * which prefix of it may the product show, and how does the product admit
 * that it cut?* Nothing else in this module is a policy.
 *
 * ⚠ WHAT THIS DOES *NOT* CLAIM. It owns that question for the TWO SEAMS
 * CONVERTED IN N26 — `orchestrator-v5/coaching/post-draft-narrative.ts` and
 * `orchestrator-v5/coaching/readiness-recovery.ts` — and for nothing else.
 * This header previously read "every producer of an elided LABEL must call
 * {@link elideLabelAtWordBoundary}", which was already false at the commit
 * that wrote it: label cuts survive elsewhere in the tree, unconverted and
 * deliberately out of scope, and they are NAMED under NOT IN SCOPE below. A
 * NEW label producer should call this. The claim that every existing one
 * already does was an aspiration written in the present tense.
 *
 * WHAT IT SUPERSEDED (N26, 2026-08-19)
 * ------------------------------------
 * Two independent, user-reachable label truncators, both deleted in the same
 * commit that added this file:
 *
 *   1. `coaching/post-draft-narrative.ts` — a local `truncate(label, max)`
 *      that cut mid-token whenever the last space fell at or below 50% of the
 *      cap, had NO delimiter awareness, and appended NO ellipsis at all.
 *      Five call sites (the confirm sentence at `MAX_GOAL_CHARS`, the options
 *      block and three trade-off fragments at `MAX_LABEL_CHARS`).
 *   2. `coaching/readiness-recovery.ts` — a local `truncate(value, max)` that
 *      DID append an ellipsis but was equally bracket-unaware, and whose
 *      output is chipped by `configure-option-chip-text.ts` into
 *      `Configure <label>`.
 *
 * Both were witnessed lying on the SAME user brief (COMPOSED-JOURNEY-WITNESS
 * -2026-08-18-B, links 2(c) and 4; reproduced byte-for-byte by execution at
 * staging `877affe2`):
 *
 *   "double down on enterprise sales (higher"          (seam 1, @40)
 *   "Several of our largest enterprise customers are asking for a self-hosted"
 *                                                      (seam 1, @80)
 *   "hold the line on cloud-only for another"          (seam 1, @40)
 *   "Configure double down on enterprise sales (higher…"  (seam 2 → chip)
 *
 * ⚠ The fourth string REFUTES, by execution, the claim that "every other
 * truncate helper appends an ellipsis, so none can produce the witnessed
 * unclosed-bracket string". An ellipsis does not close a bracket.
 *
 * NOT IN SCOPE — deliberately, and these are DIFFERENT budget questions that
 * must not be folded in here: prose-body truncation
 * (`orchestrator-v5/compose/phase3-blocks.ts` / `flip-threshold-card-row.ts`,
 * which an existing conformance test pins byte-identical to each other),
 * evidence-pack field clipping (`utils/evidence-pack.ts`), and the several
 * sentence-level clippers in the compose layer. This module says nothing
 * about any of them.
 *
 * ⚠ AND THE SURVIVING *LABEL* CUTS, NAMED — because "not in scope" is read as
 * "does not exist" within a week, and an unnamed survivor is how the next
 * session concludes this seam is closed:
 *
 *   • `orchestrator-v5/compose/phase3-blocks.ts:2932` —
 *     `What would flip the result on ${ref.label}` at `TITLE_MAX`; and
 *   • `orchestrator-v5/compose/phase3-blocks.ts:3085` —
 *     `Evidence to strengthen first: ${guidance.factorLabel}` at `TITLE_MAX`.
 *     Both interpolate a USER LABEL at the END of a review-card TITLE and cut
 *     it with the bracket-unaware local `truncate` at
 *     `orchestrator-v5/compose/phase3-blocks.ts:3296`, so the very class N26
 *     closed on the narrative and the chip remains reachable on a card title.
 *     ⛔ DO NOT convert them from here: that `truncate` is pinned
 *     BYTE-IDENTICAL to `flip-threshold-card-row.ts` by an existing
 *     conformance test, and touching either half breaks the pin. Converting
 *     them is separate, rowed work that must move the pin first.
 *   • `routes/assist.draft-graph.ts:310` — a mid-token 80-char label cut in
 *     `buildRefinementBrief`. Its consumer is the MODEL PROMPT, not a screen,
 *     which is why it is a different budget question rather than a display
 *     defect — but it is a user-label cut and it is not this module's.
 *
 * Pure, dependency-free, and deliberately NOT hosted inside a prose composer:
 * `readiness-recovery.ts` and `post-draft-narrative.ts` both import it, and a
 * helper exported from either of them would invite an import cycle.
 */

/** The single elision marker. U+2026, one character — never `...`. */
const ELLIPSIS = '…';

/**
 * RETENTION FLOOR. An elided label must keep at least this fraction of its
 * text budget, or it stops being a label and becomes a stub: `"Migrate…"` for
 * `"Migrate (everything except the payments platform … which is a lot)"`
 * loses ~94% of what the user wrote and names nothing.
 *
 * ⭐ THE FLOOR OUTRANKS DELIMITER CLOSURE, and that is a decision, not an
 * oversight. Where no word-boundary cut both closes every delimiter AND
 * clears the floor, this module keeps the text and leaves the delimiter open
 * rather than destroying the label. It never invents a closing bracket: the
 * appended marker is exactly one U+2026 and nothing else, so the product
 * cannot put characters into a user's label that the user did not write.
 * ⚠ CORRECTED AT THIS TIP, BY EXECUTION. This paragraph used to end: "labels
 * whose delimiters are *already* unbalanced in the source … land here too."
 * That is FALSE as a general statement. An already-unbalanced source is
 * normally backed off PAST THE USER'S OWN OPENER and returned BALANCED and
 * SHORTER — measured: `"Ship the new pricing (model for enterprise and
 * mid-market accounts"` @40 → `"Ship the new pricing…"` (21 chars, balanced),
 * which is the closed-boundary branch, not this one.
 *
 * That behaviour is DELIBERATE and the predicate must NOT be changed to stop
 * it: the only alternative is to accept a head that reopens an unclosed
 * delimiter on screen, which is the exact defect N26 exists to close. Such a
 * source reaches the floor branch only when EVERY above-floor head is itself
 * unclosed — e.g. `"Ship [the (nested {thing} here] and more words after it
 * all"` @40, the case `label-elision.test.ts` pins.
 */
const RETENTION_FLOOR_RATIO = 0.5;

/**
 * THE ONE DELIMITER DISCIPLINE — used by the back-off loop AND by the
 * exported predicate, because two disciplines disagree on inputs this
 * contract admits.
 *
 * The rule: **an opener with no matching closer is unclosed; a closer with no
 * matching opener is ordinary text and is IGNORED.**
 *
 * Why ignore stray closers: an elision can only ever ORPHAN AN OPENER — it
 * cuts from the right. A closer left dangling on the left was already in the
 * user's own text, so backing off for it would delete content to atone for a
 * defect this module did not create.
 *
 * ⚠ THE WORKED EXAMPLE THAT USED TO SIT HERE IS WITHDRAWN — refuted by
 * execution at this tip. It claimed that on
 * `"we will ship the thing) and then celebrate loudly"` @40 a stack keeps
 * `"we will ship the thing) and then…"` while a counter "backs off past the
 * floor and returns a stub". Measured: the two disciplines do disagree on the
 * PREDICATE — `hasUnclosedDelimiter("we will ship the thing) and then")` is
 * `false` under the stack and `true` under a counter — but they produce
 * BYTE-IDENTICAL ELIDER OUTPUT on that exact string, `"we will ship the
 * thing) and then…"` either way, because the counter rejects every above-floor
 * head and the floor branch then returns the very head the stack had chosen.
 *
 * The claim is kept only where it is true AND pinned: the two disciplines are
 * genuinely different functions at {@link hasUnclosedDelimiter}, which is
 * exported for exactly that reason, and `label-elision.test.ts` pins the
 * predicate's answer on that string.
 *
 * `"` toggles parity (there is no directional pair to match). `'` and the
 * curly `’` are NOT delimiters here — they are the English apostrophe far
 * more often than they are quotes, and treating `"don't"` as an open quote
 * would back off on ordinary prose. `“ ”` ARE paired: they are directional,
 * so they cannot be confused with an apostrophe.
 */
const DELIMITER_PAIRS: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['“', '”'],
]);

const CLOSERS: ReadonlySet<string> = new Set(DELIMITER_PAIRS.values());

const STRAIGHT_QUOTE = '"';

/**
 * True when `text` leaves a delimiter open under the discipline documented on
 * {@link DELIMITER_PAIRS}. Exported so that callers and tests interrogate the
 * SAME predicate the back-off loop uses — a second, hand-written copy of this
 * rule is exactly the hand-maintained mirror this module exists to remove.
 */
export function hasUnclosedDelimiter(text: string): boolean {
  const expected: string[] = [];
  let straightQuoteOpen = false;

  for (const ch of text) {
    if (ch === STRAIGHT_QUOTE) {
      straightQuoteOpen = !straightQuoteOpen;
      continue;
    }
    const closer = DELIMITER_PAIRS.get(ch);
    if (closer !== undefined) {
      expected.push(closer);
      continue;
    }
    // Matching closer pops; a stray or mismatched closer is ordinary text.
    if (CLOSERS.has(ch) && expected.length > 0 && expected[expected.length - 1] === ch) {
      expected.pop();
    }
  }

  return expected.length > 0 || straightQuoteOpen;
}

/**
 * THE PHRASE-BOUNDARY DISCIPLINE — closed-class only, and deliberately so.
 *
 * A word boundary is not a phrase boundary. N26 landed the ellipsis and the
 * word-boundary cut; the UX gate re-witnessed this seam on 19 AND 20 August
 * and found the other half of the 18 August prescription still open — the
 * product stops on words that cannot end a phrase:
 *
 *   "hold the line on cloud-only for another…"     (option label @40)
 *
 * `another` is a determiner with no noun; `for` behind it is a preposition
 * with no object. Neither can END anything, so the marker reads as a broken
 * sentence rather than an elision.
 *
 * THE RULE: reject a candidate head whose LAST token is a closed-class
 * function word, and let the existing back-off walk to the next candidate.
 * Iteration falls out of the loop for free — `for another` drops `another`,
 * then drops `for`, and stops on `cloud-only`, a content word.
 *
 * ⭐ WHY CLOSED-CLASS ONLY, AND WHY THE OBVIOUS EXTENSION IS REFUSED. This set
 * contains only function words, so the rule can NEVER delete a content word
 * the user wrote — it is determinate, needs no part-of-speech lexicon, and has
 * no tuning constants. That is the whole of its claim.
 *
 * ⚠ IT THEREFORE DOES NOT FIX THE SECOND WITNESSED STRING, and that is a
 * MEASURED decision, not an oversight:
 *
 *   "…enterprise customers are asking for a self-hosted…"   (goal quote @80)
 *
 * That head ends on a CONTENT word. It reads broken only because the
 * determiner `a`, two tokens back, never got its noun — and knowing that needs
 * a lexicon, because the identical shape `<determiner> <token>` is a perfectly
 * good phrase ending in `"Defend and hold the line"`.
 *
 * The obvious next round — also reject a head whose SECOND-to-last token is a
 * determiner — was RUN BEFORE BEING COMMISSIONED (platform trap 22f(b)). It
 * fixes the goal string and simultaneously breaks the legitimate one, turning
 * `"Defend and hold the line…"` into `"Defend and hold…"`, which is a dangling
 * verb phrase — the same harm, relocated. Two harms under one predicate cannot
 * share a window (trap 22b), so the extension is REFUSED rather than shipped.
 * `label-elision.test.ts` pins BOTH halves of that finding executably, so the
 * gap REDs if it is closed and REDs if it degrades.
 *
 * RANKING, unchanged from N26: this is a PREFERENCE, below the budget
 * GUARANTEE and below the retention floor. Where no head satisfies it above
 * the floor, the floor wins and the label keeps its dangling tail rather than
 * collapsing to a stub — the same ordering the module already applies to
 * delimiter closure.
 *
 * ⭐ EXPORTED FOR ONE REASON: A MEMBERSHIP LOCK, AND THAT IS NOT THE MIRROR
 * `endsOnDanglingWord`'s header WARNS ABOUT. The two are different objects and
 * the distinction is the whole argument for this export (platform trap 21 —
 * write down the question each one answers):
 *
 *   · A mirror as SOURCE re-implements the predicate in a spec to COMPUTE an
 *     expectation. It drifts SILENTLY, because the copy and the original are
 *     each self-consistent. That is the thing the header forbids, and it stays
 *     forbidden: a caller or a test deciding whether a word dangles must ask
 *     `endsOnDanglingWord`, never a private list of its own.
 *   · A mirror as LOCK asserts set EQUALITY and computes nothing. It cannot
 *     drift silently — divergence is the only thing it can do, and it REDs.
 *     That is trap 12's own prescription for a list nothing can derive:
 *     "where you cannot derive, the mirror must FAIL LOUD on drift".
 *
 * ⚠ AND THE DIRECTION THAT MAKES IT WORTH THE EXPORT. A word MISSING from this
 * set is a GAP — an elision keeps a dangling tail, which is cosmetic. A word
 * ADDED to it is not symmetric: this set is consulted to REJECT candidate
 * heads, so a CONTENT word added here makes the back-off cut PAST a word the
 * user wrote, which falsifies the "can NEVER delete a content word" claim
 * above that is this rule's entire safety argument. Nothing in the language is
 * derivable that would catch that (a closed-class inventory is a judgement, not
 * a computation, and importing a part-of-speech lexicon is refused for the same
 * reason the second-token extension was). A membership lock is therefore the
 * honest instrument: it cannot say the list is RIGHT, only that no one changed
 * it without a reviewer looking. `__tests__/label-elision.vocabulary.test.ts`
 * holds the lock and the reachability half.
 */
export const DANGLING_TAIL_WORDS: ReadonlySet<string> = new Set([
  // determiners / possessives
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'another', 'each', 'every',
  'some', 'any', 'no', 'my', 'your', 'our', 'their', 'its', 'his', 'her', 'both',
  'either', 'neither', 'such', 'which', 'what',
  // prepositions
  'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'into', 'onto',
  'over', 'under', 'about', 'across', 'through', 'between', 'among', 'during',
  'before', 'after', 'against', 'per', 'via', 'without', 'within', 'upon',
  'toward', 'towards', 'beyond', 'beneath', 'besides', 'despite', 'than',
  // conjunctions / subordinators
  'and', 'or', 'but', 'nor', 'so', 'yet', 'plus', 'if', 'while', 'when',
  'whereas', 'because', 'as', 'whether', 'unless', 'until', 'since',
  // auxiliaries / copulas / negation
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'will', 'would',
  'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'do', 'does',
  'did', 'has', 'have', 'had', 'not',
]);

/**
 * True when `text` ends on a closed-class function word that cannot end a
 * phrase, under the discipline documented on {@link DANGLING_TAIL_WORDS}.
 *
 * Exported so callers and tests interrogate the SAME predicate the back-off
 * loop uses — a second, hand-written copy of this word set in a spec is
 * exactly the hand-maintained mirror this module exists to remove (trap 12).
 *
 * Surrounding punctuation is stripped before the lookup so that `"...for a,"`
 * and `"...for a"` are judged alike; case is folded for the same reason.
 */
export function endsOnDanglingWord(text: string): boolean {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  const last = tokens[tokens.length - 1]
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '');
  return DANGLING_TAIL_WORDS.has(last);
}

/**
 * Every word-boundary prefix of `text` that fits inside `budget`, LONGEST
 * FIRST, de-duplicated, strictly decreasing in length.
 *
 * TERMINATION: this returns a finite array computed by a bounded `for` loop
 * over the indices of a finite string, and the caller's back-off is a `for
 * … of` over that array. There is no loop whose exit depends on the content
 * of user text, so no user label can spin it. (`label-elision.test.ts` also
 * asserts it executably over a 20,000-case adversarial sweep.)
 */
function wordBoundaryHeads(text: string, budget: number): string[] {
  const heads: string[] = [];
  const seen = new Set<string>();
  const limit = Math.min(budget, text.length - 1);

  for (let i = limit; i >= 1; i -= 1) {
    if (!/\s/.test(text.charAt(i))) continue;
    const head = text.slice(0, i).trimEnd();
    if (head.length === 0 || seen.has(head)) continue;
    seen.add(head);
    heads.push(head);
  }

  return heads;
}

/**
 * Elide a user-authored label to `max` characters at a word boundary,
 * closing what the cut would otherwise leave open, and SAY that it cut.
 *
 * Contract:
 *  - trims, and returns the trimmed label unchanged when it already fits
 *    (no marker is appended when nothing was removed);
 *  - cuts only at a word boundary — never mid-token;
 *  - backs off further while the head leaves a delimiter open, under the one
 *    discipline documented on {@link DELIMITER_PAIRS};
 *  - appends exactly one U+2026 whenever it elided;
 *  - total output length is ALWAYS ≤ `max`, for every input, whenever `max`
 *    is an integer ≥ 2 — there is no branch that overruns the budget it was
 *    handed (the two non-eliding inputs at the end of this comment are the
 *    only outputs that can exceed it, and neither claims to have elided);
 *  - honours the {@link RETENTION_FLOOR_RATIO}, and prefers an open delimiter
 *    to a stub when the two conflict.
 *
 * THE LAST-RESORT BRANCH. When **no word-boundary prefix inside the budget
 * retains at least the floor** — the label is one token longer than the
 * budget, or its only boundaries sit in the first few characters — there is
 * no word boundary to cut at, and this function cuts at `max - 1` characters
 * anyway and marks it. That is the one MID-TOKEN cut this module makes, and
 * it is deliberate.
 *
 * ⚠ It replaces a measured REGRESSION. This branch previously returned the
 * whole label untouched, telling callers to "clip AFTER this" — and NONE of
 * the seven call sites did, so labels of 56–76 characters reached the screen
 * through a 40-character budget, unmarked, where the two truncators this
 * module superseded had both cut to exactly 40. Handing a caller a string
 * longer than the budget it asked for is not a kinder failure than a
 * mid-token cut: the mid-token cut is still a genuine prefix of what the user
 * wrote and still admits that it cut, while the overrun is neither. The word
 * boundary is a PREFERENCE, ranked above the floor and above delimiter
 * closure; the budget is the GUARANTEE.
 *
 * The two inputs that return the trimmed label unchanged, and so may exceed
 * `max`: `max < 2` (no room for text plus a marker) and a non-integer `max`.
 * There is no honest elision at either, and neither appends a marker, so
 * neither claims to have elided.
 */
export function elideLabelAtWordBoundary(label: string, max: number): string {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  if (!Number.isInteger(max) || max < 2) return trimmed;
  if (trimmed.length <= max) return trimmed;

  const budget = max - ELLIPSIS.length;
  const floor = Math.ceil(budget * RETENTION_FLOOR_RATIO);

  let longestAboveFloor: string | null = null;

  for (const head of wordBoundaryHeads(trimmed, budget)) {
    if (head.length < floor) break;
    if (longestAboveFloor === null) longestAboveFloor = head;
    if (hasUnclosedDelimiter(head)) continue;
    if (endsOnDanglingWord(head)) continue;
    return `${head}${ELLIPSIS}`;
  }

  if (longestAboveFloor !== null) return `${longestAboveFloor}${ELLIPSIS}`;
  // LAST RESORT: no word boundary above the floor exists. Cut mid-token to the
  // budget and mark it — see THE LAST-RESORT BRANCH above. `trimmed` starts
  // with a non-space and `max >= 2`, so the `trimEnd()` can never empty this.
  return `${trimmed.slice(0, max - 1).trimEnd()}${ELLIPSIS}`;
}

/** The marker this module appends, exported so tests cannot mirror it wrong. */
export const LABEL_ELISION_MARKER = ELLIPSIS;

/** The floor ratio, exported for the same reason. */
export const LABEL_RETENTION_FLOOR_RATIO = RETENTION_FLOOR_RATIO;
