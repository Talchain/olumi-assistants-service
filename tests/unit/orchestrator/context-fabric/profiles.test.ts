import { describe, it, expect } from "vitest";
import {
  getProfile,
  computeBudget,
  getZone2Tokens,
  _deepFreeze,
} from "../../../../src/orchestrator/context-fabric/profiles.js";
import type { ContextFabricRoute } from "../../../../src/orchestrator/context-fabric/types.js";

// ============================================================================
// Route names for iteration
// ============================================================================

const ALL_ROUTES: ContextFabricRoute[] = [
  "CHAT",
  "DRAFT_GRAPH",
  "EDIT_GRAPH",
  "EXPLAIN_RESULTS",
  "GENERATE_BRIEF",
];

// ============================================================================
// getProfile
// ============================================================================

describe("getProfile", () => {
  it("returns a valid profile for every route", () => {
    for (const route of ALL_ROUTES) {
      const profile = getProfile(route);
      expect(profile.route).toBe(route);
      expect(profile.max_turns).toBeGreaterThan(0);
      expect(profile.token_budget).toBeGreaterThan(0);
    }
  });

  it("throws at runtime for invalid route value", () => {
    // Simulate a runtime bypass of TypeScript type checking
    expect(() => getProfile("RUN_ANALYSIS" as ContextFabricRoute)).toThrow(/Unknown context-fabric route/);
    expect(() => getProfile("INVALID" as ContextFabricRoute)).toThrow(/Unknown context-fabric route/);
  });

  it("CHAT has expected values", () => {
    const p = getProfile("CHAT");
    expect(p.max_turns).toBe(3);
    expect(p.include_graph_summary).toBe(true);
    expect(p.include_full_graph).toBe(false);
    expect(p.include_analysis_summary).toBe(true);
    expect(p.include_archetypes).toBe(false);
    expect(p.include_selected_elements).toBe(false);
    expect(p.token_budget).toBe(8000);
  });

  it("DRAFT_GRAPH includes archetypes only", () => {
    const p = getProfile("DRAFT_GRAPH");
    expect(p.include_archetypes).toBe(true);
    expect(p.include_graph_summary).toBe(false);
    expect(p.include_analysis_summary).toBe(false);
    expect(p.include_selected_elements).toBe(false);
    expect(p.max_turns).toBe(2);
    expect(p.token_budget).toBe(12000);
  });

  it("EDIT_GRAPH includes selected elements", () => {
    const p = getProfile("EDIT_GRAPH");
    expect(p.include_selected_elements).toBe(true);
    expect(p.include_archetypes).toBe(false);
    expect(p.token_budget).toBe(10000);
  });

  it("EXPLAIN_RESULTS has correct flags", () => {
    const p = getProfile("EXPLAIN_RESULTS");
    expect(p.include_graph_summary).toBe(true);
    expect(p.include_analysis_summary).toBe(true);
    expect(p.include_archetypes).toBe(false);
    expect(p.include_selected_elements).toBe(false);
  });

  it("GENERATE_BRIEF has correct flags", () => {
    const p = getProfile("GENERATE_BRIEF");
    expect(p.include_graph_summary).toBe(true);
    expect(p.include_analysis_summary).toBe(true);
    expect(p.max_turns).toBe(2);
  });
});

// ============================================================================
// computeBudget
// ============================================================================

