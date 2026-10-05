/**
 * ⭐ THE MANIFEST READS THE COMPILER'S PERSISTED DISPOSITIONS — and nothing else about the manifest moves.
 *
 * `graph.stated_dispositions` is the records compiler's typed receipt, written ONLY by the register route. The
 * manifest is a pure function of (brief, stored graph), so it re-derives on every read; it emits each REJECTED or
 * ASKED receipt as a typed row (`typed: true`) at the stated item's own offset in the brief, and never a CARRIED one.
 *
 * The receipt quotes the user's sentence (`stated_item.source_quote`). Walked as graph content it would turn a
 * figure the model does NOT hold from `absent` into `prose_only` — a false "we noticed this" built from our own
 * bookkeeping. So the receipt is not a search surface: the quantity rows are identical with and without it.
 */
import { describe, expect, it } from "vitest";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";
import { GraphV3 } from "../../../schemas/cee-v3.js";

type Rec = Record<string, unknown>;

const Q_LOSS = "Raising it to £59 would lose about 5% of customers";
const Q_CHURN = "Monthly churn is 3% today";
const Q_PRICE = "Our Pro plan costs £49 a month";
const BRIEF = `${Q_PRICE}. ${Q_LOSS}. ${Q_CHURN}.`;
const span = (quote: string, literal: string) => ({ start: quote.indexOf(literal), end: quote.indexOf(literal) + literal.length });

const GRAPH = {
  nodes: [
    { id: "g_mrr", kind: "goal", label: "MRR" },
    { id: "fac_price", kind: "factor", label: "Pro plan price", observed_state: { value: 0.245, raw_value: 49, unit: "£/month" } },
  ],
  edges: [{ from: "fac_price", to: "g_mrr", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" }],
};
const RECEIPT = [
  { stated_index: 0, stated_item: { kind: "figure", source_quote: Q_PRICE, value: 49, value_span: span(Q_PRICE, "£49") },
    disposition: "carried", location: { kind: "node", node_id: "fac_price", path: ["observed_state", "raw_value"] }, stored_value: 49 },
  { stated_index: 1, stated_item: { kind: "cause", source_quote: Q_LOSS, value: 5, value_span: span(Q_LOSS, "5%") },
    disposition: "rejected", reason: "stated_relationship_not_carried" },
  { stated_index: 2, stated_item: { kind: "figure", source_quote: Q_CHURN, value: 3, value_span: span(Q_CHURN, "3%") },
    disposition: "asked" },
];
const withReceipt = (receipt: unknown = RECEIPT): Rec => ({ ...structuredClone(GRAPH), stated_dispositions: structuredClone(receipt) });

describe("GraphV3 declares graph.stated_dispositions (additive, optional)", () => {
  it("RED: a strict GraphV3 reader KEEPS a well-formed receipt", () => {
    const parsed = GraphV3.safeParse(withReceipt());
    expect(parsed.success).toBe(true);
    expect((parsed as { data: Rec }).data.stated_dispositions).toEqual(RECEIPT);
  });

  it("CONTROL: a malformed receipt reads as ABSENT — it never fails the graph", () => {
    const parsed = GraphV3.safeParse(withReceipt([{ stated_index: -1, disposition: "nonsense" }]));
    expect(parsed.success).toBe(true);
    // `.catch(undefined)`, exactly as `ref_high_water`: the member reads as undefined and serialises as absent.
    expect((parsed as { data: Rec }).data.stated_dispositions).toBeUndefined();
    expect(JSON.stringify((parsed as { data: Rec }).data)).not.toContain("stated_dispositions");
  });

  it("CONTROL: a graph without the key parses exactly as before (no key appears)", () => {
    const parsed = GraphV3.safeParse(structuredClone(GRAPH));
    expect(parsed.success).toBe(true);
    expect((parsed as { data: Rec }).data).not.toHaveProperty("stated_dispositions");
  });
});

describe("deriveNotModelledManifest — typed rows from the persisted receipt", () => {
  it("⭐ RED: each rejected/asked receipt is a typed row at the stated item's own offset; a carried one is not a row", () => {
    const manifest = deriveNotModelledManifest(BRIEF, withReceipt()) as unknown as Rec;
    const block = manifest.stated_dispositions as Rec;
    expect(block).toEqual({
      status: "recorded",
      carried: 1,
      unlocated: 0,
      items: [
        { stated_index: 1, stated_item_kind: "cause", literal: "5%", char_offset: BRIEF.indexOf(Q_LOSS) + Q_LOSS.indexOf("5%"),
          disposition: "rejected", reason: "stated_relationship_not_carried", typed: true },
        { stated_index: 2, stated_item_kind: "figure", literal: "3%", char_offset: BRIEF.indexOf(Q_CHURN) + Q_CHURN.indexOf("3%"),
          disposition: "clarification_asked", reason: "clarification_asked", typed: true },
      ],
    });
  });

  it("RED: a receipt whose quote is not in the brief is counted as unlocated, never placed at a guessed offset", () => {
    const receipt = [{ stated_index: 0, stated_item: { kind: "figure", source_quote: "not in this brief" },
      disposition: "rejected", reason: "stated_value_not_carried" }];
    const block = (deriveNotModelledManifest(BRIEF, withReceipt(receipt)) as unknown as Rec).stated_dispositions as Rec;
    expect(block).toEqual({ status: "recorded", carried: 0, unlocated: 1, items: [] });
  });

  it("⭐ RED: the receipt is NOT a search surface — every quantity row is identical with and without it", () => {
    const without = deriveNotModelledManifest(BRIEF, structuredClone(GRAPH));
    const withIt = deriveNotModelledManifest(BRIEF, withReceipt());
    // contrast: the receipt quotes "5%" and "3%"; the model holds neither, so both must stay `absent`
    const verdictOf = (m: typeof without, literal: string) => m.quantities!.items.find((i) => i.literal === literal)?.verdict;
    expect(verdictOf(without, "5%")).toBe("absent");
    expect(verdictOf(withIt, "5%")).toBe("absent");
    expect(verdictOf(withIt, "3%")).toBe("absent");
    expect(withIt.quantities).toEqual(without.quantities);
    expect(withIt.inferred_factors).toEqual(without.inferred_factors);
  });

  it("CONTROL: a graph without the key yields a manifest with no new key, byte-identical to before", () => {
    const manifest = deriveNotModelledManifest(BRIEF, structuredClone(GRAPH)) as unknown as Rec;
    expect(manifest).not.toHaveProperty("stated_dispositions");
  });

  it("CONTROL: a malformed receipt yields no typed rows (absence, never a guess)", () => {
    const manifest = deriveNotModelledManifest(BRIEF, withReceipt([{ disposition: "rejected" }])) as unknown as Rec;
    expect(manifest).not.toHaveProperty("stated_dispositions");
  });
});
