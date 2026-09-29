/**
 * CEE Utility Bridge Tests
 *
 * Tests the mapping from CEE behavioural preferences to ISL utility specifications.
 */

import { describe, it, expect } from "vitest";
import {
  deriveUtilityTransform,
  deriveLossWeights,
  mapPreferencesToUtility,
  isPreferenceAdapterAvailable,
  createDefaultUtilitySpec,
  applyLossAversion,
  applyUtilityTransform,
} from "../../src/cee/preference-elicitation/utility-bridge.js";
import type {
  UtilityTransform,
  GraphContext,
} from "../../src/cee/preference-elicitation/utility-bridge.js";
import type { UserPreferencesT } from "../../src/schemas/cee.js";

// ============================================================================
// Test Fixtures
// ============================================================================

function makeTestPreferences(overrides: Partial<UserPreferencesT> = {}): UserPreferencesT {
  return {
    risk_aversion: 0.5,
    loss_aversion: 1.5,
    goal_weights: {},
    time_discount: 0.1,
    confidence: "medium",
    derived_from: {
      questions_answered: 2,
      last_updated: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeTestContext(overrides: Partial<GraphContext> = {}): GraphContext {
  return {
    goal_nodes: ["goal_1"],
    ...overrides,
  };
}

// ============================================================================
// deriveUtilityTransform Tests
// ============================================================================

describe("deriveUtilityTransform", () => {
  describe("risk-seeking (< 0.3)", () => {
    it("returns convex utility for risk_aversion = 0", () => {
      const result = deriveUtilityTransform(0);
      expect(result.type).toBe("convex");
      expect((result as { coefficient: number }).coefficient).toBe(1);
    });

    it("returns convex utility for risk_aversion = 0.1", () => {
      const result = deriveUtilityTransform(0.1);
      expect(result.type).toBe("convex");
      expect((result as { coefficient: number }).coefficient).toBeCloseTo(0.9, 5);
    });

    it("returns convex utility for risk_aversion = 0.29", () => {
      const result = deriveUtilityTransform(0.29);
      expect(result.type).toBe("convex");
      expect((result as { coefficient: number }).coefficient).toBeCloseTo(0.71, 5);
    });
  });

  describe("risk-neutral (0.3 - 0.7)", () => {
    it("returns linear utility for risk_aversion = 0.3", () => {
      const result = deriveUtilityTransform(0.3);
      expect(result.type).toBe("linear");
    });

    it("returns linear utility for risk_aversion = 0.5", () => {
      const result = deriveUtilityTransform(0.5);
      expect(result.type).toBe("linear");
    });

    it("returns linear utility for risk_aversion = 0.7", () => {
      const result = deriveUtilityTransform(0.7);
      expect(result.type).toBe("linear");
    });
  });

  describe("risk-averse (> 0.7)", () => {
    it("returns concave utility for risk_aversion = 0.71", () => {
      const result = deriveUtilityTransform(0.71);
      expect(result.type).toBe("concave");
      expect((result as { coefficient: number }).coefficient).toBeCloseTo(0.71, 5);
    });

    it("returns concave utility for risk_aversion = 0.9", () => {
      const result = deriveUtilityTransform(0.9);
      expect(result.type).toBe("concave");
      expect((result as { coefficient: number }).coefficient).toBe(0.9);
    });

    it("returns concave utility for risk_aversion = 1", () => {
      const result = deriveUtilityTransform(1);
      expect(result.type).toBe("concave");
      expect((result as { coefficient: number }).coefficient).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("clamps negative values to 0", () => {
      const result = deriveUtilityTransform(-0.5);
      expect(result.type).toBe("convex");
      expect((result as { coefficient: number }).coefficient).toBe(1);
    });

    it("clamps values > 1 to 1", () => {
      const result = deriveUtilityTransform(1.5);
      expect(result.type).toBe("concave");
      expect((result as { coefficient: number }).coefficient).toBe(1);
    });
  });
});

// ============================================================================
// deriveLossWeights Tests
// ============================================================================

describe("deriveLossWeights", () => {
  it("returns gain_multiplier of 1.0 always", () => {
    expect(deriveLossWeights(1.0).gain_multiplier).toBe(1.0);
    expect(deriveLossWeights(2.0).gain_multiplier).toBe(1.0);
    expect(deriveLossWeights(3.0).gain_multiplier).toBe(1.0);
  });

  it("returns loss_multiplier equal to loss_aversion", () => {
    expect(deriveLossWeights(1.5).loss_multiplier).toBe(1.5);
    expect(deriveLossWeights(2.0).loss_multiplier).toBe(2.0);
    expect(deriveLossWeights(2.5).loss_multiplier).toBe(2.5);
  });

  it("clamps values below 1.0 to 1.0", () => {
    expect(deriveLossWeights(0.5).loss_multiplier).toBe(1.0);
    expect(deriveLossWeights(0).loss_multiplier).toBe(1.0);
    expect(deriveLossWeights(-1).loss_multiplier).toBe(1.0);
  });

  it("clamps values above 3.0 to 3.0", () => {
    expect(deriveLossWeights(3.5).loss_multiplier).toBe(3.0);
    expect(deriveLossWeights(5.0).loss_multiplier).toBe(3.0);
  });
});

// ============================================================================
// mapPreferencesToUtility Tests
// ============================================================================

describe("mapPreferencesToUtility", () => {
  it("returns valid specification for basic input", () => {
    const preferences = makeTestPreferences();
    const context = makeTestContext();

    const result = mapPreferencesToUtility(preferences, context);

    expect(result.specification.goal_node_id).toBe("goal_1");
    expect(result.specification.maximize).toBe(true);
    expect(result.specification.utility_transform?.type).toBe("linear");
    expect(result.specification.time_discount).toBe(0.1);
    expect(result.specification.preference_confidence).toBe("medium");
    expect(typeof result.description).toBe("string");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("handles multiple goals with weights", () => {
    const preferences = makeTestPreferences({
      goal_weights: { revenue: 0.7, cost: 0.3 },
    });
    const context = makeTestContext({
      goal_nodes: ["revenue", "cost"],
    });

    const result = mapPreferencesToUtility(preferences, context);

    expect(result.specification.goal_node_id).toBe("revenue");
    expect(result.specification.additional_goals).toEqual(["cost"]);
    expect(result.specification.weights?.revenue).toBeCloseTo(0.7, 5);
    expect(result.specification.weights?.cost).toBeCloseTo(0.3, 5);
  });

  it("normalises goal weights", () => {
    const preferences = makeTestPreferences({
      goal_weights: { a: 2, b: 8 },
    });
    const context = makeTestContext({
      goal_nodes: ["a", "b"],
    });

    const result = mapPreferencesToUtility(preferences, context);

    expect(result.specification.weights?.a).toBeCloseTo(0.2, 5);
    expect(result.specification.weights?.b).toBeCloseTo(0.8, 5);
  });

  it("assigns equal weights when none provided", () => {
    const preferences = makeTestPreferences({
      goal_weights: {},
    });
    const context = makeTestContext({
      goal_nodes: ["goal_1", "goal_2", "goal_3"],
    });

    const result = mapPreferencesToUtility(preferences, context);

    expect(result.specification.weights?.goal_1).toBeCloseTo(1 / 3, 5);
    expect(result.specification.weights?.goal_2).toBeCloseTo(1 / 3, 5);
    expect(result.specification.weights?.goal_3).toBeCloseTo(1 / 3, 5);
  });

  it("includes loss_aversion only when > 1.1", () => {
    const lowLossAversion = makeTestPreferences({ loss_aversion: 1.0 });
    const highLossAversion = makeTestPreferences({ loss_aversion: 2.0 });
    const context = makeTestContext();

    const lowResult = mapPreferencesToUtility(lowLossAversion, context);
    const highResult = mapPreferencesToUtility(highLossAversion, context);

    expect(lowResult.specification.loss_aversion).toBeUndefined();
    expect(highResult.specification.loss_aversion).toBe(2.0);
  });

  it("includes reference_point when provided in context", () => {
    const preferences = makeTestPreferences();
    const contextWithRef = makeTestContext({ reference_point: 100 });
    const contextWithoutRef = makeTestContext();

    const resultWithRef = mapPreferencesToUtility(preferences, contextWithRef);
    const resultWithoutRef = mapPreferencesToUtility(preferences, contextWithoutRef);

    expect(resultWithRef.specification.reference_point).toBe(100);
    expect(resultWithoutRef.specification.reference_point).toBeUndefined();
  });

  it("throws error when goal_nodes is empty", () => {
    const preferences = makeTestPreferences();
    const context = makeTestContext({ goal_nodes: [] });

    expect(() => mapPreferencesToUtility(preferences, context)).toThrow(
      "GraphContext must have at least one goal_node"
    );
  });

  describe("warnings", () => {
    it("warns on low confidence", () => {
      const preferences = makeTestPreferences({ confidence: "low" });
      const context = makeTestContext();

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.warnings.some((w) => w.includes("low"))).toBe(true);
    });

    it("warns on time discount without temporal structure", () => {
      const preferences = makeTestPreferences({ time_discount: 0.2 });
      const context = makeTestContext({ has_temporal_structure: false });

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.warnings.some((w) => w.includes("temporal"))).toBe(true);
    });

    it("warns on loss aversion without reference point", () => {
      const preferences = makeTestPreferences({ loss_aversion: 2.5 });
      const context = makeTestContext({ reference_point: undefined });

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.warnings.some((w) => w.includes("reference point"))).toBe(true);
    });

    it("warns on multiple goals without weights", () => {
      const preferences = makeTestPreferences({ goal_weights: {} });
      const context = makeTestContext({ goal_nodes: ["a", "b"] });

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.warnings.some((w) => w.includes("equal weights"))).toBe(true);
    });
  });

  describe("description generation", () => {
    it("describes risk-averse utility", () => {
      const preferences = makeTestPreferences({ risk_aversion: 0.9 });
      const context = makeTestContext();

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.description).toContain("risk-averse");
    });

    it("describes risk-seeking utility", () => {
      const preferences = makeTestPreferences({ risk_aversion: 0.1 });
      const context = makeTestContext();

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.description).toContain("risk-seeking");
    });

    it("describes loss aversion", () => {
      const preferences = makeTestPreferences({ loss_aversion: 2.5 });
      const context = makeTestContext();

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.description).toContain("loss aversion");
    });

    it("describes time preference", () => {
      const preferences = makeTestPreferences({ time_discount: 0.2 });
      const context = makeTestContext();

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.description).toContain("near-term");
    });

    it("describes multiple goals", () => {
      const preferences = makeTestPreferences();
      const context = makeTestContext({ goal_nodes: ["a", "b", "c"] });

      const result = mapPreferencesToUtility(preferences, context);

      expect(result.description).toContain("3 weighted goals");
    });
  });
});

