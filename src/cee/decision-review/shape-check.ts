/**
 * Decision Review — Lightweight Shape Check (M2 Schema)
 *
 * Extracted from assist.v1.decision-review.ts for independent testability.
 *
 * Validates the LLM output shape and (when DSK is enabled) cross-checks
 * DSK claim IDs and protocol IDs against the loaded bundle.
 *
 * DSK validation rules:
 * - dsk_claim_id not found in bundle → HARD REJECT (entire response)
 * - evidence_strength drifts from bundle → warning
 * - dsk_protocol_id not found in bundle → warning
 * - dsk_protocol_id's linked_claim_id mismatches dsk_claim_id → warning
 * - DSK disabled → all DSK fields ignored entirely
 *
 * Grounding rules:
 * - Numbers in descriptive fields must appear in the input data (±10%)
 * - Violations emit UNGROUNDED_NUMBER warnings (one per fabricated number)
 * - Caller decides whether to retry on UNGROUNDED_NUMBER
 */

import { config } from '../../config/index.js';
import { getClaimById, getProtocolById } from '../../orchestrator/dsk-loader.js';

// ============================================================================
// Types
// ============================================================================

export interface ShapeCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Grounding helpers
// ============================================================================

/**
 * The subset of the review input needed for grounding checks.
 * All numeric fields the LLM is allowed to cite in descriptive text.
 */
export interface ReviewInputForGrounding {
  winner: {
    win_probability?: number;
    outcome_mean?: number;
    label?: string;
    [key: string]: unknown;
  };
  runner_up?: {
    win_probability?: number;
    outcome_mean?: number;
    label?: string;
    [key: string]: unknown;
  } | null;
  isl_results?: {
    option_comparison?: Array<{
      win_probability?: number;
      outcome?: { mean?: number; p10?: number; p90?: number };
      option_label?: string;
      [key: string]: unknown;
    }>;
    factor_sensitivity?: Array<{ elasticity?: number; [key: string]: unknown }>;
    fragile_edges?: Array<{
      switch_probability?: number;
      marginal_switch_probability?: number;
      [key: string]: unknown;
    }>;
    robustness?: { recommendation_stability?: number; overall_confidence?: number; [key: string]: unknown };
    [key: string]: unknown;
  };
  flip_threshold_data?: Array<{
    current_value?: number;
    flip_value?: number | null;
    [key: string]: unknown;
  }>;
  /** Pre-computed margin (winner.win_probability − runner_up.win_probability). Null for single-option decisions. */
  margin?: number | null;
}

// Regex to extract numeric tokens from label strings (integers and decimals, incl. negatives).
// Used to add label-embedded numbers (e.g. "£59" from "Increase Price to £59") to the corpus.
const LABEL_NUMBER_PATTERN = /(-?\d+(?:\.\d+)?)/g;

/**
 * Extract numeric tokens from a label string (e.g. winner.label, option_label).
 * Numbers appearing in labels are legitimately cited by the LLM and must be in the corpus.
 */
function extractNumbersFromLabel(label: unknown): number[] {
  if (typeof label !== 'string' || label.length === 0) return [];
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  LABEL_NUMBER_PATTERN.lastIndex = 0;
  while ((m = LABEL_NUMBER_PATTERN.exec(label)) !== null) {
    const n = parseFloat(m[1]);
    if (isFinite(n)) nums.push(n);
  }
  return nums;
}

/**
 * Extract all numeric values from the input that the LLM is permitted to cite.
 * Returns a flat array of numbers the validator uses for ±10% proximity checks.
 *
 * Includes:
 * - All structured numeric fields (probabilities, outcomes, sensitivities, etc.)
 * - Numeric tokens embedded in label strings (winner.label, runner_up.label,
 *   option_comparison[].option_label) — so a label like "Increase Price to £59"
 *   legitimises "59" in descriptive text.
 */
