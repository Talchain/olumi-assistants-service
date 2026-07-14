/**
 * Graceful dedup of AI-inferred duplicate options at the OPTIONS_IDENTICAL
 * bypass (ROADMAP 2.53, mitigation rung 1 — failure-path only).
 *
 * OBSERVED DEFECT (staging 2026-07-14, build 73b2129): on two-pole briefs the
 * draft LLM sometimes invents a "hybrid" option whose interventions are
 * identical to a pole's (e.g. {fac_enterprise_focus:0, fac_smb_focus:1}).
 * Both colliding options are AI-inferred with NO explicit `is_baseline`, so:
 *   - substep 0.9 (#203 auto-baseline dedup) cannot fire (it requires an
 *     explicit is_baseline===true duplicate with a non-baseline survivor);
 *   - substep 1.5 (#202 bypass) deliberately skips LLM repair and fails fast;
 *   - route-v2 wraps the pipeline 400 as HTTP 500 INTERNAL_ERROR
 *     retryable:false — the user waits ~55s for a dead generic error.
 * During one burst 12/18 drafts on a single brief died this way.
 *
 * MITIGATION (strictly-better principle): when the duplicate group that
 * reached the bypass consists ENTIRELY of plain AI-drafted options, drop the
 * later-listed duplicate(s), keep the first-listed one, remove every edge
 * referencing a dropped id (the exact mechanism #203's dedup uses), and let
 * the draft continue — a 500 becomes a valid n-1-option draft.
 *
 * SCOPE GUARDS — the dedup DECLINES (returns null, zero mutation, today's
 * fail-fast error fires byte-identically) when ANY of these hold:
 *   1. A colliding group contains an option with explicit is_baseline===true.
 *      Those are #203's territory: the fireable case was already handled at
 *      substep 0.9, and #203 deliberately routes the all-explicit-baseline
 *      case to the typed clarification. Not re-litigated here.
 *   2. A colliding group contains an option that heuristically LOOKS like a
 *      baseline (label "Status Quo"/"Baseline"/…, id ending _status_quo/
 *      _baseline). #203's round-2 review ruled heuristic grounds insufficient
 *      to delete an option the user may have named deliberately; that ruling
 *      covers this drop too.
 *   3. A colliding group contains MORE THAN ONE from_brief-marked option
 *      (extractionType "explicit"/"observed" — the same vocabulary
 *      nodeProvenanceDisplay maps to `from_brief`). Two user-anchored options
 *      the model failed to differentiate is a genuine clarification case.
 *      (Exactly one from_brief option in a group is fine: it is KEPT and the
 *      AI-inferred duplicates are dropped.)
 *   4. Fewer than 2 option nodes would remain after the planned drops — a
 *      1-option decision graph is not a decision.
 *   5. The graph has no colliding groups at all (violation/graph mismatch —
 *      only reachable in synthetic states; preserve the error).
 *
 * KEEP-CHOICE (deterministic): within a group, keep the single
 * from_brief-marked option if present, else the FIRST-LISTED option in graph
 * node order. LLM emission order tracks brief salience — the poles named in
 * the brief are emitted before the invented hybrid — so first-listed keeps
 * the brief's alternative and drops the model's redundant invention. Edges
 * referencing dropped ids are removed wholesale (no id remapping — #203's
 * mechanism); the survivor's own edges are untouched, so nothing dangles.
 *
 * AFTER THE DROP the post-sweep state (ctx.remainingViolations /
 * ctx.llmRepairNeeded) is stale, so it is re-derived from the mutated graph
 * with EXACTLY the deterministic sweep's step 7+8 recipe: authoritative
 * revalidation + proactive disconnected-option check + Bucket-C gating. Any
 * OTHER violations of the post-drop graph therefore route exactly as they
 * would on a draft that never contained the duplicate.
 *
 * USER DISCLOSURE: deliberately silent (telemetry + repairTrace only), for
 * the same reason #203's dedup is silent — the dropped option is an AI
 * artefact the user never asked for and never saw, so no claim about their
 * decision is being made or broken; surfacing "we removed a duplicate you
 * never saw" adds confusion with zero actionable content. Operators keep
 * observability via the `cee.options_identical.dropped_duplicate` event and
 * the repair trace.
 */

import type { StageContext } from "../../types.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";
import { validateGraph } from "../../../../validators/graph-validator.js";
import type { GraphT } from "../../../../schemas/graph.js";
import { findDisconnectedOptions } from "./status-quo-fix.js";
import {
  buildSignature,
  isExplicitBaseline,
  looksHeuristicallyLikeBaseline,
  type OptionLike,
  type EdgeLike,
} from "./auto-baseline-dedup.js";

