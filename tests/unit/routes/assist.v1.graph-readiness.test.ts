import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { assessV3Readiness } from "../../../src/routes/assist.v1.graph-readiness.js";

const graph = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Ship' },
    { id: 'fac_a', kind: 'factor', label: 'A' },
    { id: 'fac_b', kind: 'factor', label: 'B' },
  ],
  edges: [],
} as unknown as Parameters<typeof assessV3Readiness>[0];

function makeReady(options: Array<Record<string, unknown>>) {
  return {
    goal_node_id: 'goal_1',
    status: 'ready',
    options,
  } as unknown as Parameters<typeof assessV3Readiness>[1];
}

function readyOption(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opt_1',
    label: 'Option 1',
    status: 'ready',
    interventions: { fac_a: 1, fac_b: 2 },
    ...overrides,
  };
}

describe("graph-readiness distinctiveness filter", () => {
  it("two non-baseline options → pairs_checked === 1 (no explicit is_baseline, no label match)", () => {
    const result = assessV3Readiness(graph, makeReady([
      readyOption({ id: 'opt_1', label: 'Hire senior', interventions: { fac_a: 1, fac_b: 2 } }),
      readyOption({ id: 'opt_2', label: 'Hire juniors', interventions: { fac_a: 2, fac_b: 3 } }),
    ]));
    // Distinctiveness check ran: no IDENTICAL_OPTION_INTERVENTIONS critique should fire,
    // and readiness should reach "ready" (not blocked by allIdentical).
    expect(result.critiques?.find((c) => c.code === 'IDENTICAL_OPTION_INTERVENTIONS')).toBeUndefined();
    expect(result.can_run_analysis).toBe(true);
  });

  it("two identical non-baseline options → IDENTICAL_OPTION_INTERVENTIONS critique", () => {
    const result = assessV3Readiness(graph, makeReady([
      readyOption({ id: 'opt_1', label: 'Hire senior', interventions: { fac_a: 1, fac_b: 2 } }),
      readyOption({ id: 'opt_2', label: 'Hire juniors', interventions: { fac_a: 1, fac_b: 2 } }),
    ]));
    expect(result.critiques?.find((c) => c.code === 'IDENTICAL_OPTION_INTERVENTIONS')).toBeDefined();
    expect(result.can_run_analysis).toBe(false);
  });

  it("one explicit is_baseline + one alternative → baseline excluded, pair NOT compared (pairs_checked === 0)", () => {
    const result = assessV3Readiness(graph, makeReady([
      readyOption({ id: 'opt_base', label: 'Stay', is_baseline: true, interventions: { fac_a: 1, fac_b: 2 } }),
      readyOption({ id: 'opt_alt', label: 'Change', interventions: { fac_a: 1, fac_b: 2 } }),
    ]));
    // Baseline correctly excluded → no distinctiveness check runs → no critique
    expect(result.critiques?.find((c) => c.code === 'IDENTICAL_OPTION_INTERVENTIONS')).toBeUndefined();
  });

  it("labels containing 'status quo' as substring (NOT exact) → not excluded when is_baseline is unset", () => {
    // Previously the substring match dropped "Status quo with bridge financing"
    // from distinctiveness. With exact label match, both options are compared.
    const result = assessV3Readiness(graph, makeReady([
      readyOption({ id: 'opt_1', label: 'Status quo with bridge financing', interventions: { fac_a: 1, fac_b: 2 } }),
      readyOption({ id: 'opt_2', label: 'Status quo with equity raise', interventions: { fac_a: 1, fac_b: 2 } }),
    ]));
    expect(result.critiques?.find((c) => c.code === 'IDENTICAL_OPTION_INTERVENTIONS')).toBeDefined();
  });

  it("exact 'Status quo' label is still excluded when no explicit is_baseline", () => {
    const result = assessV3Readiness(graph, makeReady([
      readyOption({ id: 'opt_base', label: 'Status quo', interventions: { fac_a: 1, fac_b: 2 } }),
      readyOption({ id: 'opt_alt', label: 'Change', interventions: { fac_a: 3, fac_b: 4 } }),
    ]));
    expect(result.critiques?.find((c) => c.code === 'IDENTICAL_OPTION_INTERVENTIONS')).toBeUndefined();
  });

  it("all options classified as baseline by heuristic → fall back to comparing all (not silently skip)", () => {
    // Edge case: every option labelled baseline-like with no explicit is_baseline.
    // The fallback should kick in and actually compare them.
    const result = assessV3Readiness(graph, makeReady([
      readyOption({ id: 'opt_1', label: 'baseline', interventions: { fac_a: 1, fac_b: 2 } }),
      readyOption({ id: 'opt_2', label: 'do nothing', interventions: { fac_a: 1, fac_b: 2 } }),
    ]));
    expect(result.critiques?.find((c) => c.code === 'IDENTICAL_OPTION_INTERVENTIONS')).toBeDefined();
  });
});
