/**
 * R2 — auto-run a PROVISIONAL analysis after a fresh draft (Paul's ratified
 * ruling, 2026-08-16): a user should land on a drafted model WITH provisional
 * results, without having to notice and click Run.
 *
 * ── WHAT THIS MODULE IS ─────────────────────────────────────────────────────
 * A scheduler + admission gate around the ONE existing run orchestration.
 * It owns NO run machinery of its own: the dispatch it fires is
 * `dispatchChipClickRunAnalysis` — the same buildTurnContext → registered
 * `run_analysis` handler → PLoT → commitDirectAnswer chain the post-draft
 * "Run analysis" chip executes. Inventing a second run-orchestration path is
 * this estate's chronic defect (two `generateGraphHash` twins, two freshness
 * derivations, …) and is deliberately impossible here by construction.
 *
 * ── WHEN IT FIRES ───────────────────────────────────────────────────────────
 * From exactly ONE call site: route-v2's draft_graph branch, AFTER
 * `sendFinalised200` has handed the draft response to the transport. Draft
 * delivery latency (#995: median ≤45.5s, halved) is untouchable — so the
 * trigger is `setImmediate` fire-and-forget under the same non-blocking
 * contract as the commit-seam hooks (rolling summary, decision records):
 * every failure is caught and logged; NOTHING propagates, and no synchronous
 * work happens before the draft response is already on its way.
 *
 * Fresh drafts ONLY: follow-up edits ride edit-graph-dispatch/turn-executor
 * (no call site there), reloads send no turn at all, and a graph state that
 * already has a successful analysis is suppressed by hash identity below.
 *
 * ── ADMISSION-GATED, NEVER FABRICATED ──────────────────────────────────────
 * The auto-run fires iff `resolveRunAdmission(draftGraph).willProceed` — the
 * #998 two-term authority the run path and the readiness panel share. On an
 * inadmissible draft NOTHING runs and NOTHING is synthesised: the draft
 * response already carries the honest blocker surface (readiness recovery
 * chip + typed analysis_ready), and this module leaves it exactly as is.
 *
 * Two-reads note, stated precisely: this gate reads the IN-MEMORY draft graph
 * (the exact object the draft commit persisted); the dispatch it fires then
 * re-reads the PERSISTED graph and re-runs the SAME admission inside
 * `loadScenarioSnapshotForRunAnalysis` — that second gate remains the
 * authority. If the persisted graph changed in the window (a concurrent edit
 * within milliseconds), the dispatch resolves it honestly: run, typed
 * refusal, or recoverable outcome — never a fabricated result. Divergence
 * can only SKIP a run a click would have allowed (this gate sees the
 * pre-sigma-floor graph), never run one the authority would refuse.
 *
 * ── PROVISIONAL LABELLING ───────────────────────────────────────────────────
 * Carried by the `autoRun` trigger param into the dispatch (see
 * chip-click-dispatch.ts): `enrichment.run_provenance` on the persisted
 * run_analysis fact (machine-readable; no schema change — the open
 * `enrichment` record with a CEE-authored key is the decision_review
 * enricher's established pattern), NO stored user message (the user typed
 * nothing), and a disclosure sentence opening the stored assistant answer.
 * At the deployed UI pin (0.43.0) the transport keep-list strips the
 * provenance key, so the feature degrades to an ordinary completed analysis.
 */

import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { resolveRunAdmission } from '../tools/handlers/analysis-ready-core.js';
import { loadPriorFactsWithReadState } from '../build-turn-context.js';
import {
  dispatchChipClickRunAnalysis,
  AUTO_RUN_POST_DRAFT_CHIP_ID,
} from './chip-click-dispatch.js';

/**
 * The synthesised turn's wire message. NEVER stored as the user's words —
 * the `autoRun` trigger makes the dispatch commit with no `userMessage`
 * (NULL user_message, the established system-event turn shape). Present on
 * the payload because the boundary contract requires a non-empty message and
 * an honest description beats a sentinel.
 */
export const AUTO_RUN_TURN_MESSAGE =
  'Run a provisional analysis of the drafted model.';

export type AutoRunDispatchFn = typeof dispatchChipClickRunAnalysis;
export type AutoRunPriorFactsReader = typeof loadPriorFactsWithReadState;

export interface AutoRunAfterDraftParams {
  readonly scenarioId: string;
  /** The DRAFT turn's id — recorded in provenance, never reused as the run turn's id. */
  readonly draftTurnId: string;
  /** The post-repair graph the draft commit persisted (dg.graph). */
  readonly draftGraph: unknown;
  /** The draft's analysis-affecting hash (freshness.current_graph_hash). */
  readonly draftGraphHash: string | null;
  readonly requestId: string;
  /** Test seam — production uses the one chip-click run orchestration. */
  readonly dispatchRunAnalysis?: AutoRunDispatchFn;
  /** Test seam — production uses the one observational prior-facts read. */
  readonly readPriorFacts?: AutoRunPriorFactsReader;
}

export type AutoRunAfterDraftOutcome =
  | { readonly outcome: 'skipped'; readonly reason: 'not_admissible' | 'already_analysed' }
  | { readonly outcome: 'dispatched'; readonly dispatchOutcome: string }
  | { readonly outcome: 'failed' };

/**
 * True iff a SUCCESSFUL (noop:false) run_analysis fact exists for exactly
 * this analysis-affecting hash. Bound by hash IDENTITY (trap 19): a fact for
 * any other graph state must not suppress the run, and a noop fact is not an
 * existing analysis.
 */
