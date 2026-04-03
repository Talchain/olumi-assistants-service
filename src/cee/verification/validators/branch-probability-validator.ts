import type { GraphV1 } from "../../../contracts/plot/engine.js";
import type { VerificationContext, VerificationResult, VerificationStage } from "../types.js";

/**
 * Decision→option edges are structural — their `belief` / `belief_exists`
 * represents edge-existence certainty (always 1.0), NOT branch-selection
 * probability. No dedicated branch-weight field exists in the current schema,
 * so there is nothing meaningful to validate here.
 *
 * This validator previously checked whether structural edge beliefs summed
 * to 1.0, which produced spurious warnings on every clean graph (3 options
 * × belief=1.0 → sum=3.0 ≠ 1.0). Skipped until a dedicated selection-
 * probability field is introduced.
 */
export class BranchProbabilityValidator implements VerificationStage<unknown, unknown> {
  readonly name = "branch_probabilities" as const;

  async validate(
    _payload: unknown,
    _context?: VerificationContext,
  ): Promise<VerificationResult<unknown>> {
    return {
      valid: true,
      stage: this.name,
      skipped: true,
    };
  }
}
