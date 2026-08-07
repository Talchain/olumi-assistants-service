/**
 * V5 state-trust — analysis freshness derivation.
 *
 * Replaces the unconditional "loaded_from_prior_run_freshness_unknown"
 * fallback in turn-executor.ts with a deterministic decision based on
 * comparing the graph hash at the time `run_analysis` executed against
 * the current graph hash.
 *
 * Inputs (read-only):
 *   - priorFacts: the handler-fact chain loaded for this turn
 *   - currentGraphHash: hash of the analysis-affecting fields of the
 *     graph this turn is running against (from
 *     computeAnalysisAffectingGraphHash on the turn's graph_state)
 *
 * Output: FreshnessDerivation — the freshness verdict plus its reason
 * and the selected fact's metadata. The verdict drives:
 *   - analysis_ready.freshness on the wire
 *   - rerun-chip emission (only when 'stale')
 *   - analysis_ready.computed_at (uses the selected fact's computed_at,
 *     not Date.now)
 *   - the TurnOutcome internal contract
 *
 * Side-effect split:
 *   - `deriveAnalysisFreshness`, `selectRunAnalysisFact`, and
 *     `enforceInvariants` are PURE functions. No I/O, no telemetry, no
 *     reads from disk or env. All decisions derive from the inputs
 *     alone — replacing them in tests is a function call, not a mock
 *     injection.
 *   - `emitFreshnessTelemetry` is the SIDE-EFFECTING companion. It
 *     emits the full event family (derived / fact_selected /
 *     invariant_failed / graph_hash_missing / first_turn_assumed
 *     when relevant) for a single derivation. Lives in this module so
 *     the event-family logic stays adjacent to the verdict types;
 *     production call sites decide when to emit (most call once per
 *     derivation; tests may skip emitting entirely).
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { emit, TelemetryEvents } from '../../utils/telemetry.js';
import {
  compareAnalysedOptionIdentity,
  extractAnalysedLeaderId,
  extractAnalysedOptionIds,
} from './option-identity.js';

/**
 * Four-valued freshness state. Reachable from new code paths only as
 * 'fresh' / 'stale' / 'none'; 'unknown' is the legacy/recovery escape
 * hatch for pre-0.10.0 facts and invariant-violation fallback.
 */
export type AnalysisFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

/**
 * Reasons emitted in `FreshnessDerivation.reason`. Stable string codes —
 * UI consumers may surface them via `analysis_ready.freshness_reason`,
 * telemetry filters by exact equality, contract tests assert by name.
 */
export type FreshnessReason =
  | 'graph_hash_match'
  | 'graph_hash_diverged'
  | 'legacy_fact_missing_hash'
  | 'current_graph_hash_unavailable'
  | 'no_successful_run_analysis_fact'
  | 'invariant_failed'
  /** Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD): the analysed
   *  option identities on the selected fact no longer match the current graph's
   *  option IDs, so a hash-impossible `unknown` verdict is forced to `stale`
   *  (fail closed). Only reachable when the guard is enabled, the caller
   *  threaded current graph option IDs, AND the hash comparison could not run
   *  (legacy fact missing hash / current graph hash unavailable). NEVER
   *  reachable from a hash-proven `fresh` verdict — identical hashes ⇒ fresh,
   *  by construction (F10 root, ROADMAP 1.133): the analysis-affecting hash
   *  already covers options[].id, while the analysed identifiers on the fact
   *  come from the PLoT enrichment namespace and can legitimately differ from
   *  graph option IDs on byte-identical input. */
  | 'analysed_options_diverged'
  /** Dispatcher attempted derivation and failed (session-store error,
   *  bad graph parse, etc.). Honours the "always emit freshness"
   *  contract instead of dropping the wire fields silently. */
  | 'derivation_failed';

/**
 * Verdict + provenance. `computed_at` is the selected fact's run-time
 * timestamp, threaded into analysis_ready so explain/direct-answer turns
 * cannot restamp it.
 */
