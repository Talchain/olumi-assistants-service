/**
 * Graph Compact Serialisation
 *
 * Produces a deterministic, compact representation of GraphV3 for LLM context.
 * Full graph goes to PLoT; this compact form fits the context budget.
 *
 * Output is deterministic: same graph input → byte-identical JSON output.
 * Nodes sorted by id, edges sorted by from then to.
 *
 * Token budget target: ~800–1200 tokens for a 10-node, 15-edge graph
 * (vs 3000–5000 for full GraphV3).
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import { DEFAULT_EXISTS_PROBABILITY } from "./constants.js";
import { isLegalStructuralEdge } from "../../cee/utils/structural-edge-classifier.js";
import { collectDirectedReachable } from "../../graph/reachability.js";

// ============================================================================
// Output Types
// ============================================================================

export type CompactNodeSource = 'user' | 'assumption' | 'system';

/**
 * Display-safe provenance vocabulary for the UI/coaching layer. Mapped from
 * upstream extractionType (nodes) or provenance.source (edges); the raw
 * upstream value is preserved on `_raw_provenance` for diagnostics.
 *
 * Unknown / absent upstream values map to `'ai_inferred'` (safe default —
 * anything not explicitly user-set or brief-extracted is treated as inferred).
 */
export type CompactProvenance = 'from_brief' | 'ai_inferred' | 'user_set';

/**
 * Existing compactor-owned display bands for a producer-attested causal
 * coefficient. These are the structured form of the phrases already emitted by
 * `buildPlainInterpretation`; they do not expose `strength.std` or introduce a
 * second threshold authority.
 */
export type CompactCoefficientConfidence = 'high' | 'moderate' | 'uncertain';

/**
 * Hard prompt bounds for producer-supplied uncertainty text. The entry cap
 * matches the strict observed-state contract; the character cap matches the
 * existing producer-side proposal guard. Neither constant is a ranking rule:
 * the producer's order is preserved and only a deterministic prefix is kept.
 */
export const CONTEXT_UNCERTAINTY_DRIVER_MAX_ENTRIES = 2;
export const CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS = 120;

/**
 * In-band disclosure for the only cases where the compact projection cannot
 * pass the producer bytes through in full. A conflict is withheld rather than
 * resolved locally: choosing one of two canonical-looking sources here would
 * create a second authority for model truth.
 */
export type CompactUncertaintyDriversDisclosure =
  | {
      readonly status: 'truncated';
      readonly original_entries: number;
      readonly retained_entries: number;
      readonly entries_omitted_by_count: number;
      readonly entries_truncated_by_chars: number;
      readonly per_entry_char_limit: number;
    }
  | { readonly status: 'conflicting_sources_withheld' };

export interface CompactUncertaintyDriversProjection {
  readonly uncertainty_drivers?: string[];
  readonly uncertainty_drivers_disclosure?: CompactUncertaintyDriversDisclosure;
}

export interface CompactNode {
  id: string;
  kind: string;
  label: string;
  /** Producer-attested status-quo identity (option nodes only). False is omitted. */
  is_baseline?: true;
  /** Saved Living Model detail, bounded before it reaches prompt context. */
  description?: string;
  type?: string;
  category?: string;
  value?: number;  // from observed_state.value
  raw_value?: number;  // from observed_state.raw_value
  unit?: string;       // from observed_state.unit
  cap?: number;        // from observed_state.cap
  /** Provenance enum (legacy CompactNodeSource vocabulary).
   *  Kept alongside `provenance` for back-compat with context-pack-assembler /
   *  telemetry consumers that read this field today. */
  source?: CompactNodeSource;
  /** Display-safe provenance projection (UI/coaching vocabulary). Added
   *  alongside `source`. Unknown upstream values map to `'ai_inferred'`. */
  provenance?: CompactProvenance;
  /** Raw upstream provenance string. Emitted ONLY for unrecognised upstream
   *  values — the four canonical extractionType values are recoverable from
   *  `provenance` + the mapping table, so emitting them here would just burn
   *  LLM context tokens. Treat as diagnostic-only. */
  _raw_provenance?: string;
  /** Human-readable summary of option interventions (option nodes only). */
  intervention_summary?: string;
  /** Producer-supplied epistemic uncertainty, in producer order. */
  uncertainty_drivers?: string[];
  /** Present only when uncertainty text was bounded or had to be withheld. */
  uncertainty_drivers_disclosure?: CompactUncertaintyDriversDisclosure;
  /**
   * Node ids this OPTION can reach by a directed path, sorted, excluding
   * itself. Emitted on option nodes ONLY — and ALWAYS on them, empty array
   * included. See {@link buildOptionReachability} for why, and for what this
   * field does and does not claim.
   */
  reaches?: string[];
}