/**
 * Bucket C codes (semantic, LLM-repair-only), used to re-derive
 * ctx.llmRepairNeeded after the drop with the deterministic sweep's exact
 * formula. KEEP IN SYNC with BUCKET_C_CODES in deterministic-sweep.ts —
 * duplicated (not imported) because the sweep module is vi.mock-replaced
 * wholesale in wiring tests, which would turn an import into `undefined`.
 */
const BUCKET_C_CODES = new Set([
  "NO_PATH_TO_GOAL",
  "NO_EFFECT_PATH",
  "UNREACHABLE_FROM_DECISION",
  "MISSING_BRIDGE",
  "MISSING_GOAL",
  "MISSING_DECISION",
  "INVALID_EDGE_TYPE",
  "OPTIONS_IDENTICAL",
  "GOAL_NUMBER_AS_FACTOR",
  "INSUFFICIENT_OPTIONS",
]);

/**
 * from_brief detection mirroring nodeProvenanceDisplay
 * (src/cee/transforms/provenance-display.ts): extractionType
 * "explicit"/"observed" → from_brief; anything else (inferred/range/absent)
 * → ai_inferred. Options normally carry no extractionType at the repair
 * stage (the V3 transform defaults them to ai_inferred provenance), so this
 * is a defensive keep-signal, not the common case.
 */
function isFromBriefMarked(o: OptionLike): boolean {
  const et = o.data?.extractionType ?? o.extractionType;
  return et === "explicit" || et === "observed";
}

export interface OptionsIdenticalDedupReport {
  readonly dropped_option_ids: readonly string[];
  readonly kept_option_ids: readonly string[];
  readonly dropped_edge_count: number;
  readonly groups_resolved: number;
}

/**
 * Attempt to resolve every OPTIONS_IDENTICAL collision by dropping
 * AI-inferred duplicates. Called ONLY from runOptionsIdenticalBypass, i.e.
 * only on drafts that would otherwise fail fast — a draft that succeeds
 * today can never reach this code.
 *
 * Returns a report when the graph was deduped and the pipeline may continue;
 * returns null (with NO mutation) when any scope guard declines, so the
 * caller's existing fail-fast error path runs byte-identically.
 */
