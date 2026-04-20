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

export type CoachingSignalId =
  | 'STALE_ANALYSIS_AFTER_EDIT'
  | 'HIGH_SENSITIVITY_EDIT'
  | 'FIRST_ANALYSIS_COMPLETE';

export interface DraftCoaching {
  readonly scenario_id: string;
  readonly produced_at: string;
  readonly summary: string | null;
  readonly strengthen_items: readonly StrengthenItem[];
  readonly widening_log: readonly unknown[] | null;
  readonly bias_signals: readonly unknown[] | null;
}

export interface DecisionReviewOutput {
  readonly produced_at: string;
  readonly narrative_summary: string | null;
  readonly story_headlines: readonly string[] | null;
  readonly robustness_explanation: string | null;
  readonly readiness_rationale: string | null;
  readonly evidence_enhancements: readonly unknown[] | null;
  readonly bias_findings: readonly unknown[] | null;
  readonly key_assumptions: readonly string[] | null;
  readonly decision_quality_prompts: readonly string[] | null;
  readonly pre_mortem: unknown | null;
  readonly flip_thresholds: unknown | null;
  readonly scenario_contexts: unknown | null;
  readonly framing_check: unknown | null;
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
