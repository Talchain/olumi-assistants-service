/**
 * TRACK 3: ONE STRESS VARIANT, ON THE ONE RUN PATH, NOTHING PERSISTED (`stress_test`; the pattern is SCI-DEEP's,
 * `structural-challenge-dispatch.ts`).
 *
 * A variant is a temporary living model: the saved one with stated assumptions set to tested values, or with one named
 * alternative link. The caller maps it with the core mapper; this module reads it through the Run's OWN snapshot loader
 * (an in-memory store holding only the variant graph, beside the scenario's real pending actions), so every rule a Run
 * applies to its wire copy applies here. The `run_analysis` handler computes it with one PLoT call (no retry). Its fact is
 * read for each option's chance exactly as the result would show it (ST1, 21 Oct: never PLoT's untyped `outcome.mean`) and
 * DISCARDED: no `commitDirectAnswer`, no turn row, no Run fact, no scenario write, no new selected Run, no version.
 *
 * Every refusal is typed; none is turned into a figure.
 */
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { readRunEchoes } from '../coaching/build-run-delta.js';
import { priorRunForSeed, seedHistoryFacts } from '../coaching/seed-reuse.js';
import { projectCanonicalAnalysisCells } from '../../routes/canonical-analysis-view.js';
import { agentLicenceRecordOf, goalChanceLicenceForAgent } from '../goal-target/goal-chance-licence.js';
import type { StressChance, StressVariantRows } from '../path-b/tools/stress-tool.js';
import { AnalysisSnapshotDivergedError, NO_CLAIM, runWithBoundAnalysisSnapshot } from '../run-analysis-snapshot-binding.js';
import { getSessionStore } from '../session/index.js';
import type { SessionStore } from '../session/store.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../tools/handler-errors.js';
import { createRegistry, getDefaultPlotClient, resolveHandler, type RunAnalysisScenarioSnapshot } from '../tools/registry.js';
import { PLoTTimeoutError, type PLoTClient } from '../../orchestrator/plot-client.js';

export interface StressVariantParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  /** The mapped variant graph with its `living_model`, as a core save would store it. */
  readonly variantGraph: Record<string, unknown>;
  /** One seed for every variant of a stress run, so variants of the same structure share their draws. Omitted (a what-if,
   *  `what-if-run.ts`): the Run's own seed reuse lends the saved Run's seed where the draw structure matches. */
  readonly seed?: number;
  readonly signal?: AbortSignal;
  /** Test seams; production omits them. */
  readonly plotClient?: PLoTClient;
  readonly pendingStore?: Pick<SessionStore, 'readMostRecentPendingActions'>;
}

/** Each option's chance in one variant's Run, as the read shows it: its own cell, and the licence's figure where it is one. */
export function stressChancesOf(result: Record<string, unknown>, graph: unknown): ReadonlyMap<string, StressChance> {
  const block = { ...result, type: 'analysis_result' };
  const licence = goalChanceLicenceForAgent(block);
  const pct = (agentLicenceRecordOf(block)?.pct_by_option ?? {}) as Record<string, number>;
  return new Map(projectCanonicalAnalysisCells(block as never, graph, result.goal_certainty).map(({ option_id, cell }) => [option_id,
    cell.kind === 'figure' || cell.kind === 'range'
      ? { display: cell.display, pct: cell.kind === 'figure' && Object.hasOwn(pct, option_id) ? pct[option_id]! : null, provisional: licence?.provisional === true, not_shown: null }
      : { display: null, pct: null, provisional: false, not_shown: cell.kind === 'withheld' ? cell.why : null }]));
}

export async function runStressVariant(p: StressVariantParams): Promise<StressVariantRows> {
  const run = await runVariant(p);
  return run.kind === 'rows' ? { kind: 'rows', rows: run.rows } : run;
}

/** One variant's rows and the seed PLoT echoed for it (`meta.seed_used`), so a caller can prove two Runs drew the same. */
export type VariantRun = Exclude<StressVariantRows, { kind: 'rows' }> | {
  readonly kind: 'rows'; readonly rows: ReadonlyMap<string, StressChance>; readonly seedUsed: string | null;
  /** PLoT's sample count (`meta.n_samples`) and each shown figure's display step (`display_rounding_by_option`), for a noise bound. */
  readonly nSamples: number | null; readonly displayStep: ReadonlyMap<string, 'whole' | 'nearest_5'>;
};

