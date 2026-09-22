/**
 * Whether this caller may use this scenario, given the row's authoritative owner.
 *
 * ⛔ `ensureScenarioExists` IS NOT A PERMISSION GRANT. It is
 * `INSERT … ON CONFLICT (id) DO NOTHING`, and it returns the owner of the
 * STORED row — which, when the row already existed, may be somebody else. The
 * product's own pre-flight carries the same warning: callers must compare and
 * reject, because the upsert will happily hand back another tenant's scenario.
 *
 * Extracted from the route so the decision is testable on its own. A branch
 * this consequential must not live only inside an HTTP handler.
 */
export type ScenarioAccess = 'allow' | 'refuse_not_found';

export function scenarioAccessDecision(
  ownerUserId: string | null,
  callerUserId: string | null,
): ScenarioAccess {
  // An unowned (guest) scenario is open — that is the PoC posture, and it is
  // what makes a key-authed preview possible at all.
  if (ownerUserId === null) return 'allow';
  // An owned scenario requires the SAME authenticated user. An anonymous
  // caller is refused, never quietly upgraded to the owner.
  return ownerUserId === callerUserId ? 'allow' : 'refuse_not_found';
}
