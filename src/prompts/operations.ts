/**
 * LLM operation → CEE prompt task map.
 *
 * Extracted from `src/adapters/llm/prompt-loader.ts` (which still owns
 * resolution) so that the prompt ESTATE registry (`src/prompts/estate.ts`)
 * can derive from it without an import cycle:
 *
 *   operations.ts (leaf)
 *     ← estate.ts        (derives live / gated / retired)
 *       ← tracked.ts     (derives the critical-key surface)
 *         ← adapters/llm/prompt-loader.ts (resolution)
 *
 * Before the extraction, `estate.ts` would have had to import prompt-loader,
 * which imports tracked.ts — a cycle whose top-level `Object.values(...)`
 * would have hit a TDZ error at module init.
 *
 * WHY THIS MAP IS THE DERIVATION BASE. A prompt task is unreachable through
 * `getSystemPrompt()` unless it has a row here (`Unknown LLM operation` is
 * thrown otherwise). So "has a row here" is the honest, load-bearing
 * definition of "the code can resolve this prompt" — and a new prompt CANNOT
 * be wired up without landing in this map. That is what lets the estate
 * default a newly-wired prompt to `live` instead of requiring a human to
 * remember to add it to an observability allowlist.
 *
 * Content is byte-identical to the map it replaced; only its home moved.
 */

import type { CeeTaskId } from './schema.js';

const OPERATIONS = {
  draft_graph: 'draft_graph',
  suggest_options: 'suggest_options',
  repair_graph: 'repair_graph',
  clarify_brief: 'clarify_brief',
  critique_graph: 'critique_graph',
  explainer: 'explainer',   // DEPRECATED: no callers — see defaults.ts
  bias_check: 'bias_check', // DEPRECATED: no callers — see defaults.ts
  decision_review: 'decision_review',
  edit_graph: 'edit_graph',
  repair_edit_graph: 'repair_edit_graph',
  orchestrator: 'orchestrator',
  validate_graph: 'validate_graph',
  // V5 slice A1 — narrate-mode operation on /orchestrate/v2/turn.
  direct_answer_narrate: 'direct_answer_narrate',
  // V5 slice A2 — pre-narrate turn classifier.
  turn_classifier: 'turn_classifier',
  // V5 slices C2 + D1 + D2 (Phase 0 wiring). Operation keys match the V4
  // action_type literals verified in the phase-0 Supabase audit §6 mapping
  // table. Handler modules that consume these prompts do not land until the
  // tranche commits; the loader wiring is complete now so future dispatch
  // can resolve without further Phase 0 touches.
  run_analysis_narrate: 'run_analysis_narrate',
  set_factor_value_narrate: 'set_factor_value_narrate',
  add_constraint_narrate: 'add_constraint_narrate',
  adjust_edge_strength_narrate: 'adjust_edge_strength_narrate',
  explain_result_narrate: 'explain_result_narrate',
  compare_options_narrate: 'compare_options_narrate',
  what_would_flip_narrate: 'what_would_flip_narrate',
  // V6 dual-draft M2 graph review (fail-closed sentinel default; see
  // src/cee/dual-draft/prompt-sentinel.ts and src/prompts/defaults.ts).
  m2_graph_review: 'm2_graph_review',
  // Note: isl_synthesis is NOT here - it's deterministic (template-based, no LLM calls)
} as const satisfies Record<string, CeeTaskId>;

/**
 * Map of LLM operation names to CEE task IDs.
 *
 * Exported with the same widened `Record<string, CeeTaskId>` type the loader
 * has always used, so `OPERATION_TO_TASK_ID[operation]` on an arbitrary
 * string still narrows to `CeeTaskId | undefined` at the call sites.
 */
export const OPERATION_TO_TASK_ID: Record<string, CeeTaskId> = OPERATIONS;

/** Literal union of every task id reachable through an LLM operation. */
export type OperationTask = (typeof OPERATIONS)[keyof typeof OPERATIONS];

/**
 * Every task id reachable through an LLM operation, de-duplicated, in map
 * order. Runtime counterpart of `OperationTask` — the estate derives from it.
 */
export const OPERATION_TASK_IDS: readonly OperationTask[] = Object.freeze([
  ...new Set(Object.values(OPERATIONS)),
]) as readonly OperationTask[];