// ============================================================================
// createDefaultUtilitySpec Tests
// ============================================================================

describe("createDefaultUtilitySpec", () => {
  it("creates spec with single goal", () => {
    const context = makeTestContext({ goal_nodes: ["main_goal"] });

    const result = createDefaultUtilitySpec(context);

    expect(result.goal_node_id).toBe("main_goal");
    expect(result.maximize).toBe(true);
    expect(result.additional_goals).toBeUndefined();
    expect(result.weights?.main_goal).toBe(1);
    expect(result.utility_transform).toEqual({ type: "linear" });
    expect(result.time_discount).toBe(0.1);
    expect(result.preference_confidence).toBe("low");
  });

  it("creates spec with multiple goals and equal weights", () => {
    const context = makeTestContext({ goal_nodes: ["a", "b", "c", "d"] });

    const result = createDefaultUtilitySpec(context);

    expect(result.goal_node_id).toBe("a");
    expect(result.additional_goals).toEqual(["b", "c", "d"]);
    expect(result.weights?.a).toBe(0.25);
    expect(result.weights?.b).toBe(0.25);
    expect(result.weights?.c).toBe(0.25);
    expect(result.weights?.d).toBe(0.25);
  });

  it("throws error when goal_nodes is empty", () => {
    const context = makeTestContext({ goal_nodes: [] });

    expect(() => createDefaultUtilitySpec(context)).toThrow(
      "GraphContext must have at least one goal_node"
    );
  });
});

