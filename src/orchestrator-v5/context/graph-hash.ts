/**
 * V5 Phase 1.5 — deterministic graph hash.
 *
 * Computes a stable 16-char hex hash of a graph's node + edge identity, for
 * routing-log telemetry and future staleness-comparison work. The hash input
 * is the sorted list of node IDs and (from, to) edge pairs — not the full
 * structural data — so additive fields (observed_state drift, strength
 * refinements) do NOT change the hash. That is deliberate: Phase 1.5 uses the
 * hash only as a stable identity marker for a given graph shape; downstream
 * staleness logic compares identity against analysis-time snapshots and
 * should not trip on cosmetic edits.
 *
 * The hash is kept OUT of ContextPack (plan correction #3). Consumers that
 * need it — routing log, future staleness comparator — read it from the
 * TurnExecutor scope where this helper is called.
 */

import { createHash } from 'node:crypto';
import {
  CANONICAL_GRAPH_HASH_NESTED_PROJECTION,
  CANONICAL_GRAPH_HASH_PROJECTION_VERSION,
} from '@talchain/schemas/boundary';

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

/** Length of the returned hex prefix. 16 gives collision odds ~1 in 2^64. */
const HASH_HEX_LENGTH = 16;

/** Exported for health/drift witnesses; the vocabulary itself is schema-owned. */
export const ANALYSIS_GRAPH_HASH_PROJECTION_VERSION =
  CANONICAL_GRAPH_HASH_PROJECTION_VERSION;

/**
 * Compute a deterministic 16-char hex hash of graph identity. Returns null
 * when the graph is null, undefined, or structurally empty (no nodes AND no
 * edges) — a null hash is indistinguishable from "no graph present" for the
 * routing-log consumer.
 *
 * Canonicalisation:
 *   1. Copy nodes + edges into plain identity records (strip passthrough
 *      fields — we hash identity, not structure)
 *   2. Sort nodes by id, edges by (from, to)
 *   3. stableStringify (recursive key sort)
 *   4. SHA-256, take first 16 hex chars
 */
export function computeDeterministicGraphHash(
  graph: GraphStateIngress | null | undefined,
): string | null {
  if (!graph) return null;

  const nodes = graph.nodes;
  const edges = graph.edges;
  if (nodes.length === 0 && edges.length === 0) return null;

  const nodeIdentity = nodes
    .map((n) => ({ id: n.id }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const edgeIdentity = edges
    .map((e) => ({ from: e.from, to: e.to }))
    .sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
    });

  const canonical = stableStringify({ nodes: nodeIdentity, edges: edgeIdentity });
  return createHash('sha256').update(canonical).digest('hex').slice(0, HASH_HEX_LENGTH);
}

/**
 * Compute a deterministic 16-char hex hash of all graph fields that AFFECT
 * analysis output. Used by V5 freshness derivation: comparing the hash at
 * `run_analysis` time against the hash on the current turn determines whether
 * the prior analysis is still valid.
 *
 * Distinct from `computeDeterministicGraphHash` (above), which deliberately
 * hashes only topology for routing-log identity. This function MUST capture
 * any field whose mutation would change analysis results, while excluding
 * cosmetic / provenance / display fields so label-only edits do not trigger
 * false-stale freshness.
 *
 * Canonical input projection (whitelist — anything not listed is excluded):
 *
 *   nodes: sorted by id, each → {
 *     id, kind, category, factor_type, is_baseline,
 *     observed_state: { value, baseline, cap },
 *     goal_threshold, goal_threshold_raw, goal_threshold_cap,
 *     intercept,
 *     prior: { distribution, range_min, range_max },
 *     encoding_map,
 *     interventions: per-factor { value, value_type, encoding_map,
 *                                  target_match: { node_id } }
 *   }
 *   edges: sorted by (from, to), each → {
 *     from, to, edge_type,
 *     strength: { mean, std },
 *     exists_probability, effect_direction
 *   }
 *   options: sorted by id, each → {
 *     id, status, is_baseline,
 *     interventions: per-factor (as above),
 *     raw_interventions: per-factor (only when status !== 'ready')
 *   }
 *   goal_node_id
 *   goal_constraints: passed through stableStringify
 *
 * Excluded (cosmetic / provenance / display):
 *   labels, descriptions, display_value, provenance, provenance_display,
 *   origin, observed_state.{unit, source, raw_value, extractionType},
 *   intervention.{unit, source, reasoning, value_confidence, display_value},
 *   target_match.{match_type, confidence}, edge.validation, edge.defaulted,
 *   option.{description, unresolved_targets, user_questions, brief_quote}.
 *
 * Also intentionally EXCLUDED — Monte Carlo configuration parameters
 * passed to PLoT alongside the graph (`seed`, `n_samples`, request_id):
 * these tune the simulation reproducibility / sample count, not the
 * model itself. Two analyses against the same graph with different
 * seeds should be considered freshness-equivalent. Including them
 * would over-trigger `stale` on every rerun-with-new-seed without
 * any user-visible model change.
 */
