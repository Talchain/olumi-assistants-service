/**
 * Model Management v1 — VersionEventSink implementations + safe dispatch.
 *
 * The seam is defined in types.ts (contract §7.3 shape: at-least-once,
 * idempotent-by-key, MUST NOT fail the user-facing result).
 *
 * v1 sink = the RPC journey event. The durable `model_version_created` /
 * `model_version_restored` event is appended into `scenarios.events` BY the
 * create/restore RPC, inside the same transaction as the version insert and
 * pointer move (strictly atomic — stronger than the seam's at-least-once
 * minimum), idempotent by `event_id`. The TS-side sink therefore has nothing
 * left to persist: `journeyRpcVersionEventSink.emit` is an acknowledged
 * no-op, and the seam exists so future consumers (telemetry pipelines,
 * external substrates, the Apply/Reject contract's version hook) can be
 * plugged in without touching the service.
 */

import { log } from '../../utils/telemetry.js';
import type { ModelVersionEvent, VersionEventSink } from './types.js';

/**
 * The v1 sink: durable persistence already happened in the RPC transaction
 * (see module header). Idempotent trivially — emitting N times changes
 * nothing, and the underlying journey event is itself idempotent by
 * event_id at the RPC layer.
 */
export const journeyRpcVersionEventSink: VersionEventSink = {
  async emit(_event: ModelVersionEvent): Promise<void> {
    // Durable event was appended in-transaction by the RPC. Nothing to do.
  },
};

/**
 * Dispatch an event to a sink under the seam's safety rule: emit failures
 * are logged (telemetered re-drive is the future consumer's job) and NEVER
 * propagate to the user-facing result. At-least-once: callers may invoke
 * this multiple times for the same event_id; sinks must tolerate it.
 */
export async function notifyVersionEventSink(
  sink: VersionEventSink,
  event: ModelVersionEvent,
): Promise<void> {
  try {
    await sink.emit(event);
  } catch (err) {
    log.warn(
      {
        event_id: event.event_id,
        event_type: event.event_type,
        scenario_id: event.scenario_id,
        version_id: event.version_id,
        error: err instanceof Error ? err.message : String(err),
      },
      'ModelManagement — version event sink emit failed (durable journey event unaffected; sink is re-drivable by event_id)',
    );
  }
}