export interface FreshnessDerivation {
  readonly freshness: AnalysisFreshness;
  readonly reason: FreshnessReason;
  /**
   * Position of the selected fact within the EXACT array passed to
   * `deriveAnalysisFreshness` — which is caller-defined, NOT a global
   * ordering. Most callers pass `prior_facts` (newest-first per the
   * build-turn-context loader), but the turn-executor post-handler path
   * derives against the unified `[...handlerFactsForCommit, ...prior_facts]`
   * array, so the index is relative to that. Consumers MUST resolve the fact
   * against the same array they passed in, or — preferably — re-resolve by
   * content via `selectRunAnalysisFact` and treat this index as a cross-check
   * only (see compose.ts `selectPriorRunAnalysisFact`). Null when no
   * successful fact was selected. Used as a stable identifier in telemetry;
   * the schemas package does not surface fact row UUIDs through `readFactsFor`,
   * so position-in-array is the available deterministic key.
   */
  readonly selected_fact_index: number | null;
  readonly graph_hash_at_run: string | null;
  readonly current_graph_hash: string | null;
  /** ISO timestamp from the selected fact's `computed_at`. Null when
   *  no fact was selected, or selected fact predates 0.10.0. */
  readonly computed_at: string | null;
}

/**
 * Canonical successful analysis statuses. After normalisation
 * (`normaliseAnalysisStatus`), only these values count as eligible for
 * freshness selection. Anything else — partial, blocked, failed,
 * degraded, future PLoT statuses (e.g. 'inconclusive', 'incomplete'),
 * or any other non-canonical string — is excluded.
 *
 * Status missing entirely (legacy pre-0.10.0 fact) is treated as
 * eligible separately by the selector, since pre-0.10.0 facts predate
 * the status field's existence on the persisted shape.
 *
 * Why allowlist + normalisation rather than denylist: the original
 * round used a denylist to accommodate pre-existing fixtures using
 * `'complete'` (singular) and `'ok'`. That left silent acceptance of
 * any future non-canonical status. Normalisation handles the historical
 * non-canonical values explicitly while keeping a closed allowlist for
 * forward safety.
 */
const SUCCESSFUL_ANALYSIS_STATUSES = new Set([
  'computed',
  'completed',
  'ready',
]);

/**
 * Map historical / non-canonical analysis_status values to the
 * canonical success set. Returns null for unknown / non-canonical
 * values so the selector can treat them as ineligible.
 *
 * Aliases handled:
 *   - 'complete' (singular) → 'completed'
 *   - 'ok' / 'success' → 'completed'
 * Whitespace and case are normalised before lookup.
 */
function normaliseAnalysisStatus(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return null;
  if (SUCCESSFUL_ANALYSIS_STATUSES.has(trimmed)) return trimmed;
  switch (trimmed) {
    case 'complete':
      return 'completed';
    case 'ok':
    case 'success':
      return 'completed';
    default:
      return null;
  }
}

/**
 * Public projection of a selected run_analysis fact. Carries the
 * underlying fact reference so the projection assembler can reach into
 * `result.enrichment` etc., plus the freshness-relevant metadata so the
 * derivation does not re-read.
 *
 * Index is the fact's position in the input array (newest-first per
 * loader convention). Used as a stable identifier within a single turn
 * — the @talchain/schemas HandlerFact type does not surface a row id
 * (deferred follow-up).
 */
export interface SelectedRunAnalysisFact {
  readonly fact: HandlerFact;
  readonly index: number;
  readonly graph_hash_at_run: string | null;
  readonly computed_at: string | null;
  readonly status: string | null;
}

// Internal alias retained for back-compat within this module.
type RunAnalysisFactView = SelectedRunAnalysisFact;

function readAnalysisStatus(enrichment: unknown): string | null {
  if (!enrichment || typeof enrichment !== 'object') return null;
  const raw = (enrichment as Record<string, unknown>).analysis_status;
  return typeof raw === 'string' ? raw : null;
}

function isRunAnalysisFact(
  fact: HandlerFact,
): fact is HandlerFact & { fact_type: 'run_analysis' } {
  return fact.fact_type === 'run_analysis';
}

function viewRunAnalysisFact(
  fact: HandlerFact,
  index: number,
): RunAnalysisFactView | null {
  if (!isRunAnalysisFact(fact)) return null;
  if (fact.noop !== false) return null;
  const result = fact.result;
  return {
    fact,
    index,
    graph_hash_at_run:
      typeof result.graph_hash_at_run === 'string' ? result.graph_hash_at_run : null,
    computed_at:
      typeof result.computed_at === 'string' ? result.computed_at : null,
    status: readAnalysisStatus(result.enrichment),
  };
}

