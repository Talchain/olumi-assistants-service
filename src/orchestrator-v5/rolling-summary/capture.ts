/**
 * Context Architecture v2 — S4 rolling summary: the fire-and-forget
 * commit-seam maintainer.
 *
 * Invoked from commit.ts AFTER the durable append, on EVERY commit
 * (unconditional since the O-2 activation deleted CEE_ROLLING_SUMMARY).
 * Non-blocking contract (mirrors the decision-record
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
 *    (including ANY missing slot — Codex r2 blocker 2) is rejected; the prior
 *    summary is kept (or the deterministic floor seeded when there is no
 *    prior) — never a garbage write, never silent slot erasure. Since
 *    2026-07-25 this also covers an assistant attribution the pass's own
 *    provenance does not witness (retention.ts).
 *  - RETENTION / NO SILENT ERASURE (2026-07-25): a pass that EMPTIES a slot
 *    holding durable fact does not delete it — assemble.ts carries the prior
 *    entries forward and `carried_forward_slots` fires. Measured trigger: a
 *    user turn merely DOUBTING recorded history emptied RESOLVED 57/57
 *    against 0/16 on neutral controls.
 *  - SINGLE-FLIGHT + COALESCING (Codex r2 fix 4b): at most one pass in flight
 *    per scenario; commits landing mid-flight coalesce into one rerun
 *    (latest-wins — each pass re-reads full history). In-process only; the
 *    cross-instance guarantee remains the DB monotonic guard.
 *  - HONEST HISTORY CAP (Codex r2 fix 4a): a full-history read that fills
 *    SUMMARY_FULL_HISTORY_READ_LIMIT marks the stored summary history_capped
 *    and the text discloses the partiality — no silent truncation.
 */

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';

import { assembleSummaryFromParsed } from './assemble.js';
import { buildSummariserInput, shouldRegenerate } from './build-input.js';
import type { SummariserTurn } from './build-input.js';
import { buildDeterministicFloor } from './deterministic-floor.js';
import { getRollingSummaryModel, getRollingSummaryStore } from './index.js';
import { parseSummaryOutput } from './parse-summary.js';
import type { ParsedSummarySlot, SummaryParseReject } from './parse-summary.js';
import { findErasedSlots, findUnwitnessedAssistantAttributions } from './retention.js';
import type { SummariserModel } from './summariser.js';
import type { RollingSummaryStorePort } from './store-adapter.js';

import { SUMMARY_FULL_HISTORY_READ_LIMIT } from './summary-types.js';
import type { SummarySpeaker } from './summary-types.js';

/** Read the full persisted history off the hot-path window. readRecent is
 *  unclamped (verified); a large limit is effectively "full history" for any
 *  real product session, and the regen path deliberately does NOT inherit the
 *  default-20 read window (01 §2 / R1). When a read FILLS the limit the
 *  history may be partial — the stored summary is marked `history_capped`
 *  and its text discloses the partiality (Codex r2 fix 4a). The constant
 *  lives in summary-types.ts (assemble.ts renders the number); re-exported
 *  here for existing importers. */
export { SUMMARY_FULL_HISTORY_READ_LIMIT };

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

/**
 * Run the durable-memory write gates over a well-formed parse. Returns the
 * reject reason, or null to proceed. Logs WHAT was caught (slot names /
 * offending text) at debug so a firing gate is diagnosable, while the frozen
 * telemetry event stays content-free.
 */
function gateParsedSummary(
  parsedSlots: readonly ParsedSummarySlot[],
  ordinalMap: ReadonlyMap<
    string,
    { turn_id: string; created_at: string; speaker?: SummarySpeaker }
  >,
  args: MaintainRollingSummaryArgs,
): SummaryParseReject | null {
  const unwitnessed = findUnwitnessedAssistantAttributions(parsedSlots, ordinalMap);
  if (unwitnessed.length > 0) {
    log.warn(
      {
        scenario_id: args.scenarioId,
        turn_id: args.turnId,
        slots: unwitnessed.map((u) => u.slot),
      },
      'RollingSummary — REJECTED: the pass attributed a speech act to the assistant that its own provenance does not witness; keeping prior summary',
    );
    return 'unwitnessed_assistant_attribution';
  }
  return null;
}

