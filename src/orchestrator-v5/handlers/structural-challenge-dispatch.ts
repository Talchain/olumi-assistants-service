/**
 * SCI-DEEP v1 — "Test without this link": an explicit, on-demand structural challenge of the selected Run.
 * (PTL ruling programme-docs #87/5972622586; contract @talchain/schemas 0.76.0 `StructuralChallengeResultV1`.)
 *
 * ONE RUN PATH, NOTHING PERSISTED. The alternative is computed by the ONE `run_analysis` handler on an in-memory copy of
 * the scenario snapshot with exactly one link removed: same payload builder, same PLoT call, same licences (leader
 * permission, goal certainty, goal-figure withholds). Its fact is compared and DISCARDED — this module never calls
 * `commitDirectAnswer`: no turn row, no Run fact, no scenario write, no new selected Run, no version.
 *
 * PINNED BUT UNPAIRED. The baseline's seed is sent explicitly through the existing seed authority. Removing a link
 * changes the draw structure, so equal seeds do not make the Runs a common-random-number pair: every comparison uses
 * the independent-run form (`C2_unpaired`). A completed result also proves equal sample budgets and engine builds.
 *
 * BOUND TO THE SELECTED RUN, BY EXISTING AUTHORITIES ONLY:
 *   currentness — `readScenarioAnalysis` supplies the reload/turn verdict over the canonical graph, reconciled durable
 *                 facts and restore marker; its same-read receipt proves the pinned Run is still the newest.
 *   one edit    — `diffRunInputs` over the two Runs' recorded input snapshots must contain exactly one row (this
 *                 link's `presence`), AND the recorded snapshots must be equal member by member once that one link is
 *                 removed: every other RECORDED input (options, settings, factors, goal, limits, every other link) is
 *                 unchanged; anything else is `failed: baseline_payload_mismatch`. The pair's
 *                 residual digest necessarily differs (it digests the removed link's own unrecorded members too), so
 *                 `complete` is not required — and unrecorded GRAPH members are already pinned by the hash check above.
 *   same builder — before the candidate is run, the ONE payload builder rebuilds the Run's request through the
 *                 `run_analysis` probe seam (#2522; PTL ruling §3), which returns before PLoT, and it must be the request
 *                 the Run sent (`isTheRunsPayload`, the SAME digest rule as "What would change this?"). So a change in
 *                 how CEE builds the payload since the Run is `failed: baseline_payload_mismatch`, never a comparison;
 *                 the candidate is then that same builder's output for the snapshot minus one link.
 *   late reply  — those same currentness and identity checks are repeated after the recompute; a model edited or
 *                 restored meanwhile, or a newer selected Run, is `stale`. An unreadable check is unavailable.
 * Each refusal is a typed contract status; none is turned into a figure.
 */
import { createHash } from 'node:crypto';

