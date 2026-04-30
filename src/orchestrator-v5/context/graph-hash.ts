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

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

/** Length of the returned hex prefix. 16 gives collision odds ~1 in 2^64. */
const HASH_HEX_LENGTH = 16;

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
  return pickDefined(raw as Record<string, unknown>, ['value', 'baseline', 'cap']);
}

function projectPrior(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return pickDefined(raw as Record<string, unknown>, [
    'distribution',
    'range_min',
    'range_max',
  ]);
}

function projectIntervention(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (r.value !== undefined) out.value = r.value;
  if (r.value_type !== undefined) out.value_type = r.value_type;
  if (r.encoding_map !== undefined) out.encoding_map = r.encoding_map;
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

  for (const key of [
    'kind',
    'category',
    'factor_type',
    'is_baseline',
    'goal_threshold',
    'goal_threshold_raw',
    'goal_threshold_cap',
    'intercept',
    'encoding_map',
  ] as const) {
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

  // Only include raw_interventions when option is not yet ready — that signals
  // the encoding state still affects analysis preconditions.
  if (r.status !== 'ready' && r.raw_interventions && typeof r.raw_interventions === 'object') {
    out.raw_interventions = r.raw_interventions;
  }

  return out;
}
