import { describe, it, expect } from "vitest";
import {
  applyUniversalHonestyGate,
  stripActionClaims,
  matchesActionLanguage,
  HONESTY_FALLBACK_TEXT,
} from "../../../../src/orchestrator/deterministic/universal-honesty-gate.js";

describe("matchesActionLanguage", () => {
  it.each([
    "Connecting it now.",
    "Connected the node to the goal.",
    "Adding that option now.",
    "Updating the factor to 95.",
    "Set to the maximum.",
    "Rewiring those edges now.",
  ])("matches %p", (s) => {
    expect(matchesActionLanguage(s)).toBe(true);
  });

  it.each([
    "Would you like me to connect it?",
    "The factor is above the allowed range.",
    "Consider the trade-off between speed and cost.",
  ])("does not match %p", (s) => {
    expect(matchesActionLanguage(s)).toBe(false);
  });
});

describe("stripActionClaims", () => {
  it("removes action sentences and preserves survivors verbatim", () => {
    const input = "I couldn't find that node. Connecting it now.";
    const { stripped, strippedCount, allStripped } = stripActionClaims(input);
    expect(stripped).toBe("I couldn't find that node.");
    expect(strippedCount).toBe(1);
    expect(allStripped).toBe(false);
  });

  it("reports allStripped when every sentence matches", () => {
    const input = "Connecting it now. Also updating the label to new.";
    const { stripped, strippedCount, allStripped } = stripActionClaims(input);
    expect(stripped).toBe("");
    expect(strippedCount).toBe(2);
    expect(allStripped).toBe(true);
  });

  it("returns the original when nothing matches", () => {
    const input = "That value is above the allowed range.";
    const { stripped, strippedCount, allStripped } = stripActionClaims(input);
    expect(stripped).toBe(input);
    expect(strippedCount).toBe(0);
    expect(allStripped).toBe(false);
  });
});

describe("applyUniversalHonestyGate", () => {
  it("fires and substitutes fallback when tool executed, no mutation, no recovery, all sentences match", () => {
    const r = applyUniversalHonestyGate({
      executedAction: "add_option",
      assistantText: "Connecting it now.",
      mutationEffect: false,
      recoveryEffect: false,
    });
    expect(r.changed).toBe(true);
    expect(r.assistantText).toBe(HONESTY_FALLBACK_TEXT);
    expect(r.usedFallback).toBe(true);
    expect(r.strippedCount).toBe(1);
  });

  it("strips mutation claims but leaves empty text (not fallback) when recovery chips exist", () => {
    const r = applyUniversalHonestyGate({
      executedAction: "set_factor_value",
      assistantText: "Updating Annual Hiring Cost to £95,000.",
      mutationEffect: false,
      recoveryEffect: true,
    });
    expect(r.changed).toBe(true);
    expect(r.assistantText).toBe("");
    expect(r.usedFallback).toBe(false);
    expect(r.strippedCount).toBe(1);
  });

  it("does not fire when mutation effect exists (graph_patch or ops)", () => {
    const r = applyUniversalHonestyGate({
      executedAction: "edit_graph",
      assistantText: "Connected X to Y.",
      mutationEffect: true,
      recoveryEffect: false,
    });
    expect(r.changed).toBe(false);
    expect(r.assistantText).toBe("Connected X to Y.");
  });

  it("does not fire when no tool executed (executedAction === null)", () => {
    const r = applyUniversalHonestyGate({
      executedAction: null,
      assistantText: "I'll add that.",
      mutationEffect: false,
      recoveryEffect: false,
    });
    expect(r.changed).toBe(false);
  });

  it("partial strip: preserves non-matching sentences verbatim", () => {
    const r = applyUniversalHonestyGate({
      executedAction: "add_option",
      assistantText: "I couldn't find that node. Connecting it now.",
      mutationEffect: false,
      recoveryEffect: false,
    });
    expect(r.changed).toBe(true);
    expect(r.assistantText).toBe("I couldn't find that node.");
    expect(r.usedFallback).toBe(false);
    expect(r.strippedCount).toBe(1);
  });

  it("does not fire for recovery-only chip-carrying responses that do not claim completion", () => {
    const r = applyUniversalHonestyGate({
      executedAction: "set_factor_value",
      assistantText: "That's above the allowed range. Would you like to increase it?",
      mutationEffect: false,
      recoveryEffect: true,
    });
    expect(r.changed).toBe(false);
    expect(r.assistantText).toBe("That's above the allowed range. Would you like to increase it?");
  });
});
