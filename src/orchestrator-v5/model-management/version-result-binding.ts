import { RunInputSnapshotSchema, type HandlerFact, type RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeGraphIdentityHash, computeAnalysisAffectingHashRecord,
  computeVersionAnalysisAffectingHashRecord, matchesHistoricalAnalysisIdentity,
  matchesHistoricalRunAnalysisIdentity, RUN_ANALYSIS_PROJECTION_KEY,
  ANALYSIS_PROJECTION_VERSION } from '../context/graph-identity.js';
import { validateAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import { compareRunGoalUnitSnapshot, isSuccessfulRunAnalysisFact } from '../context/freshness.js';
import { selectCanonicalAnalysisState } from '../context/canonical-analysis-state.js';
import { composeAnalysisStateV1 } from '../compose/analysis-state-v1.js';
import { leaderLicenceFromState, type LeaderLicence } from '../compose/leader-licence.js';
import { leaderWithheldOnlyBecauseUnrequested, mayPresentLeaderClaimForFact,
  wasAnalysisRequestedByUser } from '../compose/unrequested-analysis-confinement.js';
import { pickLatestRawRobustness } from '../coaching/pick-raw-robustness.js';
import { nonlinearIdentityLeaderClaimCause, nodesUnderANonlinearIdentity } from '../agent-lane/admit-model.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { deriveEveryOptionLimitVerdict, leaderWithheldWithoutConstraintCause,
  readRatifiedConstraints } from '../../orchestrator/context/constraint-feasibility.js';
import type { ScenarioAnalysisFactSet } from '../context/reconcile-scenario-analysis-facts.js';
import type { SelectedRunIdentity, SelectedRunPair } from '../coaching/build-run-delta.js';
import type { ModelVersionRecord } from './types.js';

type UnavailableReason = 'missing_run' | 'unconfirmed_identity' | 'incompatible_results';
interface BoundRun {
  readonly identity: SelectedRunIdentity;
  readonly fact: HandlerFact;
  readonly snapshot: RunInputSnapshot;
}
export type VersionResultBinding =
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason }
  | { readonly kind: 'shared'; readonly recordedRun: SelectedRunIdentity }
  | { readonly kind: 'paired'; readonly selectedPair: SelectedRunPair;
      readonly facts: readonly HandlerFact[]; readonly mayNameLeadingOption: boolean;
      readonly leaderLicences: { readonly prior: LeaderLicence; readonly current: LeaderLicence } };

const unavailable = (reason: UnavailableReason) => ({ kind: 'unavailable', reason } as const);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function bind(version: ModelVersionRecord, facts: readonly HandlerFact[]): BoundRun | { reason: UnavailableReason } {
  const parsed = GraphStateIngressSchema.safeParse(version.graph);
  if (!parsed.success) return { reason: 'unconfirmed_identity' };
  const full = computeGraphIdentityHash(version.graph as typeof parsed.data);
  const analysis = computeVersionAnalysisAffectingHashRecord(version.graph as typeof parsed.data);
  const runHash = computeAnalysisAffectingHashRecord(version.graph as typeof parsed.data);
  if (full === null || analysis === null || runHash === null
    || full.value !== version.graph_identity_hash || !matchesHistoricalAnalysisIdentity(version.graph as typeof parsed.data, version.analysis_affecting_hash)
    || full.algorithm !== version.hash_algorithm || full.projection_version !== version.identity_projection_version
    || full.normaliser_version !== version.identity_normaliser_version || full.graph_schema_version !== version.graph_schema_version) {
    return { reason: 'unconfirmed_identity' };
  }
  const candidates: BoundRun[] = [];
  let refusal: UnavailableReason = 'missing_run';
  for (const fact of facts) {
    if (!isSuccessfulRunAnalysisFact(fact)) continue;
    const result = record((fact as { result?: unknown }).result);
    const checked = validateAnalysisRunFactIdentity(result);
    if (checked.status !== 'confirmed') { refusal = 'unconfirmed_identity'; continue; }
    const projection = record(result?.enrichment)?.[RUN_ANALYSIS_PROJECTION_KEY];
    if (projection !== undefined && projection !== ANALYSIS_PROJECTION_VERSION) {
      refusal = 'unconfirmed_identity'; continue;
    }
    const runId = result?.run_id;
    const snapshot = RunInputSnapshotSchema.safeParse(result?.input_snapshot);
    if (checked.identity.scenario_id !== version.scenario_id || typeof runId !== 'string'
      || runId.length === 0 || runId.length > 200 || runId.trim() !== runId || !snapshot.success) {
      refusal = 'unconfirmed_identity'; continue;
    }
    if (!matchesHistoricalRunAnalysisIdentity(version.graph as typeof parsed.data,
      checked.identity.graph_hash_at_run, projection, result?.input_snapshot)) continue;
    // A confirmed immutable snapshot is historical identity, not current
    // freshness. Reuse only the Run-attested goal-unit check, including
    // goal-free work; never bypass the legacy guard on a live current graph.
    const goalBinding = compareRunGoalUnitSnapshot(fact, version.graph);
    if (goalBinding === 'unit_changed' || goalBinding === 'unverified') { refusal = 'incompatible_results'; continue; }
    candidates.push({ identity: { ...checked.identity, run_id: runId }, fact, snapshot: snapshot.data });
  }
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  candidates.sort((a, b) => compare(b.identity.computed_at, a.identity.computed_at)
    || compare(a.identity.run_id, b.identity.run_id));
  const selected = candidates[0];
  if (selected === undefined) return { reason: refusal };
  const duplicate = candidates.find((candidate, i) => i > 0 && candidate.identity.run_id === selected.identity.run_id);
  return duplicate === undefined ? selected : { reason: 'unconfirmed_identity' };
}

