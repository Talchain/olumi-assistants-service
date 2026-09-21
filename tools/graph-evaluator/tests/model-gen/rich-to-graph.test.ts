/**
 * Projection tests: rich model → GraphV3-shaped subset + projection report.
 *
 * Fixture provenance: see source-binding.test.ts — the REAL WP0 gpt-4.1 builder
 * output, not authored here.
 *
 * The load-bearing test in this file is the PROVENANCE one. `schema-v3.ts:457`
 * defaults an absent `extractionType` to `brief_extraction`; that fail-open is
 * how AI content acquires user authority. The mutant here removes the switch's
 * throw and the invariant "no ai_* item ever yields from_brief" is what catches
 * it — an assertion on the SHAPE of the defect, not on the fixture's values.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ProvenanceUnknownError,
  omissionCounts,
  projectInterventionSource,
  projectProvenance,
  richToParsedGraph,
  sha8,
} from "../../src/rich-to-graph.js";
import { parseRichModel, type RichDecisionModel } from "../../src/rich-model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "pricing-builder-wp0.json");

/**
 * Loaded WITHOUT the strict parser: this capture predates
 * `decision.goal_measured_by` (added to the contract 2026-09-22) and is kept
 * precisely because it exercises a qualitative factor, which the later capture
 * does not. The projection reads no field that changed.
 * `source-binding.test.ts` asserts the strict parser rejects it.
 */
function loadFixture(): RichDecisionModel {
  return JSON.parse(readFileSync(FIXTURE, "utf-8")) as RichDecisionModel;
}

/** A real gpt-4.1 capture under the CURRENT contract (2026-09-22, run-2). */
function loadCurrentFixture(): RichDecisionModel {
  return parseRichModel(
    readFileSync(join(HERE, "fixtures", "pricing-builder-20260922.json"), "utf-8"),
  );
}
function clone(m: RichDecisionModel): RichDecisionModel {
  return JSON.parse(JSON.stringify(m)) as RichDecisionModel;
}
function nodeFor(graph: { nodes: Array<{ rich_id: string }> }, richId: string) {
  return graph.nodes.find((n) => n.rich_id === richId);
}

describe("ids", () => {
  it("sha8 is stable and 8 hex chars", () => {
    expect(sha8("opt1")).toMatch(/^[0-9a-f]{8}$/);
    expect(sha8("opt1")).toBe(sha8("opt1"));
    expect(sha8("opt1")).not.toBe(sha8("opt2"));
  });
});

describe("goal and decision", () => {
  it("takes the goal threshold from the target user fact and never invents one", () => {
    const { graph } = richToParsedGraph(loadFixture());
    const goal = nodeFor(graph, "goal");
    expect(goal?.goal_threshold).toBe(20000);
    expect(goal?.goal_threshold_unit).toBe("£/month");
    expect(goal?.provenance).toBe("from_brief");
  });

  it("omits the goal with a reason when no target fact carries a value", () => {
    const model = clone(loadFixture());
    for (const f of model.user_facts) if (f.role === "target") f.value = null;
    const { graph, report } = richToParsedGraph(model);
    expect(nodeFor(graph, "goal")).toBeUndefined();
    expect(report.omitted.find((o) => o.id === "goal")?.reason).toBe("no_value");
  });
});

describe("factors", () => {
  it("maps control → category", () => {
    const { graph } = richToParsedGraph(loadFixture());
    expect(nodeFor(graph, "f1")?.category).toBe("controllable");
  });

  it("carries data.value ONLY when current_value is non-null", () => {
    const { graph } = richToParsedGraph(loadFixture());
    expect(nodeFor(graph, "f1")?.data?.value).toBe(49);
    expect(nodeFor(graph, "f1")?.data?.raw_value).toBe(49);
  });

  it("a null current_value produces NO value field and a no_value omission (never 0)", () => {
    const model = clone(loadFixture());
    model.factors.push({
      id: "f3",
      label: "Pro subscriber count",
      control: "observable",
      measurability: "quantitative",
      epistemic_state: "unknown",
      current_value: null,
      unit: "customers",
      provenance: "ai_proposed",
      source_fact_id: null,
      dsk_refs: [],
    });
    const { graph, report } = richToParsedGraph(model);
    const node = nodeFor(graph, "f3");
    expect(node).toBeDefined();
    expect(node?.data?.value).toBeUndefined();
    expect(node?.data?.raw_value).toBeUndefined();
    expect(report.omitted.find((o) => o.id === "f3")?.reason).toBe("no_value");
  });

  it("omits a qualitative factor with reason 'qualitative' and projects no node for it", () => {
    const { graph, report } = richToParsedGraph(loadFixture());
    expect(nodeFor(graph, "f2")).toBeUndefined();
    expect(report.omitted.find((o) => o.id === "f2")?.reason).toBe("qualitative");
  });
});

