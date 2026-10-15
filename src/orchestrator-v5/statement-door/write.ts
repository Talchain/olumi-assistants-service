/**
 * ⭐ SYSTEM 1: ONE writer. A pressed door card is ONE `record_statement` operation, written through the existing atomic CAS level
 * door (`commitOptionLevels` → `executeOptionInterventionBatch`) as ONE revision, then read back by identity. Each field's adapter
 * maps the verified reading to the door member that already owns that carrier; no field gets its own store or writer.
 */
import type { DoorReading } from './read.js';

export const RECORD_STATEMENT_OP = 'record_statement' as const;
/** The level door's members (`dispatch.ts` OptionLevelsCommitInput) a field may write through. */
export type DoorWriteMember = 'levels' | 'values' | 'link_effects' | 'risk_occurrence' | 'team_time' | 'cohort_forecast' | 'goal_reading'
  | 'identity_confirm' | 'hiring_times';

/** What ONE press writes: the member and its payload, as JSON (the proposal is stored, and read back at the press). */
export interface DoorWrite {
  readonly member: DoorWriteMember;
  readonly payload: unknown;
}

/**
 * A row's adapter onto its carrier (`RoleRow.writer`, looked up with the row by `doorRowFor`). A reading the carrier cannot
 * represent is refused here, never written approximately. Its write's member is the row's carrier.
 */
export interface FieldWriter {
  readonly approve: (reading: DoorReading, graph: unknown) => DoorWrite | { readonly refused: string };
  /** True when `after` holds exactly this payload's write (the read-back by identity, and the verified no-op on a retry). */
  readonly holds: (payload: unknown, after: unknown) => boolean;
}
