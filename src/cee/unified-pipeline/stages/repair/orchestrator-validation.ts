/**
 * Stage 4 Substep 1b: Orchestrator validation — DETERMINISTIC ONLY.
 *
 * Source: Pipeline B lines 1135-1248
 * Runs graph-orchestrator validation. Gated by
 * config.cee.orchestratorValidationEnabled.
 *
 * ⚠ The LLM-repair limb was REMOVED (ROADMAP 2.740a). What it was and why it
 * went, so nobody re-adds it from the shape of the old code:
 *
 *   - It never ran. Measured over a controlled 7-day window: 0 invocations
 *     across 398 executions of this substep's own parent stage, with a
 *     positive control proving the instrument could see a firing
 *     (PHASE0-EVIDENCE-2026-07-28/substep1b-repair-measurement-2026-08-08.md).
 *     The gate is false on staging and demo and absent→false in production.
 *   - It was armed. `skipRepairDueToBudget` measured false on 398/398 turns,
 *     so the in-code budget guard never disarmed it: one dashboard boolean
 *     would have put a 60 s gpt-4.1 repair on 100 % of draft turns.
 *   - Its hazard was worse than the draft-path repair removed by 2.731. It
 *     replaced ctx.graph wholesale with NO preservation call at all, and —
 *     uniquely — it adopted the LLM's candidate graph on the FAILURE limb
 *     too (`ctx.graph = error.lastGraph`, where lastGraph was the graph the
 *     validator had just rejected), with no wire disclosure on that path.
 *   - The nearest evidence about the same call (same model, same
 *     `repair_graph` prompt, same 60 s budget, adjacent pipeline position)
 *     is 0 successes in 12 invocations.
 *
 * What was KEPT: `validateAndRepairGraph` is also a deterministic validator
 * (Zod → structural-edge normalisation → validateGraph → normalise →
 * validateGraphPostNormalisation). That still runs, still returns warnings,
 * and still fails closed. Removing the LLM call is not removing the
 * validator — do not conflate them.
 */

import type { StageContext } from "../../types.js";
import {
  validateAndRepairGraph,
  GraphValidationError,
} from "../../../graph-orchestrator.js";
import { config } from "../../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";
import { buildCeeErrorResponse, isAdminAuthorized } from "../../../validation/pipeline.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../../constants/versions.js";

export async function runOrchestratorValidation(ctx: StageContext): Promise<void> {
  if (!config.cee.orchestratorValidationEnabled) return;
  if (!ctx.graph) return;

  try {
    const validationResult = await validateAndRepairGraph({
      graph: ctx.graph,
      brief: ctx.effectiveBrief,
      requestId: ctx.requestId,
    });

    ctx.graph = validationResult.graph as any;
    ctx.orchestratorRepairUsed = validationResult.repairUsed;
    ctx.orchestratorWarnings = validationResult.warnings.map((w) => ({
      code: w.code,
      message: w.message,
    }));

    log.info({
      stage: "1b_orchestrator_validation",
      repair_used: ctx.orchestratorRepairUsed,
      repair_attempts: validationResult.repairAttempts,
      warning_count: ctx.orchestratorWarnings.length,
      correlation_id: ctx.requestId,
    }, "Pipeline stage: Orchestrator validation complete");
  } catch (error) {
    if (error instanceof GraphValidationError) {
      log.warn({
        stage: "orchestrator_validation_failed",
        error_count: error.errors.length,
        attempts: error.attempts,
        llm_repair_needed: ctx.llmRepairNeeded,
        correlation_id: ctx.requestId,
      }, "Orchestrator validation failed after all retries");

      emit(TelemetryEvents.GuardViolation, {
        violation_type: "orchestrator_validation_failed",
        error_count: error.errors.length,
      });

      // If the deterministic sweep flagged surviving Bucket-C violations,
      // defer to substep 2 + the post-enforcement gate (9b) instead of
      // returning a 422 here. Substep 2's LLM repair was removed (ROADMAP
      // 2.731); the defer now reaches PLoT validation + deterministic
      // normalisation, and anything still blocking fails closed at 9b with
      // the honest retryable:true envelope — a strictly better 422 than
      // this one (it reflects the post-normalisation graph).
      if (ctx.llmRepairNeeded) {
        log.info({
          stage: "orchestrator_validation_deferred",
          error_count: error.errors.length,
          correlation_id: ctx.requestId,
        }, "Orchestrator validation failed — deferring to PLoT validation + post-enforcement gate (llmRepairNeeded=true)");

        // Carry forward the deterministically-normalised graph for substep 2.
        //
        // ⚠ HONEST LABEL (this comment used to read "the best graph the
        // orchestrator produced", which mis-described its operand). With the
        // LLM limb removed, `error.lastGraph` can ONLY be the caller's own
        // graph after deterministic structural-edge normalisation — there is
        // no adapter that could put an LLM-authored graph here. Before 2.740a
        // it was the graph gpt-4.1 returned and the validator then rejected,
        // adopted silently on a path that reported failure.
        //
        // Guarded by tests/unit/cee.substep1b-llm-repair-removed.test.ts,
        // which binds ctx.graph's node IDs to the INPUT's by identity.
        if (error.lastGraph) {
          ctx.graph = error.lastGraph as any;
        }
        return;
      }

      // Build 422 error with sweep trace at top-level trace.details (matches CEETraceMeta schema)
      const sweepTrace = ctx.repairTrace?.deterministic_sweep as Record<string, unknown> | undefined;

      const errorBody = buildCeeErrorResponse(
        "CEE_GRAPH_INVALID",
        `Graph validation failed after ${error.attempts} attempt(s)`,
        {
          requestId: ctx.requestId,
          details: {
            validation_errors: error.errors.map((e) => ({
              code: e.code,
              message: e.message,
              path: e.path,
            })),
            // Codes-only mirror for the WIRE (ROADMAP 2.718) — see the
            // matching field in graph-enforcement.ts. Only fixed-enum codes
            // cross the route boundary's allowlist; the message-bearing
            // objects above stay off-wire. Derived, not restated.
            validation_error_codes: error.errors.map((e) => e.code),
            attempts: error.attempts,
          },
        },
      );

      // Merge sweep diagnostics into top-level trace.details (CEETraceMeta.details is freeform)
      const trace = (errorBody as any).trace ?? {};
      trace.details = {
        ...(trace.details ?? {}),
        deterministic_sweep_ran: sweepTrace?.sweep_ran ?? false,
        deterministic_sweep_version: sweepTrace?.sweep_version ?? DETERMINISTIC_SWEEP_VERSION,
        last_phase: "orchestrator_validation",
        llm_repair_called: ctx.orchestratorRepairUsed ?? false,
        llm_repair_timeout_ms: ctx.repairTimeoutMs,
      };

      // Full repair_summary behind admin key
      if (ctx.request && isAdminAuthorized(ctx.request)) {
        trace.details.repair_summary = ctx.repairTrace;
      }

      (errorBody as any).trace = trace;

      ctx.earlyReturn = {
        statusCode: 422,
        body: errorBody,
      };
      return;
    }
    throw error;
  }
}
