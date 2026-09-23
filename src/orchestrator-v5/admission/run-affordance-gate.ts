/**
 * ⭐⭐ THE ONE PREDICATE FOR "MAY WE OFFER THE RUN AFFORDANCE?"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, IN THE ESTATE'S OWN WORDS.
 *
 * `analysis-ready-helper.ts` published `may_run` specifically so consumers
 * would stop reconstructing an admission rule they cannot see, and its
 * docblock names this exact victim:
 *
 *   *"`status` answers 'is this model ready as it stands?'. The client gates
 *    its `run_analysis` chip on `status === 'ready'`, which is the STRICTER
 *    question — so on the turn where the readiness loop says 'that's enough to
 *    run, I'll leave the others out and say so' the chip is filtered out,
 *    because that turn is `needs_user_input` WITH an admitting run path."*
 *
 * And the schema states the consumer rule outright: *"gate the Run affordance
 * on `structurally_analysable` (or `may_run` — same value) and NEVER on
 * `status`"*, with *"absence means an older producer, never 'no'"*.
 *
 * The field shipped. FOUR CEE chip surfaces were never migrated, and every one
 * still read `status`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ MEASURED, 23 Sep 2026 — this is a capability unlock, not a tidy-up.
 *
 * Driving the real producer (`buildCanonicalAnalysisReadyFromGraph`) over 400
 * real persisted user models from `scenarios.graph`:
 *
 *   244  status=ready             may_run=true    ← offered today
 *    78  status=needs_user_input  may_run=true    ← ADMISSIBLE, NOT OFFERED
 *    30  status=needs_user_mapping may_run=true   ← ADMISSIBLE, NOT OFFERED
 *    23  status=needs_user_mapping may_run=false
 *    13  status=needs_user_input  may_run=false
 *    12  status=blocked           may_run=false
 *
 * **108 of 400 (27.0%) of real models can run the analysis right now and are
 * not offered it.** 0 models lose the affordance under this predicate, so the
 * change is strictly an unlock.
 *
 * ⛔ ONE SPELLING, DELIBERATELY. The helper's own note records that two
 * spellings of one shape is this estate's signature defect ("three
 * `blockedIdentityCarrier` literals, two `generateGraphHash` twins") and that
 * the fix "is not to add the missing field at the second site — that keeps two
 * sites. It is for both to call this, so the drift is structurally impossible."
 * Four sites called for exactly that remedy.
 */

/** The shape every call site already holds; both fields optional by contract. */
export interface RunAffordanceReadiness {
  readonly status?: unknown;
  readonly may_run?: unknown;
}

/**
 * Whether the Run/Rerun affordance may be offered for this readiness payload.
 *
 * ⚠ ABSENCE IS NOT "NO". `may_run` is optional so pre-`may_run` producers still
 * validate, and the contract is explicit that absence means an older producer.
 * Falling back to the previous `status === 'ready'` rule leaves those paths
 * byte-identical rather than silently withdrawing an affordance they had.
 *
 * ⚠ `may_run !== false`, NOT `may_run === true`. The contract names that exact
 * comparison, and the two differ on a malformed/non-boolean value: the estate's
 * polarity for this field is to carry, not to withhold.
 */
export function isRunAffordanceAdmitted(readiness: RunAffordanceReadiness | undefined | null): boolean {
  if (readiness === undefined || readiness === null || typeof readiness !== 'object') return false;
  const mayRun = readiness.may_run;
  if (mayRun === undefined) return readiness.status === 'ready';
  return mayRun !== false;
}
