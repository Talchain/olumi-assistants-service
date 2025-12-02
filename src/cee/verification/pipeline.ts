import { z } from "zod";
import type { VerificationContext, VerificationResult } from "./types.js";
import { SchemaValidator } from "./validators/schema-validator.js";
import { EngineValidator } from "./validators/engine-validator.js";
import { NumericalValidator } from "./validators/numerical-validator.js";
import { MetadataEnricher } from "./validators/metadata-enricher.js";
import { BranchProbabilityValidator } from "./validators/branch-probability-validator.js";
import { emit, TelemetryEvents } from "../../utils/telemetry.js";

/**
 * VerificationPipeline
 *
 * Coordinates the schema, engine, and numerical grounding validators and
 * attaches a metadata-only trace.verification block to CEE responses.
 */
export class VerificationPipeline {
  private readonly schemaValidator = new SchemaValidator();
  private readonly engineValidator = new EngineValidator();
  private readonly numericalValidator = new NumericalValidator();
  private readonly branchProbabilityValidator = new BranchProbabilityValidator();
  private readonly metadataEnricher = new MetadataEnricher();

  /**
   * Run all enabled verification stages for a given response.
   *
   * This method throws on hard validation failures (schema/engine) using
   * regular Error instances; callers should map these into domain errors
   * (e.g. CEEErrorResponseV1) in their own context.
   */
  async verify<T>(
    payload: unknown,
    schema: z.ZodSchema<T> | undefined,
    context: VerificationContext,
  ): Promise<{ response: T; results: VerificationResult[] }> {
    const start = Date.now();
    const results: VerificationResult[] = [];

    // Stage 1: schema validation (hard blocker)
    const schemaResult = await this.schemaValidator.validate<T>(payload, schema);
    results.push(schemaResult);
    if (!schemaResult.valid) {
      this.emitFailureTelemetry("SCHEMA_INVALID", results, context);
      throw new Error(schemaResult.message ?? "Schema validation failed");
    }

    const typed = (schemaResult.validated_data ?? payload) as T;

    // Stage 2: engine validation (hard blocker for graph endpoints)
    if (context.requiresEngineValidation && (typed as any)?.graph) {
      const graph = (typed as any).graph as unknown;
      const engineResult = await this.engineValidator.validate(graph as any, context);
      results.push(engineResult);
      if (!engineResult.valid) {
        const code = engineResult.code ?? "ENGINE_VALIDATION_FAILED";
        this.emitFailureTelemetry(code, results, context);
        throw new Error(engineResult.message ?? "Engine validation failed");
      }
    }

    // Stage 3: numerical grounding (warning-only PoC)
    const numericalResult = await this.numericalValidator.validate(typed as any, context);
    results.push(numericalResult);

    const branchResult = await this.branchProbabilityValidator.validate(typed as any, context);
    results.push(branchResult);

    // Stage 4: enrich response with verification metadata
    let enriched = this.metadataEnricher.enrich(typed as any, results) as T & {
      trace?: { verification?: { verification_latency_ms?: number } };
    };

    const latencyMs = Date.now() - start;
    if (enriched.trace?.verification) {
      enriched = {
        ...enriched,
        trace: {
          ...enriched.trace,
          verification: {
            ...enriched.trace.verification,
            verification_latency_ms: latencyMs,
          },
        },
      };
    }

    this.emitSuccessTelemetry(latencyMs, results, context);

    return { response: enriched as T, results };
  }

  private emitFailureTelemetry(
    errorCode: string,
    results: VerificationResult[],
    context: VerificationContext,
  ): void {
    try {
      emit(TelemetryEvents.CeeVerificationFailed, {
        endpoint: context.endpoint,
        request_id: context.requestId,
        error_code: errorCode,
        stages_completed: results.length,
      });
    } catch {
      // Telemetry must never cause failures in the verification pipeline.
    }
  }

  private emitSuccessTelemetry(
    latencyMs: number,
    results: VerificationResult[],
    context: VerificationContext,
  ): void {
    try {
      emit(TelemetryEvents.CeeVerificationSucceeded, {
        endpoint: context.endpoint,
        request_id: context.requestId,
        verification_latency_ms: latencyMs,
        stages_passed: results.filter((r) => r.valid).length,
        stages_failed: results.filter((r) => !r.valid).length,
      });
    } catch {
      // Telemetry must never cause failures in the verification pipeline.
    }
  }
}
