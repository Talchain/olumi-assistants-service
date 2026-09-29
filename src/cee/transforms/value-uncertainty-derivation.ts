/**
 * Value Uncertainty Derivation
 *
 * Derives parametric uncertainty (std) for factor values extracted from briefs.
 * This enables ISL to perform sensitivity analysis on factor values,
 * analogous to how strength_std enables sensitivity on edge weights.
 *
 * ## Design Rationale
 *
 * The derivation formula considers three factors:
 *
 * 1. **Extraction Confidence**: How clearly the value was stated in the brief.
 *    - High confidence (0.9): "price is £59" → low CV
 *    - Low confidence (0.6): context-derived number → high CV
 *
 * 2. **Extraction Type**: The nature of the extraction pattern.
 *    - 'explicit': Direct statement ("price is £59") → multiplier 1.0
 *    - 'inferred': Approximate/context-derived ("around £60") → multiplier 1.5
 *    - 'range': Bounds given ("between £50-70") → uses range-based derivation
 *
 * 3. **Value Magnitude**: Uncertainty scales with value size (CV-based).
 *    - std = CV * |value| ensures proportional uncertainty
 *
 * ## Formula
 *
 * For explicit/inferred extractions:
 *   baseCV = 0.2 * (1 - confidence) + 0.05    // CV ∈ [0.05, 0.25]
 *   typeMultiplier = { explicit: 1.0, inferred: 1.5 }
 *   std = max(floor, baseCV * |value| * typeMultiplier)
 *
 * For range extractions:
 *   midpoint = (min + max) / 2
 *   std = (max - min) / 4    // ~95% within range (2 std on each side)
 *
 * ## Edge Cases
 *
 * - value = 0: Uses absolute floor (0.01) to avoid zero uncertainty
 * - negative values: Uses |value| for CV calculation
 * - very small values: Floor ensures minimum uncertainty
 */

import { log } from "../../utils/telemetry.js";

/**
 * Types of factor value extraction
 */
export type ExtractionType = "explicit" | "inferred" | "range" | "observed";

/**
 * Input for value uncertainty derivation
 */
export interface ValueUncertaintyInput {
  /** The extracted value */
  value: number;
  /** How the value was extracted */
  extractionType: ExtractionType;
  /** Confidence in the extraction (0-1) */
  confidence: number;
  /** For range extractions: minimum bound */
  rangeMin?: number;
  /** For range extractions: maximum bound */
  rangeMax?: number;
}

/**
 * Output from value uncertainty derivation
 */
export interface ValueUncertaintyResult {
  /** The value (may be adjusted for range extractions) */
  value: number;
  /** Derived standard deviation */
  valueStd: number;
  /** Distribution type (always 'normal' for derived) */
  distribution: "normal";
  /** For range extractions: original bounds preserved */
  rangeMin?: number;
  rangeMax?: number;
}

/**
 * Type multipliers for different extraction patterns.
 *
 * - explicit: Direct statement, lowest uncertainty
 * - inferred: Context-derived, higher uncertainty
 * - range: Uses separate range-based derivation
 */
const TYPE_MULTIPLIERS: Record<ExtractionType, number> = {
  explicit: 1.0,
  inferred: 1.5,
  range: 1.0, // Not used for range - has special handling
  observed: 1.0, // Directly observed, same confidence as explicit
};

/**
 * Minimum uncertainty floor as a fraction of |value|.
 * Ensures even highly confident extractions have some uncertainty.
 */
const RELATIVE_FLOOR = 0.01;

/**
 * Absolute minimum uncertainty floor.
 * Used when value is 0 or very small.
 */
const ABSOLUTE_FLOOR = 0.01;

