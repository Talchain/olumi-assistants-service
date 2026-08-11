/**
 * DRAFT BY RECORDS — `C-BUILD-1`: the projection must satisfy the CONSUMER's schema,
 * not the projector's own types.
 *
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * At `cec98ae2` the records draft path fired correctly, emitted verbatim-quoted typed records and
 * projected them — and then EVERY draft was rejected by CEE's own validator with
 * `edges.N.provenance.source: Required` / `edges.N.provenance.quote: Required`.
 * The arm's four existing spec files test the projector against its OWN types and
 * against determinism; none validated the projected graph with the consumer's Zod
 * schema. That is trap 13d in its purest form — write invariants against the
 * CONSUMER's actual predicate, derived at the consumer's bytes.
 *
 * So every assertion here is derived from a consumer, never restated from prose:
 *   · `LLMDraftResponse` (`adapters/llm/shared-schemas.ts:132`) — the validator
 *     that produced the live failure.
 *   · `StructuredProvenance` (`schemas/graph.ts:344`) — asserted by PARSING, so
 *     the `min(1)` / `max(100)` bounds are never re-typed here and cannot drift.
 *   · `transformEdgeToV3` (`cee/transforms/schema-v3.ts:620`) — the V3 wire
 *     transform, run for real, so the honesty claim is about what a USER would
 *     be shown rather than about the field we happened to set.
 *
 * ── THE ATTRIBUTION RULE THESE TESTS PIN (orchestrator ruling, 2026-08-11) ──
 * Inferred structure is HONESTLY AI-ATTRIBUTED. A user source or quote is NEVER
 * fabricated for an edge the model inferred or the projector scaffolded. The
 * invariants below are written against that SPEC — "no edge may carry user text
 * or map to a user-facing `from_brief`/`user_set` badge" — and NOT against the
 * failure mode in hand (trap 13d again: the spec is what the consumer enforces;
 * the failure mode is only where we came in).
 */

import { describe, expect, it } from "vitest";
import { LLMDraftResponse } from "../../../../adapters/llm/shared-schemas.js";
import { StructuredProvenance } from "../../../../schemas/graph.js";
import { transformEdgeToV3 } from "../../../transforms/schema-v3.js";
import { projectRecordsToGraph, sha8, type ProjectedGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * The canonical set: options (⇒ structural edges) AND a causal link (⇒ an
 * inferred edge), so both provenance classes are exercised in one projection.
 */
const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "cut customer churn", role: "target" },
    { kind: "option", source_quote: "buy a new CRM" },
    { kind: "option", source_quote: "keep the current system" },
    { kind: "constraint", source_quote: "budget of £6,000", value: 6000, unit: "GBP", direction: "ceiling" },
    { kind: "figure", source_quote: "churn is 12%", value: 12, unit: "%", role: "baseline" },
  ],
  claims: [
    { claim_kind: "factor", label: "implementation cost", basis: [1, 3], category: "controllable", value: 4500 },
    { claim_kind: "causal_link", label: "CRM reduces churn", basis: [1], from_ref: "s1", to_ref: "s4", effect: "negative", strength: 0.4 },
    // ⚠ THE SPINE IS PART OF THE FIXTURE. The projector withdraws any factor or
    // constraint that reaches no goal (pass 3b), so an unconnected fixture would
    // leave almost nothing to validate and every assertion below would agree with
    // itself on an empty graph — the vacuous pass this file exists to prevent.
    { claim_kind: "causal_link", label: "churn bears on the goal", basis: [4], from_ref: "s4", to_ref: "s0", effect: "negative" },
    { claim_kind: "causal_link", label: "cost bears on the goal", basis: [3], from_ref: "c0", to_ref: "s0", effect: "negative" },
    { claim_kind: "causal_link", label: "the budget bears on the goal", basis: [3], from_ref: "s3", to_ref: "s0", effect: "negative" },
  ],
};

/**
 * ⚠ THE `quote: z.string().max(100)` TRAP, PINNED (the P3 record's second-order
 * warning). A naive `quote: <the stated quote>` passes on the CRM control brief,
 * whose sentences are short, and fails on the three FIDELITY briefs, whose stated
 * sentences run well past 100 characters — i.e. it would look green exactly where
 * metric 1 is not scored and fail exactly where it is. Every quote here exceeds
 * the cap, so a fix that copies user text into edge provenance cannot pass.
 */
const LONG_QUOTE_A =
  "We need to lift gross margin from the current 71 per cent to at least 78 per cent before the end of the next financial year, and the board has said that number is not negotiable";
const LONG_QUOTE_B =
  "The switching cost quoted by the vendor is eighteen thousand pounds up front plus a further six thousand pounds of training that we would have to fund from this year's operating budget";

