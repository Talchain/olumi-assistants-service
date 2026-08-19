/**
 * ⭐ THE CANONICAL OWNER OF USER-LABEL ELISION IN CEE.
 *
 * WHAT THIS OWNS
 * --------------
 * One question, and only this one: *given a user-authored SHORT LABEL (an
 * option / goal / factor / risk name) that does not fit a display budget,
 * which prefix of it may the product show, and how does the product admit
 * that it cut?* Every producer of an elided LABEL must call
 * {@link elideLabelAtWordBoundary}. Nothing else in this module is a policy.
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
 * (`phase3-blocks.ts` / `flip-threshold-card-row.ts`, which an existing
 * conformance test pins byte-identical to each other), evidence-pack field
 * clipping (`utils/evidence-pack.ts`), and the several sentence-level clippers
 * in the compose layer. This module says nothing about any of them.
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
 * Labels whose delimiters are *already* unbalanced in the source (the user
 * wrote `"Ship [the (nested"`) are unfixable by any cut and land here too.
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
 * defect this module did not create. Worked example, and the reason this
 * paragraph exists: `"we will ship the thing) and then celebrate loudly"` @40.
 * A stack whose `pop()` on empty is a silent no-op calls the 32-char head
 * BALANCED and keeps `"we will ship the thing) and then…"`. A counter that
 * goes negative calls it unbalanced FOREVER, backs off past the floor, and
 * returns a stub. Both are self-consistent; they are not the same function.
 * This module is the first; `label-elision.test.ts` pins that case.
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
 *  - total output length ≤ `max` whenever any word boundary survives inside
 *    the budget;
 *  - honours the {@link RETENTION_FLOOR_RATIO}, and prefers an open delimiter
 *    to a stub when the two conflict.
 *
 * THE WHOLE-LABEL BRANCH. `elide` returns the label untouched, overrunning
 * `max`, in exactly one situation: **no word-boundary prefix inside the
 * budget retains at least the floor** — i.e. the label is one token longer
 * than the budget, or its only boundaries sit in the first few characters.
 * Returning nothing usable is worse than returning something long, and this
 * function will not fabricate a break inside a word the user wrote. Callers
 * that need a hard character ceiling must clip AFTER this, and own that
 * decision themselves.
 *
 * `max < 2` (no room for text plus a marker) also returns the trimmed label:
 * there is no honest elision at that budget.
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
    if (!hasUnclosedDelimiter(head)) return `${head}${ELLIPSIS}`;
  }

  if (longestAboveFloor !== null) return `${longestAboveFloor}${ELLIPSIS}`;
  return trimmed;
}

/** The marker this module appends, exported so tests cannot mirror it wrong. */
export const LABEL_ELISION_MARKER = ELLIPSIS;

/** The floor ratio, exported for the same reason. */
export const LABEL_RETENTION_FLOOR_RATIO = RETENTION_FLOOR_RATIO;
