/**
 * Analysis freshness hashing.
 *
 * Produces a deterministic hash of the graph fields that materially affect
 * the outcome of run_analysis. Used by session-state to gate rehydration of
 * a cached analysis envelope: if the current graph hash differs from the
 * one that produced the cached envelope, the cache is stale and must not
 * be rehydrated.
 *
 * Canonical inputs: node {id, kind, observed_state.value, observed_state.unit},
 * edge {from, to, kind, strength.mean, strength.std}. Sorted before hashing
 * so reorderings in the source graph do not invalidate the cache.
 *
 * Labels are excluded: a pure rename does not change analysis outcomes.
 * Timestamps, scenario_ids, and UI fields are excluded by construction.
 */

import { createHash } from "node:crypto";
import { stableStringify } from "../context/stable-stringify.js";
import type { GraphV3T } from "../../schemas/cee-v3.js";

/**
 * Evaluate-intent signals used to gate analysis-state rehydration.
 *
 * Any one of the following is sufficient:
 *   - framing.stage === 'evaluate' (UI-declared stage on the request)
 *   - message matches evaluate-intent keywords (results/explain/driver/
 *     which option/why/compare/winner/leading)
 *   - system_event.event_type === 'direct_analysis_run' (fresh analysis
 *     coming through, rehydration may supply cached envelope until the
 *     fresh one lands)
 */
export const EVAL_INTENT_RE =
  /\b(results?|explain|which option|why does|how confident|what.?driv|compare|stronger|winner|leading)\b/i;

export interface RehydrationGateInput {
  message?: string | null;
  framingStage?: string | null;
  systemEventType?: string | null;
}

export function isRehydrationInScope(input: RehydrationGateInput): boolean {
  if (input.framingStage === 'evaluate') return true;
  if (input.systemEventType === 'direct_analysis_run') return true;
  if (typeof input.message === 'string' && EVAL_INTENT_RE.test(input.message)) return true;
  return false;
}

/**
 * Hash version sentinel. Bump whenever the canonicalisation changes; cached
 * envelopes hashed with an older version will silently mismatch, which is
 * the desired behaviour (old cache treated as stale).
 */
const HASH_VERSION = 2;

/**
 * Fields included in the hash (analysis-material only):
 *   Nodes: id, kind, observed_state.value, observed_state.unit, category,
 *          exists_probability, target_value (goal), factor_type, cap
 *   Edges: from, to, kind, strength.mean, strength.std, effect_direction,
 *          exists_probability
 *
 * Excluded by design — these do not affect analysis outcome:
 *   Labels, aliases, provenance, explanation/rationale text, display_value,
 *   observed_state.raw_value (only value is used by inference), timestamps,
 *   validation metadata, origin, defaulted flags.
 */
export function computeAnalysisGraphHash(graph: GraphV3T | null | undefined): string | null {
  if (!graph) return null;
  const nodes = (graph.nodes ?? []).map((n) => {
    const entry: Record<string, unknown> = {
      id: n.id,
      kind: n.kind,
      value: n.observed_state?.value ?? null,
      unit: n.observed_state?.unit ?? null,
      category: (n as { category?: string }).category ?? null,
      exists_probability: (n as { exists_probability?: number }).exists_probability ?? null,
      factor_type: (n as { factor_type?: string }).factor_type ?? null,
      cap: (n as { cap?: number }).cap ?? null,
    };
    const targetValue = (n as { target_value?: unknown }).target_value;
    if (targetValue !== undefined) entry.target_value = targetValue;
    return entry;
  });
  const edges = (graph.edges ?? []).map((e) => ({
    from: e.from,
    to: e.to,
    kind: (e as { kind?: string }).kind ?? null,
    mean: (e as { strength?: { mean?: number } }).strength?.mean ?? null,
    std: (e as { strength?: { std?: number } }).strength?.std ?? null,
    effect_direction: (e as { effect_direction?: string }).effect_direction ?? null,
    exists_probability: (e as { exists_probability?: number }).exists_probability ?? null,
  }));
  nodes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  edges.sort((a, b) => {
    const f = a.from.localeCompare(b.from);
    return f !== 0 ? f : a.to.localeCompare(b.to);
  });
  return createHash('sha256')
    .update(stableStringify({ __v: HASH_VERSION, nodes, edges }))
    .digest('hex');
}