function toSummariserTurn(t: MaintainerTurn): SummariserTurn {
  return {
    turn_id: t.turn_id,
    created_at: t.created_at,
    user_message: t.user_message ?? null,
    assistant_message: t.assistant_message ?? null,
  };
}

// ---------------------------------------------------------------------------
// Per-scenario single-flight + latest-wins coalescing (Codex r2 fix 4b).
//
// commit.ts fires one independent job per commit; without coalescing, N
// near-simultaneous commits for one scenario stampede N full-history reads +
// N model calls racing the same singleton row (the monotonic write already
// prevents REGRESSION — this bounds waste and race pressure). In-process
// scope is acceptable per the design pack: cross-instance safety rests on
// the DB guard, not on this map.
//
// Semantics: at most ONE pass in flight per scenario. Arrivals during a
// flight coalesce into at most ONE rerun (latest-wins — each pass re-reads
// the full persisted history, so a single rerun absorbs every commit that
// landed during the flight for everything derivable from history).
//
// EXCEPTION (MINOR-1): the deterministic-floor inputs briefText/goalLabel are
// NOT derivable from history — they arrive only on the turn that carries them
// (see the invariant note at buildDeterministicFloor's callers). Latest-wins
// must therefore MERGE them (preserve the last non-null value), not overwrite
// a brief-carrying commit's value with a later brief-less commit's null; else
// the rerun would summarise without the brief the coalesced-away commit
// carried.
// ---------------------------------------------------------------------------

interface SingleFlightEntry {
  rerun: MaintainRollingSummaryArgs | null;
  /** Carried floor inputs — the last non-null briefText/goalLabel seen across
   *  the in-flight pass and every coalesced arrival (MINOR-1). Not re-readable
   *  from history, so preserved rather than dropped by latest-wins. */
  carriedBriefText: string | null | undefined;
  carriedGoalLabel: string | null | undefined;
}

const inFlightByScenario = new Map<string, SingleFlightEntry>();

/** Test-only: clear the single-flight registry between cases. */
export function resetRollingSummarySingleFlightForTests(): void {
  inFlightByScenario.clear();
}

/**
 * Maintain the rolling summary after a successful commit. Fire-and-forget:
 * callers `void` the promise; every path is non-throwing. Per-scenario
 * single-flight: a call that arrives while a pass is in flight for the same
 * scenario returns immediately after scheduling ONE coalesced rerun.
 */
export async function maintainRollingSummaryForCommit(
  args: MaintainRollingSummaryArgs,
): Promise<void> {
  const existing = inFlightByScenario.get(args.scenarioId);
  if (existing !== undefined) {
    // Latest-wins for everything history re-derives; MERGE the floor inputs
    // (MINOR-1): keep the last non-null briefText/goalLabel so a brief-less
    // commit coalescing over a brief-carrying pass does not drop the brief.
    // No telemetry event: the rerun's own v5.summary.updated is the durable
    // record of the coalesced work.
    if (args.briefText != null) existing.carriedBriefText = args.briefText;
    if (args.goalLabel != null) existing.carriedGoalLabel = args.goalLabel;
    existing.rerun = {
      ...args,
      briefText: args.briefText ?? existing.carriedBriefText,
      goalLabel: args.goalLabel ?? existing.carriedGoalLabel,
    };
    log.debug(
      { scenario_id: args.scenarioId, turn_id: args.turnId },
      'RollingSummary — maintainer pass already in flight; commit coalesced into one rerun',
    );
    return;
  }
  const entry: SingleFlightEntry = {
    rerun: null,
    carriedBriefText: args.briefText,
    carriedGoalLabel: args.goalLabel,
  };
  inFlightByScenario.set(args.scenarioId, entry);
  try {
    await runMaintainPass(args);
    // Drain: at most one rerun per completed pass; a commit landing during
    // the rerun re-arms it (bounded by arrival rate, never a queue).
    while (entry.rerun !== null) {
      const next = entry.rerun;
      entry.rerun = null;
      await runMaintainPass(next);
    }
  } finally {
    inFlightByScenario.delete(args.scenarioId);
  }
}