/** The step each licensed option's figure was shown at: `nearest_5` where the licence says so, else whole points. */
export function displayStepsOf(result: Record<string, unknown>): ReadonlyMap<string, 'whole' | 'nearest_5'> {
  const steps = (agentLicenceRecordOf({ ...result, type: 'analysis_result' })?.display_rounding_by_option ?? {}) as Record<string, unknown>;
  return new Map(Object.entries(steps).map(([id, step]) => [id, step === 'nearest_5' ? 'nearest_5' : 'whole']));
}

export async function runVariant(p: StressVariantParams): Promise<VariantRun> {
  const context = await buildTurnContext(p.payload, p.requestId);
  const history = seedHistoryFacts({ scenarioId: context.session_id, hotWindow: context.prior_facts, durable: context.scenario_analysis_fact_set });
  const pending = p.pendingStore ?? getSessionStore();
  const variantStore: Pick<SessionStore, 'loadGraphAndBriefText' | 'readMostRecentPendingActions'> = {
    loadGraphAndBriefText: async () => ({ graph: p.variantGraph, briefText: null }),
    readMostRecentPendingActions: (scenarioId, opts) => pending.readMostRecentPendingActions(scenarioId, opts),
  };
  let snapshot: RunAnalysisScenarioSnapshot;
  try {
    snapshot = await loadScenarioSnapshotForRunAnalysis(p.payload.scenario_id, p.requestId, variantStore);
  } catch (err) {
    return refusal(err);
  }
  const edited: RunAnalysisScenarioSnapshot = { ...snapshot, briefText: undefined, ...(p.seed === undefined ? {} : { seed: p.seed }) };
  const plotClient = p.plotClient ?? getDefaultPlotClient();
  const once: PLoTClient = {
    run: (body, id, opts) => plotClient.run(body, id, { ...opts, retryPolicy: 'no_retry' }),
    validatePatch: (body, id, opts) => plotClient.validatePatch(body, id, opts),
  };
  const handlerFn = resolveHandler(createRegistry({ scenarioReader: async () => edited, plotClient: once, counterfactualClient: null }), 'run_analysis');
  if (!handlerFn) return { kind: 'refused', reason: 'failed' };
  try {
    const outcome = await runWithBoundAnalysisSnapshot(
      { scenarioId: context.session_id, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed(history) },
      () => handlerFn({ context, payload: p.payload, requestId: p.requestId, signal: p.signal ?? new AbortController().signal, orientationText: '' }),
    );
    const fact = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis');
    return fact?.fact_type !== 'run_analysis' ? { kind: 'refused', reason: 'failed' }
      : { kind: 'rows', rows: stressChancesOf(fact.result, edited.graph), seedUsed: readRunEchoes(fact)?.seedUsed ?? null,
        nSamples: readRunEchoes(fact)?.nSamples ?? null, displayStep: displayStepsOf(fact.result) };
  } catch (err) {
    return refusal(err);
  }
}

function refusal(err: unknown): Exclude<StressVariantRows, { kind: 'rows' }> {
  if (err instanceof PLoTTimeoutError || (err instanceof HandlerInvocationFailedError && err.cause_kind === 'plot_timeout')) {
    return { kind: 'refused', reason: 'timed_out' };
  }
  if (err instanceof AnalysisSnapshotDivergedError || (err instanceof HandlerInvocationFailedError && err.cause_kind === 'analysis_snapshot_diverged')) {
    return { kind: 'refused', reason: 'stale' };
  }
  if (err instanceof HandlerInvocationFailedError && ['analysis_not_ready', 'options_not_configured', 'args_validation_failed'].includes(err.cause_kind)) {
    return { kind: 'refused', reason: 'unsupported' };
  }
  if (err instanceof HandlerResultInvalidError) return { kind: 'refused', reason: 'failed' };
  return { kind: 'refused', reason: 'failed' };
}
