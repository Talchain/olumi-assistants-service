/**
 * V5 multi-source label resolver for enrichment-prose sanitisation.
 *
 * Wraps the four-priority lookup the analysis-enrichment fix brief
 * specifies. Every priority returns either the human label associated
 * with the given entity ID, or null. The fallback (priority 4) lives
 * in `src/orchestrator/shared/output-safety.ts:PREFIX_GENERIC` and is
 * applied by the caller — this resolver returns null when no label is
 * found in any of the live data sources, so the caller can decide
 * between the prefix-aware fallback (`"the relevant option"`) and any
 * other context-specific behaviour.
 *
 * Lookup order:
 *   1. graph.nodes[*].id            (V3 root nodes)
 *   2. analysisReady.options[*].option_id
 *   3. enrichment.option_comparison[*].id
 *   4. enrichment.payloads.isl_request.options[*].id
 *
 * Calling code that needs the prefix-aware fallback should chain via
 * `resolveLabelOrFallback` from this module. Pure function — no side
 * effects, no logging.
 */

import { resolveLabel as resolveLabelFromGraph } from '../../orchestrator/shared/entity-id-pattern.js';
import { genericFallbackForId } from '../../orchestrator/shared/output-safety.js';
import type { GraphV3T } from '../../orchestrator/types.js';

/**
 * Subset of the V3 wire shape this resolver needs. Defined as a
 * structural type so the test fixtures + the real wire envelope (which
 * carries the full `OlumiResponse` type) both satisfy it without an
 * import cycle.
 */
export interface LabelResolverContext {
  readonly graph?: GraphV3T | null;
  readonly analysisReady?: {
    readonly options?: ReadonlyArray<{
      readonly option_id?: string;
      readonly id?: string;
      readonly label?: string;
    }>;
  } | null;
  readonly enrichment?: {
    readonly option_comparison?: ReadonlyArray<{
      readonly id?: string;
      readonly label?: string;
    }>;
    readonly payloads?: {
      readonly isl_request?: {
        readonly options?: ReadonlyArray<{
          readonly id?: string;
          readonly label?: string;
        }>;
      };
    };
  } | null;
}

/**
 * Look up the human label for a given entity ID, walking the four data
 * sources in priority order. Returns the label string when found, null
 * otherwise. Caller is responsible for prefix-aware fallback if null.
 */
export function resolveLabel(id: string, ctx: LabelResolverContext): string | null {
  if (typeof id !== 'string' || id.length === 0) return null;

  // Priority 1: graph.nodes (V3 root)
  if (ctx.graph) {
    const fromGraph = resolveLabelFromGraph(ctx.graph, id);
    if (fromGraph !== null) return fromGraph;
  }

  // Priority 2: analysis_ready.options (option_id keyed)
  const arOptions = ctx.analysisReady?.options;
  if (Array.isArray(arOptions)) {
    for (const o of arOptions) {
      const oid = o?.option_id ?? o?.id;
      if (oid === id && typeof o?.label === 'string' && o.label.length > 0) {
        return o.label;
      }
    }
  }

  // Priority 3: enrichment.option_comparison (id keyed)
  const oc = ctx.enrichment?.option_comparison;
  if (Array.isArray(oc)) {
    for (const o of oc) {
      if (o?.id === id && typeof o?.label === 'string' && o.label.length > 0) {
        return o.label;
      }
    }
  }

  // Priority 4: enrichment.payloads.isl_request.options (ISL echo)
  const islOptions = ctx.enrichment?.payloads?.isl_request?.options;
  if (Array.isArray(islOptions)) {
    for (const o of islOptions) {
      if (o?.id === id && typeof o?.label === 'string' && o.label.length > 0) {
        return o.label;
      }
    }
  }

  return null;
}

/**
 * Resolve to a human label OR the prefix-aware generic fallback.
 * Never returns the raw ID. Used by the enrichment scrubber so a
 * single helper covers both the labelled case and the
 * `"the relevant option/factor/..."` fallback case.
 *
 * The fallback comes from `genericFallbackForId` in
 * `src/orchestrator/shared/output-safety.ts:PREFIX_GENERIC` so the
 * mapping stays a single source of truth across V4 and V5.
 */
export function resolveLabelOrFallback(id: string, ctx: LabelResolverContext): string {
  const label = resolveLabel(id, ctx);
  if (label !== null) return label;
  return genericFallbackForId(id);
}