describe("options and interventions", () => {
  it("an anchored, known lever projects source brief_extraction", () => {
    const { graph } = richToParsedGraph(loadFixture());
    const opt1 = nodeFor(graph, "opt1");
    const intervention = opt1?.data?.interventions?.[sha8("f1")];
    expect(intervention?.value).toBe(59);
    expect(intervention?.source).toBe("brief_extraction");
  });

  it("an AI-hypothesis lever projects source cee_hypothesis", () => {
    const model = clone(loadFixture());
    const opt2 = model.options.find((o) => o.id === "opt2")!;
    opt2.lever_settings[0].epistemic_state = "ai_hypothesis";
    opt2.lever_settings[0].source_fact_id = null;
    const { graph } = richToParsedGraph(model);
    expect(nodeFor(graph, "opt2")?.data?.interventions?.[sha8("f1")]?.source).toBe(
      "cee_hypothesis",
    );
  });

  it("a lever asserting 'known' with no anchor THROWS rather than defaulting", () => {
    const model = clone(loadFixture());
    model.options[0].lever_settings[0].source_fact_id = null;
    expect(() => richToParsedGraph(model)).toThrow(ProvenanceUnknownError);
  });

  it("a lever on an unprojected (qualitative) factor is omitted, not silently dropped", () => {
    const model = clone(loadFixture());
    model.options[0].lever_settings.push({
      factor_id: "f2",
      value: null,
      unit: null,
      epistemic_state: "ai_hypothesis",
      source_fact_id: null,
    });
    const { report } = richToParsedGraph(model);
    expect(report.omitted.some((o) => o.id.includes("lever_settings[f2]"))).toBe(true);
  });
});

describe("edges", () => {
  it("an unknown magnitude yields mean 0 / p 0.5 FLAGGED as a placeholder", () => {
    const { graph, report } = richToParsedGraph(loadFixture());
    expect(graph.edges).toHaveLength(2);
    for (const edge of graph.edges) {
      expect(edge.strength.mean).toBe(0);
      expect(edge.exists_probability).toBe(0.5);
      expect(edge.magnitude_placeholder).toBe(true);
    }
    expect(report.omitted.filter((o) => o.reason === "unknown_magnitude")).toHaveLength(2);
  });

  it("the placeholder omission says in words that the scorer must not reward it", () => {
    const { report } = richToParsedGraph(loadFixture());
    const entry = report.omitted.find((o) => o.reason === "unknown_magnitude");
    expect(entry?.detail).toContain("MUST NOT REWARD");
  });

  it("a stated magnitude is NOT flagged and carries the effect sign", () => {
    const model = clone(loadFixture());
    const link = model.causal_links[1];
    link.magnitude = { kind: "user_estimate", value: 0.4, note: "stated elasticity" };
    link.effect = "negative";
    const { graph } = richToParsedGraph(model);
    const edge = graph.edges.find((e) => e.rich_id === link.id);
    expect(edge?.magnitude_placeholder).toBeUndefined();
    expect(edge?.strength.mean).toBeCloseTo(-0.4);
  });

  it("temporal semantics on a projected link are reported as omitted", () => {
    const model = clone(loadFixture());
    model.causal_links[0].temporal = {
      delay: "one billing cycle",
      duration: null,
      persistence: "decays",
      note: null,
    };
    const { report } = richToParsedGraph(model);
    expect(report.omitted.some((o) => o.id === model.causal_links[0].id && o.reason === "temporal")).toBe(
      true,
    );
  });
});

describe("constraints", () => {
  it("projects strict '<' as '<=' WITH strictness + relaxed_to + a disclosure", () => {
    const { graph, report } = richToParsedGraph(loadFixture());
    const constraint = graph.goal_constraints.find((c) => c.constraint_id === "c1");
    expect(constraint?.operator).toBe("<=");
    expect(constraint?.strictness).toBe("strict");
    expect(constraint?.relaxed_to).toBe("<=");
    expect(constraint?.value).toBe(4);
    const disclosure = report.disclosures.find((d) => d.constraint_id === "c1");
    expect(disclosure?.original_operator).toBe("<");
    expect(disclosure?.projected_operator).toBe("<=");
    expect(report.omitted.some((o) => o.id === "c1" && o.reason === "strict_operator")).toBe(true);
  });

  it("projects '>' as '>=' the same way", () => {
    const model = clone(loadFixture());
    model.constraints[0].operator = ">";
    const { graph } = richToParsedGraph(model);
    const constraint = graph.goal_constraints[0];
    expect(constraint.operator).toBe(">=");
    expect(constraint.strictness).toBe("strict");
    expect(constraint.relaxed_to).toBe(">=");
  });

  it("passes '<=' / '>=' through as_stated with NO disclosure", () => {
    const model = clone(loadFixture());
    model.constraints[0].operator = "<=";
    const { graph, report } = richToParsedGraph(model);
    expect(graph.goal_constraints[0].operator).toBe("<=");
    expect(graph.goal_constraints[0].strictness).toBe("as_stated");
    expect(graph.goal_constraints[0].relaxed_to).toBeUndefined();
    expect(report.disclosures).toEqual([]);
  });

  it("refuses to approximate '=' — omitted with reason strict_operator, no constraint projected", () => {
    const model = clone(loadFixture());
    model.constraints[0].operator = "=";
    const { graph, report } = richToParsedGraph(model);
    expect(graph.goal_constraints).toEqual([]);
    expect(report.omitted.find((o) => o.id === "c1")?.reason).toBe("strict_operator");
  });
});