// ============================================================================
// applyLossAversion Tests
// ============================================================================

describe("applyLossAversion", () => {
  it("returns gain unchanged (relative to reference)", () => {
    expect(applyLossAversion(150, 100, 2.0)).toBe(50); // Gain of 50
    expect(applyLossAversion(200, 100, 2.0)).toBe(100); // Gain of 100
  });

  it("returns loss multiplied by loss aversion coefficient", () => {
    expect(applyLossAversion(50, 100, 2.0)).toBe(-100); // Loss of 50 * 2 = -100
    expect(applyLossAversion(80, 100, 2.5)).toBe(-50); // Loss of 20 * 2.5 = -50
  });

  it("returns 0 for value equal to reference", () => {
    expect(applyLossAversion(100, 100, 2.0)).toBe(0);
  });

  it("works with negative reference points", () => {
    expect(applyLossAversion(0, -50, 2.0)).toBe(50); // Gain relative to -50
    expect(applyLossAversion(-100, -50, 2.0)).toBe(-100); // Loss of 50 * 2 = -100
  });

  it("handles neutral loss aversion (1.0)", () => {
    expect(applyLossAversion(80, 100, 1.0)).toBe(-20); // Loss = -20
    expect(applyLossAversion(120, 100, 1.0)).toBe(20); // Gain = 20
  });
});

