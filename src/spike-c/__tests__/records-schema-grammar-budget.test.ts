/**
 * SPIKE ARM C — C-K0's static half: the grammar-budget pins.
 *
 * ⚠ THROWAWAY. Spike branch only.
 *
 * ── ⚠ WHAT THIS TEST IS AND IS NOT ────────────────────────────────────────
 * C-K0 (protocol §7) is "records tool schema fails the LIVE compile probe".
 * This file is NOT that probe. The static budgets are PROXIES — the graph
 * schema's own history proves it: it satisfied every static budget and still
 * drew 400 "The compiled grammar is too large" TWICE (2026-04-02 at 11KB;
 * 2026-05-02 at ~4.6KB, found by a 15-probe live bisect on 2026-07-07), and
 * each time every production draft silently fell back to prompt-only JSON.
 * `scripts/probe-grammar-compile.mjs` says it outright: "The static budgets are
 * proxies; THIS probe is the ground truth."
 *
 * The live probe for THIS schema is `scripts/spike-c-probe-records-grammar.mjs`
 * and it requires an API key. It had NOT been run when this file was written.
 * A green run here is NECESSARY and NOT SUFFICIENT for C-K0.
 *
 * ── THE COMPARATOR THAT DOES MOST OF THE WORK ──────────────────────────────
 * The strongest static evidence available without a key is not any absolute
 * budget — it is that the records schema is smaller than the graph schema ON
 * EVERY AXIS AT ONCE, and the graph schema is empirically known to compile on
 * the frozen model (`claude-sonnet-4-6`) at this tip. That comparison is pinned
 * below and is the one to re-check if the schema is ever amended.
 */

import { describe, expect, it } from "vitest";
import { buildDraftGraphSchema } from "../../cee/draft/anthropic-graph-schema.js";
import {
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  ANTHROPIC_UNION_PARAM_LIMIT,
  MIN_ITEMS_ALLOWED_VALUES,
  SERIALIZED_BYTES_BUDGET,
  buildSpikeCRecordsSchema,
  countObjectSchemas,
  measureSpikeCSchemaBudget,
} from "../records-schema.js";

/**
 * The bisect's PASS boundary: ~3.2KB / 7 object schemas PASS,
 * ~3.5KB / 9 object schemas FAIL (anthropic-graph-schema.ts:57-79).
 */
const BISECT_PASS_OBJECT_SCHEMAS = 7;

describe("C-K0 static: the arm-C records schema fits every published budget", () => {
  const report = measureSpikeCSchemaBudget();

  it("is well under the serialized-bytes budget", () => {
    expect(report.serializedBytes).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
    // Non-vacuity: a schema that failed to build would serialize to ~2 bytes
    // and pass the line above.
    expect(report.serializedBytes).toBeGreaterThan(500);
  });

  it("is under the object-schema count at the bisect's PASS boundary", () => {
    expect(report.objectSchemas).toBeLessThanOrEqual(BISECT_PASS_OBJECT_SCHEMAS);
    expect(report.objectSchemas).toBeGreaterThan(0);
  });

  it("is under the optional-parameter limit (the budget the protocol names)", () => {
    expect(report.optionalParams).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
  });

  it("uses no union-typed parameters at all", () => {
    expect(report.unionParams).toBeLessThanOrEqual(ANTHROPIC_UNION_PARAM_LIMIT);
    // Design note 3: optional beats required-nullable on both the union budget
    // and on output tokens (C-K2). Zero is the deliberate outcome, not luck.
    expect(report.unionParams).toBe(0);
  });

  it("uses only `minItems` values Anthropic accepts (4 → HTTP 400, live-probed)", () => {
    for (const v of report.minItemsValues) {
      expect(MIN_ITEMS_ALLOWED_VALUES).toContain(v as 0 | 1);
    }
    // Non-vacuity: an empty list would pass the loop trivially. `stated_items`
    // MUST carry one — the `[]`-is-conformant hole shipped here twice.
    expect(report.minItemsValues).toEqual([1]);
  });

  it("contains no keyword the structured-outputs compiler rejects", () => {
    expect(report.forbiddenKeywords).toEqual([]);
  });

  it("every object schema carries `additionalProperties: false`", () => {
    expect(report.objectsMissingAdditionalPropertiesFalse).toEqual([]);
  });
});

describe("C-K0 static: the detectors can actually fail", () => {
  // Each budget assertion above is only worth its positive control. These prove
  // the counters bite, so a green suite above is evidence rather than silence.

  it("the forbidden-keyword detector catches a rejected keyword", () => {
    const bad = buildSpikeCRecordsSchema();
    (((bad.properties as Record<string, any>).stated_items.items.properties)).value.minimum = 0;
    expect(measureSpikeCSchemaBudget(bad).forbiddenKeywords).toContain("minimum");
  });

  it("the additionalProperties detector catches a missing guard", () => {
    const bad = buildSpikeCRecordsSchema();
    delete (bad.properties as Record<string, any>).claims.items.additionalProperties;
    expect(measureSpikeCSchemaBudget(bad).objectsMissingAdditionalPropertiesFalse.length).toBeGreaterThan(0);
  });

  it("the minItems collector catches a disallowed value", () => {
    const bad = buildSpikeCRecordsSchema();
    (bad.properties as Record<string, any>).claims.minItems = 4;
    expect(measureSpikeCSchemaBudget(bad).minItemsValues).toContain(4);
  });

  it("the object-schema counter rises when an object is nested", () => {
    const bad = buildSpikeCRecordsSchema();
    (bad.properties as Record<string, any>).claims.items.properties.payload = {
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    };
    expect(countObjectSchemas(bad)).toBe(countObjectSchemas(buildSpikeCRecordsSchema()) + 1);
  });
});

describe("C-K0 static: the records schema is cheaper than a grammar known to compile", () => {
  /**
   * The load-bearing comparison. `buildDraftGraphSchema()` is the object the
   * adapter attaches on the live draft path at this tip, and it compiles on
   * `claude-sonnet-4-6` (the frozen spike model). A schema strictly smaller on
   * every axis is the strongest static case available for C-K0 — and it is
   * still not the live probe.
   */
  const records = measureSpikeCSchemaBudget();
  const graph = buildDraftGraphSchema() as Record<string, unknown>;
  const graphBytes = JSON.stringify(graph).length;
  const graphObjects = countObjectSchemas(graph);

  it("the comparator is real — the graph schema is non-trivial", () => {
    // Contrast control: if `buildDraftGraphSchema()` ever returned a stub, the
    // comparisons below would pass while comparing against nothing.
    expect(graphBytes).toBeGreaterThan(2000);
    expect(graphObjects).toBeGreaterThan(3);
  });

  it("records schema is smaller in serialized bytes", () => {
    expect(records.serializedBytes).toBeLessThan(graphBytes);
  });

  it("records schema has fewer object schemas", () => {
    expect(records.objectSchemas).toBeLessThan(graphObjects);
  });

  it("records schema has no unions where the graph schema has several", () => {
    expect(records.unionParams).toBe(0);
  });
});
