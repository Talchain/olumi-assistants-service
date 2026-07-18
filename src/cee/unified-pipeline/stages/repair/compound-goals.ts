/**
 * Stage 4 Substep 5: Compound goals
 *
 * Source: Pipeline B lines 1578-1628
 * Extracts compound goals from brief, remaps constraint targets against
 * actual graph nodes, and emits goal_constraints[] for the response.
 *
 * Constraint data lives only in goal_constraints[] — constraints are metadata,
 * not causal factors, so they must NOT be emitted as graph nodes or edges
 * (F.6: CEE generates, PLoT computes, UI displays).
 */

import type { StageContext } from "../../types.js";
import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
  remapConstraintTargets,
} from "../../../compound-goal/index.js";
import { log } from "../../../../utils/telemetry.js";

export function runCompoundGoals(ctx: StageContext): void {
  if (!ctx.graph) return;

  const compoundGoalResult = extractCompoundGoals(ctx.effectiveBrief, { includeProxies: false });

  const graphNodes = (ctx.graph as any).nodes as Array<{ id: string; kind?: string; label?: string }>;
  const existingNodeIds = new Set(graphNodes.map((n) => n.id));
  const existingNodeIdList = [...existingNodeIds];

  // Build label map for label-based fuzzy matching fallback
  const nodeLabels = new Map<string, string>();
  for (const n of graphNodes) {
    if (n.label) nodeLabels.set(n.id, n.label);
  }

  // Find goal node ID for temporal constraint binding
  const goalNode = graphNodes.find((n) => n.kind === "goal");
  const goalNodeId = goalNode?.id;

  // ── Regex-extracted constraints ──────────────────────────────────────
  let regexConstraints: any[] = [];
  if (compoundGoalResult.constraints.length > 0) {
    const remapResult = remapConstraintTargets(
      compoundGoalResult.constraints,
      existingNodeIdList,
      nodeLabels,
      ctx.requestId,
      goalNodeId,
    );
    if (remapResult.constraints.length > 0) {
      const normalised = normaliseConstraintUnits(remapResult.constraints);
      regexConstraints = toGoalConstraints(normalised);
    }

    log.info({
      event: "cee.compound_goal.regex_extracted",
      request_id: ctx.requestId,
      regex_count: regexConstraints.length,
      constraints_remapped: remapResult.remapped,
      constraints_rejected_junk: remapResult.rejected_junk,
      constraints_rejected_no_match: remapResult.rejected_no_match,
      is_compound: compoundGoalResult.isCompound,
    }, `Regex extracted ${regexConstraints.length} constraint(s)`);
  }

  // ── LLM-emitted constraints ─────────────────────────────────────────
  // LLM constraints have richer metadata (source_quote, confidence,
  // provenance) and take precedence when both sources produce a
  // constraint for the same node_id + operator pair.
  const llmEmitted = Array.isArray(ctx.llmGoalConstraints) ? ctx.llmGoalConstraints : [];
  const llmConstraints = llmEmitted.filter(
    (c: any) => c && typeof c === "object" && typeof c.node_id === "string"
      && existingNodeIds.has(c.node_id),
  );
  const llmSkipped = llmEmitted.length - llmConstraints.length;

  // Observability: the node-existence filter above is a SILENT drop. It was
  // previously logged only when `llmConstraints.length > 0`, so a draft where
  // EVERY LLM-emitted constraint failed the filter produced no telemetry at
  // all — and the function then early-returns below, leaving
  // `ctx.goalConstraints` undefined. That made two very different failures
  // indistinguishable in staging logs:
  //   (a) the model never emitted goal_constraints[]           -> prompt problem
  //   (b) the model emitted them against unmatched node_ids    -> binding problem
  // Both surface identically as an absent `draft_graph.goal_constraints`.
  // Log unconditionally on emission, and WARN whenever anything was dropped,
  // carrying the offending node_ids so (b) is diagnosable from logs alone.
  if (llmSkipped > 0) {
    log.warn({
      event: "cee.compound_goal.llm_dropped",
      request_id: ctx.requestId,
      llm_emitted: llmEmitted.length,
      llm_count: llmConstraints.length,
      llm_skipped: llmSkipped,
      skipped_node_ids: llmEmitted
        .filter((c: any) => !llmConstraints.includes(c))
        .map((c: any) => (c && typeof c === "object" ? (c.node_id ?? null) : null)),
      graph_node_ids: existingNodeIdList,
    }, `LLM emitted ${llmEmitted.length} constraint(s); ${llmSkipped} dropped — node_id does not match any graph node`);
  } else if (llmConstraints.length > 0) {
    log.info({
      event: "cee.compound_goal.llm_emitted",
      request_id: ctx.requestId,
      llm_emitted: llmEmitted.length,
      llm_count: llmConstraints.length,
      llm_skipped: 0,
    }, `LLM emitted ${llmConstraints.length} constraint(s) with valid node targets`);
  }

  // ── Merge: LLM wins on duplicate (node_id + operator) ────────────────
  // The semantic identity of a constraint is its target node + operator.
  // constraint_id is an implementation label, not a dedup key — regex and
  // LLM will assign different IDs to the same semantic constraint.
  if (llmConstraints.length === 0 && regexConstraints.length === 0) return;

  const merged = new Map<string, any>();
  const dedupeKey = (c: any) => `${c.node_id}::${c.operator ?? ""}`;

  // Regex first (lower priority)
  for (const c of regexConstraints) {
    merged.set(dedupeKey(c), c);
  }
  // LLM overwrites on same key (higher priority — richer metadata)
  for (const c of llmConstraints) {
    merged.set(dedupeKey(c), c);
  }

  ctx.goalConstraints = [...merged.values()];

  log.info({
    event: "cee.compound_goal.integrated",
    request_id: ctx.requestId,
    constraint_count: ctx.goalConstraints.length,
    from_regex: regexConstraints.length,
    from_llm: llmConstraints.length,
  }, "Compound goal constraints emitted to goal_constraints[]");
}
