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
import { fieldDeletion, recordFieldDeletions, type FieldDeletionEvent } from "../utils/field-deletion-audit.js";
import { CEE_MINTED_GOAL_FIELDS } from "../../../adapters/llm/normalisation.js";

interface Repair {
  code: string;
  path: string;
  action: string;
}

/**
 * The goal-threshold field group, deleted ATOMICALLY at both strip sites below.
 *
 * ⚠ ANY FIELD THAT DESCRIBES THE THRESHOLD BELONGS IN HERE, NOT BESIDE IT.
 * `goal_threshold_frame` (ROADMAP 2.258) was added to the node contract without
 * joining this group, which left a sweep-fired goal carrying a frame that
 * described a number the sweep had just removed — breaking the invariant the
 * rest of the frame work asserts, that the frame never travels without its
 * threshold. That is CLAUDE.md trap 12 in miniature: a hand-maintained group is
 * exactly the thing a later field gets added NEXT TO instead of INTO.
 *
 * ⚠⚠ AND IT HAPPENED AGAIN, TO THIS VERY LIST (ROADMAP 2.281). `goal_baseline`
 * and `goal_baseline_raw` (2.273) were added to the node contract BESIDE this
 * group rather than INTO it — so a strip removed the threshold quintet and left
 * the baseline behind, orphaning an `observed_state` that described a number
 * that no longer existed. Trap 12 struck inside the fix written to warn about
 * trap 12, because the warning was PROSE and prose cannot fail a build.
 *
 * THE FIX IS TO STOP HAND-MAINTAINING IT. This group is now the SAME constant
 * the #789 ingress strip uses — `CEE_MINTED_GOAL_FIELDS`, "every field of the
 * goal-threshold contract CEE mints for itself" — which already carries a
 * DERIVED set-equality test against every `goal_*` field `schemas/graph.ts`
 * declares. A new goal field now joins this group automatically, and if the
 * scan ever stops seeing the declarations it claims to check, that test REDs.
 * One source of truth, machine-checked, no list to remember.
 */
const THRESHOLD_FIELDS = CEE_MINTED_GOAL_FIELDS;

/**
 * Stage 4b entry point. Follows pipeline convention:
 * takes StageContext, returns Promise<void>, mutates in-place.
 */
export async function runStageThresholdSweep(ctx: StageContext): Promise<void> {
  const noopTrace = { ran: false, duration_ms: 0, goals_checked: 0, strips_applied: 0, warnings_emitted: 0, codes: [] as string[] };

  if (!ctx.graph) { ctx.thresholdSweepTrace = noopTrace; return; }
  const nodes = (ctx.graph as any).nodes;
  if (!Array.isArray(nodes)) { ctx.thresholdSweepTrace = noopTrace; return; }

  const start = Date.now();
  const repairs: Repair[] = [];
  const deletions: FieldDeletionEvent[] = [];

  // ── ROADMAP 2.281: which goals carry an ENRICHER-MINTED threshold ────────
  // Stage 4 (Repair) runs between the mint and this sweep and can MERGE goals,
  // rewriting `mergedGoalId → primaryGoalId` into ctx.nodeRenames. A bare id
  // match would therefore lose the attestation exactly when goals merged, so
  // the surviving primary inherits the attestation of anything merged into it.
  const attested = new Set<string>(ctx.enricherMintedGoalIds ?? []);
  if (ctx.nodeRenames) {
    for (const [mergedId, primaryId] of ctx.nodeRenames) {
      if (attested.has(mergedId)) attested.add(primaryId);
    }
  }

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
      for (const field of THRESHOLD_FIELDS) {
        if (node[field] !== undefined) {
          deletions.push(fieldDeletion('threshold-sweep', node.id, field, 'THRESHOLD_STRIPPED_NO_RAW'));
        }
        delete node[field];
      }
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

    // ── ROADMAP 2.281: the PROVENANCE KEEP ──────────────────────────────
    // The heuristic below asks "does this number LOOK inferred?" — round raw,
    // and a label that does not mention it. That question was answerable when a
    // model could author a threshold. Post-#789 it cannot: the enricher is the
    // only draft mint, and it mints only a number the user stated in the brief,
    // read deterministically by regex.
    //
    // So on a digit-free goal label ("Grow annual revenue" — a perfectly
    // ordinary label the model writes), `Number.isInteger(6_000_000)` is true
    // and the heuristic deleted a target the USER supplied. Measured: the
    // worked-example brief minted 0.8/'level'/0.5333 at Stage 3 and this sweep
    // removed it at Stage 4b, leaving the baseline orphaned.
    //
    // A run that ATTESTED its own mint is not guessing, so it is not swept.
    // Note what this does NOT weaken: the `raw absent → strip` rule above still
    // applies to every node including attested ones, and any threshold this run
    // did not mint is still judged by the heuristic exactly as before.
    if (attested.has(node.id)) continue;

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
      for (const field of THRESHOLD_FIELDS) {
        if (node[field] !== undefined) {
          deletions.push(fieldDeletion('threshold-sweep', node.id, field, 'THRESHOLD_STRIPPED_NO_DIGITS'));
        }
        delete node[field];
      }
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

  // ── Trace summary for pipelineTrace.threshold_sweep ────────────────────
  const durationMs = Date.now() - start;
  const goalNodes = nodes.filter((n: any) => n && typeof n === "object" && n.kind === "goal");
  const codes = repairs.length > 0 ? [...new Set(repairs.map((r) => r.code))] : [];
  ctx.thresholdSweepTrace = {
    ran: true,
    duration_ms: durationMs,
    goals_checked: goalNodes.length,
    strips_applied: repairs.filter((r) =>
      r.code === "GOAL_THRESHOLD_STRIPPED_NO_RAW" || r.code === "GOAL_THRESHOLD_STRIPPED_NO_DIGITS",
    ).length,
    warnings_emitted: repairs.filter((r) => r.code === "GOAL_THRESHOLD_POSSIBLY_INFERRED").length,
    codes,
  };

  // ── Field deletion audit ──────────────────────────────────────────────
  recordFieldDeletions(ctx, 'threshold-sweep', deletions);

  // ── Telemetry ────────────────────────────────────────────────────────
  log.info({
    event: "cee.threshold_sweep.completed",
    request_id: ctx.requestId,
    duration_ms: durationMs,
    repair_count: repairs.length,
    codes,
  }, `Threshold sweep: ${repairs.length} repair(s) in ${durationMs}ms`);
}
