/**
 * ui_directive block builder — ROADMAP 2.27 / seamlessness R4 (CEE half,
 * slice 1). Flag-gated by CEE_UI_DIRECTIVE_EMIT (config/index.ts
 * `features.uiDirectiveEmit`, default OFF); the flag is read at the single
 * call site in compose.ts::buildBlocksFromFacts — this builder is pure.
 *
 * ONE deterministic emission, ZERO LLM authorship: on a successful
 * CURRENT-TURN run_analysis fact, point the UI at the analysis's
 * recommended option with verb `highlight` and a single typed TargetRef.
 * Only schema-required fields are populated — no free-text `note` (nothing
 * for the egress scrubber to scrub; zero hallucination surface) and no
 * `duration_ms` in this slice.
 *
 * Fail-closed (returns null, never a partial block):
 *   - `noop: true` fact (analysis did not actually run);
 *   - `leading_option_id` null/absent (no recommendation);
 *   - recommended id unresolvable in `enrichment.graph.nodes[]` OR the
 *     persisted-snapshot fallback (see buildGraphNodeLookup — the live
 *     PLoT envelope carries no `graph` key, so in production the
 *     fallback is the only real source) — the Phase-3 §0.1 invariant
 *     applies: NEVER fall back to id-as-label;
 *   - recommended id resolves to a non-option node kind (defensive: a
 *     `leading_option_id` that names a factor/goal is upstream corruption,
 *     not something to point the UI at);
 *   - final safeParse against the strict boundary UiDirectiveBlockSchema
 *     fails (validate-before-emit, same discipline as phase3-blocks.ts —
 *     drop the block, never weaken the schema).
 *
 * Stale-analysis and fallback-recovery suppression live at the call site:
 * compose.ts only invokes this inside the current-turn run_analysis branch
 * with a verified `graph_hash_at_run` (the same gate the fresh Phase-3
 * blocks use); prior-fact lifecycle rebuilds and recovery composers never
 * reach this builder.
 */

import {
  UiDirectiveBlockSchema,
  type UiDirectiveBlock,
} from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import type { GraphNodeLookup } from './phase3-blocks.js';

/**
 * Build the single recommended-option `ui_directive` block for a
 * current-turn run_analysis fact, or null when any fail-closed condition
 * holds. Deterministic: no LLM input, no clock, no randomness.
 *
 * `lookup` is the graph-node lookup the compose call site already built
 * for this fact's Phase 3 blocks (review F2: one build per fact, shared
 * between the Phase 3 rebuild and this builder). It carries the
 * hash-gated persisted-snapshot fallback where the caller allowed it —
 * in production that fallback is the only source that can resolve the
 * option target, since the PLoT /v2/run envelope carries no `graph` key.
 */
export function buildRecommendedOptionUiDirective(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
): UiDirectiveBlock | null {
  if (fact.noop) return null;

  const leadingOptionId = fact.result.leading_option_id;
  if (typeof leadingOptionId !== 'string' || leadingOptionId.length === 0) {
    return null;
  }

  const ref = lookup.get(leadingOptionId);
  if (ref === undefined || ref.kind !== 'option') return null;

  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb: 'highlight',
    targets: [{ id: ref.id, label: ref.label, kind: 'option' }],
  };

  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
