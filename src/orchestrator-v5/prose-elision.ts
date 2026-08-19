/**
 * ⭐⭐ ONE ELISION RULE FOR EVERY STRING A USER READS — a dependency-free leaf.
 *
 * ── WHY A LEAF MODULE AND NOT AN IMPORT ────────────────────────────────────
 * The rule below was born inside `coaching/post-draft-narrative.ts`. A reviewer
 * then found the SAME TURN, from the SAME response object, shipping a chip that
 * still cut on the old rule: `handlers/draft-graph-dispatch.ts` calls
 * `buildPostDraftNarrative` at `:258` (the corrected prose) and
 * `buildPostDraftChips` at `:380` → `buildReadinessRecoveryChip` (the mangled
 * chip). A user read both in one payload.
 *
 * The obvious fix — have `coaching/readiness-recovery.ts` import the rule from
 * the composer — CLOSES A CYCLE: `post-draft-narrative.ts:80` already imports
 * `buildReadinessNextStep` from `./readiness-recovery.js`, and
 * `readiness-recovery` had exactly ONE import before this change
 * (`../configure-option-chip-text.js`), so it would have been its first
 * intra-coaching edge. Derived at the static import edges.
 *
 * So the rule moves to a leaf both sides can import, exactly as
 * `configure-option-chip-text.ts` did for chip copy — *"Dependency-free on
 * purpose: imported by both routing and compose without cycle risk."*
 *
 * ⚠⚠ THIS FILE MUST STAY DEPENDENCY-FREE. It has no imports and must acquire
 * none: every import added here is a potential cycle for each of its consumers,
 * which now span `coaching/` and `compose/`.
 */

/**
 * ⭐⭐ THE OPENING SENTENCE CUT A LABEL MID-PHRASE ON AN UNCLOSED BRACKET, AND
 * THIS FUNCTION IS WHERE IT HAPPENED — DERIVED, NOT INFERRED.
 *
 * ── WHAT WAS WITNESSED, AND WHAT REPRODUCES IT ─────────────────────────────
 * Two independent 18 Aug 2026 witnesses caught the same shape on the deployed
 * build. Run against the old body, this function reproduced all three strings
 * BYTE FOR BYTE:
 *
 *   `truncate(<the 85-char option>, 40)`
 *      → "double down on enterprise sales (higher"     ← composed-journey
 *   `truncate(<the 90-char goal>,   80)`
 *      → "…are asking for a self-hosted"               ← UX gate point 4a
 *   `truncate("hold the line on cloud-only for another year", 40)`
 *      → "hold the line on cloud-only for another"     ← UX gate point 4a
 *
 * A UI lane independently refuted the theory that this was a rendering defect:
 * the strings arrive ALREADY TRUNCATED ON THE WIRE, while the SAME payload
 * carries the full label intact at five other sites. So the label the user
 * reads in prose was not the label on their node, and nothing downstream could
 * repair it without inventing text — which is the defect class itself.
 *
 * ── THE THREE FAULTS OF THE OLD BODY ───────────────────────────────────────
 *  1. `cut.trim()` on the `else` branch cut MID-TOKEN whenever the last space
 *     fell in the first half of the window;
 *  2. it never looked at DELIMITERS, so a cut inside `(…)` shipped an unclosed
 *     bracket — which is what makes it read as broken English rather than as
 *     abbreviation;
 *  3. it appended NO ellipsis, so nothing on screen said the text was elided.
 *
 * ── THE RULE NOW, AND WHY IT REFUSES ───────────────────────────────────────
 * A cut is taken only at a WORD BOUNDARY, only where it leaves every delimiter
 * closed, and it is always marked with `…`. Where no such point exists the
 * label is returned WHOLE — a long honest label beats a mangled one, and
 * returning the whole label can never misrepresent it.
 *
 * ⚠ THE RESULT IS ALWAYS A WORD-BOUNDED PREFIX OF THE INPUT (plus `…`), NEVER A
 * SUBSTITUTE STRING. That is the property the conformance test binds to, by
 * identity against the node's own label rather than by any length predicate —
 * so a future composer that "helpfully" swaps in a shorter phrase goes RED.
 *
 * ⚠ `'` IS DELIBERATELY NOT TREATED AS A DELIMITER: in ordinary British prose it
 * is an apostrophe far more often than a quote ("don't", "the team's"), and
 * treating it as an opener would refuse cuts on perfectly safe labels.
 *
 * ⚠⚠ THE SENTENCE THAT USED TO SIT HERE WAS FALSE, AND IT IS WHY THIS LOOKED
 * CLOSED. It read: *"All four append an ellipsis, so none produces the
 * witnessed unclosed-bracket string."* **True only of witnessed string (i)** —
 * the no-mark prose variant. Witnessed string (ii) is
 * `Configure double down on enterprise sales (higher…`, which HAS a mark and is
 * produced by `coaching/readiness-recovery.ts`'s helper at
 * `MAX_LABEL_CHARS = 40`, byte-exactly. A qualifier dropped from a sibling
 * survey turned "not this variant" into "not at all", and #1038 shipped
 * claiming both witnesses closed when it had closed one (trap 20: the row
 * generalised the scope of the finding it recorded).
 *
 * ── THE SIBLING SET, WITH REACHABILITY DERIVED RATHER THAN ASSERTED ────────
 * Consolidated onto this rule (user-reachable):
 *   · `coaching/post-draft-narrative.ts`  — draft prose
 *   · `coaching/readiness-recovery.ts`    — configure-option chip label/message
 *   · `compose/helpers.ts`                — `safeLabel` → `handler-failure-responses.ts:345`
 *   · `compose/phase3-blocks.ts`          — card title/body/action label/prompt
 *
 * Deliberately NOT consolidated, because it is not user-reachable:
 *   · `cee/observability/collector.ts`    — truncates `raw_prompt`/`raw_response`
 *     into the observability capture only, and already marks the cut explicitly
 *     with `... [truncated, N chars omitted]`. A diagnostic record is not prose
 *     a user reads, and a word-boundary rule would make captured bytes LESS
 *     faithful to what was actually sent.
 *
 * That set is pinned by name in `prose-elision-never-mid-phrase.test.ts`, which
 * REDs if a new `truncate`-shaped helper appears anywhere under
 * `src/orchestrator-v5/` — because a fix applied to some copies of a rule has a
 * countdown on it, and this lane has now watched that countdown expire once.
 */
