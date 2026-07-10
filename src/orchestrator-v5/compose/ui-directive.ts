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
 *   - recommended id unresolvable in `enrichment.graph.nodes[]` — the
 *     Phase-3 §0.1 invariant applies: NEVER fall back to id-as-label;
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

import { buildGraphNodeLookup } from './phase3-blocks.js';

/**
 * Build the single recommended-option `ui_directive` block for a
 * current-turn run_analysis fact, or null when any fail-closed condition
 * holds. Deterministic: no LLM input, no clock, no randomness.
 */
export function buildRecommendedOptionUiDirective(
  fact: RunAnalysisHandlerFact,
): UiDirectiveBlock | null {
  if (fact.noop) return null;

  const leadingOptionId = fact.result.leading_option_id;
  if (typeof leadingOptionId !== 'string' || leadingOptionId.length === 0) {
    return null;
  }

  const ref = buildGraphNodeLookup(fact).get(leadingOptionId);
  if (ref === undefined || ref.kind !== 'option') return null;

  const candidate: UiDirectiveBlock = {
    type: 'ui_directive',
    verb: 'highlight',
    targets: [{ id: ref.id, label: ref.label, kind: 'option' }],
  };

  const parsed = UiDirectiveBlockSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
