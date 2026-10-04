/**
 * SCI-DEEP v1 — "Test without this link": an explicit, on-demand structural challenge of the selected Run.
 * (PTL ruling programme-docs #87/5972622586; contract @talchain/schemas 0.76.0 `StructuralChallengeResultV1`.)
 *
 * ONE RUN PATH, NOTHING PERSISTED. The alternative is computed by the ONE `run_analysis` handler on an in-memory copy of
 * the scenario snapshot with exactly one link removed: same payload builder, same PLoT call, same licences (leader
 * permission, goal certainty, goal-figure withholds). Its fact is compared and DISCARDED — this module never calls
 * `commitDirectAnswer`: no turn row, no Run fact, no scenario write, no new selected Run, no version.
 *
 * WHY NO SEED IS LENT. Removing a link changes the draw structure, so the two Runs cannot be paired; CEE's seed authority
 * (`seed-reuse.ts`) already refuses to lend a seed across a structure change and this module does not override it. The
 * comparison is the independent-run form throughout (`C2_unpaired`), and PLoT's seed derived from the edited graph keeps
 * the recompute deterministic.
 *
 * BOUND TO THE SELECTED RUN, BY EXISTING AUTHORITIES ONLY:
 *   currentness — the snapshot's analysis-affecting hash (`computeAnalysisAffectingGraphHash` over the raw persisted
 *                 graph, exactly as `run_analysis` computes `graph_hash_at_run`) equals the Run's; else `stale`.
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
 *   late reply  — the hash is re-read after the recompute; a model edited meanwhile is `stale`.
 * Each refusal is a typed contract status; none is turned into a figure.
 */
import { createHash } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { priorRunForSeed, seedHistoryFacts } from '../coaching/seed-reuse.js';
import { orderSuccessfulRunAnalysisFactsNewestFirst } from '../context/freshness.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../run-analysis-snapshot-binding.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';
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
  type StructuralChallengeAlternative,
  type StructuralChallengeBaseline,
  type StructuralChallengeResult,
} from '../coaching/structural-challenge-compare.js';
import { graphWithoutLink, structuralChallengeEligibility, type ChallengeLink } from '../coaching/structural-challenge-eligibility.js';
import { isTheRunsPayload } from './decision-flip-dispatch.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { log } from '../../utils/telemetry.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface DispatchStructuralChallengeParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly link: ChallengeLink;
  readonly origin: StructuralChallengeAlternative['origin'];
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
  | { readonly kind: 'result'; readonly result: StructuralChallengeResult; readonly labels: ReadonlyMap<string, string> };

/**
 * The contract's `recompute_key` (0.76.0 RETENTION): sha256 of the UTF-8 JSON tuple
 * `[sent_digest, {from_id, op, origin, sizing, to_id}, seed_used, n_samples]` — members in that order, no whitespace,
 * the seed's string/number type preserved.
 */
