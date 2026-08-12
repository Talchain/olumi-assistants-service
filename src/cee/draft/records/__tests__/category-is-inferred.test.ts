/**
 * THE PROJECTOR DOES NOT DECLARE A FACTOR CATEGORY. THE VALIDATOR INFERS IT.
 *
 * ── WHY THIS FILE EXISTS (measured, not anticipated) ───────────────────────
 * On a live draft, after the factor→goal split had cleared every kind-level edge
 * violation, the graph still carried `INVALID_EDGE_TYPE ×2` and
 * `CATEGORY_MISMATCH ×2`. The cause was not a topology the model got wrong; it
 * was the PROJECTOR copying the `category` the model volunteered.
 *
 * Derived at the consumer's bytes:
 *   `inferFactorCategories` (`graph-validator.ts:83-134`) computes the category
 *   from STRUCTURE — a factor is `controllable` because an option edge points at
 *   it, `observable` if it carries a value, `external` otherwise.
 *   `ALLOWED_EDGES` (`graph-validator.types.ts:293`) then CONSULTS that category:
 *     { option → factor, toFactorCategory: "controllable" }
 *     { factor → factor, toFactorCategory: "observable" }
 *     { factor → factor, toFactorCategory: "external"   }
 *   and `INVALID_EDGE_TYPE` (`:518`) is raised against the INFERRED value.
 *
 * So a factor the model labelled `observable` that an option acts on does not
 * merely carry a wrong label — the option's own edge becomes invalid. The
 * instruction already declines to ask the model for a category for exactly this
 * reason; the projector was quietly undoing that.
 *
 * The assertions below run the REAL validator, so what is pinned is the
 * consumer's verdict rather than the field we did or did not set.
 */
import { describe, expect, it } from "vitest";
import { validateGraph } from "../../../../validators/graph-validator.js";
import { NODE_KIND_MAP } from "../../../../adapters/llm/normalisation.js";
import { fixFactorGoalEdges } from "../../../unified-pipeline/stages/repair/deterministic-sweep.js";
import { detectEdgeFormat } from "../../../unified-pipeline/utils/edge-format.js";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";
import type { GraphT } from "../../../../schemas/graph.js";

/**
 * The shape that produced the live failure: options act on a hub factor, and the
 * model labels that hub `observable` — which is exactly what a model does when it
 * is thinking about whether a quantity is measurable rather than about who
 * controls it.
 */
const HUB_RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "raise sales productivity" },
    { kind: "option", source_quote: "replace the CRM" },
    { kind: "option", source_quote: "keep what we have" },
  ],
  claims: [
    { claim_kind: "factor", label: "sales productivity uplift", basis: [0], category: "observable" },
    { claim_kind: "causal_link", label: "the new CRM lifts productivity", basis: [1], from_ref: "s1", to_ref: "c0", effect: "positive" },
    { claim_kind: "causal_link", label: "the status quo holds it flat", basis: [2], from_ref: "s2", to_ref: "c0", effect: "negative" },
    { claim_kind: "causal_link", label: "uplift drives the goal", basis: [0], from_ref: "c0", to_ref: "s0", effect: "positive" },
  ],
};

function normalised(records: DraftRecordSet): GraphT {
  const g = projectRecordsToGraph(records).graph;
  return {
    ...g,
    nodes: g.nodes.map((n) => ({ ...n, kind: NODE_KIND_MAP[n.kind.toLowerCase().trim()] ?? n.kind })),
  } as unknown as GraphT;
}

/**
 * The graph the GATE sees, not the raw projection. `factor→goal` is legitimately
 * absent from `ALLOWED_EDGES` and is owned downstream by `fixFactorGoalEdges`,
 * which SPLITS it into `factor→outcome→goal`; validating before that runs would
 * measure a graph the product never gates on and would report an error that is
 * somebody else's job. The splitter is called here by its real implementation, so
 * this stays a claim about the consumer rather than about our model of it.
 */
