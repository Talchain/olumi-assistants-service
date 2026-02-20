/**
 * Stage 4b (Threshold Sweep) — field preservation contract tests.
 *
 * Uses the shared contract harness to verify sentinels survive,
 * allowedDrops are honoured, and preservation guarantees hold.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertSentinel,
  assertPreservationGuarantees,
  validateContractCompliance,
  type StageContract,
} from "./stage-contract-harness.js";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStageThresholdSweep } from "../../src/cee/unified-pipeline/stages/threshold-sweep.js";
import { STAGE_CONTRACT } from "../../src/cee/unified-pipeline/stages/threshold-sweep.contract.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a representative graph with sentinels at every depth. */
function buildSentinelGraph() {
  return {
    version: "1.0",
    default_seed: 42,
    _sentinel_top: "top_marker",
    nodes: [
      {
        id: "goal_1",
        kind: "goal",
        label: "Improve UX Quality",
        goal_threshold: 0.7,
        goal_threshold_raw: 70,
        goal_threshold_unit: "%",
        goal_threshold_cap: 100,
        _sentinel_node: "goal_1_marker",
      },
      {
        id: "dec_1",
        kind: "decision",
        label: "Choose Strategy",
        _sentinel_node: "dec_1_marker",
      },
      {
        id: "opt_a",
        kind: "option",
        label: "Option A",
        data: {
          description: "First option",
          _sentinel_data: "opt_a_data_marker",
        },
        _sentinel_node: "opt_a_marker",
      },
      {
        id: "fac_1",
        kind: "factor",
        label: "Cost Factor",
        category: "controllable",
        data: {
          value: 100,
          factor_type: "cost",
          _sentinel_data: "fac_1_data_marker",
        },
        _sentinel_node: "fac_1_marker",
      },
      {
        id: "out_1",
        kind: "outcome",
        label: "Customer Satisfaction",
        _sentinel_node: "out_1_marker",
      },
    ],
    edges: [
      {
        id: "e1",
        from: "dec_1",
        to: "opt_a",
        strength_mean: 0.5,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        provenance: { source: "brief", _sentinel_prov: "prov_marker_1" },
        _sentinel_edge: "e1_marker",
      },
      {
        id: "e2",
        from: "opt_a",
        to: "fac_1",
        strength_mean: 0.6,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        _sentinel_edge: "e2_marker",
      },
      {
        id: "e3",
        from: "fac_1",
        to: "out_1",
        strength_mean: 0.7,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        _sentinel_edge: "e3_marker",
      },
      {
        id: "e4",
        from: "out_1",
        to: "goal_1",
        strength_mean: 0.8,
        strength_std: 0.1,
        belief_exists: 0.9,
        effect_direction: "positive",
        _sentinel_edge: "e4_marker",
      },
    ],
  };
}

function makeCtx(graph?: any) {
  return {
    requestId: "contract-sweep-test",
    graph: graph ?? buildSentinelGraph(),
    deterministicRepairs: [] as any[],
    repairTrace: {
      deterministic_sweep: {
        sweep_ran: true,
        goal_threshold_stripped: 0,
        goal_threshold_possibly_inferred: 0,
      },
    },
  } as any;
}

function snapshot(obj: unknown): any {
  return structuredClone(obj);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Stage 4b (Threshold Sweep) — field preservation contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Sentinel survival ──────────────────────────────────────────────────
  describe("sentinel survival", () => {
    it("preserves top-level sentinel", async () => {
      const ctx = makeCtx();
      await runStageThresholdSweep(ctx);
      assertSentinel((ctx.graph as any)._sentinel_top, "top_marker", "graph._sentinel_top");
    });

    it("preserves node-level sentinels on all node kinds", async () => {
      const ctx = makeCtx();
      await runStageThresholdSweep(ctx);
      for (const node of (ctx.graph as any).nodes) {
        assertSentinel(node._sentinel_node, `${node.id}_marker`, `nodes[${node.id}]._sentinel_node`);
      }
    });

    it("preserves edge-level sentinels", async () => {
      const ctx = makeCtx();
      await runStageThresholdSweep(ctx);
      for (const edge of (ctx.graph as any).edges) {
        assertSentinel(edge._sentinel_edge, `${edge.id}_marker`, `edges[${edge.id}]._sentinel_edge`);
      }
    });

    it("preserves nested sentinel in edge.provenance", async () => {
      const ctx = makeCtx();
      await runStageThresholdSweep(ctx);
      const e1 = (ctx.graph as any).edges.find((e: any) => e.id === "e1");
      assertSentinel(e1.provenance._sentinel_prov, "prov_marker_1", "edges[e1].provenance._sentinel_prov");
    });

    it("preserves node.data sentinels", async () => {
      const ctx = makeCtx();
      await runStageThresholdSweep(ctx);
      const fac = (ctx.graph as any).nodes.find((n: any) => n.id === "fac_1");
      assertSentinel(fac.data._sentinel_data, "fac_1_data_marker", "nodes[fac_1].data._sentinel_data");
    });
  });

  // ── Preservation guarantees ────────────────────────────────────────────
  describe("preservationGuarantees (harness)", () => {
    it("all preservation-guaranteed fields survive unchanged", async () => {
      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageThresholdSweep(ctx);
      const violations = assertPreservationGuarantees(STAGE_CONTRACT as unknown as StageContract, baseline, ctx.graph);
      expect(violations).toEqual([]);
    });
  });

  // ── Full contract compliance (strip path) ──────────────────────────────
  describe("full contract compliance (harness)", () => {
    it("representative fixture passes full contract validation (strip path)", async () => {
      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageThresholdSweep(ctx);
      const violations = validateContractCompliance(STAGE_CONTRACT as unknown as StageContract, baseline, ctx.graph);
      expect(violations).toEqual([]);
    });

    it("representative fixture passes full contract validation (no-op path)", async () => {
      // Graph with no threshold fields — sweep is a no-op
      const graph = buildSentinelGraph();
      const goalNode = graph.nodes.find((n) => n.id === "goal_1")!;
      delete (goalNode as any).goal_threshold;
      delete (goalNode as any).goal_threshold_raw;
      delete (goalNode as any).goal_threshold_unit;
      delete (goalNode as any).goal_threshold_cap;

      const ctx = makeCtx(graph);
      const baseline = snapshot(ctx.graph);
      await runStageThresholdSweep(ctx);
      const violations = validateContractCompliance(STAGE_CONTRACT as unknown as StageContract, baseline, ctx.graph);
      expect(violations).toEqual([]);
    });
  });

  // ── Harness sanity ─────────────────────────────────────────────────────
  describe("harness sanity", () => {
    it("detects violations when contract is too strict", async () => {
      const strictContract: StageContract = {
        ...STAGE_CONTRACT,
        allowedDrops: {
          topLevel: [],
          node: [], // no drops allowed — but sweep will drop threshold fields
          edge: [],
          option: [],
          nodeData: [],
        },
      };

      const ctx = makeCtx();
      const baseline = snapshot(ctx.graph);
      await runStageThresholdSweep(ctx);
      const violations = validateContractCompliance(strictContract, baseline, ctx.graph);
      expect(violations.length).toBeGreaterThan(0);
    });
  });
});
