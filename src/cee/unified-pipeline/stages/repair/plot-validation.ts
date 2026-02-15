/**
 * Stage 4 Substep 2: PLoT validation + LLM repair
 *
 * Source: Pipeline B lines 1341-1447
 * Validates graph against PLoT engine, applies LLM repair or simple fallback.
 *
 * Fallback reasons (ctx.repairFallbackReason):
 *   "budget_exceeded"       — skipRepairDueToBudget triggered simpleRepair
 *   "revalidation_failed"   — LLM repair succeeded but re-validation failed
 *   "llm_repair_error"      — LLM repair threw (API error, schema error)
 *   "dag_transform_failed"  — LLM repair succeeded but DAG stabilisation failed
 *
 * This substep does NOT set ctx.earlyReturn — all failure paths fall back to simpleRepair.
 */

import type { StageContext } from "../../types.js";
import { validateGraph } from "../../../../services/validateClientWithCache.js";
import { preserveFieldsFromOriginal } from "../../../../routes/assist.draft-graph.js";
import { simpleRepair } from "../../../../services/repair.js";
import { getAdapter } from "../../../../adapters/llm/router.js";
import { stabiliseGraph, ensureDagAndPrune } from "../../../../orchestrator/index.js";
import { log, emit, calculateCost, TelemetryEvents } from "../../../../utils/telemetry.js";

export async function runPlotValidation(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  let candidate = ctx.graph as any;
  const collector = ctx.collector;

  const first = await validateGraph(candidate);

  if (first.ok && first.normalized) {
    const normalizedWithCategory = preserveFieldsFromOriginal(first.normalized, candidate);
    candidate = stabiliseGraph(ensureDagAndPrune(normalizedWithCategory, { collector }), { collector });
    ctx.graph = candidate;
    return;
  }

  const issues = first.violations;

  // Repair gating: if deterministic sweep determined LLM repair is not needed,
  // skip LLM repair but still run PLoT validation for normalization.
  if (ctx.llmRepairNeeded === false) {
    log.info({
      event: "REPAIR_SKIPPED",
      reason: "deterministic_sweep_sufficient",
      remaining_violations: ctx.remainingViolations?.length ?? 0,
      correlation_id: ctx.requestId,
    }, "Skipping LLM repair — deterministic sweep resolved all actionable violations");

    // Still apply simple repair for normalization
    const repaired = stabiliseGraph(
      ensureDagAndPrune(simpleRepair(candidate, ctx.requestId), { collector }),
      { collector },
    );
    const second = await validateGraph(repaired);
    if (second.ok && second.normalized) {
      const normalizedWithCategory = preserveFieldsFromOriginal(second.normalized, repaired);
      candidate = stabiliseGraph(ensureDagAndPrune(normalizedWithCategory, { collector }), { collector });
    } else {
      candidate = repaired;
    }

    ctx.graph = candidate;
    return;
  }

  // Budget exceeded → skip LLM repair, use simple repair only
  if (ctx.skipRepairDueToBudget) {
    log.info({
      stage: "repair_skipped",
      violation_count: issues?.length ?? 0,
      reason: "budget_exceeded",
      correlation_id: ctx.requestId,
    }, "Skipping LLM repair due to time budget - using simple repair");

    ctx.repairFallbackReason = "budget_exceeded";
    const repaired = stabiliseGraph(
      ensureDagAndPrune(simpleRepair(candidate, ctx.requestId), { collector }),
      { collector },
    );
    const second = await validateGraph(repaired);
    if (second.ok && second.normalized) {
      const normalizedWithCategory = preserveFieldsFromOriginal(second.normalized, repaired);
      candidate = stabiliseGraph(ensureDagAndPrune(normalizedWithCategory, { collector }), { collector });
    } else {
      candidate = repaired;
    }

    emit(TelemetryEvents.RepairFallback, {
      fallback: "simple_repair",
      reason: "budget_exceeded",
      error_type: "none",
    });

    ctx.graph = candidate;
    return;
  }

  // LLM-guided repair
  try {
    emit(TelemetryEvents.RepairStart, { violation_count: issues?.length ?? 0 });

    const modelOverride = (ctx.input as any).model as string | undefined;
    const repairAdapter = getAdapter("repair_graph", modelOverride);

    const repairResult = await repairAdapter.repairGraph(
      {
        graph: candidate,
        violations: issues || [],
        brief: ctx.effectiveBrief || undefined,
        docs: (ctx.input as any).docs || undefined,
      },
      { requestId: `repair_${Date.now()}`, timeoutMs: ctx.repairTimeoutMs },
    );
    ctx.llmRepairBriefIncluded = Boolean(ctx.effectiveBrief);

    ctx.repairCost += calculateCost(
      repairAdapter.model,
      repairResult.usage.input_tokens,
      repairResult.usage.output_tokens,
    );

    let repaired: any;
    try {
      repaired = stabiliseGraph(
        ensureDagAndPrune(repairResult.graph, { collector }),
        { collector },
      );
    } catch (dagError) {
      log.warn({ error: dagError }, "Repaired graph failed DAG validation, using simple repair");
      ctx.repairFallbackReason = "dag_transform_failed";
      throw dagError;
    }

    // Re-validate repaired graph
    const second = await validateGraph(repaired);
    if (second.ok && second.normalized) {
      const normalizedWithCategory = preserveFieldsFromOriginal(second.normalized, repaired);
      candidate = stabiliseGraph(
        ensureDagAndPrune(normalizedWithCategory, { collector }),
        { collector },
      );
      emit(TelemetryEvents.RepairSuccess, { repair_worked: true });
    } else {
      // Repair didn't fix all issues → fallback to simple repair
      candidate = stabiliseGraph(
        ensureDagAndPrune(simpleRepair(repaired, ctx.requestId), { collector }),
        { collector },
      );
      ctx.repairFallbackReason = "revalidation_failed";
      emit(TelemetryEvents.RepairPartial, {
        repair_worked: false,
        fallback_reason: ctx.repairFallbackReason,
      });
    }
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    if (!ctx.repairFallbackReason) {
      ctx.repairFallbackReason = "llm_repair_error";
    }
    log.warn(
      { error, fallback_reason: ctx.repairFallbackReason },
      "LLM repair failed, falling back to simple repair",
    );

    const repaired = stabiliseGraph(
      ensureDagAndPrune(simpleRepair(candidate, ctx.requestId), { collector }),
      { collector },
    );
    const second = await validateGraph(repaired);
    if (second.ok && second.normalized) {
      const normalizedWithCategory = preserveFieldsFromOriginal(second.normalized, repaired);
      candidate = stabiliseGraph(
        ensureDagAndPrune(normalizedWithCategory, { collector }),
        { collector },
      );
    } else {
      candidate = repaired;
    }

    emit(TelemetryEvents.RepairFallback, {
      fallback: "simple_repair",
      reason: ctx.repairFallbackReason,
      error_type: errorType,
    });
  }

  ctx.graph = candidate;
}