const LONG_RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: LONG_QUOTE_A, role: "target" },
    { kind: "option", source_quote: LONG_QUOTE_B },
    { kind: "constraint", source_quote: LONG_QUOTE_A, value: 78, unit: "%", direction: "floor" },
  ],
  claims: [
    { claim_kind: "factor", label: "training cost", basis: [1], value: 6000 },
    { claim_kind: "causal_link", label: "training raises adoption", basis: [0, 1], from_ref: "c0", to_ref: "s0", effect: "positive", strength: 0.3 },
    { claim_kind: "causal_link", label: "the margin floor bears on the goal", basis: [2], from_ref: "s2", to_ref: "s0", effect: "negative" },
  ],
};

const project = (records: DraftRecordSet) =>
  projectRecordsToGraph(JSON.parse(JSON.stringify(records)) as DraftRecordSet);

/** Every string the user actually said, for the non-fabrication sweep. */
const statedQuotes = (records: DraftRecordSet): string[] =>
  (records.stated_items ?? []).map((s) => String(s.source_quote ?? "")).filter((q) => q.length > 0);

const nodesForTransform = (graph: ProjectedGraph) => graph.nodes as unknown as Parameters<typeof transformEdgeToV3>[2];

describe("C-BUILD-1 — the consumer accepts the projection", () => {
  /**
   * THE RED-FIRST ASSERTION. At `cec98ae2` this fails with exactly the live
   * failure's issues (`edges.0.provenance.source` / `.quote`, "Required"); it is
   * the assertion the arm's own suite never made.
   */
  it("`LLMDraftResponse` accepts the projected graph — the assertion the arm-C suite never made", () => {
    const parsed = LLMDraftResponse.safeParse(project(RECORDS).graph);
    const issues = parsed.success
      ? []
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(issues, `consumer rejected the projection: ${issues.join(" | ")}`).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("…and accepts it when every stated quote EXCEEDS the 100-character `quote` cap", () => {
    // The precondition is pinned IN-TEST (trap 13b): a fixture that quietly
    // stopped exceeding the cap would make this test agree for the wrong reason.
    for (const q of statedQuotes(LONG_RECORDS)) expect(q.length).toBeGreaterThan(100);
    const parsed = LLMDraftResponse.safeParse(project(LONG_RECORDS).graph);
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    expect(issues, `consumer rejected the long-quote projection: ${issues.join(" | ")}`).toEqual([]);
  });

  it("…and accepts the edge-free and record-free projections (no vacuous pass hiding here)", () => {
    // Options with no causal links ⇒ structural edges only.
    const structuralOnly = project({ stated_items: [{ kind: "option", source_quote: "do nothing" }], claims: [] });
    expect(structuralOnly.graph.edges.length).toBeGreaterThan(0);
    expect(LLMDraftResponse.safeParse(structuralOnly.graph).success).toBe(true);
    // No options ⇒ no edges at all. This is the case that would pass even with
    // the defect present, which is why it is named rather than relied upon.
    const noEdges = project({ stated_items: [{ kind: "goal", source_quote: "grow" }], claims: [] });
    expect(noEdges.graph.edges).toEqual([]);
    expect(LLMDraftResponse.safeParse(noEdges.graph).success).toBe(true);
  });

  it("every edge's provenance parses as `StructuredProvenance` itself (bounds derived, never re-typed)", () => {
    for (const records of [RECORDS, LONG_RECORDS]) {
      const { graph } = project(records);
      expect(graph.edges.length).toBeGreaterThan(0);
      for (const edge of graph.edges) {
        const parsed = StructuredProvenance.safeParse(edge.provenance);
        expect(parsed.success, `edge ${edge.id} provenance: ${JSON.stringify(edge.provenance)}`).toBe(true);
      }
    }
  });
});

describe("C-K4 — inferred structure is AI-attributed, never user-attributed", () => {
  /**
   * The spec-level invariant. Not "the quote is the string I chose" (which a
   * later edit would silently satisfy) but "no edge carries the user's words".
   */
  it("no edge provenance quote contains, or is contained by, any stated quote", () => {
    for (const records of [RECORDS, LONG_RECORDS]) {
      const { graph } = project(records);
      const quotes = statedQuotes(records);
      expect(quotes.length).toBeGreaterThan(0);
      for (const edge of graph.edges) {
        const q = String((edge.provenance as { quote?: string } | undefined)?.quote ?? "");
        expect(q.length).toBeGreaterThan(0);
        for (const stated of quotes) {
          expect(q.includes(stated), `edge ${edge.id} quote quotes the user: ${q}`).toBe(false);
          expect(stated.includes(q), `edge ${edge.id} quote is a fragment of user text: ${q}`).toBe(false);
        }
      }
    }
  });

  /**
   * ⭐ THE CONSUMER-SIDE HONESTY CLAIM, RUN FOR REAL.
   *
   * `mapToV3ProvenanceSource` (schema-v3.ts:727) is a LOWERCASED SUBSTRING
   * matcher: a `source` containing "brief", "document" or "evidence" becomes
   * `brief_extraction` → the wire's `provenance_display: "from_brief"`, and one
   * containing "user", "specified" or "manual" becomes `user_specified` →
   * `"user_set"`. So a well-meaning `source: "inferred from the brief"` would
   * make the product tell the user their brief stated a link the model invented.
   * The invariant is asserted through the REAL transform, not by inspecting the
   * string, because the substring rule is the consumer's, not ours.
   */
  it("the V3 wire displays every projector edge as `ai_inferred` — never `from_brief`, never `user_set`", () => {
    for (const records of [RECORDS, LONG_RECORDS]) {
      const { graph } = project(records);
      expect(graph.edges.length).toBeGreaterThan(0);
      graph.edges.forEach((edge, index) => {
        const v3 = transformEdgeToV3(edge as never, index, nodesForTransform(graph));
        expect(v3.edge.provenance_display, `edge ${edge.id} display`).toBe("ai_inferred");
        expect(v3.edge.provenance?.source, `edge ${edge.id} v3 source`).not.toBe("brief_extraction");
        expect(v3.edge.provenance?.source, `edge ${edge.id} v3 source`).not.toBe("user_specified");
      });
    }
  });

  /**
   * IDENTITY BINDING (trap 19). Both edges are located by the id the projector
   * mints, recomputed here the same way, so the assertions cannot pass on some
   * other edge that happens to satisfy a value predicate.
   */
  it("the two provenance classes are badged apart, each bound to its minted id", () => {
    const { graph } = project(RECORDS);
    const optionA = sha8("option", "buy a new CRM");
    const churn = sha8("figure", "churn is 12%");
    const inferredEdgeId = sha8("edge", "CRM reduces churn", optionA, churn);
    const decisionId = sha8("decision", optionA, sha8("option", "keep the current system"));
    const structuralEdgeId = sha8("edge", "structural", decisionId, optionA);

    const inferred = graph.edges.find((e) => e.id === inferredEdgeId);
    const structural = graph.edges.find((e) => e.id === structuralEdgeId);
    expect(inferred, `inferred edge ${inferredEdgeId} missing`).toBeDefined();
    expect(structural, `structural edge ${structuralEdgeId} missing`).toBeDefined();

    // The projector's own class survives alongside the consumer's field
    // (`StructuredProvenance` is `.passthrough()`), so satisfying the schema
    // costs no honesty: both vocabularies are present and cannot drift apart.
    // The `source` values are the PRODUCER-declared ones (`hypothesis` from the
    // schema's own comment + the enricher; `synthetic` from the repair sweep and
    // `neutralCausalEdge`), not values minted by this lane.
    expect((inferred!.provenance as { provenance_class?: string }).provenance_class).toBe("ai_inferred");
    expect((inferred!.provenance as { source?: string }).source).toBe("hypothesis");
    expect((structural!.provenance as { provenance_class?: string }).provenance_class).toBe("projector_structural");
    expect((structural!.provenance as { source?: string }).source).toBe("synthetic");
    // The two are DIFFERENT — a fix that badged everything identically would
    // satisfy every other assertion in this file.
    expect((inferred!.provenance as { source?: string }).source)
      .not.toBe((structural!.provenance as { source?: string }).source);
  });

  it("the inferred edge still carries its record basis, and the structural edge claims none", () => {
    const { graph, provenance } = project(RECORDS);
    const optionA = sha8("option", "buy a new CRM");
    const churn = sha8("figure", "churn is 12%");
    const inferredEdgeId = sha8("edge", "CRM reduces churn", optionA, churn);
    // The basis is the honest reference to the records — the ruling's
    // "attribute to the record id, not a quote".
    expect(provenance[inferredEdgeId]?.basis).toEqual([optionA]);
    const inferred = graph.edges.find((e) => e.id === inferredEdgeId)!;
    expect((inferred.provenance as { basis?: string[] }).basis).toEqual([optionA]);
    const decisionId = sha8("decision", optionA, sha8("option", "keep the current system"));
    const structuralEdgeId = sha8("edge", "structural", decisionId, optionA);
    expect(provenance[structuralEdgeId]?.basis).toBeUndefined();
  });
});
