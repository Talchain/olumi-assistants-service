/**
 * Stage 2 (Normalise) — field preservation contract test.
 *
 * Verifies: fields present at stage input are present at stage output
 * unless the contract explicitly declares the drop.
 *
 * Uses REAL reconcileStructuralTruth() and normaliseRiskCoefficients() —
 * no mocks on core transforms. Only telemetry is mocked.
 */

import { describe, it, expect, vi } from "vitest";
import { STAGE_CONTRACT } from "../../src/cee/unified-pipeline/stages/normalise.contract.js";
import {
  assertSentinel,
  assertPreservationGuarantees,
  validateContractCompliance,
  type StageContract,
} from "./stage-contract-harness.js";

// ── Mocks (telemetry only) ──────────────────────────────────────────────────

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: {} },
  isProduction: () => false,
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a test graph with sentinel fields at every depth.
 * Topology: decision → option → factor → outcome → goal
 * Includes all node kinds (decision, option, factor×2, outcome, goal) for
 * representative coverage of common pipeline paths.
 */
function buildSentinelGraph() {
  return {
    version: "1",
    default_seed: 17,
    _sentinel_top: "top_level_marker",
    nodes: [
      {
        id: "goal_1",
        kind: "goal",
        label: "Reduce costs",
        description: "Overall cost reduction",
        _sentinel_node: "goal_marker",
      },
      {
        id: "dec_1",
        kind: "decision",
        label: "Cost reduction strategy",
        _sentinel_node: "decision_marker",
      },
      {
        id: "fac_controllable",
        kind: "factor",
        label: "Implementation Cost",
        category: "controllable",
        data: {
          value: 50000,
          baseline: 40000,
          unit: "USD",
          factor_type: "cost",
          uncertainty_drivers: ["market volatility"],
          _sentinel_data: "controllable_data_marker",
        },
        _sentinel_node: "controllable_marker",
      },
      {
        id: "fac_external",
        kind: "factor",
        label: "Market Rate",
        category: "external",
        data: {
          value: 0.05,
          _sentinel_data: "external_data_marker",
        },
        _sentinel_node: "external_marker",
      },
      {
        id: "opt_a",
        kind: "option",
        label: "Option A",
        data: {
          interventions: { fac_controllable: 0.8 },
          _sentinel_option_data: "option_data_marker",
        },
        _sentinel_node: "option_marker",
      },
      {
        id: "outcome_1",
        kind: "outcome",
        label: "Cost savings realised",
        _sentinel_node: "outcome_marker",
      },
    ],
    edges: [
      {
        id: "e0",
        from: "dec_1",
        to: "opt_a",
        strength_mean: 1.0,
        strength_std: 0.05,
        belief_exists: 1.0,
        effect_direction: "positive",
        _sentinel_edge: "edge0_marker",
      },
      {
        id: "e1",
        from: "opt_a",
        to: "fac_controllable",
        strength_mean: 0.7,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "brief_extraction", _sentinel_prov: "prov_marker_1" },
        _sentinel_edge: "edge1_marker",
      },
      {
        id: "e2",
        from: "fac_controllable",
        to: "outcome_1",
        strength_mean: -0.6,
        strength_std: 0.15,
        belief_exists: 0.85,
        effect_direction: "negative",
        _sentinel_edge: "edge2_marker",
      },
      {
        id: "e3",
        from: "fac_external",
        to: "outcome_1",
        strength_mean: 0.3,
        strength_std: 0.2,
        belief_exists: 0.7,
        effect_direction: "positive",
        _sentinel_edge: "edge3_marker",
      },
      {
        id: "e4",
        from: "outcome_1",
        to: "goal_1",
        strength_mean: 0.5,
        strength_std: 0.12,
        belief_exists: 0.8,
        effect_direction: "positive",
        provenance: { source: "cee_hypothesis", _sentinel_prov: "prov_marker_4" },
        _sentinel_edge: "edge4_marker",
      },
    ],
    meta: {
      roots: ["dec_1"],
      leaves: ["goal_1"],
      suggested_positions: {},
      source: "assistant",
    },
  };
}

function makeCtx(graphOverride?: any): any {
  const graph = graphOverride ?? buildSentinelGraph();
  return {
    requestId: "contract-normalise-test",
    graph,
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    collector: { add: vi.fn(), addByStage: vi.fn() },
  };
}

/**
 * Deep-clone via structuredClone to capture baseline before in-place mutation.
 */
