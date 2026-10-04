import type { RunDelta } from '@talchain/schemas/boundary';
import { loadScenarioAnalysisFactsForRead, deriveDecisionContextGraphHash } from '../build-turn-context.js';
import { selectTwoNewestRunAnalysisFacts } from '../coaching/compare-runs.js';
import { validateAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import { projectModelFacingRunDelta } from '../context/model-facing-run-delta.js';
import type { ContextPackRunDelta } from '../context/context-pack-schema.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { getModelManagementService } from '../model-management/index.js';
import { bindVersionResults, boundRunLeaderLicence } from '../model-management/version-result-binding.js';
import type { SavedRunContextFactsRead } from './saved-run-context-facts.js';

/** Read evidence for the existing selected pair; no calculation or mutation of the UI delta. */
export async function selectedRunDeltaForModel(
  scenarioId: string,
  read: SavedRunContextFactsRead & { readonly analysis_admission?: unknown },
  delta: RunDelta | undefined,
): Promise<ContextPackRunDelta | undefined> {
  if (delta === undefined || leaderLicenceFromState(read.analysis_state,
    { analysis_admission: read.analysis_admission }) === 'withheld') return undefined;
  try {
    const { factSet } = await loadScenarioAnalysisFactsForRead(scenarioId, 'selected_run_delta_context');
    // Incomplete history cannot establish this pair's selected executions.
    if (factSet.status !== 'complete') return undefined;
    const pair = selectTwoNewestRunAnalysisFacts(factSet.facts);
    if (pair === null || delta.endpoints === undefined) return undefined;
    const runs = [pair.prior, pair.current].map(fact => {
      const result = fact.result as Record<string, unknown>;
      const checked = validateAnalysisRunFactIdentity(result);
      return checked.status === 'confirmed' && checked.identity.scenario_id === scenarioId
        && typeof result.run_id === 'string'
        ? { fact, identity: { ...checked.identity, run_id: result.run_id } } : undefined;
    });
    const [prior, current] = runs;
    if (prior === undefined || current === undefined) return undefined;
    const state = read.analysis_state as { run_state?: { kind?: unknown; computed_at?: unknown } } | undefined;
    const result = read.analysis_result as { computed_against_hash?: unknown } | undefined;
    if (state?.run_state?.kind !== 'complete_current'
      || current.identity.computed_at !== state.run_state.computed_at
      || current.identity.graph_hash_at_run !== result?.computed_against_hash
      || delta.endpoints.prior.run_id !== prior.identity.run_id
      || delta.endpoints.current.run_id !== current.identity.run_id
      || delta.endpoints.prior.computed_at !== prior.identity.computed_at
      || delta.endpoints.current.computed_at !== current.identity.computed_at) return undefined;

    for (const run of [prior, current]) {
      // Prior admission reads its saved version even on the same analysis hash: authorship can change admission.
      let graph = run === current && deriveDecisionContextGraphHash(read.raw) === run.identity.graph_hash_at_run ? read.raw : undefined;
      if (graph === undefined) {
        // Historical admission and limits belong to the saved graph, never today's graph.
        const service = getModelManagementService();
        const versions = await service.listVersions(scenarioId);
        if (versions.status !== 'ok') return undefined;
        for (const summary of versions.value) {
          const version = await service.getVersion(scenarioId, summary.id);
          if (version.status !== 'ok') continue;
          const bound = bindVersionResults({ scenarioId, from: version.value, to: version.value,
            factSet: { ...factSet, facts: [run.fact], total_count: 1 } });
          if (bound.kind === 'shared' && bound.recordedRun.run_id === run.identity.run_id) {
            // Ambiguous versions can only narrow, never let a permissive graph substitute for a withheld one.
            if (boundRunLeaderLicence(run, version.value) !== 'permitted') return undefined;
            graph = version.value.graph;
          }
        }
      }
      // The existing version comparison's complete canonical composition, including separation/limits/admission.
      // The delta has no caveat carrier, so a provisional endpoint cannot supply plain comparison claims.
      if (graph === undefined || boundRunLeaderLicence(run, { scenario_id: scenarioId, graph }) !== 'permitted') return undefined;
    }
    return projectModelFacingRunDelta(delta);
  } catch {
    return undefined;
  }
}