export function attemptOptionsIdenticalGracefulDedup(
  ctx: StageContext,
): OptionsIdenticalDedupReport | null {
  if (!ctx.graph) return null;
  const graph = ctx.graph as { nodes?: OptionLike[]; edges?: EdgeLike[] };
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const optionNodes = nodes.filter((n) => n.kind === "option");
  if (optionNodes.length < 2) return null;

  // Group options by intervention signature — the validator's own identity
  // definition (buildSignature mirrors graph-validator.ts:241-246).
  const signatureToOptions = new Map<string, OptionLike[]>();
  for (const opt of optionNodes) {
    const sig = buildSignature(opt.data?.interventions);
    if (sig === null) continue;
    const existing = signatureToOptions.get(sig) ?? [];
    existing.push(opt);
    signatureToOptions.set(sig, existing);
  }

  // ── Plan phase (pure — no mutation until every group is resolvable) ──
  const plannedDropIds: string[] = [];
  const keptOptionIds: string[] = [];
  let groupsResolved = 0;

  for (const [, group] of signatureToOptions) {
    if (group.length < 2) continue;

    // Guard 1: explicit-baseline duplicates are #203's territory.
    if (group.some(isExplicitBaseline)) return null;
    // Guard 2: heuristic-baseline-shaped options must not be silently
    // deleted, and deleting their counterpart would break the deliberate
    // #203 routing of these collisions to the typed clarification.
    if (group.some(looksHeuristicallyLikeBaseline)) return null;

    // Guard 3: at most one from_brief-marked option per group.
    const fromBrief = group.filter(isFromBriefMarked);
    if (fromBrief.length > 1) return null;

    // Keep-choice: the from_brief option if present, else first-listed
    // (group order == graph node order, because groups were built by
    // iterating graph nodes).
    const keeper = fromBrief[0] ?? group[0];
    for (const opt of group) {
      if (opt === keeper) continue;
      // Every dropped option needs a real id so its edges can be removed.
      if (typeof opt.id !== "string" || opt.id.length === 0) return null;
      plannedDropIds.push(opt.id);
    }
    if (typeof keeper.id === "string") keptOptionIds.push(keeper.id);
    groupsResolved += 1;
  }

  // Guard 5: nothing resolvable (violation/graph mismatch) → preserve error.
  if (groupsResolved === 0 || plannedDropIds.length === 0) return null;

  // Guard 4: a 1-option decision graph is not a decision.
  if (optionNodes.length - plannedDropIds.length < 2) return null;

  // ── Apply phase — #203's mechanism: drop nodes, drop touching edges ──
  const droppedSet = new Set(plannedDropIds);
  const edgesBefore = Array.isArray(graph.edges) ? graph.edges : [];
  const edgesAfter = edgesBefore.filter(
    (e) => !droppedSet.has(e.from ?? "") && !droppedSet.has(e.to ?? ""),
  );
  const droppedEdgeCount = edgesBefore.length - edgesAfter.length;
  graph.nodes = nodes.filter((n) => !droppedSet.has(n.id ?? ""));
  graph.edges = edgesAfter;

  // ── Re-derive post-sweep state from the mutated graph ──
  // Mirrors deterministic-sweep steps 7+8 exactly (authoritative
  // revalidation → proactive disconnected-option check → Bucket-C gating),
  // so any residual violations route as they would on a duplicate-free draft.
  const revalidation = validateGraph({
    graph: ctx.graph as GraphT,
    requestId: ctx.requestId,
    phase: "post_options_identical_dedup",
    coaching: ctx.coaching,
    causalClaims: ctx.causalClaims,
  });
  const remainingErrors = [...revalidation.errors];

  const disconnectedAfter = findDisconnectedOptions(ctx.graph as GraphT);
  const proactiveDisconnected = disconnectedAfter.length > 0;
  if (proactiveDisconnected) {
    const existingPaths = new Set(
      remainingErrors.filter((v) => v.code === "NO_PATH_TO_GOAL").map((v) => v.path),
    );
    for (const optId of disconnectedAfter) {
      const path = `nodes[${optId}]`;
      if (!existingPaths.has(path)) {
        remainingErrors.push({
          code: "NO_PATH_TO_GOAL" as any,
          severity: "error" as any,
          message: `Option "${optId}" has no directed path to goal (proactive check)`,
          path,
        });
      }
    }
  }

  ctx.remainingViolations = remainingErrors.map((v) => ({
    code: v.code,
    path: v.path,
    message: v.message,
    ...((v as { context?: Record<string, unknown> }).context
      ? { context: (v as { context?: Record<string, unknown> }).context }
      : {}),
  }));

  // Defensive: if the drop somehow failed to clear the collision, hand back
  // to the caller's fail-fast path (it re-reads remainingViolations' first
  // OPTIONS_IDENTICAL entry). Unreachable when the plan phase ran — one
  // survivor per signature cannot re-collide — but never continue past a
  // live OPTIONS_IDENTICAL.
  if (remainingErrors.some((v) => v.code === "OPTIONS_IDENTICAL")) {
    return null;
  }

  const remainingBucketC = remainingErrors.filter((v) => BUCKET_C_CODES.has(v.code));
  const externalValidationNeeded = !revalidation.valid || proactiveDisconnected;
  ctx.llmRepairNeeded = remainingBucketC.length > 0 && externalValidationNeeded;

  const report: OptionsIdenticalDedupReport = {
    dropped_option_ids: plannedDropIds,
    kept_option_ids: keptOptionIds,
    dropped_edge_count: droppedEdgeCount,
    groups_resolved: groupsResolved,
  };

  // ── Observability: trace + warning + log + telemetry ──
  ctx.repairTrace = {
    ...(ctx.repairTrace ?? {}),
    options_identical_dedup: {
      ran: true,
      dropped_option_ids: plannedDropIds,
      kept_option_ids: keptOptionIds,
      dropped_edge_count: droppedEdgeCount,
      groups_resolved: groupsResolved,
    },
  };

  // Informational, not degraded — the resulting graph is fully valid and
  // the drop removed an AI artefact, not user content (mirrors the
  // auto-baseline dedup's warning posture).
  ctx.pipelineOutcome.warnings.push({
    stage: "repair",
    error: `options_identical_dedup: dropped ${plannedDropIds.length} AI-inferred duplicate option(s) (${plannedDropIds.join(", ")}); kept ${keptOptionIds.join(", ")}`,
    degraded: false,
  });

  log.warn(
    {
      event: "cee.options_identical.dropped_duplicate",
      request_id: ctx.requestId,
      dropped_option_ids: plannedDropIds,
      kept_option_ids: keptOptionIds,
      dropped_edge_count: droppedEdgeCount,
      groups_resolved: groupsResolved,
    },
    `OPTIONS_IDENTICAL graceful dedup: dropped ${plannedDropIds.length} AI-inferred duplicate option(s) instead of failing the draft`,
  );
  emit(TelemetryEvents.CeeOptionsIdenticalDroppedDuplicate, {
    request_id: ctx.requestId,
    dropped_option_ids_count: plannedDropIds.length,
    dropped_edge_count: droppedEdgeCount,
    groups_resolved: groupsResolved,
  });

  return report;
}