export interface CompactEdge {
  from: string;
  to: string;
  strength: number;   // mean only
  exists: number;     // exists_probability (defaulted to DEFAULT_EXISTS_PROBABILITY if absent)
  /** Human-readable causal interpretation (causal edges only, omitted for structural/bidirected). */
  plain_interpretation?: string;
  /** Closed form of the compactor's confidence phrase in `plain_interpretation`.
   *  Omitted when the compactor emits no confidence phrase or the edge is not
   *  interpreted as causal. */
  coefficient_confidence?: CompactCoefficientConfidence;
  /** Display-safe provenance projection. Mapped from edge.provenance.source.
   *  Unknown / absent values map to `'ai_inferred'`. */
  provenance?: CompactProvenance;
  /** Raw upstream provenance.source. Emitted ONLY for unrecognised values
   *  (see CompactNode._raw_provenance for the rationale). */
  _raw_provenance?: string;
}

export interface GraphV3Compact {
  nodes: CompactNode[];
  edges: CompactEdge[];
  _node_count: number;  // convenience for template/logging
  _edge_count: number;
}

/** Shared prompt-context bound for saved node descriptions. */
export const NODE_DESCRIPTION_CONTEXT_MAX_CHARS = 160;

/**
 * Preserve producer-authored description bytes while bounding prompt cost.
 * The visible ellipsis makes truncation explicit; non-string legacy input is
 * omitted rather than coerced into invented text.
 */
export function boundNodeDescriptionForContext(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const characters = Array.from(value);
  return characters.length <= NODE_DESCRIPTION_CONTEXT_MAX_CHARS
    ? value
    : `${characters.slice(0, NODE_DESCRIPTION_CONTEXT_MAX_CHARS - 1).join('')}…`;
}

// Re-export so existing importers of this module don't break
export { DEFAULT_EXISTS_PROBABILITY } from "./constants.js";

// ============================================================================
// Helpers
// ============================================================================

/** Max interventions shown before truncation. */
const MAX_INTERVENTION_ENTRIES = 5;

function readDriverSource(value: unknown): readonly string[] | null | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : null;
}

function sameDriverBytes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function boundDriverText(entry: string): { readonly text: string; readonly truncated: boolean } {
  let codePoints = 0;
  let endCodeUnit = 0;
  for (const codePoint of entry) {
    if (codePoints === CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS) {
      return { text: entry.slice(0, endCodeUnit), truncated: true };
    }
    codePoints += 1;
    endCodeUnit += codePoint.length;
  }
  return { text: entry, truncated: false };
}

/**
 * Project producer-supplied factor uncertainty into bounded prompt context.
 *
 * Two source locations are permitted while repair stages promote factor
 * metadata: `node.uncertainty_drivers` and
 * `node.observed_state.uncertainty_drivers`. Equal arrays are the same fact;
 * unequal arrays are a conflict and are withheld. This function never merges,
 * sorts, ranks, rewrites, or infers entries. Within the hard bounds it returns
 * the exact producer strings in the exact producer order. When a bound cuts
 * content it retains only the exact leading characters and discloses both the
 * entry and character loss.
 *
 * The function also accepts its own already-compacted output so the downstream
 * display-safe formatter can use the same conflict/bounds authority without
 * losing a prior truncation disclosure.
 */
