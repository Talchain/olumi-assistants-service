/**
 * compareVersionRecords / summariseGraphDiff — pure CEE-side comparison.
 *
 * Pins: identity-hash short-circuit (including the envelope-version guard —
 * hashes from different projection/normaliser versions never compare),
 * analysis-affecting equivalence via the sanctioned Group A record, and the
 * deterministic typed categories with explicit coverage ledgers. Compact
 * counts remain an internal compatibility projection only.
 */
import { describe, it, expect } from 'vitest';

import {
  GRAPH_SCHEMA_VERSION,
  IDENTITY_NORMALISER_VERSION,
  IDENTITY_PROJECTION_VERSION,
} from '../../context/graph-identity.js';
import {
  compareVersionRecords,
  summariseGraphDiff,
  KNOWN_UNDETECTABLE_MODEL_VERSION_CHANGES,
  ModelVersionDiffInputError,
} from '../compare.js';
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
    expect(compareVersionRecords(from, to)).toMatchObject({
      relation: 'identical',
      short_circuit: true,
      from_version_id: from.id,
      to_version_id: to.id,
      analysis_equivalent: true,
    });
    const result = compareVersionRecords(from, to);
    expect(Object.values(result.categories).flat()).toEqual([]);
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
      expect(result.categories.assumptions_claims).toHaveLength(1);
      expect(result.categories.assumptions_claims[0].path).toBe('/nodes/n1/label');
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

  it('malformed graph payloads fail closed', () => {
    expect(() => compareVersionRecords(
      record({ graph: { corrupted: true } }),
      record({ graph: { nodes: [{ id: 'n1', kind: 'factor', label: 'A' }], edges: [] }, graph_identity_hash: HASH_B }),
    )).toThrow(ModelVersionDiffInputError);
  });
});

