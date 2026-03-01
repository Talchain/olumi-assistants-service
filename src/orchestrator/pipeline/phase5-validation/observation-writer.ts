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
export function writeObservation(turnId: string): void {
  // A.14: Replace with async Supabase write to turn_observations.
  log.info(
    { turn_id: turnId },
    "[observation] turn_observations write skipped — A.14 not yet implemented",
  );
}
