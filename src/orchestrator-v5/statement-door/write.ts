/**
 * ⭐ SYSTEM 1: ONE writer. A pressed door card is ONE `record_statement` operation, written through the existing atomic CAS level
 * door (`commitOptionLevels` → `executeOptionInterventionBatch`) as ONE revision, then read back by identity. Each field's adapter
 * maps the verified reading to the door member that already owns that carrier; no field gets its own store or writer.
 */
import type { DoorReading } from './read.js';
import type { StatementField } from './subject.js';

export const RECORD_STATEMENT_OP = 'record_statement' as const;
/** The level door's members (`dispatch.ts` OptionLevelsCommitInput) a field may write through. */
export type DoorWriteMember = 'levels' | 'values' | 'link_effects' | 'risk_occurrence' | 'team_time' | 'cohort_forecast' | 'goal_reading'
  | 'identity_confirm' | 'hiring_times';

/** What ONE press writes: the member, its payload, and the read-back that proves exactly that landed. */
export interface DoorWrite {
  readonly member: DoorWriteMember;
  readonly payload: unknown;
  /** True when `after` holds exactly the card's write (the read-back, and the verified no-op on a retry). */
  readonly holds: (after: unknown) => boolean;
}

/** A field's adapter onto its member. A reading the carrier cannot represent is refused here, never written approximately. */
export interface FieldWriter {
  readonly member: DoorWriteMember;
  readonly approve: (reading: DoorReading, graph: unknown) => DoorWrite | { readonly refused: string };
}

/** The adapters. Empty in the contract (PR-0); each migration registers its field's adapter with its table row. */
export const FIELD_WRITERS: Partial<Record<StatementField, FieldWriter>> = {};
export const fieldWriterFor = (field: StatementField): FieldWriter | undefined => FIELD_WRITERS[field];
