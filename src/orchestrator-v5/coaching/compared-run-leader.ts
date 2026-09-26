/**
 * ⭐ THE ONE PER-RUN AUTHORITY FOR NAMING A COMPARED RUN'S LEADER.
 *
 * Every producer that compares two runs — the "What changed?" gate
 * (`routing/run-comparison-gate.ts`) and the wire/context `run_delta`
 * (`coaching/build-run-delta.ts`) — names or identifies each run's leader only
 * when ALL THREE hold:
 *   1. the TURN may name a leader (`turnPermission`: the only input that can see
 *      `fail_closed_truncated` / `fail_closed_unavailable`);
 *   2. that run's own persisted CONSTRAINT verdict permits it
 *      (`readMayNameLeadingOptionVerdictForFact`);
 *   3. that run was ASKED FOR (`wasAnalysisRequestedByUser`). An automatic run's
 *      leader is never PRESENTED (`mayPresentLeaderClaimForFact`), so a comparison
 *      may not name or designate it either: "Offshore still leads" / "moved from
 *      Offshore to Onshore" after a construction auto-run states a leader the user
 *      was never given.
 *
 * Only NARROWS: every value is `<=` the verdict-only construction it replaces.
 *
 * ⚠ WHY ONE HELPER (review of #1857, B3 then B4): the verdict-only construction
 * was copied into each comparison producer; fixing one site left its sibling
 * leaking twice. The third comparer, `buildRerunAcknowledgement`
 * (signals/coaching-signals.ts), degrades to comparison-free on an auto-initiated
 * prior by the same rule. The complete set of comparers is every caller of
 * `compareRuns` / `selectTwoNewestRunAnalysisFacts` (swept 25 Sep: exactly these three).
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { readMayNameLeadingOptionVerdictForFact } from '../context/claim-safety-read.js';
import { wasAnalysisRequestedByUser } from '../compose/unrequested-analysis-confinement.js';

export function mayPresentComparedRunLeader(turnPermission: boolean, fact: HandlerFact): boolean {
  return turnPermission
    && readMayNameLeadingOptionVerdictForFact(fact).may_name_leading_option
    && mayPresentComparedRunVerdicts(fact);
}

/**
 * ⛔ MAY A COMPARED RUN'S *VERDICT-BEARING NUMBERS* BE PRESENTED — its per-option
 * `win_probability`, its robustness band ("whether to trust it")?
 *
 * Only for a run the user ASKED FOR. Confinement withholds exactly these for an
 * unrequested run (`compose/unrequested-analysis-confinement.ts`: "who wins, by how
 * much, and whether to trust it"; `confineUnrequestedAnalysisBlock` drops
 * `win_probabilities`). A comparison that re-ships them reveals the withheld leader
 * by arithmetic — "Offshore: 62% → 45%" (review of #1857, B5). The sensitivity science
 * (driver influence) is NOT in this class; confinement keeps it.
 *
 * Read by `buildRunDelta` (no `run_delta` at all for a pair with an unrequested run)
 * and the "What changed?" gate (no band-movement sentence), and by
 * {@link mayPresentComparedRunLeader} as its third conjunct.
 */
export function mayPresentComparedRunVerdicts(fact: HandlerFact): boolean {
  return wasAnalysisRequestedByUser(fact);
}