/**
 * ⭐⭐ THE MAGNITUDE FLOOR — added after a review measured what the back-off
 * costs when it retreats past a bracket that was never broken.
 *
 * `Status Quo (Continue Serving EU Remotely)` is 41 characters at a budget of
 * 40. The cut lands one character inside a CLOSED bracket, the back-off
 * retreats to before the `(`, and the label collapses to `Status Quo…` — a
 * 41-character string reduced to 11 to save one. Measured on real captures,
 * **90 distinct outputs at max=40 each stood for between 2 and 5 different
 * labels**, rendered as indistinguishable bullets; one straight quote in
 * `Protect the 15" seat price …` collapsed an 81-character goal to
 * `Protect the…` in Olumi's opening line.
 *
 * ⚠ AND THE IDENTITY GUARD IS BLIND TO THIS BY CONSTRUCTION: every collapsed
 * output IS a valid word-bounded prefix, so `isWordBoundedPrefixOf` acquits all
 * of them. A guard can be correct and still not be watching the harm.
 *
 * ⚠ THIS IS NOT ANOTHER PUNCTUATION RULE, so trap 22f does not apply. It is a
 * MAGNITUDE rule over what SURVIVES, orthogonal to where the cut may fall — and
 * the punctuation-shaped alternative was run in advance and does oscillate: a
 * hard-character-cut fallback fixes zero real cases and reintroduces the
 * mid-token cuts that were fault #1.
 *
 * It also follows this module's own stated principle rather than adding a new
 * one: where no honest cut exists, keep the label whole. "Honest" now means
 * *retains enough of the label to still name the thing*.
 */
const MAGNITUDE_FLOOR = 0.6;

export function elideAtWordBoundary(label: string, max: number): string {
  const trimmed = label.trim();
  if (trimmed.length <= max) return trimmed;

  // One character is reserved for the ellipsis: the mark is what turns a cut
  // into an abbreviation the reader can recognise as one.
  let end = trimmed.lastIndexOf(' ', max - 1);

  // Back the cut up until nothing is left open. Each pass moves strictly
  // leftwards, so this terminates.
  while (end > 0) {
    const opener = firstUnclosedDelimiter(trimmed.slice(0, end));
    if (opener < 0) break;
    end = trimmed.lastIndexOf(' ', opener - 1);
  }

  // No honest cut point — keep the user's label whole rather than mangle it.
  if (end <= 0) return trimmed;

  const head = trimmed.slice(0, end).replace(/[\s,;:—–.…]+$/u, '').replace(/[,;:—–-]+$/u, '');
  if (head.length === 0) return trimmed;

  // ⭐ THE FLOOR. A cut that keeps less than 60% of the budget is not an
  // abbreviation of this label; it is a different, shorter label that several
  // siblings can share. Keeping it whole is over budget and unambiguous — the
  // trade this module already makes everywhere else.
  if (head.length < Math.floor(max * MAGNITUDE_FLOOR)) return trimmed;

  return `${head}…`;
}

