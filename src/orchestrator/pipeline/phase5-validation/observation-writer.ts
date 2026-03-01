/**
 * Observation Writer — STUB
 *
 * Logs that observation write is skipped.
 *
 * // A.14: Replace with async Supabase write to turn_observations.
 */

import { log } from "../../../utils/telemetry.js";

/**
 * Write turn observations to persistence layer.
 * Currently a stub — logs an info message and returns.
 */
export function writeObservation(turnId: string, scenarioId: string): void {
  // A.14: Replace with async Supabase write to turn_observations.
  log.info(
    { turn_id: turnId, scenario_id: scenarioId, phase: 'phase5', reason: 'A.14 not yet implemented' },
    'observation write skipped',
  );
}