export function extractGroundedNumbers(input: ReviewInputForGrounding): number[] {
  const nums: number[] = [];

  const push = (v: unknown) => {
    if (typeof v === 'number' && isFinite(v)) nums.push(v);
  };

  // Structured numeric fields
  push(input.winner.win_probability);
  push(input.winner.outcome_mean);
  // Label-embedded numbers from winner
  nums.push(...extractNumbersFromLabel(input.winner.label));

  if (input.runner_up) {
    push(input.runner_up.win_probability);
    push(input.runner_up.outcome_mean);
    nums.push(...extractNumbersFromLabel(input.runner_up.label));
  }

  // Pre-computed margin is a legitimate citable number
  if (input.margin != null) push(input.margin);

  for (const oc of input.isl_results?.option_comparison ?? []) {
    push(oc.win_probability);
    push(oc.outcome?.mean);
    push(oc.outcome?.p10);
    push(oc.outcome?.p90);
    // Label-embedded numbers from option_label
    nums.push(...extractNumbersFromLabel(oc.option_label));
  }

  for (const fs of input.isl_results?.factor_sensitivity ?? []) {
    push(fs.elasticity);
  }

  for (const fe of input.isl_results?.fragile_edges ?? []) {
    push(fe.switch_probability);
    push(fe.marginal_switch_probability);
  }

  push(input.isl_results?.robustness?.recommendation_stability);
  push(input.isl_results?.robustness?.overall_confidence);

  for (const ft of input.flip_threshold_data ?? []) {
    push(ft.current_value);
    if (ft.flip_value !== null) push(ft.flip_value);
  }

  return nums;
}

/**
 * Return true if `n` is within ±10% of any value in `groundedNums`.
 * Handles the percentage ↔ decimal equivalence (0.77 ≈ 77%) by also checking
 * whether n / 100 or n * 100 is within tolerance of a grounded value.
 */
function isGrounded(n: number, groundedNums: number[]): boolean {
  if (groundedNums.length === 0) return true; // No corpus → can't check, skip
  const candidates = [n, n / 100, n * 100];
  for (const candidate of candidates) {
    for (const g of groundedNums) {
      if (g === 0 && candidate === 0) return true;
      if (g === 0) continue;
      if (Math.abs((candidate - g) / g) <= 0.10) return true;
    }
  }
  return false;
}

// Regex that matches standalone numbers (integers and decimals, including negatives).
// - Lookbehind excludes digits so "77 points" only captures "77" once.
// - Lookahead excludes letters and digits so IDs like "opt-3", "edge_1" are skipped.
// - % is NOT in the lookahead — percentages are handled by PERCENTAGE_PATTERN instead.
const NUMBER_PATTERN = /(?<![a-zA-Z_\-\d])(-?\d+(?:\.\d+)?)(?![a-zA-Z\d])/g;

// Regex that captures the numeric part of percentage values (e.g. "99%" → "99").
// Applied to a separate scan so percentages are validated against the corpus.
const PERCENTAGE_PATTERN = /(?<![a-zA-Z_\-\d])(-?\d+(?:\.\d+)?)%/g;

/**
 * Collect all ungrounded numbers from a string field.
 *
 * Two-pass scan:
 * 1. PERCENTAGE_PATTERN: extract the numeric part of "N%" and check against corpus.
 *    isGrounded() already handles decimal↔percentage equivalence (0.77 ≈ 77%).
 * 2. NUMBER_PATTERN: extract standalone numbers (not followed by %) and check.
 *
 * Returns the fabricated number strings for logging. Deduplication is handled by callers.
 */
function findUngroundedNumbers(text: string, groundedNums: number[]): string[] {
  const fabricated: string[] = [];

  // Pass 1: percentages — extract numeric part of "N%"
  PERCENTAGE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PERCENTAGE_PATTERN.exec(text)) !== null) {
    const n = parseFloat(match[1]);
    if (!isGrounded(n, groundedNums)) {
      fabricated.push(`${match[1]}%`);
    }
  }

  // Pass 2: standalone numbers (not followed by %)
  NUMBER_PATTERN.lastIndex = 0;
  while ((match = NUMBER_PATTERN.exec(text)) !== null) {
    // Skip if immediately followed by % (already handled in pass 1)
    if (text[match.index + match[0].length] === '%') continue;
    const n = parseFloat(match[1]);
    if (!isGrounded(n, groundedNums)) {
      fabricated.push(match[1]);
    }
  }

  return fabricated;
}

