/**
 * Stage 4 Substep 2: PLoT validation + deterministic normalisation
 *
 * LLM REPAIR REMOVED — ROADMAP 2.731 (efficacy measurement,
 * PHASE0-EVIDENCE-2026-07-28/repair-efficacy-measurement-2026-08-08.md):
 * over the full 7-day window the gpt-4.1 `repair_graph` call succeeded on
 * 0/12 invocations (`repair_success` emitted zero times; INVALID_EDGE_TYPE
 * violations returned byte-identical), while the deterministic sweep already
 * resolved 97.8% of violations and every DELIVERED turn on this path was
 * rescued by the deterministic simpleRepair fallback below — AFTER the LLM
 * call had failed and cost ~44.7s. The call also carried the 2.286
 * wholesale-graph-replacement hazard.
 *
 * Post-removal contract:
 *  - PLoT validation still runs (normalisation + violation detection).
 *  - The deterministic fallback (simpleRepair → re-validate → prefer the
 *    engine's normalised graph) is UNCHANGED — it is the path that rescued
 *    every delivered turn in the measurement window.
 *  - Violations neither the sweep nor simpleRepair can fix stay on
 *    ctx.graph and fail closed at the post-enforcement gate (substep 9b),
 *    which emits the honest 422 CEE_GRAPH_INVALID with producer-declared
 *    `retryable: true` + retry-first recovery copy (#845). The fast honest
 *    failure IS the feature: the user waits ~31s, not ~76s.
 *  - This substep does NOT set ctx.earlyReturn.
 *
 * The edit path's repair (`repair_edit_graph`, orchestrator/tools/
 * edit-graph.ts) is a different prompt on a different seam and is NOT
 * affected by this removal.
 */

import type { StageContext } from "../../types.js";
import { validateGraph } from "../../../../services/validateClientWithCache.js";
import { preserveFieldsFromOriginal } from "../../../../routes/assist.draft-graph.js";
import { simpleRepair } from "../../../../services/repair.js";
import { stabiliseGraph, ensureDagAndPrune } from "../../../../orchestrator/index.js";
import { log } from "../../../../utils/telemetry.js";

/**
 * Coerce a raw violations array from the external PLoT engine into plain strings.
 *
 * The PLoT engine's /v1/validate endpoint is declared to return violations?: string[],
 * but the actual runtime payload may contain structured objects
 * { code, severity, level, at?, suggestion? }. Template literal interpolation of an
 * object produces "[object Object]", making log lines useless.
 * This function normalises both formats so logs always receive readable text.
 *
 * Output format: "[CODE] at <location>: <message>"
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
  const issueCodes = issues.map((v) => {
    const match = v.match(/^\[([^\]]+)\]/);
    return match ? match[1] : "prose";
  });

  if (ctx.llmRepairNeeded === false) {
    log.info({
      event: "REPAIR_SKIPPED",
      reason: "deterministic_sweep_sufficient",
      remaining_violations: ctx.remainingViolations?.length ?? 0,
      correlation_id: ctx.requestId,
    }, "Skipping LLM repair — deterministic sweep resolved all actionable violations");
  } else {
    // Bucket-C violations survived the sweep. Pre-2.731 this routed to the
    // gpt-4.1 `repair_graph` call (0/12 successes, ~44.7s per failed turn).
    // Now: deterministic normalisation only; anything still blocking fails
    // closed at the post-enforcement gate (substep 9b) → honest 422
    // retryable:true.
    log.info({
      event: "REPAIR_SKIPPED",
      reason: "llm_repair_removed",
      violation_count: issues.length,
      violation_codes: issueCodes,
      correlation_id: ctx.requestId,
    }, "LLM repair removed (ROADMAP 2.731) — deterministic normalisation only; unfixable violations fail closed at the post-enforcement gate");
  }

  // Deterministic normalisation — byte-identical to the pre-2.731 fallback
  // that rescued every delivered turn in the measurement window.
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
}