/**
 * Derive parametric uncertainty (std) from factor extraction context.
 *
 * @param input - Value extraction details including confidence and type
 * @returns Derived uncertainty result with value, std, and distribution
 *
 * @example
 * // Explicit extraction with high confidence
 * deriveValueUncertainty({
 *   value: 59,
 *   extractionType: 'explicit',
 *   confidence: 0.90
 * });
 * // Returns: { value: 59, valueStd: ~3.5, distribution: 'normal' }
 *
 * @example
 * // Inferred extraction with lower confidence
 * deriveValueUncertainty({
 *   value: 60,
 *   extractionType: 'inferred',
 *   confidence: 0.70
 * });
 * // Returns: { value: 60, valueStd: ~9.9, distribution: 'normal' }
 *
 * @example
 * // Range extraction
 * deriveValueUncertainty({
 *   value: 60,
 *   extractionType: 'range',
 *   confidence: 0.80,
 *   rangeMin: 50,
 *   rangeMax: 70
 * });
 * // Returns: { value: 60, valueStd: 5, distribution: 'normal', rangeMin: 50, rangeMax: 70 }
 */
export function deriveValueUncertainty(
  input: ValueUncertaintyInput
): ValueUncertaintyResult {
  const { value, extractionType, confidence, rangeMin, rangeMax } = input;

  // Handle range extractions with special logic
  if (extractionType === "range") {
    if (rangeMin !== undefined && rangeMax !== undefined) {
      return deriveRangeUncertainty(value, rangeMin, rangeMax);
    }
    // Warn when range extraction is missing bounds - fallback to CV derivation
    // This shouldn't happen in production but helps debug extraction issues
    log.warn({
      value,
      extractionType,
      rangeMin,
      rangeMax,
      event: "cee.value_uncertainty.range_bounds_missing",
    }, "Range extraction missing bounds, falling back to CV derivation");
  }

  // Standard derivation for explicit/inferred extractions (or fallback for incomplete range)
  return deriveStandardUncertainty(value, extractionType, confidence);
}

/**
 * Derive uncertainty for range extractions.
 *
 * Uses the range bounds to compute std such that ~95% of samples
 * fall within the original range (assuming normal distribution).
 *
 * std = (max - min) / 4
 * This gives ~2 std on each side of midpoint.
 */
function deriveRangeUncertainty(
  value: number,
  rangeMin: number,
  rangeMax: number
): ValueUncertaintyResult {
  // Use provided value or compute midpoint
  const effectiveValue =
    value !== undefined ? value : (rangeMin + rangeMax) / 2;

  // Range-based std: 95% within bounds → ~2 std on each side
  const rangeWidth = Math.abs(rangeMax - rangeMin);
  const rangeStd = rangeWidth / 4;

  // Apply floor for very narrow ranges
  const finalStd = Math.max(
    ABSOLUTE_FLOOR,
    Math.max(RELATIVE_FLOOR * Math.abs(effectiveValue), rangeStd)
  );

  return {
    value: effectiveValue,
    valueStd: finalStd,
    distribution: "normal",
    rangeMin,
    rangeMax,
  };
}

/**
 * Derive uncertainty for explicit/inferred extractions using CV formula.
 *
 * baseCV = 0.2 * (1 - confidence) + 0.05
 * std = max(floor, baseCV * |value| * typeMultiplier)
 */
function deriveStandardUncertainty(
  value: number,
  extractionType: ExtractionType,
  confidence: number
): ValueUncertaintyResult {
  // Clamp confidence to valid range
  const clampedConfidence = Math.max(0, Math.min(1, confidence));

  // Base coefficient of variation inversely proportional to confidence
  // CV ranges from 0.05 (confidence=1.0) to 0.25 (confidence=0.0)
  const baseCV = 0.2 * (1 - clampedConfidence) + 0.05;

  // Get type multiplier
  const typeMultiplier = TYPE_MULTIPLIERS[extractionType] ?? 1.0;

  // Compute std with CV formula
  const absValue = Math.abs(value);
  const cvBasedStd = baseCV * absValue * typeMultiplier;

  // Apply floors
  const relativeFloor = RELATIVE_FLOOR * absValue;
  const finalStd = Math.max(ABSOLUTE_FLOOR, Math.max(relativeFloor, cvBasedStd));

  return {
    value,
    valueStd: finalStd,
    distribution: "normal",
  };
}

/**
 * Batch derive value uncertainty for multiple factors.
 *
 * @param inputs - Array of value extraction details
 * @returns Array of uncertainty results (same order as input)
 */
export function deriveValueUncertaintyBatch(
  inputs: ValueUncertaintyInput[]
): ValueUncertaintyResult[] {
  return inputs.map(deriveValueUncertainty);
}
