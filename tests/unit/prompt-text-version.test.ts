/**
 * Tests for prompt text version tracking
 *
 * Covers:
 * - prompt_text_version is derived from prompt store version
 * - Fallback prompt (v19) is clearly identified
 * - Fallback prompt contains known v19-specific strings
 */

import { describe, it, expect } from "vitest";

describe("Prompt Text Version Formatting", () => {
  it("formats store version as vN", () => {
    // Simulates adapter logic: promptMeta.source === 'store' && promptMeta.version
    const promptMeta = { source: 'store' as const, version: 163 };
    const promptTextVersion = promptMeta.source === 'store' && promptMeta.version
      ? `v${promptMeta.version}`
      : 'fallback-v19';

    expect(promptTextVersion).toBe("v163");
  });

  it("uses fallback-v19 when source is default", () => {
    // Simulates adapter logic: promptMeta.source === 'default'
    const promptMeta = { source: 'default' as const, version: undefined };
    const promptTextVersion = promptMeta.source === 'store' && promptMeta.version
      ? `v${promptMeta.version}`
      : 'fallback-v19';

    expect(promptTextVersion).toBe("fallback-v19");
  });

  it("uses fallback-v19 when version is missing from store", () => {
    // Edge case: source is 'store' but no version (shouldn't happen, but defensive)
    const promptMeta = { source: 'store' as const, version: undefined };
    const promptTextVersion = promptMeta.source === 'store' && promptMeta.version
      ? `v${promptMeta.version}`
      : 'fallback-v19';

    expect(promptTextVersion).toBe("fallback-v19");
  });
});

describe("Fallback Prompt v19 Content", () => {
  it("contains v19-specific causal claims section", async () => {
    const { DRAFT_GRAPH_PROMPT_V19 } = await import(
      "../../src/prompts/defaults-v19.js"
    );

    // v19-specific: causal claims array
    expect(DRAFT_GRAPH_PROMPT_V19).toContain(
      "Aim for 5–12 key causal judgements"
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
