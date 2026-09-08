/**
 * EDGE PROVENANCE AT INGRESS — CEE MUST BE ABLE TO PARSE ITS OWN EGRESS.
 *
 * ── THE DEFECT (measured live, deployed CEE `88b4db2c`, 2026-09-08) ────────────
 * Two schemas in this one service disagreed about the same graph:
 *
 *   POST /assist/v1/scenarios/:id/graph/register   → 200 registered:true,
 *        persisted byte-exact (`GraphStateIngressSchema`)
 *   POST /assist/v1/graph-readiness                → HTTP 400, one
 *        "Invalid input" PER EDGE (`Graph` → `EdgeInput`)
 *
 * ── WHICH SIDE WAS WRONG, AND WHY (the derivation, not a preference) ──────────
 * `EdgeProvenanceV3` (`schemas/cee-v3.ts:335-341`) — the PUBLISHED V3 edge
 * provenance shape — is `{ source: <enum>, reasoning?: string }` and declares
 * **no `quote` at all**. `extractProvenanceForV3` (`cee/transforms/schema-v3.ts`
 * :930-938) maps the internal `quote` onto `reasoning` and drops the key. So the
 * provenance CEE EMITS can never satisfy `StructuredProvenance`, which REQUIRES
 * `quote`. The readiness side was wrong: it was asking a MINT-SITE question
 * ("does this attribution CEE is authoring carry a statement?") of an INGRESS
 * payload ("can CEE read this edge?"). One schema, two questions — CLAUDE.md
 * trap 21. The fix names them apart (`SourceOnlyProvenance`) rather than making
 * `quote` optional everywhere, so `shared-schemas.ts:118`'s producer contract for
 * model output keeps its bound and the projector's attribution rule keeps its
 * teeth.
 *
 * ── WHAT THIS CORPUS COVERS, AND WHAT IT DOES NOT ────────────────────────────
 * COVERED — every provenance shape reachable at ingress:
 *   1. `{source, quote}` (+`location`, +passthrough)  — mint-site form  ACCEPT
 *   2. `{source}` only                                — V3 egress       ACCEPT
 *   3. `{source, reasoning}`                          — V3 egress       ACCEPT
 *   4. plain non-empty string                         — legacy          ACCEPT
 *   5. absent                                         — optional        ACCEPT
 *   6. `{source, quote}` with quote > 100 chars       —                 REFUSE
 *   7. `{quote}` / `{}` — no source                   —                 REFUSE
 *   8. `{source: ""}`                                 —                 REFUSE
 *   9. `""`                                           —                 REFUSE
 *  10. `{source, quote: <non-string>}`                —                 REFUSE
 *
 * NOT COVERED, stated rather than left to be discovered:
 *   · `provenance: null`. Refused before and after (`.optional()` admits
 *     `undefined`, not `null`); no producer in this tree emits it, so it is not
 *     asserted here and this change does not move it.
 *   · NODE provenance. Unvalidated by `Node` (passthrough, no `provenance` key) —
 *     which is exactly why the live 400 named edges only, and why the starters'
 *     node-level `"provenance": "ai_inferred"` string was never in question.
 *   · Whether `reasoning` is ever POPULATED on the wire. Shape 3 is derived from
 *     `EdgeProvenanceV3`'s declared optional key, not witnessed: all 163 edges in
 *     the captured corpus below carry `{source}` alone. The schema admits it, so
 *     the union must, but no capture here proves the producer emits it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { Graph, StructuredProvenance, SourceOnlyProvenance } from "../../src/schemas/graph.js";
import { GraphStateIngressSchema } from "../../src/orchestrator-v5/boundary/request-extensions.js";
import { projectGraphForPersistence } from "../../src/orchestrator-v5/persisted-graph-projection.js";
import { normaliseGraphNodeKindField } from "../../src/orchestrator-v5/graph-registration/normalise-node-kind.js";

/**
 * The five starters, and the register route's OWN pipeline replayed on them in
 * order — `normaliseGraphNodeKindField` → `GraphStateIngressSchema` →
 * `projectGraphForPersistence` (`routes/assist.v1.scenario-graph-register.ts`
 * :313-425). All three are pure, so this is the persisted bytes without a store.
 */
const STARTER_IDS = [
  "build-vs-buy",
  "headcount-allocation",
  "market-entry",
  "pricing-model",
  "vendor-selection",
] as const;