/**
 * The index of the earliest delimiter that `text` opens and never closes, or
 * `-1` when every one of them is closed. Brackets nest; the double quote is a
 * toggle, which is why an odd count of them reports the first as still open.
 */
function firstUnclosedDelimiter(text: string): number {
  const PAIRS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}', '\u201c': '\u201d' };
  const CLOSERS = new Set(Object.values(PAIRS));
  const open: number[] = [];
  let doubleQuoteAt = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') {
      doubleQuoteAt = doubleQuoteAt < 0 ? i : -1;
      continue;
    }
    if (PAIRS[ch] !== undefined) {
      open.push(i);
      continue;
    }
    // ⚠ TYPE-AWARE. `open.pop()` alone reported `Adopt (the fast path]` as
    // balanced, because any closer cancelled any opener. A mismatched closer
    // now cancels nothing, so the opener stays open and the cut backs off.
    if (CLOSERS.has(ch)) {
      const top = open[open.length - 1];
      if (top !== undefined && PAIRS[text[top]!] === ch) open.pop();
    }
  }
  const first = open.length > 0 ? open[0]! : -1;
  if (first < 0) return doubleQuoteAt;
  if (doubleQuoteAt < 0) return first;
  return Math.min(first, doubleQuoteAt);
}

/**
 * ⭐⭐ THE SECOND QUESTION, NAMED APART FROM THE FIRST (trap 21).
 *
 * ── THE MISTAKE THIS EXISTS TO CORRECT, CAUGHT BY EXISTING TESTS ───────────
 * Consolidating every sibling onto {@link elideAtWordBoundary} broke three
 * guarantees, and the break was the right kind of loud: `safeLabel` asserts
 * `out.length <= 60`, `sanitiseForUser` asserts `<= 100`, and
 * `truncateCardProse` asserts the emitted body is EXACTLY `<= BODY_MAX`. The
 * readability rule may return a string WHOLE — over budget — when no honest cut
 * exists, so on a 301-character single token it returned 301.
 *
 * ── WHY THAT IS NOT A BUG IN EITHER RULE ───────────────────────────────────
 * They answer different questions, and the names had hidden it:
 *
 *   · {@link elideAtWordBoundary} — "how do I shorten this so a human reads it
 *     correctly?" It is allowed to DECLINE, because a long honest label beats a
 *     mangled one and the surface can wrap.
 *   · this function — "guarantee this never exceeds N." It may NEVER decline:
 *     the cap is a defence-in-depth invariant, and a value that can exceed it
 *     lets a hostile or runaway string move a display or prompt budget.
 *
 * Aligning them would have traded a readability defect for a bound that does
 * not bind. So the bounded variant takes the readable cut WHEN ONE FITS, and
 * otherwise falls back to a hard cut — still marked, so the reader still knows
 * text was removed.
 *
 * ⚠ THE MARK IS A PARAMETER because it is load-bearing at one call site:
 * `compose/helpers.ts` asserts an ASCII `...` as defence-in-depth, deliberately
 * avoiding a multi-byte character on a path that sanitises hostile input.
 *
 * @returns a string whose length is ALWAYS `<= max`.
 */
export function elideWithinBudget(label: string, max: number, mark = '…'): string {
  const trimmed = label.trim();
  if (trimmed.length <= max) return trimmed;
  if (max <= mark.length) return trimmed.slice(0, Math.max(0, max));

  // Prefer the readable cut, but only if it actually fits the budget.
  const readable = elideAtWordBoundary(trimmed, max - mark.length + 1);
  if (readable.length <= max && readable !== trimmed) {
    return readable.endsWith('…') && mark !== '…'
      ? `${readable.slice(0, -1).trimEnd()}${mark}`
      : readable;
  }

  // No honest cut fits. The bound wins — but say so.
  return `${trimmed.slice(0, max - mark.length).trimEnd()}${mark}`;
}
