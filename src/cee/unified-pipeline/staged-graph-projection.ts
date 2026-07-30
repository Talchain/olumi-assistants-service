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
 *
 * ── STRUCTURE ONLY, AND NOW BY CONSTRUCTION (ROADMAP 2.146) ─────────────────
 * The GRAPH_READY frame's documented claim is "structure only". Until 2.146 that
 * held for a mechanical reason — `ctx.coaching` / `ctx.causalClaims` do not exist
 * yet — plus a second, weaker reason: the two-pass validation pipeline was
 * `await`ed BEFORE the frame, so its per-edge Pass-2 REASONING PROSE could not be
 * on the graph either. 2.146 moves that await behind the coaching pass (to hide
 * ~10–25 s of Pass-2 latency), which turns the second reason into a RACE: the
 * pipeline mutates `ctx.graph` edges in place, and a fast Pass 2 (fixtures, a
 * cached provider, a tiny graph) can land its metadata before this projection
 * runs.
 *
 * A claim that depends on winning a race is not a claim. So the two keys the
 * validation pipeline writes are stripped here, UNCONDITIONALLY — the frame
 * cannot carry Pass-2 prose whatever the timing. Validation metadata reaches the
 * client as a later enrichment on the terminal COMPLETE frame, which is the
 * buffered route's body verbatim and therefore still carries it in full.
 *
 * The key names are IMPORTED from the validation pipeline's own type module, not
 * re-typed here: a hand-copied literal would be a mirror that drifts on a rename
 * (CLAUDE.md trap 12), and this way a rename fails to compile.
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import { transformGraphToV3 } from "../transforms/schema-v3.js";
import { transformGraphToV2 } from "../transforms/schema-v2.js";
import {
  VALIDATION_EDGE_METADATA_KEY,
  VALIDATION_GRAPH_SUMMARY_KEY,
} from "../validation-pipeline/types.js";
import { log } from "../../utils/telemetry.js";

export type StagedSchemaVersion = "v1" | "v2" | "v3";

/**
 * Remove the validation pipeline's two wire keys from a projected graph.
 *
 * COPIES rather than deletes: `ctx.graph` (and, on the v1 identity path, the
 * object this function is handed) is the pipeline's live graph, and Stage 5
 * (Package) is the metadata's real consumer. Mutating it here would delete the
 * data the flip exists to deliver. Shallow-copies only the objects it needs to
 * change — nodes and every other edge field pass through by reference, so the
 * identity guarantee above is untouched.
 */
function stripValidationMetadata(graph: unknown): unknown {
  if (!graph || typeof graph !== "object") return graph;
  try {
    const g = graph as Record<string, unknown>;
    const out: Record<string, unknown> = { ...g };
    delete out[VALIDATION_GRAPH_SUMMARY_KEY];
    if (Array.isArray(g.edges)) {
      out.edges = g.edges.map((edge) => {
        if (!edge || typeof edge !== "object") return edge;
        const e = edge as Record<string, unknown>;
        if (!(VALIDATION_EDGE_METADATA_KEY in e)) return edge;
        const copy = { ...e };
        delete copy[VALIDATION_EDGE_METADATA_KEY];
        return copy;
      });
    }
    return out;
  } catch {
    // Total by contract, like its caller — and the fallback is a LITERAL, so it
    // cannot throw the way a second spread of a hostile object could. An
    // unexpected throw must not fail a draft, but it must also not become the
    // one route by which Pass-2 prose reaches a frame documented structure-only:
    // degrade to an empty graph, never to the unstripped one.
    return { nodes: [], edges: [] };
  }
}

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
      return stripValidationMetadata(transformGraphToV3(graph as never).graph);
    }
    if (schemaVersion === "v2") {
      return stripValidationMetadata(transformGraphToV2(graph as never));
    }
    // v1 is the identity case — the boundary emits the V1 graph unchanged.
    return stripValidationMetadata(graph);
  } catch (err) {
    log.warn(
      { err, request_id: requestId, schema_version: schemaVersion },
      "staged GRAPH_READY projection failed — emitting the untransformed graph",
    );
    // Still strip on the degraded path: a projection failure must not become the
    // one route by which Pass-2 prose reaches a frame documented structure-only.
    return stripValidationMetadata(graph);
  }
}
