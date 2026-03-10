import { describe, it, expect } from "vitest";
import { getStageAwareFallback, getStageAwareFallbackEntry } from "../../../../src/orchestrator/validation/stage-fallbacks.js";

describe("stage-fallbacks", () => {
  // ── getStageAwareFallback (string-only) ──────────────────────────────────

  it("returns stage+tool specific fallback for frame:run_analysis", () => {
    const msg = getStageAwareFallback("frame", "run_analysis");
    expect(msg).toContain("model");
  });

  it("returns stage+tool specific fallback for frame:edit_graph", () => {
    const msg = getStageAwareFallback("frame", "edit_graph");
    expect(msg).toContain("model");
  });

  it("frame:run_analysis differs from frame:edit_graph", () => {
    const a = getStageAwareFallback("frame", "run_analysis");
    const b = getStageAwareFallback("frame", "edit_graph");
    expect(a).not.toBe(b);
  });

  it("falls back to stage wildcard when tool not in table", () => {
    const msg = getStageAwareFallback("frame", "unknown_tool");
    const wildcard = getStageAwareFallback("frame");
    expect(msg).toBe(wildcard);
  });

  it("returns generic fallback for unknown stage", () => {
    const msg = getStageAwareFallback("nonexistent_stage");
    expect(msg).toContain("rephrase");
  });

  it("returns different messages for different stages", () => {
    const frame = getStageAwareFallback("frame");
    const ideate = getStageAwareFallback("ideate");
    const decide = getStageAwareFallback("decide");
    expect(frame).not.toBe(ideate);
    expect(ideate).not.toBe(decide);
  });

  // ── getStageAwareFallbackEntry (message + chip) ──────────────────────────

  it("returns entry with message and chip for frame:run_analysis", () => {
    const entry = getStageAwareFallbackEntry("frame", "run_analysis");
    expect(entry.message).toBeTruthy();
    expect(entry.chip).toBeDefined();
    expect(entry.chip.label).toBeTruthy();
    expect(entry.chip.prompt).toBeTruthy();
    expect(entry.chip.role).toBe("facilitator");
  });

  it("entry.message matches getStageAwareFallback", () => {
    const entry = getStageAwareFallbackEntry("ideate", "run_analysis");
    const msg = getStageAwareFallback("ideate", "run_analysis");
    expect(entry.message).toBe(msg);
  });

  it("generic fallback entry has a chip", () => {
    const entry = getStageAwareFallbackEntry("nonexistent_stage");
    expect(entry.chip).toBeDefined();
    expect(entry.chip.label).toBeTruthy();
  });
});
