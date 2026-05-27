/**
 * Stage 4: Repair — Orchestrator for repair substeps
 *
 * Calls each substep sequentially. Each substep is an individually
 * exported function in its own file for testability.
 *
 * ORDERING INVARIANT — do not reorder substeps (except 1/1b swap below)
 *
 * 0.9 Auto-baseline dedup        — drops auto-injected status-quo/baseline options that
 *                                  duplicate an explicit option's intervention signature.
 *                                  No-op when no such collision exists; safe-conservative
 *                                  rule (only fires when a non-baseline survives).
 * 1.  Deterministic sweep        — resolves mechanical violations, unreachable factors, status quo
 * 1.5 Options-identical bypass   — fail-fast gate for OPTIONS_IDENTICAL: skips LLM repair and emits
 *                                  a clarification-shaped CEE_GRAPH_INVALID so the user is not
 *                                  blocked behind a ~30s repair-then-fail loop. Other Bucket C
 *                                  codes still route through LLM repair (substep 2).
 * 1b. Orchestrator validation    — optional LLM-backed validation (gated), runs AFTER sweep
 * 2.  PLoT validation            — external validation + LLM repair (only if Bucket C remains)
 * 3. Edge ID stabilisation    — deterministic IDs BEFORE goal merge
 * 4. Goal merge               — enforceSingleGoal, captures nodeRenames
 * 5. Compound goals           — generates constraint nodes/edges
 * 6. Late STRP                — Rules 3,5 with goalConstraints context
 * 7. Edge field restoration   — restores V4 fields using stash + nodeRenames
 * 8. Connectivity             — wires orphans to goal, ensures goal exists
 * 9. Clarifier                — graph refinement (may replace ctx.graph)
 * 9b. Deterministic enforcement — budget rescale + bridge chain repair (gated)
 * 10. Structural parse        — DraftGraphOutput.parse safety net
 *
 * Key dependencies:
 * - 3 BEFORE 4: stable IDs before goal merge changes from/to
 * - 4 BEFORE 7: nodeRenames from goal merge needed for stash restoration
 * - 6 BEFORE 7: late STRP may modify edges that restoration must preserve
 * - 7 AFTER all topology changes: restoration is the last edge mutation
 * - 8 BEFORE 9: clarifier sees connected graph
 * - 9 BEFORE 9b: clarifier may replace ctx.graph; enforcement must run on the
 *   final graph so over-budget sums or forbidden bridge chains reintroduced
 *   by clarifier are still caught
 * - 9b BEFORE 10: structural parse validates final graph state
 *
 * EARLY RETURN RULES:
 * Substeps 1b, 9b, and 10 can set ctx.earlyReturn.
 * Substep 2 falls back to simpleRepair (never early-returns).
 * Substep 8 writes validationSummary (never early-returns).
 * Substeps 1, 3-7 and 9 are deterministic transforms that must not fail.
 * The earlyReturn guards after substeps 1b and 2 are defensive only.
 * 9b sets earlyReturn (422 CEE_GRAPH_INVALID) when post-enforcement validation
 * finds blocking topology errors (severity="error") that survived all repair stages.
 */

import type { StageContext } from "../../types.js";
import { log } from "../../../../utils/telemetry.js";

import { runOrchestratorValidation } from "./orchestrator-validation.js";
import { runAutoBaselineDedup } from "./auto-baseline-dedup.js";
import { runDeterministicSweep } from "./deterministic-sweep.js";
import { runOptionsIdenticalBypass } from "./options-identical-bypass.js";
import { runPlotValidation } from "./plot-validation.js";
import { runEdgeStabilisation } from "./edge-stabilisation.js";
import { runGoalMerge } from "./goal-merge.js";
import { runCompoundGoals } from "./compound-goals.js";
import { runLateStrp } from "./late-strp.js";
import { runEdgeRestoration } from "./edge-restoration.js";
import { runConnectivity } from "./connectivity.js";
import { runClarifier } from "./clarifier.js";
import { runStructuralParse } from "./structural-parse.js";
import { applyDeterministicEnforcement } from "./graph-enforcement.js";

