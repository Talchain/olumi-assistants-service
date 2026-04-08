/**
 * Tests for the v4 prompt dead-weight audit module.
 *
 * Pins:
 * - The audit detects every documented dead-instruction sentinel in the
 *   currently-active cf-v28 PMS prompt
 * - The audit is non-mutating and pure
 * - Hash output is stable across calls with the same input
 */

import { describe, it, expect } from "vitest";
import {
  auditPromptForV4,
  PROMPT_AUDIT_SENTINELS,
  RUNTIME_TOOL_USE_SUFFIX,
} from "../../../../src/orchestrator/deterministic/prompt-audit.js";
import { ORCHESTRATOR_PROMPT_CF_V28 } from "../../../../src/prompts/orchestrator-cf-v28.js";

const CLEAN_PROMPT = `You are a decision coach.

Use the available tools when the user asks for structural changes.
Respond in plain text otherwise.

Always be specific and grounded in the model state.
`;

describe("auditPromptForV4 — sentinel detection", () => {
  it("finds the documented dead sentinels in the active cf-v28 prompt body", () => {
    const audit = auditPromptForV4(ORCHESTRATOR_PROMPT_CF_V28);

    expect(audit.totalChars).toBe(ORCHESTRATOR_PROMPT_CF_V28.length);
    expect(audit.deadSectionCount).toBeGreaterThanOrEqual(4);

    // The four core dead artifacts must be detected — these are what the
    // v31 TODO at prompt-builder-v2.ts:11-17 calls out.
    const foundSentinels = new Set(audit.sentinelsFound.map((h) => h.sentinel));
    expect(foundSentinels.has('<OUTPUT_CONTRACT>')).toBe(true);
    expect(foundSentinels.has('</OUTPUT_CONTRACT>')).toBe(true);
    expect(foundSentinels.has('<diagnostics>')).toBe(true);
    expect(foundSentinels.has('<assistant_text>')).toBe(true);
  });

  it("estimates dead chars in the multi-thousand range for cf-v28", () => {
    const audit = auditPromptForV4(ORCHESTRATOR_PROMPT_CF_V28);

    // The OUTPUT_CONTRACT span alone is ~3-4K chars per the audit; we are
    // generous on the floor here so the test isn't fragile to whitespace
    // tweaks but still catches a regression that strips the sentinel.
    expect(audit.estimatedDeadChars).toBeGreaterThan(1000);
  });

  it("captures approximate line numbers and contextual snippets for each hit", () => {
    const audit = auditPromptForV4(ORCHESTRATOR_PROMPT_CF_V28);

    for (const hit of audit.sentinelsFound) {
      expect(hit.approximateLine).toBeGreaterThan(0);
      expect(hit.context).toContain(hit.sentinel);
    }
  });

  it("returns empty findings on a clean v4-style prompt", () => {
    const audit = auditPromptForV4(CLEAN_PROMPT);

    expect(audit.deadSectionCount).toBe(0);
    expect(audit.sentinelsFound).toHaveLength(0);
    expect(audit.estimatedDeadChars).toBe(0);
    // All sentinels report as not-found.
    expect(new Set(audit.sentinelsNotFound)).toEqual(new Set(PROMPT_AUDIT_SENTINELS));
  });

  it("does not mutate the input prompt", () => {
    const before = ORCHESTRATOR_PROMPT_CF_V28;
    auditPromptForV4(ORCHESTRATOR_PROMPT_CF_V28);
    expect(ORCHESTRATOR_PROMPT_CF_V28).toBe(before);
  });
});

describe("auditPromptForV4 — hashing", () => {
  it("returns a 64-char hex SHA-256 hash", () => {
    const audit = auditPromptForV4("hello");
    expect(audit.promptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the same hash for the same input", () => {
    const a = auditPromptForV4(ORCHESTRATOR_PROMPT_CF_V28);
    const b = auditPromptForV4(ORCHESTRATOR_PROMPT_CF_V28);
    expect(a.promptHash).toBe(b.promptHash);
  });

  it("returns different hashes for different inputs", () => {
    const a = auditPromptForV4("alpha");
    const b = auditPromptForV4("beta");
    expect(a.promptHash).not.toBe(b.promptHash);
  });
});

describe("RUNTIME_TOOL_USE_SUFFIX", () => {
  it("contains the v4 native-tool-use instruction", () => {
    expect(RUNTIME_TOOL_USE_SUFFIX).toContain('native tool calling');
    expect(RUNTIME_TOOL_USE_SUFFIX).toContain('plain text');
    expect(RUNTIME_TOOL_USE_SUFFIX).toContain('No XML envelopes');
    expect(RUNTIME_TOOL_USE_SUFFIX).toContain('no JSON wrappers');
  });

  it("does NOT contain any of the dead-sentinel patterns it's counter-instructing", () => {
    // Sanity: the suffix itself must not trigger the audit it's meant to
    // counter. Otherwise wiring the suffix into the static block before
    // running the audit would create a self-reference.
    const auditOfSuffix = auditPromptForV4(RUNTIME_TOOL_USE_SUFFIX);
    expect(auditOfSuffix.sentinelsFound).toHaveLength(0);
  });
});
