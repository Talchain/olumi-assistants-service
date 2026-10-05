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

import { deriveNotModelledManifest as deriveUnbound } from "../not-modelled-manifest.js";
import { currentStatedDispositionRows, statedDispositionsBindingHash } from "../../../orchestrator-v5/graph/stated-dispositions-binding.js";

/** Exactly what the cold read does (`assist.v1.scenario-graph.ts`): the receipt's rows only while bound to this graph. */
const deriveNotModelledManifest = (brief: string, graph: unknown) =>
  deriveUnbound(brief, graph, { statedDispositionRows: currentStatedDispositionRows(graph) });
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
/** P1/R2: the receipt names the graph it was reconciled against — that graph's full-content hash, receipt omitted. */
const BOUND_TO = statedDispositionsBindingHash(structuredClone(GRAPH))!;
const withReceipt = (rows: unknown = RECEIPT, reconciledAgainst: unknown = BOUND_TO): Rec => ({
  ...structuredClone(GRAPH), stated_dispositions: { reconciled_against: reconciledAgainst, rows: structuredClone(rows) },
});

describe("GraphV3 declares graph.stated_dispositions (additive, optional)", () => {
  it("RED: a strict GraphV3 reader KEEPS a well-formed receipt", () => {
    const parsed = GraphV3.safeParse(withReceipt());
    expect(parsed.success).toBe(true);
    expect((parsed as { data: Rec }).data.stated_dispositions).toEqual({ reconciled_against: BOUND_TO, rows: RECEIPT });
  });

  it("RED (P1): the pre-P1 bare-array shape names no graph, so a strict reader reads it as ABSENT", () => {
    const parsed = GraphV3.safeParse({ ...structuredClone(GRAPH), stated_dispositions: structuredClone(RECEIPT) });
    expect(parsed.success).toBe(true);
    expect((parsed as { data: Rec }).data.stated_dispositions).toBeUndefined();
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
      superseded: 2,
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
    expect(block).toEqual({ status: "recorded", carried: 0, unlocated: 1, superseded: 0, items: [] });
  });

  it("⭐ RED: the receipt is NOT a search surface — every quantity row is identical with and without it", () => {
    const without = deriveNotModelledManifest(BRIEF, structuredClone(GRAPH));
    // Unbound on purpose: this row isolates the SEARCH SURFACE (typed rows would supersede these spans — R2 P2b).
    const withIt = deriveUnbound(BRIEF, withReceipt());
    // contrast: the receipt quotes "5%" and "3%"; the model holds neither, so both must stay `absent`
    const verdictOf = (m: typeof without, literal: string) => m.quantities!.items.find((i) => i.literal === literal)?.verdict;
    expect(verdictOf(without, "5%")).toBe("absent");
    expect(verdictOf(withIt, "5%")).toBe("absent");
    expect(verdictOf(withIt, "3%")).toBe("absent");
    expect(withIt.quantities).toEqual(without.quantities);
    expect(withIt.inferred_factors).toEqual(without.inferred_factors);
  });

  it("⭐ RED (P1 a): once the graph is edited (receipt carried forward), the receipt is stale — no typed rows, the untyped manifest", () => {
    const edited = withReceipt();
    (edited.nodes as Rec[]).push({ id: "fac_churn", kind: "factor", label: "Monthly churn", observed_state: { value: 0.03, raw_value: 3, unit: "%" } });
    const { stated_dispositions: _r, ...editedBare } = edited;
    expect(deriveNotModelledManifest(BRIEF, edited)).toEqual(deriveNotModelledManifest(BRIEF, editedBare));
    expect(deriveNotModelledManifest(BRIEF, edited) as unknown as Rec).not.toHaveProperty("stated_dispositions");
  });

  it("⭐ RED (P1 c): a wrong or missing reconciled_against is ignored", () => {
    for (const reconciledAgainst of ["f".repeat(64), "not-a-hash", null]) {
      const manifest = deriveNotModelledManifest(BRIEF, withReceipt(RECEIPT, reconciledAgainst)) as unknown as Rec;
      expect(manifest, String(reconciledAgainst)).not.toHaveProperty("stated_dispositions");
    }
    // missing entirely (a default parameter would hide `undefined`, so the envelope is built by hand)
    const missing = deriveNotModelledManifest(BRIEF, { ...structuredClone(GRAPH), stated_dispositions: { rows: structuredClone(RECEIPT) } }) as unknown as Rec;
    expect(missing).not.toHaveProperty("stated_dispositions");
    // the pre-P1 bare array is ignored too
    const bare = deriveNotModelledManifest(BRIEF, { ...structuredClone(GRAPH), stated_dispositions: structuredClone(RECEIPT) }) as unknown as Rec;
    expect(bare).not.toHaveProperty("stated_dispositions");
    // contrast: the bound receipt is read
    expect(deriveNotModelledManifest(BRIEF, withReceipt()) as unknown as Rec).toHaveProperty("stated_dispositions");
  });

  it("CONTROL: a caller that passes no bound rows gets no typed rows, even for a bound receipt (the safe default)", () => {
    expect(deriveUnbound(BRIEF, withReceipt()) as unknown as Rec).not.toHaveProperty("stated_dispositions");
    expect(deriveUnbound(BRIEF, withReceipt())).toEqual(deriveUnbound(BRIEF, structuredClone(GRAPH)));
  });

  it("⭐ RED (R2 P2b): a typed row SUPERSEDES the read-time row at its span; every tally and invariant still holds", () => {
    const plain = deriveNotModelledManifest(BRIEF, structuredClone(GRAPH));
    const typed = deriveNotModelledManifest(BRIEF, withReceipt()) as unknown as Rec & typeof plain;
    const block = typed.stated_dispositions as unknown as Rec;
    const typedOffsets = (block.items as Rec[]).map((r) => r.char_offset);
    // exactly one row per span: no read-time row shares a typed row's offset…
    expect(typed.quantities!.items.filter((i) => typedOffsets.includes(i.char_offset))).toEqual([]);
    // …and the read-time rows it replaced are the ones the plain manifest reported there
    expect(plain.quantities!.items.filter((i) => typedOffsets.includes(i.char_offset)).map((i) => i.literal)).toEqual(["5%", "3%"]);
    expect(block.superseded).toBe(2);
    // tallies still count EVERY quantity found; the reported slice is honest about what it left out
    const { items: _a, truncated: _t1, ...plainCounts } = plain.quantities!;
    const { items: _b, truncated: _t2, ...typedCounts } = typed.quantities!;
    expect(typedCounts).toEqual(plainCounts);
    expect(typed.quantities!.truncated).toBe(false);
    const tallySum = Object.values(typed.stated_kinds.tally).reduce((a, b) => a + b, 0);
    expect(tallySum).toBe(typed.quantities!.items.length);
    // contrast: an unbound caller keeps both read-time rows
    expect(deriveUnbound(BRIEF, withReceipt()).quantities!.items.map((i) => i.literal)).toEqual(plain.quantities!.items.map((i) => i.literal));
  });

  it("⭐ RED (R2 P1): the binding sees content the identity projection drops (a `ui` key at depth)", () => {
    const graph = { ...structuredClone(GRAPH), nodes: [...structuredClone(GRAPH.nodes),
      { id: "opt_invest", kind: "option", label: "Invest", interventions: { ui: { value: 0, raw_value: 0 } } }] };
    const bound = { ...graph, stated_dispositions: { reconciled_against: statedDispositionsBindingHash(graph), rows: structuredClone(RECEIPT) } };
    expect(currentStatedDispositionRows(bound)).toEqual(RECEIPT); // contrast: bound as written
    const edited = structuredClone(bound);
    ((edited.nodes[2] as Rec).interventions as Rec).ui = { value: 300, raw_value: 300 };
    expect(currentStatedDispositionRows(edited)).toBeUndefined();
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
