/**
 * Stage 3: Enrich — Factor enrichment (ONCE)
 *
 * Ordering matches Pipeline B lines 1250-1339 exactly — do not reorder.
 * This is the ONLY call site for enrichGraphWithFactorsAsync.
 */

import type { StageContext } from "../types.js";
import { enrichGraphWithFactorsAsync } from "../../factor-extraction/enricher.js";
import { detectCycles } from "../../../utils/graphGuards.js";
import { stabiliseGraph, ensureDagAndPrune } from "../../../orchestrator/index.js";
import { simpleRepair, countEdgePatternViolations } from "../../../services/repair.js";
import { log, emit } from "../../../utils/telemetry.js";

/**
 * Stage 3: Factor enrichment + post-enrich stabilisation.
 *
 * Steps (matching Pipeline B lines 1250-1339 exactly):
 *  1. enrichGraphWithFactorsAsync (ONCE)
 *  2. Post-enrich invariant (controllable factors must have numeric value)
 *  3. detectCycles
 *  4. First stabilise: stabiliseGraph(ensureDagAndPrune(graph))
 *  5. simpleRepair (post-enrichment connectivity repair)
 *  6. Second stabilise: stabiliseGraph(ensureDagAndPrune(repaired))
 *  7. Build enrichmentTrace from enrichmentResult
 */