function readStarter(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/ui-starters-2026-09-08/${id}.draft.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function persistedFormOf(id: string): unknown {
  const normalised = normaliseGraphNodeKindField(readStarter(id));
  expect(normalised.ok).toBe(true);
  const ingress = GraphStateIngressSchema.safeParse(normalised.graph);
  expect(ingress.success).toBe(true);
  return projectGraphForPersistence(ingress.success ? ingress.data : undefined);
}

describe("the register→readiness round trip, on the real bundled starters", () => {
  it.each(STARTER_IDS)(
    "%s: the bytes `register` persists parse under `Graph`, the readiness ingress",
    (id) => {
      const parsed = Graph.safeParse(persistedFormOf(id));

      // Named, so a failure reports WHICH edge and WHY rather than a bare false.
      const failures = parsed.success
        ? []
        : parsed.error.issues.map((i) => i.path.join("."));
      expect(failures).toEqual([]);
      expect(parsed.success).toBe(true);
    },
  );

  /**
   * THE PRECONDITION, PINNED IN-TEST (trap 13b). The assertions above are only
   * evidence about this defect while the corpus still CARRIES the shape that
   * broke — a later recapture of these fixtures could quietly start emitting
   * `quote` and leave a green suite proving nothing. Bound by identity: an exact
   * edge, named by its endpoint pair, in the starter the live probe used.
   */
  it("the corpus still carries the shape that broke: source-only edge provenance", () => {
    const vendor = readStarter("vendor-selection") as { edges: Record<string, any>[] };

    const edge = vendor.edges.find((e) => e.from === "dec_cdp" && e.to === "opt_rudderstack");
    expect(edge, "vendor-selection edge dec_cdp→opt_rudderstack").toBeDefined();
    expect(edge!.provenance).toEqual({ source: "cee_hypothesis" });

    // And it is not one stray edge: every edge in every starter is source-only,
    // which is why the live 400 carried exactly one issue per edge.
    const shapes = new Set<string>();
    let edgeCount = 0;
    for (const id of STARTER_IDS) {
      for (const e of (readStarter(id) as { edges: Record<string, any>[] }).edges) {
        edgeCount += 1;
        shapes.add(
          e.provenance && typeof e.provenance === "object"
            ? Object.keys(e.provenance).sort().join(",")
            : typeof e.provenance,
        );
      }
    }
    expect(edgeCount).toBe(163);
    expect([...shapes]).toEqual(["source"]);
  });

  /**
   * The other half of the invariant, and the reason this is a ROUND TRIP rather
   * than a parse: the register side must still ACCEPT what readiness now reads.
   * A fix that widened readiness while narrowing register would satisfy every
   * assertion above and still break the product.
   */
  it.each(STARTER_IDS)("%s: `register`'s own contract gate still accepts it", (id) => {
    const normalised = normaliseGraphNodeKindField(readStarter(id));
    expect(normalised.ok).toBe(true);
    expect(GraphStateIngressSchema.safeParse(normalised.graph).success).toBe(true);
  });
});

describe("the ingress provenance union — every shape, both directions", () => {
  /** Parse one edge provenance value through the real `Graph` schema. */
  function accepts(provenance: unknown): boolean {
    const edge: Record<string, unknown> = { from: "a", to: "b" };
    if (provenance !== undefined) edge.provenance = provenance;
    return Graph.safeParse({
      nodes: [
        { id: "a", kind: "decision", label: "A" },
        { id: "b", kind: "option", label: "B" },
      ],
      edges: [edge],
    }).success;
  }

  const OVER_LIMIT = "x".repeat(101);

  it.each([
    ["1 mint-site form {source, quote}", { source: "hypothesis", quote: "Model-inferred causal link" }],
    ["1b mint-site form + location", { source: "report.pdf", quote: "revenue fell", location: "page 3" }],
    ["2 V3 egress, source only", { source: "cee_hypothesis" }],
    ["3 V3 egress + reasoning", { source: "cee_hypothesis", reasoning: "Status-quo option wired to factor" }],
    ["4 legacy flat string", "ai_inferred"],
    ["5 absent", undefined],
  ])("ACCEPTS %s", (_name, provenance) => {
    expect(accepts(provenance)).toBe(true);
  });

  it.each([
    // ⭐ THE LOAD-BEARING ONE. `SourceOnlyProvenance` pins `quote` ABSENT rather
    // than merely omitting it, so an over-long quote cannot fall through the
    // union's first member into the second. Without that pin this case ACCEPTS,
    // and adding a source-only branch would have silently repealed max(100) for
    // every caller — a wider hole than the one being closed.
    ["6 quote over 100 characters", { source: "hypothesis", quote: OVER_LIMIT }],
    ["7a no source, quote only", { quote: "a statement" }],
    ["7b empty object", {}],
    ["8 empty source", { source: "", quote: "a statement" }],
    ["9 empty string", ""],
    ["10 non-string quote", { source: "hypothesis", quote: 5 }],
  ])("REFUSES %s", (_name, provenance) => {
    expect(accepts(provenance)).toBe(false);
  });

  /**
   * The two alternatives must stay DISJOINT — that disjointness is the whole
   * safety argument above, and nothing else in the tree would notice if a later
   * edit to either schema made them overlap.
   */
  it("the two named alternatives are disjoint: neither accepts the other's form", () => {
    const withQuote = { source: "hypothesis", quote: "a statement" };
    const withoutQuote = { source: "cee_hypothesis" };

    expect(StructuredProvenance.safeParse(withQuote).success).toBe(true);
    expect(StructuredProvenance.safeParse(withoutQuote).success).toBe(false);

    expect(SourceOnlyProvenance.safeParse(withoutQuote).success).toBe(true);
    expect(SourceOnlyProvenance.safeParse(withQuote).success).toBe(false);
  });

  /**
   * The mint-site contract is UNCHANGED by this fix, and that is the point of
   * naming the concepts apart rather than loosening one. `StructuredProvenance`
   * is what `shared-schemas.ts:118` gives `LLMEdge`, so a model-authored edge
   * still has to carry a bounded statement.
   */
  it("the mint-site contract still requires a bounded quote", () => {
    expect(StructuredProvenance.safeParse({ source: "hypothesis" }).success).toBe(false);
    expect(
      StructuredProvenance.safeParse({ source: "hypothesis", quote: OVER_LIMIT }).success,
    ).toBe(false);
  });
});

/**
 * ⭐ ACCEPTANCE IS NOT PRESERVATION, AND IT IS NOT NON-PROMOTION.
 *
 * The corpus above proves the union PARSES CEE's own egress. It says nothing
 * about what survives the parse, and nothing about what the parse might ADD.
 * Both are separate claims and both can fail while every case above stays green:
 *
 *   - a `.passthrough()` dropped or narrowed in a later edit silently discards
 *     `reasoning` — the only carrier of WHY CEE drew an edge — and every
 *     ACCEPT/REFUSE case still passes, because they assert `.success` alone;
 *   - a well-meant `.default()`/`.transform()` on `quote` would make an edge CEE
 *     labelled a HYPOTHESIS come out the far side carrying a statement, i.e.
 *     reading as evidence a human never gave. That is the failure mode this
 *     service exists to prevent, and `.success` cannot see it either.
 *
 * `source: "cee_hypothesis"` is the machine saying *I inferred this*. Ingress
 * must carry that through unchanged and must never upgrade it.
 */
describe("source-only ingress preserves its source, and never upgrades a hypothesis", () => {
  /** Parse one edge through the real `Graph` schema and return the parsed edge. */
  function parseEdge(provenance: unknown): Record<string, unknown> {
    const parsed = Graph.safeParse({
      nodes: [
        { id: "a", kind: "decision", label: "A" },
        { id: "b", kind: "option", label: "B" },
      ],
      edges: [{ from: "a", to: "b", provenance }],
    });
    if (!parsed.success) {
      throw new Error(
        `precondition failed: this payload must PARSE for the preservation ` +
          `claim to mean anything. ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    return (parsed.data as { edges: Record<string, unknown>[] }).edges[0];
  }

  it("preserves `source` verbatim — the hypothesis label is not rewritten", () => {
    const edge = parseEdge({ source: "cee_hypothesis" });
    expect((edge.provenance as { source: string }).source).toBe("cee_hypothesis");
  });

  it("preserves `reasoning` — the V3 carrier for WHY, which has no other home", () => {
    const why = "Status-quo option wired to factor";
    const edge = parseEdge({ source: "cee_hypothesis", reasoning: why });
    expect((edge.provenance as { reasoning?: string }).reasoning).toBe(why);
  });

  it("does NOT mint a `quote`: an inferred edge must not come back carrying a statement", () => {
    const edge = parseEdge({ source: "cee_hypothesis" });
    expect(edge.provenance).not.toHaveProperty("quote");
  });

  it("does NOT mint `provenance_source`: ingress may not classify a hypothesis as evidence", () => {
    const edge = parseEdge({ source: "cee_hypothesis" });
    expect(edge).not.toHaveProperty("provenance_source");
  });

  /**
   * The distinction Codex asked to be made explicit, pinned as a PAIR so neither
   * half can drift into the other. These are two different situations and the
   * contract answers them differently ON PURPOSE:
   *   - provenance ABSENT      → the caller claims nothing. `.optional()`, and
   *                              existing callers that never sent it keep working.
   *   - provenance MALFORMED   → the caller claims something and got it wrong.
   *                              Refused, so a nameless attribution cannot enter.
   * A single test asserting only one of these would let the other invert unseen.
   */
  it("absent provenance is compatible; a malformed provenance OBJECT is refused", () => {
    const base = {
      nodes: [
        { id: "a", kind: "decision", label: "A" },
        { id: "b", kind: "option", label: "B" },
      ],
    };
    // absent — the key is not sent at all
    expect(
      Graph.safeParse({ ...base, edges: [{ from: "a", to: "b" }] }).success,
    ).toBe(true);
    // present but naming nothing
    expect(
      Graph.safeParse({ ...base, edges: [{ from: "a", to: "b", provenance: {} }] })
        .success,
    ).toBe(false);
    // present, names nothing, but carries a statement — still refused
    expect(
      Graph.safeParse({
        ...base,
        edges: [{ from: "a", to: "b", provenance: { quote: "a statement" } }],
      }).success,
    ).toBe(false);
  });
});
