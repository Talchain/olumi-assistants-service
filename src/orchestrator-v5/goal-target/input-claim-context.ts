import { AsyncLocalStorage } from 'node:async_hooks';
import type { InputClaim } from '../../schemas/assist.js';

/** Only the host's approved proposal can supply this claim. No public event flag. */
interface ApprovedTargetClaim {
  scenario_id: string;
  goal_node_id: string;
  turn_id: string;
  claim: InputClaim;
}
const claims = new AsyncLocalStorage<ApprovedTargetClaim>();
export function withApprovedTargetClaim<T>(claim: ApprovedTargetClaim, write: () => Promise<T>): Promise<T> {
  return claims.run(claim, write);
}
export function approvedTargetClaimFor(scenario: string, goal: string, turn: string): InputClaim | undefined {
  const held = claims.getStore();
  return held?.scenario_id === scenario && held.goal_node_id === goal && held.turn_id === turn ? held.claim : undefined;
}
