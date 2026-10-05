/**
 * `graph.stated_dispositions` — THE PERSISTED RECEIPT OF WHAT THE RECORDS COMPILER DID WITH EACH STATED ITEM.
 *
 * ── WHY IT IS ON THE GRAPH (DL ruling, 5 Oct 2026) ──────────────────────────
 * The records compiler computes ONE typed disposition per stated item at registration
 * (`cee/draft/records/stated-dispositions.ts`): carried (with the exact carrier it wrote),
 * rejected (with a typed reason), or asked. Until this carrier the receipt rode the register
 * request BESIDE the graph and was never stored, so a reload could not tell a typed rejection
 * from a silent drop. It is now an ADDITIVE, OPTIONAL root key on CEE `GraphV3` only — no
 * `@talchain/schemas` change.
 *
 * ── WHO MAY WRITE IT ───────────────────────────────────────────────────────
 * ONLY the register route (`routes/assist.v1.scenario-graph-register.ts`), from its own
 * request's `stated_dispositions` sidecar, reconciled against the exact bytes it stores. Every
 * other `scenarios.graph` writer drops the key (`omitStatedDispositions`): a receipt describes
 * the graph it was registered with, and carrying it unchanged onto an edited graph would let it
 * advertise a carrier the edit removed. Absence is always honest — the manifest then reports
 * only its read-time quantity scan, exactly as before this key existed.
 *
 * ── WHY `.catch(undefined)` ON THE GRAPH MEMBER ────────────────────────────
 * Every strict `GraphV3` reader fails CLOSED on a parse failure (system events answer 500,
 * readiness reads "unknown"). A malformed receipt must never take the model with it, so on the
 * graph it reads as ABSENT — the same treatment `ref_high_water` gets. The register route's own
 * ingress parse of the sidecar is strict and refuses instead.
 */
import { z } from "zod";

export const STATED_DISPOSITIONS_KEY = "stated_dispositions" as const;

/** A machine code from the compiler's closed reason vocabulary (never prose). */
const TypedReason = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** Edge endpoints are its persisted identity; V3 deliberately strips legacy edge ids. */
const StatedCarrierV3 = z.union([
  z.object({ kind: z.literal("node"), node_id: z.string().min(1), path: z.array(z.string()) }),
  z.object({ kind: z.literal("edge"), from: z.string().min(1), to: z.string().min(1), path: z.array(z.string()) }),
]);

/** The decoded stated item, kept verbatim: a rejected index alone cannot explain a loss after reload. */
const StatedItemV3 = z.object({ kind: z.string().min(1), source_quote: z.string() }).passthrough();

const origin = {
  stated_index: z.number().int().nonnegative(),
  stated_item: StatedItemV3,
};

export const StatedDispositionV3 = z.discriminatedUnion("disposition", [
  z.object({ ...origin, disposition: z.literal("carried"), location: StatedCarrierV3, stored_value: z.unknown() }),
  z.object({ ...origin, disposition: z.literal("rejected"), reason: TypedReason }),
  z.object({ ...origin, disposition: z.literal("asked") }),
]);
export type StatedDispositionV3T = z.infer<typeof StatedDispositionV3>;

/** One receipt per stated item; bounded like every other read-path array. The register request's sidecar shape. */
export const StatedDispositionsV3 = z.array(StatedDispositionV3).max(500);

/**
 * ⛔ THE STORED SHAPE BINDS THE ROWS TO THE GRAPH THEY DESCRIBE (P1, DL 5 Oct 2026).
 *
 * Production CEE `abed3b51` edit lanes copy the stored graph's top-level keys forward
 * (`apply-graph-mutation.ts:228-236`, `edit-graph-dispatch.ts:2170-2174` @abed3b51) and its commit does not drop
 * this key, so a receipt CAN outlive the model it was reconciled against. `reconciled_against` is that model's
 * full-content hash (sha256 of its stable serialisation minus the receipt and `ref_high_water` — never
 * `graph_identity_hash`, which drops transient-UI keys at every depth); a reader uses the rows ONLY while the current
 * graph still hashes to it (`orchestrator-v5/graph/stated-dispositions-binding.ts`). A bare array — the shape before
 * this binding — names no graph and reads as absent.
 */
export const StatedDispositionsReceiptV3 = z.object({
  reconciled_against: z.string().regex(/^[0-9a-f]{64}$/),
  rows: StatedDispositionsV3,
});
export type StatedDispositionsReceiptV3T = z.infer<typeof StatedDispositionsReceiptV3>;

/**
 * The graph WITHOUT the receipt. Returns the ORIGINAL reference when the key is absent, so a
 * graph that never carried it is written, hashed and served byte-for-byte as before.
 */
export function omitStatedDispositions<G>(graph: G): G {
  if (graph === null || typeof graph !== "object" || Array.isArray(graph)) return graph;
  if (!Object.prototype.hasOwnProperty.call(graph, STATED_DISPOSITIONS_KEY)) return graph;
  const { [STATED_DISPOSITIONS_KEY]: _receipt, ...rest } = graph as Record<string, unknown>;
  return rest as G;
}
