/**
 * The single predicate for "this handler fact reports that nothing
 * actually changed".
 *
 * Every mutating handler computes a `noop` boolean and stamps it on both
 * its fact (`fact.noop`) and its structured result (`result.status:
 * 'noop' | 'applied'`). Consumers that surface a change to the user MUST
 * consult it: the four-state vocabulary is proposed / applied / blocked /
 * stale, and "noop" must never be rendered as "applied".
 *
 * WHY THIS IS A SHARED EXPORT RATHER THAN AN INLINE CHECK
 * ------------------------------------------------------
 * `context/recent-changes.ts` had the canonical gate inline
 * ("Successful mutations only — noops carry no user-visible change to
 * reference") while `signals/coaching-signals.ts` had no gate at all, so
 * a no-op edit was silently coached as having staled the analysis. Two
 * hand-maintained expressions of one concept is the mirror-drift defect
 * this repo keeps re-shipping; one exported predicate cannot drift from
 * itself.
 *
 * Note `fact.noop === true` rather than truthiness: `noop` is a required
 * boolean on the fact schema, and an explicit comparison keeps a future
 * optional/undefined widening from silently reclassifying an unknown as
 * "changed" — or, worse, an absent flag as "no change".
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

export function isNoopFact(fact: HandlerFact): boolean {
  return fact.noop === true;
}
