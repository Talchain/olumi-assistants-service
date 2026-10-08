import { projectCanonicalAnalysisView } from '../../../../routes/canonical-analysis-view.js';

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Rec : undefined;

/** Mirror the scenario-read wire using the same graph, state and successful Run fixture that it serves. */
export function withCanonicalAnalysisView<T extends Rec>(read: T, scenarioId: string): T & {
  canonical_analysis_view: ReturnType<typeof projectCanonicalAnalysisView>;
} {
  const result = rec(read.analysis_result);
  const state = rec(read.analysis_state);
  const runState = rec(state?.run_state);
  const canonical_analysis_view = projectCanonicalAnalysisView({
    graph: read.graph, analysisState: read.analysis_state as never, analysisReady: read.analysis_ready,
    currentResult: result as never,
    runFact: result === undefined ? null : { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
      scenario_id: scenarioId, run_id: 'fixture-read-run', summary: result.summary,
      leading_option_id: result.leading_option_id, enrichment: result.enrichment,
      graph_hash_at_run: read.graph_hash, computed_at: runState?.computed_at,
    } } as never,
  });
  return { ...read, canonical_analysis_view };
}
