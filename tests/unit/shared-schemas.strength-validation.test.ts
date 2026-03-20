/**
 * Tests for strength_mean clamping and strength_std flooring
 * in LLMEdge Zod schema (shared-schemas.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LLMEdge, EdgeStrength } from "../../src/adapters/llm/shared-schemas.js";
import { log } from "../../src/utils/telemetry.js";

describe("LLMEdge strength validation", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // =========================================================================
  // strength_mean clamping (flat V4 fields)
  // =========================================================================

  describe("strength_mean clamping (flat)", () => {
    it("passes through values in [-1, 1] unchanged", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_mean: 0.7 });
      expect(result.strength_mean).toBe(0.7);
    });

    it("passes through exactly -1 and 1", () => {
      expect(LLMEdge.parse({ from: "a", to: "b", strength_mean: 1 }).strength_mean).toBe(1);
      expect(LLMEdge.parse({ from: "a", to: "b", strength_mean: -1 }).strength_mean).toBe(-1);
    });

    it("passes through 0", () => {
      expect(LLMEdge.parse({ from: "a", to: "b", strength_mean: 0 }).strength_mean).toBe(0);
    });

    it("clamps values above 1 to 1", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_mean: 1.5 });
      expect(result.strength_mean).toBe(1);
    });

    it("clamps values below -1 to -1", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_mean: -2.3 });
      expect(result.strength_mean).toBe(-1);
    });

    it("clamps extreme values", () => {
      expect(LLMEdge.parse({ from: "a", to: "b", strength_mean: 100 }).strength_mean).toBe(1);
      expect(LLMEdge.parse({ from: "a", to: "b", strength_mean: -999 }).strength_mean).toBe(-1);
    });

    it("allows undefined (optional field)", () => {
      const result = LLMEdge.parse({ from: "a", to: "b" });
      expect(result.strength_mean).toBeUndefined();
    });

    it("emits warning log when clamping strength_mean", () => {
      LLMEdge.parse({ from: "a", to: "b", strength_mean: 1.5 });

      const clampCalls = warnSpy.mock.calls.filter(
        (call) => (call[0] as any)?.event === "zod.strength_mean_clamped",
      );
      expect(clampCalls).toHaveLength(1);
      expect((clampCalls[0][0] as any).original).toBe(1.5);
      expect((clampCalls[0][0] as any).clamped).toBe(1);
    });

    it("does NOT emit warning for valid strength_mean", () => {
      LLMEdge.parse({ from: "a", to: "b", strength_mean: 0.7 });
      LLMEdge.parse({ from: "a", to: "b", strength_mean: -0.5 });
      LLMEdge.parse({ from: "a", to: "b", strength_mean: 0 });

      const clampCalls = warnSpy.mock.calls.filter(
        (call) => (call[0] as any)?.event === "zod.strength_mean_clamped",
      );
      expect(clampCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // strength_std flooring (flat V4 fields)
  // =========================================================================

  describe("strength_std flooring (flat)", () => {
    it("passes through valid positive values unchanged", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_std: 0.1 });
      expect(result.strength_std).toBe(0.1);
    });

    it("passes through exactly 0.001 (floor value)", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_std: 0.001 });
      expect(result.strength_std).toBe(0.001);
    });

    it("floors values below 0.001 to 0.001", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_std: 0.0001 });
      expect(result.strength_std).toBe(0.001);
    });

    it("floors zero to 0.001", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_std: 0 });
      expect(result.strength_std).toBe(0.001);
    });

    it("floors negative values to 0.001", () => {
      const result = LLMEdge.parse({ from: "a", to: "b", strength_std: -0.5 });
      expect(result.strength_std).toBe(0.001);
    });

    it("allows undefined (optional field)", () => {
      const result = LLMEdge.parse({ from: "a", to: "b" });
      expect(result.strength_std).toBeUndefined();
    });

    it("emits warning log when flooring strength_std", () => {
      LLMEdge.parse({ from: "a", to: "b", strength_std: 0 });

      const floorCalls = warnSpy.mock.calls.filter(
        (call) => (call[0] as any)?.event === "zod.strength_std_floored",
      );
      expect(floorCalls).toHaveLength(1);
      expect((floorCalls[0][0] as any).original).toBe(0);
      expect((floorCalls[0][0] as any).floored).toBe(0.001);
    });

    it("does NOT emit warning for valid strength_std", () => {
      LLMEdge.parse({ from: "a", to: "b", strength_std: 0.1 });
      LLMEdge.parse({ from: "a", to: "b", strength_std: 0.001 });

      const floorCalls = warnSpy.mock.calls.filter(
        (call) => (call[0] as any)?.event === "zod.strength_std_floored",
      );
      expect(floorCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // EdgeStrength nested object
  // =========================================================================

  describe("EdgeStrength (nested V4)", () => {
    it("clamps nested mean to [-1, 1]", () => {
      const result = LLMEdge.parse({
        from: "a",
        to: "b",
        strength: { mean: 1.5, std: 0.1 },
      });
      expect(result.strength?.mean).toBe(1);
    });

    it("floors nested std to 0.001", () => {
      const result = LLMEdge.parse({
        from: "a",
        to: "b",
        strength: { mean: 0.5, std: 0.0001 },
      });
      expect(result.strength?.std).toBe(0.001);
    });

    it("passes through valid nested values", () => {
      const result = LLMEdge.parse({
        from: "a",
        to: "b",
        strength: { mean: -0.3, std: 0.15 },
      });
      expect(result.strength?.mean).toBe(-0.3);
      expect(result.strength?.std).toBe(0.15);
    });

    it("allows undefined (optional)", () => {
      const result = LLMEdge.parse({ from: "a", to: "b" });
      expect(result.strength).toBeUndefined();
    });
  });

  // =========================================================================
  // Passthrough preservation
  // =========================================================================

  describe("passthrough preservation", () => {
    it("preserves unknown fields alongside clamped values", () => {
      const result = LLMEdge.parse({
        from: "a",
        to: "b",
        strength_mean: 1.5,
        strength_std: 0.0001,
        some_future_field: "preserved",
      });
      expect(result.strength_mean).toBe(1);
      expect(result.strength_std).toBe(0.001);
      expect((result as any).some_future_field).toBe("preserved");
    });
  });
});