export function projectUncertaintyDriversForContext(
  input: unknown,
): CompactUncertaintyDriversProjection {
  if (typeof input !== 'object' || input === null) return {};
  const raw = input as Record<string, unknown>;
  const existingRaw = raw.uncertainty_drivers_disclosure;
  if (typeof existingRaw === 'object' && existingRaw !== null) {
    const existing = existingRaw as Record<string, unknown>;
    if (existing.status === 'conflicting_sources_withheld') {
      return {
        uncertainty_drivers_disclosure: { status: 'conflicting_sources_withheld' },
      };
    }
  } else if (existingRaw !== undefined) {
    return {};
  }

  const topLevel = readDriverSource(raw.uncertainty_drivers);
  const observedState = raw.observed_state;
  const observed = readDriverSource(
    typeof observedState === 'object' && observedState !== null
      ? (observedState as Record<string, unknown>).uncertainty_drivers
      : undefined,
  );
  if (topLevel === null || observed === null) return {};
  if (
    topLevel !== undefined
    && observed !== undefined
    && !sameDriverBytes(topLevel, observed)
  ) {
    return {
      uncertainty_drivers_disclosure: { status: 'conflicting_sources_withheld' },
    };
  }

  const source = topLevel ?? observed;
  if (source === undefined || source.length === 0) return {};

  const retainedSource = source.slice(0, CONTEXT_UNCERTAINTY_DRIVER_MAX_ENTRIES);
  let entriesTruncatedByChars = 0;
  const uncertaintyDrivers = retainedSource.map((entry) => {
    const bounded = boundDriverText(entry);
    if (bounded.truncated) entriesTruncatedByChars += 1;
    return bounded.text;
  });
  const entriesOmittedByCount = source.length - uncertaintyDrivers.length;

  if (typeof existingRaw === 'object' && existingRaw !== null) {
    const existing = existingRaw as Record<string, unknown>;
    const originalEntries = existing.original_entries;
    const retainedEntries = existing.retained_entries;
    const omittedByCount = existing.entries_omitted_by_count;
    const truncatedByChars = existing.entries_truncated_by_chars;
    const existingIsValidTruncation =
      existing.status === 'truncated'
      && typeof originalEntries === 'number'
      && typeof retainedEntries === 'number'
      && typeof omittedByCount === 'number'
      && typeof truncatedByChars === 'number'
      && Number.isInteger(originalEntries)
      && Number.isInteger(retainedEntries)
      && Number.isInteger(omittedByCount)
      && Number.isInteger(truncatedByChars)
      && originalEntries >= retainedEntries
      && retainedEntries === uncertaintyDrivers.length
      && omittedByCount === originalEntries - retainedEntries
      && truncatedByChars >= 0
      && truncatedByChars <= retainedEntries
      && (omittedByCount > 0 || truncatedByChars > 0)
      && existing.per_entry_char_limit === CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS
      && entriesOmittedByCount === 0
      && entriesTruncatedByChars === 0;
    if (!existingIsValidTruncation) return {};
    return {
      uncertainty_drivers: uncertaintyDrivers,
      uncertainty_drivers_disclosure: {
        status: 'truncated',
        original_entries: originalEntries,
        retained_entries: retainedEntries,
        entries_omitted_by_count: omittedByCount,
        entries_truncated_by_chars: truncatedByChars,
        per_entry_char_limit: CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
      },
    };
  }

  if (entriesOmittedByCount === 0 && entriesTruncatedByChars === 0) {
    return { uncertainty_drivers: uncertaintyDrivers };
  }
  return {
    uncertainty_drivers: uncertaintyDrivers,
    uncertainty_drivers_disclosure: {
      status: 'truncated',
      original_entries: source.length,
      retained_entries: uncertaintyDrivers.length,
      entries_omitted_by_count: entriesOmittedByCount,
      entries_truncated_by_chars: entriesTruncatedByChars,
      per_entry_char_limit: CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
    },
  };
}

/**
 * Build a human-readable intervention summary for an option node.
 * Format: "sets Label1=0.9, Label2=0.7" (capped at 5 entries).
 *
 * @param interventions - factor_id → numeric value map (from data.interventions)
 * @param labelMap - node id → label lookup built from graph nodes
 * @returns summary string, or undefined if no interventions
 */
function buildInterventionSummary(
  interventions: Record<string, number>,
  labelMap: Map<string, string>,
): string | undefined {
  const entries = Object.entries(interventions);
  if (entries.length === 0) return undefined;

  // Sort by key for determinism
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  // Only include interventions whose factor ID resolves to a label — never surface raw IDs
  const resolved = entries.filter(([factorId]) => labelMap.has(factorId));
  if (resolved.length === 0) return undefined;

  const shown = resolved.slice(0, MAX_INTERVENTION_ENTRIES);
  const remaining = resolved.length - shown.length;

  const parts = shown.map(([factorId, value]) => `${labelMap.get(factorId)!}=${value}`);

  let summary = `sets ${parts.join(', ')}`;
  if (remaining > 0) {
    summary += ` ...and ${remaining} more`;
  }
  return summary;
}