/** One maintenance pass (the pre-single-flight body). Non-throwing. */
async function runMaintainPass(args: MaintainRollingSummaryArgs): Promise<void> {
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
    // Honest partiality (Codex r2 fix 4a): a read that FILLS the limit may
    // have truncated older history — the stored summary must say so (marker
    // + in-text disclosure), never claim silent completeness.
    const historyCapped = newestFirst.length >= SUMMARY_FULL_HISTORY_READ_LIMIT;
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

    // DURABLE-MEMORY WRITE GATES (retention.ts). Two ways an otherwise
    // well-formed summary writes a FALSEHOOD about the user's own history —
    // handled DIFFERENTLY, because one is repairable and the other is not.
    //
    //   1. ERASURE — the pass EMPTIES a slot that held durable fact. Measured
    //      57/57 on a turn where the user merely DOUBTED the records, against
    //      0/16 on neutral controls; the stored `(none)` is injected as "the
    //      summariser looked and found none", so the coach then denies records
    //      the system still holds. REPAIRED, not rejected: assemble.ts carries
    //      the prior slot forward (see `priorForRetention`). The rest of the
    //      pass is usually correct on that same turn — it moves the user's
    //      challenge into OPEN — and freezing the whole summary every time a
    //      user expresses doubt is its own degradation.
    //
    //   2. UNWITNESSED ATTRIBUTION — the text attributes a speech act to the
    //      ASSISTANT while its own provenance cites only the USER (a user's
    //      challenge persisted as an assistant's concession). NOT repairable:
    //      the offending claim is inside generated prose. Takes the existing
    //      reject-and-keep-prior path — the prior summary is still TRUE
    //      memory and the lag machinery discloses the staleness in-band.
    const gateReject: SummaryParseReject | null = parsed.ok
      ? gateParsedSummary(parsed.slots, input.ordinalMap, args)
      : null;
    const carriedForward = parsed.ok ? findErasedSlots(prior, parsed.slots) : [];
    if (carriedForward.length > 0) {
      log.warn(
        { scenario_id: args.scenarioId, turn_id: args.turnId, carried_forward_slots: carriedForward },
        'RollingSummary — the pass would have emptied a slot holding durable memory; carrying the prior entries forward',
      );
    }
    if (!parsed.ok || gateReject !== null) {
      const reason = parsed.ok ? gateReject! : parsed.reason;
      if (prior !== null) {
        log.debug(
          { scenario_id: args.scenarioId, turn_id: args.turnId, reject_reason: reason },
          'RollingSummary — summariser output rejected (off-contract); keeping prior summary',
        );
        emitUpdated(args, {
          status: 'rejected_kept_prior',
          mode,
          duration_ms: Date.now() - startedAt,
          reject_reason: reason,
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
        reject_reason: reason,
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
      // Codex finding 4 — the in-text/stored partiality disclosure fires for
      // EITHER cap type: a DB-read that filled the full-history limit
      // (`historyCapped`) OR a summariser INPUT char-cap that dropped turns
      // from the re-read (`input.cappedFallback`). Both mean "earlier turns
      // were not re-read", so both must disclose rather than claim silent
      // completeness. Telemetry below keeps the two causes DISTINCT
      // (`history_capped` vs `capped_fallback`).
      historyCapped: historyCapped || input.cappedFallback,
      // Retention: carry forward any durable-fact slot this pass emptied.
      priorForRetention: prior,
    });
    const outcome = await store.upsertSummary(args.scenarioId, summary);
    emitUpdated(args, {
      status: outcome.applied ? 'applied' : 'regressed',
      mode,
      generator: mode,
      duration_ms: Date.now() - startedAt,
      chars: summary.text.length,
      capped_fallback: input.cappedFallback,
      history_capped: historyCapped,
      carried_forward_slots: carriedForward.length,
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
    readonly history_capped?: boolean;
    /** How many durable-fact slots this pass EMPTIED and had carried forward
     *  from the prior summary (retention.ts). Non-zero means the summariser
     *  tried to delete recorded history — loud by design; a persistent
     *  non-zero stream is a summariser regression, not a user event. */
    readonly carried_forward_slots?: number;
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
      history_capped: fields.history_capped ?? null,
      carried_forward_slots: fields.carried_forward_slots ?? null,
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
