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

/**
 * PLoT #416's code for a run that withheld its per-option goal figures (a declared identity on the goal's path was not
 * evaluated). ONE definition: the Agent lane re-exports it (`goal-chance-withheld.ts`).
 */
export const GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED = 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED';

/**
 * PLoT #422's code for a run that withheld its goal figures because the user's own link size on the goal's path was cut
 * to fit the model's scale (AIQ 5893355501). Same carrier and the same withheld set as #416; the reason is in `message`.
 */
export const GOAL_FIGURES_USER_EFFECT_CLAMPED = 'GOAL_FIGURES_USER_EFFECT_CLAMPED';

/**
 * CEE's code for a run whose goal figures it withheld because an option's path into the goal runs through a link nobody
 * sized (DL #75 5902570568 (S); AIQ 5902548598). Written by `run_analysis` (`withholdOptionGoalFigures`), never by
 * PLoT; it names the options in `option_ids` and the unsized links in `node_ids`. An option with no such path (the
 * status quo) keeps its chance, so unlike #416 it is PER OPTION; the win shares and the leader go with it.
 */
export const GOAL_FIGURES_PLACEHOLDER_PATH = 'GOAL_FIGURES_PLACEHOLDER_PATH';

/**
 * CEE's code for a run whose goal figures it withheld because the user's own levels make the goal a rate × count product
 * the run did not evaluate (Gate 5, DL #75 5904272507; `agent-lane/unread-goal-product.ts`). Written by `run_analysis`,
 * never by PLoT, for EVERY option (`option_ids`); `node_ids` names the goal and its two parts.
 */
export const GOAL_FIGURES_PRODUCT_NOT_READ = 'GOAL_FIGURES_PRODUCT_NOT_READ';

/**
 * CEE's code for a run whose goal figures it withheld because the goal's target can't be tested yet (DECISION-
 * REPRESENTATION row 4, `targetTestabilityOf`; AIQ #2371 5914730220). Written by `run_analysis` for EVERY option, the
 * leader and shares too; `node_ids` names the goal. The message is the DR sentence, with its one question.
 */
export const GOAL_FIGURES_TARGET_NOT_TESTABLE = 'GOAL_FIGURES_TARGET_NOT_TESTABLE';

/**
 * ⛔ DL gate 1 v2 (Science 0df0e1, 5 Oct): an option whose RUN outcome is identical to the explicit baseline's
 * (`identical-to-baseline.ts`). The duplicate splits the baseline's wins (ISL ties split 1/len(winners)), so every
 * comparison claim this Run computed — shares, leader, robustness, flips — is distorted. Written by `run_analysis`
 * for the identical arms; the leader and every share go with it. Outcome distributions stay (keepOutcome).
 */
export const GOAL_FIGURES_OPTIONS_IDENTICAL = 'GOAL_FIGURES_OPTIONS_IDENTICAL';

/**
 * ⭐ D3 step 1 (DL 0df0e1, PL rec 5): a goal chance that is not a finite probability in [0, 1] of meeting a STATED target
 * (target, direction, unit; a ceiling scored minimised). Written by `run_analysis` (`goal-chance-gate.ts`) for the
 * options it names, each with its typed cause; the ordering and the outcome stay (the target claims only).
 */
export const GOAL_FIGURES_PROBABILITY_UNUSABLE = 'GOAL_FIGURES_PROBABILITY_UNUSABLE';

/** Every typed code that means "the run withheld its per-option goal figures" (AIQ 5893824972: a code SET, PLoT's words). */
export const GOAL_FIGURES_WITHHELD_CODES: ReadonlySet<string> = new Set([
  GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
  GOAL_FIGURES_USER_EFFECT_CLAMPED,
  GOAL_FIGURES_PLACEHOLDER_PATH,
  GOAL_FIGURES_PRODUCT_NOT_READ,
  GOAL_FIGURES_TARGET_NOT_TESTABLE,
  GOAL_FIGURES_OPTIONS_IDENTICAL,
  GOAL_FIGURES_PROBABILITY_UNUSABLE,
]);

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
  // ⛔ ABSENT STAYS ABSENT (AIQ 5886457733; DL 5886379820; PR Review CR @ e4c7f366): when the run WITHHELD its per-option
  // goal figures, ONLY the current carrier is read — `option_comparison` (top level, or as the UI nests it) — and nothing
  // when it is absent or empty. A downstream copy (`results[]`, `results.options`, `results.option_results`,
  // `decision_brief.options`) is never read in its place, even as the first array present.
  if (runWithheldGoalFigures(envelope)) {
    const current = [envelope.option_comparison, readRecord(envelope.results)?.option_comparison]
      .map((v) => (Array.isArray(v) ? filterObjectEntries(v) : []))
      .find((entries) => entries.length > 0);
    return current === undefined ? [] : [current];
  }
  return readEverySource(envelope);
}

