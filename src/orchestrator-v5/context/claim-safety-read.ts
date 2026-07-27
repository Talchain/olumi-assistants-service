/**
 * T1 claim safety — THE fact-array read. ROADMAP 1.233 (the hoist).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE EXISTS AT ALL: to stop a SECOND read point becoming a
 * second DERIVATION.
 *
 * Before the hoist there was exactly one place in `turn-executor.ts` that
 * answered "may this turn name a leading option" — the post-dispatch
 * claim-safety block. The hoist adds a second read point (turn entry), because
 * every non-execute exit returns before that block runs and was therefore
 * shipping the hardcoded `true` default to the Layer-3 egress guard, making the
 * alarm a licensed no-op on those exits (see the declaration comment at the
 * hoist site for the live evidence).
 *
 * Two read points is fine. Two DERIVATIONS is the defect this whole workstream
 * exists to close: CLAUDE.md trap #12, and the reason
 * `compose/withheld-claim-projection.ts` says "READS it rather than deriving
 * its own — two derivations can see different inputs and produce an internally
 * inconsistent response". So the read is extracted HERE, once, and both points
 * call it. A future third caller gets the same answer by construction rather
 * than by a reviewer noticing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PURE. No I/O, no logging, no mutation.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  readConstraintVerdictStateFromResult,
  readMayNameLeadingOptionFromResult,
} from '../../orchestrator/context/constraint-feasibility.js';
import type { ConstraintVerdictState } from '../../orchestrator/context/constraint-feasibility.js';
import { selectRunAnalysisFact } from './freshness.js';

/**
 * May a turn grounded in THIS fact array name a leading option?
 *
 * Selection is CONTENT-based via {@link selectRunAnalysisFact} — the same
 * canonical selector the freshness derivation and compose's lifecycle
 * resolution use — so the permission and the prose it governs describe the same
 * analysis. The verdict itself is read by
 * {@link readMayNameLeadingOptionFromResult} (typed `result.constraint_verdict`
 * first, the interim `enrichment.__cee_claim_safety` stamp second); this
 * function never re-derives it from constraints or graph state.
 *
 * TWO DIFFERENT DEFAULTS, deliberately:
 *
 *   - **No selectable `run_analysis` fact ⇒ `true`.** There is no analysis, so
 *     there is no leading option, so there is nothing to withhold and nothing
 *     for the guard to contradict. This is an HONEST true, not a fail-open one:
 *     the guard has no claim to police because no claim can be grounded.
 *   - **A `run_analysis` fact IS selected but carries no verdict ⇒ `false`**,
 *     via the reader's own fail-closed branch. "Unknown" and "verified
 *     feasible" are different claims and only the second licenses naming a
 *     leader; a write path that forgets to stamp is a bug that must not be
 *     silent (see `readMayNameLeadingOptionFromResult`'s docstring for the P0
 *     this default was earned by).
 *
 * The `fact_type` re-check is not defensive noise: {@link selectRunAnalysisFact}
 * is typed to return a `HandlerFact` and narrowing it here is what makes the
 * `.result` read type-safe. A non-`run_analysis` selection would mean the
 * selector changed contract, and the honest answer for a fact that is not an
 * analysis is the same as for no analysis at all.
 *
 * ⚠ THE ARRAY IS NOT THE SCENARIO — and that is why this overload still exists
 * but is no longer what the turn path calls. See
 * {@link readMayNameLeadingOptionVerdict}: the caller's array was a 20-turn
 * WINDOW, so the `selected === null` branch below fired on scenarios that DO
 * have an analysis whose parent turn had simply aged out. The branch is honest
 * about the array it is handed; the CALLER made it lie. Keep this function for
 * genuinely array-scoped questions (and for the tests that pin the two
 * defaults); route every scenario-scoped question through the verdict function.
 *
 * @param facts newest-first-agnostic array; the selector orders by content.
 */
export function readMayNameLeadingOptionForFacts(
  facts: readonly HandlerFact[],
): boolean {
  return readMayNameLeadingOptionVerdict(facts, ARRAY_ONLY_SCOPE)
    .may_name_leading_option;
}

/**
 * WHERE a `may_name_leading_option` answer came from.
 *
 * Exists because a `true` from "the scenario's newest analysis PERMITTED it"
 * and a `true` from "no analysis was in the array I was handed" were **the
 * same wire byte** — so no acceptance walk could build a valid control, and
 * the walk that tried reached for a turn-shape hypothesis its own data
 * refuted. Additive and diagnostic: nothing branches on it.
 *
 *   - `scenario_fact`        — a `run_analysis` fact was selected (from the
 *                              window or from the scenario-scoped read) and
 *                              its verdict was read. The answer describes a
 *                              real analysis.
 *   - `no_analysis_exists`   — no selectable analysis, and the window was NOT
 *                              provably truncated. The HONEST `true`: nothing
 *                              can be grounded, so nothing can leak.
 *   - `fail_closed_truncated`— no selectable analysis, the scenario-scoped
 *                              read did NOT succeed, and the window is
 *                              provably shorter than the scenario. The "no
 *                              analysis" premise is UNPROVEN, so we withhold.
 */
