/**
 * Display-safe graph projection for the LLM-facing context pack
 * (brief brief-display-safe-graph A2.1).
 *
 * Design principle: raw model values stay in structured state for
 * handlers, telemetry, freshness hashing, and edit_graph dispatch; the
 * LLM-facing context pack uses decision-language projections only.
 * Sonnet never sees raw edge `strength` floats, raw `exists`
 * probabilities, or model-internal node fields. Without raw floats in
 * the prompt, Sonnet stops echoing internal numerics ("strength of
 * 0.55", "direct link of 0.65") in narration.
 *
 * Operates strictly downstream of `compactGraphForContextPack()` and
 * `projectCompactGraph()`. The raw `ContextPack.graph` is preserved for
 * handler-side reads (edit_graph dispatch reads from raw boundary
 * graph state via a wholly separate path; freshness hashing and
 * telemetry continue to read raw `ContextPack.graph`).
 *
 * Pure function. No side effects. Idempotent on its own output (re-running
 * produces an equivalent shape — `relationship` strings carry no decimals
 * to re-classify).
 */

import type { CompactProvenance } from '../../orchestrator/context/graph-compact.js';
import type { ContextPackGraph } from '../context/context-pack-assembler.js';
import { bandFromMagnitude, NEAR_ZERO_INFLUENCE_THRESHOLD } from './influence-bands.js';

export interface DisplaySafeNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly category?: string;
  readonly unit?: string;
  readonly intervention_summary?: string;
}

export interface DisplaySafeEdge {
  readonly from: string;
  readonly to: string;
  readonly from_label: string;
  readonly to_label: string;
  /** Decision-language phrase: "moderate positive link", "strong negative link",
   *  "very strong positive link", or "negligible link" for |strength| < 0.05. */
  readonly relationship: string;
  readonly provenance?: CompactProvenance;
}

export interface DisplaySafeGraph {
  readonly nodes: readonly DisplaySafeNode[];
  readonly edges: readonly DisplaySafeEdge[];
  readonly options: readonly unknown[];
  readonly goals: readonly unknown[];
  readonly constraints: readonly unknown[];
  readonly counts: ContextPackGraph['counts'];
}

interface RawNodeShape {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
  readonly category?: unknown;
  readonly unit?: unknown;
  readonly intervention_summary?: unknown;
}

interface RawEdgeShape {
  readonly from?: unknown;
  readonly to?: unknown;
  readonly strength?: unknown;
  readonly provenance?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asProvenance(value: unknown): CompactProvenance | undefined {
  return value === 'from_brief' || value === 'ai_inferred' || value === 'user_set'
    ? value
    : undefined;
}

/**
 * Convert a signed edge strength into the user-visible relationship phrase.
 *
 *   0.95  → "very strong positive link"
 *   0.70  → "strong positive link"
 *   0.65  → "moderate positive link"
 *  -0.25  → "weak negative link"
 *   0.02  → "negligible link"            (sign suppressed below NEAR_ZERO_INFLUENCE_THRESHOLD)
 */
export function relationshipPhrase(signedStrength: number): string {
  if (!Number.isFinite(signedStrength)) return 'negligible link';
  const abs = Math.abs(signedStrength);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'negligible link';
  const band = bandFromMagnitude(abs);
  const sign = signedStrength < 0 ? 'negative' : 'positive';
  return `${band} ${sign} link`;
}

function projectNode(raw: RawNodeShape): DisplaySafeNode | null {
  const id = asString(raw.id);
  const label = asString(raw.label);
  const kind = asString(raw.kind);
  if (id === undefined || label === undefined || kind === undefined) return null;
  const node: {
    id: string;
    label: string;
    kind: string;
    category?: string;
    unit?: string;
    intervention_summary?: string;
  } = { id, label, kind };
  const category = asString(raw.category);
  if (category !== undefined) node.category = category;
  const unit = asString(raw.unit);
  if (unit !== undefined) node.unit = unit;
  const interventionSummary = asString(raw.intervention_summary);
  if (interventionSummary !== undefined) node.intervention_summary = interventionSummary;
  return node;
}

function projectEdge(raw: RawEdgeShape, labelMap: ReadonlyMap<string, string>): DisplaySafeEdge | null {
  const from = asString(raw.from);
  const to = asString(raw.to);
  if (from === undefined || to === undefined) return null;
  const strength = asNumber(raw.strength) ?? 0;
  const edge: {
    from: string;
    to: string;
    from_label: string;
    to_label: string;
    relationship: string;
    provenance?: CompactProvenance;
  } = {
    from,
    to,
    from_label: labelMap.get(from) ?? from,
    to_label: labelMap.get(to) ?? to,
    relationship: relationshipPhrase(strength),
  };
  const provenance = asProvenance(raw.provenance);
  if (provenance !== undefined) edge.provenance = provenance;
  return edge;
}

/**
 * Project the raw `ContextPackGraph` into the LLM-facing display-safe shape.
 *
 *   - Edges: `strength` and `exists` are stripped; `plain_interpretation` is
 *     stripped (may contain raw edge language like "strength of 0.55"; the
 *     raw graph retains it). A `relationship` phrase replaces them. Bare IDs
 *     are kept on `from`/`to`; human labels are surfaced as `from_label` /
 *     `to_label`. `_raw_provenance` is stripped (diagnostic-only).
 *
 *   - Nodes: only `id`, `label`, `kind`, `category?`, `unit?`,
 *     `intervention_summary?` survive. Numeric `value`/`raw_value`/`cap` and
 *     internal `source` / `_raw_provenance` are dropped — they leak raw
 *     model state into prose.
 *
 *   - `options`, `goals`, `constraints`, `counts`: pass through unchanged.
 */
export function formatGraphForContext(raw: ContextPackGraph): DisplaySafeGraph {
  const labelMap = new Map<string, string>();
  for (const node of raw.nodes as readonly RawNodeShape[]) {
    const id = asString(node.id);
    const label = asString(node.label);
    if (id !== undefined && label !== undefined) labelMap.set(id, label);
  }

  const nodes: DisplaySafeNode[] = [];
  for (const node of raw.nodes as readonly RawNodeShape[]) {
    const projected = projectNode(node);
    if (projected !== null) nodes.push(projected);
  }

  const edges: DisplaySafeEdge[] = [];
  for (const edge of raw.edges as readonly RawEdgeShape[]) {
    const projected = projectEdge(edge, labelMap);
    if (projected !== null) edges.push(projected);
  }

  return {
    nodes,
    edges,
    options: raw.options,
    goals: raw.goals,
    constraints: raw.constraints,
    counts: raw.counts,
  };
}