/**
 * Single-source-of-truth predicate for "is this a successful run_analysis
 * fact?". Used by `selectRunAnalysisFact` (newest-first picker), the
 * compose-layer chip-generator (`findHandlerJustRan`,
 * `deriveProjectionStatus`), and any handler precondition that wants to
 * agree with the freshness derivation on what "successful" means.
 *
 * Eligibility:
 *   - Must be a `run_analysis` fact with `noop === false`.
 *   - Status must be missing entirely (legacy pre-0.10.0 fact) OR
 *     normalise to a canonical success (`computed | completed | ready`,
 *     plus the historical aliases handled by `normaliseAnalysisStatus`).
 *
 * Anything else — partial / blocked / failed / degraded / future
 * non-canonical PLoT statuses — returns false. This keeps "this turn has
 * a usable prior analysis" coherent across the routing, dispatch, and
 * compose layers.
 */
export function isSuccessfulRunAnalysisFact(fact: HandlerFact): boolean {
  if (!isRunAnalysisFact(fact)) return false;
  if (fact.noop !== false) return false;
  const status = readAnalysisStatus(fact.result.enrichment);
  if (status === null) return true; // legacy fact
  return normaliseAnalysisStatus(status) !== null;
}

/**
 * "Did the most recent run_analysis fact arrive in a non-success state?"
 * Returns the latest non-noop run_analysis fact whose status is present
 * and does NOT normalise to a canonical success. Used to distinguish the
 * "missing analysis" case (no run_analysis fact at all) from the
 * "degraded analysis" case (analysis ran but partial / blocked / failed)
 * so the explanation handlers can offer the right recovery copy.
 *
 * Sorted by computed_at desc, same convention as `selectRunAnalysisFact` —
 * and now BY that convention rather than alongside it.
 *
 * ⚠ THIS FUNCTION USED TO CARRY A BYTE-IDENTICAL PRIVATE COPY of the
 * computed_at-desc / nulls-last comparator, kept in step with the canonical one
 * by nothing but the sentence above. That is the fourth copy of one ordering
 * rule in this estate, in the same file as the docstring claiming there was
 * one — the "two agreeing copies plus a comment asserting they agree" pattern
 * that CLAUDE.md trap #12 is about, and it made the completeness claim on
 * {@link selectClaimBearingRunAnalysisFact} false.
 *
 * It now takes the ENTITLEMENT ordering (`requireSuccessfulStatus: false` — the
 * candidate set of all non-noop `run_analysis` facts, which is a superset of
 * the degraded ones) and filters to the degraded subset AFTER the shared sort.
 * Filtering a stably-sorted list preserves the relative order of what survives,
 * so this is order-identical to collect-then-sort — the equivalence is a
 * property of stable sort, not a coincidence to re-verify.
 *
 * Returns null when no degraded fact exists.
 */
export function selectDegradedRunAnalysisFact(
  priorFacts: readonly HandlerFact[],
): { readonly fact: HandlerFact; readonly status: string } | null {
  for (const view of orderRunAnalysisFacts(priorFacts, {
    requireSuccessfulStatus: false,
  })) {
    // "Degraded" = status PRESENT and not normalising to a canonical success.
    // A missing status is the legacy-success case, not a degradation.
    if (view.status === null) continue;
    if (normaliseAnalysisStatus(view.status) !== null) continue;
    return { fact: view.fact, status: view.status };
  }
  return null;
}

/**
 * Select the most recent successful run_analysis fact. "Successful" =
 * known-success status (computed / completed / ready) OR status missing
 * entirely (legacy fact). Sorted by computed_at desc; ties + missing
 * timestamps fall back to the insertion order from prior_facts (which
 * build-turn-context delivers newest-first per its loader convention).
 *
 * Returns null when no eligible fact exists — the caller treats this as
 * freshness === 'none'.
 *
 * Exported for the analysis-projection assembler so the projection and
 * the freshness verdict are always built from the SAME selected fact —
 * eliminating the pre-state-trust drift where buildAnalysisFromPriorFacts
 * picked the first non-noop fact while the freshness verdict picked the
 * latest successful one.
 */
export function selectRunAnalysisFact(
  priorFacts: readonly HandlerFact[],
): SelectedRunAnalysisFact | null {
  return selectNewestRunAnalysisFact(priorFacts, { requireSuccessfulStatus: true });
}

