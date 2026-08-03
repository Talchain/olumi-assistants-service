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

/**
 * ROADMAP 2.349 (ROOT HALF) — a deadline is not a hard constraint, and
 * `goal_constraints[]` is the one array that means "hard constraint".
 *
 * WHAT THIS CLOSES. `extractTemporalConstraints` mints a constraint from any
 * time phrase in the brief ("…within 18 months" → `{operator:'<=', value:18,
 * unit:'months', label:'Delivery deadline', provenance:'inferred'}`), and
 * `remapConstraintTargets` step 0 then force-binds it to the GOAL node — a
 * months-unit limit welded onto a node measured in £. From there it was
 * persisted, forwarded to PLoT on every analysis run, deterministically
 * deleted by PLoT (time is not a modelled dimension, so it cannot be), and
 * finally read BACK by CEE's verdict as "a condition the user set that the
 * engine did not check" — which withheld the leading option on EVERY run of
 * EVERY brief containing a time phrase, unescapably, with three untruths in
 * the copy. Diagnosis: `diagnosis-gap5-leader-null.md`.
 *
 * WHY THE FILTER LIVES HERE AND NOT IN THE EXTRACTOR. Two producers write this
 * array — the regex extractor above and the LLM's own `goal_constraints[]`
 * (`ctx.llmGoalConstraints`, whose schema declares `deadline_metadata`:
 * `src/schemas/assist.ts`). Fixing only the regex path would leave the LLM
 * path minting the identical unevaluable constraint, and the defect would
 * return the first time the model emitted one. This is the single point BOTH
 * sources pass through, so the rule is stated ONCE, over the merged set:
 * a deadline-bearing entry never enters `goal_constraints[]`, whoever made it.
 *
 * WHAT IS NOT LOST. The extraction is untouched — `deadline_metadata` is still
 * produced and still available to `generateConstraintNodes`; the time phrase
 * is still in the brief and in the goal's own text; and the UI reads
 * `goal_constraints` nowhere (audit-2262-model-tab.md: 0 occurrences). What is
 * removed is only the entry's status as a WITHHOLD-TRIGGERING hard constraint
 * — the one effect it had, and a purely destructive one.
 *
 * Detection is by `deadline_metadata` PRESENCE, which is the same signal
 * PLoT's own DROP RULE 1 uses (`normalisation/constraint-filter.ts`). Same
 * signal, same verdict, one hop earlier — so CEE stops asking the engine a
 * question it has already published that it cannot answer.
 *
 * Pure. Exported for direct test.
 */
export function partitionTemporalNonBinding<T>(
  constraints: readonly T[],
): { binding: T[]; temporal: T[] } {
  const binding: T[] = [];
  const temporal: T[] = [];
  for (const c of constraints) {
    const meta =
      c !== null && typeof c === "object"
        ? (c as Record<string, unknown>).deadline_metadata
        : undefined;
    (meta !== undefined && meta !== null ? temporal : binding).push(c);
  }
  return { binding, temporal };
}

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

  // ROADMAP 2.349 — the single, source-agnostic gate. See
  // `partitionTemporalNonBinding` for why it is here rather than in either
  // producer, and for what it deliberately does NOT remove.
  const { binding, temporal } = partitionTemporalNonBinding([...merged.values()]);

  if (temporal.length > 0) {
    // FAIL LOUD, not silent (CLAUDE.md trap 12): a drop that leaves no trace
    // is how the original force-bind survived unexamined for months. Ids and
    // counts only — no labels, no thresholds, no user text.
    log.info({
      event: "cee.compound_goal.temporal_not_binding",
      request_id: ctx.requestId,
      dropped_count: temporal.length,
      dropped_constraint_ids: temporal.map((c: any) => c?.constraint_id ?? null),
      dropped_node_ids: temporal.map((c: any) => c?.node_id ?? null),
      reason: "temporal_not_a_hard_constraint",
    }, `${temporal.length} temporal constraint(s) withheld from goal_constraints[] — a deadline is not evaluable on a static causal graph`);
  }

  ctx.goalConstraints = binding;

  log.info({
    event: "cee.compound_goal.integrated",
    request_id: ctx.requestId,
    constraint_count: ctx.goalConstraints.length,
    from_regex: regexConstraints.length,
    from_llm: llmConstraints.length,
    temporal_withheld: temporal.length,
  }, "Compound goal constraints emitted to goal_constraints[]");
}
