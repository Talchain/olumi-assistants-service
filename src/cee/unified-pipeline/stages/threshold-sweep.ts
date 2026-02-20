/**
 * Stage 4b: Threshold Sweep — deterministic goal threshold hygiene
 *
 * Strips fabricated goal_threshold fields before the response reaches PLoT.
 * Runs after Stage 4 (Repair) when all labels and threshold fields are final.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ Decision table (applied per goal node)                                     │
 * ├───────────────────────────────────────┬─────────┬──────────┬───────────────┤
 * │ Condition                             │  Warn?  │  Strip?  │ Repair code   │
 * ├───────────────────────────────────────┼─────────┼──────────┼───────────────┤
 * │ raw absent                            │   no    │   yes    │ STRIPPED_NO_RAW│
 * │ raw present + round + label has digits│   no    │   no     │ (none)        │
 * │ raw present + round + label no digits │   yes   │   yes    │ POSSIBLY_INF. │
 * │                                       │         │          │ + STRIPPED_NO_D│
 * └───────────────────────────────────────┴─────────┴──────────┴───────────────┘
 *
 * Fields stripped (atomic group): goal_threshold, goal_threshold_raw,
 *   goal_threshold_unit, goal_threshold_cap.
 *
 * Known limitation: any digit character in label prevents stripping, including
 * version tokens like "v2". False negatives are safer than false positives.
 */

import type { StageContext } from "../types.js";
import { log } from "../../../utils/telemetry.js";

interface Repair {
  code: string;
  path: string;
  action: string;
}

const THRESHOLD_FIELDS = [
  "goal_threshold",
  "goal_threshold_raw",
  "goal_threshold_unit",
  "goal_threshold_cap",
] as const;

/**
 * Stage 4b entry point. Follows pipeline convention:
 * takes StageContext, returns Promise<void>, mutates in-place.
 */
export async function runStageThresholdSweep(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;
  const nodes = (ctx.graph as any).nodes;
  if (!Array.isArray(nodes)) return;

  const start = Date.now();
  const repairs: Repair[] = [];

  for (const node of nodes) {
    // Skip malformed entries and non-goal nodes
    if (!node || typeof node !== "object") continue;
    if (node.kind !== "goal") continue;

    const gt = node.goal_threshold;
    const gtRaw = node.goal_threshold_raw;

    // Null/undefined guard: skip if goal_threshold is absent
    if (gt === undefined || gt === null) continue;

    // ── Step 4b: raw absent → strip ─────────────────────────────────────
    if (gtRaw === undefined || gtRaw === null) {
      for (const field of THRESHOLD_FIELDS) delete node[field];
      repairs.push({
        code: "GOAL_THRESHOLD_STRIPPED_NO_RAW",
        path: `nodes[${node.id}].goal_threshold`,
        action: "Goal threshold removed: no raw target value extracted from brief",
      });
      continue; // stripped — skip 4b-ii/iii for this node
    }

    // ── Step 4b-ii + 4b-iii: inferred heuristic ────────────────────────
    // Finite number guard: skip if raw is not a finite number
    if (typeof gtRaw !== "number" || !Number.isFinite(gtRaw)) continue;

    const rawIsRound = Number.isInteger(gtRaw) || gtRaw % 5 === 0;
    const labelHasNoDigits = !/\d/.test(node.label ?? "");

    if (rawIsRound && labelHasNoDigits) {
      // Step 4b-ii: warn
      repairs.push({
        code: "GOAL_THRESHOLD_POSSIBLY_INFERRED",
        path: `nodes[${node.id}].goal_threshold`,
        action: "warned",
      });

      // Step 4b-iii: strip
      for (const field of THRESHOLD_FIELDS) delete node[field];
      repairs.push({
        code: "GOAL_THRESHOLD_STRIPPED_NO_DIGITS",
        path: `nodes[${node.id}].goal_threshold`,
        action: "removed",
      });
    }
  }

  // ── Write repairs to canonical surface ──────────────────────────────────
  if (!ctx.deterministicRepairs) ctx.deterministicRepairs = [];
  ctx.deterministicRepairs.push(...repairs);

  // ── Trace continuity: update deterministic_sweep counts ─────────────────
  const sweepTrace = (ctx.repairTrace as any)?.deterministic_sweep;
  if (sweepTrace) {
    sweepTrace.goal_threshold_stripped =
      repairs.filter((r) => r.code === "GOAL_THRESHOLD_STRIPPED_NO_RAW" || r.code === "GOAL_THRESHOLD_STRIPPED_NO_DIGITS").length;
    sweepTrace.goal_threshold_possibly_inferred =
      repairs.filter((r) => r.code === "GOAL_THRESHOLD_POSSIBLY_INFERRED").length;
  }

  // ── Telemetry (emitted when stage reaches execution body; early returns
  //    for missing graph/nodes skip this — those are caught by orchestrator) ──
  const durationMs = Date.now() - start;
  log.info({
    event: "cee.threshold_sweep.completed",
    request_id: ctx.requestId,
    duration_ms: durationMs,
    repair_count: repairs.length,
    codes: repairs.length > 0 ? [...new Set(repairs.map((r) => r.code))] : [],
  }, `Threshold sweep: ${repairs.length} repair(s) in ${durationMs}ms`);
}