export type MayNameLeadingOptionProvenance =
  | 'scenario_fact'
  | 'no_analysis_exists'
  | 'fail_closed_truncated';

export interface MayNameLeadingOptionVerdict {
  readonly may_name_leading_option: boolean;
  readonly provenance: MayNameLeadingOptionProvenance;
}

/**
 * The SCENARIO-scoped inputs to the permission. All store-derived.
 *
 * ⚠ NOTHING HERE MAY EVER BECOME CLIENT-SUPPLIED. The *content* side already
 * has a client channel — `options.analysisState` populates `display_analysis`
 * from the REQUEST — which is exactly why the *permission* side must not. A
 * client that could hand us `newestAnalysisFact` could hand us a permitted
 * verdict for an analysis that withheld.
 */
export interface ClaimSafetyScenarioScope {
  /**
   * The scenario's newest non-noop `run_analysis` fact, read `WHERE
   * scenario_id = … ORDER BY created_at DESC LIMIT 1` — i.e. past the read
   * window. `null` = the scenario has none, or the read did not run.
   */
  readonly newestAnalysisFact: HandlerFact | null;
  /**
   * Did the scenario-scoped read actually execute and succeed? `false` covers
   * both a thrown read and a store that does not implement it. Only ever used
   * to ARM the fail-closed guard — never to widen the permission.
   */
  readonly readOk: boolean;
  /**
   * Is the loaded turn window PROVABLY shorter than the scenario's real turn
   * count (`prior_turns_total > prior_turns.length`)? When true, "no analysis
   * in the array" is not evidence of "no analysis in the scenario".
   */
  readonly windowTruncated: boolean;
}

/**
 * The array-only scope: no scenario read, so the fail-closed guard can never
 * arm and behaviour is byte-identical to the pre-fix reader.
 */
const ARRAY_ONLY_SCOPE: ClaimSafetyScenarioScope = {
  newestAnalysisFact: null,
  readOk: true,
  windowTruncated: false,
};

/**
 * ⭐ May a turn on THIS SCENARIO name a leading option, and on what evidence?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES: the permission described the last 20 CONVERSATION
 * TURNS; the channels it gates describe the WHOLE SCENARIO.
 *
 *   permission : readRecent(scenarioId)                  → LIMIT   20
 *   summary    : readRecent(scenarioId, 1000)            → LIMIT 1000
 *   records    : retrieveRecords(scenarioId, {limit: 8}) → SCENARIO-WIDE
 *
 * A `run_analysis` fact whose parent turn had left the 20-turn window was
 * invisible, `selectRunAnalysisFact` returned `null`, and the "honest true"
 * branch shipped an UNGATED rolling summary and decision-record set on a
 * scenario whose newest verdict withheld. Confirmed live: scenario
 * `f63ccb45-…` (31 turns) had its analysis turn at rank 20 at 12:57:02 →
 * `false`, and at rank 21 at 12:58:26 after one more turn committed → `true`,
 * with ZERO store change. A stamped-withheld verdict decayed the same way;
 * the protection had a turn-count expiry nobody wrote down.
 *
 * ⚠ AND THE TWO CONDITIONS ARE POSITIVELY CORRELATED. The rolling summary is
 * injected iff the window holds MORE than 8 turns; eviction needs more than
 * 20. So every turn on which the permission went blind was necessarily a turn
 * on which the richest leader-bearing channel was switched on. Not a
 * coincidence — an implication of the two constants.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ ONE-DIRECTIONALITY, and it is structural rather than empirical. Let `S` be
 * the scenario's newest non-noop `run_analysis` fact. Exactly two cases:
 *
 *   1. S's parent turn is INSIDE the window ⇒ `S ∈ windowFacts` already, so
 *      the union is set-identical to today's array and the selector returns
 *      the same fact. **Byte-identical behaviour.**
 *   2. S's parent turn is OUTSIDE the window ⇒ every windowed turn is NEWER
 *      than S's turn. A `run_analysis` fact on a newer turn would be newer
 *      than S, contradicting S being the newest. Therefore `windowFacts`
 *      contains **no `run_analysis` fact at all**, so today's answer was
 *      `true` unconditionally. The union is `{S}` ⇒ the new answer is `false`
 *      (withheld/unstamped) or `true` (permitted).
 *
 * Case 1 cannot move. Case 2 can only move `true → false`. **No input moves
 * `false → true`**, so every existing assertion of `false` still holds and the
 * only tests at risk are ones asserting `true` on a >20-turn fixture.
 *
 * This also disposes of the eligibility subtlety: the SQL read filters only
 * `noop = false`, so it can surface a fact that `selectRunAnalysisFact` then
 * rejects on `analysis_status` (partial/failed/degraded). Under case 2 the old
 * answer was `true` anyway, so a rejected S degrades to `true` — unchanged,
 * never a regression.
 *
 * @param windowFacts the loaded window's facts (`context.prior_facts`), plus
 *   any facts this turn just produced. Order-agnostic; the selector orders by
 *   content.
 * @param scope store-derived scenario-scoped inputs. Never client-supplied.
 */
