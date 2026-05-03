/**
 * Display-safe graph projection for the LLM-facing context pack.
 *
 * Originally introduced as brief-display-safe-graph A2.1 (strip raw
 * edge floats / exists / model-internal node fields; preserve user-
 * supplied `value`). Tightened by V5 D1 golden-path closure (A3.1
 * Task 6) to also strip node-level `value`, `raw_value`, and `cap`:
 * exposing any node numeric encouraged Sonnet to echo it as
 * structural fact ("the model sets X to 5") and reuse it as a
 * coefficient in narration. Reintroduced by A2.2 with a single
 * formatted field `display_value` ("5%", "£50k", "18 months") so
 * Sonnet can answer "what is the current churn rate?" without
 * seeing the underlying floats — the raw `value` / `raw_value` /
 * `cap` remain stripped. Sonnet now sees label, kind, category,
 * unit (label only), and `display_value` (formatted string only) —
 * no raw node numerics, no edge `strength` floats, no `exists`
 * probabilities.
 *
 * Design principle: raw model values stay in structured state for
 * handlers, telemetry, freshness hashing, and edit_graph dispatch;
 * the LLM-facing context pack uses decision-language projections
 * only.
 *
 * Operates strictly downstream of `compactGraphForContextPack()` and
 * `projectCompactGraph()`. The raw `ContextPack.graph` is preserved
 * for handler-side reads (edit_graph dispatch reads from raw
 * boundary graph state via a wholly separate path; freshness hashing
 * and telemetry continue to read raw `ContextPack.graph`).
 *
 * Pure function. No side effects. Idempotent on its own output
 * (re-running produces an equivalent shape — `relationship` strings
 * carry no decimals to re-classify; nodes have nothing numeric to
 * re-strip).
 */

import { synthesiseDisplayValue } from '../../cee/factor-extraction/display-value.js';
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
   * Pre-formatted user-facing quantity string ("5%", "£50,000",
   * "18 months"). Reintroduced in A2.2 because A3.1's full
   * value-strip left Sonnet unable to answer "what is the current
   * churn rate?" — the LLM had labels but no numeric data at all.
   * `display_value` carries the formatted string only; the
   * underlying `value` / `raw_value` / `cap` floats remain stripped
   * (A3.1 contract preserved). The raw `ContextPack.graph` still
   * carries the floats for handlers / freshness / edit_graph
   * dispatch; Sonnet never sees them.
   *
   * Source priority: existing `display_value` on the raw input
   * (set by `set_factor_value` post-mutation, A3.1 Task 3) is
   * preferred verbatim. When absent, the projector calls
   * `synthesiseDisplayValue` from `cee/factor-extraction/display-
   * value.ts` against value/raw_value/unit/factor_type/cap. A
   * bare-number guard discards unit-less numeric results ("0.05",
   * "0.75", "1", "50,000") so the projection cannot leak the
   * model-scale value through the display channel.
   */
  readonly display_value?: string;
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

/**
 * Shape of a raw input node consulted by `projectNode`. The
 * projection emits `id`, `label`, `kind`, `category`, `unit`,
 * `intervention_summary`, and `display_value` (A2.2). Numeric
 * fields (`value`, `raw_value`, `cap`) are READ here so
 * `synthesiseDisplayValue` can format them when an existing
 * `display_value` is absent — but they are NEVER projected onto
 * `DisplaySafeNode`. Sonnet sees the formatted string, never the
 * raw float (A3.1 Task 6 contract).
 *
 * `observed_state` is the canonical GraphV3T nesting; the
 * extractors read both compact-top-level and `observed_state.*`
 * shapes for value / raw_value / unit / cap / factor_type.
 */
interface RawNodeShape {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
  readonly category?: unknown;
  readonly unit?: unknown;
  readonly intervention_summary?: unknown;
  /**
   * A3.1 Task 3 sets this on the raw graph after a
   * `set_factor_value` mutation via `synthesiseDisplayValue`.
   * `projectNode` prefers it verbatim when present; otherwise it
   * synthesises from value/raw_value/unit/cap/factor_type below.
   */
  readonly display_value?: unknown;
  /** Compact top-level user-unit value (numeric or string). */
  readonly value?: unknown;
  /** Compact top-level raw user-supplied number (e.g. 50000 for £50k). */
  readonly raw_value?: unknown;
  /** Normalisation cap (e.g. 100 for percentage, 100000 for currency). */
  readonly cap?: unknown;
  /** Factor type classification consumed by `synthesiseDisplayValue`. */
  readonly factor_type?: unknown;
  /**
   * Canonical GraphV3T nesting. Both `unit` and the numeric
   * fields (`value`, `raw_value`, `cap`, `factor_type`) may be
   * inside this wrapper. The extractors read top-level first and
   * fall back here.
   */
  readonly observed_state?: unknown;
}

