import { describe, it, expect, beforeAll } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CeeDecisionReviewPayload v1 Schema", () => {
  let schema: Record<string, unknown>;
  let goldenFixture: Record<string, unknown>;
   
  let ajv: any;
   
  let validate: any;

  beforeAll(async () => {
    const schemaPath = join(__dirname, "../../schemas/cee-decision-review.v1.json");
    const fixturePath = join(__dirname, "../fixtures/cee-decision-review.v1.golden.json");

    [schema, goldenFixture] = await Promise.all([
      readFile(schemaPath, "utf-8").then(JSON.parse),
      readFile(fixturePath, "utf-8").then(JSON.parse),
    ]);

    // Handle ESM/CJS interop
    const AjvConstructor = Ajv.default || Ajv;
    ajv = new AjvConstructor({ strict: false, allErrors: true });

    // Add formats support for date-time validation
    const addFormatsFunc = addFormats.default || addFormats;
    addFormatsFunc(ajv);

    validate = ajv.compile(schema);
  });

  it("validates golden fixture", () => {
    const valid = validate(goldenFixture);
    if (!valid) {
      console.error("Validation errors:", JSON.stringify(validate.errors, null, 2));
    }
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it("rejects missing required fields", () => {
    const invalid = { schema: "cee.decision-review.v1" };
    expect(validate(invalid)).toBe(false);
  });

  it("rejects invalid schema version", () => {
    const invalid = { ...goldenFixture, schema: "cee.decision-review.v2" };
    expect(validate(invalid)).toBe(false);
  });

  it("rejects additional properties", () => {
    const invalid = { ...goldenFixture, unexpected_field: "value" };
    expect(validate(invalid)).toBe(false);
  });

  it("accepts minimal valid payload", () => {
    const minimal = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [],
      },
    };
    expect(validate(minimal)).toBe(true);
  });

  it("validates recommendation structure", () => {
    const withInvalidRecommendation = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [
          { id: "rec_1" }, // Missing required 'priority' and 'message'
        ],
      },
    };
    expect(validate(withInvalidRecommendation)).toBe(false);
  });

  it("validates bias_finding structure", () => {
    const withValidBiasFinding = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [],
        bias_findings: [
          {
            code: "CONFIRMATION_BIAS",
            severity: "medium",
            message: "One-sided evidence",
          },
        ],
      },
    };
    expect(validate(withValidBiasFinding)).toBe(true);
  });

  it("validates structural_issue structure", () => {
    const withValidStructuralIssue = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [],
        structural_issues: [
          {
            code: "ORPHAN_NODE",
            severity: "warning",
            message: "Disconnected node found",
          },
        ],
      },
    };
    expect(validate(withValidStructuralIssue)).toBe(true);
  });

  it("rejects invalid severity enum values", () => {
    const withInvalidSeverity = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [],
        bias_findings: [
          {
            code: "TEST",
            severity: "invalid_severity",
            message: "Test",
          },
        ],
      },
    };
    expect(validate(withInvalidSeverity)).toBe(false);
  });

  it("validates confidence range (0-1)", () => {
    const withInvalidConfidence = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 1.5, // Invalid: > 1
        recommendations: [],
      },
    };
    expect(validate(withInvalidConfidence)).toBe(false);
  });

  it("allows null scenario_id", () => {
    const withNullScenario = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      scenario_id: null,
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [],
      },
    };
    expect(validate(withNullScenario)).toBe(true);
  });

  it("validates trace and meta fields", () => {
    const withTraceAndMeta = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        recommendations: [],
      },
      trace: {
        request_id: "req_123",
        correlation_id: "corr_456",
        latency_ms: 500,
        model_version: "v1.0.0",
      },
      meta: {
        created_at: "2025-11-26T10:30:00Z",
        graph_hash: "sha256:abc123",
        seed: 42,
      },
    };
    expect(validate(withTraceAndMeta)).toBe(true);
  });

  it("validates quality_band enum values", () => {
    const withValidQualityBand = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        quality_band: "high",
        recommendations: [],
      },
    };
    expect(validate(withValidQualityBand)).toBe(true);

    const withInvalidQualityBand = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test summary",
        confidence: 0.5,
        quality_band: "excellent", // Invalid
        recommendations: [],
      },
    };
    expect(validate(withInvalidQualityBand)).toBe(false);
  });

  it("validates recommendation priority enum values", () => {
    const validPriorities = ["high", "medium", "low"];
    for (const priority of validPriorities) {
      const payload = {
        schema: "cee.decision-review.v1",
        version: "1.0.0",
        decision_id: "dec_123",
        review: {
          summary: "Test",
          confidence: 0.5,
          recommendations: [{ id: "r1", priority, message: "Test" }],
        },
      };
      expect(validate(payload)).toBe(true);
    }
  });

  it("validates micro_intervention structure", () => {
    const withMicroIntervention = {
      schema: "cee.decision-review.v1",
      version: "1.0.0",
      decision_id: "dec_123",
      review: {
        summary: "Test",
        confidence: 0.5,
        recommendations: [],
        bias_findings: [
          {
            code: "TEST_BIAS",
            severity: "low",
            message: "Test bias",
            micro_intervention: {
              steps: ["Step 1", "Step 2"],
              estimated_minutes: 5,
            },
          },
        ],
      },
    };
    expect(validate(withMicroIntervention)).toBe(true);
  });
});
