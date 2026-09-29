/**
 * Causal Claims Validation (Phase 2B — Task 2)
 *
 * Non-blocking validation: malformed claims are dropped, not fatal.
 * Runs AFTER STRP so node IDs are validated against the post-repair graph.
 *
 * Validation steps:
 *  1. Type check — if not array, emit MALFORMED warning, return []
 *  2. Per-claim Zod parse — drop invalid, aggregate into DROPPED warning
 *  3. Truncation — keep first 20, emit TRUNCATED if exceeded
 *  4. Node ID validation — drop claims referencing missing nodes, emit INVALID_REF
 */

import {
  CausalClaimSchema,
  CAUSAL_CLAIMS_MAX,
  CAUSAL_CLAIMS_WARNING_CODES,
  type CausalClaim,
} from "../../schemas/causal-claims.js";
import type { ValidationWarningV3T } from "../../schemas/cee-v3.js";

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface CausalClaimsValidationResult {
  /** Validated claims (post-drop, post-truncation, post-node-ref check) */
  claims: CausalClaim[];
  /** Warnings emitted during validation */
  warnings: ValidationWarningV3T[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all node IDs referenced by a single claim. */
function referencedNodeIds(claim: CausalClaim): string[] {
  switch (claim.type) {
    case "direct_effect":
    case "no_direct_effect":
      return [claim.from, claim.to];
    case "mediation_only":
      return [claim.from, claim.via, claim.to];
    case "unmeasured_confounder":
      return [...claim.between];
  }
}

// ---------------------------------------------------------------------------
// Main Validation
// ---------------------------------------------------------------------------

/**
 * Validate raw `causal_claims` from the LLM response.
 *
 * @param raw       - The raw value from the LLM response (may be anything)
 * @param graphNodeIds - Set of canonical node IDs in the post-STRP graph
 * @returns Validated claims + any warnings
 */
export function validateCausalClaims(
  raw: unknown,
  graphNodeIds: Set<string>,
): CausalClaimsValidationResult {
  const warnings: ValidationWarningV3T[] = [];

  // ── Step 1: Type check ──────────────────────────────────────────────────
  if (!Array.isArray(raw)) {
    warnings.push({
      code: CAUSAL_CLAIMS_WARNING_CODES.MALFORMED,
      severity: "warn",
      message: "causal_claims present but not an array — replaced with empty array",
    });
    return { claims: [], warnings };
  }

  // ── Step 2: Per-claim Zod parse — drop invalid ──────────────────────────
  const parsed: CausalClaim[] = [];
  const dropReasons: string[] = [];

  for (const item of raw) {
    const result = CausalClaimSchema.safeParse(item);
    if (result.success) {
      parsed.push(result.data);
    } else {
      const reason = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      dropReasons.push(reason);
    }
  }

  if (dropReasons.length > 0) {
    warnings.push({
      code: CAUSAL_CLAIMS_WARNING_CODES.DROPPED,
      severity: "warn",
      message: `Dropped ${dropReasons.length} malformed causal claim(s)`,
      details: {
        count: dropReasons.length,
        first_3_reasons: dropReasons.slice(0, 3),
      },
    });
  }

  // ── Step 3: Truncation ──────────────────────────────────────────────────
  let truncated = parsed;
  if (parsed.length > CAUSAL_CLAIMS_MAX) {
    truncated = parsed.slice(0, CAUSAL_CLAIMS_MAX);
    warnings.push({
      code: CAUSAL_CLAIMS_WARNING_CODES.TRUNCATED,
      severity: "info",
      message: `causal_claims array exceeded ${CAUSAL_CLAIMS_MAX}, truncated from ${parsed.length}`,
      details: {
        original_count: parsed.length,
        kept: CAUSAL_CLAIMS_MAX,
      },
    });
  }

  // ── Step 4: Node ID validation ──────────────────────────────────────────
  const valid: CausalClaim[] = [];
  const missingIds = new Set<string>();

  for (const claim of truncated) {
    const refs = referencedNodeIds(claim);
    const missing = refs.filter((id) => !graphNodeIds.has(id));
    if (missing.length > 0) {
      for (const id of missing) missingIds.add(id);
    } else {
      valid.push(claim);
    }
  }

  if (missingIds.size > 0) {
    const droppedCount = truncated.length - valid.length;
    warnings.push({
      code: CAUSAL_CLAIMS_WARNING_CODES.INVALID_REF,
      severity: "warn",
      message: `Dropped ${droppedCount} causal claim(s) referencing non-existent node IDs`,
      details: {
        count: droppedCount,
        missing_ids: [...missingIds],
      },
    });
  }

  return { claims: valid, warnings };
}