/**
 * Determine whether an edge is structural (non-causal) based on endpoint node kinds.
 * Structural edges connect decision→option or option→factor — they represent
 * graph connectivity, not causal influence.
 */
/**
 * Check if an edge is a legal structural edge using the shared classifier.
 * Only decision→option and option→factor are structural; option→outcome etc.
 * are forbidden patterns that should remain visible to diagnostics.
 */
function isStructuralEdge(
  edge: GraphV3T['edges'][number],
  kindMap: Map<string, string>,
): boolean {
  return isLegalStructuralEdge(kindMap.get(edge.from), kindMap.get(edge.to));
}

/**
 * Derive a plain-language interpretation from edge parameters.
 *
 * Direction from effect_direction or sign of mean.
 * Magnitude from |mean|: [0.7, 1.0] strongly, [0.4, 0.7) moderately, [0.1, 0.4) weakly.
 * Confidence from std: [0.05, 0.10) high, [0.10, 0.20) moderate, [0.20, ∞) uncertain.
 *
 * Skips structural edges (by node kind), bidirected edges, and sub-threshold edges.
 */
interface CompactPlainInterpretation {
  readonly text: string;
  readonly coefficientConfidence?: CompactCoefficientConfidence;
}

function classifyCoefficientConfidence(
  std: number,
): CompactCoefficientConfidence | undefined {
  if (std >= 0.20) return 'uncertain';
  if (std >= 0.10) return 'moderate';
  if (std >= 0.05) return 'high';
  return undefined;
}

function confidencePhrase(
  confidence: CompactCoefficientConfidence | undefined,
): string {
  if (confidence === 'uncertain') return '(uncertain)';
  if (confidence === 'moderate') return '(moderate confidence)';
  if (confidence === 'high') return '(high confidence)';
  return '';
}

function buildPlainInterpretation(
  edge: GraphV3T['edges'][number],
  labelMap: Map<string, string>,
  kindMap: Map<string, string>,
): CompactPlainInterpretation | undefined {
  // Skip bidirected edges
  const anyEdge = edge as Record<string, unknown>;
  if (anyEdge.edge_type === 'bidirected') return undefined;

  // Skip structural edges based on endpoint node kinds
  if (isStructuralEdge(edge, kindMap)) return undefined;

  const mean = edge.strength?.mean ?? 0;
  const std = edge.strength?.std ?? 0;

  // Skip zero-mean edges (no direction to interpret)
  if (mean === 0) return undefined;

  const absMean = Math.abs(mean);

  // Skip sub-threshold edges
  if (absMean < 0.1) return undefined;

  // Direction: prefer explicit effect_direction, fall back to sign of mean
  const direction = edge.effect_direction === 'positive' || edge.effect_direction === 'negative'
    ? edge.effect_direction
    : (mean > 0 ? 'positive' : 'negative');
  const verb = direction === 'positive' ? 'increases' : 'decreases';

  // Magnitude from |mean|: [0.7, 1.0] strongly, [0.4, 0.7) moderately, [0.1, 0.4) weakly
  let magnitude: string;
  if (absMean >= 0.7) {
    magnitude = 'strongly';
  } else if (absMean >= 0.4) {
    magnitude = 'moderately';
  } else {
    magnitude = 'weakly';
  }

  // One classification feeds both the existing prose and the structured
  // prompt-safe carrier. Keeping the thresholds here prevents a formatter-
  // side twin from drifting away from the producer's established wording.
  const coefficientConfidence = classifyCoefficientConfidence(std);
  const confidence = confidencePhrase(coefficientConfidence);

  const fromLabel = labelMap.get(edge.from) ?? edge.from;
  const toLabel = labelMap.get(edge.to) ?? edge.to;

  return {
    text: `${fromLabel} ${magnitude} ${verb} ${toLabel}${confidence ? ' ' + confidence : ''}`,
    ...(coefficientConfidence !== undefined ? { coefficientConfidence } : {}),
  };
}

