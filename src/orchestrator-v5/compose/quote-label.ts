/**
 * ⭐ QUOTE A LABEL FOR PROSE — without producing nested quotes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, REPORTED FROM THE PANEL AND TRACED TO ITS SOURCE
 *
 *     The held change 'Add 'competitor price reaction'' has lapsed.
 *
 * `proposal-continuation.ts:1160` mints `public_label: \`Add '${concept}'\`` —
 * a label that ALREADY carries its own quotes. `commit.ts` then wraps it again,
 * and the reader cannot tell which quote closes which.
 *
 * ⚠ WHY IT SHIPPED, AND THE LESSON. Every fixture that reaches
 * `buildHeldLapseNotice` uses a quote-free label — 'Apply', 'Continue with this
 * change', 'Widen the depot budget'. The suite could not see this defect,
 * because its corpus never contained the shape the real producer always emits.
 * The corpus below is taken from the PRODUCERS, not invented here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## THE PREDICATE, AND ITS OPPOSITE-DIRECTION TWIN
 *
 * "Already quoted" cannot be "contains an apostrophe" — that would strip the
 * quotes off `the user's plan` and lose the boundary marker that tells the
 * reader where the label ends. The two cases are distinguished by what sits
 * either side of the mark:
 *
 *     DELIMITER   Add 'competitor price reaction'   ' has a space/edge beside it
 *     APOSTROPHE  the user's plan                   ' has a letter on BOTH sides
 *
 * So a mark counts as a delimiter only when it is NOT letter-bounded. Both
 * directions are pinned in the tests: a label that must lose its outer quotes,
 * and one that must keep them.
 */

/** The prose quote mark. One definition — no hand-maintained mirror (trap 12). */
const QUOTE = "'";

/**
 * True when `value` already carries a quote acting as a DELIMITER, so adding
 * an outer pair would nest. An interior apostrophe (`user's`) does not count.
 */
export function carriesDelimitingQuote(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== QUOTE) continue;
    const before = i > 0 ? value[i - 1] : '';
    const after = i + 1 < value.length ? value[i + 1] : '';
    const letterBounded = /[A-Za-z]/.test(before) && /[A-Za-z]/.test(after);
    if (!letterBounded) return true;
  }
  return false;
}

/**
 * `quoteLabel('Continue with this change')` → `"'Continue with this change'"`
 * `quoteLabel("Add 'competitor price reaction'")` → unchanged, no outer pair
 * `quoteLabel("the user's plan")` → `"'the user's plan'"` (apostrophe kept)
 *
 * The sentence shape around the call site is deliberately UNCHANGED. 19 files
 * reference the "has lapsed" copy across three different fragments (head,
 * middle and tail), so restructuring the sentence has a blast radius this fix
 * does not need: only the quote characters around an already-quoted label
 * differ, and every existing spec stays byte-identical.
 */
export function quoteLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  return carriesDelimitingQuote(trimmed) ? trimmed : `${QUOTE}${trimmed}${QUOTE}`;
}
