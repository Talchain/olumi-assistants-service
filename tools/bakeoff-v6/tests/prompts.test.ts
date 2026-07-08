/**
 * Prompt slot discipline: BENCHMARK-ONLY banner required, PLACEHOLDER status
 * machine-detected (it drives the fail-closed watermark), unfilled slots are
 * errors, and hashes are provenance identities over the raw file.
 */
import { describe, expect, it } from "vitest";
import { anyPlaceholder, fillSlots, loadPromptSet, parsePrompt } from "../src/prompts/loader.ts";

describe("prompt slots", () => {
  it("loads the full prompt set; every current prompt is a PLACEHOLDER (smoke-only)", async () => {
    const set = await loadPromptSet();
    expect(Object.keys(set)).toHaveLength(6);
    for (const prompt of Object.values(set)) {
      expect(prompt.placeholder).toBe(true);
      expect(prompt.body.length).toBeGreaterThan(50);
      expect(prompt.hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(anyPlaceholder(set)).toBe(true);
  });

  it("RED: refuses a prompt file without the BENCHMARK-ONLY banner", () => {
    expect(() => parsePrompt("rogue.txt", "You are a helpful assistant.")).toThrow(/BENCHMARK-ONLY/);
  });

  it("a real (non-placeholder) prompt keeps the banner but drops the PLACEHOLDER line", () => {
    const real = parsePrompt(
      "real.txt",
      "# BENCHMARK-ONLY PROMPT — never PMS, never production.\n\nReal prompt body goes here."
    );
    expect(real.placeholder).toBe(false);
    expect(real.body).toBe("Real prompt body goes here.");
  });

  it("RED: unfilled slots are an error, filled slots interpolate", () => {
    const prompt = parsePrompt("slots.txt", "# BENCHMARK-ONLY\nHello {{name}}, brief: {{brief}}");
    expect(() => fillSlots(prompt, { name: "world" })).toThrow(/unfilled slots.*\{\{brief\}\}/);
    expect(fillSlots(prompt, { name: "world", brief: "B" })).toBe("Hello world, brief: B");
  });

  it("hash covers the FULL raw file so header edits (e.g. dropping PLACEHOLDER) change identity", () => {
    const a = parsePrompt("x.txt", "# BENCHMARK-ONLY\n# PLACEHOLDER\nBody");
    const b = parsePrompt("x.txt", "# BENCHMARK-ONLY\nBody");
    expect(a.body).toBe(b.body);
    expect(a.hash).not.toBe(b.hash);
  });
});
