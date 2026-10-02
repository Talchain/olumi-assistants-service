/**
 * SCIENCE ROBUSTNESS (EXPERIMENT; SCIENCE/DSK, programme-docs #85 lease 5950283606; DL ruling 5948081549).
 * "What would change this?" — on demand only, never on a Run.
 *
 * ONE PAYLOAD BUILDER, NOTHING PERSISTED. The `run_analysis` handler builds the exact /v2/run payload a Run sends; a
 * probe (`tools/handlers/run-analysis-probe.ts`) takes it before PLoT and the handler returns with no facts. This
 * module never calls `commitDirectAnswer`: no turn row, no Run fact, no scenario write. Its pre-steps mirror
 * `dispatchChipClickRunAnalysis` (read-only context, the SAME seed history, one cached snapshot), with the seed binding
 * SCOPED by `runWithBoundAnalysisSnapshot` so it cannot leak into the rest of the caller's request.
 *
 * ABOUT THE RUN THE USER SAW. The re-derived payload must equal the latest Run's: `sentDigest` over it equals that
 * Run's recorded `input_snapshot.sent_digest` — or, when that Run sent no seed (PLoT derived it), the digest of the
 * payload without its seed matches and the payload's seed is that Run's own echo. Anything else is `stale`: the model
 * changed since, and the user is asked to run it again rather than shown tipping points for a model they never ran.
 *
 * CEE IS THE VALIDATING BOUNDARY. PLoT forwards ISL's block verbatim; `plotClient.decisionFlip` strict-parses it
 * against `DecisionFlipBlockV1Schema` (@talchain/schemas 0.75.0). Every non-block outcome is a typed `unavailable`
 * the caller answers with RC's honest limit — never an error, never a figure.
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { DecisionFlipBlockV1 } from '@talchain/schemas';
import { RunInputSnapshotSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { priorRunForSeed, seedHistoryFacts } from '../coaching/seed-reuse.js';
import { runSeedEcho } from '../coaching/build-run-delta.js';
import { orderSuccessfulRunAnalysisFactsNewestFirst } from '../context/freshness.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../run-analysis-snapshot-binding.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';
import type { RunAnalysisProbeInput } from '../tools/handlers/run-analysis-probe.js';
import { sentDigest } from '../tools/handlers/run-input-snapshot.js';
import {
  createRegistry,
  getDefaultPlotClient,
  resolveHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../tools/registry.js';
import { orderFragilityPriorityRows } from '../../orchestrator/shared/fragile-edge-authority.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import { log } from '../../utils/telemetry.js';

export interface FlipLinkRef {
  readonly from_id: string;
  readonly to_id: string;
}

/** DL 2 Oct: until a staging witness measures the real p50, at most two links per request (≈41 s est. on staging). */
export const DECISION_FLIP_MAX_LINKS = 2;
export const DECISION_FLIP_REPLICATES = 4;

