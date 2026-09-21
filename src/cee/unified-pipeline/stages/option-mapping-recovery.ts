/**
 * ⭐⭐ STAGE 3b — OPTION MAPPING RECOVERY. The draft seam's second chance at the
 * one question only the drafter can answer: which factors does THIS option move?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT SITS BETWEEN ENRICH AND REPAIR, AND WHY THAT ORDER IS THE DESIGN.
 *
 * AFTER ENRICH because the factor set is not complete until enrichment has run —
 * asking before it would offer the model a factor list the finished graph does
 * not have. BEFORE REPAIR because `fixStatusQuoConnectivity` is what wires an
 * unmapped option to the UNION of its siblings' targets, and the whole point is
 * that a genuine mapping should exist before the union is reached for. An option
 * this stage maps has a path to goal, so the connectivity repair does not fire
 * for it at all and no `origin: "repair"` edge is minted in its name.
 *
 * ⚠ IT ALSO MEANS THE TRIGGER IS SIMPLE AND CANNOT DRIFT. At this point in the
 * pipeline NO repair-authored edge exists yet, so "zero option→factor edges" and
 * "zero NON-repair option→factor edges" are the same predicate. Placing this
 * stage after repair would have forced a second copy of
 * `isRepairAuthoredOptionFactorEdge`'s question — two authorities on one fact,
 * which is this estate's chronic defect (trap 21).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT MAY AND MAY NOT DO — each clause is load-bearing.
 *
 *   · IT MAPS, IT DOES NOT MEASURE. Edges only. The magnitude is proposed by
 *     the already-wired estimate batch (`readiness-value-batch.ts`), stamped
 *     `cee_hypothesis`, and applied only after the user approves one review
 *     card. Writing a value here would mint a second producer for a number that
 *     already has one, and would skip the review.
 *   · IT NEVER TOUCHES THE BASELINE. A status-quo option has no interventions
 *     BY DEFINITION — supplying the mapping stops it being the status quo — and
 *     `computeAnalysisReadyStatusWithReason` already returns `ready` for it
 *     (`transforms/option-status.ts:316-321`). `readIsBaseline` is THE reader of
 *     that flag and is reused rather than re-spelled.
 *   · IT NEVER OVERWRITES A STATED MAPPING. An option that already carries
 *     interventions, or already carries an option→factor edge, is not asked
 *     about. The drafter's own judgement stands.
 *   · IT REQUIRES A MAPPED SIBLING. With no mapped option anywhere in the graph
 *     there is no evidence that Olumi knows how this decision's options relate
 *     to its factors, and the honest answer is the one the product already
 *     gives. This is the clause that PRESERVES the refusal rather than
 *     abolishing it.
 *   · IT REFUSES A NON-SELECTION. A model that returns EVERY factor in the
 *     graph has made no judgement about the option — it has reproduced the
 *     connectivity repair's union by another route, and with a mark that says
 *     the drafter chose it. That answer is discarded and the option falls back
 *     to today's path. The bound is DERIVED from the graph's own factor count,
 *     never a constant.
 *   · IT FAILS OPEN, ALWAYS. Any throw, timeout, off-contract response or
 *     exhausted budget leaves the graph byte-identical to the one this stage
 *     received. The user then gets exactly today's behaviour: repair-wired,
 *     disclosed, excluded from ranking. Nothing this stage can do makes the
 *     product say something less true than it says today.
 */

import type { EdgeT, GraphT, NodeT } from "../../../schemas/graph.js";
import { readIsBaseline } from "../../baseline-identity.js";
import {
  canonicalStructuralEdge,
  detectEdgeFormat,
  type EdgeFormat,
} from "../utils/edge-format.js";
import {
  mapOptionsToFactors,
  type MappableFactor,
  type OptionFactorMapModelCall,
  type OptionFactorMapping,
  type OptionToMap,
} from "../../draft/option-factor-mapper.js";
import {
  OPTION_FACTOR_MAP_MIN_BUDGET_MS,
  OPTION_FACTOR_MAP_TIMEOUT_MS,
  remainingRequestBudgetMs,
} from "../../../config/timeouts.js";
import { log } from "../../../utils/telemetry.js";
import type { StageContext } from "../types.js";

// ---------------------------------------------------------------------------
// The edge this stage mints
// ---------------------------------------------------------------------------

/**
 * ⭐ THE REASON CARRIED ON EVERY EDGE THIS STAGE MINTS, and it says what the
 * edge IS rather than what the stage is called.
 *
 * Its sibling — `CONNECTIVITY_REPAIR_WIRING_REASON` in `repair/status-quo-fix.ts`
 * — exists because the literal it replaced made a FALSE CLAIM about the option
 * it was attached to. This one is written to the same standard: it claims only
 * that the drafter judged the link, which is exactly what happened, and it does
 * not claim an effect value, which is exactly what did not.
 */
export const OPTION_MAPPING_RECOVERY_REASON =
  "The drafter judged that this option changes this factor; no effect value is implied";

