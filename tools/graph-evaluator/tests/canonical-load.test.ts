import { describe, it, expect } from "vitest";

/**
 * Canonical-load guard.
 *
 * cli.ts eagerly imports every adapter, so a single missing module breaks
 * the whole harness at import time (this happened: repair-graph-scorer.ts
 * and validate-graph-scorer.ts were never committed and the committed
 * harness could not load from a clean checkout). These tests import each
 * adapter module and the scorer modules so that any future missing-module
 * break fails `npm test` instead of being discovered at run time.
 *
 * Import + export-presence checks only — scoring behaviour is covered by
 * the per-scorer test suites.
 */

const ADAPTER_MODULES: Array<{ path: string; exportName: string }> = [
  { path: "../src/adapters/draft-graph.js", exportName: "DraftGraphAdapter" },
  { path: "../src/adapters/edit-graph.js", exportName: "EditGraphAdapter" },
  { path: "../src/adapters/decision-review.js", exportName: "DecisionReviewAdapter" },
  { path: "../src/adapters/research.js", exportName: "ResearchAdapter" },
  { path: "../src/adapters/orchestrator.js", exportName: "OrchestratorAdapter" },
  { path: "../src/adapters/repair-graph.js", exportName: "RepairGraphAdapter" },
  { path: "../src/adapters/validate-graph.js", exportName: "ValidateGraphAdapter" },
];

describe("canonical load", () => {
  for (const { path, exportName } of ADAPTER_MODULES) {
    it(`imports ${exportName} from ${path}`, async () => {
      const mod = await import(path);
      expect(typeof mod[exportName]).toBe("function");
    });
  }

  it("imports scoreRepairGraph from the recovered repair-graph scorer", async () => {
    const mod = await import("../src/repair-graph-scorer.js");
    expect(typeof mod.scoreRepairGraph).toBe("function");
  });

  it("imports scoreValidateGraph from the recovered validate-graph scorer", async () => {
    const mod = await import("../src/validate-graph-scorer.js");
    expect(typeof mod.scoreValidateGraph).toBe("function");
  });
});
