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

import { OBSERVED_STATE_SOURCE_LITERALS } from "@talchain/schemas";

import type { GraphV3T } from "../../schemas/cee-v3.js";
import { DEFAULT_EXISTS_PROBABILITY } from "./constants.js";
import { isLegalStructuralEdge } from "../../cee/utils/structural-edge-classifier.js";
import { classifyValueSource } from "../../cee/graph-readiness/obligation-provenance.js";

/**
 * The declared vocabulary for `observed_state.source`, DERIVED from the shared
 * contract rather than re-typed (CLAUDE.md trap 12). A stamp outside this set is
 * exactly the "unknown" the contract tells consumers to treat as neutral, so it
 * does not override the `extractionType` fallback below.
 */
const DECLARED_OBSERVED_STATE_SOURCES: ReadonlySet<string> = new Set(
  OBSERVED_STATE_SOURCE_LITERALS,
);

/** The four `extractionType` values the projection recognises. */
const CANONICAL_EXTRACTION_TYPES: ReadonlySet<string> = new Set([
  'explicit',
  'inferred',
  'observed',
  'range',
]);

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
}

export interface CompactEdge {
  from: string;
  to: string;
  strength: number;   // mean only
  exists: number;     // exists_probability (defaulted to DEFAULT_EXISTS_PROBABILITY if absent)
  /** Human-readable causal interpretation (causal edges only, omitted for structural/bidirected). */
  plain_interpretation?: string;
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
function buildPlainInterpretation(
  edge: GraphV3T['edges'][number],
  labelMap: Map<string, string>,
  kindMap: Map<string, string>,
): string | undefined {
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

  // Confidence from std: [0.05, 0.10) high, [0.10, 0.20) moderate, [0.20, ∞) uncertain
  let confidence: string;
  if (std >= 0.20) {
    confidence = '(uncertain)';
  } else if (std >= 0.10) {
    confidence = '(moderate confidence)';
  } else if (std >= 0.05) {
    confidence = '(high confidence)';
  } else {
    confidence = '';
  }

  const fromLabel = labelMap.get(edge.from) ?? edge.from;
  const toLabel = labelMap.get(edge.to) ?? edge.to;

  return `${fromLabel} ${magnitude} ${verb} ${toLabel}${confidence ? ' ' + confidence : ''}`;
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
 * intervention_summary (option nodes with data.interventions).
 *
 * Dropped per node: body, state_space, goal_threshold, observed_state.std,
 * observed_state.baseline, observed_state.extractionType (projected to source + provenance).
 *
 * Kept per edge: from, to, strength.mean, exists_probability (defaulted to DEFAULT_EXISTS_PROBABILITY),
 * plain_interpretation (causal edges only),
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

        // ⭐ WHO AUTHORED THIS VALUE? `observed_state.source` ANSWERS FIRST.
        //
        // ## THE DEFECT THIS REPLACES
        //
        // This derivation read `observed_state.extractionType` ONLY. Every
        // user-edit writer in the estate stamps `observed_state.source` and
        // DELIBERATELY LEAVES `extractionType` ALONE — measured at the real
        // writers, not assumed:
        //   • `canonicalise-value-ops.ts` `stampUserEditProvenance` (the chat
        //     edit path, live at `tools/edit-graph.ts:2823` and
        //     `orchestrator-v5/handlers/gm-held-execute.ts:481`) writes
        //     `{ value, source: 'user_override' }` — and the applier's
        //     whole-object replace means the drafted `extractionType` does not
        //     survive the edit at all.
        //   • `orchestrator-v5/tools/handlers/set-factor-value.ts:482` writes
        //     `source` over any producer stamp and says so at the bytes:
        //     "Overrides any producer stamp deliberately: this write IS the
        //     user's."
        // So a value the user typed arrived here with an ABSENT or stale
        // `extractionType` and fell to `system` / `ai_inferred` — the product
        // describing the user's own evidence as the model's guess. The
        // opposite inversion was live too: a `cee_inference` stamp sitting
        // beside a drafted `extractionType: 'explicit'` projected as `user` /
        // `from_brief`.
        //
        // ## WHICH INPUT WINS, AND WHY — DERIVED FROM THE WRITERS
        //
        // `source` outranks `extractionType` because `source` is the LATEST and
        // most specific statement of authorship: the edit writers set it
        // precisely and leave extraction metadata untouched. `extractionType`
        // is draft-time extraction metadata that nobody refreshes.
        //
        // ## ONE AUTHORITY, NOT A THIRD TABLE (CLAUDE.md traps 12 and 21)
        //
        // The classification comes from `classifyValueSource`
        // (`cee/graph-readiness/obligation-provenance.ts`), the estate's
        // existing authority on "who authored this value?" over the whole
        // twelve-member contract vocabulary. Nothing is re-classified here.
        // That module then answers a SECOND question on top of the class
        // ("may this gap be DEMANDED of the user?", INV-P6) which is none of
        // this file's business; this file asks only "how do I DESCRIBE the
        // authorship of this value?" — the same question, a different
        // downstream use, so the classifier is shared and the projection is
        // local. `NodeV3.provenance` is deliberately NOT consulted: the
        // contract declares it RESPONSE-ONLY and recomputed on every response
        // (`schemas/cee-v3.ts:203-208`), i.e. a display value, not a record.
        //
        // ## ABSENCE IS NOT A CLASS — SO THE FALLBACK IS BYTE-UNCHANGED
        //
        // The shared contract: "Absence means the producer stamped no
        // provenance — a consumer MUST NOT read absence as any particular
        // class; classify unknown/absent as neutral, never guess." An absent
        // or undeclared `source` therefore overrides nothing and the original
        // `extractionType` mapping below runs unmodified. Every node in the
        // pre-existing `graph-compact-provenance.test.ts` corpus is in exactly
        // that state, which is why that suite is untouched by this change.
        //
        // extractionType fallback (UNCHANGED):
        //   explicit  → user / from_brief
        //   inferred  → assumption / ai_inferred
        //   observed  → system / from_brief
        //   range     → system / ai_inferred
        //   anything else / absent → system / ai_inferred
        //
        // `_raw_provenance` is debug-only and emitted when `extractionType`
        // falls OUTSIDE the four canonical values — i.e. when something would
        // be lost by the projection. It is derived independently of which axis
        // decided the projection, so a source-stamped node does not lose the
        // diagnostic.
        const et = obsState.extractionType;
        if (
          typeof et === 'string' &&
          et.length > 0 &&
          !CANONICAL_EXTRACTION_TYPES.has(et)
        ) {
          n._raw_provenance = et; // unrecognised value — preserved for debug
        }

        const rawSource = obsState.source;
        const authored =
          typeof rawSource === 'string' && DECLARED_OBSERVED_STATE_SOURCES.has(rawSource)
            ? classifyValueSource(rawSource)
            : 'unattributed';

        if (authored === 'user_stated') {
          n.source = 'user';
          // `brief_extraction` is the one declared literal that means "the
          // value came from the brief" — the same split this file already
          // applies on the EDGE axis below (`brief_extraction → from_brief`,
          // `user_specified → user_set`). Every other user literal is the
          // user setting a value directly.
          n.provenance = rawSource === 'brief_extraction' ? 'from_brief' : 'user_set';
        } else if (authored === 'ai_drafted') {
          n.source = 'assumption';
          n.provenance = 'ai_inferred';
        } else if (authored === 'system_repaired') {
          n.source = 'system';
          n.provenance = 'ai_inferred';
        } else if (et === 'explicit') {
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
        }
      } else {
        // No observed_state — treat as system-derived / ai_inferred.
        n.source = 'system';
        n.provenance = 'ai_inferred';
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
        e.plain_interpretation = interpretation;
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
