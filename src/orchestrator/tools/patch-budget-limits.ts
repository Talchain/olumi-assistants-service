/**
 * ROADMAP 2.474 / amendment A3 — THE OPERATION-COMPLEXITY BUDGET, AS A LEAF.
 *
 * These numbers used to be module-local constants inside `edit-graph.ts` — a
 * 4,800-line module that pulls in the whole edit pipeline (PLoT client, patch
 * applier, telemetry). That made them unreadable from the one place that most
 * needs them: the structural-edit batch SPLITTER, which has to size a part to
 * what the pipeline will actually accept.
 *
 * A splitter carrying its OWN copy of "4 and 8" is the hand-maintained mirror
 * (CLAUDE.md trap 12): green the day it is written, and silently emitting
 * over-cap parts the day either number moves. So there is ONE definition here,
 * imported by the enforcer (`checkPatchBudget`) and by the splitter
 * (`structural-edit-batch-split.ts`). `edit-graph.ts` no longer declares them.
 *
 * This module is a LEAF ON PURPOSE: no imports at all. That is what lets a pure
 * `orchestrator-v5` module read the pipeline's budget without importing the
 * pipeline.
 */

/** Max node operations (add_node / remove_node / update_node) in one patch. */
export const MAX_NODE_OPS = 4;

/** Max edge operations (add_edge / remove_edge / update_edge) in one patch. */
export const MAX_EDGE_OPS = 8;

/**
 * Edge budget for edges incident to an option/intervention node the SAME batch
 * creates.
 *
 * ⚠ MEASURED 2026-08-05, recorded because the comment that used to sit on this
 * constant asserted otherwise: it reads "the default 4-edge limit is too tight"
 * — but `MAX_EDGE_OPS` is 8, not 4, so the elevated limit ELEVATES NOTHING at
 * this tip and the option-addition split-budget branch in `checkPatchBudget`
 * cannot change any verdict that the plain branch would not already reach.
 * Left at its measured value deliberately: raising it is a behaviour change
 * with no witness behind it, and this lane's remit is to make the caps
 * COHERENT, not to widen an unmeasured one.
 */
export const OPTION_ADD_MAX_EDGE_OPS = 8;
