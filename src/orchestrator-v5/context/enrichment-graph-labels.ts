/**
 * Lean, dependency-free helpers for reading a stored PLoT V2 run-analysis
 * enrichment envelope's graph and resolving / sanitising display labels.
 *
 * These were originally private to the coaching modules
 * (`readGraph` + `buildNodeLabelMap` in `decision-review-enricher`, and the
 * two-argument `sanitiseLabel` in `analysis-result-headline`). They are
 * relocated here so the lean context/projection layer (`analysis-fallback`)
 * can reuse the SAME proven readers without importing the heavy enricher
 * module (telemetry / cee-invoke / turn-debug-store) into a pure projection
 * path — which would couple projection to enrichment-handler internals and
 * risk an import cycle. The original modules re-export `readGraph` /
 * `buildNodeLabelMap` and import `sanitiseLabel` from here, so every existing
 * consumer keeps working with no behaviour change.
 *
 * This module has NO runtime dependencies on purpose — keep it that way.
 *
 * Note: this is the two-argument label guard `sanitiseLabel(raw, idGuess)`
 * used inside CEE — it is distinct from the single-argument question-stripping
 * `sanitiseLabel` in `src/utils/label-sanitiser.ts`.
 */

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read `enrichment.graph` defensively; `{}` when absent or malformed.
 * (On staging the run-analysis envelope often has NO top-level `graph` —
 * callers must tolerate an empty result and fall back to inline labels.)
 */
export function readGraph(enrichment: Record<string, unknown>): Record<string, unknown> {
  const raw = enrichment.graph;
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * Build node_id → display label map from `graph.nodes[]`.
 * Defensive: returns an empty Map when the graph shape isn't recognisable.
 */
export function buildNodeLabelMap(graph: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return map;
  for (const raw of nodes) {
    const n = readRecord(raw);
    if (!n) continue;
    const id = typeof n.id === 'string' ? n.id : null;
    const label = typeof n.label === 'string' ? n.label : null;
    if (id && label) map.set(id, label);
  }
  return map;
}

/** Slug-shape internal id prefixes; a label matching these is not user-facing. */
const ID_PREFIX_PATTERN = /^(opt_|goal_|fac_|node_|edge_|n_|e_)/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reject empty, id-equals-guess, slug-prefixed, or UUID-shaped strings;
 * otherwise return the trimmed label. Single source of truth for the
 * "is this a renderable human label, not a raw id" guard.
 */
export function sanitiseLabel(rawLabel: string, idGuess: string): string | null {
  if (typeof rawLabel !== 'string') return null;
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (idGuess.length > 0 && trimmed === idGuess) return null;
  if (ID_PREFIX_PATTERN.test(trimmed)) return null;
  if (UUID_PATTERN.test(trimmed)) return null;
  return trimmed;
}
