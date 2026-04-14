import { describe, it, expect } from "vitest";
import { flattenInterventions } from "../../../../src/orchestrator/utils/flatten-interventions.js";

describe("flattenInterventions", () => {
  it("passes through bare numbers unchanged", () => {
    const out = flattenInterventions({ fac_a: 0.5, fac_b: -1 }, 'opt_x', 0);
    expect(out).toEqual({ fac_a: 0.5, fac_b: -1 });
  });

  it("extracts .value from rich V3 objects", () => {
    const out = flattenInterventions(
      { fac_a: { value: 0.7, source: 'user' } },
      'opt_x',
      0,
    );
    expect(out).toEqual({ fac_a: 0.7 });
  });

  it("handles one level of nesting: { value: { value: n } }", () => {
    const out = flattenInterventions(
      { fac_a: { value: { value: 0.4 } } as unknown as number },
      'opt_x',
      0,
    );
    expect(out).toEqual({ fac_a: 0.4 });
  });

  it("handles mixed flat + rich", () => {
    const out = flattenInterventions(
      { fac_a: 0.3, fac_b: { value: 0.8 } as unknown as number },
      'opt_x',
      0,
    );
    expect(out).toEqual({ fac_a: 0.3, fac_b: 0.8 });
  });

  it("returns empty object for null/undefined input", () => {
    expect(flattenInterventions(null, 'o', 0)).toEqual({});
    expect(flattenInterventions(undefined, 'o', 0)).toEqual({});
  });

  it("throws with OrchestratorError metadata on non-numeric value", () => {
    try {
      flattenInterventions({ fac_a: 'not a number' as unknown as number }, 'opt_x', 2);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const orch = (err as { orchestratorError?: { code: string; tool: string } }).orchestratorError;
      expect(orch?.code).toBe('INTERNAL_PAYLOAD_ERROR');
      expect(orch?.tool).toBe('run_analysis');
    }
  });

  it("throws on NaN / non-finite numbers", () => {
    expect(() =>
      flattenInterventions({ fac_a: Number.NaN }, 'opt_x', 0),
    ).toThrow();
  });
});
