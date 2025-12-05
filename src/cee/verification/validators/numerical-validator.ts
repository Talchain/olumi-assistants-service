import type { InferenceResultsV1 } from "../../../contracts/plot/engine.js";
import type { VerificationContext, VerificationResult, VerificationStage } from "../types.js";

interface ExtractedNumber {
  value: number;
  location: string;
}

/**
 * NumericalValidator
 *
 * Proof-of-concept numerical grounding stage. It extracts numeric literals
 * from the response payload and attempts to match them against the
 * InferenceResultsV1 summary statistics (p10/p50/p90). For now this stage is
 * warning-only and never blocks responses.
 */
export class NumericalValidator implements VerificationStage<unknown, unknown> {
  readonly name = "numerical_grounding" as const;

  async validate(
    payload: unknown,
    context?: VerificationContext,
  ): Promise<VerificationResult<unknown>> {
    const engineResults = context?.engineResults as InferenceResultsV1 | undefined;

    // If there are no engine results to compare against, skip gracefully.
    if (!engineResults) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
      };
    }

    const extracted = this.extractNumbers(payload);

    // Filter to "interesting" numbers: probabilities and percentages in [0, 1]
    // or percentages mapped from e.g. 65% -> 0.65.
    const significant = extracted.filter((n) =>
      (n.value >= 0 && n.value <= 1) || (n.value > 1 && n.value < 100),
    );

    if (significant.length === 0) {
      return {
        valid: true,
        stage: this.name,
      };
    }

    const ungrounded = significant.filter((n) => !this.isGrounded(n.value, engineResults));

    const hallucinationScore = significant.length > 0
      ? ungrounded.length / significant.length
      : 0;

    if (hallucinationScore > 0) {
      // Warning-only in the initial phase: do not block the response.
      return {
        valid: true,
        stage: this.name,
        severity: "warning",
        code: "NUMERICAL_UNGROUNDED",
        message: `${ungrounded.length}/${significant.length} numbers lack grounding in inference results`,
        details: {
          hallucination_score: hallucinationScore,
          ungrounded_count: ungrounded.length,
          total_numbers: significant.length,
          // Values only, no surrounding text to avoid leaking content.
          sample_ungrounded: ungrounded.slice(0, 3).map((n) => n.value),
        },
      };
    }

    return {
      valid: true,
      stage: this.name,
    };
  }

  private extractNumbers(obj: unknown, path = ""): ExtractedNumber[] {
    const numbers: ExtractedNumber[] = [];

    if (typeof obj === "string") {
      // Match decimal numbers and percentages such as "0.65" or "65%".
      const regex = /(\d+\.?\d*%?)/g;
      let match: RegExpExecArray | null;
       
      while ((match = regex.exec(obj)) !== null) {
        const raw = match[1];
        const hasPercent = raw.endsWith("%");
        const numeric = parseFloat(hasPercent ? raw.slice(0, -1) : raw);
        if (Number.isNaN(numeric)) continue;

        const value = hasPercent ? numeric / 100 : numeric;
        numbers.push({
          value,
          location: path,
        });
      }
      return numbers;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        numbers.push(...this.extractNumbers(item, `${path}[${index}]`));
      });
      return numbers;
    }

    if (obj && typeof obj === "object") {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        numbers.push(...this.extractNumbers(value, childPath));
      }
    }

    return numbers;
  }

  private isGrounded(value: number, results: InferenceResultsV1): boolean {
    const tolerance = 0.01;
    const summary = (results as any).summary as
      | Record<string, { p10?: number; p50?: number; p90?: number }>
      | undefined;

    if (!summary) return false;

    for (const entry of Object.values(summary)) {
      const candidates = [entry.p10, entry.p50, entry.p90].filter(
        (v): v is number => typeof v === "number",
      );
      if (candidates.some((v) => Math.abs(v - value) < tolerance)) {
        return true;
      }
    }

    return false;
  }
}
