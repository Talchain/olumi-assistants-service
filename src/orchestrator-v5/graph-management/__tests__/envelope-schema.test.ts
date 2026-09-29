/**
 * Track 3 — R1 schema-gate matrix (fail-closed). A valid envelope per kind parses;
 * unknown version/kind, extra field, missing provenance, empty evidence_pointer,
 * and missing/empty base_graph_hash all REJECT with the right redacted reason code.
 */
import { describe, it, expect } from 'vitest';
import { parseEnvelope } from '../parse-envelope.js';
import { CANDIDATE_KINDS, type CandidateKind } from '../types.js';
import {
  SCHEMA_INVALID,
  UNKNOWN_KIND,
  UNKNOWN_ENVELOPE_VERSION,
  MISSING_PROVENANCE,
  EVIDENCE_POINTER_MISSING,
  BASE_HASH_MISSING,
} from '../reason-codes.js';
import { makeEnvelope, SAMPLE_PAYLOADS } from './fixtures.js';

describe('R1 envelope schema gate — valid per kind', () => {
  for (const kind of CANDIDATE_KINDS) {
    it(`accepts a well-formed ${kind} envelope`, () => {
      const raw = makeEnvelope(kind, SAMPLE_PAYLOADS[kind]);
      const r = parseEnvelope(raw);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    });
  }
});

describe('R1 envelope schema gate — fail-closed', () => {
  const validRename = () => makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node);

  it('rejects an unknown kind (UNKNOWN_KIND)', () => {
    const raw = { ...validRename(), kind: 'teleport_node' };
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(UNKNOWN_KIND);
  });

  it('rejects an unknown envelope_version (UNKNOWN_ENVELOPE_VERSION)', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { envelope_version: 2 });
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(UNKNOWN_ENVELOPE_VERSION);
  });

  it('rejects an extra top-level field (SCHEMA_INVALID)', () => {
    const raw = { ...validRename(), injected: 'nope' };
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(SCHEMA_INVALID);
  });

  it('rejects an extra payload field for EVERY kind (SCHEMA_INVALID)', () => {
    for (const kind of CANDIDATE_KINDS) {
      const payload = { ...SAMPLE_PAYLOADS[kind], _invented: true };
      const raw = makeEnvelope(kind as CandidateKind, payload);
      const r = parseEnvelope(raw);
      expect(r.ok, `${kind} should reject an extra payload field`).toBe(false);
      if (!r.ok) expect(r.blocker.code).toBe(SCHEMA_INVALID);
    }
  });

  it('rejects a missing provenance block (MISSING_PROVENANCE)', () => {
    const raw = validRename();
    delete (raw as Record<string, unknown>).provenance;
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(MISSING_PROVENANCE);
  });

  it('rejects an empty evidence_pointer (EVIDENCE_POINTER_MISSING)', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { evidence_pointer: '' });
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(EVIDENCE_POINTER_MISSING);
  });

  it('rejects a missing base_graph_hash (BASE_HASH_MISSING)', () => {
    const raw = validRename();
    delete (raw as Record<string, unknown>).base_graph_hash;
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(BASE_HASH_MISSING);
  });

  it('rejects a null base_graph_hash (BASE_HASH_MISSING) — null is FORBIDDEN', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node);
    (raw as Record<string, unknown>).base_graph_hash = null;
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(BASE_HASH_MISSING);
  });

  it('rejects an empty base_graph_hash (BASE_HASH_MISSING)', () => {
    const raw = makeEnvelope('rename_node', SAMPLE_PAYLOADS.rename_node, { base_graph_hash: '' });
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.blocker.code).toBe(BASE_HASH_MISSING);
  });

  it('redaction: the readable message carries a path + code but no raw value', () => {
    const raw = { ...validRename(), kind: 'teleport_node' };
    const r = parseEnvelope(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.blocker.readable).not.toContain('teleport_node');
      expect(r.blocker.readable).toContain(UNKNOWN_KIND);
    }
  });

  it('TOTALITY: null / non-object input rejects, never throws', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      const r = parseEnvelope(bad);
      expect(r.ok).toBe(false);
    }
  });
});
