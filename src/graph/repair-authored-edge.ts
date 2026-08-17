/**
 * ⭐ ROADMAP 2.1266 — THE ONE AUTHORITY ON "DID THE REPAIR AUTHOR THIS
 * OPTION→FACTOR EDGE?"
 *
 * THE DEFECT, execution-attributed by the #1005 reviewer and re-derived here at
 * the bytes (probe, 2026-08-17, staging `8be62df9`):
 * `fixStatusQuoConnectivity` (`cee/unified-pipeline/stages/repair/status-quo-fix.ts:185-217`)
 * takes the UNION of intervention target factors across all connected options and
 * adds an option→factor edge from each DISCONNECTED option to every factor it does
 * not already target — carrying no intervention value. Readiness then minted ONE
 * `MISSING_OPTION_VALUE` ask per such edge, so **the product asked the user to
 * supply effect values for links it had invented itself, and the ask text did not
 * say so.** Measured on a brief-04-shaped graph: 2 disconnected options × 7 union
 * targets = **14 manufactured asks**, magnitude
 * `#disconnectedOptions × |union of connected targets \ already-targeted|`.
 *
 * ⚠⚠ WHY THIS PREDICATE READS `origin` AND NOT `provenance` — MEASURED, AND IT
 * REFUTES THE OBVIOUS IMPLEMENTATION. The repair stamps its edges
 * `provenance.source: "synthetic"`, so keying on that string is the natural fix.
 * IT WOULD NEVER FIRE. `EdgeV3.provenance.source` is a CLOSED four-member enum
 * (`cee-v3.ts:220`) with no `synthetic` member, and the V3 transform coerces the
 * value through `mapToV3ProvenanceSource` (`schema-v3.ts:862-877`), whose default
 * branch returns **`cee_hypothesis`**. Probe output for the manufactured edge as
 * readiness actually receives it:
 *
 *   {"from":"opt_c","to":"fac_x", ... ,"provenance":{"source":"cee_hypothesis",
 *    "reasoning":"Status-quo option wired to factor"},
 *    "provenance_display":"ai_inferred","origin":"repair"}
 *
 * On the wire a manufactured edge is provenance-INDISTINGUISHABLE from any
 * AI-hypothesised edge. `origin` is the only surviving discriminator: it is
 * declared on `EdgeV3` (`cee-v3.ts:262`) and explicitly carried by the transform
 * (`schema-v3.ts:843`, `origin: edge.origin ?? "ai"`). A guard written against
 * `provenance.source` would read correct, pass review, and do nothing — CLAUDE.md
 * trap 22's "the guard was correct and pointed at the wrong bytes".
 *
 * SCOPE, derived rather than assumed: `fixStatusQuoConnectivity` is the ONLY
 * producer of an `option→factor` edge carrying `origin: "repair"`. Every other
 * repair-edge mint in the tree writes factor→outcome, factor→risk, outcome→goal
 * or factor→goal (`edge-format.ts:136` via its callers, `deterministic-sweep.ts`
 * :1378/:1386/:1696/:1881/:1901, `graph-enforcement.ts:444`,
 * `terminal-bridge.ts:284`, `services/repair.ts:186/:266`); the shortcut reroutes
 * REUSE an existing option→factor edge rather than minting one. So the
 * kind-pair conjunction below is what keeps this predicate from suppressing a
 * legitimately-asked value elsewhere, and it is why the kind test is not
 * decoration.
 */

import type { z } from "zod";
import { EdgeOrigin } from "../schemas/graph.js";

/** The contract's own vocabulary member, never a restated literal. */
export type EdgeOriginT = z.infer<typeof EdgeOrigin>;

/**
 * DERIVED, NOT MIRRORED (trap 12): the annotation is the derivation. Should
 * `"repair"` ever leave `EdgeOrigin`, this assignment stops type-checking and
 * the gate REDs — rather than the predicate silently matching nothing forever,
 * which is the failure mode a bare string literal would have.
 */
export const REPAIR_AUTHORED_ORIGIN: EdgeOriginT = "repair";

/** The minimum an edge must expose to be judged. Structural, so it accepts an internal `EdgeT` and an `EdgeV3T` alike. */
export interface EdgeOriginView {
  readonly from: string;
  readonly to: string;
  readonly origin?: unknown;
}

/**
 * Did the deterministic repair author this edge? THE origin test — the single
 * definition both readiness paths resolve to.
 *
 * Use this form only where the caller has ALREADY established the option→factor
 * kind pair (the V5 Run-admission projection tests membership of its own
 * `optionNodeIds`/`factorIds` sets before it reaches the edge, so re-deriving a
 * node-kind map there would be a second traversal and a second authority on node
 * kind). Where the kinds are not yet established, use
 * `isRepairAuthoredOptionFactorEdge`, which is defined in terms of this.
 */
export function isRepairAuthoredOrigin(edge: Pick<EdgeOriginView, "origin">): boolean {
  return edge.origin === REPAIR_AUTHORED_ORIGIN;
}

/**
 * Is this an option→factor edge the deterministic repair authored (rather than
 * one the user stated or the drafter proposed)?
 */
export function isRepairAuthoredOptionFactorEdge(
  edge: EdgeOriginView,
  nodeKindById: ReadonlyMap<string, string>,
): boolean {
  if (nodeKindById.get(edge.from) !== "option") return false;
  if (nodeKindById.get(edge.to) !== "factor") return false;
  return isRepairAuthoredOrigin(edge);
}
