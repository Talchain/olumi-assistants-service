/**
 * 1.16 item A2 — pending action for the user-consented "extend the scale"
 * chip on a `value_exceeds_cap` validation recovery.
 *
 * The boundary `Action` (chip) schema is strict `{id, label, message,
 * action_type?}` — a chip cannot carry a structured payload. The structured
 * `{value, unit, cap}` therefore rides the existing pending-action channel:
 * this helper builds the `set_factor_value` pending persisted ALONGSIDE the
 * recovery turn, keyed by the composer's stable chip id. On the next turn
 * the chip's replay message ("Extend the scale for <Factor> and use the new
 * value." — deliberately no digits and no edit verb) is claimed by
 * `tryClarificationResume`, which label-matches the factor and synthesises
 * the proposal from this pending, cap included. `proposalCap` takes
 * precedence in the shared predicate and the handler, so the consented cap
 * extension applies atomically with the value — and the handler
 * renormalises every option's intervention on the factor so absolute
 * option configurations are preserved.
 *
 * Fail-closed inputs: the pending is only built when the validator threads
 * the complete detail set (value / '£'-style unit / factor id / suggested
 * cap / operator 'set'), the composed response actually carries the rescale
 * chip, and a live graph hash exists (mutating pendings without a hash are
 * refused by the resumer's safety gate — persisting one would be dead
 * weight). Missing any of these, the chip still renders but its replay
 * degrades to normal routing instead of a deterministic resume.
 */

import { randomUUID } from 'node:crypto';

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { RESCALE_EXTEND_CAP_CHIP_ID } from '../compose/validation-failure-responses.js';
import type { ValidationError } from '../routing/validator.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from './pending-action.js';

export interface BuildRescaleCapPendingArgs {
  readonly error: ValidationError;
  readonly response: OlumiResponse;
  readonly scenarioId: string;
  readonly currentGraphHash: string | null | undefined;
  /** Injectable clock for tests. Defaults to Date.now(). */
  readonly nowMs?: number;
}

export function buildRescaleCapPendingActions(
  args: BuildRescaleCapPendingArgs,
): readonly PendingAction[] {
  const { error, response, scenarioId, currentGraphHash } = args;
  if (error.code !== 'PARAMETER_INVALID') return [];
  const details = error.details ?? {};
  if (details.rejection_reason !== 'value_exceeds_cap') return [];

  const value = typeof details.value === 'number' ? details.value : undefined;
  const unit = typeof details.unit === 'string' && details.unit.length > 0 ? details.unit : undefined;
  const factorId =
    typeof details.factor_id === 'string' && details.factor_id.length > 0
      ? details.factor_id
      : undefined;
  const suggestedCap =
    typeof details.suggested_cap === 'number' && Number.isFinite(details.suggested_cap)
      ? details.suggested_cap
      : undefined;
  const operator = typeof details.operator === 'string' ? details.operator : 'set';

  if (value === undefined || unit === undefined || factorId === undefined) return [];
  if (suggestedCap === undefined || suggestedCap < value) return [];
  if (operator !== 'set') return [];

  // The composer owns the consent decision — only persist when the chip is
  // actually on the wire (same id contract as the clarify chips).
  const chipPresent = response.suggested_actions.some((a) => a.id === RESCALE_EXTEND_CAP_CHIP_ID);
  if (!chipPresent) return [];

  // Mutating pendings without a graph-hash precondition are refused by the
  // resumer's fail-closed safety gate; persisting one would never resume.
  if (currentGraphHash == null || currentGraphHash.length === 0) return [];

  const nowMs = args.nowMs ?? Date.now();
  const emittedAtIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString();

  return [
    {
      id: randomUUID(),
      scenario_id: scenarioId,
      chip_id: RESCALE_EXTEND_CAP_CHIP_ID,
      action: {
        kind: 'set_factor_value',
        factor_id: factorId,
        value,
        unit,
        operator: 'set',
        cap: suggestedCap,
      },
      preconditions: {
        target_entity_ids: [factorId],
        graph_hash: currentGraphHash,
      },
      expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
      expires_at_iso: expiresAtIso,
      emitted_at_iso: emittedAtIso,
    },
  ];
}
