import type { GraphT } from "../../../schemas/graph.js";
import { validateGraph as validateGraphWithCache } from "../../../services/validateClientWithCache.js";
import type { VerificationResult, VerificationStage, VerificationContext } from "../types.js";

/**
 * EngineValidator
 *
 * Wraps the existing engine /v1/validate client and exposes the result as a
 * structured verification stage. This stage is intended to be used as a hard
 * blocker for graph-producing endpoints (e.g. draft-graph, options).
 */
export class EngineValidator implements VerificationStage<GraphT, void> {
  readonly name = "engine_validation" as const;

  async validate(
    graph: GraphT,
    _context?: VerificationContext,
  ): Promise<VerificationResult<void>> {
    const result = await validateGraphWithCache(graph);

    if (result.ok) {
      return {
        valid: true,
        stage: this.name,
      };
    }

    const violations = result.violations ?? [];
    const isUnreachable = violations.includes("validate_unreachable");

    if (isUnreachable) {
      return {
        valid: false,
        stage: this.name,
        severity: "error",
        code: "ENGINE_TIMEOUT",
        message: "Engine validation service is unreachable",
        details: {
          violations,
        },
      };
    }

    return {
      valid: false,
      stage: this.name,
      severity: "error",
      code: "ENGINE_VALIDATION_FAILED",
      message: "Graph failed engine validation",
      details: {
        violations,
      },
    };
  }
}
