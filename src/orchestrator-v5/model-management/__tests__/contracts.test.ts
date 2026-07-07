/**
 * Model Management v1 — strict boundary contract tests.
 *
 * The load-bearing suite is the SECURITY block: the server owns graph + hash
 * truth, so the request schemas must have nowhere for a client to put it and
 * must REJECT (not silently strip) any smuggled identity hash / envelope /
 * client graph. These are proven with fixtures, not schema intent alone —
 * `.strict()` behaviour and 64-hex refinements are runtime, invisible to tsc.
 */
import { describe, it, expect } from 'vitest';

import {
  CreateVersionRequestSchema,
  RestoreVersionRequestSchema,
  ListVersionsRequestSchema,
  GetCurrentVersionRequestSchema,
  ModelVersionSummaryResponseSchema,
  ModelVersionRecordResponseSchema,
  VersionWriteOutcomeResponseSchema,
  VersionComparisonResponseSchema,
  ListVersionsResponseSchema,
  CurrentVersionResponseSchema,
  ModelManagementErrorResponseSchema,
  VersionCasConflictResponseSchema,
} from '../contracts.js';
import { CAS_CONFLICT_KIND } from '../types.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH = 'a'.repeat(64);
const GRAPH = { nodes: [{ id: 'n1', kind: 'factor', label: 'Price' }], edges: [] };

const summary = () => ({
  id: VERSION,
  scenario_id: SCENARIO,
  owner_user_id: OWNER,
  version_number: 3,
  graph_identity_hash: HASH,
  hash_algorithm: 'sha256',
  identity_projection_version: 'gip.v1',
  identity_normaliser_version: 'gin.v1',
  graph_schema_version: 'gsv.v1',
  label: null,
  provenance: null,
  restored_from_version_id: null,
  created_at: '2026-07-06T10:00:00.000+00:00',
});

// ===========================================================================
// SECURITY — the server owns graph + hash truth (load-bearing).
// ===========================================================================
describe('contracts SECURITY — client cannot supply graph or hash truth', () => {
  it('create ACCEPTS expected_graph_identity_hash (CAS expectation) but REJECTS graph_identity_hash (identity truth)', () => {
    const base = { scenario_id: SCENARIO, graph: GRAPH };
    // The optimistic-CAS expectation is allowed…
    expect(CreateVersionRequestSchema.safeParse({ ...base, expected_graph_identity_hash: HASH }).success).toBe(true);
    // …but a field that would DICTATE the stored identity is refused outright.
    expect(CreateVersionRequestSchema.safeParse({ ...base, graph_identity_hash: HASH }).success).toBe(false);
  });

  it('create REJECTS every smuggled identity-envelope field (strict, not stripped)', () => {
    const base = { scenario_id: SCENARIO, graph: GRAPH };
    for (const field of [
      'hash_algorithm',
      'identity_projection_version',
      'identity_normaliser_version',
      'graph_schema_version',
      'version_number',
      'owner_user_id',
      'id',
    ]) {
      expect(
        CreateVersionRequestSchema.safeParse({ ...base, [field]: 'x' }).success,
        `create must reject smuggled field '${field}'`,
      ).toBe(false);
    }
  });

  it('restore REJECTS a client-supplied graph (restore copies the target graph server-side)', () => {
    const base = { scenario_id: SCENARIO, version_id: VERSION };
    expect(RestoreVersionRequestSchema.safeParse(base).success).toBe(true);
    expect(RestoreVersionRequestSchema.safeParse({ ...base, graph: GRAPH }).success).toBe(false);
  });

  it('restore ACCEPTS expected_graph_identity_hash but REJECTS graph_identity_hash', () => {
    const base = { scenario_id: SCENARIO, version_id: VERSION };
    expect(RestoreVersionRequestSchema.safeParse({ ...base, expected_graph_identity_hash: HASH }).success).toBe(true);
    expect(RestoreVersionRequestSchema.safeParse({ ...base, graph_identity_hash: HASH }).success).toBe(false);
  });

  it('expected_graph_identity_hash must be 64-hex (a malformed CAS expectation is rejected, not coerced)', () => {
    const base = { scenario_id: SCENARIO, graph: GRAPH };
    expect(CreateVersionRequestSchema.safeParse({ ...base, expected_graph_identity_hash: 'nothex' }).success).toBe(false);
    expect(CreateVersionRequestSchema.safeParse({ ...base, expected_graph_identity_hash: 'A'.repeat(64) }).success).toBe(false); // uppercase
    expect(CreateVersionRequestSchema.safeParse({ ...base, expected_graph_identity_hash: 'a'.repeat(63) }).success).toBe(false); // short
  });

  it('a parsed create carries NO identity field — only the graph + optional CAS expectation', () => {
    const parsed = CreateVersionRequestSchema.parse({
      scenario_id: SCENARIO,
      graph: GRAPH,
      expected_graph_identity_hash: HASH,
    });
    // The only hash-bearing key is the namespaced expectation; there is nowhere
    // for identity truth to live in a request.
    expect(Object.keys(parsed).some((k) => k === 'graph_identity_hash')).toBe(false);
    expect(parsed).toHaveProperty('expected_graph_identity_hash', HASH);
  });
});

