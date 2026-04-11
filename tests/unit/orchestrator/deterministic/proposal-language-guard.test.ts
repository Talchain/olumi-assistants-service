/**
 * Tests for the proposal-language guard (T5).
 *
 * Covers the scanner directly. The wire-in tests against edit_graph and the
 * deterministic response-assembler live alongside their respective handler tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { enforceProposalLanguage } from "../../../../src/orchestrator/deterministic/proposal-language-guard.js";
import { log } from "../../../../src/utils/telemetry.js";

const warnSpy = vi.mocked(log.warn);

beforeEach(() => {
  warnSpy.mockClear();
});

describe("enforceProposalLanguage — leak detection", () => {
  it("flags 'Adding now'", () => {
    const r = enforceProposalLanguage("Adding now. Please confirm.", "edit_graph");
    expect(r.leaked).toBe(true);
    expect(r.matchedPhrase?.toLowerCase()).toBe('adding now');
    expect(r.suffixed).toContain('Review the suggested changes above.');
  });

  it("flags 'I've added'", () => {
    const r = enforceProposalLanguage("I've added the contractor option. Please confirm.", "edit_graph");
    expect(r.leaked).toBe(true);
    expect(r.suffixed).toContain('Review the suggested changes above.');
  });

  it("flags 'Done'", () => {
    const r = enforceProposalLanguage("Updated. Done.", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("flags 'Applied'", () => {
    const r = enforceProposalLanguage("Applied your requested change.", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("flags 'Updating now'", () => {
    const r = enforceProposalLanguage("Updating now…", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("flags 'Making that change'", () => {
    const r = enforceProposalLanguage("Making that change for you.", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("matches case-insensitively", () => {
    const r = enforceProposalLanguage("ADDING NOW. Please confirm.", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("emits the v4.proposal_language_leak telemetry event with the matched phrase and tool", () => {
    enforceProposalLanguage("I've added that.", "edit_graph");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0];
    expect((call[0] as { event: string }).event).toBe('v4.proposal_language_leak');
    expect((call[0] as { tool_name: string }).tool_name).toBe('edit_graph');
    expect((call[0] as { matched_phrase: string }).matched_phrase.toLowerCase()).toContain("i've added");
  });

  it("detects a leak when one sentence is compliant and another is not", () => {
    const text =
      "Here's what I'd suggest: add a contractor option that affects development capacity. Adding now.";
    const r = enforceProposalLanguage(text, "edit_graph");
    expect(r.leaked).toBe(true);
    expect(r.suffixed).toContain('Review the suggested changes above.');
  });
});

describe("enforceProposalLanguage — false-positive guards", () => {
  it("does NOT flag 'Adding a factor would'", () => {
    const r = enforceProposalLanguage("Adding a factor would improve the model.", "edit_graph");
    expect(r.leaked).toBe(false);
    expect(r.suffixed).toBeUndefined();
  });

  it("does NOT flag 'I'd suggest adding'", () => {
    const r = enforceProposalLanguage(
      "I'd suggest adding a contractor option to handle the ramp-up.",
      "edit_graph",
    );
    expect(r.leaked).toBe(false);
  });

  it("does NOT flag 'worth adding'", () => {
    const r = enforceProposalLanguage(
      "It might be worth adding a quality factor here.",
      "edit_graph",
    );
    expect(r.leaked).toBe(false);
  });

  it("does NOT flag 'proposing to update'", () => {
    const r = enforceProposalLanguage(
      "Proposing to update Development capacity. Please confirm.",
      "edit_graph",
    );
    expect(r.leaked).toBe(false);
  });

  it("returns leaked: false on null or empty input — no scan, no log", () => {
    expect(enforceProposalLanguage(null, "edit_graph").leaked).toBe(false);
    expect(enforceProposalLanguage(undefined, "edit_graph").leaked).toBe(false);
    expect(enforceProposalLanguage("", "edit_graph").leaked).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("enforceProposalLanguage — deterministic-handler leak styles (2026-04-09)", () => {
  // These patterns target deterministic action handler assistantText that
  // leaks through the v4 pipeline guard call on proposal turns. The issue
  // brief: handler returns "Got it, setting the AI Tool Cost to £2,000" on
  // an auto_apply=false turn. The prior regex set did not cover this.

  it("flags 'Got it, setting the AI Tool Cost to £2,000' (brief example)", () => {
    const r = enforceProposalLanguage(
      "Got it, setting the AI Tool Cost to £2,000.",
      "set_factor_value",
    );
    expect(r.leaked).toBe(true);
    expect(r.suffixed).toContain('Review the suggested changes above.');
  });

  it("flags 'Got it' on its own (standalone handler confirmation)", () => {
    const r = enforceProposalLanguage("Got it. Looking at your options now.", "add_option");
    expect(r.leaked).toBe(true);
  });

  it("flags 'Setting X to Y' at start of text", () => {
    const r = enforceProposalLanguage("Setting Market Size to 500.", "set_factor_value");
    expect(r.leaked).toBe(true);
  });

  it("flags 'I've set Market Size to 500'", () => {
    const r = enforceProposalLanguage("I've set Market Size to 500.", "set_factor_value");
    expect(r.leaked).toBe(true);
  });

  it("flags 'Updated Market Size to 500' at start", () => {
    const r = enforceProposalLanguage("Updated Market Size to 500.", "set_factor_value");
    expect(r.leaked).toBe(true);
  });

  it("flags 'Changed the cost to £2,000' at start", () => {
    const r = enforceProposalLanguage("Changed the cost to £2,000.", "set_factor_value");
    expect(r.leaked).toBe(true);
  });

  it("flags leak appearing after a proposal sentence (second-sentence leak)", () => {
    const r = enforceProposalLanguage(
      "Here's what I'd suggest for your model. Setting the cost to £2,000.",
      "set_factor_value",
    );
    expect(r.leaked).toBe(true);
  });
});

describe("enforceProposalLanguage — deterministic-handler false-positive guards", () => {
  it("does NOT flag 'I'd recommend setting the cost to 2000' (proposal framing)", () => {
    const r = enforceProposalLanguage(
      "I'd recommend setting the cost to 2000 to match benchmark.",
      "set_factor_value",
    );
    expect(r.leaked).toBe(false);
  });

  it("does NOT flag 'proposing to set the cost to 2000' (proposal framing)", () => {
    const r = enforceProposalLanguage(
      "Proposing to set the cost to 2000 in your model.",
      "set_factor_value",
    );
    expect(r.leaked).toBe(false);
  });

  it("does NOT flag 'The current value is set to 500' (stative)", () => {
    const r = enforceProposalLanguage(
      "The current value is set to 500 based on the brief.",
      "set_factor_value",
    );
    expect(r.leaked).toBe(false);
  });

  it("does NOT flag 'consider updating the threshold to 0.3' (recommendation)", () => {
    const r = enforceProposalLanguage(
      "You could consider updating the threshold to 0.3 here.",
      "set_factor_value",
    );
    expect(r.leaked).toBe(false);
  });
});

describe("enforceProposalLanguage — I'll <verb> leak patterns", () => {
  it("flags \"I'll add Team Dynamics Risk as an observable factor. Please confirm.\"", () => {
    const r = enforceProposalLanguage(
      "I'll add Team Dynamics Risk as an observable factor. Please confirm.",
      "add_factor",
    );
    expect(r.leaked).toBe(true);
    expect(r.matchedPhrase?.toLowerCase()).toContain("i'll add");
  });

  it("flags \"I'll update the edge strength.\"", () => {
    const r = enforceProposalLanguage("I'll update the edge strength.", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("flags \"I'll remove that option.\" with smart quote", () => {
    const r = enforceProposalLanguage("I\u2019ll remove that option.", "remove_option");
    expect(r.leaked).toBe(true);
  });

  it("flags \"I'll change the category.\"", () => {
    const r = enforceProposalLanguage("I'll change the category.", "edit_graph");
    expect(r.leaked).toBe(true);
  });

  it("does NOT flag 'If I add a factor' (no contraction)", () => {
    const r = enforceProposalLanguage(
      "If I add a factor, it would improve coverage.",
      "add_factor",
    );
    expect(r.leaked).toBe(false);
  });
});

describe("enforceProposalLanguage — suffix preserves original text", () => {
  it("appends the suffix exactly once with the expected separator", () => {
    const original = "I've added the option.";
    const r = enforceProposalLanguage(original, "add_option");
    expect(r.suffixed).toBe(`${original}\n\nReview the suggested changes above.`);
  });
});
