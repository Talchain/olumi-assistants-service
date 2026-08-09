/**
 * ROADMAP 2.996 — is a candidate draft document USABLE?
 *
 * On the no-structured-outputs draft path the model frequently emits a
 * deliberately-partial first JSON object (≈5 nodes, empty or placeholder
 * edges), then prose — *"Given the complexity here, let me actually build this
 * out properly rather than leaving placeholders."* — then a SECOND, COMPLETE
 * object. `extractJsonFromResponse` took the first and discarded the finished
 * graph: 7 of 15 raw arm-D captures on 2026-08-09.
 *
 * ── Why this predicate is a COMPOSITION and not a new heuristic ───────────────
 * It runs, in order, exactly the authorities `anthropic.ts` runs on the chosen
 * document immediately after extraction:
 *
 *     stripModelAuthoredGoalThreshold   (anthropic.ts, ROADMAP 2.281)
 *   → normaliseDraftResponse
 *   → ensureControllableFactorBaselines
 *   → LLMDraftResponse.safeParse       (the adapter's own gate)
 *   → Graph.safeParse                  (the canonical graph type, to BUILD the
 *                                       validator's input rather than cast one)
 *   → validateGraph(...).valid         (the deterministic structural validator)
 *
 * There is no second definition of "a good graph" here (trap 21). The order
 * mirrors the draft path deliberately: the schema parse must run IN FRONT of
 * `validateGraph`, because `validateGraph` dereferences `graph.edges.length`
 * and THROWS on a document that carries no `edges` key at all — which is
 * precisely what three of the seven discarded first documents look like.
 *
 * ── The safety argument ──────────────────────────────────────────────────────
 * The selector only ever displaces a document this predicate REJECTS, with one
 * it ACCEPTS. Because the predicate is at least as strict as the draft path's
 * own acceptance, a displacement always swaps a document the pipeline would
 * have rejected for one it accepts. It cannot make a usable draft worse.
 *
 * ── Purity ───────────────────────────────────────────────────────────────────
 * `normaliseDraftResponse` MUTATES its argument in place, and the pipeline
 * re-normalises whichever document is finally chosen. The predicate therefore
 * scores a deep CLONE and never touches the caller's object.
 *
 * @module adapters/llm/draft-document-acceptance
 */

import {
  normaliseDraftResponse,
  ensureControllableFactorBaselines,
  stripModelAuthoredGoalThreshold,
} from "./normalisation.js";
import { LLMDraftResponse } from "./shared-schemas.js";
import { validateGraph } from "../../validators/graph-validator.js";
import { Graph } from "../../schemas/graph.js";

/**
 * True when the draft path would accept this document as a usable graph.
 *
 * TOTAL by construction: any throw anywhere in the composed pipeline is a
 * rejection, never an escaped exception. A rejection is not an error — it is
 * the ordinary verdict on a partial first document.
 */
export function isUsableDraftDocument(document: unknown): boolean {
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  try {
    const candidate = structuredClone(document);
    stripModelAuthoredGoalThreshold(candidate);
    const { response } = ensureControllableFactorBaselines(normaliseDraftResponse(candidate));

    const parsed = LLMDraftResponse.safeParse(response);
    if (!parsed.success) return false;

    // `Graph` is the canonical graph type `validateGraph` declares it operates
    // on, so parsing through it BUILDS the validator's input rather than
    // asserting one into existence — no `as unknown as` at this boundary.
    const graph = Graph.safeParse({ nodes: parsed.data.nodes, edges: parsed.data.edges });
    if (!graph.success) return false;

    return validateGraph({ graph: graph.data }).valid;
  } catch {
    return false;
  }
}
