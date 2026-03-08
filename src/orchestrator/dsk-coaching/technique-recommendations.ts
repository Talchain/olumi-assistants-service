/**
 * DSK Technique Recommender
 *
 * Generates technique recommendations from pipeline evidence gaps.
 * Deterministic — no LLM calls.
 *
 * Input source mapping:
 * - factor_id:           from pipeline evidence gap (e.g. node ID in graph)
 * - factor_label:        from pipeline evidence gap (node label)
 * - voi:                 from pipeline evidence gap, nullable — value of information score
 * - confidence:          from pipeline evidence gap, nullable — node confidence/exists_probability
 * - has_observed_value:  from pipeline evidence gap, nullable — whether factor has observed data
 * - is_quantitative:     from pipeline evidence gap, nullable — whether factor is numeric
 * - dominantDriverId:    from pipeline factor_sensitivity (highest influence factor), nullable
 *
 * When a field is null/undefined, the precedence rule that depends on it is skipped.
 */

import { createHash } from "node:crypto";
import type { TechniqueRecommendation } from "../../schemas/dsk-coaching.js";
import { getClaimById, getProtocolById, getAllByType } from "../dsk-loader.js";
import type { DSKProtocol } from "../../dsk/types.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export interface EvidenceGap {
  factor_id: string;
  factor_label: string;
  /** Value of information score — nullable if pipeline doesn't provide it */
  voi?: number | null;
  /** Node confidence / exists_probability — nullable */
  confidence?: number | null;
  /** Whether factor has an observed value — nullable, skip rule 2 if absent */
  has_observed_value?: boolean | null;
  /** Whether factor is numeric — nullable, skip rules 3/4 if absent */
  is_quantitative?: boolean | null;
}

// ============================================================================
// Technique mapping — hardcoded claim→protocol fallback
// ============================================================================

/**
 * Hardcoded claim→protocol mapping. Used ONLY when DSK bundle is not loaded.
 * When bundle is available, protocol_id is resolved via linked_claim_id lookup.
 */
const CLAIM_TO_PROTOCOL_FALLBACK: Record<string, string> = {
  'DSK-T-001': 'DSK-P-001',
  'DSK-T-002': 'DSK-P-002',
  'DSK-T-003': 'DSK-P-003',
  'DSK-T-004': 'DSK-P-004',
  'DSK-T-005': 'DSK-P-005',
  'DSK-T-006': 'DSK-P-006',
};

/**
 * Precedence table:
 * 1. factor_id === dominantDriverId → Pre-mortem (DSK-T-001)
 * 2. has_observed_value === false → Implementation intentions (DSK-T-006)
 * 3. is_quantitative === true AND low confidence → Reference class forecasting (DSK-T-002)
 * 4. is_quantitative === false AND low confidence → Consider-the-opposite (DSK-T-003)
 * 5. Fallback → Devil's advocacy (DSK-T-005)
 */
interface TechniqueMatch {
  claimId: string;
  techniqueLabel: string;
  guidanceTemplate: string;
  evidenceStrength: 'strong' | 'medium';
}

const LOW_CONFIDENCE_THRESHOLD = 0.5;

function matchTechnique(
  gap: EvidenceGap,
  dominantDriverId: string | null | undefined,
): TechniqueMatch {
  // Priority 1: dominant driver → pre-mortem
  if (dominantDriverId != null && gap.factor_id === dominantDriverId) {
    return {
      claimId: 'DSK-T-001',
      techniqueLabel: 'Pre-mortem',
      guidanceTemplate: `Imagine this decision failed because of ${gap.factor_label}. What went wrong?`,
      evidenceStrength: 'medium',
    };
  }

  // Priority 2: no observed value → implementation intentions (skip if null/undefined)
  if (gap.has_observed_value === false) {
    return {
      claimId: 'DSK-T-006',
      techniqueLabel: 'Implementation intentions',
      guidanceTemplate: `Define exactly how and when you will gather data on ${gap.factor_label}.`,
      evidenceStrength: 'strong',
    };
  }

  // Priority 3: quantitative + low confidence → reference class forecasting (skip if null)
  if (
    gap.is_quantitative === true &&
    gap.confidence != null &&
    gap.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return {
      claimId: 'DSK-T-002',
      techniqueLabel: 'Reference class forecasting',
      guidanceTemplate: `What happened in similar decisions? Look for base rates before estimating ${gap.factor_label}.`,
      evidenceStrength: 'strong',
    };
  }

  // Priority 4: non-quantitative + low confidence → consider-the-opposite (skip if null)
  if (
    gap.is_quantitative === false &&
    gap.confidence != null &&
    gap.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    return {
      claimId: 'DSK-T-003',
      techniqueLabel: 'Consider-the-opposite',
      guidanceTemplate: `Before settling on an assumption, argue the opposite case for ${gap.factor_label}.`,
      evidenceStrength: 'medium',
    };
  }

  // Priority 5: fallback → devil's advocacy
  return {
    claimId: 'DSK-T-005',
    techniqueLabel: "Devil's advocacy",
    guidanceTemplate: `Assign someone to challenge the current assumption about ${gap.factor_label}.`,
    evidenceStrength: 'medium',
  };
}

