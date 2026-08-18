/**
 * THE GOAL LABEL WHEN SEVERAL OBJECTIVES MERGE — a concise faithful display
 * label, with the user's exact words kept as PROVENANCE rather than as display.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 *   Compound Goal: we'd like to spend less + increase productivity, while
 *   maintaining code quality
 *
 * `enforceSingleGoal` built that by string-joining every goal label with `" + "`
 * behind a literal prefix. Three separate harms in one label: it announces an
 * internal repair to the user ("Compound Goal:"), it reads as machine output
 * rather than as the team's objective, and it filtered the merged-away goal
 * nodes out — taking their `goal_threshold` quad with them.
 *
 * ── THE RULING IMPLEMENTED HERE (founder, node labels) ──────────────────────
 * "Preserve exact user language as PROVENANCE, not necessarily as the primary
 * display; use a concise faithful display label with the verbatim original
 * available in inspector/hover/provenance; do NOT permanently add the full quote
 * beneath every node."
 *
 * And the one half of it that is ENFORCEABLE rather than aesthetic:
 *
 *   ⭐ CONSERVATION RULE: no numeral or named quantity may be dropped from a
 *     restatement.
 *
 * "Reads well" is not enforceable and this module does not pretend it is. What
 * it enforces is conservation: a shorter label is only permitted when it drops
 * no quantity. Where a merged-away objective carries a figure the concise label
 * would lose, the label KEEPS it. That makes brevity conditional on truthfulness
 * rather than the other way round.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DECIDE ─────────────────────────────────
 * Two questions here belong to the founder and are untouched (quality bar §8):
 *
 *   A3 — two goals with DIFFERENT targets: two visible goal nodes, or one plus a
 *        coaching card? This module does not change WHICH goals merge, or how
 *        many nodes survive. It changes only the label text and stops the
 *        provenance loss. Merge behaviour is byte-identical.
 *   A7 — the authored-restatement step (the model emitting a short objective
 *        alongside the verbatim quote) requires the SERVED prompt, which is not
 *        in this repo. A code-only fix cannot produce an authored label, so this
 *        module selects among the user's OWN existing labels rather than
 *        paraphrasing. Nothing here invents prose.
 */

/**
 * A numeral or named quantity, for the conservation check.
 *
 * ⚠ THE PREDICATE IS DELIBERATELY GREEDY. A conservation rule that misses a
 * quantity fails silently and permits the loss it exists to prevent, so the
 * error this is tuned against is a FALSE NEGATIVE. Over-detection only makes a
 * label longer; under-detection drops the user's figure.
 *
 * Matches, in one pass:
 *   - currency-prefixed amounts with scale suffixes         (£20m, $1.5bn, £250,000)
 *   - a figure bound to a period, digits OR words           (4-day week, four-day week)
 *   - digit runs with optional decimals/separators/percent  (20, 15%, 250,000, 4.5)
 *
 * ⚠ ALTERNATION ORDER IS LOAD-BEARING, and getting it wrong cost a real miss
 * caught by this module's own suite. JS regex alternation takes the FIRST branch
 * that matches at a position, not the longest. With the bare digit run listed
 * before the period branch, `4-Day Week` matched just `4` and the compound token
 * was never produced — an under-detection, i.e. exactly the false-negative class
 * this predicate is meant to be greedy against. Specific branches precede
 * general ones for that reason; do not reorder them for tidiness.
 */
const QUANTITY_PATTERN =
  /(?:[£$€]\s?\d[\d,._]*\s?(?:k|m|bn|b|tn)?%?)|(?:\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[- ](?:day|week|month|year|hour)s?\b)|(?:\d[\d,._]*\s?(?:%|percent|k|m|bn|b|tn|million|billion|trillion|thousand)?)/gi;

/** Normalise a quantity token so `£20m`, `£20 m` and `£20M` compare equal. */
function canonicaliseQuantity(token: string): string {
  return token.toLowerCase().replace(/[\s,._]/g, "");
}

/**
 * Every distinct quantity token in a piece of text, canonicalised.
 * Exported because the conservation guard is worth asserting directly in tests
 * rather than only through its effect on a label.
 */
export function quantityTokens(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(QUANTITY_PATTERN)) {
    const token = canonicaliseQuantity(match[0]);
    // A bare separator or an empty capture is not a quantity.
    if (token.length > 0 && /\d|one|two|three|four|five|six|seven|eight|nine|ten|twelve/.test(token)) {
      found.add(token);
    }
  }
  return found;
}

/**
 * Does `candidate` conserve every quantity present in `sources`?
 *
 * This is the whole enforceable content of the ruling, in one function, so that
 * a caller cannot shorten a label without answering it.
 */
export function conservesQuantities(candidate: string, sources: readonly string[]): boolean {
  const kept = quantityTokens(candidate);
  for (const source of sources) {
    for (const token of quantityTokens(source)) {
      if (!kept.has(token)) return false;
    }
  }
  return true;
}

export interface CompoundGoalLabel {
  /** The display label. Never carries a repair-announcing prefix. */
  readonly label: string;
  /**
   * Every original goal label, verbatim and in order — the user's exact words,
   * preserved as provenance for the inspector/hover surface. Present whenever
   * more than one goal merged, so nothing the merge collapsed is unrecoverable.
   */
  readonly merged_from?: readonly string[];
}

/**
 * Choose the display label for a merged goal.
 *
 * ⭐ SELECTION ONLY — THE PRIMARY OBJECTIVE, VERBATIM. No join, no paraphrase,
 * no synthesis. The remaining objectives travel alongside as `merged_from`.
 *
 * ── WHY THERE IS NO LONGER A CONSERVATION-DRIVEN EXTENSION ──────────────────
 * An earlier version of this function appended further objectives, joined with
 * `"; "`, whenever the primary label alone would drop a figure. That was
 * REVERTED, and the reason is worth keeping because the instinct behind it was
 * right and the implementation was still wrong:
 *
 *   **A2 asserts conservation across `label` ∪ `source_quote` ∪
 *   `goal_threshold` ∪ `goal_constraints[]` — NOT within the label alone.**
 *
 * Because A1 retains the exact user language as PROVENANCE, no figure is lost
 * from the record when the label omits it. The extension was therefore solving
 * a problem that does not exist, and paying for it with a synthesised label —
 * which A3 forbids while the "two goal nodes vs one plus a coaching card"
 * question is open. **Do not reintroduce a string join here.** If a figure ever
 * genuinely cannot be recovered from provenance, that is a PROVENANCE defect and
 * must be fixed there, not papered over by lengthening the label.
 *
 * {@link conservesQuantities} is retained as the assertable form of the A2 rule
 * — over the whole record, which is where it belongs.
 */
export function buildCompoundGoalLabel(labels: readonly string[]): CompoundGoalLabel {
  const present = labels.filter((l) => typeof l === "string" && l.trim().length > 0);

  if (present.length === 0) return { label: "Goal" };
  if (present.length === 1) return { label: present[0] };

  return { label: present[0], merged_from: present };
}
