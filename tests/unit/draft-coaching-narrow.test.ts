/**
 * Unit tests for narrowCoachingForResponse — the unified-pipeline equivalent
 * of buildDraftCoaching that consumes raw ctx.coaching (typed unknown) from
 * Stage 1 and produces a typed DraftCoaching display payload.
 */
import { describe, it, expect } from "vitest";
import { narrowCoachingForResponse } from "../../src/orchestrator/draft-coaching.js";

describe("narrowCoachingForResponse", () => {
  it("returns null when coaching is not a record", () => {
    expect(narrowCoachingForResponse(null)).toBeNull();
    expect(narrowCoachingForResponse(undefined)).toBeNull();
    expect(narrowCoachingForResponse("string")).toBeNull();
    expect(narrowCoachingForResponse([])).toBeNull();
    expect(narrowCoachingForResponse(42)).toBeNull();
  });

  it("preserves a well-formed coaching block", () => {
    const out = narrowCoachingForResponse({
      summary: "Looks solid overall.",
      strengthen_items: [
        { id: "s1", label: "Add a baseline option", detail: "You're missing status quo.", action_type: "add_node" },
        { id: "s2", label: "Tighten the goal", detail: "Threshold is fuzzy.", action_type: "edit_node", bias_category: "ambiguity" },
      ],
      widening_log: [
        { node_id: "fac_churn", label: "Churn", reason: "Considered alternatives" },
      ],
      bias_signals: [
        { type: "anchoring", detail: "Pinned to last quarter's number", target: "fac_revenue" },
      ],
    });

    expect(out).not.toBeNull();
    expect(out!.summary).toBe("Looks solid overall.");
    expect(out!.strengthen_items).toHaveLength(2);
    expect(out!.strengthen_items[0]).toEqual({
      id: "s1",
      label: "Add a baseline option",
      detail: "You're missing status quo.",
      action_type: "add_node",
    });
    expect(out!.strengthen_items[1].bias_category).toBe("ambiguity");
    expect(out!.widening_log).toEqual([
      { node_id: "fac_churn", label: "Churn", reason: "Considered alternatives" },
    ]);
    expect(out!.bias_signals).toEqual([
      { type: "anchoring", detail: "Pinned to last quarter's number", target: "fac_revenue" },
    ]);
  });

  it("returns null summary when coaching summary is missing or non-string", () => {
    expect(narrowCoachingForResponse({}).summary).toBeNull();
    expect(narrowCoachingForResponse({ summary: 42 }).summary).toBeNull();
  });

  it("drops malformed widening_log entries entry-by-entry", () => {
    const out = narrowCoachingForResponse({
      summary: "x",
      widening_log: [
        { node_id: "n1", label: "L1", reason: "r1" }, // valid
        { node_id: "n2", label: "L2" },                // missing reason → drop
        { label: "L3", reason: "r3" },                 // missing node_id → drop
        "garbage",                                      // not a record → drop
      ],
    });

    expect(out!.widening_log).toEqual([
      { node_id: "n1", label: "L1", reason: "r1" },
    ]);
  });

  it("drops malformed bias_signals entries entry-by-entry", () => {
    const out = narrowCoachingForResponse({
      summary: "x",
      bias_signals: [
        { type: "sunk_cost", detail: "d1" },             // valid, no target
        { type: "anchoring", detail: "d2", target: "t" }, // valid with target
        { type: "incomplete" },                            // missing detail → drop
        { detail: "d4" },                                  // missing type → drop
        null,                                              // not a record → drop
      ],
    });

    expect(out!.bias_signals).toEqual([
      { type: "sunk_cost", detail: "d1" },
      { type: "anchoring", detail: "d2", target: "t" },
    ]);
  });

  it("drops malformed strengthen_items entries entry-by-entry", () => {
    const out = narrowCoachingForResponse({
      summary: "x",
      strengthen_items: [
        { id: "s1", label: "L1", detail: "D1", action_type: "add_node" }, // valid
        { id: "s2", label: "L2", detail: "D2" },                          // missing action_type → drop
        { id: "s3", label: 42, detail: "D3", action_type: "x" },           // bad label type → drop
      ],
    });

    expect(out!.strengthen_items).toHaveLength(1);
    expect(out!.strengthen_items[0].id).toBe("s1");
  });

  it("returns null arrays when source arrays are absent", () => {
    const out = narrowCoachingForResponse({ summary: "x" });
    expect(out!.widening_log).toBeNull();
    expect(out!.bias_signals).toBeNull();
    expect(out!.strengthen_items).toEqual([]);
  });

  it("returns null arrays when source arrays are not arrays", () => {
    const out = narrowCoachingForResponse({
      summary: "x",
      widening_log: "not an array",
      bias_signals: { not: "an array" },
      strengthen_items: 42,
    });
    expect(out!.widening_log).toBeNull();
    expect(out!.bias_signals).toBeNull();
    expect(out!.strengthen_items).toEqual([]);
  });
});
