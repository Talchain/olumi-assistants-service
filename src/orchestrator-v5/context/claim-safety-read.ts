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

import { readMayNameLeadingOptionFromResult } from '../../orchestrator/context/constraint-feasibility.js';
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
 * @param facts newest-first-agnostic array; the selector orders by content.
 */
export function readMayNameLeadingOptionForFacts(
  facts: readonly HandlerFact[],
): boolean {
  const selected = selectRunAnalysisFact(facts);
  if (selected === null) return true;
  const fact = selected.fact;
  return fact.fact_type === 'run_analysis'
    ? readMayNameLeadingOptionFromResult(fact.result)
    : true;
}
