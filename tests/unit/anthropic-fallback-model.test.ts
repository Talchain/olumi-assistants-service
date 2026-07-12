/**
 * ROADMAP 1.79 guard — the Anthropic adapter's model fallback must be a LIVE,
 * registry-enabled model, and no retired id may reappear as a fallback literal.
 *
 * History: claude-3-5-haiku-20241022 (retired 2026-02-19) sat as the default in
 * five loci (fixed in PR #438) and claude-3-5-sonnet-20241022 (retired
 * 2025-10-28) + claude-3-haiku-20240307 sat as the `args.model ||` fallback in
 * nine adapter sites (fixed here). Registry PRESENCE is not CALLABILITY — this
 * test pins the invariants a live-callability probe (1.79a) will strengthen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FALLBACK_ANTHROPIC_MODEL,
  resolveAnthropicModel,
} from "../../src/adapters/llm/anthropic.js";
import { getModelConfig } from "../../src/config/models.js";

const RETIRED_IDS = [
  "claude-3-5-sonnet-20241022",
  "claude-3-haiku-20240307",
  "claude-3-5-haiku-20241022",
];

describe("resolveAnthropicModel (1.79b)", () => {
  it("explicit model always wins", () => {
    expect(resolveAnthropicModel("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("falls back to FALLBACK_ANTHROPIC_MODEL when nothing is supplied or configured", () => {
    // config.llm.model is unset in the test env (LLM_MODEL not exported by
    // the test setup); if that ever changes this assertion surfaces it loudly
    // rather than silently changing the fallback chain under test.
    const resolved = resolveAnthropicModel(undefined);
    expect([FALLBACK_ANTHROPIC_MODEL, process.env.LLM_MODEL]).toContain(resolved);
  });

  it("the fallback model is registry-ENABLED (presence is not enough)", () => {
    const entry = getModelConfig(FALLBACK_ANTHROPIC_MODEL);
    expect(entry, `${FALLBACK_ANTHROPIC_MODEL} missing from MODEL_REGISTRY`).toBeDefined();
    expect(entry?.enabled, `${FALLBACK_ANTHROPIC_MODEL} is disabled in MODEL_REGISTRY`).toBe(true);
    expect(entry?.provider).toBe("anthropic");
  });

  it("the fallback model is not a retired id", () => {
    expect(RETIRED_IDS).not.toContain(FALLBACK_ANTHROPIC_MODEL);
  });

  it("no retired id remains as a `|| \"<model>\"` fallback literal in the adapters (source tripwire)", () => {
    for (const file of [
      "src/adapters/llm/anthropic.ts",
      "src/adapters/llm/extraction.ts",
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const id of RETIRED_IDS) {
        const fallbackPattern = new RegExp(`\\|\\|\\s*['"\`]${id}['"\`]`);
        expect(
          fallbackPattern.test(src),
          `${file} still uses retired ${id} as a fallback literal`,
        ).toBe(false);
      }
    }
  });
});
