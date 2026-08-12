/**
 * BUCKET_C_CODES MOCK-INDEPENDENCE PIN.
 *
 * `options-identical-graceful-dedup.ts` re-derives `ctx.llmRepairNeeded` from
 * BUCKET_C_CODES. It must reach that set through `bucket-c-codes.ts` (a leaf
 * constants module nothing has reason to mock) and NEVER through
 * `deterministic-sweep.ts`, which two wiring specs replace WHOLESALE with a
 * `vi.mock` factory returning only `runDeterministicSweep`:
 *   - tests/unit/cee.unified-pipeline.repair-bypass-wiring.test.ts
 *   - tests/unit/cee.clarifier-retired.test.ts
 *
 * MEASURED, on this branch, before the fix: with a plain
 * `import { BUCKET_C_CODES } from "./deterministic-sweep.js"` in the dedup, this
 * test fails at `options-identical-graceful-dedup.ts` on
 * `BUCKET_C_CODES.has(...)` — "[vitest] No BUCKET_C_CODES export is defined on
 * the … mock".
 *
 * ⚠ WHY THIS FILE HAS TO EXIST, rather than trusting the two specs above: BOTH
 * OF THEM STAY GREEN under that defect. Neither ever calls the dedup, so the
 * broken line never executes. The hazard is latent and invisible to the suite
 * that looks like it covers it — which is exactly how a "just import it"
 * tidy-up would land with nothing red anywhere.
 */

import { describe, it, expect, vi } from "vitest";

// Reproduces the wholesale replacement the two wiring specs perform. A vi.mock
// factory REPLACES the module: anything not returned here is absent.
vi.mock("../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js", () => ({
  runDeterministicSweep: vi.fn(),
}));

// Spread the real module (platform trap 12) — this one is incidental noise
// suppression, not the subject of the test.
vi.mock("../../src/utils/telemetry.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { attemptOptionsIdenticalGracefulDedup } from "../../src/cee/unified-pipeline/stages/repair/options-identical-graceful-dedup.js";

const EDGE = { strength_mean: 0.7, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" as const };

/**
 * Three options, all disconnected from the goal. Two share BOTH an intervention
 * signature and a label, so exactly one is dropped (guard 3b declines on a
 * label mismatch); the third keeps the post-drop count at 2 (guard 4 declines a
 * 1-option decision). Shape borrowed from
 * tests/unit/cee.no-path-to-goal-duplicate-suppression.test.ts.
 */
function makeCollidingGraph(): any {
  return {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_alpha", kind: "option", label: "Alpha", data: { interventions: { fac_price: 0.8 } } },
      { id: "opt_beta", kind: "option", label: "Alpha", data: { interventions: { fac_price: 0.8 } } },
      { id: "opt_gamma", kind: "option", label: "Gamma", data: { interventions: { fac_price: 0.2 } } },
      { id: "fac_price", kind: "factor", label: "Price", category: "controllable", data: { value: 0.5, factor_type: "cost", extractionType: "explicit", uncertainty_drivers: ["market"] } },
      { id: "out_revenue", kind: "outcome", label: "Revenue" },
      { id: "goal_1", kind: "goal", label: "Maximise Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_alpha", ...EDGE, strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "dec_1", to: "opt_beta", ...EDGE, strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "dec_1", to: "opt_gamma", ...EDGE, strength_mean: 1, strength_std: 0.01, belief_exists: 1 },
      { from: "fac_price", to: "out_revenue", ...EDGE },
      { from: "out_revenue", to: "goal_1", ...EDGE, strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.95 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

describe("graceful dedup survives a wholesale deterministic-sweep mock", () => {
  it("completes the drop AND the Bucket-C llmRepairNeeded derivation", () => {
    const ctx: any = {
      graph: makeCollidingGraph(),
      requestId: "mock-independence",
      repairTrace: {},
      pipelineOutcome: { warnings: [] },
    };

    const report = attemptOptionsIdenticalGracefulDedup(ctx);

    // PRECONDITION PINNED IN-TEST (trap 13b): if the dedup declined, the
    // Bucket-C line below never ran and this test would pass while proving
    // nothing about the import.
    expect(report).not.toBeNull();
    expect(report!.dropped_option_ids.length).toBeGreaterThan(0);

    // The derivation the mocked import used to kill.
    expect(typeof ctx.llmRepairNeeded).toBe("boolean");
  });

  it("the sweep really is mocked wholesale here (control for the test above)", async () => {
    // Without this, a future change that stopped the mock applying would leave
    // the test above passing for the wrong reason — it would be exercising the
    // real module and asserting nothing about mock exposure.
    const mod: Record<string, unknown> = await import(
      "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js"
    );
    expect(Object.keys(mod)).toEqual(["runDeterministicSweep"]);
  });
});
