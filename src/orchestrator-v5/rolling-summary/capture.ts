/**
 * Context Architecture v2 — S4 rolling summary: the fire-and-forget
 * commit-seam maintainer.
 *
 * Invoked from commit.ts AFTER the durable append, when CEE_ROLLING_SUMMARY is
 * 'maintain' or 'inject'. Non-blocking contract (mirrors the decision-record
 * hook verbatim): every failure — store construction, RPC error, model
 * timeout, telemetry fault — is caught and logged; NOTHING propagates to the
 * turn result. The turn is ALREADY committed; the summariser runs off the path
 * and MUST NOT add latency to or fail the turn (design pack 05 §S4 property 1).
 *
 * Safety properties this hook realises (each has a RED test):
 *  - MONOTONIC WRITE (R4): the write goes through upsert_rolling_summary, whose
 *    WHERE clause no-ops any out-of-order/stale land. This hook never assumes
 *    its write won: it reads `applied`/`regressed` and reports honestly.
 *  - REGEN FROM FULL HISTORY (R1): the mode/input decision reads the FULL
 *    persisted turn history (readRecent with a large explicit limit — unclamped),
 *    never the 20-turn hot-path window and never a summary-of-summary.
 *  - REJECT-AND-KEEP-PRIOR: a summariser emitting outside the four-slot schema
 *    is rejected; the prior summary is kept (or the deterministic floor seeded
 *    when there is no prior) — never a garbage write.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

import { assembleSummaryFromParsed } from './assemble.js';
import { buildSummariserInput, shouldRegenerate } from './build-input.js';
import type { SummariserTurn } from './build-input.js';
import { buildDeterministicFloor } from './deterministic-floor.js';
import { getRollingSummaryModel, getRollingSummaryStore } from './index.js';
import { parseSummaryOutput } from './parse-summary.js';
import type { SummariserModel } from './summariser.js';
import type { RollingSummaryStorePort } from './store-adapter.js';

/** Read the full persisted history off the hot-path window. readRecent is
 *  unclamped (verified); a large limit is effectively "full history" for any
 *  real product session, and the regen path deliberately does NOT inherit the
 *  default-20 read window (01 §2 / R1). */
export const SUMMARY_FULL_HISTORY_READ_LIMIT = 1000;

/** Minimal structural slice of a persisted turn the maintainer needs — a
 *  superset-compatible view of SessionTurnWithContent (snake_case content
 *  fields, as readRecent returns them). */
export interface MaintainerTurn {
  readonly turn_id: string;
  readonly created_at: string;
  readonly user_message?: string | null;
  readonly assistant_message?: string | null;
}

/** Structural read slice passed from commit.ts (its SessionStore satisfies it
 *  structurally — keeps the SessionStore import surface bounded per the
 *  state-write-invariant guard; this module never imports SessionStore). */
export interface ConversationHistoryReader {
  readRecent(scenarioId: string, limit?: number): Promise<readonly MaintainerTurn[]>;
}

export interface MaintainRollingSummaryArgs {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly persistedRowId: string;
  readonly historyReader: ConversationHistoryReader;
  /** Deterministic-floor inputs (best-effort; the floor degrades to the latest
   *  user message when both are absent). */
  readonly briefText?: string | null;
  readonly goalLabel?: string | null;
  /** Test seams — production defaults to the singletons. */
  readonly summaryStore?: RollingSummaryStorePort;
  readonly model?: SummariserModel;
}

type MaintainStatus =
  | 'applied'
  | 'regressed'
  | 'rejected_kept_prior'
  | 'floor'
  | 'model_error_kept_prior'
  | 'no_turns'
  | 'error';

function toSummariserTurn(t: MaintainerTurn): SummariserTurn {
  return {
    turn_id: t.turn_id,
    created_at: t.created_at,
    user_message: t.user_message ?? null,
    assistant_message: t.assistant_message ?? null,
  };
}

/**
 * Maintain the rolling summary after a successful commit. Fire-and-forget:
 * callers `void` the promise; every path is non-throwing.
 */
