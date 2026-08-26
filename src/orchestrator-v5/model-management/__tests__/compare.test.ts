/**
 * compareVersionRecords / summariseGraphDiff — pure CEE-side comparison.
 *
 * Pins: identity-hash short-circuit (including the envelope-version guard —
 * hashes from different projection/normaliser versions never compare),
 * analysis-affecting equivalence via the sanctioned Group A record, and the
 * compact counts-only structural diff.
 */
import { describe, it, expect } from 'vitest';

import {
  GRAPH_SCHEMA_VERSION,
  IDENTITY_NORMALISER_VERSION,
  IDENTITY_PROJECTION_VERSION,
} from '../../context/graph-identity.js';
import { compareVersionRecords, summariseGraphDiff } from '../compare.js';
import type { ModelVersionRecord } from '../types.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function record(overrides: Partial<ModelVersionRecord> = {}): ModelVersionRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    owner_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version_number: 1,
    graph: { nodes: [{ id: 'n1', kind: 'factor', label: 'A' }], edges: [] },
    graph_identity_hash: HASH_A,
    hash_algorithm: 'sha256',
    identity_projection_version: IDENTITY_PROJECTION_VERSION,
    identity_normaliser_version: IDENTITY_NORMALISER_VERSION,
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    label: null,
    provenance: null,
    restored_from_version_id: null,
    created_at: '2026-07-05T10:00:00.000+00:00',
    ...overrides,
  };
}

describe('identity short-circuit', () => {
  it('equal hash under equal envelope versions ⇒ identical, no diff computed', () => {
    const from = record();
    const to = record({ id: '22222222-2222-4222-8222-222222222222', version_number: 2 });
    expect(compareVersionRecords(from, to)).toEqual({
      relation: 'identical',
      short_circuit: true,
    });
  });

  it('equal hash under DIFFERENT projection versions does NOT short-circuit (regime guard)', () => {
    const from = record();
    const to = record({ identity_projection_version: 'identity.v2' });
    const result = compareVersionRecords(from, to);
    expect(result.relation).toBe('different');
    expect(result.short_circuit).toBe(false);
  });

  it('different hashes fall through to the diff path', () => {
    const from = record();
    const to = record({ graph_identity_hash: HASH_B });
    expect(compareVersionRecords(from, to).relation).toBe('different');
  });
});

describe('analysis-affecting equivalence (sanctioned hash reused)', () => {
  it('label-only difference ⇒ analysis_equivalent true (labels are excluded from the analysis hash)', () => {
    const graphA = {
      nodes: [
        { id: 'n1', kind: 'factor', label: 'Price' },
        { id: 'n2', kind: 'outcome', label: 'Revenue' },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    };
    const graphB = {
      nodes: [
        { id: 'n1', kind: 'factor', label: 'Unit price (renamed)' },
        { id: 'n2', kind: 'outcome', label: 'Revenue' },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    };
    const result = compareVersionRecords(
      record({ graph: graphA }),
      record({ graph: graphB, graph_identity_hash: HASH_B }),
    );
    expect(result.relation).toBe('different');
    if (result.relation === 'different') {
      expect(result.analysis_equivalent).toBe(true);
      expect(result.diff.nodes_changed).toBe(1);
      expect(result.diff.nodes_added).toBe(0);
      expect(result.diff.nodes_removed).toBe(0);
      expect(result.diff.edges_changed).toBe(0);
    }
  });

  it('structural difference ⇒ analysis_equivalent false', () => {
    const graphA = {
      nodes: [{ id: 'n1', kind: 'factor', label: 'A' }],
      edges: [],
    };
    const graphB = {
      nodes: [
        { id: 'n1', kind: 'factor', label: 'A' },
        { id: 'n2', kind: 'outcome', label: 'B' },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    };
    const result = compareVersionRecords(
      record({ graph: graphA }),
      record({ graph: graphB, graph_identity_hash: HASH_B }),
    );
    expect(result.relation).toBe('different');
    if (result.relation === 'different') {
      expect(result.analysis_equivalent).toBe(false);
      expect(result.diff.nodes_added).toBe(1);
      expect(result.diff.edges_added).toBe(1);
    }
  });

  it('malformed graph payloads degrade to analysis_equivalent null, never a throw', () => {
    const result = compareVersionRecords(
      record({ graph: { corrupted: true } }),
      record({ graph: { nodes: [{ id: 'n1', kind: 'factor', label: 'A' }], edges: [] }, graph_identity_hash: HASH_B }),
    );
    expect(result.relation).toBe('different');
    if (result.relation === 'different') {
      expect(result.analysis_equivalent).toBeNull();
    }
  });
});

describe('summariseGraphDiff — compact counts, no prose', () => {
  it('counts added/removed/changed nodes and edges', () => {
    const before = {
      nodes: [
        { id: 'keep', kind: 'factor', label: 'same' },
        { id: 'mutate', kind: 'factor', label: 'old' },
        { id: 'drop', kind: 'factor', label: 'bye' },
      ],
      edges: [
        { from: 'keep', to: 'mutate' },
        { from: 'mutate', to: 'drop' },
      ],
    };
    const after = {
      nodes: [
        { id: 'keep', kind: 'factor', label: 'same' },
        { id: 'mutate', kind: 'factor', label: 'new' },
        { id: 'fresh', kind: 'outcome', label: 'hi' },
      ],
      edges: [
        { from: 'keep', to: 'mutate' },
        { from: 'keep', to: 'fresh' },
      ],
    };
    expect(summariseGraphDiff(before, after)).toEqual({
      nodes_added: 1,
      nodes_removed: 1,
      nodes_changed: 1,
      edges_added: 1,
      edges_removed: 1,
      edges_changed: 0,
    });
  });

  it('edges with ids are keyed by id; edge mutation counts as changed', () => {
    const before = { nodes: [], edges: [{ id: 'e1', from: 'a', to: 'b', strength: { mean: 0.2 } }] };
    const after = { nodes: [], edges: [{ id: 'e1', from: 'a', to: 'b', strength: { mean: 0.7 } }] };
    expect(summariseGraphDiff(before, after)).toEqual({
      nodes_added: 0,
      nodes_removed: 0,
      nodes_changed: 0,
      edges_added: 0,
      edges_removed: 0,
      edges_changed: 1,
    });
  });

  it('degenerate/absent shapes diff as empty sets', () => {
    expect(summariseGraphDiff(null, { nodes: [{ id: 'n1' }], edges: [] })).toEqual({
      nodes_added: 1,
      nodes_removed: 0,
      nodes_changed: 0,
      edges_added: 0,
      edges_removed: 0,
      edges_changed: 0,
    });
    expect(summariseGraphDiff(undefined, undefined)).toEqual({
      nodes_added: 0,
      nodes_removed: 0,
      nodes_changed: 0,
      edges_added: 0,
      edges_removed: 0,
      edges_changed: 0,
    });
  });
});