export async function runStageEnrich(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  log.info({ requestId: ctx.requestId, stage: "enrich" }, "Unified pipeline: Stage 3 (Enrich) started");

  // ── Step 1: Factor enrichment (ONCE) ────────────────────────────────────
  const enrichmentResult = await enrichGraphWithFactorsAsync(ctx.graph as any, ctx.effectiveBrief, {
    collector: ctx.collector,
    modelOverride: (ctx.input as any).enrichment_model,
  });
  ctx.enrichmentResult = enrichmentResult;
  const enrichedGraph = enrichmentResult.graph;

  // ROADMAP 2.281 — carry the mint ATTESTATION forward to Stage 4b. The sweep's
  // "possibly model-inferred" heuristic cannot tell a model's invention from a
  // user's stated target by looking at the number, so it reads this record of
  // what actually happened instead. Derived at the mint site; never re-inferred.
  ctx.enricherMintedGoalIds = new Set(enrichmentResult.goalThresholdsMinted ?? []);

  log.info({
    stage: "2_factor_enrichment",
    node_count: enrichedGraph.nodes.length,
    edge_count: enrichedGraph.edges.length,
    factors_added: enrichmentResult.factorsAdded,
    factors_enhanced: enrichmentResult.factorsEnhanced,
    factors_skipped: enrichmentResult.factorsSkipped,
    extraction_mode: enrichmentResult.extractionMode,
    llm_success: enrichmentResult.llmSuccess,
    correlation_id: ctx.requestId,
  }, "Pipeline stage: Factor enrichment complete");

  // ── Step 2: Post-enrich invariant ───────────────────────────────────────
  {
    const controllableFactors = enrichedGraph.nodes.filter(
      (n: any) => n.kind === "factor" && n.category === "controllable",
    );
    const factorsWithoutValue = controllableFactors.filter(
      (n: any) => {
        const value = n.data?.value;
        return value === undefined || value === null || typeof value !== "number";
      },
    );
    if (factorsWithoutValue.length > 0) {
      log.warn({
        event: "cee.post_enrich.controllable_without_value",
        request_id: ctx.requestId,
        total_controllable: controllableFactors.length,
        without_value: factorsWithoutValue.length,
        factor_ids: factorsWithoutValue.map((n: any) => n.id),
      }, `Post-enrich invariant: ${factorsWithoutValue.length}/${controllableFactors.length} controllable factor(s) lack numeric data.value`);
      emit("cee.post_enrich.invariant_violation", {
        total_controllable: controllableFactors.length,
        without_value: factorsWithoutValue.length,
        factor_ids: factorsWithoutValue.map((n: any) => n.id),
      });
    }
  }

  // ── Step 3: Cycle detection ─────────────────────────────────────────────
  const cycles = detectCycles(enrichedGraph.nodes as any, enrichedGraph.edges as any);
  ctx.hadCycles = cycles.length > 0;

  // ── Step 4: First stabilise ─────────────────────────────────────────────
  let candidate = stabiliseGraph(ensureDagAndPrune(enrichedGraph, { collector: ctx.collector }), { collector: ctx.collector });

  log.info({
    stage: "3_first_stabilise",
    node_count: candidate.nodes.length,
    edge_count: candidate.edges.length,
    had_cycles: ctx.hadCycles,
    correlation_id: ctx.requestId,
  }, "Pipeline stage: First stabiliseGraph complete");

  // ── Step 5: simpleRepair ────────────────────────────────────────────────
  const repaired = simpleRepair(candidate, ctx.requestId);

  // ── Step 5b: Post-repair edge-pattern assertion ────────────────────────
  // simpleRepair is the authoritative owner of invalid-edge removal, EXCEPT for the
  // patterns a downstream authority owns and repairs (SWEEP_OWNED_EDGE_PATTERNS —
  // today: factor→goal, split by fixFactorGoalEdges in Stage 4 substep 1).
  //
  // The two counts are DIFFERENT QUESTIONS and must not share one number: `invalid`
  // means a later stage re-added an edge simpleRepair removed (should never happen);
  // `deferred` means an edge is deliberately in flight to its repairer (expected).
  // Counting a deferral as a violation would make this alarm cry wolf on every draft
  // whose model emits the shortcut — and an alarm everyone learns to ignore is worse
  // than no alarm. Both counts are derived from the single list in repair.ts, never
  // re-listed here.
  {
    const { invalid: invalidCount, deferred: deferredCount } = countEdgePatternViolations(repaired);
    if (invalidCount > 0) {
      log.warn({
        event: "cee.enrich.post_repair_invalid_edges",
        request_id: ctx.requestId,
        invalid_count: invalidCount,
      }, `Post-simpleRepair assertion: ${invalidCount} invalid edge pattern(s) survived — this should not happen`);
    }
    if (deferredCount > 0) {
      // Observability for the handoff: pair this with the sweep's
      // `cee.deterministic_sweep.factor_goal_split` count. Deferred-in without a
      // corresponding split-out means the handoff broke.
      log.info({
        event: "cee.enrich.post_repair_deferred_edges",
        request_id: ctx.requestId,
        deferred_count: deferredCount,
      }, `Post-simpleRepair: ${deferredCount} edge pattern(s) deferred to a downstream repair authority`);
    }
  }

  // ── Step 6: Second stabilise ────────────────────────────────────────────
  candidate = stabiliseGraph(ensureDagAndPrune(repaired, { collector: ctx.collector }), { collector: ctx.collector });
  ctx.graph = candidate as any;

  log.info({
    stage: "3a_post_enrichment_repair",
    node_count: candidate.nodes.length,
    edge_count: candidate.edges.length,
    correlation_id: ctx.requestId,
  }, "Pipeline stage: Post-enrichment simpleRepair complete");

  // ── Step 7: Build enrichmentTrace (change 4: use extractionMode directly) ──
  // INVARIANT: Each stage runs exactly once per request.
  // Parity tests verify: enrich.called_count === 1
  // The plan annotation checkpoint (captured by the orchestrator after this
  // stage returns) is pure data extraction — it does NOT re-invoke enrichment.
  // Extend this pattern for new stage-level behaviours.
  ctx.enrichmentTrace = {
    called_count: 1,
    extraction_mode: enrichmentResult.extractionMode,
    factors_added: enrichmentResult.factorsAdded,
    factors_enhanced: enrichmentResult.factorsEnhanced,
    factors_skipped: enrichmentResult.factorsSkipped,
    llm_success: enrichmentResult.llmSuccess,
  };
}