import {
  StructuralChallengeBaselineV1Schema,
  StructuralChallengeResultV1Schema,
  type StructuralChallengeAlternativeV1,
  type StructuralChallengeBaselineV1,
  type StructuralChallengeResultV1,
} from '@talchain/schemas';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { readScenarioAnalysis, type ScenarioAnalysisRead } from '../../routes/scenario-graph-analysis-read.js';
import { priorRunForSeed, seedHistoryFacts } from '../coaching/seed-reuse.js';
import { orderSuccessfulRunAnalysisFactsNewestFirst } from '../context/freshness.js';
import { compareAnalysisRunFactIdentity, validateAnalysisRunFactIdentity } from '../context/analysis-interpretation-identity.js';
import type { ScenarioAnalysisClaimSafetyRead } from '../context/reconcile-scenario-analysis-facts.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../run-analysis-snapshot-binding.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../tools/handler-errors.js';
import { AnalysisSnapshotDivergedError } from '../run-analysis-snapshot-binding.js';
import type { RunAnalysisProbeInput } from '../tools/handlers/run-analysis-probe.js';
import {
  createRegistry,
  getDefaultPlotClient,
  resolveHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../tools/registry.js';
import { diffRunInputs } from '../coaching/run-input-changes.js';
import {
  NOT_COMPARED,
  compareStructuralChallenge,
  type StructuralChallengeCertainty,
} from '../coaching/structural-challenge-compare.js';
import { graphWithoutLink, structuralChallengeEligibility, type ChallengeLink } from '../coaching/structural-challenge-eligibility.js';
import { isTheRunsPayload } from './decision-flip-dispatch.js';
import { PLoTTimeoutError, type PLoTClient } from '../../orchestrator/plot-client.js';
import { PERMITTED_ANALYSIS_MODES, modePermitsAtLeast } from '../admission/analysis-admission.js';
import type { ClaimPermissions } from '../agent-lane/first-analysis.js';
import { boundRunLeaderLicence } from '../model-management/version-result-binding.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { SelectedRunIdentity } from '../coaching/build-run-delta.js';
import type { LeaderLicence } from '../compose/leader-licence.js';
import type { GoalScopeClaimInput } from '../compose/goal-scope-claim-input.js';
import { log } from '../../utils/telemetry.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface DispatchStructuralChallengeParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly link: ChallengeLink;
  readonly origin: StructuralChallengeAlternativeV1['origin'];
  /** The turn's existing leader permission (Shared Data's authority); per-Run verdicts narrow it further. */
  readonly turnMayNameLeader: boolean;
  /** The turn's existing exploratory-work permission; false withholds the challenge. */
  readonly exploratoryWorkAllowed: boolean;
  readonly signal?: AbortSignal;
  /** Test seams; production omits them. */
  readonly plotClient?: PLoTClient;
  readonly scenarioReader?: ScenarioReader;
}

export type StructuralChallengeDispatchResult =
  | { readonly kind: 'no_run' }
  | { readonly kind: 'result'; readonly result: StructuralChallengeResultV1; readonly labels: ReadonlyMap<string, string>; readonly certainty?: StructuralChallengeCertainty; readonly finalRead?: StructuralChallengeFinalRead; readonly candidateLeaderLicence?: LeaderLicence; readonly baselineRunIdentity?: SelectedRunIdentity; readonly identicalArms?: boolean };

function currentFacts(context: Awaited<ReturnType<typeof buildTurnContext>>): readonly HandlerFact[] {
  const history = seedHistoryFacts({ scenarioId: context.session_id, hotWindow: context.prior_facts, durable: context.scenario_analysis_fact_set }) ?? [];
  return context.newest_analysis_fact ? [...history, context.newest_analysis_fact] : history;
}

/** The receipt and permissions MUST belong to the same canonical read. No freshness is re-derived here. */
export interface StructuralChallengeFinalRead {
  readonly read: ScenarioAnalysisRead;
  readonly currentness: (ScenarioAnalysisClaimSafetyRead & { readonly permissions?: ClaimPermissions }) | undefined;
}

/** A fresh canonical receipt for presentation: the same sanctioned reader, with the caller's retained scope. */
export async function readStructuralChallengeReceipt(params: {
  readonly scenarioId: string; readonly graph: unknown; readonly requestId: string; readonly goalScopeClaimInput: GoalScopeClaimInput;
}): Promise<StructuralChallengeFinalRead> {
  let currentness: StructuralChallengeFinalRead['currentness'];
  const read = await readScenarioAnalysis({ ...params, onCurrentnessRead: (current) => { currentness = current; } });
  return { read, currentness };
}

export type StructuralChallengePresentationPermission =
  | { readonly ok: true; readonly permissions: ClaimPermissions }
  | { readonly ok: false; readonly status: 'failed' | 'stale' | 'withheld';
      readonly reason: 'probe_unavailable' | 'model_changed_during_challenge' | 'exploratory_work_not_permitted' };

