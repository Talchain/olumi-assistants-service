import type { VerificationResult } from "../types.js";

/**
 * MetadataEnricher
 *
 * Adds a verification metadata block under trace.verification for CEE
 * responses. This block is strictly metadata-only and must not contain user
 * prompts, briefs, or free-text content.
 */
export class MetadataEnricher {
   
  enrich<T extends { trace?: any }>(response: T, results: VerificationResult[]): T {
    const trace = response.trace ?? {};

    const verification = {
      schema_valid: this.passed("schema_validation", results),
      engine_validated: this.passed("engine_validation", results),
      numerical_grounding_score: this.numericalScore(results),
      issues_detected: results
        .filter((r) => !r.valid || r.severity === "warn")
        .map((r) => ({
          stage: r.stage,
          severity: r.severity ?? "info",
          code: r.code ?? "UNKNOWN",
        })),
      verification_latency_ms: 0,
      total_stages: results.length,
    };

    const next = {
      ...response,
      trace: {
        ...trace,
        verification,
      },
    };

    return next;
  }

  private passed(stage: string, results: VerificationResult[]): boolean {
    const result = results.find((r) => r.stage === stage);
    // If the stage was skipped or not present, treat as pass for metadata.
    if (!result) return true;
    if (result.skipped) return true;
    return result.valid;
  }

  private numericalScore(results: VerificationResult[]): number | undefined {
    const result = results.find((r) => r.stage === "numerical_grounding");
    const details = result?.details as { hallucination_score?: number } | undefined;
    if (!details || typeof details.hallucination_score !== "number") return undefined;
    const score = 1 - details.hallucination_score;
    return Math.max(0, Math.min(1, score));
  }
}
