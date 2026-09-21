/**
 * G3 — A SAVED ANALYSIS THAT ROLLED OUT OF THE HOT WINDOW MUST NOT REPORT
 * "NEVER RUN".
 *
 * ⚠ TWO AUTHORITIES, TWO QUESTIONS, AND THIS MODULE DOES NOT RECONCILE THEM
 * (CLAUDE.md trap 21). The turn carries two freshness derivations, kept apart
 * on purpose at `turn-executor.ts` (`routingFreshness` / `promptAnalysisFreshness`,
 * annotated there as *"⚠ NOT the same question"*):
 *
 *   · the WIRE-BOUND verdict, derived over the bounded ~20-turn hot window
 *     (`context.prior_facts`, re-derived post-dispatch over
 *     `[...handlerFactsForCommit, ...prior_facts]`). It answers *"what does
 *     THIS TURN'S window say?"* and it is a mutation-safety gate: pending-action
 *     hash preconditions, chips, and the authoritative top-level `graph_hash`
 *     are all stamped from it.
 *   · the SCENARIO-BOUND verdict, derived over the durable
 *     `SCENARIO_ANALYSIS_FACT_CAP` newest `run_analysis` facts scenario-wide. It
 *     answers *"what does the scenario's durable analysis history say?"*
 *
 * Collapsing them — repointing the first at the second's array, or assigning one
 * to the other — is the failure this module exists to avoid, and it is measured:
 * it breaks 56 spec files / 179 tests, because the discriminator stops
 * discriminating and every input class returns one answer (trap 20).
 *
 * WHAT THIS MODULE DOES INSTEAD: a strictly ONE-WAY, narrowly-gated
 * SUPERSESSION, applied at the single route seam that already substitutes a
 * whole derivation for the unreadable-authority case, and consumed by exactly
 * two readers (`analysis_ready.freshness` and `analysis_state`). Every other
 * reader keeps the wire-bound verdict, unchanged and unrepointed.
 *
 * ⭐ WHY THE ASYMMETRY IS SOUND — the superset argument, derived, not assumed.
 * `context.prior_facts` holds the facts of the last N *turns*; the durable
 * carrier holds the newest `SCENARIO_ANALYSIS_FACT_CAP` **`run_analysis` facts
 * scenario-wide** (`context/reconcile-scenario-analysis-facts.ts`). FOR
 * `run_analysis` FACTS SPECIFICALLY the durable set is therefore a SUPERSET of
 * the hot window's. It can only ever FIND a fact the window lost; it can never
 * lose one the window has. So a durable verdict may correct a hot-window
 * `none` ("nothing has ever run") and may correct NOTHING ELSE — and it may
 * never turn a hot-window verdict INTO `none`.
 */

import type { FreshnessDerivation } from './freshness.js';
import {
  canonicalStateFromFreshness,
  type CanonicalAnalysisState,
} from './canonical-analysis-state.js';

/** Options accepted by `canonicalStateFromFreshness`, read from its signature
 *  rather than re-listed, so a new member cannot go stale here (trap 12). */
type CanonicalFromFreshnessOptions = NonNullable<
  Parameters<typeof canonicalStateFromFreshness>[1]
>;

/**
 * The pair the two migrated readers consume. Both members describe the SAME
 * durable derivation: the derivation itself for `analysis_ready`'s wire
 * freshness fields, and the canonical projection of it for `analysis_state`,
 * whose `run_state` branches on `canonical.freshness` and not on the
 * derivation (`compose/analysis-state-v1.ts::composeRunState`). Supplying only
 * the derivation would have left `analysis_state` untouched on the one exit
 * that can carry this — a field with no effect.
 */
export interface ScenarioAnalysisSupersession {
  readonly freshness: FreshnessDerivation;
  readonly canonicalState: CanonicalAnalysisState;
}