interface RawEdgeShape {
  readonly from?: unknown;
  readonly to?: unknown;
  /** Two shapes accepted on this field:
   *    - compact: numeric signed mean
   *    - canonical GraphV3T: `{ mean, std }` object (sign carried separately
   *      via `effect_direction`) */
  readonly strength?: unknown;
  /** Legacy / `editCompactGraph`-like form: a top-level numeric mean.
   *  Sign carried separately via `effect_direction` when present. */
  readonly strength_mean?: unknown;
  /** Optional sign override for the canonical and legacy shapes (their
   *  numeric magnitudes are non-negative). Ignored when the compact
   *  numeric `strength` is already signed. */
  readonly effect_direction?: unknown;
  readonly provenance?: unknown;
  /** Idempotency: a second pass through the formatter sees no `strength`
   *  but should preserve an existing allowlisted relationship phrase. */
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
 * Allowlist of phrases the formatter is permitted to emit on
 * `DisplaySafeEdge.relationship`. Pre-built once: every band × sign plus
 * the near-zero suppression phrase. Anything outside this set is treated
 * as an unsafe upstream string and dropped (defaults to "negligible link"
 * via the projectEdge fallback) — important when re-projecting an edge
 * carrying an unrecognised legacy `relationship` such as
 * `"strength of 0.55"`, which would otherwise leak verbatim.
 */
const RELATIONSHIP_PHRASES: ReadonlySet<string> = new Set([
  'negligible link',
  'weak positive link',
  'weak negative link',
  'moderate positive link',
  'moderate negative link',
  'strong positive link',
  'strong negative link',
  'very strong positive link',
  'very strong negative link',
]);

function asAllowedRelationship(value: unknown): string | undefined {
  return typeof value === 'string' && RELATIONSHIP_PHRASES.has(value) ? value : undefined;
}

/**
 * Extract the user-supplied node `unit` (label only) from the compact
 * top-level field first, falling back to the canonical
 * `observed_state.unit` nesting. The unit string is the only piece of
 * `observed_state` that survives into the display projection — the
 * inner numeric fields (`value`, `raw_value`, `cap`) are stripped per
 * A3.1 Task 6 because exposing them encouraged Sonnet to echo node
 * numerics as structural fact.
 */
function extractNodeUnit(raw: RawNodeShape): string | undefined {
  const top = asString(raw.unit);
  if (top !== undefined) return top;
  const observed = raw.observed_state;
  if (typeof observed === 'object' && observed !== null && 'unit' in observed) {
    const inner = (observed as { unit?: unknown }).unit;
    if (typeof inner === 'string') return inner;
  }
  return undefined;
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

/**
 * Read a compact-top-level OR canonical `observed_state.*` numeric
 * field. Returns `undefined` when neither shape carries a finite
 * number. Mirror of `extractNodeUnit`'s two-tier pattern.
 */
function extractNodeNumeric(
  raw: RawNodeShape,
  field: 'value' | 'raw_value' | 'cap',
): number | undefined {
  const top = (raw as Record<string, unknown>)[field];
  if (typeof top === 'number' && Number.isFinite(top)) return top;
  const observed = raw.observed_state;
  if (typeof observed === 'object' && observed !== null && field in observed) {
    const inner = (observed as Record<string, unknown>)[field];
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

function extractNodeFactorType(raw: RawNodeShape): string | undefined {
  const top = asString(raw.factor_type);
  if (top !== undefined) return top;
  const observed = raw.observed_state;
  if (typeof observed === 'object' && observed !== null && 'factor_type' in observed) {
    const inner = (observed as { factor_type?: unknown }).factor_type;
    if (typeof inner === 'string') return inner;
  }
  return undefined;
}

/**
 * Bare-number guard for the display channel. `synthesiseDisplayValue`
 * is generally safe — it formats with units and bands — but on a
 * factor with no unit / cap / factor_type it can fall through to the
 * raw normalised number as a string. That includes bare decimals
 * ("0.05", "0.75", "-0.5"), bare integers ("0", "1", "7" — emitted
 * via `parseFloat(n.toFixed(2))` for normalised values that round to
 * whole numbers), and thousands-separated bare numbers ("1,000",
 * "50,000" from `formatPlainNumber` priority-4 with no unit). Each
 * is exactly the model-scale leakage A3.1 Task 6 stripped at the
 * raw-numeric layer; allowing any of them through would defeat the
 * point of the display-safe projection.
 *
 * Allow legitimate formats: "5%", "£50,000", "18 months", "4.2/5",
 * "Low (0.15)", "Very high (1)" — anything that has a unit symbol,
 * currency prefix, suffix word, ratio, qualitative band wrapper, or
 * any non-numeric character. The regex matches strings composed
 * exclusively of an optional sign, digits, commas (thousands
 * separators), and an optional fractional part.
 */
function looksLikeRawDecimal(value: string): boolean {
  return /^-?[\d,]+(?:\.\d+)?$/.test(value);
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
    display_value?: string;
  } = { id, label, kind };
  const category = asString(raw.category);
  if (category !== undefined) node.category = category;
  const unit = extractNodeUnit(raw);
  if (unit !== undefined) node.unit = unit;
  const interventionSummary = asString(raw.intervention_summary);
  if (interventionSummary !== undefined) node.intervention_summary = interventionSummary;

  // V5 A2.2 — display_value re-introduction.
  //
  // Source priority:
  //   1. Existing `display_value` on the raw input. Set by
  //      `set_factor_value` post-mutation (A3.1 Task 3) using the
  //      same `synthesiseDisplayValue` formatter. Use it verbatim
  //      so handler-set values survive without recomputation.
  //   2. Synthesise from value / raw_value / unit / cap /
  //      factor_type via the canonical formatter.
  //
  // After either source, the bare-number guard discards unit-less
  // numeric strings ("0.05", "1", "50,000") so a unit-less factor
  // cannot leak the underlying float through the display channel.
  //
  // Raw `value` / `raw_value` / `cap` remain stripped from the
  // projection (A3.1 Task 6 contract); only the formatted string
  // reaches Sonnet.
  const existing = asString(raw.display_value);
  let displayCandidate: string | undefined;
  if (existing !== undefined && existing.length > 0) {
    displayCandidate = existing;
  } else {
    const value = extractNodeNumeric(raw, 'value');
    const rawValue = extractNodeNumeric(raw, 'raw_value');
    const cap = extractNodeNumeric(raw, 'cap');
    const factorType = extractNodeFactorType(raw);
    const synthesised = synthesiseDisplayValue({
      ...(value !== undefined ? { value } : {}),
      ...(rawValue !== undefined ? { raw_value: rawValue } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(factorType !== undefined ? { factor_type: factorType } : {}),
      ...(cap !== undefined ? { cap } : {}),
    });
    if (synthesised !== undefined && synthesised.length > 0) {
      displayCandidate = synthesised;
    }
  }
  if (displayCandidate !== undefined && !looksLikeRawDecimal(displayCandidate)) {
    node.display_value = displayCandidate;
  }
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
  // it ONLY when it is one of the formatter's allowlisted phrases —
  // unknown strings (e.g. legacy `"strength of 0.55"` prose) MUST NOT
  // pass through verbatim, since they would defeat the entire point of
  // the display-safe projection. Unknown / missing → "negligible link".
  const existingRelationship = asAllowedRelationship(raw.relationship);
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
 *   - Nodes: `id`, `label`, `kind`, `category?`, `unit?` (label only),
 *     `intervention_summary?`, and `display_value?` (A2.2) survive.
 *     Per V5 D1 golden-path
 *     closure (A3.1 Task 6), node-level `value`, `raw_value`, and
 *     `cap` are stripped from the LLM-facing projection (including
 *     when nested under canonical `observed_state.{value,raw_value,
 *     cap}`). Brief A2.1 originally preserved `value` as a "user-
 *     meaningful quantity"; the post-A3 review reversed that
 *     decision because exposing any node numeric encouraged Sonnet
 *     to echo it as structural fact and reuse it as a coefficient
 *     in narration. The raw `ContextPack.graph` retains all node
 *     numerics for handlers, freshness hashing, and edit_graph
 *     dispatch — Sonnet just doesn't see them. Internal `source` /
 *     `_raw_provenance` are dropped (diagnostic-only).
 *     The `unit` extractor still reads compact top-level `unit`
 *     first and canonical `observed_state.unit` second so the
 *     assembler raw-graph fallback preserves the user-facing label.
 *
 *     A2.2 reintroduces `display_value` — the pre-formatted
 *     user-facing string ("5%", "£50,000", "18 months") — because
 *     A3.1's full value-strip left Sonnet unable to answer "what
 *     is the current churn rate?". The display channel carries
 *     the formatted string only; the underlying floats remain
 *     stripped. Source priority: existing `display_value` on the
 *     raw input is preferred verbatim (set by `set_factor_value`
 *     post-mutation, A3.1 Task 3); otherwise the projector calls
 *     `synthesiseDisplayValue` against value / raw_value / unit /
 *     factor_type / cap. A bare-number guard rejects unit-less
 *     results ("0.05", "1", "50,000") so the display channel
 *     cannot leak the model-scale value.
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