export type DecisionFlipDispatchResult =
  | { readonly status: 'measured'; readonly block: DecisionFlipBlockV1; readonly links: readonly FlipLinkRef[] }
  | { readonly status: 'no_run' | 'stale' | 'no_links' }
  | { readonly status: 'unavailable'; readonly reason: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const key = (l: FlipLinkRef) => JSON.stringify([l.from_id, l.to_id]);

/**
 * Pure. Which links to ask about: the caller's goal-path candidates (nearest first), the ones the latest Run's
 * `robustness.fragile_edges` names coming first in that producer's own priority order, capped at `max`. A fragile
 * edge that is not a candidate never enters (the question is about the plan's path).
 */
export function selectFlipLinks(candidates: readonly FlipLinkRef[], runEnrichment: unknown, max = DECISION_FLIP_MAX_LINKS): FlipLinkRef[] {
  const byKey = new Map(candidates.map((c) => [key(c), c] as const));
  const robustness = isRec(runEnrichment) && isRec(runEnrichment.robustness) ? runEnrichment.robustness : null;
  const fragile = Array.isArray(robustness?.fragile_edges) ? robustness.fragile_edges : [];
  const out: FlipLinkRef[] = [];
  const seen = new Set<string>();
  const take = (l: FlipLinkRef | undefined) => {
    if (l === undefined || seen.has(key(l)) || out.length >= max) return;
    seen.add(key(l));
    out.push(l);
  };
  for (const row of orderFragilityPriorityRows(fragile)) {
    if (isRec(row) && typeof row.from_id === 'string' && typeof row.to_id === 'string') {
      take(byKey.get(key({ from_id: row.from_id, to_id: row.to_id })));
    }
  }
  for (const c of candidates) take(c);
  return out;
}

/**
 * Pure. Is `payload` the request the latest Run sent? Its recorded `sent_digest` is over the payload minus
 * `request_id`. When that Run sent no seed, PLoT derived one and echoed it; a re-derivation bound to that Run carries the
 * echo explicitly, so the digest is compared without the seed AND the seed must be that echo.
 */
export function isTheRunsPayload(payload: Rec, runFact: HandlerFact): boolean {
  const result = (runFact as { result?: unknown }).result;
  const parsed = RunInputSnapshotSchema.safeParse(isRec(result) ? result.input_snapshot : undefined);
  const recorded = parsed.success ? parsed.data.sent_digest : undefined;
  if (typeof recorded !== 'string' || recorded.length === 0) return false;
  if (sentDigest(payload) === recorded) return true;
  const { seed, ...withoutSeed } = payload;
  const echo = runSeedEcho(runFact);
  return seed !== undefined && echo !== null && String(seed) === echo && sentDigest(withoutSeed) === recorded;
}

export interface DispatchDecisionFlipParams {
  /** The scenario turn the question is asked on (as `dispatchChipClickRunAnalysis` takes it). */
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  /** The plan's goal-path links, nearest the goal first (the Agent's `model.goal_path_links`, resolved to ids). */
  readonly candidateLinks: readonly FlipLinkRef[];
  readonly signal?: AbortSignal;
  /** Test seams; production omits them. */
  readonly plotClient?: PLoTClient;
  readonly scenarioReader?: ScenarioReader;
}

export async function dispatchDecisionFlip(params: DispatchDecisionFlipParams): Promise<DecisionFlipDispatchResult> {
  const { payload, requestId } = params;
  const context = await buildTurnContext(payload, requestId);
  const history = seedHistoryFacts({
    scenarioId: context.session_id, hotWindow: context.prior_facts, durable: context.scenario_analysis_fact_set,
  });
  const latest = history === undefined ? undefined : orderSuccessfulRunAnalysisFactsNewestFirst(history)[0]?.fact;
  if (latest === undefined) return { status: 'no_run' };

  let cached: RunAnalysisScenarioSnapshot | null = null;
  const oneShotReader: ScenarioReader = params.scenarioReader ?? (async () => {
    cached ??= await loadScenarioSnapshotForRunAnalysis(payload.scenario_id, requestId);
    return cached;
  });
  const plotClient = params.plotClient ?? getDefaultPlotClient();
  let sent: RunAnalysisProbeInput | null = null;
  const registry = createRegistry({
    scenarioReader: oneShotReader,
    plotClient,
    counterfactualClient: null,
    runAnalysisProbe: async (input) => {
      sent = input;
    },
  });
  const handlerFn = resolveHandler(registry, 'run_analysis');
  if (!handlerFn) return { status: 'unavailable', reason: 'handler_missing' };

  try {
    await runWithBoundAnalysisSnapshot(
      { scenarioId: context.session_id, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed(history) },
      () => handlerFn({ context, payload, requestId, signal: params.signal ?? new AbortController().signal, orientationText: '' }),
    );
  } catch (err) {
    // The Run's own refusals (not ready, options not configured, …) and read failures: no tipping points to ask for.
    if (err instanceof HandlerInvocationFailedError) return { status: 'unavailable', reason: `run_refused:${err.cause_kind}` };
    throw err;
  }
  const probed = sent as RunAnalysisProbeInput | null;
  if (probed === null) return { status: 'unavailable', reason: 'no_payload' };
  if (!isTheRunsPayload(probed.plotPayload, latest)) return { status: 'stale' };
  // Only links that are edges of the graph actually sent (ISL refuses an unknown link), then the top two.
  const sentGraph = probed.plotPayload.graph as { edges?: unknown } | undefined;
  const sentEdges = new Set((Array.isArray(sentGraph?.edges) ? sentGraph.edges : [])
    .filter(isRec).map((e) => JSON.stringify([e.from ?? e.from_id, e.to ?? e.to_id])));
  const links = selectFlipLinks(
    params.candidateLinks.filter((l) => sentEdges.has(key(l))),
    (latest as { result?: { enrichment?: unknown } }).result?.enrichment,
  );
  if (links.length === 0) return { status: 'no_links' };
  if (!plotClient.decisionFlip) return { status: 'unavailable', reason: 'client_without_decision_flip' };

  // `brief` would trigger PLoT's synchronous decision-review chain; the tipping points never read it.
  const { brief: _brief, ...rest } = probed.plotPayload;
  const flipPayload = { ...rest, decision_flip: { links, replicates: DECISION_FLIP_REPLICATES } };
  const result = await plotClient.decisionFlip(flipPayload, requestId, params.signal ? { turnSignal: params.signal } : undefined);
  log.info(
    { event: 'decision_flip.result', request_id: requestId, ok: result.ok, reason: result.ok ? null : result.reason, links: links.length },
    'decision-flip dispatch',
  );
  if (!result.ok) return { status: 'unavailable', reason: result.reason === 'unavailable' ? `isl:${result.detail}` : result.reason };
  // The block must answer exactly the links asked, in order — never attribute a tipping point to another link.
  const answered = result.block.links.map((l) => key(l));
  if (answered.length !== links.length || answered.some((k, i) => k !== key(links[i]))) {
    return { status: 'unavailable', reason: 'block_links_mismatch' };
  }
  return { status: 'measured', block: result.block, links };
}
