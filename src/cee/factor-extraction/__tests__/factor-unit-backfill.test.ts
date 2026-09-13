/**
 * ⭐⭐ A PARTIAL DATA BLOCK IS NOT A COMPLETE ONE.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * Paul's brief *"Should we increase the Pro plan price from £49 to £59?"*
 * reached the graph as a factor labelled "Pro Plan Monthly Price" carrying
 * `{value: 0.49, raw_value: 49}` and **no `unit`, no `factor_type`, no `cap`**.
 *
 * Two downstream harms follow from the single missing `unit`:
 *   1. `inferFactorType` can only return "price" from inside its currency-unit
 *      branch (`enricher.ts:276-329`); with no unit the label falls through to
 *      `"other"` (`:342`) — and `"other"` is a member of the UI's
 *      QUALITATIVE_FACTOR_TYPES, so a price renders as a coarse band.
 *   2. The UI's denormalise path requires a non-null unit, so the `raw_value: 49`
 *      that is sitting right there is structurally unreachable.
 *
 * ── WHY THE ENRICHER NEVER FIXED IT ────────────────────────────────────────
 * The regex extractor DOES find the unit — measured at pristine, the founder's
 * verbatim brief yields `{label:"Price", value:59, baseline:49, unit:"£"}`. The
 * unit is never LOST in transit and never dropped at serialisation
 * (`schema-v3.ts:398` ships it); it is never WRITTEN.
 *
 * `enrichGraphWithFactorsAsync`'s existing-node branch gates every write on
 * `hasFactorData` (`enricher.ts:1348-1352`), which is true when the node has a
 * `value` **or** a `baseline`. A node the model valued is therefore treated as
 * a node with COMPLETE data, and the whole extracted block — unit included — is
 * discarded. Two questions under one name (trap 21): "does this node have a
 * level?" is not "does this node have a unit?".
 *
 * Proven by a discriminating pair at pristine, same brief and same label:
 *   - node `{value: 0.49, raw_value: 49}` → out unchanged, `skipped: 1`
 *   - node `{}`                          → out `{value: 0.49, raw_value: 49,
 *     unit: "£", factor_type: "price", cap: 100, display_value: "£49"}`
 *
 * ── WHAT THIS FIX IS BOUND TO ──────────────────────────────────────────────
 * The backfill is ADDITIVE ONLY and binds by IDENTITY, never by a value
 * predicate another object could satisfy (trap 19): it writes `unit` only when
 * the node's own `raw_value` IS the magnitude the brief stated for this factor
 * (`statedCurrentRaw`). That makes the write a transcription of the same span,
 * not an inference — and it scopes the fix to exactly the class the harm lives
 * in, since an unreachable `raw_value` is the harm.
 */
import { describe, it, expect } from "vitest";
import { enrichGraphWithFactorsAsync } from "../enricher.js";

const FOUNDER_BRIEF = "Should we increase the Pro plan price from £49 to £59?";
const NODE_ID = "fac_pro_price";

function graphWith(data: Record<string, unknown>) {
  return {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Grow revenue", data: {} },
      {
        id: NODE_ID,
        kind: "factor",
        category: "controllable",
        label: "Pro Plan Monthly Price",
        data,
      },
    ],
    edges: [{ from: NODE_ID, to: "goal_1", belief: 0.8 }],
  } as never;
}

async function enrichedNode(data: Record<string, unknown>, brief = FOUNDER_BRIEF) {
  const result = await enrichGraphWithFactorsAsync(graphWith(data), brief, {});
  const node = (result.graph as unknown as { nodes: Array<{ id: string; data: Record<string, unknown> }> })
    .nodes.find((n) => n.id === NODE_ID);
  // Bind by IDENTITY: this assertion is about THIS node, not "a node with 0.49".
  expect(node, `node ${NODE_ID} must survive enrichment`).toBeDefined();
  return node!.data;
}

describe("factor unit backfill — a partial data block is not a complete one", () => {
  it("A. writes the stated currency onto a model-valued factor, and does NOT move its value", async () => {
    const data = await enrichedNode({ value: 0.49, raw_value: 49 });

    // The defect, closed.
    expect(data.unit).toBe("£");
    expect(data.factor_type).toBe("price");

    // ⭐ THE NON-REGRESSION THAT MAKES THIS SAFE: the model's own level is
    // untouched. This fix may add fields; it may never move a number.
    expect(data.value).toBe(0.49);
    expect(data.raw_value).toBe(49);
  });

  it("B. never overwrites a unit the model already stated (opposite direction)", async () => {
    const data = await enrichedNode({ value: 0.49, raw_value: 49, unit: "$" });
    expect(data.unit).toBe("$");
  });

  it("C. never overwrites a factor_type the model already stated (opposite direction)", async () => {
    const data = await enrichedNode({ value: 0.49, raw_value: 49, factor_type: "revenue" });
    expect(data.unit).toBe("£");
    expect(data.factor_type).toBe("revenue");
  });

  it("D. writes nothing when the node's number is NOT the magnitude the brief stated", async () => {
    // The brief says 49 and 59. This node says 999 — a different quantity that
    // merely shares a label. Binding by "the brief mentions £" would stamp it.
    const data = await enrichedNode({ value: 0.999, raw_value: 999 });
    expect(data.unit).toBeUndefined();
    expect(data.factor_type).toBeUndefined();
  });

  it("E. KNOWN NOT COVERED: a model-valued factor with no raw_value gets no unit", async () => {
    // Pinned deliberately so the suite REDs if this set grows or shrinks.
    // Without a raw_value there is no magnitude to match the brief's span
    // against, and stamping a unit onto a bare 0.49 would render "£0.49" —
    // inventing a claim rather than transcribing one.
    const data = await enrichedNode({ value: 0.49 });
    expect(data.unit).toBeUndefined();
  });
});