/**
 * ⭐⭐ THE STRUCTURAL REACHABLE SET FOR ONE OPTION — AND WHAT IT DOES NOT CLAIM.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * Witnessed on the deployed build. The assistant said, of a graph carrying
 * `Status Quo -> Berlin office investment` (mean 1.0, exists_p 1.0) then
 * `-> Cash runway breach` (mean 0.5):
 *
 *   "…since the status quo and UK expansion routes don't run through cash
 *    runway breach at all in your current structure."
 *
 * Every QUANTITY in that answer was correct. The TOPOLOGY was false, over a
 * two-hop path whose first edge was certain.
 *
 * ⚠ IT WAS NOT A PROMPT FAILURE, AND PROMPTING HARDER IS WHAT HAD ALREADY BEEN
 * TRIED. `orchestrator-cf-v28` rule 3 (GROUND) requires every claim to
 * reference model data, and its STATE_GROUNDING block says to check Zone 2
 * structured data before claiming what does or does not exist. The model DID
 * check Zone 2. Zone 2 carried this compactor's FLAT EDGE LIST — `{from, to,
 * strength, exists}` per edge, no paths, no reachability, no closure — so
 * "which routes pass through X" was a question the product instructed it to
 * answer from a surface that does not contain the answer.
 *
 * Supplying the derived answer is strictly stronger than caveating the claim:
 * with the reachable set in the pack the false sentence CONTRADICTS Zone 2,
 * and rule 1 (SAFETY) already forbids that. A caveat cannot make a false
 * sentence ungroundable; a fact can.
 *
 * ── ⚠ WHAT THIS FIELD CLAIMS, EXACTLY ───────────────────────────────────────
 * "There is a directed route in the model AS DRAWN." That is all. It is a
 * claim about STRUCTURE, not about strength, sign, magnitude or certainty.
 *
 * ⭐ IT IS DELIBERATELY **NOT** GATED ON `exists_probability`, AND THE REASON
 * IS THE DIRECTION OF THE HARM. `exists_probability` is stripped before the
 * model sees anything (see the `compactGraph` doc block), so a reader might
 * reasonably ask whether a route built over a low-probability edge should
 * count. Gating it would be wrong twice over:
 *
 *   1. **It would manufacture false NEGATIVES, which is the defect being
 *      fixed.** The witnessed harm was "these routes don't run through X at
 *      all" — a wrongly-withheld path. Any threshold that drops an edge
 *      re-creates exactly that sentence, now with the product's own authority
 *      behind it. Wrongly asserting non-reachability is worse than wrongly
 *      asserting reachability, because the model can qualify the second from
 *      the strength bands it already has and cannot recover from the first.
 *   2. **It would mint a second threshold authority** — a hand-tuned constant
 *      governing which edges "really" exist, sitting beside the compactor's
 *      existing magnitude and confidence bands and answerable to nothing.
 *      That is the class this estate keeps paying for.
 *
 * An edge present in the graph IS a modelled relationship; `exists_probability`
 * is uncertainty ABOUT it. Those are two questions, and this field answers only
 * the first. Certainty along a path is a genuinely different question with a
 * real producer already in the estate (ISL `path_decomposition`, whose
 * `path_effect` is a signed product of per-edge coefficients) — it is
 * request-gated, top-3-ranked and CEE requests it nowhere today, so it is the
 * right long-term home for path MAGNITUDE and the wrong oracle for a
 * reachability NEGATIVE. Rowed, not built here.
 *
 * ── OTHER DECISIONS, WRITTEN DOWN SO THEY ARE NOT RE-LITIGATED BY GUESS ─────
 * · **Directed-only.** A bidirected edge is an unmeasured common cause, not a
 *   causal path — the estate's declared position. The policy is applied by
 *   importing `graph/reachability.ts`, the single kernel that exists BECAUSE
 *   three hand-rolled forward-BFS twins once disagreed about it. This computes
 *   at the compactor precisely because raw `edge_type` is still present here;
 *   it is dropped from `CompactEdge`, so no downstream layer could apply the
 *   policy correctly.
 * · **Options only.** The witnessed claim is about which OPTION routes pass
 *   through a node, and per-node closure on every node would be O(n²) prompt
 *   text for a question nobody asked.
 * · **Always emitted on options, empty array included.** An empty set is a
 *   POSITIVE fact ("this option is a dead end") and the draft prompts already
 *   forbid dead-end status-quo options. Omitting the key on an empty set would
 *   make absence ambiguous between "reaches nothing" and "not computed" — the
 *   standing absence-means-unknown trap.
 * · **Unbounded, deliberately.** Every other bounded field here (uncertainty
 *   drivers, descriptions) discloses its truncation in band. A reachable set is
 *   bounded by the node count, which is already budgeted and already in the
 *   pack as `_node_count`; a SILENTLY short set would read as a genuine
 *   non-reachability, i.e. the original defect. If this ever needs a cap it
 *   needs an in-band disclosure with it, never a bare slice.
 */