/**
 * The run's typed decision that its per-option goal figures are withheld (PLoT #416's ONE carrier: an
 * `inference_warnings` entry whose code is in GOAL_FIGURES_WITHHELD_CODES — #416's or #422's). The code decides, never the words.
 */
export function runWithheldGoalFigures(envelope: Record<string, unknown>): boolean {
  return goalFiguresWithheldWarning(envelope) !== undefined;
}

/** That warning (the first), or `undefined`. */
export function goalFiguresWithheldWarning(envelope: Record<string, unknown>): Record<string, unknown> | undefined {
  return goalFiguresWithheldWarnings(envelope)[0];
}

/** EVERY goal-figure withhold on the envelope, in carrier order (RT-10 B′: a reader that must not depend on order). */
export function goalFiguresWithheldWarnings(envelope: Record<string, unknown>): Record<string, unknown>[] {
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [];
  return filterObjectEntries(warnings).filter((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code));
}

/**
 * Every option whose identity is STRUCTURALLY SAFE, mapped to its win
 * probability.
 *
 * ⚠ WHY NOT `result.win_probabilities`, WHICH IS RIGHT THERE AND ALREADY
 * PERSISTED. Because it is LABEL-KEYED. `run-analysis.ts` (`extractWinProbabilities`)
 * (`extractWinProbabilities`) keys that record by `option_label` FIRST and only
 * falls back to `option_id`, so on any ordinary run its keys are DISPLAY
 * STRINGS. `RunDeltaWinProbabilityDeltaSchema.option_id` is identity-bound —
 * *"Option id — identity-bound (trap 19), never a label"* — and feeding labels
 * into it would reintroduce exactly the defect `compare-runs.ts` documents at
 * length: a rename is invisible to the analysis-affecting hash, so two runs
 * that differ only in a label would be reported as different options.
 *
 * ⚠ AND NOT `compactAnalysis(...).summary.options[]` either: that projection
 * carries the SAME `option_id <- option_label` fallback, which is precisely why
 * `readLeaderOptionId` exists to confirm the winner's id against the raw
 * records. Only the raw source plus an explicit id check is safe.
 *
 * A DUPLICATE ID DROPS BOTH ENTRIES. If two records claim one id we cannot tell
 * which is which, and picking either would attach a number to an option by
 * guess. Fail-closed.
 *
 * ONE identity rule, shared: the run-delta producer reads a Run's shares with it, and the goal-figure withholder
 * ({@link withholdOptionGoalFigures}'s `win_shares_withheld`) asks it whether there were any shares to remove.
 */
export function identityBoundWinProbabilities(
  enrichment: Record<string, unknown>,
): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  const ambiguous = new Set<string>();

  for (const entry of winnerOptionResultSource(enrichment)) {
    const id = entry.option_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    // The SHARED predicate, imported rather than re-implemented: a usable
    // win probability is a finite number in [0, 1]. Re-stating that inequality
    // here would be a second definition free to drift from the first.
    if (!isUsableWinProbability(entry.win_probability)) continue;
    if (found.has(id)) {
      ambiguous.add(id);
      continue;
    }
    found.set(id, entry.win_probability);
  }

  for (const id of ambiguous) found.delete(id);
  return found;
}

/**
 * Did this Run's goal-figure withholder REMOVE win shares it had? True only on a typed record: a
 * `GOAL_FIGURES_WITHHELD_CODES` warning carrying `win_shares_withheld: true`, which `withholdOptionGoalFigures` sets
 * only when the envelope held ≥1 identity-bound usable share before the withhold. A code alone proves the goal
 * figures were withheld, never that shares existed (PLoT may have sent none). A Run recorded before the marker
 * existed answers `false`: its cause is unknown, so no cause is claimed from it.
 */
export function runWithheldWinShares(envelope: Record<string, unknown>): boolean {
  const warnings = Array.isArray(envelope.inference_warnings) ? envelope.inference_warnings : [];
  return filterObjectEntries(warnings).some((w) => typeof w.code === 'string' && GOAL_FIGURES_WITHHELD_CODES.has(w.code)
    && w.win_shares_withheld === true);
}

function readEverySource(
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

/** Append a structured producer warning without letting string composers read its carrier. */
export function appendInferenceWarning<E>(envelope: E, warning: Record<string, unknown>): E {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return envelope;
  const current = envelope as Record<string, unknown>;
  return { ...current, inference_warnings: [
    ...(Array.isArray(current.inference_warnings) ? current.inference_warnings : []), warning,
  ] } as E;
}