/** Consume the canonical verdict and FULL licence, bound to this challenge's baseline execution. */
export function structuralChallengePresentationPermission(
  baseline: StructuralChallengeBaselineV1, finalRead: StructuralChallengeFinalRead | undefined, baselineRunIdentity: SelectedRunIdentity | undefined,
): StructuralChallengePresentationPermission {
  const unavailable = { ok: false, status: 'failed', reason: 'probe_unavailable' } as const;
  const current = finalRead?.currentness;
  const read = finalRead?.read;
  if (!current?.readOk || current.fact === null || current.fact.fact_type !== 'run_analysis'
    || !read?.analysis_state || current.permissions === undefined || baselineRunIdentity === undefined) return unavailable;
  if (baselineRunIdentity.run_id !== baseline.run_id || baselineRunIdentity.scenario_id !== baseline.scenario_id
    || baselineRunIdentity.graph_hash_at_run !== baseline.graph_hash_at_run) return unavailable;
  const run = runResult(current.fact);
  const identity = compareAnalysisRunFactIdentity(baselineRunIdentity, run);
  if (identity.status === 'unconfirmed' || typeof run.run_id !== 'string') return unavailable;
  if (identity.status !== 'match') return { ok: false, status: 'stale', reason: 'model_changed_during_challenge' };
  if (run.run_id !== baseline.run_id || run.scenario_id !== baseline.scenario_id || run.graph_hash_at_run !== baseline.graph_hash_at_run) {
    return { ok: false, status: 'stale', reason: 'model_changed_during_challenge' };
  }
  const snapshot = RunInputSnapshotSchema.safeParse(run.input_snapshot);
  const enrichment = isRec(run.enrichment) ? run.enrichment : {};
  const meta = isRec(enrichment.meta) ? enrichment.meta : {};
  if (!snapshot.success || snapshot.data.sent_digest !== baseline.sent_digest
    || meta.seed_used !== baseline.seed_used || meta.n_samples !== baseline.n_samples) return unavailable;
  const state = read.analysis_state;
  if (state.run_state.kind === 'unknown_degraded' || state.run_state.kind === 'never_run') return unavailable;
  if (state.run_state.kind !== 'complete_current' || state.requires_rerun) {
    return { ok: false, status: 'stale', reason: 'model_changed_during_challenge' };
  }
  if (read.analysis_result === null) return unavailable;
  const permissions = current.permissions;
  const mode = PERMITTED_ANALYSIS_MODES.find((m) => m === permissions.permitted_analysis_mode);
  if (mode === undefined) return unavailable;
  if (permissions.total_goal_claims_allowed === false || !modePermitsAtLeast(mode, 'quantified_provisional')) {
    return { ok: false, status: 'withheld', reason: 'exploratory_work_not_permitted' };
  }
  return { ok: true, permissions };
}

/** Consume the sanctioned non-turn reader; identity receipt and verdict come from ONE canonical read. */
async function canonicalPinnedFreshness(
  pinned: HandlerFact, snapshot: RunAnalysisScenarioSnapshot, scenarioId: string, requestId: string,
): Promise<{ readonly freshness: 'fresh' | 'stale' | 'unknown'; readonly finalRead: StructuralChallengeFinalRead }> {
  let receipt: StructuralChallengeFinalRead['currentness'];
  const read = await readScenarioAnalysis({
    scenarioId, graph: snapshot.rawPersistedGraph, requestId,
    ...(snapshot.goalScopeClaimInput === undefined ? {} : { goalScopeClaimInput: snapshot.goalScopeClaimInput }),
    onCurrentnessRead: (current) => { receipt = current; },
  });
  const current = receipt as StructuralChallengeFinalRead['currentness'];
  const finalRead = { read, currentness: current };
  const answer = (freshness: 'fresh' | 'stale' | 'unknown') => ({ freshness, finalRead });
  if (!current?.readOk || current.fact === null || read.analysis_state === null) return answer('unknown');
  const identity = compareAnalysisRunFactIdentity(runResult(pinned), runResult(current.fact));
  if (identity.status === 'unconfirmed') return answer('unknown');
  if (identity.status !== 'match' || runResult(pinned).run_id !== runResult(current.fact).run_id) return answer('stale');
  const state = read.analysis_state;
  if (state.run_state.kind === 'unknown_degraded' || state.run_state.kind === 'never_run') return answer('unknown');
  return answer(state.run_state.kind === 'complete_current' && !state.requires_rerun ? 'fresh' : 'stale');
}

/**
 * The contract's `recompute_key` (0.76.0 RETENTION): sha256 of the UTF-8 JSON tuple
 * `[sent_digest, {from_id, op, origin, sizing, to_id}, seed_used, n_samples]` — members in that order, no whitespace,
 * the seed's string/number type preserved.
 */