/**
 * ⭐ THE ENTITLEMENT SELECTOR — newest CLAIM-BEARING `run_analysis` fact,
 * chosen WITHOUT regard to analysis quality.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS SEPARATELY FROM {@link selectRunAnalysisFact}, AND WHY THAT
 * IS NOT THE SECOND-DERIVATION DEFECT.
 *
 * The two selectors answer DIFFERENT QUESTIONS, and the P0 this closes was
 * caused by one of them being used to answer the other:
 *
 *   - FRESHNESS asks "is this analysis good enough to build a result view
 *     from?" — `partial` / `degraded` / an unrecognised future status all mean
 *     NO, and excluding them is correct.
 *   - ENTITLEMENT asks "did an analysis make a claim, and what did its verdict
 *     say about naming a leader?" — and a `partial` analysis MAKES CLAIMS. The
 *     run_analysis handler accepts it (permissive accept matrix, resilience
 *     contract Part C), persists it, and may name a leading option from it.
 *
 * Composed, the quality filter silently deleted the entitlement question's
 * input: a `partial` fact carrying `may_name_leading_option: false` was
 * invisible, so `readMayNameLeadingOptionVerdict` took its `no analysis
 * exists ⇒ true` branch — the branch whose entire justification is "no claim
 * can be grounded, so nothing can leak", on an input where a claim HAD been
 * grounded and explicitly withheld. The fail-closed default was never wrong;
 * the SELECTOR made it unreachable.
 *
 * ⚠ AND THE FORWARD-COMPATIBILITY CLAUSE INVERTED. `selectRunAnalysisFact`
 * excludes statuses it does not recognise so a new PLoT status can never be
 * mistaken for success. Safe for freshness; the exact opposite here — the day
 * PLoT ships a new status string, every fact carrying it becomes entitled to
 * name a leader, with no CEE deploy and no alarm. A conservative rule in one
 * question is a fail-open in the other.
 *
 * ONE ORDERING, TWO FILTERS — and it now covers the COMPARISON PAIR too.
 * Every consumer that asks "which run_analysis fact is newest?" reaches the
 * single {@link orderRunAnalysisFacts} core:
 *
 *   - {@link selectRunAnalysisFact}            (freshness: newest SUCCESSFUL)
 *   - {@link selectClaimBearingRunAnalysisFact}(entitlement: newest CLAIM-BEARING)
 *   - {@link orderSuccessfulRunAnalysisFactsNewestFirst}
 *       → `coaching/compare-runs.ts:selectTwoNewestRunAnalysisFacts` (the
 *         prior/current PAIR) and `deriveRerunReadiness`'s count;
 *       → `signals/coaching-signals.ts:buildRerunDelta`, via
 *         {@link selectRunAnalysisFact}.
 *   - {@link selectDegradedRunAnalysisFact}   (the newest DEGRADED fact)
 *
 * The list is exhaustive as written: no other function in this estate orders
 * `run_analysis` facts. It was not exhaustive when first written — see the
 * warning below, and the one on `selectDegradedRunAnalysisFact`, which held a
 * fourth copy of the comparator in THIS FILE while this paragraph claimed
 * there was one.
 *
 * ⚠ THAT LAST ONE IS A CORRECTION, NOT A RESTATEMENT. Until #738 the pair
 * selector took `filter(isSuccessfulRunAnalysisFact)[0]` and `[1]` — by ARRAY
 * POSITION — so this paragraph's "true by construction" was FALSE of it: a
 * legacy fact carrying no `computed_at` (still "successful") sitting at window
 * position 0, or any `computed_at` skew, made the comparison's `current` a
 * DIFFERENT fact from the one whose hash grounded `freshness === 'fresh'`, and
 * with two skewed timestamps the prior/current roles — and every margin
 * direction derived from them — inverted. The claim is true now because the
 * pair IS this function, not because two copies were checked against each
 * other: two selectors answering two questions is DESIGN; two copies of one
 * ordering rule is the mirror defect (CLAUDE.md trap #12), and a docstring
 * asserting they agree is the mirror's alibi.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function selectClaimBearingRunAnalysisFact(
  priorFacts: readonly HandlerFact[],
): SelectedRunAnalysisFact | null {
  return selectNewestRunAnalysisFact(priorFacts, { requireSuccessfulStatus: false });
}

/**
 * ⭐ THE ONE ORDERING CORE. Every eligible `run_analysis` fact, newest-first.
 * `requireSuccessfulStatus` is the ONLY difference between the freshness and
 * entitlement selectors — the sort is shared, never copied.
 *
 * Exposed to consumers that need MORE than the head of the list (the
 * prior/current comparison pair) through
 * {@link orderSuccessfulRunAnalysisFactsNewestFirst}, so "the pair is ordered
 * the same way as the freshness fact" is a property of one function rather
 * than an agreement between two.
 */
