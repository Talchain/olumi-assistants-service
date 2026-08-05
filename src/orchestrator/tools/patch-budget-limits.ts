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
 * ⚠⚠ THIS CONSTANT HAS NOW CARRIED TWO FALSE LABELS IN A ROW. Read both.
 *
 * The ORIGINAL comment said the elevated limit exists because "the default
 * 4-edge limit is too tight". That was stale: `MAX_EDGE_OPS` is 8, not 4.
 *
 * The REPLACEMENT this file shipped then claimed the option-addition branch
 * "cannot change any verdict that the plain branch would not already reach".
 * **That is also false, and a discriminating pair refutes it:**
 *
 *   checkPatchBudget([option add_node, 7 incident edges, 5 unrelated edges])
 *     -> edgeOps: 12, allowed: TRUE
 *   CONTROL, the same 12 edge ops under a plain add_node
 *     -> edgeOps: 12, allowed: FALSE
 *
 * Because the branch checks `incident <= 8` AND `unrelated <= 8`
 * INDEPENDENTLY, it admits up to SIXTEEN edge operations against the flat cap
 * of eight. Equalising the two constants removed the per-bucket elevation;
 * **the BUCKET SPLIT is itself the elevation, and it survives.**
 *
 * So the honest statement is: this constant's VALUE currently adds nothing
 * beyond `MAX_EDGE_OPS`, while the branch it feeds is materially more
 * permissive than the plain path. Whether to raise it, or delete the branch
 * and let the flat cap govern, is a ROWED decision and is not taken here.
 *
 * The splitter is unaffected either way — it sizes parts against the strict
 * FLAT cap, which is stricter than anything this branch admits, so it can only
 * be conservative in the safe direction.
 */
export const OPTION_ADD_MAX_EDGE_OPS = 8;
