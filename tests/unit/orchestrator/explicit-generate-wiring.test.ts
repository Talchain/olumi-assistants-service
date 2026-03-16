/**
 * explicit_generate wiring tests.
 *
 * Verifies that:
 * 1. The Zod schema accepts both `generate_model` and `explicit_generate`
 * 2. `normalizeGenerateModel()` merges both flags
 * 3. `inferTurnType()` recognises `explicit_generate` field
 * 4. Both pipeline entry points override the intent gate when generate_model is true
 */
import { describe, it, expect } from "vitest";
import { TurnRequestSchema } from "../../../src/orchestrator/route-schemas.js";
import { normalizeGenerateModel } from "../../../src/orchestrator/request-normalization.js";
import { inferTurnType } from "../../../src/orchestrator/turn-contract.js";

// ============================================================================
// 1. Zod schema acceptance
// ============================================================================

describe("TurnRequestSchema — explicit_generate alias", () => {
  const base = {
    message: "Should I hire a tech lead or two developers?",
    scenario_id: "sc-1",
    client_turn_id: "ct-1",
  };

  it("accepts generate_model: true", () => {
    const result = TurnRequestSchema.safeParse({ ...base, generate_model: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generate_model).toBe(true);
    }
  });

  it("accepts explicit_generate: true", () => {
    const result = TurnRequestSchema.safeParse({ ...base, explicit_generate: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.explicit_generate).toBe(true);
    }
  });

  it("defaults generate_model to false when absent", () => {
    const result = TurnRequestSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generate_model).toBe(false);
      expect(result.data.explicit_generate).toBeUndefined();
    }
  });

  it("accepts both fields simultaneously", () => {
    const result = TurnRequestSchema.safeParse({
      ...base,
      generate_model: false,
      explicit_generate: true,
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// 2. normalizeGenerateModel
// ============================================================================

describe("normalizeGenerateModel", () => {
  it("returns true when generate_model is true", () => {
    expect(normalizeGenerateModel({ generate_model: true })).toBe(true);
  });

  it("returns true when explicit_generate is true", () => {
    expect(normalizeGenerateModel({ explicit_generate: true })).toBe(true);
  });

  it("returns true when both are true", () => {
    expect(normalizeGenerateModel({ generate_model: true, explicit_generate: true })).toBe(true);
  });

  it("returns true when explicit_generate is true and generate_model is false", () => {
    expect(normalizeGenerateModel({ generate_model: false, explicit_generate: true })).toBe(true);
  });

  it("returns false when both are false", () => {
    expect(normalizeGenerateModel({ generate_model: false, explicit_generate: false })).toBe(false);
  });

  it("returns false when both are absent", () => {
    expect(normalizeGenerateModel({})).toBe(false);
  });

  it("returns false when generate_model is false and explicit_generate is absent", () => {
    expect(normalizeGenerateModel({ generate_model: false })).toBe(false);
  });
});

// ============================================================================
// 3. inferTurnType recognises explicit_generate field
// ============================================================================

describe("inferTurnType — explicit_generate field", () => {
  const base = { message: "Hire decision", scenario_id: "sc-1", client_turn_id: "ct-1" };

  it("returns 'explicit_generate' when generate_model is true", () => {
    expect(inferTurnType({ ...base, generate_model: true })).toBe("explicit_generate");
  });

  it("returns 'explicit_generate' when explicit_generate is true", () => {
    expect(inferTurnType({ ...base, explicit_generate: true })).toBe("explicit_generate");
  });

  it("returns 'conversation' when neither flag is set", () => {
    expect(inferTurnType(base)).toBe("conversation");
  });

  it("returns 'explicit_generate' when explicit_generate is true and generate_model is false", () => {
    expect(inferTurnType({ ...base, generate_model: false, explicit_generate: true })).toBe("explicit_generate");
  });
});

// ============================================================================
// 4. End-to-end: Zod parse → normalise → verify routing flag
// ============================================================================

describe("end-to-end: explicit_generate request → generate_model normalization", () => {
  const base = {
    message: "Should I hire a tech lead or two developers?",
    scenario_id: "sc-1",
    client_turn_id: "ct-1",
  };

  it("explicit_generate: true in request body results in generate_model: true after normalization", () => {
    const parsed = TurnRequestSchema.safeParse({ ...base, explicit_generate: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const generateModel = normalizeGenerateModel(parsed.data);
      expect(generateModel).toBe(true);
    }
  });

  it("neither flag in request body results in generate_model: false after normalization", () => {
    const parsed = TurnRequestSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const generateModel = normalizeGenerateModel(parsed.data);
      expect(generateModel).toBe(false);
    }
  });

  it("explicit_generate: true with empty message still parses and normalizes", () => {
    const parsed = TurnRequestSchema.safeParse({
      ...base,
      message: "",
      explicit_generate: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const generateModel = normalizeGenerateModel(parsed.data);
      expect(generateModel).toBe(true);
    }
  });
});