// ===========================================================================
// REQUEST schemas — positive + shape refinements.
// ===========================================================================
describe('contracts REQUEST — valid shapes + runtime refinements', () => {
  it('create: minimal valid request parses; unknown top-level keys are rejected', () => {
    expect(CreateVersionRequestSchema.safeParse({ scenario_id: SCENARIO, graph: GRAPH }).success).toBe(true);
    expect(
      CreateVersionRequestSchema.safeParse({ scenario_id: SCENARIO, graph: GRAPH, surprise: 1 }).success,
    ).toBe(false);
  });

  it('create: non-uuid scenario_id rejected (runtime refinement — invisible at type level)', () => {
    expect(CreateVersionRequestSchema.safeParse({ scenario_id: 'not-a-uuid', graph: GRAPH }).success).toBe(false);
  });

  it('create: malformed graph (missing nodes/edges arrays) rejected by the reused ingress schema', () => {
    expect(CreateVersionRequestSchema.safeParse({ scenario_id: SCENARIO, graph: { nodes: [] } }).success).toBe(false);
    expect(CreateVersionRequestSchema.safeParse({ scenario_id: SCENARIO, graph: {} }).success).toBe(false);
  });

  it('restore: valid request parses; version_id must be a uuid', () => {
    expect(RestoreVersionRequestSchema.safeParse({ scenario_id: SCENARIO, version_id: VERSION }).success).toBe(true);
    expect(RestoreVersionRequestSchema.safeParse({ scenario_id: SCENARIO, version_id: 'nope' }).success).toBe(false);
  });

  it('list: limit is optional and bounded (positive int ≤ 200)', () => {
    expect(ListVersionsRequestSchema.safeParse({ scenario_id: SCENARIO }).success).toBe(true);
    expect(ListVersionsRequestSchema.safeParse({ scenario_id: SCENARIO, limit: 50 }).success).toBe(true);
    expect(ListVersionsRequestSchema.safeParse({ scenario_id: SCENARIO, limit: 0 }).success).toBe(false);
    expect(ListVersionsRequestSchema.safeParse({ scenario_id: SCENARIO, limit: 201 }).success).toBe(false);
    expect(ListVersionsRequestSchema.safeParse({ scenario_id: SCENARIO, limit: 1.5 }).success).toBe(false);
  });

  it('current: requires only a uuid scenario_id, strict', () => {
    expect(GetCurrentVersionRequestSchema.safeParse({ scenario_id: SCENARIO }).success).toBe(true);
    expect(GetCurrentVersionRequestSchema.safeParse({ scenario_id: SCENARIO, limit: 1 }).success).toBe(false);
  });
});

