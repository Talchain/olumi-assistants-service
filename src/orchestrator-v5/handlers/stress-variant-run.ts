/**
 * TRACK 3: ONE STRESS VARIANT, ON THE ONE RUN PATH, NOTHING PERSISTED (`stress_test`; the pattern is SCI-DEEP's,
 * `structural-challenge-dispatch.ts`).
 *
 * A variant is a temporary living model: the saved one with stated assumptions set to tested values, or with one named
 * alternative link. The caller maps it with the core mapper; this module reads it through the Run's OWN snapshot loader
 * (an in-memory store holding only the variant graph, beside the scenario's real pending actions), so every rule a Run
 * applies to its wire copy applies here. The `run_analysis` handler computes it with one PLoT call (no retry). Its fact is
 * read for the licensed per-option rows and DISCARDED: no `commitDirectAnswer`, no turn row, no Run fact, no scenario
 * write, no new selected Run, no version.
 *
 * Every refusal is typed; none is turned into a figure.
 */
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { buildTurnContext, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { priorRunForSeed, seedHistoryFacts } from '../coaching/seed-reuse.js';
import { licensedOptionRows, type OptionRow } from '../coaching/structural-challenge-compare.js';
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
  /** One seed for every variant of a stress run, so variants of the same structure share their draws. */
  readonly seed: number;
  readonly goalNodeId: string;
  /** The stated target in the goal's own units, or null when the model states none. */
  readonly goalLevelTarget: number | null;
  readonly signal?: AbortSignal;
  /** Test seams; production omits them. */
  readonly plotClient?: PLoTClient;
  readonly pendingStore?: Pick<SessionStore, 'readMostRecentPendingActions'>;
}

export type StressVariantResult =
  | { readonly kind: 'rows'; readonly rows: ReadonlyMap<string, OptionRow>; readonly targetLicensed: boolean }
  | { readonly kind: 'refused'; readonly reason: 'timed_out' | 'unsupported' | 'stale' | 'failed' };

export async function runStressVariant(p: StressVariantParams): Promise<StressVariantResult> {
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
  const edited: RunAnalysisScenarioSnapshot = { ...snapshot, briefText: undefined, seed: p.seed };
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
    const read = fact === undefined ? null : licensedOptionRows(fact, edited.graph, p.goalNodeId, p.goalLevelTarget);
    return read === null ? { kind: 'refused', reason: 'failed' } : { kind: 'rows', ...read };
  } catch (err) {
    return refusal(err);
  }
}

function refusal(err: unknown): StressVariantResult {
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
