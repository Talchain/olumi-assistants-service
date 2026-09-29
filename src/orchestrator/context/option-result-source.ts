/**
 * Single source of truth for "which array carries the option-level results",
 * with CURRENT-first precedence (M1, Codex r2 pre-merge review).
 *
 * Winner derivation was duplicated across FOUR surfaces, each re-implementing
 * source precedence independently:
 *   - decision-review-enricher.buildInvokeInput   (walks every source)
 *   - analysis-result-headline.resolveWinner        (walks every source)
 *   - analysis-compact.getResultsArray              (first non-empty source)
 *   - analysis-state.getOptionResultCandidates      (first non-empty source)
 *
 * The decompose-hardening PR flipped only the first two to current-first,
 * leaving the last two legacy-first — so on a both-present-conflicting
 * envelope the review/headline named one winner while the coach context-pack /
 * explanations / chips named the stale legacy one.
 *
 * This module is the ONE ordered-source reader all four winner surfaces
 * consume. Consistency requires BOTH the same precedence AND the same WALK
 * semantics keyed on ONE shared predicate: {@link winnerOptionResultSource}
 * (compact + state), the headline `resolveWinner`, and the enricher
 * `selectWinner`/`highestWinProbability` all SKIP a source that cannot supply a
 * {@link isUsableWinProbability} winner and fall through to the next. A plain
 * first-non-empty read would NOT agree — on a thin-CURRENT envelope
 * (option_comparison entries with id/label but NO win_probability, while
 * results[] carries win_probability) it keeps the thin source and coerces the
 * winner to 0%. Round-3/4 review: the walk (on the shared predicate) is the
 * invariant, not merely the ordering.
 *
 * STRATEGY SPLIT (pre-existing, intentional — documented so it is not mistaken
 * for a bug): the enricher and headline honour PLoT's declared
 * `leading_option_id` (id-match, walking to the source that carries it), while
 * compact + state pick the highest-probability option in the walked-to source
 * (their `response` is the enrichment, which does not carry leading_option_id;
 * the primary production path uses compact's analytical winner without leader
 * reconciliation). When the declared leader IS the highest-probability option,
 * or when there is no leader, all four name the same option; when the leader is
 * deliberately NOT the highest, the leader-honouring pair and the
 * highest-probability pair name different options — by design. What this walk
 * guarantees for EVERY shape is that no surface emits a coerced 0% / phantom
 * winner from a thin source.
 *
 * Precedence (current-first). `option_comparison` is the current PLoT V2 shape;
 * `results` is the legacy / UI-normalised copy that can carry a stale winner:
 *   1. top-level `option_comparison[]`         — current PLoT V2 shape
 *   2. top-level `results[]`                    — legacy / UI-normalised copy
 *   3. nested `results.option_comparison[]`     — UI wraps V2 fields in a
 *                                                 results-as-object envelope
 *   4. nested `results.options[]`
 *   5. nested `results.option_results[]`
 *   6. `decision_brief.options[]`               — leanest brief-shape fallback
 *
 * Each candidate is filtered to object entries; only non-empty arrays are
 * returned. The union of shapes is deliberately a SUPERSET of every prior
 * consumer's coverage, so single-sourcing regresses none of them.
 */

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function filterObjectEntries(arr: readonly unknown[]): ReadonlyArray<Record<string, unknown>> {
  return arr.filter(
    (r): r is Record<string, unknown> =>
      r !== null && typeof r === 'object' && !Array.isArray(r),
  );
}

/**
 * Return every non-empty option-result source from an analysis envelope, in
 * current-first precedence order. Walk-style consumers (the enricher +
 * headline) iterate every source to honour PLoT's declared leader whenever ANY
 * source carries it; the winner consumers (compact + state) walk to the first
 * source carrying a usable win_probability (see {@link winnerOptionResultSource}).
 *
 * Returns `[]` only when no source is present or non-empty.
 */
export function readOptionResultSources(
  envelope: Record<string, unknown>,
): ReadonlyArray<ReadonlyArray<Record<string, unknown>>> {
  const sources: Array<ReadonlyArray<Record<string, unknown>>> = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v) && v.length > 0) {
      const entries = filterObjectEntries(v);
      if (entries.length > 0) sources.push(entries);
    }
  };

  // 1. current PLoT V2 shape, 2. legacy / UI-normalised array copy.
  push(envelope.option_comparison);
  push(envelope.results);

  // 3–5. UI may wrap the V2 fields inside `results` as an OBJECT.
  const nestedResults = readRecord(envelope.results);
  if (nestedResults !== null) {
    push(nestedResults.option_comparison);
    push(nestedResults.options);
    push(nestedResults.option_results);
  }

  // 6. leanest brief-shape fallback.
  const decisionBrief = readRecord(envelope.decision_brief);
  if (decisionBrief !== null) {
    push(decisionBrief.options);
  }

  return sources;
}

/**
 * The SINGLE shared "usable win_probability" predicate (round-4 review
 * MAJOR-A). A win_probability is usable iff it is a finite number in [0, 1] —
 * a valid probability. ALL winner-identity selectors key on THIS one predicate
 * so they can never diverge on a degenerate envelope:
 *   - `winnerOptionResultSource` (below, via hasUsableWinProbability),
 *   - the headline `resolveWinner` per-source acceptance,
 *   - the enricher `selectWinner` (leader-matched entry) and
 *     `highestWinProbability` (null-leader + runner-up).
 * The [0,1] bound (not merely finite) is deliberate: it preserves the headline's
 * out-of-range fallback — a stray 1.5 "probability" is rejected, never rendered
 * as "150%". The re-review flagged that winnerOptionResultSource's old
 * finite-only predicate was NOT identical to the headline's finite+range check;
 * this unifies them.
 */
export function isUsableWinProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** True when at least one entry carries a usable `win_probability`. */
function hasUsableWinProbability(source: ReadonlyArray<Record<string, unknown>>): boolean {
  return source.some((r) => isUsableWinProbability(r.win_probability));
}

/**
 * The WINNER source: the first option-result source (current-first) that
 * carries at least one usable `win_probability`. The read for the "pick one
 * array and derive the winner from it" consumers (analysis-compact,
 * analysis-state).
 *
 * WALKS current-first (round-3 review MAJOR-1): a thin CURRENT source
 * (option_comparison entries with id/label but NO win_probability) is SKIPPED so
 * a richer downstream source (typically the legacy `results[]`, which carries
 * win_probability) supplies the winner — instead of keeping the thin entries
 * and coercing the winner's win_probability to 0 (a 0% winner / 0 margin). This
 * mirrors the enricher null-leader for-loop and the headline `resolveWinner`
 * raw-read-and-continue-on-null logic, so all four winner surfaces agree even on
 * the thin-current envelope class that M1 targets.
 *
 * On a both-present-conflicting envelope where BOTH sources carry
 * win_probability, current-first still wins (the fresh option_comparison beats
 * the stale results copy).
 *
 * Falls back to the first non-empty source when NO source carries a usable
 * win_probability at all (so an identity-only / probability-less envelope still
 * yields options for labels; the winner then legitimately coerces to 0, matching
 * the pre-existing no-probability behaviour).
 */
export function winnerOptionResultSource(
  envelope: Record<string, unknown>,
): ReadonlyArray<Record<string, unknown>> {
  const sources = readOptionResultSources(envelope);
  for (const source of sources) {
    if (hasUsableWinProbability(source)) return source;
  }
  return sources[0] ?? [];
}
