/**
 * Model Management v1 — CEE-side version comparison (pure; no I/O).
 *
 * Doctrine (substrate brief §3): compare is computed CEE-SIDE, never
 * UI-side (schema-version-skew hazard — the identity hash is opaque on the
 * wire). Two stages:
 *
 *   1. Identity short-circuit: equal `graph_identity_hash` under EQUAL
 *      projection/normaliser/schema versions ⇒ identical graphs; stop.
 *      Hashes from different projection/normaliser versions are never
 *      compared (envelope columns are stored per row precisely for this).
 *
 *   2. Otherwise: analysis-affecting equivalence (does the difference
 *      matter to analysis freshness?) via the SANCTIONED
 *      `computeAnalysisAffectingHashRecord` — reused from Group A
 *      graph-identity.ts, never re-implemented — plus a compact structural
 *      diff summary (counts only, no prose).
 *
 * Diff granularity is deliberately simple (task-scoped): nodes keyed by
 * `id`, edges keyed by `id` (fallback `from -> to`); an entry counts as
 * "changed" when its key exists in both graphs but its stable
 * serialisation differs. Duplicate keys collapse (last wins) — acceptable
 * for a counts-only summary; the identity hash, not this diff, is the
 * authority on equality.
 */

import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { computeAnalysisAffectingHashRecord } from '../context/graph-identity.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type {
  ModelVersionRecord,
  VersionComparison,
  VersionDiffSummary,
} from './types.js';

function identityEnvelopesMatch(a: ModelVersionRecord, b: ModelVersionRecord): boolean {
  return (
    a.identity_projection_version === b.identity_projection_version &&
    a.identity_normaliser_version === b.identity_normaliser_version &&
    a.graph_schema_version === b.graph_schema_version &&
    a.hash_algorithm === b.hash_algorithm
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Narrow a persisted jsonb graph payload to the ingress shape the sanctioned
 * analysis hash expects (`nodes`/`edges` MUST be arrays — the hash walks
 * `graph.nodes.length` unguarded). Anything else degrades to null, which
 * surfaces as `analysis_equivalent: null` rather than a throw.
 */
function toIngressOrNull(graph: unknown): GraphStateIngress | null {
  const g = asRecord(graph);
  if (g === null || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return null;
  return graph as GraphStateIngress;
}

function arrayField(graph: unknown, key: 'nodes' | 'edges'): readonly unknown[] {
  const g = asRecord(graph);
  const raw = g?.[key];
  return Array.isArray(raw) ? raw : [];
}

/** Stable string key for a serialised-entry map. */
function serialise(value: unknown): string {
  const s = stableStringify(value);
  return typeof s === 'string' ? s : 'undefined';
}

function nodeKey(node: unknown): string {
  const r = asRecord(node);
  const id = r?.id;
  return typeof id === 'string' && id.length > 0 ? `id:${id}` : `raw:${serialise(node)}`;
}

function edgeKey(edge: unknown): string {
  const r = asRecord(edge);
  const id = r?.id;
  if (typeof id === 'string' && id.length > 0) return `id:${id}`;
  const from = r?.from;
  const to = r?.to;
  if (typeof from === 'string' && typeof to === 'string') return `ft:${from} -> ${to}`;
  return `raw:${serialise(edge)}`;
}

interface EntryCounts {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
}

function diffEntries(
  before: readonly unknown[],
  after: readonly unknown[],
  keyOf: (entry: unknown) => string,
): EntryCounts {
  // Null-prototype maps: parsed JSON can carry an own `__proto__` key, which
  // would vanish through a `{}` accumulator (see the Group A hardening).
  const beforeByKey = new Map<string, string>();
  for (const entry of before) beforeByKey.set(keyOf(entry), serialise(entry));
  const afterByKey = new Map<string, string>();
  for (const entry of after) afterByKey.set(keyOf(entry), serialise(entry));

  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [key, serialised] of afterByKey) {
    const prior = beforeByKey.get(key);
    if (prior === undefined) added += 1;
    else if (prior !== serialised) changed += 1;
  }
  for (const key of beforeByKey.keys()) {
    if (!afterByKey.has(key)) removed += 1;
  }
  return { added, removed, changed };
}

/** Compact structural diff summary from `before` to `after`. */
export function summariseGraphDiff(before: unknown, after: unknown): VersionDiffSummary {
  const nodes = diffEntries(arrayField(before, 'nodes'), arrayField(after, 'nodes'), nodeKey);
  const edges = diffEntries(arrayField(before, 'edges'), arrayField(after, 'edges'), edgeKey);
  return {
    nodes_added: nodes.added,
    nodes_removed: nodes.removed,
    nodes_changed: nodes.changed,
    edges_added: edges.added,
    edges_removed: edges.removed,
    edges_changed: edges.changed,
  };
}

/**
 * Compare two persisted versions (direction: `from` → `to`).
 * Pure and total: never throws on malformed graph payloads (degenerate
 * shapes diff as empty node/edge sets and analysis_equivalent: null).
 */
export function compareVersionRecords(
  from: ModelVersionRecord,
  to: ModelVersionRecord,
): VersionComparison {
  if (
    from.graph_identity_hash === to.graph_identity_hash &&
    identityEnvelopesMatch(from, to)
  ) {
    return { relation: 'identical', short_circuit: true };
  }

  const fromAnalysis = computeAnalysisAffectingHashRecord(toIngressOrNull(from.graph));
  const toAnalysis = computeAnalysisAffectingHashRecord(toIngressOrNull(to.graph));
  const analysisEquivalent =
    fromAnalysis === null || toAnalysis === null
      ? null
      : fromAnalysis.value === toAnalysis.value;

  return {
    relation: 'different',
    short_circuit: false,
    analysis_equivalent: analysisEquivalent,
    diff: summariseGraphDiff(from.graph, to.graph),
  };
}
