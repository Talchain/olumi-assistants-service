/** Frozen pre-admission-gap projection (before 31fae7861).
 * Historical identity validation and legacy currency rejection only;
 * NEVER accept current freshness from this projection alone.
 * Keep the algorithm and vocabulary unchanged. Literal digest fixtures pin it.
 */
import { createHash } from 'node:crypto';
import { goalScopeAnalysisMeaning } from '../../schemas/goal-scope.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { resolveGoalDirection, resolveGoalThresholdStrict } from '../goal-target/goal-direction.js';
const HASH_HEX_LENGTH = 16;
const VOCABULARY = {
  "node": {
    "fields": [
      "id",
      "kind",
      "category",
      "factor_type",
      "is_baseline",
      "goal_threshold",
      "goal_threshold_raw",
      "goal_threshold_cap",
      "intercept",
      "encoding_map",
      "goal_threshold_frame",
      "goal_direction",
      "quantity_frame",
      "scale_frame",
      "nonlinear_identity",
      "analysis_participation",
      "proposed_by"
    ],
    "observed_state_fields": [
      "value",
      "baseline",
      "cap",
      "source",
      "unit",
      "raw_value",
      "std"
    ],
    "prior_fields": [
      "distribution",
      "range_min",
      "range_max"
    ],
    "interventions_field": "interventions"
  },
  "edge": {
    "fields": [
      "from",
      "to",
      "edge_type",
      "exists_probability",
      "effect_direction"
    ],
    "strength_fields": [
      "mean",
      "std"
    ],
    "provenance_fields": [
      "source",
      "magnitude"
    ],
    "provenance_natural_effect_fields": [
      "amount_unit"
    ]
  },
  "option": {
    "fields": [
      "id",
      "status",
      "is_baseline"
    ],
    "interventions_field": "interventions",
    "conditional_field": {
      "field": "raw_interventions",
      "include_when": {
        "field": "status",
        "not_equals": "ready"
      }
    }
  },
  "intervention": {
    "fields": [
      "value",
      "value_type",
      "encoding_map",
      "range"
    ],
    "target_match_field": "target_match",
    "target_match_fields": [
      "node_id"
    ]
  }
} as const;

export function computeLegacyAnalysisAffectingGraphHash(
  graph: GraphStateIngress | null | undefined,
): string | null {
  const full = computeLegacyAnalysisAffectingGraphHashSha256(graph);
  return full === null ? null : full.slice(0, HASH_HEX_LENGTH);
}

export function computeLegacyAnalysisAffectingGraphHashSha256(
  graph: GraphStateIngress | null | undefined,
): string | null {
  if (!graph) return null;

  const nodes = graph.nodes;
  const edges = graph.edges;
  const options = (graph as { options?: unknown }).options;
  const goalNodeId = (graph as { goal_node_id?: unknown }).goal_node_id;
  const goalConstraints = (graph as { goal_constraints?: unknown }).goal_constraints;

  if (
    nodes.length === 0 &&
    edges.length === 0 &&
    !Array.isArray(options) &&
    goalNodeId === undefined
  ) {
    return null;
  }

  const canonical = stableStringify({
    nodes: nodes.map(projectNode).sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges
      .map(projectEdge)
      .sort((a, b) => {
        const fromCmp = a.from.localeCompare(b.from);
        return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
      }),
    options: Array.isArray(options)
      ? options.map(projectOption).sort((a, b) => a.id.localeCompare(b.id))
      : [],
    goal_node_id: typeof goalNodeId === 'string' ? goalNodeId : null,
    goal_constraints: Array.isArray(goalConstraints) ? goalConstraints : [],
    run_semantics: runSemantics(graph, goalNodeId),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function runSemantics(graph: unknown, goalNodeId: unknown): Record<string, unknown> {
  const direction = typeof goalNodeId === 'string' ? resolveGoalDirection(graph, goalNodeId) : undefined;
  return {
    goal_direction: direction?.direction ?? null,
    goal_direction_provenance: direction?.provenance ?? null,
    goal_threshold_strict: typeof goalNodeId === 'string' ? resolveGoalThresholdStrict(graph, goalNodeId) : false,
  };
}

function pickDefined<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  keys: readonly string[],
): T {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function projectObservedState(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return pickDefined(raw as Record<string, unknown>, VOCABULARY.node.observed_state_fields);
}

function projectPrior(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return pickDefined(raw as Record<string, unknown>, [
    'distribution',
    'range_min',
    'range_max',
  ]);
}

function normaliseRawValueForIdentity(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed === '') return raw;
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) && String(asNumber) === trimmed ? asNumber : raw;
}

function projectIntervention(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (r.value !== undefined) out.value = r.value;
  if (r.value_type !== undefined) out.value_type = r.value_type;
  if (r.encoding_map !== undefined) out.encoding_map = r.encoding_map;
  if (r.raw_value !== undefined) {
    out.raw_value = normaliseRawValueForIdentity(r.raw_value);
    if (r.unit !== undefined) out.unit = r.unit;
  }
  if (r.target_match && typeof r.target_match === 'object') {
    const tm = r.target_match as Record<string, unknown>;
    if (tm.node_id !== undefined) out.target_match = { node_id: tm.node_id };
  }
  return out;
}

function projectInterventionRecord(
  raw: unknown,
): Record<string, Record<string, unknown> | undefined> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, Record<string, unknown> | undefined> = {};
  for (const factorId of Object.keys(r)) {
    const projected = projectIntervention(r[factorId]);
    if (projected !== undefined) out[factorId] = projected;
  }
  return out;
}