/**
 * ⭐⭐ `"ai"`, NEVER `"repair"`, AND THE DIFFERENCE IS THE WHOLE PERMISSION.
 *
 * `origin` is the estate's ONE discriminator between an edge the deterministic
 * repair drew to keep a graph connected and an edge a judgement produced
 * (`graph/repair-authored-edge.ts:5-16` derives why `provenance.source` cannot
 * serve). Readiness excludes the first and counts the second. An edge minted
 * here is the second thing: it is the drafter answering, for one option, the
 * question it already answered for that option's siblings.
 *
 * ⚠ Typed against the contract's own vocabulary rather than written as a bare
 * literal, so that if `"ai"` ever left `EdgeOrigin` this stops compiling instead
 * of silently minting an edge nothing recognises (trap 12).
 */
export const OPTION_MAPPING_RECOVERY_ORIGIN: NonNullable<EdgeT["origin"]> = "ai";

// ---------------------------------------------------------------------------
// Selection (pure)
// ---------------------------------------------------------------------------

export interface UnmappedOptionSelection {
  /** Options the drafter left with no mapping at all. */
  readonly unmapped: readonly OptionToMap[];
  /** Every factor in the graph, with the options that already target it. */
  readonly factors: readonly MappableFactor[];
  /** How many options DO carry a mapping. Zero ⇒ nothing is asked. */
  readonly mappedOptionCount: number;
}

/** How many interventions an option node carries, across both carrier shapes. */
function interventionCountOf(node: NodeT): number {
  const data = (node as { data?: Record<string, unknown> }).data;
  const raw = data?.interventions;
  if (Array.isArray(raw)) return raw.length;
  if (raw !== null && typeof raw === "object") return Object.keys(raw).length;
  return 0;
}

/**
 * Which options were drafted without a mapping, and what could they be mapped
 * onto?
 *
 * ⚠ THE PRECONDITION IS PART OF THE ANSWER, not a caller's responsibility: when
 * `mappedOptionCount === 0` the returned `unmapped` list is EMPTY, so a caller
 * that forgets the sibling rule cannot accidentally ask anyway.
 */
export function selectUnmappedOptions(graph: GraphT): UnmappedOptionSelection {
  const nodes = graph.nodes as NodeT[];
  const edges = graph.edges as EdgeT[];

  const kindById = new Map<string, string>();
  const labelById = new Map<string, string>();
  for (const node of nodes) {
    kindById.set(node.id, node.kind);
    if (typeof node.label === "string") labelById.set(node.id, node.label);
  }

  const optionFactorTargets = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (kindById.get(edge.from) !== "option") continue;
    if (kindById.get(edge.to) !== "factor") continue;
    const set = optionFactorTargets.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    optionFactorTargets.set(edge.from, set);
  }

  const unmapped: OptionToMap[] = [];
  let mappedOptionCount = 0;
  for (const node of nodes) {
    if (node.kind !== "option") continue;
    const hasEdgeMapping = (optionFactorTargets.get(node.id)?.size ?? 0) > 0;
    const hasStatedMapping = interventionCountOf(node) > 0;
    if (hasEdgeMapping || hasStatedMapping) {
      mappedOptionCount += 1;
      continue;
    }
    // The status quo is unmapped ON PURPOSE. Mapping it would destroy the thing
    // it represents, and readiness already treats it as `ready`.
    if (readIsBaseline(node as never) === true) continue;
    unmapped.push({ option_id: node.id, label: node.label });
  }

  const factors: MappableFactor[] = [];
  for (const node of nodes) {
    if (node.kind !== "factor") continue;
    const targetedBy: string[] = [];
    for (const [optionId, targets] of optionFactorTargets) {
      if (targets.has(node.id)) targetedBy.push(labelById.get(optionId) ?? optionId);
    }
    factors.push({ factor_id: node.id, label: node.label, targeted_by: targetedBy });
  }

  if (mappedOptionCount === 0) {
    return { unmapped: [], factors, mappedOptionCount };
  }
  return { unmapped, factors, mappedOptionCount };
}

// ---------------------------------------------------------------------------
// Application (pure)
// ---------------------------------------------------------------------------

export type MappingApplication =
  | { readonly option_id: string; readonly outcome: "wired"; readonly factor_ids: readonly string[] }
  | { readonly option_id: string; readonly outcome: "declined" }
  | { readonly option_id: string; readonly outcome: "refused_selected_every_factor" };

export interface ApplyMappingsResult {
  readonly edgesAdded: number;
  readonly applications: readonly MappingApplication[];
}

/**
 * Write the drafter's answer into the graph as `origin: "ai"` structural edges.
 * MUTATES `graph.edges`, in the same manner and with the same canonical values
 * as `fixStatusQuoConnectivity` — one edge shape in this pipeline, not two.
 *
 * @param factorCount total factors in the graph — the DERIVED bound for the
 *   non-selection refusal. Passed rather than re-derived so the caller's
 *   selection and this refusal cannot disagree about what "every factor" means.
 */