/**
 * Decide whether the scenario-bound verdict supersedes the wire-bound one for
 * the two analysis-state surfaces. Returns `undefined` — decline, leave every
 * surface exactly as it was — in every case but one.
 *
 * THE FOUR CONJUNCTS, each with the harm it prevents:
 *
 * 1. **Both derivations present.** Absence of the scenario derivation is the
 *    fail-weak state and is load-bearing: the producer populates it ONLY when
 *    `isScenarioAnalysisReasoningAuthority` held (`complete | capped`), so its
 *    presence IS that gate, read here rather than re-derived (trap 12). A
 *    `degraded` carrier never reaches this function.
 *
 * 2. **The wire verdict is `none`.** The ONE-WAY rule. `none` is the only
 *    verdict the superset argument licenses correcting: it is a positive claim
 *    ("this scenario has never been analysed") that a bounded window cannot
 *    support. `fresh`, `stale` and `unknown` are all claims the window CAN
 *    support, and each is a claim about THIS turn's graph — never superseded.
 *
 * 3. **The scenario verdict is not `none`.** Never supersede with `none`: it
 *    would be a no-op at best (the window already says `none`) and, if the
 *    superset argument ever stopped holding, a regression at worst.
 *
 * 4. ⚠ **The two derivations were computed against the SAME current graph.**
 *    This conjunct is NOT in the design brief and is the correction this
 *    implementation makes to it. `current_graph_hash` is a total echo of
 *    `deriveAnalysisFreshness`'s second argument, and the two derivations are
 *    handed the same argument AT ORIENT — but the wire-bound verdict is
 *    RE-DERIVED POST-DISPATCH, and on a turn that committed a mutation it is
 *    re-derived against the POST-EDIT hash (`turn-executor.ts`,
 *    `hashForPostHandlerFreshness` and the two `postApplyHash` sites) while the
 *    scenario derivation still holds the PRE-dispatch one.
 *
 *    Without this conjunct the following is reachable: the hot window has lost
 *    its `run_analysis` fact (→ `none`), the durable fact's `graph_hash_at_run`
 *    matches the PRE-edit graph (→ durable `fresh`), and this turn EDITS the
 *    graph. Superseding would ship `analysis_ready.freshness: 'fresh'` over
 *    edits CEE has never analysed — the first of the two measured harms
 *    enumerated at `compose/analysis-ready-emit.ts` (*"clears the local-edits
 *    dirty overlay, so the strip claims 'Analysis reflects the current model'
 *    over edits CEE has never seen"*).
 *
 *    The conjunct is the conservative repair rather than a demotion, because
 *    demoting `fresh` to `stale` here would mean HAND-CONSTRUCTING a
 *    derivation, outside `enforceInvariants`, from the failure mode in hand
 *    rather than from the spec (trap 13d). Adopting an already-enforced
 *    derivation or declining are the only two honest moves, and on the turns
 *    where G3 actually bites — a later, non-mutating turn — the hashes agree
 *    (`hashForPostHandlerFreshness` returns `currentAnalysisGraphHashForTurn`
 *    verbatim when `handlerOutcome.mutated_graph === undefined`) and the gate
 *    passes.
 *
 * ⭐ WHY THERE IS NO `refusal_declared` CONJUNCT, derived rather than assumed.
 * `composeAnalysisStateV1` reads the derivation for exactly one thing —
 * `refusal_declared`, which produces `run_state.kind: 'refused'` — so
 * substituting a derivation that lacks the flag could in principle erase a
 * refusal. It cannot, because `clampRefusalFreshness` is the sole writer of
 * that flag and it NEVER RETURNS `none`: its non-early-return arm rewrites the
 * verdict to `unknown`. A refusal turn therefore fails conjunct 2 and never
 * reaches here. That premise is pinned in-test rather than restated here, so it
 * REDs if the clamp ever starts preserving `none`.
 */
export function resolveScenarioAnalysisSupersession(input: {
  /** The turn's wire-bound freshness verdict, exactly as every other reader sees it. */
  readonly windowFreshness: FreshnessDerivation | undefined;
  /**
   * The scenario-bound verdict, present ONLY when a durable reasoning
   * authority licensed it. See conjunct 1.
   */
  readonly scenarioFreshness: FreshnessDerivation | undefined;
  /** Threaded verbatim to `canonicalStateFromFreshness`, same as the caller's own call. */
  readonly readiness?: CanonicalFromFreshnessOptions['readiness'];
}): ScenarioAnalysisSupersession | undefined {
  const { windowFreshness, scenarioFreshness } = input;
  if (windowFreshness === undefined || scenarioFreshness === undefined) return undefined;
  if (windowFreshness.freshness !== 'none') return undefined;
  if (scenarioFreshness.freshness === 'none') return undefined;
  if (scenarioFreshness.current_graph_hash !== windowFreshness.current_graph_hash) {
    return undefined;
  }
  return {
    freshness: scenarioFreshness,
    canonicalState: canonicalStateFromFreshness(
      scenarioFreshness,
      input.readiness !== undefined ? { readiness: input.readiness } : {},
    ),
  };
}
