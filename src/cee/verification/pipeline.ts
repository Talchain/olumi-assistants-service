import { z } from "zod";
import type { VerificationContext, VerificationResult } from "./types.js";
import { SchemaValidator } from "./validators/schema-validator.js";
import { EngineValidator } from "./validators/engine-validator.js";
import { NumericalValidator } from "./validators/numerical-validator.js";
import { MetadataEnricher } from "./validators/metadata-enricher.js";
import { BranchProbabilityValidator } from "./validators/branch-probability-validator.js";
import { WeightSuggestionValidator } from "./validators/weight-suggestion-validator.js";
import { ComparisonDetector } from "./validators/comparison-detector.js";
import { generateWeightSuggestions } from "./generators/weight-suggestion-generator.js";
import { emit, TelemetryEvents, log } from "../../utils/telemetry.js";
import type { CEEWeightSuggestionV1T } from "../../schemas/ceeResponses.js";

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
  private readonly weightSuggestionValidator = new WeightSuggestionValidator();
  private readonly comparisonDetector = new ComparisonDetector();
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
    schema: z.ZodType<T, z.ZodTypeDef, unknown> | undefined,
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

    // Stage 4: weight suggestions (graph quality enhancement)
    const weightResult = await this.weightSuggestionValidator.validate(typed as any, context);
    results.push(weightResult);
    let weightSuggestions: CEEWeightSuggestionV1T[] | undefined =
      (weightResult as any).suggestions?.length > 0 ? (weightResult as any).suggestions : undefined;

    // Stage 4b: generate suggestions with grounding-aware confidence (Phase 2)
    if (weightSuggestions && weightSuggestions.length > 0 && (typed as any)?.graph) {
      try {
        // Extract grounding score from numerical validation result
        const numericalDetails = numericalResult.details as { hallucination_score?: number } | undefined;
        const numericalGroundingScore = numericalDetails?.hallucination_score !== undefined
          ? Math.max(0, Math.min(1, 1 - numericalDetails.hallucination_score))
          : undefined;

        const generatedSuggestions = await generateWeightSuggestions({
          graph: (typed as any).graph,
          detections: weightSuggestions,
          requestId: context.requestId ?? "unknown",
          numericalGroundingScore,
        });

        if (generatedSuggestions.length > 0) {
          weightSuggestions = generatedSuggestions;
          log.debug(
            { request_id: context.requestId, count: generatedSuggestions.length, grounding_score: numericalGroundingScore },
            "Generated weight suggestions"
          );
        }
      } catch (error) {
        // Generation failure is non-blocking; keep detected suggestions
        log.warn(
          { error, request_id: context.requestId },
          "Weight suggestion generation failed, using detected suggestions"
        );
      }
    }

    // Stage 5: comparison detection (graph quality enhancement)
    const comparisonResult = await this.comparisonDetector.validate(typed as any, context);
    results.push(comparisonResult);
    const comparisonSuggested: boolean | undefined = (comparisonResult as any).comparison_suggested;

    // Stage 6: enrich response with verification metadata
    let enriched = this.metadataEnricher.enrich(typed as any, results) as T & {
      trace?: { verification?: { verification_latency_ms?: number } };
      weight_suggestions?: CEEWeightSuggestionV1T[];
      comparison_suggested?: boolean;
    };

    // Add weight suggestions and comparison flag to the response
    if (weightSuggestions || comparisonSuggested !== undefined) {
      enriched = {
        ...enriched,
        ...(weightSuggestions && { weight_suggestions: weightSuggestions }),
        ...(comparisonSuggested !== undefined && { comparison_suggested: comparisonSuggested }),
      };
    }

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