export function computeAnalysisAffectingGraphHash(
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
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, HASH_HEX_LENGTH);
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
  return pickDefined(
    raw as Record<string, unknown>,
    CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.observed_state_fields,
  );
}

function projectPrior(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return pickDefined(
    raw as Record<string, unknown>,
    CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.prior_fields,
  );
}

function projectIntervention(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const contract = CANONICAL_GRAPH_HASH_NESTED_PROJECTION.intervention;
  const out = pickDefined<Record<string, unknown>>(r, contract.fields);
  const targetMatch = r[contract.target_match_field];
  if (targetMatch && typeof targetMatch === 'object') {
    const projected = pickDefined<Record<string, unknown>>(
      targetMatch as Record<string, unknown>,
      contract.target_match_fields,
    );
    if (Object.keys(projected).length > 0) {
      out[contract.target_match_field] = projected;
    }
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
  // Keep the accumulator broad: `slice(1)` is a runtime exclusion, while
  // TypeScript conservatively retains `id` in the manifest key union.
  const out: Record<string, unknown> = {
    id: typeof r.id === 'string' ? r.id : '',
  };

  for (const key of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.fields.slice(1)) {
    if (r[key] !== undefined) out[key] = r[key];
  }

  const observed = projectObservedState(r.observed_state);
  if (observed !== undefined && Object.keys(observed).length > 0) {
    out.observed_state = observed;
  }

  const prior = projectPrior(r.prior);
  if (prior !== undefined && Object.keys(prior).length > 0) {
    out.prior = prior;
  }

  const interventionsField =
    CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.interventions_field;
  const interventions = projectInterventionRecord(r[interventionsField]);
  if (interventions !== undefined && Object.keys(interventions).length > 0) {
    out[interventionsField] = interventions;
  }

  return out as NodeProjection;
}

interface EdgeProjection {
  from: string;
  to: string;
  [key: string]: unknown;
}

function projectEdge(raw: unknown): EdgeProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    from: typeof r.from === 'string' ? r.from : '',
    to: typeof r.to === 'string' ? r.to : '',
  };

  for (const key of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge.fields.slice(2)) {
    if (r[key] !== undefined) out[key] = r[key];
  }

  if (r.strength && typeof r.strength === 'object') {
    const s = r.strength as Record<string, unknown>;
    const strength = pickDefined<Record<string, unknown>>(
      s,
      CANONICAL_GRAPH_HASH_NESTED_PROJECTION.edge.strength_fields,
    );
    if (Object.keys(strength).length > 0) out.strength = strength;
  }

  return out as EdgeProjection;
}

interface OptionProjection {
  id: string;
  [key: string]: unknown;
}

function projectOption(raw: unknown): OptionProjection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: typeof r.id === 'string' ? r.id : '',
  };

  for (const key of CANONICAL_GRAPH_HASH_NESTED_PROJECTION.option.fields.slice(1)) {
    if (r[key] !== undefined) out[key] = r[key];
  }

  const interventionsField =
    CANONICAL_GRAPH_HASH_NESTED_PROJECTION.option.interventions_field;
  const interventions = projectInterventionRecord(r[interventionsField]);
  if (interventions !== undefined && Object.keys(interventions).length > 0) {
    out[interventionsField] = interventions;
  }

  // Only include raw_interventions when option is not yet ready — that signals
  // the encoding state still affects analysis preconditions.
  const conditional = CANONICAL_GRAPH_HASH_NESTED_PROJECTION.option.conditional_field;
  if (
    r[conditional.include_when.field] !== conditional.include_when.not_equals &&
    r[conditional.field] &&
    typeof r[conditional.field] === 'object'
  ) {
    out[conditional.field] = r[conditional.field];
  }

  return out as OptionProjection;
}
