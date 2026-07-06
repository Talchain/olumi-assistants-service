/**
 * Model Management v1 — proposed shared fixtures (aligned with #345 conventions).
 *
 * PROPOSAL, not a fork: #345 (layer-1 cross-track acceptance) is the sole
 * fixture/harness owner. These fixtures are shaped so #345 can lift them into
 * that harness — same convention (real Group A `computeGraphIdentityHash`
 * envelope, no hand-forged hashes; graphs built from the sanctioned ingress
 * shape). They are exercised by fixtures.test.ts here so they cannot rot, and
 * are used by the model-management unit tests as a single source of graph +
 * version shapes rather than re-declaring them inline per file.
 *
 * Nothing here is production code (it lives under __tests__, so the isolation
 * guard does not scan it as a module file).
 */
import {
  computeGraphIdentityHash,
  type GraphIdentityHash,
} from '../../context/graph-identity.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import type {
  ModelVersionRecord,
  ModelVersionSummary,
  VersionWriteOutcome,
} from '../types.js';

// Deterministic ids so golden comparisons are stable across runs.
export const FIX_SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const FIX_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const FIX_VERSION_ID = '11111111-1111-4111-8111-111111111111';

/** Canonical base graph — a small price/demand → revenue model. */
export const BASE_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'n_price', kind: 'factor', label: 'Price' },
    { id: 'n_demand', kind: 'factor', label: 'Demand' },
    { id: 'n_revenue', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [
    { id: 'e_price_rev', from: 'n_price', to: 'n_revenue' },
    { id: 'e_demand_rev', from: 'n_demand', to: 'n_revenue' },
  ],
};

/** Label-only edit — analysis-EQUIVALENT to BASE_GRAPH (labels are excluded
 *  from the analysis-affecting hash) but a DIFFERENT identity (labels are in
 *  the identity projection). */
export const LABEL_ONLY_EDIT: GraphStateIngress = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'n_price', kind: 'factor', label: 'Unit Price' },
    { id: 'n_demand', kind: 'factor', label: 'Demand' },
    { id: 'n_revenue', kind: 'outcome', label: 'Revenue' },
  ],
};

/** Structural edit — a new factor + edge; BOTH identity and analysis hashes
 *  differ from BASE_GRAPH. */
export const STRUCTURAL_EDIT: GraphStateIngress = {
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'n_cost', kind: 'factor', label: 'Cost' },
  ],
  edges: [
    ...BASE_GRAPH.edges,
    { id: 'e_cost_rev', from: 'n_cost', to: 'n_revenue' },
  ],
};

/** The real Group A identity envelope for a fixture graph — never hand-forged
 *  (the #345 convention: hashes come from the sanctioned module). */
export function identityOf(graph: GraphStateIngress): GraphIdentityHash {
  const id = computeGraphIdentityHash(graph);
  if (id === null) throw new Error('fixture graph produced a null identity — not a valid versionable graph');
  return id;
}

/** Build a ModelVersionSummary whose identity envelope is CONSISTENT with the
 *  given graph (matching how the RPC would persist it). */
export function versionSummary(
  graph: GraphStateIngress = BASE_GRAPH,
  overrides: Partial<ModelVersionSummary> = {},
): ModelVersionSummary {
  const id = identityOf(graph);
  return {
    id: FIX_VERSION_ID,
    scenario_id: FIX_SCENARIO,
    owner_user_id: FIX_OWNER,
    version_number: 1,
    graph_identity_hash: id.value,
    hash_algorithm: id.algorithm,
    identity_projection_version: id.projection_version,
    identity_normaliser_version: id.normaliser_version,
    graph_schema_version: id.graph_schema_version,
    label: null,
    provenance: null,
    restored_from_version_id: null,
    created_at: '2026-07-06T10:00:00.000+00:00',
    ...overrides,
  };
}

/** Full record = summary + the graph snapshot it hashes to. */
export function versionRecord(
  graph: GraphStateIngress = BASE_GRAPH,
  overrides: Partial<ModelVersionRecord> = {},
): ModelVersionRecord {
  return { ...versionSummary(graph), graph, ...overrides };
}

/** A create/restore write outcome consistent with a fixture graph. */
export function writeOutcome(
  graph: GraphStateIngress = BASE_GRAPH,
  overrides: Partial<VersionWriteOutcome> = {},
): VersionWriteOutcome {
  const id = identityOf(graph);
  return {
    version_id: FIX_VERSION_ID,
    version_number: 1,
    graph_identity_hash: id.value,
    deduped: false,
    event_id: `model_version_created_${FIX_VERSION_ID}`,
    ...overrides,
  };
}
