/**
 * ⭐⭐ WHICH OPTIONS A COMPARATIVE CLAIM IS ACTUALLY ABOUT.
 *
 * Every comparative sentence this product emits is implicitly scoped: *"X
 * performs best"* means *"best OF THE ONES WE COMPARED"*. Nothing on the wire
 * said what that set was, so a consumer could not tell a claim over the whole
 * roster from a claim over three of five.
 *
 * ⛔ A claim scoped to a subset, presented as though scoped to the whole, is a
 * false claim made entirely out of true parts. That is the defect this closes,
 * and it is why the honest answer is a SET rather than a count.
 *
 * ── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * ⚠ NOT a ranking, not a recommendation, and not a licence to name anything.
 * It answers "which options is this result about" and nothing else. Whether a
 * leader may be NAMED is `leader_claim`'s question; how stable the result is,
 * `robustness`'s. Borrowing across them is how a scope becomes a recommendation.
 *
 * ── WHY IT IS BUILT FROM RAW RECORDS AND NOT FROM `win_probabilities` ──────
 * ⛔ `result.win_probabilities` is RIGHT THERE and already persisted, and it is
 * the wrong source: `extractWinProbabilities` keys it by `option_label` FIRST
 * and only falls back to `option_id`, so on an ordinary run its keys are DISPLAY
 * STRINGS. A rename is invisible to the analysis-affecting hash, so two runs
 * differing only in a label would read as different options. `build-run-delta.ts`
 * documents this at length for exactly the same reason and reaches for exactly
 * the same raw source.
 *
 * ⚠ AND NOT `optionRosterFromGraph` for the roster half — that one returns
 * LABELS by construction. `extractGraphOptionIds` is the id-bound reader, and it
 * returns `null` (not `[]`) when the graph carries no options source at all,
 * which is the distinction this module depends on.
 */
import {
  isUsableWinProbability,
  winnerOptionResultSource,
} from '../../orchestrator/context/option-result-source.js';
import { extractGraphOptionIds } from '../context/option-identity.js';

/** The producer-side shape. Mirrors `AnalysisComparisonScopeSchema`. */
export interface ComparisonScope {
  readonly ranked_option_ids: readonly string[];
  readonly unranked_option_ids?: readonly string[];
}

/**
 * The option ids this analysis actually ranked.
 *
 * ⚠ A DUPLICATE ID DROPS BOTH ENTRIES. If two records claim one id we cannot
 * tell which is which, and keeping either would attach a rank to an option by
 * guess. Fail-closed — the same rule `identityBoundWinProbabilities` already
 * applies to the same records.
 */
function rankedOptionIds(enrichment: Record<string, unknown>): readonly string[] {
  const seen = new Map<string, number>();
  for (const entry of winnerOptionResultSource(enrichment)) {
    const id = entry.option_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    // A record with no usable probability was not RANKED — it was present.
    // The shared predicate is imported, never restated: a second inequality
    // here would be free to drift from the one the winner is chosen by.
    if (!isUsableWinProbability(entry.win_probability)) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n === 1).map(([id]) => id);
}

/**
 * Derive the comparison scope, or `undefined` when none can be stated.
 *
 * ⚠⚠ ABSENCE IS DISTINCT, IN BOTH DIRECTIONS, AND BOTH DIRECTIONS ARE LOAD-BEARING.
 *
 *  - `undefined` ⇒ **no scope was computed**. It must NEVER be read as "every
 *    option was ranked". A consumer that narrates a comparative claim as
 *    covering the whole roster on the strength of a missing field has invented
 *    the very assurance this module exists to supply.
 *  - `ranked_option_ids: []` ⇒ the analysis ranked NOTHING. That is a real
 *    state, and a different one.
 *  - `unranked_option_ids` absent ⇒ the difference was not computable, because
 *    the graph carried no options source. `[]` ⇒ nothing was left out. Those
 *    are different sentences and the consumer needs both available to it.
 */
export function deriveComparisonScope(
  enrichment: unknown,
  graph: unknown,
): ComparisonScope | undefined {
  if (enrichment === null || typeof enrichment !== 'object') return undefined;
  const ranked = rankedOptionIds(enrichment as Record<string, unknown>);
  if (ranked.length === 0) return undefined;

  const roster = extractGraphOptionIds(graph);
  if (roster === null) return { ranked_option_ids: ranked };

  const rankedSet = new Set(ranked);
  // Order follows the ROSTER, not the result records: the roster is the stable
  // reading order a person sees, and a set difference has no inherent order to
  // inherit. De-duplicated because a malformed roster may repeat an id.
  const unranked = [...new Set(roster)].filter((id) => !rankedSet.has(id));
  return { ranked_option_ids: ranked, unranked_option_ids: unranked };
}

/**
 * Read the comparison scope from the response BODY AS IT WILL SHIP.
 *
 * ⚠ THE BODY, NOT THE FACT — and deliberately, for the same reason
 * `readRawRobustnessFromResponseBody` does it: this field describes what the
 * CONSUMER can verify from what it received. If the analysis block was not
 * shipped on this turn, the consumer cannot check any comparative claim against
 * it, and the honest answer is that no scope was stated — not a scope derived
 * from a fact the consumer never saw.
 *
 * Walks blocks the same way its sibling does. First block carrying an
 * enrichment from which a scope can be derived wins; `undefined` otherwise.
 */
export function readComparisonScopeFromResponseBody(
  response: unknown,
  graph: unknown,
): ComparisonScope | undefined {
  if (response == null || typeof response !== 'object') return undefined;
  const blocks = (response as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (block == null || typeof block !== 'object') continue;
    const enrichment = (block as { enrichment?: unknown }).enrichment;
    if (enrichment == null || typeof enrichment !== 'object') continue;
    const scope = deriveComparisonScope(enrichment, graph);
    if (scope !== undefined) return scope;
  }
  return undefined;
}
