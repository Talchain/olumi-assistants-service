/**
 * Unit tests for setFactorValueAction.chipPrompt / chipLabel
 * (Tier A #1 edit-reliability, 2026-07-09 — FIX 4, 1.45-F5).
 *
 * WHY THIS EXISTS
 * ---------------
 * Live-observed garbled clarify chip: "Set X to Set X to 0.6." — the chip
 * message nests the "Set … to …" instruction inside itself. `chipPrompt`'s
 * own template is `Set ${rec.target_id} to ${val}`; `input_schema` documents
 * `value` as a bare `number`, but a clarify-flow caller upstream of this
 * template can pass an already fully-formed instruction string as
 * `rec.parameters.value` (e.g. it reused this same template's own prior
 * output, or a pre-rendered display prompt). Re-wrapping that string in
 * another `Set … to …` layer produces the double-wrapped nonsense the user
 * sees. The fix must NOT touch chip-suppression / TTL carry-forward (F11) —
 * scope is strictly the chip-prompt template's string construction.
 *
 * RED (pre-fix): passing a `value` that already reads as a full instruction
 * produced "Set X to Set X to 0.6." — the instruction text appeared twice.
 * GREEN (post-fix): the instruction appears exactly once in the chip
 * message, for both the ordinary bare-number case and the adversarial
 * already-wrapped-string case.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { setFactorValueAction } from "../../../../../src/orchestrator/deterministic/actions/set-factor-value.js";
import type { ActionRecommendation } from "../../../../../src/orchestrator/deterministic/actions/types.js";

/** Count non-overlapping occurrences of a substring (case-insensitive). */
function countOccurrences(haystack: string, needle: string): number {
  const lower = haystack.toLowerCase();
  const needleLower = needle.toLowerCase();
  let count = 0;
  let idx = 0;
  while ((idx = lower.indexOf(needleLower, idx)) !== -1) {
    count += 1;
    idx += needleLower.length;
  }
  return count;
}

describe("setFactorValueAction.chipPrompt — double-wrap guard (FIX 4, 1.45-F5)", () => {
  it("ORDINARY case: a bare numeric value produces a single, un-nested instruction", () => {
    const rec: ActionRecommendation = {
      action_type: 'set_factor_value',
      target_id: 'X',
      parameters: { value: 0.6 },
    };
    const prompt = setFactorValueAction.chipPrompt(rec);
    expect(prompt).toBe('Set X to 0.6');
    expect(countOccurrences(prompt, 'set x to')).toBe(1);
  });

  it("ADVERSARIAL case: value is already a fully-formed instruction string — must NOT double-wrap", () => {
    // Simulates the live bug: whatever built this rec passed the
    // already-rendered clarify-chip text as `parameters.value` instead of
    // a bare number.
    const rec: ActionRecommendation = {
      action_type: 'set_factor_value',
      target_id: 'X',
      parameters: { value: 'Set X to 0.6' },
    };
    const prompt = setFactorValueAction.chipPrompt(rec);

    // Pre-fix this produced "Set X to Set X to 0.6." — the instruction
    // nested inside itself. Post-fix it must appear exactly once.
    expect(countOccurrences(prompt, 'set x to 0.6')).toBe(1);
    expect(prompt).toBe('Set X to 0.6');
    expect(prompt).not.toMatch(/set x to set x to/i);
  });

  it("falls back to the generic prompt when target_id is absent", () => {
    const rec: ActionRecommendation = { action_type: 'set_factor_value' };
    expect(setFactorValueAction.chipPrompt(rec)).toBe('Set a factor value');
  });

  it("uses the placeholder when value is absent (not the adversarial branch)", () => {
    const rec: ActionRecommendation = {
      action_type: 'set_factor_value',
      target_id: 'X',
    };
    expect(setFactorValueAction.chipPrompt(rec)).toBe('Set X to ...');
  });
});
