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
  /** TRUE when brevity was declined because a shorter label would drop a figure. */
  readonly label_extended_for_conservation?: boolean;
}

/**
 * Choose the display label for a merged goal.
 *
 * Selection, not paraphrase (see A7 above):
 *   1. The PRIMARY goal's label is the candidate — it is already one of the
 *      user's own authored objectives, and it is the node that survives.
 *   2. If it conserves every quantity across all merged labels, it is used as-is.
 *   3. Otherwise the objectives carrying the missing figures are appended, in
 *      their original order, until conservation holds.
 *
 * In every case the verbatim originals travel alongside as `merged_from`.
 */
export function buildCompoundGoalLabel(labels: readonly string[]): CompoundGoalLabel {
  const present = labels.filter((l) => typeof l === "string" && l.trim().length > 0);

  if (present.length === 0) return { label: "Goal" };
  if (present.length === 1) return { label: present[0] };

  const primary = present[0];
  const others = present.slice(1);

  if (conservesQuantities(primary, present)) {
    return { label: primary, merged_from: present };
  }

  // Brevity would cost a figure. Keep the clauses that carry the missing ones —
  // and only those, so the label grows by exactly what truthfulness requires.
  const parts = [primary];
  for (const other of others) {
    if (conservesQuantities(parts.join("; "), present)) break;
    const missing = [...quantityTokens(other)].some(
      (token) => !quantityTokens(parts.join("; ")).has(token),
    );
    if (missing) parts.push(other);
  }

  return {
    label: parts.join("; "),
    merged_from: present,
    label_extended_for_conservation: true,
  };
}
