/**
 * Stage 4 Substep 1: Orchestrator validation
 *
 * Source: Pipeline B lines 1135-1248
 * Runs graph-orchestrator validation with optional LLM repair.
 * Gated by config.cee.orchestratorValidationEnabled.
 */

import type { StageContext } from "../../types.js";
import {
  validateAndRepairGraph,
  GraphValidationError,
  type RepairOnlyAdapter,
} from "../../../graph-orchestrator.js";
import { getAdapter } from "../../../../adapters/llm/router.js";
import { config } from "../../../../config/index.js";
import { log, emit, calculateCost, TelemetryEvents } from "../../../../utils/telemetry.js";
import { buildCeeErrorResponse, isAdminAuthorized } from "../../../validation/pipeline.js";
import { DETERMINISTIC_SWEEP_VERSION } from "../../../constants/versions.js";

export async function runOrchestratorValidation(ctx: StageContext): Promise<void> {
  if (!config.cee.orchestratorValidationEnabled) return;
  if (!ctx.graph) return;

  let repairOnlyAdapter: RepairOnlyAdapter | undefined;

  if (!ctx.skipRepairDueToBudget) {
    const modelOverride = (ctx.input as any).model as string | undefined;
    const repairAdapter = getAdapter("repair_graph", modelOverride);

    repairOnlyAdapter = {
      async repairGraph(brief, failedGraph, errors, reqId) {
        const violations = errors.map((e) => {
          const location = e.path ? ` at ${e.path}` : "";
          return `[${e.code}]${location}: ${e.message}`;
        });

        const result = await repairAdapter.repairGraph(
          { graph: failedGraph, violations, brief, docs: [] },
          { requestId: reqId || `repair_${Date.now()}`, timeoutMs: ctx.repairTimeoutMs },
        );

        ctx.repairCost += calculateCost(
          repairAdapter.model,
          result.usage.input_tokens,
          result.usage.output_tokens,
        );

        return {
          graph: result.graph,
          usage: {
            input_tokens: result.usage.input_tokens,
            output_tokens: result.usage.output_tokens,
          },
        };
      },
    };
  }

  try {
    const validationResult = await validateAndRepairGraph(
      {
        graph: ctx.graph,
        brief: ctx.effectiveBrief,
        requestId: ctx.requestId,
        maxRetries: ctx.skipRepairDueToBudget ? 0 : 1,
      },
      repairOnlyAdapter,
    );

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

      // If the deterministic sweep flagged that LLM repair is needed,
      // defer to PLoT repair (substep 2) instead of returning a 422 here.
      // The orchestrator's limited repair budget may not suffice for semantic
      // errors (INVALID_EDGE_TYPE, CYCLE_DETECTED, etc.) that PLoT repair
      // handles with fuller context (brief + docs + violation details).
      if (ctx.llmRepairNeeded) {
        log.info({
          stage: "orchestrator_validation_deferred",
          error_count: error.errors.length,
          correlation_id: ctx.requestId,
        }, "Orchestrator validation failed but deferring to PLoT repair (llmRepairNeeded=true)");

        // Preserve the best graph the orchestrator produced for PLoT repair
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