interface NodeProjection {
  id: string;
  [key: string]: unknown;
}

function projectNode(raw: unknown): NodeProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: NodeProjection = { id: typeof r.id === 'string' ? r.id : '' };
  const scope = goalScopeAnalysisMeaning(r.goal_scope);
  if (scope !== undefined) out.goal_scope = scope;

  for (const key of VOCABULARY.node.fields) {
    if (key !== 'id' && r[key] !== undefined) out[key] = r[key];
  }

  const observed = projectObservedState(r.observed_state);
  if (observed !== undefined && Object.keys(observed).length > 0) {
    out.observed_state = observed;
  }

  const prior = projectPrior(r.prior);
  if (prior !== undefined && Object.keys(prior).length > 0) {
    out.prior = prior;
  }

  const interventions = projectInterventionRecord(r.interventions);
  if (interventions !== undefined && Object.keys(interventions).length > 0) {
    out.interventions = interventions;
  }

  return out;
}

interface EdgeProjection {
  from: string;
  to: string;
  [key: string]: unknown;
}

function projectEdge(raw: unknown): EdgeProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: EdgeProjection = {
    from: typeof r.from === 'string' ? r.from : '',
    to: typeof r.to === 'string' ? r.to : '',
  };

  if (r.edge_type !== undefined) out.edge_type = r.edge_type;
  if (r.exists_probability !== undefined) out.exists_probability = r.exists_probability;
  if (r.effect_direction !== undefined) out.effect_direction = r.effect_direction;

  if (r.strength && typeof r.strength === 'object') {
    const s = r.strength as Record<string, unknown>;
    const strength: Record<string, unknown> = {};
    if (s.mean !== undefined) strength.mean = s.mean;
    if (s.std !== undefined) strength.std = s.std;
    if (Object.keys(strength).length > 0) out.strength = strength;
  }

  if (r.provenance && typeof r.provenance === 'object') {
    const p = r.provenance as Record<string, unknown>;
    const provenance: Record<string, unknown> = pickDefined(p, VOCABULARY.edge.provenance_fields);
    if (p.natural_effect && typeof p.natural_effect === 'object') {
      const ne = pickDefined((p.natural_effect as Record<string, unknown>), VOCABULARY.edge.provenance_natural_effect_fields);
      if (Object.keys(ne).length > 0) provenance.natural_effect = ne;
    }
    if (Object.keys(provenance).length > 0) out.provenance = provenance;
  }

  return out;
}

interface OptionProjection {
  id: string;
  [key: string]: unknown;
}

function projectOption(raw: unknown): OptionProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: OptionProjection = { id: typeof r.id === 'string' ? r.id : '' };

  if (r.status !== undefined) out.status = r.status;
  if (r.is_baseline !== undefined) out.is_baseline = r.is_baseline;

  const interventions = projectInterventionRecord(r.interventions);
  if (interventions !== undefined && Object.keys(interventions).length > 0) {
    out.interventions = interventions;
  }

  if (r.status !== 'ready' && r.raw_interventions && typeof r.raw_interventions === 'object') {
    out.raw_interventions = r.raw_interventions;
  }

  return out;
}