function buildOptionReachability(
  nodeId: string,
  edges: GraphV3T["edges"],
): string[] {
  return collectDirectedReachable(nodeId, edges);
}

// ============================================================================
// Compact Graph
// ============================================================================

/**
 * Compact a V3 graph for LLM context.
 *
 * Kept per node: id, kind, label, literal is_baseline=true (option nodes only),
 * bounded description (if present), type (if present), category (if present),
 * observed_state.value, raw_value, unit, cap (if present),
 * source (legacy CompactNodeSource — derived from extractionType),
 * provenance (display-safe CompactProvenance — also derived from extractionType),
 * _raw_provenance (raw extractionType string for diagnostics),
 * intervention_summary (option nodes with data.interventions),
 * producer-supplied uncertainty_drivers (bounded with in-band disclosure).
 *
 * Dropped per node: body, state_space, goal_threshold, observed_state.std,
 * observed_state.baseline, observed_state.extractionType (projected to source + provenance).
 *
 * Kept per edge: from, to, strength.mean, exists_probability (defaulted to DEFAULT_EXISTS_PROBABILITY),
 * plain_interpretation and its closed coefficient_confidence band (causal edges only),
 * provenance (display-safe CompactProvenance — derived from edge.provenance.source),
 * _raw_provenance (raw provenance.source string for diagnostics).
 * Dropped per edge: strength.std, effect_direction, label, edge.provenance.reasoning.
 *
 * Output is sorted: nodes by id, edges by from then to.
 */