// ============================================================================
// applyUtilityTransform Tests
// ============================================================================

describe("applyUtilityTransform", () => {
  describe("linear transform", () => {
    const linear: UtilityTransform = { type: "linear" };

    it("returns value unchanged", () => {
      expect(applyUtilityTransform(0, linear)).toBe(0);
      expect(applyUtilityTransform(0.5, linear)).toBe(0.5);
      expect(applyUtilityTransform(1, linear)).toBe(1);
    });

    it("clamps values outside [0,1]", () => {
      expect(applyUtilityTransform(-0.5, linear)).toBe(0);
      expect(applyUtilityTransform(1.5, linear)).toBe(1);
    });
  });

  describe("concave transform (risk-averse)", () => {
    const concave: UtilityTransform = { type: "concave", coefficient: 0.8 };

    it("returns higher utility for same value (diminishing returns)", () => {
      const linear: UtilityTransform = { type: "linear" };
      const linearResult = applyUtilityTransform(0.5, linear);
      const concaveResult = applyUtilityTransform(0.5, concave);

      // Concave should give higher utility for mid-range values
      expect(concaveResult).toBeGreaterThan(linearResult);
    });

    it("preserves boundaries", () => {
      expect(applyUtilityTransform(0, concave)).toBe(0);
      expect(applyUtilityTransform(1, concave)).toBe(1);
    });
  });

  describe("convex transform (risk-seeking)", () => {
    const convex: UtilityTransform = { type: "convex", coefficient: 0.8 };

    it("returns lower utility for same value (increasing returns)", () => {
      const linear: UtilityTransform = { type: "linear" };
      const linearResult = applyUtilityTransform(0.5, linear);
      const convexResult = applyUtilityTransform(0.5, convex);

      // Convex should give lower utility for mid-range values
      expect(convexResult).toBeLessThan(linearResult);
    });

    it("preserves boundaries", () => {
      expect(applyUtilityTransform(0, convex)).toBe(0);
      expect(applyUtilityTransform(1, convex)).toBe(1);
    });
  });
});

// ============================================================================
// isPreferenceAdapterAvailable Tests
// ============================================================================

describe("isPreferenceAdapterAvailable", () => {
  it("returns true", () => {
    expect(isPreferenceAdapterAvailable()).toBe(true);
  });
});