export function structuralChallengeRecomputeKey(
  sentDigest: string, alternative: StructuralChallengeAlternativeV1, seedUsed: string | number, nSamples: number,
): string {
  const { from_id, op, origin, sizing, to_id } = alternative;
  const canonical = JSON.stringify([sentDigest, { from_id, op, origin, sizing, to_id }, seedUsed, nSamples]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** The baseline's seed echo as the explicit seed the candidate is sent (`RunAnalysisScenarioSnapshot.seed`). */
function pinnableSeed(seedUsed: string | number): number | null {
  const n = typeof seedUsed === 'number' ? seedUsed : /^-?\d{1,15}$/.test(seedUsed) ? Number(seedUsed) : Number.NaN;
  return Number.isSafeInteger(n) ? n : null;
}

function runResult(fact: HandlerFact): Rec {
  const r = (fact as { result?: unknown }).result;
  return isRec(r) ? r : {};
}

function nodeLabels(graph: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const n of nodes) if (isRec(n) && typeof n.id === 'string' && typeof n.label === 'string') out.set(n.id, n.label);
  return out;
}

/** The goal's declared LEVEL target in the outcome's own unit; null for a change-from-today target or none. */
function goalLevelTarget(graph: unknown, goalNodeId: string): number | null {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  const goal = nodes.find((n) => isRec(n) && n.id === goalNodeId);
  if (!isRec(goal) || typeof goal.goal_threshold_raw !== 'number' || !Number.isFinite(goal.goal_threshold_raw)) return null;
  return goal.goal_threshold_frame === 'level' ? goal.goal_threshold_raw : null;
}

/** Deterministic JSON: object keys sorted (the rule `sentDigest` and the residual use). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isRec(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/**
 * Exactly one RECORDED input changed between the two Runs, and it is this link's presence:
 *   (1) `diffRunInputs` reports exactly one row — this link, `presence`, removed; and
 *   (2) member by member, the candidate's recorded snapshot equals the baseline's with that one link entry removed
 *       (only the two digests excluded). (2) catches a recorded change the diff reports only as `partial` without a row
 *       (e.g. another link's mean moved within its band), which (1) alone cannot see once `complete` is not required.
 */
export function isExactlyThisRemoval(baseline: HandlerFact, candidate: HandlerFact, link: ChallengeLink): boolean {
  const a = RunInputSnapshotSchema.safeParse(runResult(baseline).input_snapshot);
  const b = RunInputSnapshotSchema.safeParse(runResult(candidate).input_snapshot);
  if (!a.success || !b.success) return false;
  const { rows } = diffRunInputs(a.data, b.data);
  if (rows.length !== 1) return false;
  const row = rows[0];
  if (!(row.entity_kind === 'link' && row.field === 'presence' && row.change === 'removed'
    && row.link?.from === link.from_id && row.link?.to === link.to_id)) return false;
  const { sent_digest: _sa, residual_digest: _ra, ...restA } = a.data;
  const { sent_digest: _sb, residual_digest: _rb, ...restB } = b.data;
  const expected = { ...restA, links: restA.links.filter((l) => !(l.from === link.from_id && l.to === link.to_id)) };
  return stable(expected) === stable(restB);
}

function linkSizing(baseline: HandlerFact, link: ChallengeLink): StructuralChallengeAlternativeV1['sizing'] {
  const parsed = RunInputSnapshotSchema.safeParse(runResult(baseline).input_snapshot);
  const row = parsed.success ? parsed.data.links.find((l) => l.from === link.from_id && l.to === link.to_id) : undefined;
  return row?.sizing ?? 'unmarked';
}

export async function dispatchStructuralChallenge(params: DispatchStructuralChallengeParams): Promise<StructuralChallengeDispatchResult> {
  const { payload, requestId, link } = params;
  const context = await buildTurnContext(payload, requestId);
  const history = currentFacts(context);
  const selected = history === undefined ? undefined : orderSuccessfulRunAnalysisFactsNewestFirst(history)[0]?.fact;
  if (selected === undefined) return { kind: 'no_run' };

  const run = runResult(selected);
  const input = RunInputSnapshotSchema.safeParse(run.input_snapshot);
  const baselineEnrichment = isRec(run.enrichment) ? run.enrichment : {};
  const meta = isRec(baselineEnrichment.meta) ? baselineEnrichment.meta : {};
  if (typeof run.run_id !== 'string' || typeof run.graph_hash_at_run !== 'string' || !input.success) return { kind: 'no_run' };
  const seedUsed = typeof meta.seed_used === 'string' || typeof meta.seed_used === 'number' ? meta.seed_used : '';
  const nSamples = typeof meta.n_samples === 'number' ? meta.n_samples : 0;
  const baseline: StructuralChallengeBaselineV1 = {
    scenario_id: context.session_id,
    run_id: run.run_id,
    graph_hash_at_run: run.graph_hash_at_run,
    seed_used: seedUsed,
    n_samples: nSamples,
    sent_digest: input.data.sent_digest,
  };
  const checkedIdentity = validateAnalysisRunFactIdentity(run);
  const baselineRunIdentity = checkedIdentity.status === 'confirmed' ? { ...checkedIdentity.identity, run_id: run.run_id } : undefined;
  // A selected Run without the published baseline evidence cannot support any challenge result.
  if (!StructuralChallengeBaselineV1Schema.safeParse(baseline).success) return { kind: 'no_run' };
  const alternative: StructuralChallengeAlternativeV1 = {
    op: 'remove_link', from_id: link.from_id, to_id: link.to_id, origin: params.origin, sizing: linkSizing(selected, link),
  };
  const shell = {
    method: 'full_recompute_unpaired_v1', perturbation_class: 'topology', baseline, alternative,
    attribution_case: 'C2_unpaired', retention: 'not_retained',
    recompute_key: structuralChallengeRecomputeKey(baseline.sent_digest, alternative, seedUsed, nSamples),
  } as const;
  const refuse = (status: Exclude<StructuralChallengeResultV1['status'], 'completed'>, reason: NonNullable<StructuralChallengeResultV1['reason']>, labels = new Map<string, string>()): StructuralChallengeDispatchResult => {
    log.info({ event: 'structural_challenge.result', request_id: requestId, status, reason }, 'structural challenge');
    return { kind: 'result', labels, result: StructuralChallengeResultV1Schema.parse({ ...shell, status, reason, pair_provenance: null, claims: [], not_compared: [] }) };
  };

  if (!params.exploratoryWorkAllowed) return refuse('withheld', 'exploratory_work_not_permitted');

  const readSnapshot: ScenarioReader = params.scenarioReader ?? ((scenarioId) => loadScenarioSnapshotForRunAnalysis(scenarioId, requestId));
  const unavailable = (err: unknown, phase: 'read' | 'probe' | 'candidate' | 'late', labels = new Map<string, string>()): StructuralChallengeDispatchResult => {
    if (err instanceof PLoTTimeoutError || (err instanceof HandlerInvocationFailedError && err.cause_kind === 'plot_timeout')) {
      return refuse('timed_out', 'candidate_run_timeout', labels);
    }
    if (err instanceof AnalysisSnapshotDivergedError || (err instanceof HandlerInvocationFailedError && err.cause_kind === 'analysis_snapshot_diverged')) {
      return refuse('stale', phase === 'read' ? 'run_not_current' : 'model_changed_during_challenge', labels);
    }
    if (err instanceof HandlerResultInvalidError) return refuse('failed', 'candidate_unparseable', labels);
    if (phase === 'candidate' && err instanceof HandlerInvocationFailedError
      && ['analysis_not_ready', 'options_not_configured', 'args_validation_failed'].includes(err.cause_kind)) {
      return refuse('unsupported', 'candidate_rejected', labels);
    }
    return refuse('failed', phase === 'candidate' ? 'candidate_run_failed' : 'probe_unavailable', labels);
  };
  let snapshot: RunAnalysisScenarioSnapshot;
  try { snapshot = await readSnapshot(payload.scenario_id, params.signal); } catch (err) { return unavailable(err, 'read'); }
  const labels = nodeLabels(snapshot.graph);
  try {
    const canonical = await canonicalPinnedFreshness(selected, snapshot, context.session_id, requestId);
    if (canonical.freshness === 'unknown') return refuse('failed', 'probe_unavailable', labels);
    if (canonical.freshness === 'stale') return refuse('stale', 'run_not_current', labels);
    const permission = structuralChallengePresentationPermission(baseline, canonical.finalRead, baselineRunIdentity);
    if (!permission.ok) return refuse(permission.status, permission.reason, labels);
  } catch (err) { return unavailable(err, 'read', labels); }

  // Canonical wiring/definition refusals retain priority. Root and reachability are decided on verified wire below.
  const canonicalEligibility = structuralChallengeEligibility(snapshot.graph, link);
  if (!canonicalEligibility.eligible && canonicalEligibility.reason !== 'target_becomes_root') {
    return refuse('unsupported', canonicalEligibility.reason, labels);
  }

  const plotClient = params.plotClient ?? getDefaultPlotClient();
  const invoke = (handlerFn: NonNullable<ReturnType<typeof resolveHandler>>) => runWithBoundAnalysisSnapshot(
    { scenarioId: context.session_id, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed(history) },
    () => handlerFn({ context, payload, requestId, signal: params.signal ?? new AbortController().signal, orientationText: '' }),
  );

  // The same builder: rebuild the Run's own request from the unedited snapshot; the probe returns before PLoT.
  let sent: RunAnalysisProbeInput | null = null;
  const probeFn = resolveHandler(createRegistry({
    scenarioReader: async () => snapshot,
    plotClient,
    counterfactualClient: null,
    runAnalysisProbe: async (input) => {
      sent = input;
    },
  }), 'run_analysis');
  if (!probeFn) return refuse('failed', 'probe_unavailable', labels);
  try {
    await invoke(probeFn);
  } catch (err) {
    return unavailable(err, 'probe', labels);
  }
  const rebuilt = sent as RunAnalysisProbeInput | null;
  if (rebuilt === null) return refuse('failed', 'probe_unavailable', labels);
  if (!isTheRunsPayload(rebuilt.plotPayload, selected)) return refuse('failed', 'baseline_payload_mismatch', labels);
  const eligibility = structuralChallengeEligibility(rebuilt.plotPayload.graph, link);
  if (!eligibility.eligible) return refuse('unsupported', eligibility.reason, labels);

  // The alternative: the SAME snapshot minus one link, with the baseline's seed PINNED (contract S3: seed, budget and
  // engine equal). An explicit seed is the seed authority's own yield (`explicit_seed`), so its reuse rules are not
  // touched; the pair stays C2_unpaired because the edit still changes the draw structure. `briefText` is dropped — it
  // only feeds PLoT's decision-review chain, which the comparison never reads.
  const pinnedSeed = pinnableSeed(seedUsed);
  if (pinnedSeed === null) return refuse('failed', 'candidate_run_failed', labels);
  const edited: RunAnalysisScenarioSnapshot = {
    ...snapshot,
    graph: graphWithoutLink(snapshot.graph, link),
    ...(snapshot.rawPersistedGraph !== undefined ? { rawPersistedGraph: graphWithoutLink(snapshot.rawPersistedGraph, link) } : {}),
    briefText: undefined,
    seed: pinnedSeed,
  };
  // Per-invocation policy: the ordinary Run handler and all other client callers keep their existing retry policy.
  const candidateClient: PLoTClient = {
    run: (body, id, opts) => plotClient.run(body, id, { ...opts, retryPolicy: 'no_retry' }),
    validatePatch: (body, id, opts) => plotClient.validatePatch(body, id, opts),
  };
  const handlerFn = resolveHandler(createRegistry({ scenarioReader: async () => edited, plotClient: candidateClient, counterfactualClient: null }), 'run_analysis');
  if (!handlerFn) return refuse('failed', 'candidate_run_failed', labels);

  let candidate: HandlerFact | undefined;
  try {
    const outcome = await invoke(handlerFn);
    candidate = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis');
  } catch (err) {
    return unavailable(err, 'candidate', labels);
  }
  if (candidate === undefined) return refuse('failed', 'candidate_unparseable', labels);
  if (!isExactlyThisRemoval(selected, candidate, link)) return refuse('failed', 'baseline_payload_mismatch', labels);

  // A late reply never overwrites a model the user has since changed.
  let after: RunAnalysisScenarioSnapshot;
  let finalFreshness: Awaited<ReturnType<typeof canonicalPinnedFreshness>>;
  try {
    after = await readSnapshot(payload.scenario_id, params.signal);
    finalFreshness = await canonicalPinnedFreshness(selected, after, context.session_id, requestId);
  } catch (err) { return unavailable(err, 'late', labels); }
  if (finalFreshness.freshness === 'unknown') return refuse('failed', 'probe_unavailable', labels);
  if (finalFreshness.freshness !== 'fresh') return refuse('stale', 'model_changed_during_challenge', labels);

  const finalPermission = structuralChallengePresentationPermission(baseline, finalFreshness.finalRead, baselineRunIdentity);
  if (!finalPermission.ok) return refuse(finalPermission.status, finalPermission.reason, labels);
  const candidateRun = runResult(candidate);
  // The candidate is a hypothetical, never the user's model: its admission is the baseline's. Readiness recomputed on
  // the edited graph would block any removal that leaves a factor without a route to the goal (NO_PATH_TO_GOAL), and
  // that withhold used to erase the baseline's canonical leader too (SCI-DEEP beat 4, fa027cf5). Only the candidate's
  // RESULT (separation, withholds, limits) narrows its own side.
  const candidateLeaderLicence = boundRunLeaderLicence({ fact: candidate, identity: {
    scenario_id: context.session_id, run_id: candidateRun.run_id as string,
    graph_hash_at_run: candidateRun.graph_hash_at_run as string, computed_at: candidateRun.computed_at as string,
  } }, { scenario_id: context.session_id, graph: edited.graph }, { readiness: buildCanonicalAnalysisReadyFromGraph(snapshot.graph) });
  const baselineMayNameLeader = params.turnMayNameLeader && finalPermission.permissions.leader_may_be_named;
  const compared = compareStructuralChallenge({
    baselineFact: selected,
    candidateFact: candidate,
    turnMayNameLeader: baselineMayNameLeader,
    candidateMayNameLeader: baselineMayNameLeader && candidateLeaderLicence !== 'withheld',
    reachable: eligibility.reachable,
    goalNodeId: snapshot.goal_node_id,
    goalLevelTarget: goalLevelTarget(snapshot.graph, snapshot.goal_node_id),
    baselineGraph: snapshot.graph,
    candidateGraph: edited.graph,
  });
  if (!compared.ok) {
    return refuse('failed', compared.reason === 'candidate_unparseable' ? 'candidate_unparseable' : 'baseline_payload_mismatch', labels);
  }
  // Contract S3: a verdict needs the same seed, the same sample budget and engine builds PROVEN equal (RunDelta's
  // `deriveBuildsEquality`). Otherwise the difference could be the engine or the budget, not the link — no verdict.
  const pair = compared.pair_provenance;
  if (pair.hash_equal || !pair.seed_equal || !pair.n_equal || pair.builds_equal !== 'equal') return refuse('failed', 'baseline_payload_mismatch', labels);
  // The published Zod contract is the validating boundary, including its evidence/verdict licences. Invalid
  // candidate evidence yields an honest failure with no claims, rather than a success that a consumer cannot parse.
  const parsed = StructuralChallengeResultV1Schema.safeParse({
    ...shell, status: 'completed', reason: null, pair_provenance: pair,
    claims: compared.claims, not_compared: NOT_COMPARED,
  });
  if (!parsed.success) return refuse('failed', 'candidate_unparseable', labels);
  log.info({ event: 'structural_challenge.result', request_id: requestId, status: 'completed', claims: parsed.data.claims.length }, 'structural challenge');
  return { kind: 'result', labels, result: parsed.data, certainty: compared.certainty, finalRead: finalFreshness.finalRead, candidateLeaderLicence, baselineRunIdentity, identicalArms: compared.identical_arms };
}
