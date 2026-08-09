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
 * ── What is guaranteed, exactly ──────────────────────────────────────────────
 * THE SELECTOR ONLY EVER REPLACES A DOCUMENT THAT FAILS THIS PREDICATE WITH ONE
 * THAT PASSES IT. That is the whole guarantee. Because any replacement must
 * itself pass the full composition above, whatever the user receives is a
 * structurally valid graph.
 *
 * ── ⚠ THE KNOWN GAP — READ THIS BEFORE CHANGING EITHER SIDE ──────────────────
 * THIS PREDICATE IS STRICTER THAN WHAT THE DRAFT PATH ACTUALLY SHIPS. It asks
 * "is this document cleanly valid AS IT STANDS?", while the pipeline asks "can
 * this document be made valid?" — and the pipeline REPAIRS several classes of
 * defect that `validateGraph` calls errors:
 *
 *   - `anthropic.ts` (the dangling-edge filter, `llm.draft.dangling_edges_removed`)
 *     silently DROPS edges whose endpoints do not exist. `validateGraph` fails
 *     the same shape with `INVALID_EDGE_REF`.
 *   - `anthropic.ts` TRIMS over-cap node/edge counts. `validateGraph` fails them
 *     with `NODE_LIMIT_EXCEEDED` / `EDGE_LIMIT_EXCEEDED`.
 *   - Stage 4's deterministic sweep (`repair/deterministic-sweep.ts`) ALWAYS
 *     auto-fixes Bucket A — `NAN_VALUE`, `SIGN_MISMATCH`, `INVALID_EDGE_REF`,
 *     `GOAL_HAS_OUTGOING`, `DECISION_HAS_INCOMING`, `CYCLE_DETECTED`.
 *
 * CONSEQUENCE, demonstrated by execution and not merely argued: a document the
 * pipeline would have ACCEPTED AFTER REPAIR can be rejected here and displaced
 * by a different, cleanly-valid document. Injecting ONE dangling edge into the
 * `armD-3` capture flips this predicate to `false` (`INVALID_EDGE_REF`), where
 * the adapter alone would have dropped that single edge and kept the other 27.
 * The harm ceiling is a WORSE BUT VALID graph — never a broken one — which is
 * why the policy stands; but do not restate it as "cannot make a usable draft
 * worse", because it can.
 *
 * REACHABILITY: constructible, and UNWITNESSED on the measured data. 0 of the
 * 15 chosen documents in the 2026-08-09 corpus carry a dangling edge, and every
 * rescue there is genuinely unusable→usable (the seven discarded first
 * documents fail on `MISSING_GOAL` + `MISSING_BRIDGE` — Bucket C, which the
 * sweep does NOT repair — or on a missing `edges` key). But the adapter would
 * not carry a dedicated dangling-edge filter WITH TELEMETRY if it never fired.
 * Closing the gap means modelling the repairs here, which duplicates pipeline
 * logic; that trade-off is rowed, not decided in this file.
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