export function applyOptionFactorMappings(
  graph: GraphT,
  mappings: readonly OptionFactorMapping[],
  factorCount: number,
  format: EdgeFormat,
): ApplyMappingsResult {
  const applications: MappingApplication[] = [];
  let edgesAdded = 0;

  for (const mapping of mappings) {
    if (mapping.factor_ids.length === 0) {
      applications.push({ option_id: mapping.option_id, outcome: "declined" });
      continue;
    }
    // A selection of everything is not a selection. Discarding it costs this
    // option nothing it had: it falls back to the connectivity repair, the
    // disclosure sentence and the exclusion — today's behaviour exactly.
    if (factorCount >= 2 && mapping.factor_ids.length >= factorCount) {
      applications.push({
        option_id: mapping.option_id,
        outcome: "refused_selected_every_factor",
      });
      continue;
    }
    for (const factorId of mapping.factor_ids) {
      const baseEdge: EdgeT = {
        from: mapping.option_id,
        to: factorId,
        effect_direction: "positive" as const,
        origin: OPTION_MAPPING_RECOVERY_ORIGIN,
        provenance: {
          source: "hypothesis",
          quote: OPTION_MAPPING_RECOVERY_REASON,
        },
        provenance_source: "hypothesis" as const,
      };
      (graph.edges as EdgeT[]).push(canonicalStructuralEdge(baseEdge, format));
      edgesAdded += 1;
    }
    applications.push({
      option_id: mapping.option_id,
      outcome: "wired",
      factor_ids: mapping.factor_ids,
    });
  }

  return { edgesAdded, applications };
}

// ---------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------

export type OptionMappingRecoveryOutcome =
  | "no_graph"
  | "nothing_unmapped"
  | "no_mapped_sibling"
  | "no_factors"
  | "below_budget"
  | "model_error"
  | "model_off_contract"
  | "applied";

/**
 * Stage 3b. Returns the outcome it reached, for the caller's trace and for the
 * tests — never throws, and never leaves the graph in a state the repair stage
 * would not have accepted from enrichment.
 */
export async function runStageOptionMappingRecovery(
  ctx: StageContext,
  call?: OptionFactorMapModelCall,
): Promise<OptionMappingRecoveryOutcome> {
  const graph = ctx.graph as GraphT | undefined;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return "no_graph";

  const selection = selectUnmappedOptions(graph);
  if (selection.factors.length === 0) return "no_factors";
  if (selection.mappedOptionCount === 0) return "no_mapped_sibling";
  if (selection.unmapped.length === 0) return "nothing_unmapped";

  // ⚠ THE BUDGET GATE USES THE ESTATE'S SINGLE PRIMITIVE, not a second copy of
  // the arithmetic. `remainingRequestBudgetMs` exists precisely because
  // re-deriving it per site caused the 2026-07-20 staging outage.
  const elapsedMs = Date.now() - ctx.start;
  const remainingMs = remainingRequestBudgetMs(elapsedMs);
  const timeoutMs = Math.min(OPTION_FACTOR_MAP_TIMEOUT_MS, remainingMs);
  if (timeoutMs < OPTION_FACTOR_MAP_MIN_BUDGET_MS) {
    log.info(
      {
        event: "cee.option_mapping_recovery.skipped",
        request_id: ctx.requestId,
        outcome: "below_budget",
        unmapped_option_count: selection.unmapped.length,
        elapsed_ms: elapsedMs,
        remaining_budget_ms: remainingMs,
      },
      "Stage 3b (Option mapping recovery) skipped — request budget exhausted",
    );
    return "below_budget";
  }

  let outcome;
  try {
    outcome = await mapOptionsToFactors(
      {
        options: selection.unmapped,
        factors: selection.factors,
        brief: ctx.effectiveBrief,
        requestId: ctx.requestId,
      },
      call,
      timeoutMs,
    );
  } catch (err) {
    log.warn(
      {
        event: "cee.option_mapping_recovery.failed",
        request_id: ctx.requestId,
        error: (err as Error)?.message,
        unmapped_option_count: selection.unmapped.length,
      },
      "Stage 3b (Option mapping recovery) call failed — draft continues unchanged",
    );
    return "model_error";
  }

  if (outcome.status !== "ok") {
    log.warn(
      {
        event: "cee.option_mapping_recovery.off_contract",
        request_id: ctx.requestId,
        status: outcome.status,
        detail: outcome.status === "no_options" ? undefined : outcome.detail,
      },
      "Stage 3b (Option mapping recovery) response unusable — draft continues unchanged",
    );
    return "model_off_contract";
  }

  const format = detectEdgeFormat(graph.edges as EdgeT[]);
  const applied = applyOptionFactorMappings(
    graph,
    outcome.mappings,
    selection.factors.length,
    format,
  );

  log.info(
    {
      event: "cee.option_mapping_recovery.applied",
      request_id: ctx.requestId,
      unmapped_option_count: selection.unmapped.length,
      mapped_option_count: selection.mappedOptionCount,
      factor_count: selection.factors.length,
      edges_added: applied.edgesAdded,
      applications: applied.applications,
      elapsed_ms: elapsedMs,
    },
    "Stage 3b (Option mapping recovery) complete",
  );

  return "applied";
}