// ============================================================================
// ID generation
// ============================================================================

function computeTechniqueId(factorId: string, claimId: string): string {
  const input = `tech:${factorId.toLowerCase().trim()}:${claimId}`;
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 12);
}

// ============================================================================
// Protocol resolution
// ============================================================================

/**
 * Resolve protocol_id for a technique claim.
 * Prefer bundle lookup (protocol.linked_claim_id === claimId).
 * Fallback to hardcoded map only when bundle is absent.
 */
function resolveProtocolId(claimId: string): string | null {
  // Try bundle first
  const protocols = getAllByType('protocol') as DSKProtocol[];
  if (protocols.length > 0) {
    const match = protocols.find((p) => p.linked_claim_id === claimId);
    if (match) return match.id;
    // Bundle loaded but no protocol links to this claim
    return null;
  }

  // Bundle not loaded — use hardcoded fallback
  return CLAIM_TO_PROTOCOL_FALLBACK[claimId] ?? null;
}

// ============================================================================
// Public API
// ============================================================================

const MAX_RECOMMENDATIONS = 5;

/**
 * Generate technique recommendations from pipeline evidence gaps.
 *
 * @param evidenceGaps - From pipeline output (factor_sensitivity, node confidence, etc.)
 * @param dominantDriverId - From pipeline factor_sensitivity (highest influence factor), nullable
 * @param options.provisional - true if emitted before full pipeline evidence
 * @returns TechniqueRecommendation[] — max 5, deduped by factor_id
 */
export function recommendTechniques(
  evidenceGaps: EvidenceGap[],
  dominantDriverId?: string | null,
  options?: { provisional?: boolean },
): TechniqueRecommendation[] {
  if (evidenceGaps.length === 0) return [];

  const provisional = options?.provisional ?? false;

  // Sort: descending voi (if present), else ascending confidence, then factor_label for determinism
  const sorted = [...evidenceGaps].sort((a, b) => {
    if (a.voi != null && b.voi != null) {
      const voiDiff = b.voi - a.voi;
      if (voiDiff !== 0) return voiDiff;
    } else if (a.voi != null) return -1;
    else if (b.voi != null) return 1;
    const ca = a.confidence ?? 1;
    const cb = b.confidence ?? 1;
    const confDiff = ca - cb;
    if (confDiff !== 0) return confDiff;
    return a.factor_label.localeCompare(b.factor_label);
  });

  // One recommendation per factor, max 5
  const seen = new Set<string>();
  const results: TechniqueRecommendation[] = [];

  for (const gap of sorted) {
    if (results.length >= MAX_RECOMMENDATIONS) break;
    const key = gap.factor_id.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);

    const match = matchTechnique(gap, dominantDriverId);

    // Validate claim exists in bundle (if loaded)
    const claim = getClaimById(match.claimId);
    if (!claim && getAllByType('claim').length > 0) {
      log.warn(
        { claim_id: match.claimId, factor_id: gap.factor_id },
        "DSK coaching: technique claim_id not found in loaded bundle",
      );
    }

    // Use bundle evidence_strength if available
    const evidenceStrength: 'strong' | 'medium' =
      claim && (claim.evidence_strength === 'strong' || claim.evidence_strength === 'medium')
        ? claim.evidence_strength
        : match.evidenceStrength;

    const protocolId = resolveProtocolId(match.claimId);

    // Validate protocol exists (if resolved and bundle loaded)
    if (protocolId) {
      const proto = getProtocolById(protocolId);
      if (!proto && getAllByType('protocol').length > 0) {
        log.warn(
          { protocol_id: protocolId, claim_id: match.claimId },
          "DSK coaching: resolved protocol_id not found in loaded bundle",
        );
      }
    }

    results.push({
      id: computeTechniqueId(gap.factor_id, match.claimId),
      factor_id: gap.factor_id,
      factor_label: gap.factor_label,
      technique_label: match.techniqueLabel,
      claim_id: match.claimId,
      protocol_id: protocolId,
      evidence_strength: evidenceStrength,
      one_line_guidance: match.guidanceTemplate,
      provisional,
      surface_targets: provisional ? ['pre_analysis_panel'] : ['evidence_gap_card'],
    });
  }

  return results;
}
