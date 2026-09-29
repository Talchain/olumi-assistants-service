import { describe, it, expect } from "vitest";
import { buildModelReceipt } from "../../../../src/orchestrator/pipeline/phase5-validation/model-receipt.js";
import type { ConversationBlock, GraphPatchBlockData } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

function makeGraphPatchBlock(overrides?: Partial<GraphPatchBlockData>): ConversationBlock {
  const defaultGraph = {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Revenue Growth" },
      { id: "opt_1", kind: "option", label: "Price Increase" },
      { id: "opt_2", kind: "option", label: "New Product" },
      { id: "opt_3", kind: "option", label: "Cost Cutting" },
      { id: "fac_1", kind: "factor", label: "Market Demand" },
      { id: "fac_2", kind: "factor", label: "Competition" },
      { id: "fac_3", kind: "factor", label: "Brand Loyalty" },
      { id: "fac_4", kind: "factor", label: "Input Costs" },
      { id: "fac_5", kind: "factor", label: "Regulation" },
    ],
    edges: [
      { from: "opt_1", to: "fac_1", strength: 0.7, exists: 0.9 },
      { from: "opt_1", to: "fac_2", strength: 0.5, exists: 0.8 },
      { from: "fac_1", to: "goal_1", strength: 0.9, exists: 0.95 },
      { from: "fac_2", to: "goal_1", strength: 0.6, exists: 0.85 },
      { from: "opt_2", to: "fac_3", strength: 0.8, exists: 0.9 },
      { from: "fac_3", to: "goal_1", strength: 0.7, exists: 0.8 },
      { from: "opt_3", to: "fac_4", strength: 0.9, exists: 0.95 },
    ],
  } as unknown as GraphV3T;

  return {
    block_id: "block-1",
    block_type: "graph_patch",
    data: {
      patch_type: "full_draft",
      operations: [],
      status: "proposed",
      applied_graph: defaultGraph,
      ...overrides,
    } as GraphPatchBlockData,
    provenance: { trigger: "tool:draft_graph", turn_id: "turn-1", timestamp: new Date().toISOString() },
  };
}

describe("buildModelReceipt", () => {
  it("graph with goal + 3 options + 5 factors + 7 edges → correct counts and labels", () => {
    const block = makeGraphPatchBlock();
    const receipt = buildModelReceipt([block]);

    expect(receipt).toBeDefined();
    expect(receipt!.node_count).toBe(9);
    expect(receipt!.edge_count).toBe(7);
    expect(receipt!.option_labels).toEqual(["Price Increase", "New Product", "Cost Cutting"]);
    expect(receipt!.goal_label).toBe("Revenue Growth");
  });

  it("no graph_patch block → undefined", () => {
    const commentaryBlock = {
      block_id: "block-2",
      block_type: "commentary",
      data: { narrative: "Some text" },
      provenance: { trigger: "tool:explain_results", turn_id: "turn-1", timestamp: new Date().toISOString() },
    } as unknown as ConversationBlock;
    expect(buildModelReceipt([commentaryBlock])).toBeUndefined();
  });

  it("empty blocks → undefined", () => {
    expect(buildModelReceipt([])).toBeUndefined();
  });

  it("graph_patch block without applied_graph → undefined", () => {
    const block = makeGraphPatchBlock();
    delete (block.data as GraphPatchBlockData).applied_graph;
    expect(buildModelReceipt([block])).toBeUndefined();
  });

  it("coaching summary present → top_insight populated", () => {
    const block = makeGraphPatchBlock({ summary: "Price Increase leads due to strong demand elasticity." });
    const receipt = buildModelReceipt([block]);
    expect(receipt!.top_insight).toBe("Price Increase leads due to strong demand elasticity.");
  });

  it("coaching summary absent → top_insight null", () => {
    const block = makeGraphPatchBlock();
    const receipt = buildModelReceipt([block]);
    expect(receipt!.top_insight).toBeNull();
  });

  it("repairs present → repairs_applied_count reflects count", () => {
    const block = makeGraphPatchBlock({
      repairs_applied: [
        { code: "MISSING_EDGE", message: "Added edge from opt_1 to fac_1" },
        { code: "WEAK_EDGE", message: "Strengthened edge from fac_2 to goal_1" },
      ],
    });
    const receipt = buildModelReceipt([block]);
    expect(receipt!.repairs_applied_count).toBe(2);
  });

  it("no repairs → repairs_applied_count is 0", () => {
    const block = makeGraphPatchBlock();
    const receipt = buildModelReceipt([block]);
    expect(receipt!.repairs_applied_count).toBe(0);
  });

  it("analysis_ready present → readiness_status populated", () => {
    const analysisReady = {
      options: [],
      goal_node_id: "goal_1",
      status: "ready",
    };
    const block = makeGraphPatchBlock();
    const receipt = buildModelReceipt([block], analysisReady);
    expect(receipt!.readiness_status).toBe("ready");
  });

  it("analysis_ready absent → readiness_status null", () => {
    const block = makeGraphPatchBlock();
    const receipt = buildModelReceipt([block]);
    expect(receipt!.readiness_status).toBeNull();
  });
});
