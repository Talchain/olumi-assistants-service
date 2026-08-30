/**
 * Executable machine shape → real parser → semantic graph. NOT an NLP eval.
 * The former required-key keyword test passed on teapot prose; matching words
 * does not prove a semantic instruction. Full provider-boundary assembly is in
 * draft-prompt-consumer-assembly.test.ts; actual model behaviour is separate.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Ajv } from "ajv";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDraftRecordsSchema, type DraftRecordSet } from "../grammar.js";
import { DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION } from "../instruction.js";
import { findGrammarFieldsDroppedBySeam, projectDraftRecords } from "../seam.js";
import { LLMDraftResponse } from "../../../../adapters/llm/shared-schemas.js";

const BRIEF = "Reduce delivery delays. Add a support team. Keep current staffing. Delivery time is 12 days.";
const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "Reduce delivery delays" },
    { kind: "option", source_quote: "Add a support team" },
    { kind: "option", source_quote: "Keep current staffing" },
    { kind: "figure", source_quote: "Delivery time is 12 days", value: 12, unit: "days", role: "baseline" },
  ],
  claims: [
    { claim_kind: "prior", label: "Coordination effort", value: 4, basis: [0] },
    { claim_kind: "causal_link", label: "Support improves delivery", from_stated: 1, to_stated: 3, effect: "negative", sets_to: 8 },
    { claim_kind: "causal_link", label: "Current staffing maintains delivery", from_stated: 2, to_stated: 3, effect: "positive", sets_to: 12 },
    { claim_kind: "causal_link", label: "Delivery time bears on delays", from_stated: 3, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "Coordination bears on delays", from_claim: 0, to_stated: 0, effect: "negative" },
  ],
};

const executed = new Set<string>();
beforeEach(() => expect.hasAssertions());
afterAll(() => {
  // Removal/skip of a family must fail, not report green with fewer checks.
  expect([...executed].sort()).toEqual([
    "historical-shape", "machine-schema", "required-fields", "scalar",
    "seam-fields", "sets-to", "source-ownership", "unsupported-uncertainty",
  ]);
});

function instructionSchema(instruction: string): object {
  const match = instruction.match(/<DRAFT_RECORDS_MACHINE_SCHEMA>\s*([\s\S]*?)\s*<\/DRAFT_RECORDS_MACHINE_SCHEMA>/);
  if (!match) throw new Error("No executable records schema in instruction");
  return JSON.parse(match[1]) as object;
}

function consume(records: unknown, brief = BRIEF) {
  const seam = projectDraftRecords(records, brief);
  if (!seam.ok) throw new Error(`records consumer refused: ${seam.reason}`);
  return { seam, consumer: LLMDraftResponse.parse(seam.projection.graph) };
}

function semanticCarriage(records: unknown) {
  const { consumer } = consume(records);
  const stated = consumer.nodes.find((node) => node.label === "Delivery time is 12 days");
  const inferred = consumer.nodes.find((node) => node.label === "Coordination effort");
  const option = consumer.nodes.find((node) => node.label === "Add a support team");
  // Inspect extensions on the actual consumer's passthrough object.
  const statedData = stated?.data as { raw_value?: number; value?: number; unit?: string } | undefined;
  const inferredData = inferred?.data as { raw_value?: number; value?: number } | undefined;
  const optionData = option?.data as {
    raw_interventions?: Record<string, number>;
    intervention_details?: Record<string, { source?: string }>;
  } | undefined;
  return {
    statedRaw: statedData?.raw_value ?? statedData?.value,
    statedUnit: statedData?.unit,
    inferredRaw: inferredData?.raw_value ?? inferredData?.value,
    optionRaw: stated ? optionData?.raw_interventions?.[stated.id] : undefined,
    optionSource: stated ? optionData?.intervention_details?.[stated.id]?.source : undefined,
    inferredProvenance: inferred?.provenance,
    statedProvenance: stated?.provenance,
  };
}

function assertScalarCarriage(records: unknown) {
  expect(semanticCarriage(records)).toMatchObject({ statedRaw: 12, statedUnit: "days", inferredRaw: 4 });
}

function assertOptionCarriage(records: unknown) {
  expect(semanticCarriage(records)).toMatchObject({ optionRaw: 8, optionSource: "cee_hypothesis" });
}

describe("draft records: executable output instruction → parser → consumer", () => {
  it("machine schema is derived, executable, and rejects destroyed instructions", () => {
    executed.add("machine-schema");
    const schema = instructionSchema(DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION);
    expect(schema).toEqual(buildDraftRecordsSchema());
    expect(new Ajv().compile(schema)(RECORDS)).toBe(true);
    expect(instructionSchema(`A porcelain teapot.\n${DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION}`)).toEqual(schema);
    expect(() => instructionSchema("A porcelain teapot. label stated_items claims.")).toThrow("No executable records schema");
    const broken = structuredClone(buildDraftRecordsSchema()) as {
      properties: { claims: { items: { required: string[] } } };
    };
    broken.properties.claims.items.required = ["claim_kind"];
    const missingLabel = structuredClone(RECORDS) as unknown as { claims: Array<Record<string, unknown>> };
    delete missingLabel.claims[0].label;
    expect(new Ajv().compile(broken)(missingLabel)).toBe(true);
    expect(new Ajv().compile(schema)(missingLabel)).toBe(false);
    expect(projectDraftRecords(missingLabel, BRIEF).ok).toBe(false);
  });

  it("every required field is enforced by both the taught grammar and real seam", () => {
    executed.add("required-fields");
    const schema = buildDraftRecordsSchema() as {
      required: string[];
      properties: Record<"stated_items" | "claims", { items: { required: string[] } }>;
    };
    const validate = new Ajv().compile(instructionSchema(DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION));
    const missing: unknown[] = [];
    for (const key of schema.required) {
      const mutant = structuredClone(RECORDS) as unknown as Record<string, unknown>;
      delete mutant[key];
      missing.push(mutant);
    }
    for (const collection of ["stated_items", "claims"] as const) {
      for (const key of schema.properties[collection].items.required) {
        const mutant = structuredClone(RECORDS) as unknown as Record<string, Array<Record<string, unknown>>>;
        delete mutant[collection][0][key];
        missing.push(mutant);
      }
    }
    expect(missing).toHaveLength(6);
    for (const mutant of missing) {
      expect(validate(mutant), JSON.stringify(mutant)).toBe(false);
      expect(projectDraftRecords(mutant, BRIEF).ok).toBe(false);
    }
    const unrelated = structuredClone(RECORDS);
    unrelated.claims[1].label = "A different explanation of the same link";
    expect(validate(unrelated)).toBe(true);
    expect(consume(unrelated).consumer.nodes.length).toBeGreaterThan(0);
  });

  it("pinned served v195's worked example is refused while records are consumed", () => {
    executed.add("historical-shape");
    const historical = readFileSync(resolve(__dirname, "fixtures/served-draft-graph-v195.txt"), "utf8");
    expect(createHash("sha256").update(historical).digest("hex")).toBe("152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f");
    const start = historical.indexOf("{", historical.indexOf("<ANNOTATED_EXAMPLE>"));
    let example: unknown;
    for (let end = start + 1; end <= historical.length; end++) {
      if (historical[end - 1] !== "}") continue;
      try { example = JSON.parse(historical.slice(start, end)); break; } catch { /* incomplete */ }
    }
    expect(example).toBeDefined();
    expect(projectDraftRecords(example, BRIEF)).toMatchObject({ ok: false, reason: "graph_shaped_response" });
    expect(projectDraftRecords({ ...(example as object), title: "A different business" }, BRIEF))
      .toMatchObject({ ok: false, reason: "graph_shaped_response" });
    expect(consume(RECORDS).consumer.nodes.filter((node) => node.kind === "option")).toHaveLength(2);
  });

  it("grammar-declared fields survive the real seam rebuild", () => {
    executed.add("seam-fields");
    expect(findGrammarFieldsDroppedBySeam()).toEqual({ claims: [], statedItems: [] });
    expect(consume(RECORDS).seam.records).toEqual(RECORDS);
    const dropped = structuredClone(RECORDS);
    delete dropped.claims[1].sets_to;
    expect(() => expect(consume(dropped).seam.records).toEqual(RECORDS)).toThrow();
    const unrelated = structuredClone(RECORDS);
    unrelated.claims[1].label = "Another label";
    expect(consume(unrelated).seam.records.claims[1].sets_to).toBe(8);
  });

  it("supported scalar values reach the semantic graph; dropping value is detected", () => {
    executed.add("scalar");
    assertScalarCarriage(RECORDS);
    const lost = structuredClone(RECORDS);
    delete lost.claims[0].value;
    expect(() => assertScalarCarriage(lost)).toThrow();
    const unrelated = structuredClone(RECORDS);
    unrelated.claims[1].label = "Support changes delivery time";
    assertScalarCarriage(unrelated);
  });

  it("sets_to changes an actual option intervention, not just a parser field", () => {
    executed.add("sets-to");
    assertOptionCarriage(RECORDS);
    const lost = structuredClone(RECORDS);
    delete lost.claims[1].sets_to;
    expect(() => assertOptionCarriage(lost)).toThrow();
    const unrelated = structuredClone(RECORDS);
    unrelated.claims[1].label = "Different explanation, same effect";
    assertOptionCarriage(unrelated);
  });

  it("source ownership is earned from the brief; inferred scalars stay AI-authored", () => {
    executed.add("source-ownership");
    expect(semanticCarriage(RECORDS)).toMatchObject({
      statedProvenance: { provenance_class: "stated", brief_binding: "verified" },
      inferredProvenance: { provenance_class: "ai_inferred" },
    });
    const altered = consume(RECORDS, BRIEF.replace("Delivery time is 12 days", "Delivery time is unknown"));
    expect(altered.consumer.nodes.find((entry) => entry.label === "Delivery time is 12 days")?.provenance)
      .not.toMatchObject({ brief_binding: "verified" });
    const unrelated = consume(RECORDS, `${BRIEF} There is a teapot in the office.`);
    expect(unrelated.consumer.nodes.find((entry) => entry.label === "Delivery time is 12 days")?.provenance)
      .toMatchObject({ brief_binding: "verified" });
  });

  it("extra uncertainty is rejected by grammar and dropped by seam, not preserved", () => {
    executed.add("unsupported-uncertainty");
    const unsupported = structuredClone(RECORDS) as unknown as { claims: Array<Record<string, unknown>> };
    unsupported.claims[0].confidence = 0.8;
    const validate = new Ajv().compile(instructionSchema(DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION));
    expect(validate(unsupported)).toBe(false);
    const result = consume(unsupported);
    expect(result.seam.records.claims[0]).not.toHaveProperty("confidence");
    expect(result.consumer.nodes.find((node) => node.label === "Coordination effort")).not.toHaveProperty("confidence");
    // Explicit limitation; scalar carriage is NOT reasoned estimation or
    // uncertainty preservation. No test promotes that narrower claim.
    expect(validate(RECORDS)).toBe(true);
    expect(semanticCarriage(RECORDS).inferredRaw).toBe(4);
  });
});
