import { describe, expect, it } from "vitest";
import { Graph, type GraphT } from "../../src/schemas/graph.js";
import { GraphV3 } from "../../src/schemas/cee-v3.js";
import { simpleRepair } from "../../src/services/repair.js";
import { fixOptionRiskShortcut } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { runConnectivity } from "../../src/cee/unified-pipeline/stages/repair/connectivity.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";
import { fixBridgeChaining } from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { validateGraph } from "../../src/validators/graph-validator.js";
import { projectGraphAndOptionsToV3 } from "../../src/cee/transforms/schema-v3.js";
import { buildAnalysisReadyPayload } from "../../src/cee/transforms/analysis-ready.js";
import { projectGraphForPersistence } from "../../src/orchestrator-v5/persisted-graph-projection.js";
import { resolveRunAdmission } from "../../src/orchestrator-v5/tools/handlers/analysis-ready-core.js";
import { computeAnalysisAffectingGraphHash } from "../../src/orchestrator-v5/context/graph-hash.js";

// Endpoint identities and labels from request 248dc8e5-d41c-415a-8dd3-b3a1c67ef1a9.
// Removed edge coefficients were not logged. These distinct coefficients are
// preservation controls, not a reconstruction of the missing original numbers.
const ids = {
  decision: "f937361a", two: "be215545", lead: "e70301eb", architecture: "5d3c8b3a",
  velocity: "965fa729", risk: "0b1c1aa5", outcome: "6d488675", goal: "028ec925",
};
function fixture(): GraphT {
  const edge = (from: string, to: string, mean: number, structural = false) => ({
    id: `${from}::${to}`, from, to, strength_mean: mean,
    strength_std: structural ? 0.01 : 0.13, belief_exists: structural ? 1 : 0.79,
    effect_direction: mean < 0 ? "negative" : "positive",
    provenance: { source: "hypothesis", quote: "Retained causal hypothesis" },
  });
  return Graph.parse({
    nodes: [
      { id: ids.decision, kind: "decision", label: "Hiring approach" },
      { id: ids.two, kind: "option", label: "Two Developers", data: { interventions: { [ids.velocity]: 0.8 } } },
      { id: ids.lead, kind: "option", label: "Hire a Tech Lead", data: { interventions: { [ids.architecture]: 0.75 } } },
      { id: ids.architecture, kind: "factor", label: "Technical Architecture Quality", category: "controllable", data: { value: 0.3, extractionType: "inferred", factor_type: "other", uncertainty_drivers: [] } },
      { id: ids.velocity, kind: "factor", label: "Team Delivery Velocity", category: "controllable", data: { value: 0.4, extractionType: "inferred", factor_type: "other", uncertainty_drivers: [] } },
      { id: ids.risk, kind: "risk", label: "Coordination Overhead Risk" },
      { id: ids.outcome, kind: "outcome", label: "Feature Launch on Time" },
      { id: ids.goal, kind: "goal", label: "Meet Feature Launch Deadline" },
    ],
    edges: [
      edge(ids.decision, ids.two, 1, true), edge(ids.decision, ids.lead, 1, true),
      edge(ids.two, ids.velocity, 1, true), edge(ids.lead, ids.architecture, 1, true),
      edge(ids.architecture, ids.outcome, 0.2), edge(ids.velocity, ids.outcome, 0.4),
      edge(ids.two, ids.risk, 0.42), edge(ids.risk, ids.outcome, -0.35),
      edge(ids.outcome, ids.goal, 0.8),
    ],
  });
}