/**
 * Stage 4: Run all repair substeps in order.
 * Each substep modifies ctx.graph and/or sets ctx.earlyReturn.
 */
export async function runStageRepair(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  log.info({ requestId: ctx.requestId, stage: "repair" }, "Unified pipeline: Stage 4 (Repair) started");

  // Substep 0.9: Auto-baseline dedup — drops options carrying an
  // EXPLICIT `is_baseline === true` flag that duplicate another
  // (non-explicit) option's intervention signature, BEFORE the
  // deterministic sweep's OPTIONS_IDENTICAL check.
  //
  // Fires only when a duplicate-signature group contains BOTH an
  // explicit-baseline option AND a non-explicit option (the
  // load-bearing case from staging pricing-brief failures). Heuristic-
  // only matches (label like "Status Quo", id ending `_status_quo`,
  // etc.) emit a diagnostic-only telemetry event and FALL THROUGH to
  // the PR #202 OPTIONS_IDENTICAL bypass — never silently delete a
  // user-supplied option. Verified-passing fixtures (hiring brief)
  // are unaffected because their baselines have distinct interventions
  // and the validator never raises a collision in the first place.
  // See auto-baseline-dedup.ts for the full safety contract.
  runAutoBaselineDedup(ctx);

  // Substep 1: Deterministic sweep — resolves mechanical violations,
  // unreachable factors, status quo. Runs after 0.9 so mechanical
  // fixes (NaN, sign, status quo wiring) are applied before
  // orchestrator validation can 422 on issues the sweep can resolve.
  // Sees the dedup'd graph from 0.9 — never raises OPTIONS_IDENTICAL
  // for the explicit-baseline-duplicates-non-explicit case.
  await runDeterministicSweep(ctx);

  // Substep 1.5: Pre-LLM-repair fail-fast gate for OPTIONS_IDENTICAL.
  // Bypasses the ~30s LLM repair call when the deterministic sweep leaves
  // an OPTIONS_IDENTICAL violation — `repair_graph` has repeatedly failed
  // to fix this class in staging, producing a user-hostile 86s "draft +
  // repair-then-fail" loop. Emits a fail-fast CEE_GRAPH_INVALID with a
  // clarification-shaped recovery payload. Other Bucket C codes continue
  // to route through LLM repair. See options-identical-bypass.ts.
  if (runOptionsIdenticalBypass(ctx)) {
    return;
  }

  // Substep 1b: Orchestrator validation (gated by config.cee.orchestratorValidationEnabled)
  await runOrchestratorValidation(ctx);
  if (ctx.earlyReturn) return;

  // Substep 2: PLoT validation + LLM repair (gated by deterministic sweep)
  await runPlotValidation(ctx);
  if (ctx.earlyReturn) return;

  // Substep 3: Edge ID stabilisation
  runEdgeStabilisation(ctx);

  // Substep 4: Goal merge (ONCE)
  runGoalMerge(ctx);

  // Substep 5: Compound goals
  runCompoundGoals(ctx);

  // Substep 6: Late STRP
  runLateStrp(ctx);

  // Substep 7: Edge field restoration (RISK-06 fix)
  runEdgeRestoration(ctx);

  // Substep 8: Connectivity + goal repair
  runConnectivity(ctx);

  // Substep 9: Clarifier (may replace ctx.graph with refinedGraph)
  await runClarifier(ctx);

  // Substep 9b: Deterministic enforcement (budget rescale + bridge chain repair)
  // Runs AFTER clarifier so any over-budget sums or forbidden bridge chains
  // reintroduced by clarifier refinement are still enforced before packaging.
  // Sets ctx.earlyReturn (422) if post-enforcement validation finds blocking
  // topology errors (e.g. INVALID_EDGE_TYPE from surviving option shortcuts).
  applyDeterministicEnforcement(ctx);
  if (ctx.earlyReturn) return;

  // Substep 10: Structural parse (Zod safety net)
  runStructuralParse(ctx);
}