// ===========================================================================
// RESPONSE schemas — server-owned egress shapes (drift is rejected).
// ===========================================================================
describe('contracts RESPONSE — egress shapes mirror types.ts and reject drift', () => {
  it('summary: valid parses; a missing field or extra field is rejected (strict)', () => {
    expect(ModelVersionSummaryResponseSchema.safeParse(summary()).success).toBe(true);
    const { graph_identity_hash: _omit, ...missing } = summary();
    expect(ModelVersionSummaryResponseSchema.safeParse(missing).success).toBe(false);
    expect(ModelVersionSummaryResponseSchema.safeParse({ ...summary(), graph: GRAPH }).success).toBe(false);
  });

  it('record: summary + graph snapshot parses; an unknown extra key is still rejected (strict)', () => {
    expect(ModelVersionRecordResponseSchema.safeParse({ ...summary(), graph: GRAPH }).success).toBe(true);
    expect(ModelVersionRecordResponseSchema.safeParse({ ...summary(), graph: GRAPH, surprise: 1 }).success).toBe(false);
  });

  it('write outcome: create + restore (with lineage) parse; malformed hash rejected', () => {
    const create = { version_id: VERSION, version_number: 4, graph_identity_hash: HASH, deduped: false, event_id: 'evt_1' };
    expect(VersionWriteOutcomeResponseSchema.safeParse(create).success).toBe(true);
    expect(VersionWriteOutcomeResponseSchema.safeParse({ ...create, deduped: true, event_id: null }).success).toBe(true);
    expect(
      VersionWriteOutcomeResponseSchema.safeParse({ ...create, restored_from_version_id: VERSION }).success,
    ).toBe(true);
    expect(VersionWriteOutcomeResponseSchema.safeParse({ ...create, graph_identity_hash: 'short' }).success).toBe(false);
  });

  it('comparison: identical + different variants parse; a bad relation is rejected', () => {
    expect(VersionComparisonResponseSchema.safeParse({ relation: 'identical', short_circuit: true }).success).toBe(true);
    expect(
      VersionComparisonResponseSchema.safeParse({
        relation: 'different',
        short_circuit: false,
        analysis_equivalent: null,
        diff: { nodes_added: 1, nodes_removed: 0, nodes_changed: 2, edges_added: 0, edges_removed: 1, edges_changed: 0 },
      }).success,
    ).toBe(true);
    expect(VersionComparisonResponseSchema.safeParse({ relation: 'sideways' }).success).toBe(false);
  });

  it('list + current envelopes: summaries-only list, nullable current record', () => {
    expect(ListVersionsResponseSchema.safeParse({ versions: [summary()] }).success).toBe(true);
    expect(CurrentVersionResponseSchema.safeParse({ current: null }).success).toBe(true);
    expect(CurrentVersionResponseSchema.safeParse({ current: { ...summary(), graph: GRAPH } }).success).toBe(true);
  });
});

// ===========================================================================
// SAFE ERROR / CONFLICT shapes.
// ===========================================================================
describe('contracts ERROR — safe typed error + CAS conflict shapes', () => {
  it('error: valid codes parse; an unknown code is rejected', () => {
    for (const code of ['sign_in_required', 'version_not_found', 'empty_graph', 'store_error']) {
      expect(ModelManagementErrorResponseSchema.safeParse({ code, recoverable: true, message: 'x' }).success).toBe(true);
    }
    expect(ModelManagementErrorResponseSchema.safeParse({ code: 'made_up', recoverable: true, message: 'x' }).success).toBe(false);
  });

  it('conflict: kind is pinned to the A3 vocabulary term; expected hash may be null', () => {
    expect(
      VersionCasConflictResponseSchema.safeParse({ kind: CAS_CONFLICT_KIND, expected_graph_identity_hash: HASH, message: 'stale' }).success,
    ).toBe(true);
    expect(
      VersionCasConflictResponseSchema.safeParse({ kind: CAS_CONFLICT_KIND, expected_graph_identity_hash: null, message: 'stale' }).success,
    ).toBe(true);
    expect(
      VersionCasConflictResponseSchema.safeParse({ kind: 'other_kind', expected_graph_identity_hash: null, message: 'stale' }).success,
    ).toBe(false);
  });
});