describe("provenance — the fail-open shape, inverted", () => {
  it("maps user → from_brief and ai_* → ai_inferred", () => {
    expect(projectProvenance("x", "user")).toBe("from_brief");
    expect(projectProvenance("x", "ai_proposed")).toBe("ai_inferred");
    expect(projectProvenance("x", "ai_hypothesis")).toBe("ai_inferred");
  });

  it("THROWS on an absent or unknown provenance instead of defaulting", () => {
    expect(() => projectProvenance("x", undefined)).toThrow(ProvenanceUnknownError);
    expect(() => projectProvenance("x", "")).toThrow(ProvenanceUnknownError);
    expect(() => projectProvenance("x", "from_brief")).toThrow(ProvenanceUnknownError);
    expect(() => projectInterventionSource("x", "made_up", null)).toThrow(ProvenanceUnknownError);
  });

  it("MUTANT: a factor with an unrecognised provenance aborts the whole projection", () => {
    const model = clone(loadFixture());
    (model.factors[0] as unknown as Record<string, unknown>)["provenance"] = "unspecified";
    expect(() => richToParsedGraph(model)).toThrow(ProvenanceUnknownError);
  });

  it("INVARIANT (what a removed switch would violate): no ai_* item is ever from_brief", () => {
    // Written against the SPEC, not against the fixture: whatever the arm
    // produced, an AI-authored item must never reach the graph as user authority.
    const model = clone(loadFixture());
    model.factors.push({
      id: "f4",
      label: "Competitor price move",
      control: "external",
      measurability: "quantitative",
      epistemic_state: "ai_hypothesis",
      current_value: null,
      unit: null,
      provenance: "ai_proposed",
      source_fact_id: null,
      dsk_refs: [],
    });
    const { graph } = richToParsedGraph(model);
    const aiRichIds = new Set([
      ...model.factors.filter((f) => f.provenance !== "user").map((f) => f.id),
      ...model.options.filter((o) => o.provenance !== "user").map((o) => o.id),
      ...model.outcomes.filter((o) => o.provenance !== "user").map((o) => o.id),
      ...model.causal_links.filter((l) => l.provenance !== "user").map((l) => l.id),
    ]);
    const laundered = [...graph.nodes, ...graph.edges].filter(
      (n) => aiRichIds.has(n.rich_id) && n.provenance === "from_brief",
    );
    expect(laundered).toEqual([]);
    // Positive control: the probe can see something — some node IS from_brief.
    expect(graph.nodes.some((n) => n.provenance === "from_brief")).toBe(true);
  });
});

describe("the current-contract capture projects the same way", () => {
  it("strict < is disclosed, placeholders are flagged, and provenance is always explicit", () => {
    const { graph, report } = richToParsedGraph(loadCurrentFixture());
    expect(graph.goal_constraints[0].strictness).toBe("strict");
    expect(report.disclosures).toHaveLength(1);
    expect(graph.edges.every((e) => e.magnitude_placeholder === true)).toBe(true);
    expect(
      graph.nodes.every((n) => n.provenance === "from_brief" || n.provenance === "ai_inferred"),
    ).toBe(true);
  });
});

describe("report", () => {
  it("counts omissions by reason for the projection-loss table", () => {
    const { report } = richToParsedGraph(loadFixture());
    const counts = omissionCounts(report);
    expect(counts["unknown_magnitude"]).toBe(2);
    expect(counts["qualitative"]).toBe(1);
    expect(counts["strict_operator"]).toBe(1);
    // 3 unknowns in the WP0 output + f2's… f2 is qualitative, so no_value is the
    // 3 open questions only.
    expect(counts["no_value"]).toBe(3);
  });

  it("every projected node/edge/constraint id appears in report.included", () => {
    const { graph, report } = richToParsedGraph(loadFixture());
    for (const n of graph.nodes) expect(report.included).toContain(n.rich_id);
    for (const e of graph.edges) expect(report.included).toContain(e.rich_id);
    for (const c of graph.goal_constraints) expect(report.included).toContain(c.constraint_id);
  });
});
