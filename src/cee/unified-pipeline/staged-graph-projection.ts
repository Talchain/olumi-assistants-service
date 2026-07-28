/**
 * Projection of the mid-flight graph into the NEGOTIATED schema vocabulary,
 * for the staged-drafting GRAPH_READY frame (ROADMAP 1.204 M1).
 *
 * ── WHY THIS EXISTS (a defect that would have silently voided the lane) ─────
 * The GRAPH_READY frame is emitted mid-pipeline, before Stage 6 (Boundary) runs
 * the schema transform. Emitting the raw V1 `ctx.graph` there looks harmless and
 * is not: `parseSchemaVersion` DEFAULTS to "v3" when `?schema` is absent — the
 * ordinary path — and the V3 transform REWRITES NODE IDENTITY. `normalizeToId`
 * rewrites ids (including collision suffixing) and `cleanNodeLabel` rewrites
 * labels (schema-v3.ts:187,:191).
 *
 * So a client would receive a graph at ~33 s keyed by one set of ids, then the
 * terminal frame at ~53 s keyed by DIFFERENT ids. Reconciliation by id fails,
 * and the canvas either duplicates/orphans nodes or throws the early graph away
 * and re-renders — destroying the exact latency win this lane exists to deliver.
 *
 * ── DERIVED, NOT MIRRORED ───────────────────────────────────────────────────
 * This calls `transformGraphToV3` / `transformGraphToV2` — the SAME exported
 * functions the boundary stage uses (`transformResponseToV3` calls
 * `transformGraphToV3` internally). Re-implementing the id/label rules here
 * would be a hand-maintained mirror that drifts the first time the transform
 * changes (CLAUDE.md trap 12). If the transform changes, this changes with it.
 *
 * ── WHAT IS GUARANTEED, AND WHAT IS NOT ─────────────────────────────────────
 * GUARANTEED: node IDENTITY — `id`, `label` and `kind`/`type` — is byte-equal to
 * the terminal frame's corresponding nodes. That is the property reconciliation
 * needs, and it is pinned by test.
 *
 * NOT guaranteed: numeric VALUES. `graph-data-integrity` runs AFTER the schema
 * transform in Stage 6 (factor scale consistency, edge field defaults, the
 * observed-root intercept doctrine — see stages/boundary.ts), so an
 * `observed_state.value` or an edge default may be refined between GRAPH_READY
 * and COMPLETE. This is honest and is exactly why the frame is `in_progress`:
 * the terminal frame is always the authority. Identity is stable; values settle.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import { transformGraphToV3 } from "../transforms/schema-v3.js";
import { transformGraphToV2 } from "../transforms/schema-v2.js";
import { log } from "../../utils/telemetry.js";

export type StagedSchemaVersion = "v1" | "v2" | "v3";

/**
 * Project the in-flight graph into the vocabulary the terminal frame will use.
 *
 * Total by contract: a projection failure must never fail a draft, so any throw
 * degrades to the untransformed graph and is logged. A GRAPH_READY frame that
 * is merely less useful is strictly better than a dead draft.
 */
export function projectGraphForStagedFrame(
  graph: GraphV1 | undefined,
  schemaVersion: StagedSchemaVersion,
  requestId?: string,
): unknown {
  if (!graph) return graph;
  try {
    if (schemaVersion === "v3") {
      return transformGraphToV3(graph as never).graph;
    }
    if (schemaVersion === "v2") {
      return transformGraphToV2(graph as never);
    }
    // v1 is the identity case — the boundary emits the V1 graph unchanged.
    return graph;
  } catch (err) {
    log.warn(
      { err, request_id: requestId, schema_version: schemaVersion },
      "staged GRAPH_READY projection failed — emitting the untransformed graph",
    );
    return graph;
  }
}
