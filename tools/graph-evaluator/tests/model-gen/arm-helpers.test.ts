/**
 * What the runner SENDS, CHARGES and counts as grounded — checked offline.
 *
 * The cost assertion is the one that matters. Terra and Sol shipped with
 * placeholder pricing, and a harness that quietly billed them at $0.00 would put
 * a fabricated number in the same column as a real one.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkDskGrounding,
  estimateCost,
  withRichSchema,
  type PricedConfig,
} from "../../scripts/model-gen/arm-helpers.js";
import { loadRichSchema, parseRichModel, type RichDecisionModel } from "../../src/rich-model.js";
import type { LLMResult } from "../../src/providers/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function model(): RichDecisionModel {
  return parseRichModel(
    readFileSync(join(HERE, "fixtures", "pricing-builder-20260922.json"), "utf-8"),
  );
}

const usage: LLMResult = {
  ok: true,
  text: "{}",
  error: null,
  provider: "openai",
  model: "m",
  latency_ms: 1,
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
};

describe("estimateCost", () => {
  it("charges at the configured rate when pricing is verified", () => {
    const config = {
      id: "x",
      provider: "openai",
      model: "m",
      pricing: { input_per_1m: 2, output_per_1m: 8, source: "openai_api_docs_2026-03" },
      pricing_verified: true,
    } as PricedConfig;
    expect(estimateCost(config, usage)).toBeCloseTo(10);
  });

  it("returns NULL — not 0 — when pricing_verified is false", () => {
    const config = {
      id: "x",
      provider: "openai",
      model: "m",
      pricing: { input_per_1m: 0, output_per_1m: 0, source: "unknown — fill from OpenAI pricing page" },
      pricing_verified: false,
    } as PricedConfig;
    expect(estimateCost(config, usage)).toBeNull();
  });

  it("returns NULL when the source merely SAYS unknown, even if the flag is missing", () => {
    const config = {
      id: "x",
      provider: "openai",
      model: "m",
      pricing: { input_per_1m: 3, output_per_1m: 9, source: "Unknown — placeholder" },
    } as PricedConfig;
    expect(estimateCost(config, usage)).toBeNull();
  });

  it("returns NULL when there is no pricing block at all", () => {
    expect(estimateCost({ id: "x", provider: "openai", model: "m" } as PricedConfig, usage)).toBeNull();
  });
});

describe("withRichSchema", () => {
  const schema = loadRichSchema();

  it("OpenAI gets params.text.format with name + strict", () => {
    const wired = withRichSchema(
      { id: "a", provider: "openai", model: "gpt-4.1", params: { temperature: 0 } },
      schema,
    );
    const text = wired.params?.["text"] as { format: Record<string, unknown> };
    expect(text.format["type"]).toBe("json_schema");
    expect(text.format["strict"]).toBe(true);
    expect(text.format["name"]).toBe("rich_decision_model");
    expect(wired.params?.["temperature"]).toBe(0);
    expect(wired.output_config).toBeUndefined();
  });

  it("Anthropic gets output_config.format with NEITHER name NOR strict", () => {
    const wired = withRichSchema(
      { id: "b", provider: "anthropic", model: "claude-sonnet-4-6" },
      schema,
    );
    const oc = wired.output_config as { format: Record<string, unknown> };
    expect(oc.format["type"]).toBe("json_schema");
    expect("name" in oc.format).toBe(false);
    expect("strict" in oc.format).toBe(false);
    expect(wired.params?.["text"]).toBeUndefined();
  });

  it("does not mutate the caller's config", () => {
    const original = { id: "a", provider: "openai" as const, model: "gpt-4.1", params: {} };
    withRichSchema(original, schema);
    expect(original.params).toEqual({});
  });
});

describe("checkDskGrounding", () => {
  it("passes when nothing is cited and nothing was offered (--dsk off)", () => {
    expect(checkDskGrounding(model(), []).ok).toBe(true);
  });

  it("FAILS an id that was never in the allowlist", () => {
    const m = model();
    m.factors[0].dsk_refs = ["DSK-B-999"];
    const result = checkDskGrounding(m, ["DSK-B-001"]);
    expect(result.ok).toBe(false);
    expect(result.failures[0].gate).toBe("DSK1_ref_not_in_allowlist");
    expect(result.failures[0].detail).toContain("DSK-B-999");
  });

  it("passes an id that WAS in the allowlist (contrast control)", () => {
    const m = model();
    m.factors[0].dsk_refs = ["DSK-B-001"];
    expect(checkDskGrounding(m, ["DSK-B-001"]).ok).toBe(true);
  });

  it("checks notes as well as factors/outcomes/links", () => {
    const m = model();
    m.notes.push({ about_id: "f1", kind: "challenge", text: "t", dsk_refs: ["DSK-FAKE"] });
    expect(checkDskGrounding(m, ["DSK-B-001"]).failures.map((f) => f.gate)).toContain(
      "DSK1_ref_not_in_allowlist",
    );
  });
});
