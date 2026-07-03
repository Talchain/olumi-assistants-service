/**
 * SQL ↔ TS parity pin: the inert migration
 * migrations/006_create_cee_m2_artifacts.sql must express exactly the bounds
 * declared in src/cee/dual-model/artifacts/types.ts. Read-only filesystem
 * access to the committed SQL text — catches either side drifting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ARTIFACT_FIELD_CAPS,
  MAX_ARTIFACTS_PER_TURN,
  M2_ARTIFACT_TYPES,
  M2_ARTIFACT_STATUSES,
} from '../artifacts/types.js';
import { M2_ARTIFACTS_TABLE } from '../artifacts/supabase-store.js';

const MIGRATION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../migrations/006_create_cee_m2_artifacts.sql',
);
const sql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('migration 006 ↔ artifacts/types.ts parity', () => {
  it('creates exactly the table the Supabase store targets', () => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${M2_ARTIFACTS_TABLE}`);
  });

  it('bounds artifact_index by MAX_ARTIFACTS_PER_TURN', () => {
    expect(sql).toContain(`artifact_index >= 0 AND artifact_index < ${MAX_ARTIFACTS_PER_TURN}`);
  });

  it('field CHECK caps match ARTIFACT_FIELD_CAPS', () => {
    expect(sql).toContain(`char_length(question) BETWEEN 1 AND ${ARTIFACT_FIELD_CAPS.question}`);
    expect(sql).toContain(`char_length(rationale) <= ${ARTIFACT_FIELD_CAPS.rationale}`);
    expect(sql).toContain(
      `char_length(evidence_pointer) BETWEEN 1 AND ${ARTIFACT_FIELD_CAPS.evidence_pointer}`,
    );
  });

  it('proposal_type CHECK admits exactly the four artifact types', () => {
    for (const type of M2_ARTIFACT_TYPES) expect(sql).toContain(`'${type}'`);
    const checkClause = /proposal_type IN\s*\(([^)]+)\)/.exec(sql);
    expect(checkClause).not.toBeNull();
    const listed = [...checkClause![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...M2_ARTIFACT_TYPES].sort());
  });

  it("status CHECK admits exactly the four statuses — and never 'rejected'", () => {
    const checkClause = /status IN\s*\(([^)]+)\)/.exec(sql);
    expect(checkClause).not.toBeNull();
    const listed = [...checkClause![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...M2_ARTIFACT_STATUSES].sort());
    expect(listed).not.toContain('rejected');
  });

  it('declares the composite unique key the stores rely on for idempotency', () => {
    expect(sql).toContain('ON cee_m2_artifacts (scenario_id, turn_id, artifact_index)');
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_cee_m2_artifacts_turn_artifact/);
  });

  it('is explicitly marked inert/unapplied', () => {
    expect(sql).toContain('INERT / UNAPPLIED');
  });
});
