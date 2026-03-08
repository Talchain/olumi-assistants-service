/**
 * DSK Coaching Assembly
 *
 * Single entry point that orchestrates bias alerts + technique recommendations
 * into a DskCoachingItems payload for the response envelope.
 *
 * Pre-model (frame/ideate, before graph):
 *   - Bias alerts only. No technique recommendations.
 *   - Technique recommendations require richer evidence from the pipeline.
 *
 * Post-model (after draft_graph with pipeline evidence):
 *   - Bias alerts from BIL dsk_cues.
 *   - Technique recommendations from pipeline evidence gaps.
 *
 * Returns undefined when:
 *   - DSK_COACHING_ENABLED is false
 *   - Both arrays are empty (omit-empty contract)
 */

import { config } from "../../config/index.js";
import type { BriefIntelligence } from "../../schemas/brief-intelligence.js";
import { BIL_CONTRACT_VERSION } from "../../schemas/brief-intelligence.js";
import type { DskCoachingItems } from "../../schemas/dsk-coaching.js";
import { DSK_COACHING_CONTRACT_VERSION, DskCoachingItemsPayload } from "../../schemas/dsk-coaching.js";
import { formatBiasAlerts } from "./bias-alerts.js";
import { recommendTechniques } from "./technique-recommendations.js";
import type { EvidenceGap } from "./technique-recommendations.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Public API
// ============================================================================

/**
 * Assemble deterministic DSK coaching items.
 *
 * @param bil - BriefIntelligence payload from BIL extraction
 * @param stage - 'pre_model' (frame/ideate) or 'post_model' (after draft_graph)
 * @param pipelineEvidenceGaps - Pipeline evidence gaps (post-model only)
 * @param dominantDriverId - Highest-influence factor from pipeline (post-model only)
 * @param options.confidenceThreshold - Minimum bias alert confidence (default 0.7)
 * @returns DskCoachingItems or undefined if disabled / empty
 */
export function assembleDskCoachingItems(
  bil: BriefIntelligence,
  stage: 'pre_model' | 'post_model',
  pipelineEvidenceGaps?: EvidenceGap[],
  dominantDriverId?: string | null,
  options?: { confidenceThreshold?: number },
): DskCoachingItems | undefined {
  if (!config.features.dskCoachingEnabled) return undefined;

  // Bias alerts — always from BIL dsk_cues
  const biasAlerts = formatBiasAlerts(bil.dsk_cues, options);

  // Technique recommendations — post-model only, from pipeline evidence gaps
  let techniqueRecommendations: DskCoachingItems['technique_recommendations'] = [];
  const gaps = pipelineEvidenceGaps ?? [];

  if (stage === 'post_model' && gaps.length > 0) {
    techniqueRecommendations = recommendTechniques(gaps, dominantDriverId, { provisional: false });
  }
  // Pre-model: no technique recommendations. This is the design rule —
  // technique recommendations require richer evidence from the draft_graph pipeline.

  // Omit-empty by contract
  if (biasAlerts.length === 0 && techniqueRecommendations.length === 0) {
    return undefined;
  }

  const payload: DskCoachingItems = {
    contract_version: DSK_COACHING_CONTRACT_VERSION,
    bias_alerts: biasAlerts,
    technique_recommendations: techniqueRecommendations,
    metadata: {
      bil_version: BIL_CONTRACT_VERSION,
      total_cues_evaluated: bil.dsk_cues.length,
      total_gaps_evaluated: gaps.length,
      alerts_surfaced: biasAlerts.length,
      recommendations_surfaced: techniqueRecommendations.length,
      stage,
    },
  };

  // Validate against schema before returning
  const parsed = DskCoachingItemsPayload.safeParse(payload);
  if (!parsed.success) {
    log.warn(
      { errors: parsed.error.issues.map((i) => i.message) },
      "DSK coaching: assembled payload failed schema validation, omitting",
    );
    return undefined;
  }

  return parsed.data;
}
