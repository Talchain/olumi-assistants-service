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

import {
  resolveLabel as resolveLabelFromGraph,
  ENTITY_ID_LEAK_RE,
} from '../../orchestrator/shared/entity-id-pattern.js';
import {
  genericFallbackForId,
  isSlugShapedEntityId,
} from '../../orchestrator/shared/output-safety.js';
import type { GraphV3T } from '../../orchestrator/types.js';

/**
 * Unsafe-label predicate. A label is unsafe if it equals the lookup id
 * (upstream stored the raw id in the label slot) OR contains a
 * **slug-shaped** entity-ID-confirmed token within it. Slug-shape
 * confirmation reuses the existing
 * `src/orchestrator/shared/output-safety.ts:isSlugShapedEntityId`
 * heuristic so we don't reject legitimate English compounds like
 * `Risk-Adjusted Return`, `Out-of-Scope Initiatives`, `Goal-Setting
 * Framework`, `Factor Analysis Methodology`, or `Constraint-Based
 * Decision` (all of which match `ENTITY_ID_LEAK_RE` superficially but
 * fail the slug-shape gate).
 *
 * The check operates per ENTITY_ID_LEAK_RE substring match: the label
 * is unsafe if ANY confirmed-slug substring is found. This way:
 *   - `"opt_hire_local"` (label === id)                 → unsafe.
 *   - `"See fac_churn_rate"` (slug-shaped substring)    → unsafe.
 *   - `"Risk-Adjusted Return"` (no slug-shape match)    → SAFE.
 *   - `"Goal-Setting Framework"` (no slug-shape match)  → SAFE.
 *   - `"opt_42"` (digit forces slug-shape true)         → unsafe.
 *
 * Codex review 2026-04-30 finding #3 (P3): the previous check rejected
 * any `ENTITY_ID_LEAK_RE` match, which over-rejected legitimate English
 * compound labels.
 */
// `^prefix[_:-]suffix$` shape — the entire string is a slug, with no
// surrounding English structure (spaces, capitalisation breaks). Labels
// in this codebase are human prose ("Hire Two Senior Engineers Locally",
// "Hiring and Staffing Cost"); a label that IS a slug is a leak even when
// the slug-shape gate would classify it as an English compound on
// suffix-shape grounds. Catches single-segment ids like
// `goal_profitability` and `dec_q3_target` that the broader heuristic
// rejects because their suffix is one word.
const WHOLE_LABEL_SLUG_RE =
  /^(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-][a-z0-9_:-]+$/i;

/**
 * Decide whether a label returned from a label lookup is itself a leaked
 * entity ID and must be rejected.
 *
 * Two-tier gate:
 *   1. Strict whole-label slug check — if the entire label string is a
 *      slug-shaped token (matches `^prefix[_:-]suffix$`), it's a leak,
 *      regardless of suffix shape. Catches `goal_profitability`,
 *      `dec_q3_target`, `risk_5`, etc. that look like real labels but are
 *      slug-formatted.
 *   2. Substring scan with confirmation — for each ENTITY_ID_LEAK_RE
 *      match in the label, apply the slug-shape confirmation gate. This
 *      preserves legitimate English compound labels like
 *      `Risk-Adjusted Return`, `Out-of-Scope Initiatives`, and
 *      `Goal-Setting Framework`.
 *
 * Codex review 2026-04-30 finding #3 (P3): the original implementation
 * used only tier 2 and missed `goal_profitability` (single-segment after
 * `goal_` falls through the slug-shape gate). The whole-label slug check
 * (tier 1) closes that gap without breaking the documented English-
 * compound false-positive cases — those have spaces and capitals so they
 * cannot match `^...$`.
 */
export function isUnsafeLabel(label: string, lookupId: string): boolean {
  if (label === lookupId) return true;

  // Tier 1: whole-label slug shape — fires when the label is itself a
  // bare slug (no English structure breaking the start-to-end match).
  if (WHOLE_LABEL_SLUG_RE.test(label)) return true;

  // Tier 2: substring scan with slug-shape confirmation. Walks every
  // ENTITY_ID_LEAK_RE match in the label; rejects if any passes the
  // graph-free slug-shape gate. The source regex is non-global by
  // contract — see entity-id-pattern.ts:9-14. Build a per-call global
  // matcher.
  const global = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = global.exec(label)) !== null) {
    if (isSlugShapedEntityId(m[0])) return true;
    // Defensive: zero-width match guard.
    if (m.index === global.lastIndex) global.lastIndex++;
  }
  return false;
}

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
    if (fromGraph !== null && !isUnsafeLabel(fromGraph, id)) return fromGraph;
  }

  // Priority 2: analysis_ready.options (option_id keyed)
  const arOptions = ctx.analysisReady?.options;
  if (Array.isArray(arOptions)) {
    for (const o of arOptions) {
      const oid = o?.option_id ?? o?.id;
      if (oid === id && typeof o?.label === 'string' && o.label.length > 0) {
        if (isUnsafeLabel(o.label, id)) continue;
        return o.label;
      }
    }
  }

  // Priority 3: enrichment.option_comparison (id keyed)
  const oc = ctx.enrichment?.option_comparison;
  if (Array.isArray(oc)) {
    for (const o of oc) {
      if (o?.id === id && typeof o?.label === 'string' && o.label.length > 0) {
        if (isUnsafeLabel(o.label, id)) continue;
        return o.label;
      }
    }
  }

  // Priority 4: enrichment.payloads.isl_request.options (ISL echo)
  const islOptions = ctx.enrichment?.payloads?.isl_request?.options;
  if (Array.isArray(islOptions)) {
    for (const o of islOptions) {
      if (o?.id === id && typeof o?.label === 'string' && o.label.length > 0) {
        if (isUnsafeLabel(o.label, id)) continue;
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