export function structuralChallengeRecomputeKey(
  sentDigest: string, alternative: StructuralChallengeAlternative, seedUsed: string | number, nSamples: number,
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

/** The analysis-affecting hash exactly as `run_analysis` records `graph_hash_at_run`. */
function currentAnalysisHash(snapshot: RunAnalysisScenarioSnapshot): string | null {
  if (snapshot.rawPersistedGraph === undefined || snapshot.rawPersistedGraph === null) return null;
  const parsed = GraphStateIngressSchema.safeParse(snapshot.rawPersistedGraph);
  return parsed.success ? computeAnalysisAffectingGraphHash(parsed.data) : null;
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

function linkSizing(baseline: HandlerFact, link: ChallengeLink): StructuralChallengeAlternative['sizing'] {
  const parsed = RunInputSnapshotSchema.safeParse(runResult(baseline).input_snapshot);
  const row = parsed.success ? parsed.data.links.find((l) => l.from === link.from_id && l.to === link.to_id) : undefined;
  return row?.sizing ?? 'unmarked';
}

export async function dispatchStructuralChallenge(params: DispatchStructuralChallengeParams): Promise<StructuralChallengeDispatchResult> {
  const { payload, requestId, link } = params;
  const context = await buildTurnContext(payload, requestId);
  const history = seedHistoryFacts({
    scenarioId: context.session_id, hotWindow: context.prior_facts, durable: context.scenario_analysis_fact_set,
  });
  const selected = history === undefined ? undefined : orderSuccessfulRunAnalysisFactsNewestFirst(history)[0]?.fact;
  if (selected === undefined) return { kind: 'no_run' };

  const run = runResult(selected);
  const input = RunInputSnapshotSchema.safeParse(run.input_snapshot);
  const baselineEnrichment = isRec(run.enrichment) ? run.enrichment : {};
  const meta = isRec(baselineEnrichment.meta) ? baselineEnrichment.meta : {};
  if (typeof run.run_id !== 'string' || typeof run.graph_hash_at_run !== 'string' || !input.success) return { kind: 'no_run' };
  const seedUsed = typeof meta.seed_used === 'string' || typeof meta.seed_used === 'number' ? meta.seed_used : '';
  const nSamples = typeof meta.n_samples === 'number' ? meta.n_samples : 0;
  const baseline: StructuralChallengeBaseline = {
    scenario_id: context.session_id,
    run_id: run.run_id,
    graph_hash_at_run: run.graph_hash_at_run,
    seed_used: seedUsed,
    n_samples: nSamples,
    sent_digest: input.data.sent_digest,
  };
  const alternative: StructuralChallengeAlternative = {
    op: 'remove_link', from_id: link.from_id, to_id: link.to_id, origin: params.origin, sizing: linkSizing(selected, link),
  };
  const shell = {
    method: 'full_recompute_unpaired_v1', perturbation_class: 'topology', baseline, alternative,
    attribution_case: 'C2_unpaired', retention: 'not_retained',
    recompute_key: structuralChallengeRecomputeKey(baseline.sent_digest, alternative, seedUsed, nSamples),
  } as const;
  const refuse = (status: Exclude<StructuralChallengeResult['status'], 'completed'>, reason: string, labels = new Map<string, string>()): StructuralChallengeDispatchResult => {
    log.info({ event: 'structural_challenge.result', request_id: requestId, status, reason }, 'structural challenge');
    return { kind: 'result', labels, result: { ...shell, status, reason, pair_provenance: null, claims: [], not_compared: [] } };
  };

  if (!params.exploratoryWorkAllowed) return refuse('withheld', 'exploratory_work_not_permitted');

  const readSnapshot: ScenarioReader = params.scenarioReader ?? ((scenarioId) => loadScenarioSnapshotForRunAnalysis(scenarioId, requestId));
  const snapshot = await readSnapshot(payload.scenario_id, params.signal);
  const labels = nodeLabels(snapshot.graph);
  if (currentAnalysisHash(snapshot) !== baseline.graph_hash_at_run) return refuse('stale', 'run_not_current', labels);

  const eligibility = structuralChallengeEligibility(snapshot.graph, link);
  if (!eligibility.eligible) return refuse('unsupported', eligibility.reason, labels);

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
    if (!(err instanceof HandlerInvocationFailedError)) throw err;
    return refuse('failed', 'probe_unavailable', labels);
  }
  const rebuilt = sent as RunAnalysisProbeInput | null;
  if (rebuilt === null) return refuse('failed', 'probe_unavailable', labels);
  if (!isTheRunsPayload(rebuilt.plotPayload, selected)) return refuse('failed', 'baseline_payload_mismatch', labels);

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
  const handlerFn = resolveHandler(createRegistry({ scenarioReader: async () => edited, plotClient, counterfactualClient: null }), 'run_analysis');
  if (!handlerFn) return refuse('failed', 'candidate_run_failed', labels);

  let candidate: HandlerFact | undefined;
  try {
    const outcome = await invoke(handlerFn);
    candidate = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis');
  } catch (err) {
    if (!(err instanceof HandlerInvocationFailedError)) throw err;
    if (err.cause_kind === 'plot_timeout') return refuse('timed_out', 'candidate_run_timeout', labels);
    if (err.cause_kind === 'analysis_snapshot_diverged') return refuse('stale', 'model_changed_during_challenge', labels);
    if (['analysis_not_ready', 'options_not_configured', 'args_validation_failed'].includes(err.cause_kind)) {
      return refuse('unsupported', 'candidate_rejected', labels);
    }
    return refuse('failed', 'candidate_run_failed', labels);
  }
  if (candidate === undefined) return refuse('failed', 'candidate_unparseable', labels);
  if (!isExactlyThisRemoval(selected, candidate, link)) return refuse('failed', 'baseline_payload_mismatch', labels);

  // A late reply never overwrites a model the user has since changed.
  const after = await readSnapshot(payload.scenario_id, params.signal);
  if (currentAnalysisHash(after) !== baseline.graph_hash_at_run) return refuse('stale', 'model_changed_during_challenge', labels);

  const compared = compareStructuralChallenge({
    baselineFact: selected,
    candidateFact: candidate,
    turnMayNameLeader: params.turnMayNameLeader,
    reachable: eligibility.reachable,
    goalNodeId: snapshot.goal_node_id,
    goalLevelTarget: goalLevelTarget(snapshot.graph, snapshot.goal_node_id),
  });
  if (!compared.ok) {
    return refuse('failed', compared.reason === 'candidate_unparseable' ? 'candidate_unparseable' : 'baseline_payload_mismatch', labels);
  }
  // Contract S3: a verdict needs the same seed, the same sample budget and engine builds PROVEN equal (RunDelta's
  // `deriveBuildsEquality`). Otherwise the difference could be the engine or the budget, not the link — no verdict.
  const pair = compared.pair_provenance;
  if (!pair.seed_equal || !pair.n_equal || pair.builds_equal !== 'equal') return refuse('failed', 'baseline_payload_mismatch', labels);
  log.info({ event: 'structural_challenge.result', request_id: requestId, status: 'completed', claims: compared.claims.length }, 'structural challenge');
  return {
    kind: 'result',
    labels,
    result: { ...shell, status: 'completed', reason: null, pair_provenance: compared.pair_provenance, claims: compared.claims, not_compared: NOT_COMPARED },
  };
}
