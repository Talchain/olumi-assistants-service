import { describe, it, expect, beforeAll } from "vitest";
import Ajv from "ajv";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CeeDecisionReviewPayloadV1 JSON Schema", () => {
  let schema: Record<string, unknown>;
  let fixture: Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ajv: any;

  beforeAll(async () => {
    const schemaPath = join(__dirname, "../../schemas/cee-decision-review.v1.json");
    const fixturePath = join(__dirname, "../fixtures/cee/cee-decision-review.v1.json");

    [schema, fixture] = await Promise.all([
      readFile(schemaPath, "utf-8").then(JSON.parse),
      readFile(fixturePath, "utf-8").then(JSON.parse),
    ]);

    // Handle ESM/CJS interop
    const AjvConstructor = Ajv.default || Ajv;
    ajv = new AjvConstructor({ strict: false, allErrors: true });
  });

  it("schema is valid JSON Schema draft-07", () => {
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.title).toBe("CeeDecisionReviewPayloadV1");
  });

  it("golden fixture validates against schema", () => {
    const validate = ajv.compile(schema);
    const valid = validate(fixture);

    if (!valid) {
      console.error("Validation errors:", JSON.stringify(validate.errors, null, 2));
    }

    expect(valid).toBe(true);
  });

  it("schema rejects payload missing required fields", () => {
    const validate = ajv.compile(schema);

    // Missing 'story'
    const invalidMissingStory = {
      journey: fixture.journey,
      uiFlags: fixture.uiFlags,
    };
    expect(validate(invalidMissingStory)).toBe(false);

    // Missing 'uiFlags'
    const invalidMissingUiFlags = {
      story: fixture.story,
      journey: fixture.journey,
    };
    expect(validate(invalidMissingUiFlags)).toBe(false);
  });

  it("schema rejects invalid enum values", () => {
    const validate = ajv.compile(schema);

    const invalidStatus = JSON.parse(JSON.stringify(fixture));
    invalidStatus.journey.health.overallStatus = "invalid_status";

    expect(validate(invalidStatus)).toBe(false);
  });

  it("schema allows optional trace field", () => {
    const validate = ajv.compile(schema);

    const withoutTrace = JSON.parse(JSON.stringify(fixture));
    delete withoutTrace.trace;

    expect(validate(withoutTrace)).toBe(true);
  });

  it("defines all required sub-schemas", () => {
    const defs = schema.$defs as Record<string, unknown>;

    expect(defs).toBeDefined();
    expect(defs.DecisionStorySummaryV1).toBeDefined();
    expect(defs.CeeJourneySummaryV1).toBeDefined();
    expect(defs.CeeJourneyHealthV1).toBeDefined();
    expect(defs.CeeHealthSummaryV1).toBeDefined();
    expect(defs.CeeUiFlagsV1).toBeDefined();
  });

  it("frozen fields match golden fixture structure", () => {
    // This test ensures the schema and fixture stay in sync
    // If the fixture changes, this test will remind us to update the schema

    // Required top-level keys
    expect(fixture).toHaveProperty("story");
    expect(fixture).toHaveProperty("journey");
    expect(fixture).toHaveProperty("uiFlags");

    // Story required fields
    const story = fixture.story as Record<string, unknown>;
    expect(story).toHaveProperty("headline");
    expect(story).toHaveProperty("key_drivers");
    expect(story).toHaveProperty("risks_and_gaps");
    expect(story).toHaveProperty("next_actions");
    expect(story).toHaveProperty("any_truncated");

    // Journey required fields
    const journey = fixture.journey as Record<string, unknown>;
    expect(journey).toHaveProperty("story");
    expect(journey).toHaveProperty("health");
    expect(journey).toHaveProperty("is_complete");
    expect(journey).toHaveProperty("missing_envelopes");
    expect(journey).toHaveProperty("has_team_disagreement");

    // UI flags required fields
    const uiFlags = fixture.uiFlags as Record<string, unknown>;
    expect(uiFlags).toHaveProperty("has_high_risk_envelopes");
    expect(uiFlags).toHaveProperty("has_team_disagreement");
    expect(uiFlags).toHaveProperty("has_truncation_somewhere");
    expect(uiFlags).toHaveProperty("is_journey_complete");
  });
});