function orderRunAnalysisFacts(
  priorFacts: readonly HandlerFact[],
  opts: { readonly requireSuccessfulStatus: boolean },
): RunAnalysisFactView[] {
  const candidates: RunAnalysisFactView[] = [];
  for (let i = 0; i < priorFacts.length; i += 1) {
    const fact = priorFacts[i]!;
    const view = viewRunAnalysisFact(fact, i);
    if (!view) continue;
    // Eligibility filter (FRESHNESS ONLY): status missing entirely (legacy
    // fact) is accepted; otherwise the value must normalise to a canonical
    // success. Everything else (partial / blocked / failed / degraded /
    // future PLoT statuses) is excluded.
    //
    // CALLS the exported predicate rather than re-testing the status inline:
    // `isSuccessfulRunAnalysisFact` is the same rule the compose layer and the
    // comparison-pair count use, and an inline copy here is exactly the mirror
    // that let the pair selector drift (CLAUDE.md trap #12).
    //
    // Deliberately NOT applied to the entitlement question — see
    // `selectClaimBearingRunAnalysisFact` for the P0 that earned this branch.
    if (opts.requireSuccessfulStatus && !isSuccessfulRunAnalysisFact(fact)) {
      continue;
    }
    candidates.push(view);
  }

  // Stable sort by computed_at desc, putting facts without computed_at
  // last. JavaScript Array.sort is stable in V8, so insertion order is
  // preserved among facts that compare equal (same timestamp or both
  // null) — and build-turn-context delivers newest-first, so the
  // first equal-keyed fact is the freshest by insertion.
  candidates.sort((a, b) => {
    if (a.computed_at !== null && b.computed_at !== null) {
      // Lexicographic ISO compare is correct for desc sort.
      if (a.computed_at < b.computed_at) return 1;
      if (a.computed_at > b.computed_at) return -1;
      return 0;
    }
    if (a.computed_at !== null) return -1; // a is fresher than untimestamped b
    if (b.computed_at !== null) return 1;
    return 0;
  });
  return candidates;
}

/**
 * The SUCCESSFUL run_analysis facts of this window, newest-first, under the
 * SAME ordering {@link selectRunAnalysisFact} uses — of which it is the head.
 *
 * Exists for `coaching/compare-runs.ts`, which needs the two newest rather
 * than the newest. Returning the ordered list (instead of exporting the
 * comparator, or a "second-newest" selector) is what makes
 * `pair.current === selectRunAnalysisFact(window)!.fact` hold by construction
 * for any window: same filter, same sort, same array.
 */
export function orderSuccessfulRunAnalysisFactsNewestFirst(
  priorFacts: readonly HandlerFact[],
): readonly SelectedRunAnalysisFact[] {
  return orderRunAnalysisFacts(priorFacts, { requireSuccessfulStatus: true });
}

/**
 * The CLAIM-BEARING run_analysis facts of this window, newest-first — the
 * ENTITLEMENT ordering, of which {@link selectClaimBearingRunAnalysisFact} is
 * the head. Same filter, same sort, same array, so "the newest claim-bearing
 * fact" and "the head of this list" are one fact by construction rather than by
 * two selectors agreeing (the property {@link orderSuccessfulRunAnalysisFactsNewestFirst}
 * exists to preserve, and for the same reason).
 *
 * Exists for ROADMAP 2.211's lens history (`compose/lens-history.ts`), which
 * needs the whole list rather than its head, and which must ask the ENTITLEMENT
 * question, not the freshness one: a lens is EMITTED with no status gate at all
 * (`compose.ts`'s current-turn branch gates only on `graph_hash_at_run`), so a
 * history built on the freshness filter would be blind to lenses that really
 * shipped — see that file's fact-set note.
 */
export function orderClaimBearingRunAnalysisFactsNewestFirst(
  priorFacts: readonly HandlerFact[],
): readonly SelectedRunAnalysisFact[] {
  return orderRunAnalysisFacts(priorFacts, { requireSuccessfulStatus: false });
}

