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

// ============================================================================
// Compact Graph
// ============================================================================

/**
 * Compact a V3 graph for LLM context.
 *
 * Kept per node: id, kind, label, type (if present), category (if present),
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
