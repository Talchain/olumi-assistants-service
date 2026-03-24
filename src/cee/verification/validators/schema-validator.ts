import { z } from "zod";
import type { VerificationResult, VerificationStage } from "../types.js";
import { extractZodIssues } from "../../../schemas/llmExtraction.js";
import { log } from "../../../utils/telemetry.js";

/**
 * Zod-based schema validator for CEE responses.
 *
 * This is used as the first, hard-blocking stage in the verification
 * pipeline and is responsible for enforcing basic contract invariants such
 * as required fields and primitive types.
 */
export class SchemaValidator implements VerificationStage<unknown, unknown> {
  readonly name = "schema_validation" as const;

  async validate<T>(
    payload: unknown,

    schemaOrContext?: z.ZodType<T, z.ZodTypeDef, unknown> | any,
  ): Promise<VerificationResult<T>> {
    const schema = schemaOrContext as z.ZodType<T, z.ZodTypeDef, unknown> | undefined;

    if (!schema) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
      } as VerificationResult<T>;
    }

    const parseResult = schema.safeParse(payload);

    if (!parseResult.success) {
      const errorPaths = parseResult.error.errors.map((e) => e.path.join("."));

      // Diagnostic: log first 5 Zod issues (schema paths and error codes only, no user content)
      const diagnosticIssues = parseResult.error.errors.slice(0, 5).map((e) => ({
        path: e.path.join("."),
        code: e.code,
        message: e.message,
      }));
      log.warn(
        {
          event: "cee.verification.schema_invalid_detail",
          error_count: parseResult.error.errors.length,
          issues: diagnosticIssues,
        },
        "SCHEMA_INVALID diagnostic: Zod validation failed on assembled response",
      );

      return {
        valid: false,
        stage: this.name,
        severity: "error",
        code: "SCHEMA_INVALID",
        message: "Response does not conform to expected schema",
        details: {
          error_paths: errorPaths,
          error_count: parseResult.error.errors.length,
          first_issues: extractZodIssues(parseResult.error, 3),
        },
      } as VerificationResult<T>;
    }

    return {
      valid: true,
      stage: this.name,
      validated_data: parseResult.data,
    } as VerificationResult<T>;
  }
}
