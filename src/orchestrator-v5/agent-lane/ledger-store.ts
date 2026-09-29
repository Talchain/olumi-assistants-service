/**
 * Agent lane — where a representation-loss ledger durably lives.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐ WHY NOT IN THE GRAPH, MEASURED RATHER THAN ARGUED.
 *
 * Adding a top-level `agent_lane_ledger` key to the graph object CHANGES the
 * graph identity hash — measured with `computeGraphIdentityHash` over the real
 * admitted model: `c411dfff…` without it, `2ade14cb…` with it, against a control
 * confirming a node change also moves the hash. That is disqualifying twice over:
 * the CAS and replay contract are expressed in that hash, so every ledger write
 * would look like a different model; and semantically the ledger describes the
 * PROJECTION, not the model, so it has no business inside the model's identity.
 *
 * ⭐ WHY `scenarios.events`, AND WHAT WAS CHECKED FIRST.
 *
 * It is an existing append-only log — 3,598 scenarios use it, shape
 * `{seq, details, event_id, timestamp, event_type}`, `details` free-form (a
 * sampled row carries `{}`) — written through the existing
 * `apply_patch_and_log` RPC. Before choosing it:
 *
 *   · no DB check constraint mentions `events` (0 found), so `event_type` is not
 *     enum-constrained;
 *   · the one consumer that switches on `event_type`
 *     (`src/orchestrator/context/event-log.ts:50`) has NO default case and no
 *     throw, so an unrecognised type is silently skipped;
 *   · there is no Zod schema over `scenarios.events` and no parse site anywhere
 *     in the served `src` — so it is NOT the `v5_handler_facts.payload` trap,
 *     where a strict 14-member union means one alien row breaks prior-fact
 *     loading for the whole scenario.
 *
 * ⚠ SCOPE OF THAT ABSENCE CLAIM: `src` of the served CEE commit only. The UI
 * repo was NOT searched, and a browser consumer of `scenarios.events` could
 * still be strict about unknown types. Check before this is relied on in
 * production.
 *
 * ⚠ And events arrays are SMALL today — the longest observed is 29 entries. One
 * ledger per turn would grow that quickly, so this writes one entry per admitted
 * model, not per turn, and the entry is a summary plus the items that cannot be
 * recovered from the graph at all.
 */

import type { RepairEntry } from '@talchain/schemas';

export const LEDGER_EVENT_TYPE = 'agent_lane_representation_loss';

export interface WithheldItem {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly detail: string;
}

export interface LedgerEventDetails {
  /** Which admission produced this, so a reader can tie it to a model version. */
  readonly graph_identity_hash: string | null;
  /**
   * The items that CANNOT be recovered from the persisted graph, because they
   * were withheld from it. This is the part that would otherwise be lost.
   */
  readonly withheld: readonly WithheldItem[];
  /** Per-field record of everything this system supplied that nobody authored. */
  readonly projected: readonly {
    readonly field_path: string;
    readonly code: string;
    readonly severity: 'info' | 'warn';
    readonly reason: string;
  }[];
  readonly counts: {
    readonly withheld: number;
    readonly projected: number;
    readonly projected_warn: number;
  };
}

export function buildLedgerEvent(input: {
  readonly graph_identity_hash: string | null;
  readonly withheld: readonly WithheldItem[];
  readonly loss: readonly RepairEntry[];
}): LedgerEventDetails {
  const projected = input.loss.map((l) => ({
    field_path: l.field_path,
    code: l.code,
    severity: l.severity,
    reason: l.reason,
  }));
  return {
    graph_identity_hash: input.graph_identity_hash,
    withheld: input.withheld,
    projected,
    counts: {
      withheld: input.withheld.length,
      projected: projected.length,
      projected_warn: projected.filter((p) => p.severity === 'warn').length,
    },
  };
}

/** The write seam, injected so this module never owns a database client. */
export interface LedgerSink {
  appendEvent(input: {
    scenario_id: string;
    event_id: string;
    event_type: string;
    details: unknown;
  }): Promise<void>;
}

export interface LedgerReader {
  readEvents(scenario_id: string): Promise<readonly { event_type: string; details: unknown }[]>;
}

export async function persistLedger(
  scenario_id: string,
  event_id: string,
  details: LedgerEventDetails,
  sink: LedgerSink,
): Promise<void> {
  await sink.appendEvent({ scenario_id, event_id, event_type: LEDGER_EVENT_TYPE, details });
}

/** Most recent ledger first. Total: a scenario with none returns []. */
export async function readLedgers(
  scenario_id: string,
  reader: LedgerReader,
): Promise<readonly LedgerEventDetails[]> {
  const events = await reader.readEvents(scenario_id);
  return events
    .filter((e) => e.event_type === LEDGER_EVENT_TYPE)
    .map((e) => e.details as LedgerEventDetails)
    .reverse();
}