describe("captured causal repair boundary", () => {
  it("preserves the original risk mechanism, with no invented parent or direct goal edge", () => {
    const source = fixture();
    const original = structuredClone(source);
    const repaired = simpleRepair(source, "offline-hiring-control", { deferSweepOwnedPatterns: true });
    fixOptionRiskShortcut(repaired, "V1_FLAT");
    const ctx = { graph: repaired, request: { headers: {} }, input: {}, requestId: "offline-control" } as StageContext;
    runConnectivity(ctx);
    expect(ctx.graph).toEqual(repaired);
    expect(fixBridgeChaining(repaired, "V1_FLAT")).toMatchObject({ removedCount: 0, goalEdgesAdded: 0 });
    const final = simpleRepair(repaired);
    expect(final.edges).toHaveLength(original.edges.length - 1);
    expect(final.edges.find((e) => e.from === ids.risk)).toEqual(original.edges.find((e) => e.from === ids.risk));
    expect(final.edges.some((e) => e.to === ids.risk)).toBe(false);
    expect(final.nodes.find((n) => n.id === ids.two)?.unresolved_causal_edges).toEqual([original.edges.find((e) => e.from === ids.two && e.to === ids.risk)]);
    expect(source).toEqual(original);
    expect(simpleRepair(final)).toEqual(final);
    const validation = validateGraph({ graph: final, requestId: "offline", phase: "post_enforcement" });
    expect(validation.errors).toEqual([]);
  });

  it("does not select a different cause when node or edge order changes", () => {
    const source = fixture();
    const reverse = { ...source, nodes: [...source.nodes].reverse(), edges: [...source.edges].reverse() };
    expect(simpleRepair(reverse).edges).toEqual(simpleRepair(source).edges);
  });

  it("retains an unsupported option effect even when another factor bridge exists", () => {
    const source = fixture();
    source.edges.push({ ...source.edges[5], id: "existing_bridge", from: ids.velocity, to: ids.risk });
    const original = source.edges.find((e) => e.from === ids.two && e.to === ids.risk);
    expect(fixOptionRiskShortcut(source, "V1_FLAT").rerouted).toBe(0);
    expect(source.nodes.find((n) => n.id === ids.two)?.unresolved_causal_edges).toEqual([original]);
    expect(source.edges.find((e) => e.id === "existing_bridge")?.strength_mean).toBe(0.4);
  });

  it("carries the unresolved effect through canonical projection, save and reopen, and refuses incomplete comparison", () => {
    const projection = projectGraphAndOptionsToV3(simpleRepair(fixture()));
    const saved = projectGraphForPersistence({ ...projection.graph, options: projection.options });
    const reopened = JSON.parse(JSON.stringify(saved));
    const parsed = GraphV3.parse(reopened);
    expect(parsed.nodes.find((n) => n.id === ids.two)?.unresolved_causal_edges).toHaveLength(1);
    const readiness = buildAnalysisReadyPayload(projection.options, ids.goal, parsed);
    expect(readiness.options.find((o) => o.id === ids.two)?.status).toBe("needs_user_mapping");
    expect(readiness.user_questions?.join(" ")).toContain("Two Developers change Coordination Overhead Risk");
    const admission = resolveRunAdmission(reopened);
    expect(admission.willProceed).toBe(false);
    expect(admission.assessment.blockingIssues.some((issue) => issue.option_id === ids.two && issue.code === "OPTION_NEEDS_MAPPING")).toBe(true);
    expect(parsed.nodes.find((n) => n.id === ids.lead)?.interventions).toEqual(projection.options.find((o) => o.id === ids.lead)?.interventions);
    const resolvedControl = structuredClone(reopened);
    delete resolvedControl.nodes.find((n: { id: string }) => n.id === ids.two).unresolved_causal_edges;
    expect(computeAnalysisAffectingGraphHash(reopened)).not.toBe(computeAnalysisAffectingGraphHash(resolvedControl));
    expect(resolveRunAdmission(resolvedControl).willProceed).toBe(true);
  });
  it("keeps the existing cycle and unsupported-direction refusals", () => {
    const graph = simpleRepair(fixture());
    graph.edges.push({ from: ids.outcome, to: ids.risk, strength_mean: 0.1, strength_std: 0.1, belief_exists: 0.9 });
    const codes = validateGraph({ graph, requestId: "offline", phase: "post_enforcement" }).errors.map((issue) => issue.code);
    expect(codes).toContain("CYCLE_DETECTED");
    expect(codes).toContain("INVALID_EDGE_TYPE");
  });

  it("normalises retained endpoint identities alongside active graph identities", () => {
    const graph = fixture();
    const original = ids.risk;
    const nonCanonical = "Coordination overhead risk";
    graph.nodes.find((node) => node.id === original)!.id = nonCanonical;
    graph.edges = graph.edges.map((edge) => ({ ...edge,
      from: edge.from === original ? nonCanonical : edge.from,
      to: edge.to === original ? nonCanonical : edge.to,
    }));
    const projection = projectGraphAndOptionsToV3(simpleRepair(graph));
    const risk = projection.graph.nodes.find((node) => node.kind === "risk")!;
    expect(projection.graph.nodes.find((node) => node.id === ids.two)?.unresolved_causal_edges?.[0].to).toBe(risk.id);
    expect(projection.graph.edges.some((edge) => edge.from === risk.id && edge.to === ids.outcome)).toBe(true);
  });

});