/** The shared newest-first pick: the head of {@link orderRunAnalysisFacts}. */
function selectNewestRunAnalysisFact(
  priorFacts: readonly HandlerFact[],
  opts: { readonly requireSuccessfulStatus: boolean },
): SelectedRunAnalysisFact | null {
  return orderRunAnalysisFacts(priorFacts, opts)[0] ?? null;
}

function assertExhaustive(value: never): never {
  throw new Error(`unreachable freshness state: ${String(value)}`);
}

/**
 * A hard-invariant violation names the freshness value the enforcer must
 * coerce the derivation to. The reason is always overwritten with
 * 'invariant_failed' so telemetry surfaces the enforcement.
 */
interface HardInvariantViolation {
  readonly coerce_to: AnalysisFreshness;
}

/**
 * Validate post-derivation invariants. Returns null on pass, or the
 * coercion the enforcer must apply on fail.
 *
 * Soft invariants (monotonicity, previous-fresh) are NOT enforced here
 * because the previous-turn outcome is not reliably persisted yet
 * — they are checked by the turn-executor as telemetry warnings only.
 */
function checkHardInvariants(
  derivation: FreshnessDerivation,
): HardInvariantViolation | null {
  // Invariant 1: enum exhaustiveness. TypeScript already enforces this at
  // compile time via the union type, but a runtime guard catches any
  // sneaky `as unknown` upstream.
  switch (derivation.freshness) {
    case 'fresh':
    case 'stale':
    case 'unknown':
    case 'none':
      break;
    default:
      assertExhaustive(derivation.freshness);
  }

  // Invariant 2 (F10 root, ROADMAP 1.133): identical-hash ⇒ fresh, by
  // construction. If both hashes are present AND equal, the verdict MUST be
  // 'fresh' — a run's own response can never be stale versus the hash it just
  // analysed. Checked BEFORE invariant 3 so an identical-hash 'unknown' also
  // lands on 'fresh' (the hashes prove freshness; 'unknown' would discard
  // that proof). Coerce to 'fresh', never 'unknown'/'stale'.
  if (
    derivation.graph_hash_at_run !== null &&
    derivation.current_graph_hash !== null &&
    derivation.graph_hash_at_run === derivation.current_graph_hash &&
    derivation.freshness !== 'fresh'
  ) {
    return { coerce_to: 'fresh' };
  }

  // Invariant 3: if both hashes are present (and, per invariant 2, differ),
  // freshness must be 'fresh' or 'stale' — never 'unknown'. Unknown should
  // only fire when data is genuinely missing.
  if (
    derivation.graph_hash_at_run !== null &&
    derivation.current_graph_hash !== null &&
    derivation.freshness === 'unknown'
  ) {
    return { coerce_to: 'unknown' };
  }

  return null;
}

/**
 * Derive freshness for the current turn. Pure function, no side effects.
 *
 * Decision tree:
 *   - No successful run_analysis fact → none
 *   - Successful fact selected, missing graph_hash_at_run → unknown
 *     (legacy fact predating 0.10.0)
 *   - Successful fact selected, currentGraphHash null → unknown
 *     (graph absent on this turn)
 *   - Hashes match → fresh
 *   - Hashes differ → stale
 *
 * Option-identity guard (optional `currentGraphOptionIds`, gated by
 * `cee.optionIdentityFreshnessGuard` at the call sites): when provided, a
 * hash-impossible `unknown` verdict is downgraded to `stale` (reason
 * `analysed_options_diverged`) if the analysed option identities on the
 * selected fact no longer match the current graph's option IDs. This fails
 * closed on the recovered-session / unparseable-graph paths the hash cannot
 * reach. Passing `undefined` (the default — flag off) skips the guard entirely,
 * so behaviour is byte-identical to the two-argument form. `none` and already-
 * `stale` verdicts, and indeterminate option data, are left untouched.
 *
 * INVARIANT (F10 root, ROADMAP 1.133): identical-hash ⇒ fresh, by
 * construction. The guard is deliberately NOT consulted on the hash-proven
 * `fresh` path: the analysis-affecting graph hash already includes
 * options[].id, so equal hashes prove the option set is unchanged — whereas
 * the analysed identifiers on the fact (enrichment.option_comparison[]
 * .option_id / leading_option_id) come from the PLoT enrichment namespace and
 * can legitimately differ from graph option IDs on byte-identical input. The
 * former "defence-in-depth check on the fresh path" compared those two
 * namespaces and stamped a run's OWN response stale with identical hashes on
 * both sides (verified live, 16 Jul). `enforceInvariants` backstops this
 * structurally: a non-fresh verdict with equal non-null hashes is coerced to
 * `fresh`.
 *
 * Caller is responsible for emitting the `analysis_freshness.derived`
 * telemetry event with the returned derivation. The function does not
 * import or call telemetry to keep the unit-test surface minimal and
 * the function side-effect-free.
 */
