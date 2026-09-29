/**
 * Test fixtures for the Track 3 Graph Management Core. Pure GraphV3 builders +
 * envelope/frame builders. TEST-ONLY — free to import the real hash and schema
 * helpers the production referee is forbidden to import (frame-provided hash).
 */
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { GraphV3T, EdgeV3T, OptionV3T } from '../../../schemas/cee-v3.js';
import type { CandidateKind, FrameFreshness, MutationFrame } from '../types.js';

function edge(from: string, to: string): EdgeV3T {
  return { from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' };
}

const BASE_EDGES: EdgeV3T[] = [
  edge('d-choice', 'o-a'),
  edge('d-choice', 'o-b'),
  edge('o-a', 'f-spend'),
  edge('o-b', 'f-reach'),
  edge('f-spend', 'g-profit'),
  edge('f-reach', 'g-profit'),
];

/** Structurally valid + EP2 analysis-ready. */
export function buildReadyGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-profit', kind: 'goal', label: 'Profit' },
      { id: 'd-choice', kind: 'decision', label: 'Which plan' },
      { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
      { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
      { id: 'o-a', kind: 'option', label: 'Plan A', interventions: { 'f-spend': { value: 0.6 } } },
      { id: 'o-b', kind: 'option', label: 'Plan B', interventions: { 'f-reach': { value: 0.3 } } },
    ],
    edges: [...BASE_EDGES],
  };
}

/** Same structure, options carry NO interventions → EP2 OPTIONS_NOT_CONFIGURED. */
export function buildUnconfiguredGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-profit', kind: 'goal', label: 'Profit' },
      { id: 'd-choice', kind: 'decision', label: 'Which plan' },
      { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
      { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
      { id: 'o-a', kind: 'option', label: 'Plan A' },
      { id: 'o-b', kind: 'option', label: 'Plan B' },
    ],
    edges: [...BASE_EDGES],
  };
}

/** Ready graph PLUS a canonical top-level options[] (OptionV3) — the divergence surface. */
export function buildReadyGraphWithTopLevelOptions(): GraphV3T & { options: OptionV3T[] } {
  const oa: OptionV3T = { id: 'o-a', label: 'Plan A', status: 'ready', interventions: {} };
  const ob: OptionV3T = { id: 'o-b', label: 'Plan B', status: 'ready', interventions: {} };
  return { ...buildReadyGraph(), options: [oa, ob] };
}

/** Analysis-affecting hash of a graph the test TRUSTS (frame stamp). */
export function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0]);
  if (h === null) throw new Error('fixture graph is not hashable');
  return h;
}

/** A frame whose currentGraphHash matches `graph` (readable, fresh by default). */
export function frameFor(graph: unknown, freshness: FrameFreshness = 'fresh'): MutationFrame {
  return { currentGraphHash: hashOf(graph), graphReadable: true, freshness, canonicalReady: true };
}

// A pool of distinct valid v4 UUIDs for candidate_id.
const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];
let uuidCursor = 0;
function nextUuid(): string {
  const u = UUIDS[uuidCursor % UUIDS.length];
  uuidCursor += 1;
  return u;
}

export interface EnvelopeOverrides {
  readonly base_graph_hash?: string;
  readonly candidate_id?: string;
  readonly envelope_version?: number;
  readonly source?: 'dual_model_m2' | 'edit_graph_llm' | 'flip_proposal' | 'user_direct';
  readonly evidence_pointer?: string;
  readonly rationale?: string;
  readonly scenario_id?: string;
  readonly turn_id?: string;
}

/** Build a raw envelope object (NOT pre-validated) for a kind + payload. */
export function makeEnvelope(
  kind: CandidateKind,
  payload: Record<string, unknown>,
  o: EnvelopeOverrides = {},
): Record<string, unknown> {
  return {
    envelope_version: o.envelope_version ?? 1,
    candidate_id: o.candidate_id ?? nextUuid(),
    kind,
    base_graph_hash: o.base_graph_hash ?? 'base-hash-placeholder',
    payload,
    provenance: {
      source: o.source ?? 'dual_model_m2',
      evidence_pointer: o.evidence_pointer ?? 'brief:para-2',
      ...(o.rationale !== undefined ? { rationale: o.rationale } : {}),
    },
    identity: { scenario_id: o.scenario_id ?? 'scn-1', turn_id: o.turn_id ?? 'turn-1' },
  };
}

/** A valid representative payload per kind. */
export const SAMPLE_PAYLOADS: Record<CandidateKind, Record<string, unknown>> = {
  add_node: { node: { id: 'n-new', kind: 'factor', label: 'New factor' } },
  add_edge: { edge: { from: 'f-spend', to: 'g-profit' } },
  update_node_field: { node_id: 'f-spend', field: 'label', from: 'Marketing spend', to: 'Ad spend' },
  update_edge_field: { from_node: 'f-spend', to_node: 'g-profit', field: 'exists_probability', from: 0.9, to: 0.8 },
  rename_node: { node_id: 'g-profit', to_label: 'Net Profit' },
  add_option: {
    option: {
      id: 'o-c',
      label: 'Plan C',
      parent_decision_id: 'd-choice',
      edges: [{ to_factor_id: 'f-spend' }],
      interventions: { 'f-spend': { value: 0.5 } },
    },
  },
  remove_node: { node_id: 'f-reach', reason: 'redundant' },
  remove_edge: { from_node: 'f-reach', to_node: 'g-profit', reason: 'spurious' },
  flag_uncertainty: { target_ref: 'f-spend', question: 'Is this value current?' },
  clarification: { target_ref: 'o-a', question: 'Which market does Plan A target?' },
};