function codes(records: DraftRecordSet): Record<string, number> {
  const graph = normalised(records);
  fixFactorGoalEdges(graph, detectEdgeFormat(graph.edges as never));
  const out: Record<string, number> = {};
  for (const issue of validateGraph({ graph, // The phase the LIVE gate reports these codes under (`post_sweep_authoritative`
    // in the instance log), so the verdict here is the one the product acts on.
    requestId: "category-test", phase: "post_sweep_authoritative" }).errors) {
    out[issue.code] = (out[issue.code] ?? 0) + 1;
  }
  return out;
}

describe("the model's declared category never reaches the graph", () => {
  /**
   * The precondition is pinned IN-TEST: if a future edit removed `category` from
   * the GRAMMAR, this fixture would stop exercising the case and the assertions
   * below would pass for the wrong reason.
   */
  it("the fixture really does declare a category the projector must ignore", () => {
    expect(HUB_RECORDS.claims[0]!.category).toBe("observable");
  });

  it("the factor-goal splitter really fires on this fixture, or the gate view is vacuous", () => {
    const graph = normalised(HUB_RECORDS);
    expect(fixFactorGoalEdges(graph, detectEdgeFormat(graph.edges as never)).splitCount).toBeGreaterThan(0);
  });

  it("no projected node carries a category field at all", () => {
    for (const node of projectRecordsToGraph(HUB_RECORDS).graph.nodes) {
      expect(node.category, `node ${node.label} carries a category`).toBeUndefined();
    }
  });

  /**
   * ⭐ THE CONSUMER'S VERDICT, which is the assertion that actually matters.
   * With the model's label copied through, this graph raised `INVALID_EDGE_TYPE`
   * on both option→factor edges and `CATEGORY_MISMATCH` on the hub. Without it,
   * the validator infers `controllable` from the option edges and both clear.
   */
  it("the real validator raises neither INVALID_EDGE_TYPE nor CATEGORY_MISMATCH on the hub shape", () => {
    const c = codes(HUB_RECORDS);
    expect(c.INVALID_EDGE_TYPE ?? 0).toBe(0);
    expect(c.CATEGORY_MISMATCH ?? 0).toBe(0);
  });

  /**
   * The opposite-direction twin. A category that agrees with the structure must
   * not be treated as special either — the projector is category-blind, so the
   * verdict must be IDENTICAL whichever value the model volunteers. This is what
   * proves the behaviour comes from ignoring the field rather than from having
   * picked a luckier value to copy.
   */
  it("the verdict is identical whatever category the model declares", () => {
    const baseline = codes(HUB_RECORDS);
    for (const category of ["controllable", "observable", "external", undefined] as const) {
      const variant: DraftRecordSet = {
        ...HUB_RECORDS,
        claims: HUB_RECORDS.claims.map((c, i) => (i === 0 ? { ...c, category } : c)),
      };
      expect(codes(variant), `category=${String(category)} changed the consumer's verdict`).toEqual(baseline);
    }
  });
});

describe("`role` is not a category either", () => {
  /**
   * `target`/`baseline` describe what the user was doing with a number;
   * `controllable`/`observable`/`external` describe a node's position in the
   * causal structure. Answering one question with the other is how a stated
   * figure an option acts on ends up labelled `observable` and its edge rejected.
   */
  it("a stated figure with role=target carries no category", () => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "raise margin" },
        { kind: "option", source_quote: "raise prices" },
        { kind: "figure", source_quote: "margin is 71%", value: 71, unit: "%", role: "target" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "prices move margin", basis: [1], from_ref: "s1", to_ref: "s2", effect: "positive" },
        { claim_kind: "causal_link", label: "margin is the goal", basis: [2], from_ref: "s2", to_ref: "s0", effect: "positive" },
      ],
    };
    const figure = projectRecordsToGraph(records).graph.nodes.filter(
      (n) => n.provenance?.source_quote === "margin is 71%",
    );
    expect(figure).toHaveLength(1);
    expect(figure[0]!.category).toBeUndefined();
    expect(codes(records).INVALID_EDGE_TYPE ?? 0).toBe(0);
  });
});
