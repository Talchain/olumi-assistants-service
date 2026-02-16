/**
 * Stage 4: Repair — Orchestrator for repair substeps
 *
 * Calls each substep sequentially. Each substep is an individually
 * exported function in its own file for testability.
 *
 * ORDERING INVARIANT — do not reorder substeps (except 1/1b swap below)
 *
 * 1.  Deterministic sweep     — resolves mechanical violations, unreachable factors, status quo
 * 1b. Orchestrator validation — optional LLM-backed validation (gated), runs AFTER sweep
 * 2.  PLoT validation         — external validation + LLM repair (only if Bucket C remains)
 * 3. Edge ID stabilisation    — deterministic IDs BEFORE goal merge
 * 4. Goal merge               — enforceSingleGoal, captures nodeRenames
 * 5. Compound goals           — generates constraint nodes/edges
 * 6. Late STRP                — Rules 3,5 with goalConstraints context
 * 7. Edge field restoration   — restores V4 fields using stash + nodeRenames
 * 8. Connectivity             — wires orphans to goal, ensures goal exists
 * 9. Clarifier                — last graph-modifying step (needs quality)
 * 10. Structural parse        — DraftGraphOutput.parse safety net
 *
 * Key dependencies:
 * - 3 BEFORE 4: stable IDs before goal merge changes from/to
 * - 4 BEFORE 7: nodeRenames from goal merge needed for stash restoration
 * - 6 BEFORE 7: late STRP may modify edges that restoration must preserve
 * - 7 AFTER all topology changes: restoration is the last edge mutation
 * - 9 BEFORE 10: structural parse validates final graph state
 *
 * EARLY RETURN RULES:
 * Only substeps 1b and 10 set ctx.earlyReturn.
 * Substep 2 falls back to simpleRepair (never early-returns).
 * Substep 8 writes validationSummary (never early-returns).
 * Substeps 1, 3-7 and 9 are deterministic transforms that must not fail.
 * The earlyReturn guards after substeps 1b and 2 are defensive only.
 */

import type { StageContext } from "../../types.js";
import { log } from "../../../../utils/telemetry.js";

import { runOrchestratorValidation } from "./orchestrator-validation.js";
import { runDeterministicSweep } from "./deterministic-sweep.js";
import { runPlotValidation } from "./plot-validation.js";
import { runEdgeStabilisation } from "./edge-stabilisation.js";
import { runGoalMerge } from "./goal-merge.js";
import { runCompoundGoals } from "./compound-goals.js";
import { runLateStrp } from "./late-strp.js";
import { runEdgeRestoration } from "./edge-restoration.js";
import { runConnectivity } from "./connectivity.js";
import { runClarifier } from "./clarifier.js";
import { runStructuralParse } from "./structural-parse.js";

/**
 * Stage 4: Run all repair substeps in order.
 * Each substep modifies ctx.graph and/or sets ctx.earlyReturn.
 */
export async function runStageRepair(ctx: StageContext): Promise<void> {
  if (!ctx.graph) return;

  log.info({ requestId: ctx.requestId, stage: "repair" }, "Unified pipeline: Stage 4 (Repair) started");

  // Substep 1: Deterministic sweep — resolves mechanical violations, unreachable factors, status quo
  // Runs FIRST so mechanical fixes (NaN, sign, status quo wiring) are applied
  // before orchestrator validation can 422 on issues the sweep can resolve.
  await runDeterministicSweep(ctx);

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

  // Substep 9: Clarifier (last graph-modifying step)
  await runClarifier(ctx);

  // Substep 10: Structural parse (Zod safety net)
  runStructuralParse(ctx);
}
