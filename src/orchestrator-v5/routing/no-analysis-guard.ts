/**
 * V5 Context Management v1 — no-analysis sibling guard.
 *
 * Short-circuits the case where the user is asking an analytical
 * question but no successful run_analysis fact has ever landed for
 * the scenario. Closes the misroute class where "walk me through the
 * analysis" lands on edit_graph and produces a no-op denial because
 * Sonnet has nothing analytical to ground a reply.
 *
 * Predicate:
 *   - `readiness.has_run_analysis_fact === false` AND
 *   - `readiness.latest_analysis_freshness === 'none'` AND
 *   - `classifyAnalyticalIntent(message) !== null` AND
 *   - `hasMutationSignal(message) === false`
 *
 * Response copy is calm and direct: ask the user to run analysis. A
 * `run_analysis` suggested action is offered when the graph is ready
 * (at least one node + edge). When the graph is not ready, the copy
 * acknowledges that ordering and offers no chip.
 */

import {
  classifyAnalyticalIntent,
  hasMutationSignal,
  type AnalyticalIntentClass,
} from './analytical-intent.js';
import type { ContextReadiness } from '../context/readiness.js';

export interface NoAnalysisSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: 'run_analysis';
}

export interface NoAnalysisGuardInput {
  readonly message: string;
  readonly readiness: ContextReadiness;
}

export type NoAnalysisUnmatchedReason =
  | 'analysis_present'
  | 'mutation_signal'
  | 'no_analytical_signal'
  | 'empty_message';

export type NoAnalysisGuardResult =
  | {
      readonly matched: true;
      readonly intent_class: AnalyticalIntentClass;
      readonly graph_ready: boolean;
      readonly assistant_text: string;
      readonly suggested_actions: readonly NoAnalysisSuggestedAction[];
    }
  | {
      readonly matched: false;
      readonly reason: NoAnalysisUnmatchedReason;
    };

const RUN_ANALYSIS_ACTION: NoAnalysisSuggestedAction = Object.freeze({
  id: 'chip_action_run_analysis',
  label: 'Run analysis',
  message: 'Run analysis.',
  action_type: 'run_analysis' as const,
});

const GRAPH_READY_TEXT =
  "Run analysis first and I'll walk you through the result.";

const GRAPH_NOT_READY_TEXT =
  "Once the model is ready, run analysis and I'll explain what drove the outcome.";

export function tryNoAnalysisGuard(
  input: NoAnalysisGuardInput,
): NoAnalysisGuardResult {
  if (
    input.readiness.has_run_analysis_fact
    || input.readiness.latest_analysis_freshness !== 'none'
  ) {
    return { matched: false, reason: 'analysis_present' };
  }
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }
  if (hasMutationSignal(message)) {
    return { matched: false, reason: 'mutation_signal' };
  }
  const cls = classifyAnalyticalIntent(message);
  if (cls === null) {
    return { matched: false, reason: 'no_analytical_signal' };
  }

  const graphReady =
    input.readiness.graph_present
    && input.readiness.graph_node_count > 0
    && input.readiness.graph_edge_count > 0;

  return {
    matched: true,
    intent_class: cls,
    graph_ready: graphReady,
    assistant_text: graphReady ? GRAPH_READY_TEXT : GRAPH_NOT_READY_TEXT,
    suggested_actions: graphReady ? [RUN_ANALYSIS_ACTION] : [],
  };
}
