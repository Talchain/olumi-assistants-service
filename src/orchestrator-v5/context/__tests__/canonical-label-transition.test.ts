import { describe, expect, it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type { ModelVersionRecord } from '../../model-management/types.js';
import type { CommittedMutationTurnRef } from '../../types/recent-mutation-transition.js';
import { deriveCanonicalNodeLabelTransition } from '../canonical-label-transition.js';
import {
  computeGraphIdentityHash,
  computeVersionAnalysisAffectingHashRecord,
} from '../graph-identity.js';

type Version = ModelVersionRecord & { graph: GraphStateIngress };
interface Fixture { ref: CommittedMutationTurnRef; child: Version; parent: Version }

// Capture-derived source: continuing-1788100250673, CEE a18e1943, authenticated
// owner edit on 2026-08-30. These exact identities and target fields are retained;
// unrelated draft metadata/nodes are omitted from this small unit fixture. The
// original complete 73KB snapshots were separately replayed, not mislabelled as
// this reduced graph. All fixture hashes are computed by production helpers.
function fixture(): Fixture {
  const ref: CommittedMutationTurnRef = {
    conversation_row_id: '2b44d3f6-7357-4bb5-83cf-8d43cf70a8ab',
    source_turn_id: '42641a98-1946-4c27-bd64-d164491c10b6',
    scenario_id: 'bb5a63f3-2bb0-4978-b2a9-32cbf0409035',
    owner_user_id: 'ef651008-7de1-464b-a1a5-4a4a887a2849',
    mutation_id: 'b6d3a389-92b0-5d71-a93c-6ddf136951ba',
  };
  const graph: GraphStateIngress = {
    nodes: [
      {
        id: '20869bc3', kind: 'factor', label: 'Engineer interruption rate',
        prior: { range_max: 1, range_min: 0, distribution: 'uniform', prior_is_unquantified: true },
        category: 'controllable', provenance: 'ai_inferred', display_value: 'Moderate (0.5)',
        observed_state: {
          value: 0.5, source: 'cee_inference', factor_type: 'other',
          extractionType: 'inferred', uncertainty_drivers: ['Not provided'],
        },
      },
      { id: '04871d79', kind: 'factor', label: 'Interrupting work' },
      { id: 'goal', kind: 'goal', label: 'Delivery reliability' },
    ],
    edges: [{
      to: '20869bc3', from: '04871d79', origin: 'ai',
      strength: { std: 0.01, mean: 1 },
      provenance: { source: 'cee_hypothesis', reasoning: 'Model-inferred causal link (records projector)' },
      effect_direction: 'positive', exists_probability: 1, provenance_display: 'ai_inferred',
    }],
    goal_node_id: 'goal',
    meta: { captured: true },
  };
  const parent: Version = {
    id: '91dffb27-33b1-4635-83cd-8251ad1706cb',
    scenario_id: ref.scenario_id, owner_user_id: ref.owner_user_id,
    version_number: 1, graph, graph_identity_hash: '', analysis_affecting_hash: '',
    hash_algorithm: '', identity_projection_version: '', identity_normaliser_version: '', graph_schema_version: '',
    mutation_id: '32a55fe3-de63-574b-a20c-2f7afed32eca', parent_version_id: null,
    root_version_id: '91dffb27-33b1-4635-83cd-8251ad1706cb',
    actor_kind: 'unknown', authored_by: null, creation_kind: 'initial', source_version_id: null,
    source_turn_id: 'b0977301-672e-4753-9871-39484e992f3d',
    label: null, provenance: null, restored_from_version_id: null,
    created_at: '2026-08-30T14:32:11.645105+00:00',
  };
  const child: Version = {
    ...structuredClone(parent), id: '5397e9b5-7016-4d16-974c-7da54df3b89d',
    version_number: 2, mutation_id: ref.mutation_id, source_turn_id: ref.source_turn_id,
    parent_version_id: parent.id, creation_kind: 'committed_mutation',
    created_at: '2026-08-30T14:32:50.019677+00:00',
  };
  child.graph.nodes[0]!.label = 'Unplanned engineer interruptions';
  return { ref, parent: seal(parent), child: seal(child) };
}

function seal(version: Version): Version {
  const full = computeGraphIdentityHash(version.graph);
  const analysis = computeVersionAnalysisAffectingHashRecord(version.graph);
  if (!full || !analysis) throw new Error('fixture must have computable identities');
  return Object.assign(version, {
    graph_identity_hash: full.value, analysis_affecting_hash: analysis.value,
    hash_algorithm: full.algorithm, identity_projection_version: full.projection_version,
    identity_normaliser_version: full.normaliser_version, graph_schema_version: full.graph_schema_version,
  });
}

function derive(f: Fixture) {
  return deriveCanonicalNodeLabelTransition(f.ref, f.child, f.parent);
}

describe('deriveCanonicalNodeLabelTransition', () => {
  it('licenses only the exact qualitative transition, without mutation or numeric/provenance claims', () => {
    const f = fixture();
    const before = structuredClone(f);
    const result = derive(f);
    expect(result).toEqual({
      kind: 'node_label_changed',
      before_label: 'Engineer interruption rate',
      after_label: 'Unplanned engineer interruptions',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(f).toEqual(before);
    expect(Object.keys(result!).sort()).toEqual(['after_label', 'before_label', 'kind']);
  });

  it('ignores unrelated version display annotations, not graph content', () => {
    const f = fixture();
    f.child = { ...f.child, label: 'Unrelated saved-version annotation', provenance: 'No authorship licence' };
    expect(derive(f)).toEqual(derive(fixture()));
  });

  const wrongLinks: Array<[string, (f: Fixture) => void]> = [
    ['wrong child scenario', f => { f.child = { ...f.child, scenario_id: 'foreign' }; }],
    ['wrong parent scenario', f => { f.parent = { ...f.parent, scenario_id: 'foreign' }; }],
    ['wrong child owner', f => { f.child = { ...f.child, owner_user_id: 'foreign' }; }],
    ['wrong parent owner', f => { f.parent = { ...f.parent, owner_user_id: 'foreign' }; }],
    ['persistence UUID substituted for source turn', f => { f.child = { ...f.child, source_turn_id: f.ref.conversation_row_id }; }],
    ['wrong mutation', f => { f.child = { ...f.child, mutation_id: 'other-mutation' }; }],
    ['wrong parent', f => { f.child = { ...f.child, parent_version_id: 'other-version' }; }],
    ['missing parent', f => { f.child = { ...f.child, parent_version_id: null }; }],
    ['self-parent', f => { f.child = { ...f.child, parent_version_id: f.child.id }; }],
    ['same version', f => { f.child = { ...f.child, id: f.parent.id }; }],
    ['wrong root', f => { f.child = { ...f.child, root_version_id: 'other-root' }; }],
    ['missing root', f => { f.child = { ...f.child, root_version_id: null }; }],
    ['matching forged initial root', f => {
      f.child = { ...f.child, root_version_id: 'foreign-root' };
      f.parent = { ...f.parent, root_version_id: 'foreign-root' };
    }],
    ['child claims to be its own root', f => {
      f.child = { ...f.child, root_version_id: f.child.id };
      f.parent = { ...f.parent, root_version_id: f.child.id };
    }],
    ['parent-child lineage cycle', f => { f.parent = { ...f.parent, parent_version_id: f.child.id }; }],
    ['restore instead of ordinary mutation', f => { f.child = { ...f.child, creation_kind: 'restore' }; }],
    ['initial instead of ordinary mutation', f => { f.child = { ...f.child, creation_kind: 'initial' }; }],
    ['unknown creation kind', f => { f.child = { ...f.child, creation_kind: 'unknown' }; }],
    ['non-forward version sequence', f => { f.child = { ...f.child, version_number: f.parent.version_number }; }],
    ['fractional version sequence', f => { f.child = { ...f.child, version_number: 1.5 }; }],
    ['empty reference source', f => { f.ref = { ...f.ref, source_turn_id: '' }; }],
    ['empty parent row ID', f => { f.ref = { ...f.ref, conversation_row_id: '' }; }],
    ['empty stored owner and ref', f => {
      f.ref = { ...f.ref, owner_user_id: '' };
      f.child = { ...f.child, owner_user_id: '' }; f.parent = { ...f.parent, owner_user_id: '' };
    }],
  ];
  it.each(wrongLinks)('withholds %s; the valid pair still passes', (_name, mutate) => {
    const f = fixture(); const before = structuredClone(f);
    mutate(f); expect(f).not.toEqual(before);
    expect(derive(f)).toBeNull(); expect(derive(fixture())).not.toBeNull();
  });

  const envelopeFields = [
    'graph_identity_hash', 'analysis_affecting_hash', 'hash_algorithm',
    'identity_projection_version', 'identity_normaliser_version', 'graph_schema_version',
  ] as const;
  it.each(envelopeFields)('rejects tampered/unsupported %s even when both rows agree', field => {
    const f = fixture();
    f.child = { ...f.child, [field]: 'unsupported-or-tampered' };
    f.parent = { ...f.parent, [field]: 'unsupported-or-tampered' };
    expect(derive(f)).toBeNull(); expect(derive(fixture())).not.toBeNull();
  });

  const graphChanges: Array<[string, (f: Fixture) => void]> = [
    ['extra observed value', f => { f.child.graph.nodes[0]!.observed_state = { value: 0.7 }; }],
    ['extra unit', f => { f.child.graph.nodes[0]!.unit = 'GBP'; }],
    ['extra top-level value', f => { f.child.graph.extra_value = 20; }],
    ['extra nested metadata', f => { f.child.graph.meta = { captured: true, changed: true }; }],
    ['transient presentation field excluded by identity hash', f => { f.child.graph.nodes[0]!.selected = true; }],
    ['extra edge strength', f => { f.child.graph.edges[0]!.strength = { mean: 0.8, std: 0.01 }; }],
    ['second rename', f => { f.child.graph.nodes[1]!.label = 'Another rename'; }],
    ['changed kind', f => { f.child.graph.nodes[0]!.kind = 'risk'; }],
    ['node removed', f => { f.child.graph.nodes.pop(); }],
    ['node added', f => { f.child.graph.nodes.push({ id: 'new', kind: 'risk', label: 'New risk' }); }],
    ['node reorder', f => { f.child.graph.nodes.reverse(); }],
    ['label change erased', f => { f.child.graph.nodes[0]!.label = f.parent.graph.nodes[0]!.label; }],
  ];
  it.each(graphChanges)('does not promote %s into label-only truth even with valid hashes', (_name, mutate) => {
    const f = fixture(); const before = structuredClone(f);
    mutate(f); seal(f.child); expect(f).not.toEqual(before);
    expect(derive(f)).toBeNull(); expect(derive(fixture())).not.toBeNull();
  });

  const malformedBoth: Array<[string, (graph: GraphStateIngress) => void]> = [
    ['duplicate unrelated node ID', g => { g.nodes.push(structuredClone(g.nodes[2]!)); }],
    ['duplicate id-less edge', g => { g.edges.push(structuredClone(g.edges[0]!)); }],
    ['duplicate explicit edge ID', g => {
      g.edges[0]!.id = 'edge'; g.edges.push({ ...structuredClone(g.edges[0]!), from: 'goal', id: 'edge' });
    }],
    ['dangling reference', g => { g.edges[0]!.from = 'absent'; }],
    ['blank node ID', g => { g.nodes[2]!.id = ''; }],
    ['unknown node kind', g => { g.nodes[2]!.kind = 'unlicensed_kind'; }],
    ['blank label', g => { g.nodes[2]!.label = ''; }],
    ['non-finite graph content', g => { g.nodes[2]!.observed_state = { value: Number.NaN }; }],
    ['out-of-bounds probability', g => { g.edges[0]!.exists_probability = 2; }],
  ];
  it.each(malformedBoth)('rejects shared %s instead of trusting equal unchanged corruption', (_name, mutate) => {
    const f = fixture(); const before = structuredClone(f);
    mutate(f.parent.graph); mutate(f.child.graph); seal(f.parent); seal(f.child);
    expect(f).not.toEqual(before); expect(derive(f)).toBeNull();
    expect(derive(fixture())).not.toBeNull();
  });

  it('keeps the sanctioned non-positive sigma raw bytes unchanged', () => {
    const f = fixture();
    for (const version of [f.parent, f.child]) {
      version.graph.edges[0]!.strength = { mean: 1, std: 0 };
      version.graph.nodes[0]!.observed_state = { value: 0.5, std: 0 };
      seal(version);
    }
    const before = structuredClone(f);
    expect(derive(f)).not.toBeNull(); expect(f).toEqual(before);
  });

  it('returns exact Unicode/value-looking labels, without inventing a numeric transition', () => {
    const f = fixture();
    f.parent.graph.nodes[0]!.label = '£20k — 👩🏽‍💻 budget';
    f.child.graph.nodes[0]!.label = '£50k — 👩🏽‍💻 budget';
    seal(f.parent); seal(f.child);
    expect(derive(f)).toEqual({ kind: 'node_label_changed', before_label: '£20k — 👩🏽‍💻 budget', after_label: '£50k — 👩🏽‍💻 budget' });
  });

  it('does not trim/normalise long canonical labels in the pure proof', () => {
    const f = fixture();
    f.parent.graph.nodes[0]!.label = `  ${'before'.repeat(80)}  `;
    f.child.graph.nodes[0]!.label = `  ${'after'.repeat(80)}  `;
    seal(f.parent); seal(f.child);
    expect(derive(f)?.before_label).toBe(f.parent.graph.nodes[0]!.label);
    expect(derive(f)?.after_label).toBe(f.child.graph.nodes[0]!.label);
  });

  it('uses ID rather than duplicate labels for the unique changed node', () => {
    const f = fixture();
    f.parent.graph.nodes[1]!.label = f.parent.graph.nodes[0]!.label;
    f.child.graph.nodes[1]!.label = f.parent.graph.nodes[0]!.label;
    seal(f.parent); seal(f.child);
    expect(derive(f)).toEqual(derive(fixture()));
  });

  it('does not collapse legitimate parallel edges with distinct identities', () => {
    const f = fixture();
    for (const version of [f.parent, f.child]) {
      version.graph.edges[0]!.id = 'first';
      version.graph.edges.push({ ...structuredClone(version.graph.edges[0]!), id: 'second' });
      seal(version);
    }
    expect(derive(f)).toEqual(derive(fixture()));
  });

  it.each([null, {}, { nodes: [], edges: [] }, { nodes: 'not-an-array', edges: [] }])(
    'withholds malformed raw graph %j', graph => {
      const f = fixture();
      expect(deriveCanonicalNodeLabelTransition(f.ref, { ...f.child, graph }, f.parent)).toBeNull();
      expect(derive(f)).not.toBeNull();
    },
  );
});
