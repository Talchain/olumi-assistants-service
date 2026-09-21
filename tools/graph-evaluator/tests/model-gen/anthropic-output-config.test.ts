/**
 * Anthropic `output_config` passthrough — both directions.
 *
 * This asserts WHAT WE SEND, without a network call. The absent-case assertion
 * is the load-bearing one: Arm A′ adds a body field to a provider that every
 * other arm and every existing bake-off also uses, and a change that alters the
 * request when nobody asked for it would silently re-baseline them all.
 */

import { describe, expect, it } from "vitest";
import { buildMessagesParams } from "../../src/providers/anthropic-provider.js";
import type { ModelConfig } from "../../src/providers/types.js";
import { assertSchemaMirrorsTypes, loadRichSchema } from "../../src/rich-model.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base: ModelConfig = {
  id: "claude-sonnet-4-6-rich",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  max_tokens: 16384,
  params: { temperature: 0 },
};

describe("buildMessagesParams", () => {
  it("omits output_config entirely when the config does not set one", () => {
    const body = buildMessagesParams("sys", "usr", base) as Record<string, unknown>;
    expect("output_config" in body).toBe(false);
    expect(body).toEqual({
      model: "claude-sonnet-4-6",
      system: "sys",
      messages: [{ role: "user", content: "usr" }],
      max_tokens: 16384,
      temperature: 0,
    });
  });

  it("passes output_config through VERBATIM when set", () => {
    const schema = loadRichSchema();
    const output_config = { format: { type: "json_schema", schema } };
    const body = buildMessagesParams("sys", "usr", { ...base, output_config }) as Record<
      string,
      unknown
    >;
    expect(body["output_config"]).toBe(output_config);
    // Identity fields are untouched by the passthrough.
    expect(body["model"]).toBe("claude-sonnet-4-6");
    expect(body["system"]).toBe("sys");
  });

  it("does not invent an output_config from response_schema", () => {
    // `response_schema` is a carrier for the runner, not a provider trigger.
    const body = buildMessagesParams("sys", "usr", {
      ...base,
      response_schema: { type: "object" },
    }) as Record<string, unknown>;
    expect("output_config" in body).toBe(false);
  });

  it("still carries thinking for Claude models, and only for Claude models", () => {
    const withThinking = buildMessagesParams("sys", "usr", {
      ...base,
      thinking: { type: "disabled" },
    }) as Record<string, unknown>;
    expect(withThinking["thinking"]).toEqual({ type: "disabled" });

    const nonClaude = buildMessagesParams("sys", "usr", {
      ...base,
      model: "some-other-model",
      thinking: { type: "disabled" },
    }) as Record<string, unknown>;
    expect("thinking" in nonClaude).toBe(false);
  });
});

describe("loadRichSchema", () => {
  it("strips $schema and $id (both providers reject them in this position)", () => {
    const schema = loadRichSchema();
    expect("$schema" in schema).toBe(false);
    expect("$id" in schema).toBe(false);
    // Positive control: the probe can see something — the contract's own keys survive.
    expect(schema["title"]).toBe("RichDecisionModel");
    expect(Object.keys(schema["properties"] as object)).toContain("user_facts");
  });
});

describe("assertSchemaMirrorsTypes", () => {
  it("passes on the live contract", () => {
    expect(() => assertSchemaMirrorsTypes()).not.toThrow();
  });

  it("REDs on a NESTED drift, not only a top-level one", () => {
    // The 2026-09-22 shape exactly: `decision.goal_measured_by` was added to
    // `properties` without being added to `decision.required`. Top-level
    // `required` never moved, so a top-level-only check is blind to it.
    const schema = loadRichSchema() as Record<string, unknown>;
    const decision = (schema["properties"] as Record<string, Record<string, unknown>>)["decision"];
    (decision["properties"] as Record<string, unknown>)["smuggled_field"] = { type: "string" };

    const dir = mkdtempSync(join(tmpdir(), "rich-schema-drift-"));
    const path = join(dir, "drifted.json");
    writeFileSync(path, JSON.stringify(schema));
    expect(() => assertSchemaMirrorsTypes(path)).toThrow(/smuggled_field/);
  });

  it("REDs on a TOP-LEVEL drift too (contrast control for the check above)", () => {
    const schema = loadRichSchema() as Record<string, unknown>;
    schema["required"] = (schema["required"] as string[]).filter((k) => k !== "notes");
    const dir = mkdtempSync(join(tmpdir(), "rich-schema-drift-"));
    const path = join(dir, "drifted-top.json");
    writeFileSync(path, JSON.stringify(schema));
    expect(() => assertSchemaMirrorsTypes(path)).toThrow(/notes/);
  });
});