export function deriveAnalysisFreshness(
  priorFacts: readonly HandlerFact[],
  currentGraphHash: string | null,
  currentGraphOptionIds?: readonly string[] | null,
): FreshnessDerivation {
  const selected = selectRunAnalysisFact(priorFacts);

  if (selected === null) {
    const noFact: FreshnessDerivation = {
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: null,
    };
    return enforceInvariants(noFact);
  }

  // Base verdict from the graph-hash comparison (unchanged logic).
  let base: FreshnessDerivation;
  if (selected.graph_hash_at_run === null) {
    base = {
      freshness: 'unknown',
      reason: 'legacy_fact_missing_hash',
      selected_fact_index: selected.index,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: selected.computed_at,
    };
  } else if (currentGraphHash === null) {
    base = {
      freshness: 'unknown',
      reason: 'current_graph_hash_unavailable',
      selected_fact_index: selected.index,
      graph_hash_at_run: selected.graph_hash_at_run,
      current_graph_hash: null,
      computed_at: selected.computed_at,
    };
  } else if (selected.graph_hash_at_run === currentGraphHash) {
    base = {
      freshness: 'fresh',
      reason: 'graph_hash_match',
      selected_fact_index: selected.index,
      graph_hash_at_run: selected.graph_hash_at_run,
      current_graph_hash: currentGraphHash,
      computed_at: selected.computed_at,
    };
  } else {
    base = {
      freshness: 'stale',
      reason: 'graph_hash_diverged',
      selected_fact_index: selected.index,
      graph_hash_at_run: selected.graph_hash_at_run,
      current_graph_hash: currentGraphHash,
      computed_at: selected.computed_at,
    };
  }

  // Option-identity guard. Only engaged when the caller threaded current graph
  // option IDs (flag on) AND the hash comparison was IMPOSSIBLE (the `unknown`
  // paths: legacy fact missing hash / current graph hash unavailable). A
  // genuine divergence fails closed to `stale`. `undefined` (flag off) → skip
  // → byte-identical.
  //
  // The guard MUST NOT run on the `fresh` path (identical-hash ⇒ fresh, by
  // construction — see the function docstring): equal hashes already prove the
  // option set unchanged, and the enrichment-namespace identifiers this guard
  // compares can differ from graph option IDs on byte-identical input, which
  // stamped a run's own response stale in production (F10).
  if (currentGraphOptionIds !== undefined && base.freshness === 'unknown') {
    const verdict = compareAnalysedOptionIdentity(
      extractAnalysedOptionIds(selected.fact),
      extractAnalysedLeaderId(selected.fact),
      currentGraphOptionIds ?? null,
    );
    if (!verdict.match) {
      base = { ...base, freshness: 'stale', reason: 'analysed_options_diverged' };
    }
  }

  return enforceInvariants(base);
}

/**
 * Run the hard-invariant enforcer on a candidate derivation. Returns
 * the derivation unchanged when invariants hold; otherwise returns a
 * coerced derivation with the violation's mandated freshness and
 * `reason: 'invariant_failed'`:
 *   - identical non-null hashes but not 'fresh' → coerced to 'fresh'
 *     (identical-hash ⇒ fresh, by construction — F10 root); NEVER 'stale',
 *     and never 'unknown' (which would discard the hashes' proof);
 *   - differing non-null hashes but 'unknown' → coerced to 'unknown'
 *     with the violation marker (NEVER 'stale').
 *
 * Exported for test injection — production code paths reach this only
 * via the regular `deriveAnalysisFreshness` decision tree (which is
 * exhaustive enough that no real input triggers a violation today). The
 * fallback stays in place as defence-in-depth against future code
 * changes that break the exhaustive tree.
 */
export function enforceInvariants(
  derivation: FreshnessDerivation,
): FreshnessDerivation {
  const violation = checkHardInvariants(derivation);
  if (violation === null) return derivation;
  // Hard invariant failed — coerce to the violation's mandated freshness and
  // overwrite the reason with the violation marker. Caller checks for
  // reason === 'invariant_failed' to emit the
  // analysis_freshness.invariant_failed telemetry event.
  return {
    ...derivation,
    freshness: violation.coerce_to,
    reason: 'invariant_failed',
  };
}

