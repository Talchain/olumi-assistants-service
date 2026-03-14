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

/**
 * Coerce a raw violations array from the external PLoT engine into plain strings.
 *
 * The PLoT engine's /v1/validate endpoint is declared to return violations?: string[],
 * but the actual runtime payload may contain structured objects
 * { code, severity, level, at?, suggestion? }. Template literal interpolation of an
 * object produces "[object Object]", making the repair prompt useless to the LLM.
 * This function normalises both formats so the LLM always receives readable text.
 *
 * Output format: "[CODE] at <location>: <message>"
 * This format is a soft contract with the repair prompt — do not change without
 * updating the repair prompt's VIOLATION FORMAT section.
 *
 * Location priority order (deterministic, parseable):
 *   1. at.from + at.to  → "at edge from→to"
 *   2. at.node_id / at.node → "at node <id>"
 *   3. at.path → "at <path>"
 *   4. at is a string → "at <string>"
 *   5. otherwise → omit location
 */
export function coerceViolations(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return ["unknown"];
  }
  return raw.map((v) => {
    if (typeof v === "string") return v;
    if (v !== null && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const code = typeof obj["code"] === "string" ? obj["code"] : "UNKNOWN";

      // Build location string using strict priority order
      let location = "";
      const at = obj["at"];
      if (at !== undefined && at !== null) {
        if (typeof at === "string") {
          location = ` at ${at}`;
        } else if (typeof at === "object") {
          const atObj = at as Record<string, unknown>;
          if (typeof atObj["from"] === "string" && typeof atObj["to"] === "string") {
            location = ` at edge ${atObj["from"]}→${atObj["to"]}`;
          } else if (typeof atObj["node_id"] === "string") {
            location = ` at node ${atObj["node_id"]}`;
          } else if (typeof atObj["node"] === "string") {
            location = ` at node ${atObj["node"]}`;
          } else if (typeof atObj["path"] === "string") {
            location = ` at ${atObj["path"]}`;
          }
        }
      }

      const detail =
        typeof obj["suggestion"] === "string"
          ? obj["suggestion"]
          : typeof obj["message"] === "string"
          ? obj["message"]
          : code;
      return `[${code}]${location}: ${detail}`;
    }
    // Non-string, non-object: safely stringify, bounded to 200 chars
    const str = JSON.stringify(v);
    return str !== undefined ? str.slice(0, 200) : "unknown violation";
  });
}

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

  const issues = coerceViolations(first.violations);

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
    const violationSummary = issues.join("; ").slice(0, 500);
    const violationCodes = issues.map((v) => {
      const match = v.match(/^\[([^\]]+)\]/);
      return match ? match[1] : "prose";
    });
    emit(TelemetryEvents.RepairStart, {
      violation_count: issues.length,
      violation_summary: violationSummary,
      violation_codes: violationCodes,
    });

    const modelOverride = (ctx.input as any).model as string | undefined;
    const repairAdapter = getAdapter("repair_graph", modelOverride);

    const repairResult = await repairAdapter.repairGraph(
      {
        graph: candidate,
        violations: issues,
        brief: ctx.effectiveBrief || undefined,
        docs: (ctx.input as any).docs || undefined,
      },
      { requestId: `repair_${Date.now()}`, timeoutMs: ctx.repairTimeoutMs, signal: ctx.opts.signal },
    );
    ctx.llmRepairBriefIncluded = Boolean(ctx.effectiveBrief);

    ctx.repairCost += calculateCost(
      repairAdapter.model,
      repairResult.usage.input_tokens,
      repairResult.usage.output_tokens,
    );

    // ID preservation check: all input node IDs must be present in repair output.
    // New IDs may be added (repair can create nodes), but no input ID may be missing.
    const inputNodeIds = new Set(
      ((candidate as any).nodes ?? []).map((n: any) => n.id),
    );
    const repairNodeIds = new Set(
      (Array.isArray(repairResult.graph?.nodes) ? repairResult.graph.nodes : []).map((n: any) => n.id),
    );
    const missingIds = [...inputNodeIds].filter((id) => !repairNodeIds.has(id));
    if (missingIds.length > 0) {
      log.warn({
        event: "cee.repair.id_preservation_failed",
        missing_ids: missingIds,
        input_count: inputNodeIds.size,
        repair_count: repairNodeIds.size,
        correlation_id: ctx.requestId,
      }, `LLM repair removed ${missingIds.length} node ID(s) — rejecting repair`);
      ctx.repairFallbackReason = "id_preservation_failed";
      throw new Error(`LLM repair removed node IDs: ${missingIds.join(", ")}`);
    }

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