export function compactGraph(graph: GraphV3T): GraphV3Compact {
  // Build lookup maps for resolving factor IDs to labels and node kinds
  const labelMap = new Map<string, string>();
  const kindMap = new Map<string, string>();
  for (const node of graph.nodes) {
    labelMap.set(node.id, node.label ?? node.id);
    kindMap.set(node.id, node.kind);
  }

  const nodes: CompactNode[] = graph.nodes
    .map((node) => {
      const n: CompactNode = {
        id: node.id,
        kind: node.kind,
        label: node.label ?? node.id,
      };

      // Preserve only the producer-attested positive fact. Do not infer a
      // baseline from the option label/id and do not spend prompt budget on
      // false values. The canonical graph validator owns this field's shape.
      if (node.kind === 'option' && node.is_baseline === true) {
        n.is_baseline = true;
      }

      const description = boundNodeDescriptionForContext(node.description);
      if (description !== undefined) {
        n.description = description;
      }

      // type — not in canonical NodeV3T schema but may be present via passthrough
      const anyNode = node as Record<string, unknown>;
      if (typeof anyNode.type === 'string') {
        n.type = anyNode.type;
      }

      // category
      if (node.category) {
        n.category = node.category;
      }

      // observed_state fields: value, raw_value, unit, cap, extractionType → source
      if (node.observed_state !== undefined && node.observed_state !== null) {
        const obsState = node.observed_state as Record<string, unknown>;
        if (typeof obsState.value === 'number') {
          n.value = obsState.value;
        }
        if (typeof obsState.raw_value === 'number') {
          n.raw_value = obsState.raw_value;
        }
        if (typeof obsState.unit === 'string') {
          n.unit = obsState.unit;
        }
        if (typeof obsState.cap === 'number') {
          n.cap = obsState.cap;
        }

        // Provenance: derive both legacy `source` (for context-pack-assembler
        // / telemetry consumers) and the new `provenance` projection (for the
        // UI/coaching layer). Raw upstream value is retained on
        // `_raw_provenance` for diagnostics.
        //
        // source mapping (unchanged):
        //   explicit  → user
        //   inferred  → assumption
        //   range/observed/anything-else → system
        //
        // provenance mapping (new):
        //   explicit, observed → from_brief   (value came from the brief / observation)
        //   inferred, range    → ai_inferred  (LLM-derived / range estimate)
        //   anything-else      → ai_inferred  (safe default per brief)
        //   user_specified path: not currently emitted by upstream nodes;
        //     reserved for future user-edit pipelines.
        // `_raw_provenance` is debug-only and only emitted when the upstream
        // value falls OUTSIDE the four canonical extractionType values — i.e.
        // when something would be lost by the projection. For the canonical
        // values the raw is fully recoverable from `provenance` + the mapping
        // table, so emitting it would just burn LLM context tokens.
        const et = obsState.extractionType;
        if (et === 'explicit') {
          n.source = 'user';
          n.provenance = 'from_brief';
        } else if (et === 'inferred') {
          n.source = 'assumption';
          n.provenance = 'ai_inferred';
        } else if (et === 'observed') {
          n.source = 'system';
          n.provenance = 'from_brief';
        } else if (et === 'range') {
          n.source = 'system';
          n.provenance = 'ai_inferred';
        } else {
          n.source = 'system';
          n.provenance = 'ai_inferred';
          if (typeof et === 'string' && et.length > 0) {
            n._raw_provenance = et; // unrecognised value — preserved for debug
          }
        }
      } else {
        // No observed_state — treat as system-derived / ai_inferred.
        n.source = 'system';
        n.provenance = 'ai_inferred';
      }

      if (node.kind === 'factor') {
        const uncertaintyProjection = projectUncertaintyDriversForContext(anyNode);
        if (uncertaintyProjection.uncertainty_drivers !== undefined) {
          n.uncertainty_drivers = uncertaintyProjection.uncertainty_drivers;
        }
        if (uncertaintyProjection.uncertainty_drivers_disclosure !== undefined) {
          n.uncertainty_drivers_disclosure =
            uncertaintyProjection.uncertainty_drivers_disclosure;
        }
      }

      // Intervention summary for option nodes with data.interventions
      if (node.kind === 'option') {
        // Structural reachability. ALWAYS emitted on an option (empty included)
        // so absence of the key means "not an option", never "not computed".
        n.reaches = buildOptionReachability(node.id, graph.edges);

        const data = anyNode.data as Record<string, unknown> | undefined;
        if (data && typeof data.interventions === 'object' && data.interventions !== null) {
          const summary = buildInterventionSummary(
            data.interventions as Record<string, number>,
            labelMap,
          );
          if (summary) {
            n.intervention_summary = summary;
          }
        }
      }

      return n;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges: CompactEdge[] = graph.edges
    .map((edge) => {
      const e: CompactEdge = {
        from: edge.from,
        to: edge.to,
        strength: edge.strength?.mean ?? 0,
        exists: edge.exists_probability ?? DEFAULT_EXISTS_PROBABILITY,
      };

      const interpretation = buildPlainInterpretation(edge, labelMap, kindMap);
      if (interpretation) {
        e.plain_interpretation = interpretation.text;
        if (interpretation.coefficientConfidence !== undefined) {
          e.coefficient_confidence = interpretation.coefficientConfidence;
        }
      }

      // Edge provenance projection. EdgeProvenanceV3.source ∈
      // {brief_extraction, cee_hypothesis, domain_knowledge, user_specified}.
      // Read as `unknown` so the fallback branch can defensively log future
      // (post-schema-bump) values that wouldn't satisfy the typed union.
      // Mapping:
      //   brief_extraction  → from_brief
      //   user_specified    → user_set
      //   cee_hypothesis    → ai_inferred
      //   domain_knowledge  → ai_inferred
      //   unknown / absent  → ai_inferred (safe default per brief)
      // `_raw_provenance` is debug-only and only emitted for unrecognised
      // upstream values (see node-side comment above). Canonical mappings are
      // recoverable from `provenance` + the mapping table.
      const rawSource: unknown = edge.provenance?.source;
      if (rawSource === 'brief_extraction') {
        e.provenance = 'from_brief';
      } else if (rawSource === 'user_specified') {
        e.provenance = 'user_set';
      } else if (rawSource === 'cee_hypothesis') {
        e.provenance = 'ai_inferred';
      } else if (rawSource === 'domain_knowledge') {
        e.provenance = 'ai_inferred';
      } else {
        e.provenance = 'ai_inferred';
        if (typeof rawSource === 'string' && rawSource.length > 0) {
          e._raw_provenance = rawSource; // unrecognised value — preserved for debug
        }
      }

      return e;
    })
    .sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      return a.to.localeCompare(b.to);
    });

  return {
    nodes,
    edges,
    _node_count: nodes.length,
    _edge_count: edges.length,
  };
}
