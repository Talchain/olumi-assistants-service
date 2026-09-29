import { describe, it, expect, beforeAll } from "vitest";

let percentile: (sorted: number[], quantile: number) => number;
let evaluateWindowGates: (window: any) => {
  violations: string[];
  resumeSuccessRate: number;
  trimRate: number;
  maxResumeLatency: number;
  errorRate: number;
};

beforeAll(async () => {
  const mod = await import("../../perf/sse-live-resume.mjs");
  percentile = mod.percentile;
  evaluateWindowGates = mod.evaluateWindowGates;
});

describe("sse-live-resume perf helpers", () => {
  describe("percentile", () => {
    it("returns 0 for empty input", () => {
      expect(percentile([], 0.5)).toBe(0);
    });

    it("returns first element for quantile <= 0", () => {
      const sorted = [10, 20, 30];
      expect(percentile(sorted, 0)).toBe(10);
      expect(percentile(sorted, -0.1)).toBe(10);
    });

    it("returns last element for quantile >= 1", () => {
      const sorted = [10, 20, 30];
      expect(percentile(sorted, 1)).toBe(30);
      expect(percentile(sorted, 2)).toBe(30);
    });

    it("returns expected value for mid quantiles", () => {
      const sorted = [10, 20, 30, 40];
      expect(percentile(sorted, 0.5)).toBe(sorted[2]);
      expect(percentile(sorted, 0.25)).toBe(sorted[1]);
      expect(percentile(sorted, 0.75)).toBe(sorted[3]);
    });
  });

  describe("evaluateWindowGates", () => {
    function baseWindow(overrides: Partial<any> = {}) {
      return {
        resume_attempts: 0,
        resume_successes: 0,
        resume_failures: 0,
        buffer_trims: 0,
        resume_latencies: [] as number[],
        streams_in_window: 0,
        errors_total: 0,
        ...overrides,
      };
    }

    it("returns no violations for healthy window", () => {
      const window = baseWindow({
        resume_attempts: 10,
        resume_successes: 10,
        streams_in_window: 10,
        buffer_trims: 0,
        resume_latencies: [500, 700, 900],
        errors_total: 0,
      });

      const result = evaluateWindowGates(window);
      expect(result.violations).toHaveLength(0);
      expect(result.resumeSuccessRate).toBeCloseTo(100);
      expect(result.trimRate).toBeCloseTo(0);
      expect(result.errorRate).toBeCloseTo(0);
    });

    it("flags low resume success rate when attempts are sufficient", () => {
      const window = baseWindow({
        resume_attempts: 10,
        resume_successes: 8,
        streams_in_window: 10,
      });

      const result = evaluateWindowGates(window);
      expect(result.violations.some(v => v.includes("Resume success rate in window"))).toBe(true);
    });

    it("flags high trim rate when streams_in_window >= 2", () => {
      const window = baseWindow({
        streams_in_window: 10,
        buffer_trims: 2,
      });

      const result = evaluateWindowGates(window);
      expect(result.violations.some(v => v.includes("Buffer trim rate in window"))).toBe(true);
    });

    it("flags high max resume latency", () => {
      const window = baseWindow({
        streams_in_window: 5,
        resume_latencies: [10000, 20000],
      });

      const result = evaluateWindowGates(window);
      expect(result.violations.some(v => v.includes("Resume latency in window"))).toBe(true);
    });

    it("flags high error rate when streams_in_window >= 2", () => {
      const window = baseWindow({
        streams_in_window: 10,
        errors_total: 2,
      });

      const result = evaluateWindowGates(window);
      expect(result.violations.some(v => v.includes("Error rate in window"))).toBe(true);
    });
  });
});
