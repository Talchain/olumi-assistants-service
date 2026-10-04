import type { RunDelta } from '@talchain/schemas/boundary';
import { loadScenarioAnalysisFactsForRead } from '../build-turn-context.js';
import { selectTwoNewestRunAnalysisFacts } from '../coaching/compare-runs.js';
import { validateAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import { projectModelFacingRunDelta } from '../context/model-facing-run-delta.js';
import type { ContextPackRunDelta } from '../context/context-pack-schema.js';
import { leaderLicenceFromState } from '../compose/leader-licence.js';
import { getModelManagementService } from '../model-management/index.js';
import { bindVersionResults, boundRunLeaderLicence } from '../model-management/version-result-binding.js';
import { MODEL_VERSION_LIST_DEFAULT_LIMIT } from '../model-management/store-adapter.js';
import { isScenarioAnalysisReasoningAuthority } from '../context/reconcile-scenario-analysis-facts.js';
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
    // The existing capped-page authority proves its newest pair, not the whole history.
    if (!isScenarioAnalysisReasoningAuthority(factSet)) return undefined;
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

    // Same analysis hash does not prove the same admission: saved authorship may differ from today's.
    // Read BOTH endpoints' recorded graphs, and exhaust history before any permissive match can license a delta.
    const service = getModelManagementService();
    const found = new Set<string>();
    const seenVersions = new Set<string>();
    let beforeSequence: number | undefined;
    while (true) {
      const versions = await service.listVersions(scenarioId, MODEL_VERSION_LIST_DEFAULT_LIMIT, beforeSequence);
      if (versions.status !== 'ok' || versions.value.length > MODEL_VERSION_LIST_DEFAULT_LIMIT) return undefined;
      let previousSequence = beforeSequence ?? Infinity;
      for (const summary of versions.value) {
        // Refuse ambiguous/non-progressing pages rather than mistaking them for complete history.
        if (summary.scenario_id !== scenarioId || typeof summary.id !== 'string' || summary.id.length === 0
          || seenVersions.has(summary.id) || !Number.isSafeInteger(summary.version_number)
          || summary.version_number < 1 || summary.version_number >= previousSequence) return undefined;
        previousSequence = summary.version_number;
        seenVersions.add(summary.id);
        const version = await service.getVersion(scenarioId, summary.id);
        // Unread candidates cannot be excluded by an analysis hash: that hash omits admission evidence.
        if (version.status !== 'ok') return undefined;
        for (const key of ['id', 'scenario_id', 'version_number', 'graph_identity_hash', 'analysis_affecting_hash',
          'hash_algorithm', 'identity_projection_version', 'identity_normaliser_version', 'graph_schema_version'] as const) {
          if (version.value[key] !== summary[key]) return undefined;
        }
        for (const run of [prior, current]) {
          const bound = bindVersionResults({ scenarioId, from: version.value, to: version.value,
            // This complete singleton binds only the already-selected exact endpoint, including on a capped page.
            // It does not assert that the scenario's history is complete or select a latest version-matching Run.
            factSet: { status: 'complete', source: 'scenario', facts: [run.fact], total_count: 1 } });
          if (bound.kind === 'unavailable' && bound.reason === 'missing_run') continue;
          // Only a validated graph with no matching Run is structurally irrelevant. All other uncertainty omits.
          if (bound.kind !== 'shared' || bound.recordedRun.run_id !== run.identity.run_id
            || bound.recordedRun.computed_at !== run.identity.computed_at
            || bound.recordedRun.graph_hash_at_run !== run.identity.graph_hash_at_run) return undefined;
          // Reuse the full canonical separation/limits/admission licence; the delta has no provisional caveat carrier.
          if (boundRunLeaderLicence(run, version.value) !== 'permitted') return undefined;
          found.add(run.identity.run_id);
        }
      }
      if (versions.value.length < MODEL_VERSION_LIST_DEFAULT_LIMIT) break;
      beforeSequence = previousSequence;
    }
    if (!found.has(prior.identity.run_id) || !found.has(current.identity.run_id)) return undefined;
    return projectModelFacingRunDelta(delta);
  } catch {
    return undefined;
  }
}