export function readMayNameLeadingOptionVerdict(
  windowFacts: readonly HandlerFact[],
  scope: ClaimSafetyScenarioScope,
): MayNameLeadingOptionVerdict {
  // The UNION, not a replacement. Replacing the array with `[S]` would let the
  // eligibility filter drop S and hand back a `true` where the window held an
  // older withheld fact — a `false → true` move, i.e. the exact direction the
  // one-directionality proof above forbids.
  const facts =
    scope.newestAnalysisFact === null
      ? windowFacts
      : [...windowFacts, scope.newestAnalysisFact];

  const selected = selectRunAnalysisFact(facts);
  if (selected !== null) {
    const fact = selected.fact;
    return {
      may_name_leading_option:
        fact.fact_type === 'run_analysis'
          ? readMayNameLeadingOptionFromResult(fact.result)
          : true,
      provenance: 'scenario_fact',
    };
  }

  // BELT AND BRACES — and it is a FALLBACK, not the mechanism. It requires
  // `readOk === false`, so when the scenario-scoped read works this branch is
  // UNREACHABLE by construction: a successful read either supplied S (⇒
  // `selected !== null` above, unless S failed eligibility) or proved the
  // scenario has no analysis at all. It exists for the degraded path, where
  // CLAUDE.md's rule applies — where you cannot derive, FAIL LOUD on drift,
  // never assume-good. `prior_turns_total` is already loaded (`countTurns`),
  // so this costs no query.
  //
  // It over-restricts: a scenario that genuinely never ran an analysis but has
  // >20 turns withholds while the store is degraded. That is the safe
  // direction, and it is bounded by the degradation.
  if (!scope.readOk && scope.windowTruncated) {
    return {
      may_name_leading_option: false,
      provenance: 'fail_closed_truncated',
    };
  }

  // The genuinely honest `true`: no analysis can be grounded, so no claim can
  // leak. This must NOT become `false` — a scenario with no analysis has
  // nothing to withhold, and withholding there would convert the fail-closed
  // default's cost from content into correctness.
  return { may_name_leading_option: true, provenance: 'no_analysis_exists' };
}

/**
 * Build the scenario scope from a turn context, in ONE place, so the turn path
 * and the chip-click path cannot arrive at different scopes for the same
 * scenario. Structurally typed — no import of the context module, keeping this
 * file PURE.
 *
 * `windowTruncated` is only ever TRUE on a real number comparison: a `null`
 * / absent `prior_turns_total` means "unknown", and unknown must not arm a
 * guard whose whole justification is that truncation was PROVEN.
 */
export function claimSafetyScopeFromContext(context: {
  readonly newest_analysis_fact?: HandlerFact | null;
  readonly newest_analysis_fact_read_ok?: boolean;
  readonly prior_turns_total?: number | null;
  readonly prior_turns: readonly unknown[];
}): ClaimSafetyScenarioScope {
  const total = context.prior_turns_total;
  return {
    newestAnalysisFact: context.newest_analysis_fact ?? null,
    readOk: context.newest_analysis_fact_read_ok === true,
    windowTruncated:
      typeof total === 'number' && total > context.prior_turns.length,
  };
}

/**
 * Which verdict STATE did a turn grounded in THIS fact array record? (F2)
 *
 * The sibling of {@link readMayNameLeadingOptionForFacts}, and it exists for the
 * same reason this module does: so the two answers come from the SAME fact,
 * chosen by the SAME content-based selector. A note that described one analysis
 * while the withholding described another would be a second derivation wearing
 * a different hat (CLAUDE.md trap #12) — and the consumer here is copy that
 * makes a factual claim about the user's own scenario, so the cost of the two
 * disagreeing is a false sentence, not a cosmetic one.
 *
 * ONE DEFAULT, and it is `null` throughout — unlike the boolean's two. There is
 * no honest state to invent for "no analysis" or "nothing recorded": every one
 * of the five states makes a positive claim about what happened to the user's
 * condition (see `readConstraintVerdictStateFromResult`, which returns `null`
 * for exactly this reason). `null` means "not recorded", and the one consumer
 * degrades to cause-free copy rather than guessing a voice.
 */
export function readConstraintVerdictStateForFacts(
  facts: readonly HandlerFact[],
): ConstraintVerdictState | null {
  const selected = selectRunAnalysisFact(facts);
  if (selected === null) return null;
  const fact = selected.fact;
  return fact.fact_type === 'run_analysis'
    ? readConstraintVerdictStateFromResult(fact.result)
    : null;
}