/**
 * Emit the full freshness telemetry family for a single derivation site.
 * Always emits `analysis_freshness.derived`. Conditionally emits:
 *   - `fact_selected` when a fact was selected (selected_fact_index !== null)
 *   - `invariant_failed` when reason === 'invariant_failed'
 *   - `graph_hash_missing` when reason === 'current_graph_hash_unavailable'
 *
 * Use this from EVERY derivation site (turn-executor pre/post-handler,
 * chip-click, draft-graph, edit-graph) so the post-dispatch verdict that
 * actually ships on the wire has the same forensic depth as the pre-
 * dispatch routing view.
 *
 * Extra fields (prior_fact_count / current_turn_fact_count / dispatch
 * extras) are passed through `extras` so each call site can tag its
 * own context without duplicating the four emit() calls.
 */
export function emitFreshnessTelemetry(
  derivation: FreshnessDerivation,
  context: {
    readonly request_id: string;
    readonly scenario_id: string;
    readonly dispatch_path: string;
  },
  extras: Record<string, unknown> = {},
): void {
  emit(TelemetryEvents.AnalysisFreshnessDerived, {
    request_id: context.request_id,
    scenario_id: context.scenario_id,
    dispatch_path: context.dispatch_path,
    freshness: derivation.freshness,
    reason: derivation.reason,
    selected_fact_index: derivation.selected_fact_index,
    graph_hash_at_run: derivation.graph_hash_at_run,
    current_graph_hash: derivation.current_graph_hash,
    computed_at: derivation.computed_at,
    ...extras,
  });
  if (derivation.selected_fact_index !== null) {
    emit(TelemetryEvents.AnalysisFreshnessFactSelected, {
      request_id: context.request_id,
      scenario_id: context.scenario_id,
      dispatch_path: context.dispatch_path,
      selected_fact_index: derivation.selected_fact_index,
      reason: derivation.reason,
      graph_hash_at_run: derivation.graph_hash_at_run,
      computed_at: derivation.computed_at,
    });
  }
  if (derivation.reason === 'invariant_failed') {
    emit(TelemetryEvents.AnalysisFreshnessInvariantFailed, {
      request_id: context.request_id,
      scenario_id: context.scenario_id,
      dispatch_path: context.dispatch_path,
      graph_hash_at_run: derivation.graph_hash_at_run,
      current_graph_hash: derivation.current_graph_hash,
      selected_fact_index: derivation.selected_fact_index,
    });
  }
  // graph_hash_missing fires whenever a hash comparison was IMPOSSIBLE —
  // either current graph hash unavailable on this turn OR the selected
  // fact predates 0.10.0 and has no graph_hash_at_run. Keyed on the HASH
  // FIELDS (not the reason) so the signal survives when the option-identity
  // guard overrides the verdict to 'analysed_options_diverged' on a
  // hash-impossible path — the hash was still missing, and ops must not lose
  // that. Requires a selected fact (the 'none' case legitimately has both
  // hashes null with no fact and must not fire).
  if (
    derivation.selected_fact_index !== null &&
    (derivation.graph_hash_at_run === null || derivation.current_graph_hash === null)
  ) {
    emit(TelemetryEvents.AnalysisFreshnessGraphHashMissing, {
      request_id: context.request_id,
      scenario_id: context.scenario_id,
      dispatch_path: context.dispatch_path,
      selected_fact_index: derivation.selected_fact_index,
      missing_side:
        derivation.graph_hash_at_run === null ? 'graph_hash_at_run' : 'current_graph_hash',
    });
  }
  // options_diverged: the option-identity guard forced 'stale'. Emitted in
  // addition to graph_hash_missing above (which still fires on the recovery
  // paths). Correlation + freshness fields only; no option IDs/labels.
  if (derivation.reason === 'analysed_options_diverged') {
    emit(TelemetryEvents.AnalysisFreshnessOptionsDiverged, {
      request_id: context.request_id,
      scenario_id: context.scenario_id,
      dispatch_path: context.dispatch_path,
      selected_fact_index: derivation.selected_fact_index,
      graph_hash_at_run: derivation.graph_hash_at_run,
      current_graph_hash: derivation.current_graph_hash,
    });
  }
}
