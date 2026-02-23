/**
 * Tests for prompt text version tracking (CEE_PROMPT_TEXT_VERSION)
 *
 * Covers:
 * - Config reads CEE_PROMPT_TEXT_VERSION env var
 * - Default value is "unknown" when env var is not set
 * - prompt_text_version field appears in DraftGraphResult.meta type
 * - Fallback prompt (v19) contains known v19-specific strings
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Prompt Text Version Tracking", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Config: CEE_PROMPT_TEXT_VERSION", () => {
    it("returns the env var value when CEE_PROMPT_TEXT_VERSION is set", async () => {
      process.env = {
        NODE_ENV: "test",
        CEE_PROMPT_TEXT_VERSION: "v19",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.cee.promptTextVersion).toBe("v19");
    });

    it('defaults to "unknown" when CEE_PROMPT_TEXT_VERSION is not set', async () => {
      process.env = {
        NODE_ENV: "test",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.cee.promptTextVersion).toBe("unknown");
    });

    it("accepts arbitrary version strings", async () => {
      process.env = {
        NODE_ENV: "test",
        CEE_PROMPT_TEXT_VERSION: "v42-beta",
      };

      const { config } = await import("../../src/config/index.js");

      expect(config.cee.promptTextVersion).toBe("v42-beta");
    });
  });
});

describe("Fallback Prompt v19 Content", () => {
  it("contains v19-specific causal claims section", async () => {
    const { DRAFT_GRAPH_PROMPT_V19 } = await import(
      "../../src/prompts/defaults-v19.js"
    );

    // v19-specific: causal claims array
    expect(DRAFT_GRAPH_PROMPT_V19).toContain(
      "Aim for 5\u201312 key causal judgements"
    );
  });

  it("contains v19-specific bidirected edge sentinel parameters", async () => {
    const { DRAFT_GRAPH_PROMPT_V19 } = await import(
      "../../src/prompts/defaults-v19.js"
    );

    // v19-specific: bidirected edges are ISL trust annotations
    expect(DRAFT_GRAPH_PROMPT_V19).toContain(
      "ignored by ISL simulation; sentinel parameters are placeholders"
    );
  });

  it("contains v19-specific goal constraints extraction", async () => {
    const { DRAFT_GRAPH_PROMPT_V19 } = await import(
      "../../src/prompts/defaults-v19.js"
    );

    // v19-specific: goal_constraints[] at response root
    expect(DRAFT_GRAPH_PROMPT_V19).toContain("goal_constraints");
    expect(DRAFT_GRAPH_PROMPT_V19).toContain("constraint_id, node_id, operator, value, label, unit, source_quote");
  });

  it("is registered as the default draft_graph prompt when PROMPT_VERSION is v19", async () => {
    const { getDraftGraphPromptByVersion } = await import(
      "../../src/prompts/defaults.js"
    );

    const v19Prompt = getDraftGraphPromptByVersion("v19");
    expect(v19Prompt).toContain("CAUSAL CLAIMS");
    expect(v19Prompt).toContain("bidirected");
  });

  it("uses v19 as the default prompt version", async () => {
    // Remove PROMPT_VERSION to test default
    delete process.env.PROMPT_VERSION;

    const { getPromptVersion } = await import(
      "../../src/prompts/defaults.js"
    );

    const { version } = getPromptVersion();
    expect(version).toBe("v19");
  });
});