/**
 * The descriptive fields the grounding rule applies to (per the prompt).
 * We collect strings recursively from objects/arrays within these top-level keys.
 */
const DESCRIPTIVE_FIELD_KEYS: ReadonlyArray<string> = [
  'narrative_summary',
  'robustness_explanation',
  'readiness_rationale',
  'scenario_contexts',
  'flip_thresholds',
  'pre_mortem',
];

/** Recursively collect string values from an unknown value. */
function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

/**
 * Check all descriptive fields in the LLM output for ungrounded numbers.
 * Returns warnings of the form: `UNGROUNDED_NUMBER: "<n>" in <field> is not within ±10% of any input value`.
 */
export function checkNumberGrounding(
  data: Record<string, unknown>,
  input: ReviewInputForGrounding,
): string[] {
  const groundedNums = extractGroundedNumbers(input);
  const warnings: string[] = [];

  for (const key of DESCRIPTIVE_FIELD_KEYS) {
    if (!(key in data)) continue;
    const strings = collectStrings(data[key]);
    // Collect all fabricated numbers across all strings, deduplicated per field
    const seen = new Set<string>();
    for (const str of strings) {
      for (const bad of findUngroundedNumbers(str, groundedNums)) {
        if (!seen.has(bad)) {
          seen.add(bad);
          warnings.push(`UNGROUNDED_NUMBER: "${bad}" in ${key} is not within ±10% of any input value`);
        }
      }
    }
  }

  // Also check bias_findings[].description separately (descriptive per prompt)
  if (Array.isArray(data.bias_findings)) {
    const seen = new Set<string>();
    for (const bf of data.bias_findings as Record<string, unknown>[]) {
      if (typeof bf.description === 'string') {
        for (const bad of findUngroundedNumbers(bf.description, groundedNums)) {
          if (!seen.has(bad)) {
            seen.add(bad);
            warnings.push(`UNGROUNDED_NUMBER: "${bad}" in bias_findings[].description is not within ±10% of any input value`);
          }
        }
      }
    }
  }

  return warnings;
}

// ============================================================================
// Shape Checker
// ============================================================================

/**
 * Perform lightweight shape check for M2 Decision Review schema.
 *
 * Required fields:
 * - narrative_summary (string)
 * - story_headlines (object, non-empty)
 * - robustness_explanation (object)
 * - readiness_rationale (string)
 * - evidence_enhancements (object)
 * - bias_findings (array, max 3)
 * - key_assumptions (array, max 5)
 * - decision_quality_prompts (array, max 3)
 *
 * Optional DSK fields (gated by config.features.dskEnabled):
 * - bias_findings[].dsk_claim_id (string) — hard reject if not in bundle
 * - bias_findings[].evidence_strength ("strong" | "medium") — warning if drifts
 * - decision_quality_prompts[].dsk_claim_id (string) — hard reject if not in bundle
 * - decision_quality_prompts[].evidence_strength ("strong" | "medium") — warning if drifts
 * - decision_quality_prompts[].dsk_protocol_id (string) — warning if not in bundle
 *
 * Optional fields (prompt rules allow omission in certain conditions):
 * - scenario_contexts (object) - omit if fragile_edges is empty
 * - pre_mortem (object) - omit if fragile_edges is empty
 * - flip_thresholds (array, max 2)
 * - framing_check (object)
 *
 * @param reviewInput - When provided, enables UNGROUNDED_NUMBER grounding checks.
 */
