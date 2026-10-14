import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { log } from '../utils/telemetry.js';
import { buildBriefProvenanceWrite } from './brief-provenance/capture.js';
import { buildDecisionRecordWrite } from './decision-records/capture.js';

/** One shared wall-clock budget; no sequential per-hook timeout multiplication. */
export const RUN_RECORDING_BUDGET_MS = 1_000;

export type RunCaptureOutcome =
  | { readonly status: 'recorded' }
  | { readonly status: 'not_applicable'; readonly reason: 'missing_input' | 'guest' }
  | { readonly status: 'not_recorded'; readonly reason: 'write_failed' | 'no_row' | 'timeout' | 'missing_or_mismatched' }
  | { readonly status: 'unavailable'; readonly reason: 'read_failed' };

export interface RunRecordingRows {
  readonly brief: unknown;
  readonly analysisProvenance: unknown;
  readonly guest: boolean;
  readonly decisionRecordPresent: boolean;
}

/** Structural read slice: leaf modules do not import SessionStore. */
export interface RunRecordingReader {
  readRunRecordingRows?(scenarioId: string, decisionRecordId: string | null): Promise<RunRecordingRows>;
}

export interface RunRecordingMarker {
  readonly status: 'not_recorded' | 'unavailable';
  readonly graph_hash_at_run: string | null;
  readonly computed_at: string | null;
  readonly run_id?: string;
  readonly brief_provenance: RunCaptureOutcome;
  readonly decision_record: RunCaptureOutcome;
}

async function withinBudget<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work).catch(() => fallback),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), RUN_RECORDING_BUDGET_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Await both post-append captures, with rejection and telemetry isolation. */
export async function awaitRunRecording(args: {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly persistedRowId: string;
  readonly brief: () => Promise<RunCaptureOutcome>;
  readonly decision: () => Promise<RunCaptureOutcome>;
}): Promise<void> {
  const capture = (work: () => Promise<RunCaptureOutcome>) => withinBudget(
    () => Promise.resolve().then(work).catch(() => ({ status: 'not_recorded', reason: 'write_failed' } as const)),
    { status: 'not_recorded', reason: 'timeout' } as RunCaptureOutcome,
  );
  const [brief, decision] = await Promise.all([capture(args.brief), capture(args.decision)]);
  try {
    const fields = {
      event: 'v5.run_recording.completed', scenario_id: args.scenarioId, turn_id: args.turnId,
      turn_row_id: args.persistedRowId, budget_ms: RUN_RECORDING_BUDGET_MS,
      brief_provenance: brief, decision_record: decision,
    };
    if (brief.status === 'not_recorded' || decision.status === 'not_recorded') {
      log.warn(fields, 'Run secondary recording incomplete; turn remains committed');
    } else {
      log.info(fields, 'Run secondary recording completed');
    }
  } catch { /* A logging fault cannot undo a committed turn. */ }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reconcile durable rows against THIS Run, never an in-memory attempt marker.
 * Successful recording omits the additive marker; read failure is not absence.
 */
export async function readRunRecordingMarker(
  store: RunRecordingReader, scenarioId: string, fact: RunAnalysisHandlerFact,
): Promise<RunRecordingMarker | undefined> {
  // Older structural stores cannot answer this additive leg.
  if (store.readRunRecordingRows === undefined) return undefined;
  const brief = buildBriefProvenanceWrite(fact, scenarioId);
  const decision = buildDecisionRecordWrite(fact, scenarioId);
  if (brief.kind === 'skip' && decision.kind === 'skip') return undefined;
  const rows = await withinBudget(
    () => store.readRunRecordingRows!(scenarioId, decision.kind === 'write' ? decision.write.record_id : null),
    null,
  );
  const skipped: RunCaptureOutcome = { status: 'not_applicable', reason: 'missing_input' };
  const unavailable: RunCaptureOutcome = { status: 'unavailable', reason: 'read_failed' };
  const absent: RunCaptureOutcome = { status: 'not_recorded', reason: 'missing_or_mismatched' };
  const recorded: RunCaptureOutcome = { status: 'recorded' };
  const provenance = rows?.analysisProvenance;
  const briefOutcome = brief.kind === 'skip' ? skipped : rows === null ? unavailable
    : object(rows.brief) && object(provenance)
      && provenance.graph_hash === brief.write.graph_hash
      && provenance.seed_used === brief.write.seed_used
      && provenance.response_hash === brief.write.response_hash ? recorded : absent;
  const decisionOutcome = decision.kind === 'skip' ? skipped : rows === null ? unavailable
    : rows.guest ? { status: 'not_applicable', reason: 'guest' } as const
      : rows.decisionRecordPresent ? recorded : absent;
  if ([briefOutcome.status, decisionOutcome.status].every(s => s === 'recorded' || s === 'not_applicable')) return undefined;
  return {
    status: rows === null ? 'unavailable' : 'not_recorded',
    graph_hash_at_run: fact.result.graph_hash_at_run ?? null,
    computed_at: fact.result.computed_at ?? null,
    ...(fact.result.run_id === undefined ? {} : { run_id: fact.result.run_id }),
    brief_provenance: briefOutcome, decision_record: decisionOutcome,
  };
}