describe('deterministic semantic categories and coverage', () => {
  it('classifies uncertainty, provenance, presentation and unknown fields without dropping bytes', () => {
    const graphA = {
      nodes: [{
        id: 'n1', kind: 'factor', label: 'Price',
        observed_state: { value: 0.2, source: 'estimate' },
        position: { x: 1, y: 2 },
        custom_reasoning_field: 'before',
      }],
      edges: [],
    };
    const graphB = {
      nodes: [{
        id: 'n1', kind: 'factor', label: 'Price',
        observed_state: { value: 0.4, source: 'customer evidence' },
        position: { x: 8, y: 2 },
        custom_reasoning_field: 'after',
      }],
      edges: [],
    };
    const result = compareVersionRecords(record({ graph: graphA }), record({ graph: graphB, graph_identity_hash: HASH_B }));
    expect(result.relation).toBe('different');
    if (result.relation !== 'different') throw new Error('precondition');
    expect(result.categories.values_uncertainty.map((item) => item.path)).toContain('/nodes/n1/observed_state/value');
    expect(result.categories.evidence_provenance.map((item) => item.path)).toContain('/nodes/n1/observed_state/source');
    expect(result.categories.presentation.map((item) => item.path)).toContain('/nodes/n1/position/x');
    expect(result.categories.other_model_fields.map((item) => item.path)).toContain('/nodes/n1/custom_reasoning_field');
    expect(result.coverage.known_uninterpreted_paths).toEqual(['/nodes/n1/custom_reasoning_field']);
  });

  it('pins the exact known-undetectable ledger', () => {
    expect(KNOWN_UNDETECTABLE_MODEL_VERSION_CHANGES).toEqual([
      'conversation_or_discussion_not_committed_to_the_shared_graph',
      'private_contributions_not_revealed_into_the_shared_graph',
      'scenario_brief_text_outside_the_graph_version_snapshot',
    ]);
  });

  it('fails closed on duplicate node or edge authority', () => {
    const duplicateNodes = { nodes: [{ id: 'n1' }, { id: 'n1' }], edges: [] };
    expect(() => compareVersionRecords(record({ graph: duplicateNodes }), record({ graph_identity_hash: HASH_B }))).toThrow(/duplicate node id/);
    const duplicateEdges = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }],
    };
    expect(() => compareVersionRecords(record({ graph: duplicateEdges }), record({ graph_identity_hash: HASH_B }))).toThrow(/duplicate edge identity/);
  });

  it('fails closed on dangling connectors and malformed recognised collections', () => {
    const dangling = {
      nodes: [{ id: 'a' }],
      edges: [{ id: 'e1', from: 'a', to: 'missing' }],
    };
    expect(() =>
      compareVersionRecords(
        record({ graph: dangling }),
        record({ graph_identity_hash: HASH_B }),
      ),
    ).toThrow(/references a missing node/);

    const idlessOption = {
      nodes: [{ id: 'a' }],
      edges: [],
      options: [{ label: 'No stable identity' }],
    };
    expect(() =>
      compareVersionRecords(
        record({ graph: idlessOption }),
        record({ graph_identity_hash: HASH_B }),
      ),
    ).toThrow(/options item without a stable identity/);
  });

  it('uses constraint_id rather than target node as constraint authority', () => {
    const graphA = {
      nodes: [{ id: 'target' }],
      edges: [],
      goal_constraints: [
        { constraint_id: 'minimum', node_id: 'target', operator: '>=', value: 10 },
        { constraint_id: 'maximum', node_id: 'target', operator: '<=', value: 20 },
      ],
    };
    const graphB = {
      ...graphA,
      goal_constraints: [
        graphA.goal_constraints[0],
        { ...graphA.goal_constraints[1], value: 30 },
      ],
    };
    const result = compareVersionRecords(
      record({ graph: graphA }),
      record({ graph: graphB, graph_identity_hash: HASH_B }),
    );
    expect(result.relation).toBe('different');
    if (result.relation !== 'different') throw new Error('precondition');
    expect(result.categories.goals_constraints_options).toEqual([
      expect.objectContaining({
        entity_id: 'maximum',
        path: '/goal_constraints/maximum/value',
        change_kind: 'changed',
      }),
    ]);

    const duplicateConstraint = {
      ...graphA,
      goal_constraints: [graphA.goal_constraints[0], graphA.goal_constraints[0]],
    };
    expect(() =>
      compareVersionRecords(
        record({ graph: duplicateConstraint }),
        record({ graph_identity_hash: HASH_B }),
      ),
    ).toThrow(/duplicate goal_constraints identity minimum/);
  });

  it('compares distinct parallel connectors by stable id or connector type', () => {
    const graphA = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { id: 'direct', from: 'a', to: 'b', edge_type: 'directed', strength: { mean: 0.2 } },
        { id: 'confounded', from: 'a', to: 'b', edge_type: 'bidirected', strength: { mean: 0.1 } },
      ],
    };
    const graphB = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { id: 'direct', from: 'a', to: 'b', edge_type: 'directed', strength: { mean: 0.8 } },
        { id: 'confounded', from: 'a', to: 'b', edge_type: 'bidirected', strength: { mean: 0.1 } },
      ],
    };
    const result = compareVersionRecords(
      record({ graph: graphA }),
      record({ graph: graphB, graph_identity_hash: HASH_B }),
    );
    expect(result.relation).toBe('different');
    if (result.relation !== 'different') throw new Error('precondition');
    expect(result.categories.values_uncertainty.map((item) => item.entity_id)).toEqual(['direct']);

    const idlessA = {
      ...graphA,
      edges: graphA.edges.map(({ id: _id, ...edge }) => edge),
    };
    const idlessB = {
      ...graphB,
      edges: graphB.edges.map(({ id: _id, ...edge }) => edge),
    };
    expect(() =>
      compareVersionRecords(
        record({ graph: idlessA }),
        record({ graph: idlessB, graph_identity_hash: HASH_B }),
      ),
    ).not.toThrow();
  });

  it('classifies every category deterministically in both directions', () => {
    const graphA = {
      nodes: [{
        id: 'n1',
        kind: 'factor',
        label: 'Price',
        observed_state: { value: 0.2 },
        evidence: { source: 'forecast' },
        position: { x: 1, y: 2 },
        custom_reasoning_field: 'before',
      }],
      edges: [{ from: 'n1', to: 'n1', polarity: 'positive' }],
      options: [{ id: 'o1', label: 'Keep' }],
      goal_constraints: [],
    };
    const graphB = {
      nodes: [
        {
          id: 'n1',
          kind: 'factor',
          label: 'Unit price',
          observed_state: { value: 0.7 },
          evidence: { source: 'customer study' },
          position: { x: 8, y: 2 },
          custom_reasoning_field: 'after',
        },
        { id: 'n2', kind: 'outcome', label: 'Revenue' },
      ],
      edges: [{ from: 'n1', to: 'n1', polarity: 'negative' }],
      options: [{ id: 'o1', label: 'Change' }],
      goal_constraints: [],
    };
    const from = record({ graph: graphA, graph_identity_hash: HASH_A });
    const to = record({
      id: '22222222-2222-4222-8222-222222222222',
      graph: graphB,
      graph_identity_hash: HASH_B,
    });

    const forward = compareVersionRecords(from, to);
    const reverse = compareVersionRecords(to, from);
    expect(forward.relation).toBe('different');
    expect(reverse.relation).toBe('different');
    if (forward.relation !== 'different' || reverse.relation !== 'different') throw new Error('precondition');

    for (const category of [
      'structure',
      'relationships',
      'values_uncertainty',
      'evidence_provenance',
      'goals_constraints_options',
      'assumptions_claims',
      'presentation',
      'other_model_fields',
    ] as const) {
      expect(forward.categories[category].length, `forward ${category}`).toBeGreaterThan(0);
      expect(reverse.categories[category].length, `reverse ${category}`).toBeGreaterThan(0);
      const keys = forward.categories[category].map((item) =>
        JSON.stringify([item.path, item.change_kind, item.entity_kind, item.entity_id]));
      expect(keys).toEqual([...keys].sort());
    }
    expect(forward.categories.structure.find((item) => item.entity_id === 'n2')?.change_kind).toBe('added');
    expect(reverse.categories.structure.find((item) => item.entity_id === 'n2')?.change_kind).toBe('removed');
    expect(compareVersionRecords(from, to)).toEqual(forward);
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