export function performShapeCheck(
  data: unknown,
  reviewInput?: ReviewInputForGrounding,
): ShapeCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof data !== "object" || data === null) {
    return { valid: false, errors: ["Response is not an object"], warnings: [] };
  }

  const obj = data as Record<string, unknown>;

  // Required string fields
  if (!("narrative_summary" in obj) || typeof obj.narrative_summary !== "string") {
    errors.push("Missing or invalid narrative_summary (expected string)");
  }

  if (!("readiness_rationale" in obj) || typeof obj.readiness_rationale !== "string") {
    errors.push("Missing or invalid readiness_rationale (expected string)");
  }

  // Required object fields
  if (!("story_headlines" in obj) || typeof obj.story_headlines !== "object" || obj.story_headlines === null) {
    errors.push("Missing or invalid story_headlines (expected object)");
  } else if (Object.keys(obj.story_headlines as object).length === 0) {
    errors.push("story_headlines must be non-empty");
  }

  if (!("robustness_explanation" in obj) || typeof obj.robustness_explanation !== "object" || obj.robustness_explanation === null) {
    errors.push("Missing or invalid robustness_explanation (expected object)");
  }

  if (!("evidence_enhancements" in obj) || typeof obj.evidence_enhancements !== "object" || obj.evidence_enhancements === null) {
    errors.push("Missing or invalid evidence_enhancements (expected object)");
  }

  // scenario_contexts is optional - prompt rules say "If fragile_edges is empty → omit scenario_contexts"
  if ("scenario_contexts" in obj && (typeof obj.scenario_contexts !== "object" || obj.scenario_contexts === null)) {
    errors.push("Invalid scenario_contexts (expected object or omitted)");
  }

  // Required array fields with limits
  if (!("bias_findings" in obj) || !Array.isArray(obj.bias_findings)) {
    errors.push("Missing or invalid bias_findings (expected array)");
  } else if (obj.bias_findings.length > 3) {
    errors.push(`bias_findings has ${obj.bias_findings.length} items (max: 3)`);
  }

  if (!("key_assumptions" in obj) || !Array.isArray(obj.key_assumptions)) {
    errors.push("Missing or invalid key_assumptions (expected array)");
  } else if (obj.key_assumptions.length > 5) {
    errors.push(`key_assumptions has ${obj.key_assumptions.length} items (max: 5)`);
  }

  if (!("decision_quality_prompts" in obj) || !Array.isArray(obj.decision_quality_prompts)) {
    errors.push("Missing or invalid decision_quality_prompts (expected array)");
  } else if (obj.decision_quality_prompts.length > 3) {
    errors.push(`decision_quality_prompts has ${obj.decision_quality_prompts.length} items (max: 3)`);
  }

  // Optional field limits
  if ("flip_thresholds" in obj) {
    if (!Array.isArray(obj.flip_thresholds)) {
      warnings.push("flip_thresholds should be an array");
    } else if (obj.flip_thresholds.length > 2) {
      errors.push(`flip_thresholds has ${obj.flip_thresholds.length} items (max: 2)`);
    }
  }

  // Optional fields type check (warnings only)
  if ("pre_mortem" in obj && (typeof obj.pre_mortem !== "object" || obj.pre_mortem === null)) {
    warnings.push("pre_mortem should be an object");
  }

  if ("framing_check" in obj && (typeof obj.framing_check !== "object" || obj.framing_check === null)) {
    warnings.push("framing_check should be an object");
  }

  // =========================================================================
  // DSK field validation — gated entirely by config.features.dskEnabled
  //
  // When DSK is disabled, all DSK fields are ignored (no warnings, no errors).
  // When DSK is enabled:
  //   - dsk_claim_id not found → HARD REJECT (trust boundary)
  //   - evidence_strength mismatch → warning
  //   - dsk_protocol_id not found → warning
  //   - claim↔protocol linked_claim_id mismatch → warning
  // =========================================================================
  const dskCrossCheck = config.features.dskEnabled;

  if (dskCrossCheck && Array.isArray(obj.bias_findings)) {
    for (const bf of obj.bias_findings as Record<string, unknown>[]) {
      if ("dsk_claim_id" in bf) {
        if (typeof bf.dsk_claim_id !== "string") {
          warnings.push("bias_findings[].dsk_claim_id should be a string");
        } else {
          const claim = getClaimById(bf.dsk_claim_id);
          if (!claim) {
            errors.push(`bias_findings[].dsk_claim_id "${bf.dsk_claim_id}" not found in loaded DSK bundle`);
          } else if (typeof bf.evidence_strength === "string" && bf.evidence_strength !== claim.evidence_strength) {
            warnings.push(
              `bias_findings[].evidence_strength "${bf.evidence_strength}" drifts from bundle value "${claim.evidence_strength}" for ${bf.dsk_claim_id}`,
            );
          }
        }
      }
      if ("evidence_strength" in bf && typeof bf.evidence_strength === "string") {
        if (bf.evidence_strength !== "strong" && bf.evidence_strength !== "medium") {
          warnings.push(`bias_findings[].evidence_strength "${bf.evidence_strength}" not in ["strong", "medium"]`);
        }
      }
    }
  }

  if (dskCrossCheck && Array.isArray(obj.decision_quality_prompts)) {
    for (const dqp of obj.decision_quality_prompts as Record<string, unknown>[]) {
      if ("dsk_claim_id" in dqp) {
        if (typeof dqp.dsk_claim_id !== "string") {
          warnings.push("decision_quality_prompts[].dsk_claim_id should be a string");
        } else {
          const claim = getClaimById(dqp.dsk_claim_id);
          if (!claim) {
            errors.push(`decision_quality_prompts[].dsk_claim_id "${dqp.dsk_claim_id}" not found in loaded DSK bundle`);
          } else if (typeof dqp.evidence_strength === "string" && dqp.evidence_strength !== claim.evidence_strength) {
            warnings.push(
              `decision_quality_prompts[].evidence_strength "${dqp.evidence_strength}" drifts from bundle value "${claim.evidence_strength}" for ${dqp.dsk_claim_id}`,
            );
          }
        }
      }
      if ("evidence_strength" in dqp && typeof dqp.evidence_strength === "string") {
        if (dqp.evidence_strength !== "strong" && dqp.evidence_strength !== "medium") {
          warnings.push(`decision_quality_prompts[].evidence_strength "${dqp.evidence_strength}" not in ["strong", "medium"]`);
        }
      }
      // dsk_protocol_id check (warning only — protocol IDs are advisory references)
      if ("dsk_protocol_id" in dqp) {
        if (typeof dqp.dsk_protocol_id !== "string") {
          warnings.push("decision_quality_prompts[].dsk_protocol_id should be a string");
        } else {
          const protocol = getProtocolById(dqp.dsk_protocol_id);
          if (!protocol) {
            warnings.push(
              `decision_quality_prompts[].dsk_protocol_id "${dqp.dsk_protocol_id}" not found in loaded DSK bundle`,
            );
          } else if (
            typeof dqp.dsk_claim_id === "string" &&
            protocol.linked_claim_id &&
            protocol.linked_claim_id !== dqp.dsk_claim_id
          ) {
            // Claim↔protocol consistency: the protocol links to a different claim than referenced
            warnings.push(
              `decision_quality_prompts[].dsk_protocol_id "${dqp.dsk_protocol_id}" linked_claim_id is "${protocol.linked_claim_id}", but dsk_claim_id is "${dqp.dsk_claim_id}"`,
            );
          }
        }
      }
    }
  }

  // =========================================================================
  // Grounding check — enabled when reviewInput is provided and shape is valid
  //
  // Only run when the basic shape passed (object with the expected fields),
  // because grounding checks against descriptive strings require those strings
  // to be present and of the right type.
  // =========================================================================
  if (reviewInput && errors.length === 0) {
    const groundingWarnings = checkNumberGrounding(obj, reviewInput);
    warnings.push(...groundingWarnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}