function hasCompletedRunForHash(
  facts: readonly HandlerFact[],
  draftGraphHash: string,
): boolean {
  return facts.some(
    (fact) =>
      fact.fact_type === 'run_analysis' &&
      fact.noop === false &&
      typeof fact.result.graph_hash_at_run === 'string' &&
      fact.result.graph_hash_at_run === draftGraphHash,
  );
}

/**
 * The testable core. Pure orchestration: admission gate → already-analysed
 * guard → the one run dispatch. Never throws — a failure is an outcome.
 */
export async function runAutoRunAfterFreshDraft(
  params: AutoRunAfterDraftParams,
): Promise<AutoRunAfterDraftOutcome> {
  const dispatchRunAnalysis = params.dispatchRunAnalysis ?? dispatchChipClickRunAnalysis;
  const readPriorFacts = params.readPriorFacts ?? loadPriorFactsWithReadState;
  const telemetryBase = {
    request_id: params.requestId,
    scenario_id: params.scenarioId,
    draft_turn_id: params.draftTurnId,
  };
  try {
    // ── 1. Admission — the #998 two-term authority, verbatim. Deliberately
    // NOT injectable: the gate the mutant obligation binds to is the real
    // predicate. Fires iff the run WILL proceed; otherwise nothing runs and
    // nothing is fabricated (the draft response's blocker surface stands).
    const admission = resolveRunAdmission(params.draftGraph);
    if (!admission.willProceed) {
      emit(TelemetryEvents.V5AutoRunAfterDraft, {
        ...telemetryBase,
        outcome: 'skipped',
        reason: 'not_admissible',
      });
      return { outcome: 'skipped', reason: 'not_admissible' };
    }

    // ── 2. Already-analysed suppression (fresh-draft idempotence). A redraft
    // that lands on a graph state an earlier successful run already analysed
    // must not re-run it; likewise a double-fire for one draft (the first
    // fire's committed fact carries this hash). Observational read: a
    // DEGRADED read proceeds — the cheap harm is a duplicate analysis, the
    // expensive one is a user silently never getting results. A null hash
    // cannot bind the guard; the dispatch's own admission remains authority.
    if (params.draftGraphHash !== null) {
      const read = await readPriorFacts(params.scenarioId, params.requestId);
      if (
        read.status === 'ok' &&
        hasCompletedRunForHash(read.facts, params.draftGraphHash)
      ) {
        emit(TelemetryEvents.V5AutoRunAfterDraft, {
          ...telemetryBase,
          outcome: 'skipped',
          reason: 'already_analysed',
        });
        return { outcome: 'skipped', reason: 'already_analysed' };
      }
    }

    // ── 3. The ONE run orchestration, as a server-initiated follow-up turn —
    // the same turn shape the post-draft "Run analysis" chip produces (the
    // draft SSE stream's COMPLETE frame is terminal, so a follow-on cannot
    // ride the draft turn; the chip-click path's own pattern is a separate
    // turn, and that is the pattern reused here). Fresh turn id: this is a
    // new turn in the scenario record, never a reuse of the draft's.
    const payload: MessageTurnPayload = {
      kind: 'message',
      scenario_id: params.scenarioId,
      turn_id: randomUUID(),
      stage: 'analyse',
      turn_class: 'decide',
      source: 'chip_click',
      message: AUTO_RUN_TURN_MESSAGE,
      chip: { id: AUTO_RUN_POST_DRAFT_CHIP_ID, action_type: 'run_analysis' },
    };
    const result = await dispatchRunAnalysis({
      payload,
      requestId: `${params.requestId}:auto-run`,
      autoRun: { draftTurnId: params.draftTurnId },
    });
    emit(TelemetryEvents.V5AutoRunAfterDraft, {
      ...telemetryBase,
      outcome: 'dispatched',
      dispatch_outcome: result.outcome,
      commit_performed: result.commitPerformed,
      run_turn_id: payload.turn_id,
    });
    return { outcome: 'dispatched', dispatchOutcome: result.outcome };
  } catch (err) {
    // Non-blocking contract (the commit-seam hook rule): the draft turn is
    // already delivered; an auto-run fault is an operator signal, never a
    // user-facing failure and never a throw.
    log.error(
      {
        ...telemetryBase,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 auto-run after draft — failed (non-blocking; the delivered draft is unaffected)',
    );
    try {
      emit(TelemetryEvents.V5AutoRunAfterDraft, { ...telemetryBase, outcome: 'failed' });
    } catch {
      // Telemetry faults degrade to the log line above.
    }
    return { outcome: 'failed' };
  }
}

/**
 * The route-facing trigger: returns synchronously, runs the core on a later
 * tick. `setImmediate` (not an inline promise) so not even the synchronous
 * prologue of the core shares the draft turn's tick — the response write is
 * queued before any auto-run work starts.
 */
export function scheduleAutoRunAfterFreshDraft(params: AutoRunAfterDraftParams): void {
  try {
    setImmediate(() => {
      void runAutoRunAfterFreshDraft(params).catch((err) => {
        // runAutoRunAfterFreshDraft already contains its failures; this
        // catch is belt-and-braces so the scheduler can never produce an
        // unhandled rejection.
        log.error(
          {
            request_id: params.requestId,
            scenario_id: params.scenarioId,
            err:
              err instanceof Error
                ? { name: err.name, message: err.message }
                : { message: String(err) },
          },
          'V5 auto-run after draft — scheduler catch (unexpected)',
        );
      });
    });
  } catch (err) {
    log.error(
      {
        request_id: params.requestId,
        scenario_id: params.scenarioId,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 auto-run after draft — scheduling failed (non-blocking)',
    );
  }
}
