/**
 * Shared coaching cache types for V5 Group 1.
 *
 * One persisted shape covers:
 *   - draft_coaching: outputs from a prior draft_graph turn (summary,
 *     strengthen_items, widening_log, bias_signals). Pass-through of the
 *     LLM shape; F.6 leaves transformation to CEE, not V5.
 *   - decision_review: output from the auto-fired decision_review call after
 *     a successful run_analysis. Stored under
 *     RunAnalysisHandlerFact.result.enrichment.decision_review, which is a
 *     Record<string, unknown> passthrough so no schemas change is needed.
 *   - last_coaching_signal: most recent Step 5 emission, derived by scanning
 *     prior handler facts for enrichment.coaching_signal_id.
 *
 * draft_coaching.bias_signals is always namespaced under draft_coaching to
 * avoid collision with the deterministic CEE preflight bias_signals at
 * src/cee/signals/brief-signals.ts. The two fields are different payloads
 * with different shapes; they do not interfere.
 */

import type { StrengthenItem } from '../../orchestrator/tools/draft-graph.js';

export type { StrengthenItem };

/**
 * Single source of truth for the coaching-signal vocabulary. The
 * `CoachingSignalId` union DERIVES from this array, and the runtime
 * `isCoachingSignalId` guard below derives from the same array — so a new
 * signal added here is automatically accepted by every consumer, and the
 * `COACHING_TEXT` bank in `signals/coaching-signals.ts` (typed
 * `Record<CoachingSignalId, ...>`) fails to compile until it carries the
 * new entry. This replaces the previous hand-listed guard in
 * `coaching-cache-reader.ts`, which silently dropped any signal id it had
 * not been manually taught (trap-12: the hand-maintained mirror).
 */
export const COACHING_SIGNAL_IDS = [
  'STALE_ANALYSIS_AFTER_EDIT',
  'HIGH_SENSITIVITY_EDIT',
  'FIRST_ANALYSIS_COMPLETE',
  'RERUN_ANALYSIS_COMPLETE',
] as const;

export type CoachingSignalId = (typeof COACHING_SIGNAL_IDS)[number];

/**
 * Runtime guard derived from `COACHING_SIGNAL_IDS` — cannot drift from the
 * union because both share the one array above.
 */
export function isCoachingSignalId(value: unknown): value is CoachingSignalId {
  return (
    typeof value === 'string' &&
    (COACHING_SIGNAL_IDS as readonly string[]).includes(value)
  );
}

export interface DraftCoaching {
  readonly scenario_id: string;
  readonly produced_at: string;
  readonly summary: string | null;
  readonly strengthen_items: readonly StrengthenItem[];
  // v0.11.0 schema amendment: widening_log shape migrated from
  // `unknown[]` (legacy {node_id,label,reason} entries) to canonical
  // `WideningLog` object. Stored as `unknown` to tolerate both shapes
  // through the v192b → v194 transition; the JSONL cache is shape-
  // agnostic passthrough.
  readonly widening_log: unknown;
  readonly bias_signals: readonly unknown[] | null;
}

/**
 * decision_review LLM output, stored verbatim under
 * RunAnalysisHandlerFact.result.enrichment.decision_review. F.6: V5 preserves
 * and passes through; no semantic reshaping. `produced_at` is the only
 * V5-added field (ISO timestamp recorded at attach time). Every other key
 * the LLM emitted (narrative_summary, story_headlines, robustness_explanation,
 * readiness_rationale, evidence_enhancements, bias_findings, key_assumptions,
 * decision_quality_prompts, pre_mortem, flip_thresholds, scenario_contexts,
 * framing_check, and any future fields) is passed through with its original
 * shape. UI and coaching-cache consumers read required fields defensively.
 */
export interface DecisionReviewOutput {
  readonly produced_at: string;
  readonly [key: string]: unknown;
}

export interface LastCoachingSignal {
  readonly signal_id: CoachingSignalId;
  readonly turn_id: string;
  readonly produced_at: string;
}

export interface CoachingCache {
  readonly draft_coaching: DraftCoaching | null;
  readonly decision_review: DecisionReviewOutput | null;
  readonly last_coaching_signal: LastCoachingSignal | null;
}

export const EMPTY_COACHING_CACHE: CoachingCache = Object.freeze({
  draft_coaching: null,
  decision_review: null,
  last_coaching_signal: null,
});