describe("computeBudget", () => {
  it("effective_total = floor(token_budget * 0.9) for every profile", () => {
    for (const route of ALL_ROUTES) {
      const profile = getProfile(route);
      const budget = computeBudget(profile, 500);
      expect(budget.effective_total).toBe(Math.floor(profile.token_budget * 0.9));
    }
  });

  it("zone allocations sum to effective_total", () => {
    for (const route of ALL_ROUTES) {
      const profile = getProfile(route);
      const zone1Tokens = 500;
      const budget = computeBudget(profile, zone1Tokens);
      expect(budget.zone1 + budget.zone2 + budget.zone3).toBe(budget.effective_total);
    }
  });

  it("zone3 is positive for every profile with reasonable zone1", () => {
    for (const route of ALL_ROUTES) {
      const profile = getProfile(route);
      const budget = computeBudget(profile, 500);
      expect(budget.zone3).toBeGreaterThan(0);
    }
  });

  it("safety_margin = token_budget - effective_total", () => {
    const profile = getProfile("CHAT");
    const budget = computeBudget(profile, 500);
    expect(budget.safety_margin).toBe(profile.token_budget - budget.effective_total);
  });

  it("zone1 equals the provided zone1Tokens", () => {
    const budget = computeBudget(getProfile("CHAT"), 1234);
    expect(budget.zone1).toBe(1234);
  });

  it("zone2 matches the explicit zone2 token map", () => {
    expect(computeBudget(getProfile("CHAT"), 500).zone2).toBe(500);
    expect(computeBudget(getProfile("DRAFT_GRAPH"), 500).zone2).toBe(2000);
    expect(computeBudget(getProfile("EDIT_GRAPH"), 500).zone2).toBe(1000);
    expect(computeBudget(getProfile("EXPLAIN_RESULTS"), 500).zone2).toBe(1500);
    expect(computeBudget(getProfile("GENERATE_BRIEF"), 500).zone2).toBe(1000);
  });

  it("throws when zone3 would be negative", () => {
    const profile = getProfile("CHAT"); // budget 8000, effective 7200, zone2 500
    // zone1 = 7000 → zone3 = 7200 - 7000 - 500 = -300
    expect(() => computeBudget(profile, 7000)).toThrow(/zone3 is negative/);
  });

  it("zone3 = 0 does not throw", () => {
    const profile = getProfile("CHAT"); // effective 7200, zone2 500
    // zone1 = 6700 → zone3 = 7200 - 6700 - 500 = 0
    const budget = computeBudget(profile, 6700);
    expect(budget.zone3).toBe(0);
  });
});

// ============================================================================
// getZone2Tokens
// ============================================================================

describe("getZone2Tokens", () => {
  it("returns correct zone2 allocation per route", () => {
    expect(getZone2Tokens("CHAT")).toBe(500);
    expect(getZone2Tokens("DRAFT_GRAPH")).toBe(2000);
    expect(getZone2Tokens("EDIT_GRAPH")).toBe(1000);
    expect(getZone2Tokens("EXPLAIN_RESULTS")).toBe(1500);
    expect(getZone2Tokens("GENERATE_BRIEF")).toBe(1000);
  });
});

// ============================================================================
// Deep Freeze
// ============================================================================

describe("deepFreeze", () => {
  it("profiles object is frozen — top-level mutation fails", () => {
    const profile = getProfile("CHAT");
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("nested mutation has no effect on frozen profile", () => {
    const profile = getProfile("CHAT");
    // In strict mode this would throw. In non-strict, assignment is silently ignored.
    // We verify the value hasn't changed.
    try {
      (profile as Record<string, unknown>).max_turns = 999;
    } catch {
      // Expected in strict mode
    }
    expect(profile.max_turns).toBe(3);
  });

  it("freezes nested objects recursively", () => {
    const obj = { a: { b: { c: 1 } }, d: [1, 2, { e: 3 }] };
    _deepFreeze(obj);
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.a)).toBe(true);
    expect(Object.isFrozen(obj.a.b)).toBe(true);
    expect(Object.isFrozen(obj.d)).toBe(true);
    expect(Object.isFrozen(obj.d[2])).toBe(true);
  });

  it("handles null and undefined gracefully", () => {
    expect(_deepFreeze(null)).toBeNull();
    expect(_deepFreeze(undefined)).toBeUndefined();
  });

  it("handles primitives", () => {
    expect(_deepFreeze(42)).toBe(42);
    expect(_deepFreeze("hello")).toBe("hello");
  });
});
