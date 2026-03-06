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
 */
export function performShapeCheck(data: unknown): ShapeCheckResult {
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

  return { valid: errors.length === 0, errors, warnings };
}
