import { describe, it, expect, beforeAll } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

import { buildCeeErrorResponse } from "../../src/cee/validation/pipeline.js";

/**
 * Contract tests: ensure CEEErrorResponseV1 responses built by buildCeeErrorResponse
 * conform to the OpenAPI components.schemas.CEEErrorResponseV1 definition.
 */

describe("CEEErrorResponseV1 OpenAPI schema", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ajv: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validate: any;

  beforeAll(async () => {
    const specPath = resolve(process.cwd(), "openapi.yaml");
    const specYaml = await readFile(specPath, "utf-8");
    const spec = YAML.parse(specYaml) as any;

    // Handle ESM/CJS interop
    const AjvConstructor = (Ajv as any).default || Ajv;
    ajv = new AjvConstructor({ strict: false, allErrors: true });

    const addFormatsFunc = (addFormats as any).default || addFormats;
    addFormatsFunc(ajv);

    // Register the entire OpenAPI document so local $ref pointers
    // like #/components/schemas/CEEErrorCode resolve correctly.
    ajv.addSchema(spec, "openapi");

    validate = ajv.getSchema("openapi#/components/schemas/CEEErrorResponseV1");
    if (!validate) {
      throw new Error("Failed to resolve CEEErrorResponseV1 schema from OpenAPI document");
    }
  });

  function expectValid(payload: unknown) {
    const valid = validate(payload);
    if (!valid) {
      // eslint-disable-next-line no-console
      console.error("Validation errors:", JSON.stringify(validate.errors, null, 2));
    }
    expect(valid).toBe(true);
    expect(validate.errors).toBeNull();
  }

  it("accepts minimal internal error", () => {
    const error = buildCeeErrorResponse("CEE_INTERNAL_ERROR", "internal error", {});
    expectValid(error);
  });

  it("accepts empty_graph error with recovery and counts", () => {
    const error = buildCeeErrorResponse(
      "CEE_GRAPH_INVALID",
      "Draft graph is empty; unable to construct model",
      {
        retryable: false,
        requestId: "req_empty",
        reason: "empty_graph",
        nodeCount: 0,
        edgeCount: 0,
        recovery: {
          suggestion: "Add more detail to your decision brief before drafting a model.",
          hints: [
            "State the specific decision you are trying to make (e.g., 'Should we X or Y?')",
            "List 2-3 concrete options you are considering.",
            "Describe what success looks like for this decision (key outcomes or KPIs).",
          ],
          example:
            "We need to decide whether to build the feature in-house or outsource it. Options are: hire contractors, use an agency, or build with the current team. Success means launching within 3 months under $50k.",
        },
      },
    );

    expectValid(error);
  });

  it("accepts incomplete_structure error with missing_kinds", () => {
    const error = buildCeeErrorResponse(
      "CEE_GRAPH_INVALID",
      "Graph missing required elements: goal, decision, option",
      {
        retryable: false,
        requestId: "req_incomplete",
        reason: "incomplete_structure",
        nodeCount: 3,
        edgeCount: 2,
        missingKinds: ["goal"],
      },
    );

    expectValid(error);
  });

  it("rejects payloads missing required fields", () => {
    const error = buildCeeErrorResponse("CEE_INTERNAL_ERROR", "internal error", {});

    const { schema: _schema, code: _code, message: _message, ...rest } = error as any;

    const valid = validate(rest);
    expect(valid).toBe(false);
  });
});