/** Compose the canonical claim and licence for this Run on the version it analysed. */
export function boundRunLeaderLicence(run: Pick<BoundRun, 'fact' | 'identity'>, version: Pick<ModelVersionRecord, 'graph' | 'scenario_id'>): LeaderLicence {
  const fact = run.fact;
  if (fact.fact_type !== 'run_analysis') return 'withheld';
  const facts = [fact];
  const graph = version.graph;
  const graphHash = run.identity.graph_hash_at_run;
  const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
  const identityCause = nonlinearIdentityLeaderClaimCause({ graph, graphHash,
    result: fact.result, requested: wasAnalysisRequestedByUser(fact) });
  const distrusted = nodesUnderANonlinearIdentity(graph);
  const limit = deriveEveryOptionLimitVerdict(fact.result,
    readRatifiedConstraints(graph).filter((c) => c.node_id == null || !distrusted.has(c.node_id)));
  const state = composeAnalysisStateV1({
    canonical: selectCanonicalAnalysisState({ priorFacts: facts, currentGraphHash: graphHash,
      currentGraph: graph, readiness, priorFactsReadOk: true }),
    readiness,
    runFactBinding: { scenarioId: version.scenario_id, selectedResult: fact.result },
    mayNameLeadingOption: mayPresentLeaderClaimForFact(fact),
    withheldBecauseUnrequested: leaderWithheldOnlyBecauseUnrequested(fact)
      || identityCause?.withheldBecauseUnrequested === true,
    withheldBecauseNonlinearIdentity: identityCause?.withheldBecauseNonlinearIdentity === true,
    withheldWithoutConstraintCause: leaderWithheldWithoutConstraintCause(fact.result),
    ...(limit === null ? {} : { everyOptionLimit: limit.kind }),
    rawRobustness: pickLatestRawRobustness(facts),
  });
  return leaderLicenceFromState(state, readiness);
}

/** Pure binding only; the compare route calls the existing delta builder for this pair. */
export function bindVersionResults(input: {
  readonly scenarioId: string;
  readonly from: ModelVersionRecord;
  readonly to: ModelVersionRecord;
  readonly factSet: ScenarioAnalysisFactSet;
}): VersionResultBinding {
  if (input.from.scenario_id !== input.scenarioId || input.to.scenario_id !== input.scenarioId
    || input.factSet.status !== 'complete') return unavailable('unconfirmed_identity');
  // A capped/degraded page cannot establish the latest matching result in the whole record.
  const prior = bind(input.from, input.factSet.facts);
  const current = bind(input.to, input.factSet.facts);
  if ('reason' in prior) return unavailable(prior.reason);
  if ('reason' in current) return unavailable(current.reason);
  const a = prior.snapshot.goal; const b = current.snapshot.goal;
  if (a?.node_id !== b?.node_id || a?.unit !== b?.unit || a?.direction !== b?.direction || a?.operator !== b?.operator) {
    return unavailable('incompatible_results');
  }
  if (prior.identity.run_id === current.identity.run_id) {
    return prior.identity.graph_hash_at_run === current.identity.graph_hash_at_run
      && prior.identity.computed_at === current.identity.computed_at
      ? { kind: 'shared', recordedRun: prior.identity } : unavailable('unconfirmed_identity');
  }
  const leaderLicences = { prior: boundRunLeaderLicence(prior, input.from),
    current: boundRunLeaderLicence(current, input.to) };
  return {
    kind: 'paired', selectedPair: { prior: prior.identity, current: current.identity },
    facts: [prior.fact, current.fact],
    // The existing builder's shared turn permission also confines figures by arithmetic.
    // Both canonical permissions include the limit, separation and comparative admission gates.
    // The delta has no caveat carrier: both bound Runs must permit plain naming.
    mayNameLeadingOption: leaderLicences.prior === 'permitted' && leaderLicences.current === 'permitted',
    leaderLicences,
  };
}