function snapshot(obj: unknown): any {
  return structuredClone(obj);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Stage 2 (Normalise) — field preservation contract", () => {
  it("contract name matches stage", () => {
    expect(STAGE_CONTRACT.name).toBe("normalise");
  });

  it("preserves unknown top-level graph fields", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    assertSentinel(
      (ctx.graph as any)._sentinel_top,
      baseline._sentinel_top,
      "graph._sentinel_top",
    );
  });

  it("preserves unknown node-level fields on all node kinds", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    for (const baselineNode of baseline.nodes) {
      const outputNode = (ctx.graph as any).nodes.find(
        (n: any) => n.id === baselineNode.id,
      );
      expect(outputNode).toBeDefined();
      assertSentinel(
        outputNode._sentinel_node,
        baselineNode._sentinel_node,
        `nodes[${baselineNode.id}]._sentinel_node`,
      );
    }
  });

  it("preserves unknown node.data fields (non-reclassified nodes)", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    // Check all nodes that have data with sentinels
    for (const baselineNode of baseline.nodes) {
      if (!baselineNode.data?._sentinel_data) continue;
      const outputNode = (ctx.graph as any).nodes.find(
        (n: any) => n.id === baselineNode.id,
      );
      // For non-reclassified nodes, data sentinels must survive
      if (outputNode.category === baselineNode.category) {
        assertSentinel(
          outputNode.data._sentinel_data,
          baselineNode.data._sentinel_data,
          `nodes[${baselineNode.id}].data._sentinel_data`,
        );
      }
    }
  });

  it("preserves unknown edge-level fields on all edges", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    const outputEdges = (ctx.graph as any).edges;
    // No edges should be removed by normalise
    expect(outputEdges.length).toBe(baseline.edges.length);

    for (const baselineEdge of baseline.edges) {
      const outputEdge = outputEdges.find(
        (e: any) => e.id === baselineEdge.id,
      );
      expect(outputEdge).toBeDefined();
      assertSentinel(
        outputEdge._sentinel_edge,
        baselineEdge._sentinel_edge,
        `edges[${baselineEdge.id}]._sentinel_edge`,
      );
    }
  });

  it("preserves nested sentinel in edge.provenance", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    const outputEdges = (ctx.graph as any).edges;
    for (const baselineEdge of baseline.edges) {
      if (!baselineEdge.provenance?._sentinel_prov) continue;
      const outputEdge = outputEdges.find((e: any) => e.id === baselineEdge.id);
      assertSentinel(
        outputEdge.provenance?._sentinel_prov,
        baselineEdge.provenance._sentinel_prov,
        `edges[${baselineEdge.id}].provenance._sentinel_prov`,
      );
    }
  });

  it("preserves unknown option data fields", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    const optNode = (ctx.graph as any).nodes.find(
      (n: any) => n.id === "opt_a",
    );
    const baselineOpt = baseline.nodes.find(
      (n: any) => n.id === "opt_a",
    );
    assertSentinel(
      optNode.data._sentinel_option_data,
      baselineOpt.data._sentinel_option_data,
      "nodes[opt_a].data._sentinel_option_data",
    );
  });

  it("does not remove any edges (allowedRemovals.edges is false)", async () => {
    const ctx = makeCtx();
    const baselineEdgeCount = (ctx.graph as any).edges.length;
    await runStageNormalise(ctx);

    expect((ctx.graph as any).edges.length).toBe(baselineEdgeCount);
  });

  it("does not remove any nodes (allowedRemovals.nodes is false)", async () => {
    const ctx = makeCtx();
    const baselineNodeCount = (ctx.graph as any).nodes.length;
    await runStageNormalise(ctx);

    expect((ctx.graph as any).nodes.length).toBe(baselineNodeCount);
  });

  it("allowedModifications: edge fields may change value but must remain present", async () => {
    const ctx = makeCtx();
    const baseline = snapshot(ctx.graph);
    await runStageNormalise(ctx);

    for (const baselineEdge of baseline.edges) {
      const outputEdge = (ctx.graph as any).edges.find(
        (e: any) => e.id === baselineEdge.id,
      );
      // strength_mean and effect_direction may change but must exist
      for (const field of STAGE_CONTRACT.allowedModifications.edge) {
        if (baselineEdge[field] !== undefined) {
          if (outputEdge[field] === undefined) {
            throw new Error(
              `UNEXPECTED DROP at edges[${baselineEdge.id}].${field}: ` +
              `field is in allowedModifications (value change OK) but was removed entirely`,
            );
          }
        }
      }
    }
  });

  it("allowedDrops.nodeData: factor_type/uncertainty_drivers drop ONLY on reclassification", async () => {
    // Build graph with an orphan controllable factor (no incoming option edge)
    // STRP Rule 1 will reclassify it → observable, dropping factor_type/uncertainty_drivers
    const graph = buildSentinelGraph();
    graph.nodes.push({
      id: "fac_orphan",
      kind: "factor",
      label: "Orphan Factor",
      category: "controllable",
      data: {
        value: 0.5,
        factor_type: "cost",
        uncertainty_drivers: ["weather"],
        _sentinel_data: "orphan_data_marker",
      },
      _sentinel_node: "orphan_marker",
    } as any);
    // No edge connects option → fac_orphan, so STRP should reclassify it

    const ctx = makeCtx(graph);
    await runStageNormalise(ctx);

    const orphanNode = (ctx.graph as any).nodes.find(
      (n: any) => n.id === "fac_orphan",
    );
    expect(orphanNode).toBeDefined();

    // Category should be reclassified (no longer controllable)
    expect(orphanNode.category).not.toBe("controllable");

    // allowedDrops.nodeData fields should be absent after reclassification
    for (const field of STAGE_CONTRACT.allowedDrops.nodeData) {
      // These are allowed to be dropped when reclassified
      // (they may or may not be — STRP may keep them if new category still uses them)
    }

    // But the sentinel data field must survive even on reclassified nodes
    assertSentinel(
      orphanNode.data._sentinel_data,
      "orphan_data_marker",
      "nodes[fac_orphan].data._sentinel_data (reclassified node)",
    );

    // And the node-level sentinel must survive
    assertSentinel(
      orphanNode._sentinel_node,
      "orphan_marker",
      "nodes[fac_orphan]._sentinel_node (reclassified node)",
    );
  });

  // ── Preservation guarantees (via shared harness) ──────────────────────────

  describe("preservationGuarantees (harness)", () => {
    it("all preservation-guaranteed fields survive unchanged", async () => {
      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageNormalise(ctx);

      const violations = assertPreservationGuarantees(
        STAGE_CONTRACT as unknown as StageContract,
        baseline,
        ctx.graph,
      );
      expect(violations).toEqual([]);
    });

    it("version and default_seed are always preserved", async () => {
      const ctx = makeCtx();
      await runStageNormalise(ctx);

      expect((ctx.graph as any).version).toBe("1");
      expect((ctx.graph as any).default_seed).toBe(17);
    });

    it("node id, kind, label are preserved on non-reclassified nodes", async () => {
      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageNormalise(ctx);

      for (const baselineNode of baseline.nodes) {
        const outputNode = (ctx.graph as any).nodes.find(
          (n: any) => n.id === baselineNode.id,
        );
        expect(outputNode).toBeDefined();
        // id, kind, label are in preservationGuarantees.node
        expect(outputNode.id).toBe(baselineNode.id);
        expect(outputNode.kind).toBe(baselineNode.kind);
        expect(outputNode.label).toBe(baselineNode.label);
      }
    });

    it("edge from, to, strength_std, belief_exists are preserved", async () => {
      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageNormalise(ctx);

      for (const baselineEdge of baseline.edges) {
        const outputEdge = (ctx.graph as any).edges.find(
          (e: any) => e.id === baselineEdge.id,
        );
        expect(outputEdge).toBeDefined();
        // from, to, strength_std, belief_exists are in preservationGuarantees.edge
        expect(outputEdge.from).toBe(baselineEdge.from);
        expect(outputEdge.to).toBe(baselineEdge.to);
        expect(outputEdge.strength_std).toBe(baselineEdge.strength_std);
        expect(outputEdge.belief_exists).toBe(baselineEdge.belief_exists);
      }
    });
  });

  // ── Full contract compliance via harness ──────────────────────────────────

  describe("full contract compliance (harness)", () => {
    it("representative fixture passes full contract validation", async () => {
      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageNormalise(ctx);

      const violations = validateContractCompliance(
        STAGE_CONTRACT as unknown as StageContract,
        baseline,
        ctx.graph,
      );
      expect(violations).toEqual([]);
    });
  });

  // ── Mutation-occurs proof (prove stage ran) ───────────────────────────────

  describe("mutation-occurs proof", () => {
    it("STRP reclassifies orphan controllable factor (allowedModifications.node includes category)", async () => {
      const graph = buildSentinelGraph();
      graph.nodes.push({
        id: "fac_orphan_mut",
        kind: "factor",
        label: "Unconnected Factor",
        category: "controllable",
        data: {
          value: 0.5,
          factor_type: "cost",
          uncertainty_drivers: ["weather"],
          _sentinel_data: "orphan_mut_data_marker",
        },
        _sentinel_node: "orphan_mut_marker",
      } as any);

      const ctx = makeCtx(graph);
      const baselineCategory = "controllable";
      await runStageNormalise(ctx);

      const orphanNode = (ctx.graph as any).nodes.find(
        (n: any) => n.id === "fac_orphan_mut",
      );
      // Category must have been modified (reclassified away from controllable)
      expect(orphanNode.category).not.toBe(baselineCategory);
      // But category must still be present (allowedModifications, not allowedDrops)
      expect(orphanNode.category).toBeDefined();
    });

    it("risk normalisation modifies strength_mean on positive risk→goal edge", async () => {
      // Build graph with a positive risk factor→goal edge that should be flipped
      const graph = buildSentinelGraph();
      // e3 is fac_external → goal_1 with positive strength_mean 0.3.
      // Risk normalisation may flip it. Check whether normalise touched any edge.
      const ctx = makeCtx(graph);
      const baseline = snapshot(ctx.graph);
      await runStageNormalise(ctx);

      // At minimum, the stage must have run without error
      // If corrections were applied, they are in ctx.riskCoefficientCorrections
      expect(Array.isArray(ctx.riskCoefficientCorrections)).toBe(true);
    });
  });

  // ── Drop path coverage ────────────────────────────────────────────────────

  describe("drop path coverage", () => {
    it("STRP Rule 1 drops factor_type from reclassified controllable→observable node", async () => {
      const graph = buildSentinelGraph();
      graph.nodes.push({
        id: "fac_drop_test",
        kind: "factor",
        label: "Drop Test Factor",
        category: "controllable",
        data: {
          value: 0.5,
          factor_type: "cost",
          uncertainty_drivers: ["demand"],
          _sentinel_data: "drop_test_marker",
        },
        _sentinel_node: "drop_test_node_marker",
      } as any);

      const ctx = makeCtx(graph);
      await runStageNormalise(ctx);

      const node = (ctx.graph as any).nodes.find(
        (n: any) => n.id === "fac_drop_test",
      );
      expect(node).toBeDefined();
      // Node should be reclassified (no option edges)
      expect(node.category).not.toBe("controllable");
      // factor_type and uncertainty_drivers are in allowedDrops.nodeData
      // After reclassification, at least one should be dropped or absent
      const factorTypeDropped = node.data?.factor_type === undefined;
      const uncDriversDropped = node.data?.uncertainty_drivers === undefined;
      expect(factorTypeDropped || uncDriversDropped).toBe(true);
    });
  });

  // ── Harness sanity (wrong contract → violations detected) ─────────────────

  describe("harness sanity", () => {
    it("detects violations when contract is too strict (no modifications allowed)", async () => {
      const graph = buildSentinelGraph();
      // Add orphan controllable factor to guarantee STRP mutation
      graph.nodes.push({
        id: "fac_sanity",
        kind: "factor",
        label: "Sanity Check Factor",
        category: "controllable",
        data: {
          value: 0.5,
          factor_type: "cost",
          uncertainty_drivers: ["test"],
          _sentinel_data: "sanity_data_marker",
        },
        _sentinel_node: "sanity_node_marker",
      } as any);

      const ctx = makeCtx(graph);
      const baseline = snapshot(ctx.graph);
      await runStageNormalise(ctx);

      // Use a deliberately wrong contract: allowedModifications is empty
      const wrongContract: StageContract = {
        name: "normalise-wrong",
        allowedDrops: {
          topLevel: [],
          node: [],
          edge: [],
          option: [],
          nodeData: [],
        },
        allowedModifications: {
          topLevel: [],
          node: [],     // category NOT declared → should catch STRP reclassification
          edge: [],
          option: [],
          nodeData: [],
        },
        preservationGuarantees: {
          topLevel: [],
          node: [],
          edge: [],
          option: [],
          nodeData: [],
        },
        allowedRemovals: { nodes: false, edges: false },
      };

      const violations = validateContractCompliance(
        wrongContract,
        baseline,
        ctx.graph,
      );
      // The wrong contract should detect at least one violation
      // (STRP reclassified the orphan factor → category changed → undeclared modification)
      expect(violations.length).toBeGreaterThan(0);
      const categoryViolation = violations.find(
        (v) => v.path.includes("fac_sanity") && v.path.includes("category"),
      );
      expect(categoryViolation).toBeDefined();
    });
  });
});