export async function maintainRollingSummaryForCommit(
  args: MaintainRollingSummaryArgs,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const store = args.summaryStore ?? getRollingSummaryStore();
    const model = args.model ?? getRollingSummaryModel();

    const prior = await store.loadSummary(args.scenarioId);

    // FULL persisted history (R1) — newest-first from readRecent → reverse to
    // chronological. Unclamped read; the hot-path 20-window is not inherited.
    const newestFirst = await args.historyReader.readRecent(
      args.scenarioId,
      SUMMARY_FULL_HISTORY_READ_LIMIT,
    );
    const chronologicalTurns: SummariserTurn[] = [...newestFirst].reverse().map(toSummariserTurn);
    if (chronologicalTurns.length === 0) {
      emitUpdated(args, { status: 'no_turns', duration_ms: Date.now() - startedAt });
      return;
    }

    const mode = shouldRegenerate(chronologicalTurns.length, prior) ? 'regen' : 'incremental';
    const input = buildSummariserInput({
      mode,
      priorSummary: prior,
      chronologicalTurns,
      briefText: args.briefText,
    });
    if (input.watermark === null) {
      emitUpdated(args, { status: 'no_turns', duration_ms: Date.now() - startedAt });
      return;
    }
    const version = (prior?.version ?? 0) + 1;
    const latestUserMessage = chronologicalTurns[chronologicalTurns.length - 1]!.user_message;

    // --- the one model call (off-path) ---------------------------------
    let modelText: string;
    let usage: { input_tokens?: number; output_tokens?: number } | undefined;
    try {
      const result = await model.summarise(input.userMessage, { requestId: args.turnId });
      modelText = result.text;
      usage = result.usage;
    } catch (modelErr) {
      // Model failure: keep the prior summary if there is one; otherwise seed
      // the deterministic floor so the summary is never empty (01 §2).
      if (prior !== null) {
        log.debug(
          { scenario_id: args.scenarioId, turn_id: args.turnId, err: errStr(modelErr) },
          'RollingSummary — summariser model failed; keeping prior summary',
        );
        emitUpdated(args, {
          status: 'model_error_kept_prior',
          mode,
          duration_ms: Date.now() - startedAt,
          error_name: errName(modelErr),
        });
        return;
      }
      await writeFloor(args, store, {
        briefText: args.briefText,
        goalLabel: args.goalLabel,
        watermark: input.watermark,
        version,
        latestUserMessage,
      });
      emitUpdated(args, {
        status: 'floor',
        mode,
        duration_ms: Date.now() - startedAt,
        error_name: errName(modelErr),
      });
      return;
    }

    // --- parse + reject-or-write ---------------------------------------
    const parsed = parseSummaryOutput(modelText);
    if (!parsed.ok) {
      if (prior !== null) {
        log.debug(
          { scenario_id: args.scenarioId, turn_id: args.turnId, reject_reason: parsed.reason },
          'RollingSummary — summariser output rejected (off-contract); keeping prior summary',
        );
        emitUpdated(args, {
          status: 'rejected_kept_prior',
          mode,
          duration_ms: Date.now() - startedAt,
          reject_reason: parsed.reason,
          usage,
        });
        return;
      }
      await writeFloor(args, store, {
        briefText: args.briefText,
        goalLabel: args.goalLabel,
        watermark: input.watermark,
        version,
        latestUserMessage,
      });
      emitUpdated(args, {
        status: 'floor',
        mode,
        duration_ms: Date.now() - startedAt,
        reject_reason: parsed.reason,
        usage,
      });
      return;
    }

    const summary = assembleSummaryFromParsed({
      parsedSlots: parsed.slots,
      ordinalMap: input.ordinalMap,
      watermark: input.watermark,
      version,
      generator: mode,
    });
    const outcome = await store.upsertSummary(args.scenarioId, summary);
    emitUpdated(args, {
      status: outcome.applied ? 'applied' : 'regressed',
      mode,
      generator: mode,
      duration_ms: Date.now() - startedAt,
      chars: summary.text.length,
      capped_fallback: input.cappedFallback,
      usage,
    });
  } catch (err) {
    // Absolute backstop — the fire-and-forget contract: nothing escapes.
    log.warn(
      { scenario_id: args.scenarioId, turn_id: args.turnId, err: errStr(err) },
      'RollingSummary — maintainer hook failed (turn result unaffected)',
    );
    emitUpdated(args, {
      status: 'error',
      duration_ms: Date.now() - startedAt,
      error_name: errName(err),
    });
  }
}

async function writeFloor(
  args: MaintainRollingSummaryArgs,
  store: RollingSummaryStorePort,
  floorInputs: {
    briefText?: string | null;
    goalLabel?: string | null;
    watermark: { turn_id: string; created_at: string };
    version: number;
    latestUserMessage?: string | null;
  },
): Promise<void> {
  const floor = buildDeterministicFloor({
    briefText: floorInputs.briefText,
    goalLabel: floorInputs.goalLabel,
    watermark: floorInputs.watermark,
    version: floorInputs.version,
    latestUserMessage: floorInputs.latestUserMessage,
  });
  // The floor also rides the monotonic guard — a late floor never clobbers a
  // fresher real summary.
  await store.upsertSummary(args.scenarioId, floor);
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'unknown';
}

/** Content-free maintainer telemetry (frozen-registry member
 *  v5.summary.updated). Never throws (fire-and-forget contract). */
function emitUpdated(
  args: MaintainRollingSummaryArgs,
  fields: {
    readonly status: MaintainStatus;
    readonly mode?: 'regen' | 'incremental';
    readonly generator?: 'regen' | 'incremental' | 'floor';
    readonly duration_ms: number;
    readonly chars?: number;
    readonly capped_fallback?: boolean;
    readonly reject_reason?: string;
    readonly error_name?: string;
    readonly usage?: { input_tokens?: number; output_tokens?: number };
  },
): void {
  try {
    emit(TelemetryEvents.V5SummaryUpdated, {
      scenario_id: args.scenarioId,
      turn_id: args.turnId,
      turn_row_id: args.persistedRowId,
      status: fields.status,
      mode: fields.mode ?? null,
      generator: fields.generator ?? null,
      duration_ms: fields.duration_ms,
      chars: fields.chars ?? null,
      capped_fallback: fields.capped_fallback ?? null,
      reject_reason: fields.reject_reason ?? null,
      error_name: fields.error_name ?? null,
      input_tokens: fields.usage?.input_tokens ?? null,
      output_tokens: fields.usage?.output_tokens ?? null,
    });
  } catch (emitErr) {
    log.debug(
      { scenario_id: args.scenarioId, turn_id: args.turnId, err: errStr(emitErr) },
      'RollingSummary — maintainer telemetry emit failed (swallowed; fire-and-forget)',
    );
  }
}
