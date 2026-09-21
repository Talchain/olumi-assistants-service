/**
 * Model Management v1 — fixture self-verification.
 *
 * Keeps the proposed shared fixtures honest: identities come from the real
 * Group A module (never hand-forged), are deterministic, sit in the CURRENT
 * identity regime (the envelope-version alignment is the golden-pin surrogate
 * — it fails loudly if the projection/normaliser/schema versions drift), and
 * the fixture rows satisfy the strict PR-C response contracts.
 */
import { describe, it, expect } from 'vitest';

import {
  computeAnalysisAffectingHashRecord,
  GRAPH_SCHEMA_VERSION,
  IDENTITY_NORMALISER_VERSION,
  IDENTITY_PROJECTION_VERSION,
} from '../../context/graph-identity.js';
import {
  ModelVersionRecordResponseSchema,
  ModelVersionSummaryResponseSchema,
  VersionWriteOutcomeResponseSchema,
} from '../contracts.js';
import {
  BASE_GRAPH,
  LABEL_ONLY_EDIT,
  STRUCTURAL_EDIT,
  identityOf,
  versionRecord,
  versionSummary,
  writeOutcome,
} from './fixtures.js';

describe('fixtures — identity is real, deterministic, and in the current regime', () => {
  it('identityOf is deterministic and 64-hex', () => {
    const a = identityOf(BASE_GRAPH);
    const b = identityOf(BASE_GRAPH);
    expect(a.value).toBe(b.value);
    expect(a.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('envelope-version alignment (golden-pin surrogate — catches identity-regime drift)', () => {
    const id = identityOf(BASE_GRAPH);
    expect(id.projection_version).toBe(IDENTITY_PROJECTION_VERSION);
    expect(id.normaliser_version).toBe(IDENTITY_NORMALISER_VERSION);
    expect(id.graph_schema_version).toBe(GRAPH_SCHEMA_VERSION);
    expect(id.algorithm).toBe('sha256');
  });
});

describe('fixtures — edit-class invariants (feed compare + freshness reasoning)', () => {
  it('LABEL_ONLY_EDIT: identity DIFFERS, analysis-affecting hash is EQUAL (analysis-equivalent)', () => {
    expect(identityOf(LABEL_ONLY_EDIT).value).not.toBe(identityOf(BASE_GRAPH).value);
    const base = computeAnalysisAffectingHashRecord(BASE_GRAPH);
    const edit = computeAnalysisAffectingHashRecord(LABEL_ONLY_EDIT);
    expect(base).not.toBeNull();
    expect(edit).not.toBeNull();
    expect(edit?.value).toBe(base?.value);
  });

  it('STRUCTURAL_EDIT: BOTH identity and analysis-affecting hashes differ', () => {
    expect(identityOf(STRUCTURAL_EDIT).value).not.toBe(identityOf(BASE_GRAPH).value);
    const base = computeAnalysisAffectingHashRecord(BASE_GRAPH);
    const edit = computeAnalysisAffectingHashRecord(STRUCTURAL_EDIT);
    expect(edit?.value).not.toBe(base?.value);
  });
});

describe('fixtures — rows satisfy the strict PR-C response contracts', () => {
  it('versionSummary parses under the summary response schema', () => {
    expect(ModelVersionSummaryResponseSchema.safeParse(versionSummary()).success).toBe(true);
  });

  it('versionRecord parses under the record response schema (summary + graph)', () => {
    expect(ModelVersionRecordResponseSchema.safeParse(versionRecord()).success).toBe(true);
  });

  it('writeOutcome parses under the write-outcome response schema', () => {
    expect(VersionWriteOutcomeResponseSchema.safeParse(writeOutcome()).success).toBe(true);
    expect(
      VersionWriteOutcomeResponseSchema.safeParse(
        writeOutcome(BASE_GRAPH, { deduped: true, event_id: null }),
      ).success,
    ).toBe(true);
  });
});
