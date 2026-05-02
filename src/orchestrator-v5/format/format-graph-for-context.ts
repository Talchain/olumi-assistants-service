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
  /**
   * User-supplied quantity (e.g. observed factor value) carried through
   * verbatim. Brief A2.1 explicitly preserves this — it is not a model
   * coefficient, and rebanding it would corrupt user-meaningful data
   * (e.g. "Marketing Spend = 100k"). The model-normalised siblings
   * `raw_value` and `cap` are stripped because they're internal scaling.
   */
  readonly value?: number | string;
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
  readonly value?: unknown;
}

interface RawEdgeShape {
  readonly from?: unknown;
  readonly to?: unknown;
  /** Compact form: numeric signed mean. */
  readonly strength?: unknown;
  /** Canonical GraphV3T form: `{ mean, std }` object. */
  readonly strength_mean?: unknown;
  /** Legacy form: a top-level `strength_mean` numeric field. */
  readonly effect_direction?: unknown;
  readonly provenance?: unknown;
  /** Idempotency: a second pass through the formatter sees no `strength`
   *  but should preserve the existing relationship phrase. */
  readonly relationship?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
    value?: number | string;
  } = { id, label, kind };
  const category = asString(raw.category);
  if (category !== undefined) node.category = category;
  const unit = asString(raw.unit);
  if (unit !== undefined) node.unit = unit;
  const interventionSummary = asString(raw.intervention_summary);
  if (interventionSummary !== undefined) node.intervention_summary = interventionSummary;
  // User-supplied `value`: numeric or string carried through verbatim.
  // Brief A2.1: do not format node values — they may be user-meaningful
  // quantities (e.g. "Marketing Spend = 100"). Other types (booleans,
  // arrays, objects) are not in the canonical node-value vocabulary;
  // dropped defensively.
  if (typeof raw.value === 'number' && Number.isFinite(raw.value)) node.value = raw.value;
  else if (typeof raw.value === 'string') node.value = raw.value;
  return node;
}

/**
 * Resolve the signed edge strength across all canonical and legacy shapes
 * that can reach `ContextPack.graph`:
 *
 *   - compact (`compactGraph`)         → `strength: number`
 *   - canonical GraphV3T               → `strength: { mean: number }` (+ optional `effect_direction`)
 *   - legacy / `editCompactGraph`-like → top-level `strength_mean: number` (+ optional `effect_direction`)
 *
 * Returns `null` when no usable strength is found, signalling the caller
 * to either preserve an existing relationship (idempotent re-projection)
 * or omit the relationship rather than emit a misleading "negligible link".
 */
function resolveSignedStrength(raw: RawEdgeShape): number | null {
  if (typeof raw.strength === 'number' && Number.isFinite(raw.strength)) {
    return raw.strength;
  }
  let magnitude: number | null = null;
  if (
    typeof raw.strength === 'object'
    && raw.strength !== null
    && 'mean' in raw.strength
    && typeof (raw.strength as { mean?: unknown }).mean === 'number'
  ) {
    const mean = (raw.strength as { mean: number }).mean;
    if (Number.isFinite(mean)) magnitude = mean;
  } else if (typeof raw.strength_mean === 'number' && Number.isFinite(raw.strength_mean)) {
    magnitude = raw.strength_mean;
  }
  if (magnitude === null) return null;
  // Apply effect_direction sign override only when supplied AND the
  // magnitude is non-negative — canonical GraphV3T emits non-negative
  // means with sign carried separately; legacy shapes may emit signed
  // means without a separate direction.
  if (raw.effect_direction === 'negative' && magnitude >= 0) return -magnitude;
  return magnitude;
}

function projectEdge(raw: RawEdgeShape, labelMap: ReadonlyMap<string, string>): DisplaySafeEdge | null {
  const from = asString(raw.from);
  const to = asString(raw.to);
  if (from === undefined || to === undefined) return null;
  const strength = resolveSignedStrength(raw);
  // Idempotency: re-projecting an already display-safe edge has no
  // numeric strength but carries an existing `relationship`. Preserve
  // it rather than defaulting to "negligible link" — that would silently
  // overwrite the upstream classification on every re-pass.
  const existingRelationship = asString(raw.relationship);
  const relationship = strength !== null
    ? relationshipPhrase(strength)
    : existingRelationship ?? 'negligible link';
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
    relationship,
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
 *   - Nodes: `id`, `label`, `kind`, `category?`, `unit?`,
 *     `intervention_summary?`, and user-supplied `value?` survive.
 *     Model-normalised `raw_value`/`cap` and internal `source` /
 *     `_raw_provenance` are dropped — they leak raw model state into
 *     prose. `value` is preserved per brief A2.1 because it may be a
 *     user-meaningful quantity (e.g. "Marketing Spend = 100k").
 *
 *   - Edge strength resolution accepts every shape that can reach
 *     `ContextPack.graph`: compact (`strength: number`), canonical
 *     GraphV3T (`strength: { mean }` + optional `effect_direction`),
 *     and legacy `strength_mean`. When no strength is present an
 *     existing `relationship` (idempotent re-projection) is preserved.
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
