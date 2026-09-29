/**
 * DSK Coaching — deterministic science-backed coaching items.
 * Contract owner: CEE
 * Canonical fixture: tools/fixtures/canonical/dsk-coaching.json
 * Shape changes require: version bump + UI type update.
 */

import { z } from "zod";

/**
 * Contract version for the DSK coaching payload shape.
 * Bump on any breaking change. See governance rule in header comment.
 */
export const DSK_COACHING_CONTRACT_VERSION = '1.0.0';

// ============================================================================
// Sub-schemas
// ============================================================================

const Confidence = z.number().min(0).max(1);

/**
 * Where the coaching item should be rendered in the UI.
 * Closed union — new targets require a version bump.
 */
export const SurfaceTargetSchema = z.enum([
  'guidance_panel',
  'pre_analysis_panel',
  'evidence_gap_card',
  'model_tab',
]);
export type SurfaceTarget = z.infer<typeof SurfaceTargetSchema>;

export const BiasAlertSchema = z.object({
  /** Deterministic: sha256('bias:' + lc(bias_type) + ':' + lc(signal)).slice(0,12) */
  id: z.string(),
  bias_type: z.string(),
  /** Reflective question — British English, ends with "?" */
  human_description: z.string(),
  /** Actionable thought prompt */
  suggested_reflection: z.string(),
  /** DSK claim ID if matched, null otherwise. Never fabricated. */
  claim_id: z.string().nullable(),
  /** From DSK bundle if claim matched, null otherwise. */
  evidence_strength: z.enum(['strong', 'medium']).nullable(),
  confidence: Confidence,
  surface_targets: z.array(SurfaceTargetSchema),
});
export type BiasAlert = z.infer<typeof BiasAlertSchema>;

export const TechniqueRecommendationSchema = z.object({
  /** Deterministic: sha256('tech:' + lc(factor_id) + ':' + claim_id).slice(0,12) */
  id: z.string(),
  factor_id: z.string(),
  factor_label: z.string(),
  technique_label: z.string(),
  /** DSK-T-xxx — always present, from hardcoded mapping. */
  claim_id: z.string(),
  /** DSK-P-xxx — nullable. Prefer bundle lookup; hardcoded map as fallback when bundle absent. */
  protocol_id: z.string().nullable(),
  evidence_strength: z.enum(['strong', 'medium']),
  /** British English, one sentence. */
  one_line_guidance: z.string(),
  /** true if emitted before full pipeline evidence is available. */
  provisional: z.boolean(),
  surface_targets: z.array(SurfaceTargetSchema),
});
export type TechniqueRecommendation = z.infer<typeof TechniqueRecommendationSchema>;

const CoachingMetadataSchema = z.object({
  bil_version: z.string(),
  total_cues_evaluated: z.number().int().min(0),
  total_gaps_evaluated: z.number().int().min(0),
  alerts_surfaced: z.number().int().min(0),
  recommendations_surfaced: z.number().int().min(0),
  stage: z.enum(['pre_model', 'post_model']),
});

// ============================================================================
// Main payload
// ============================================================================

export const DskCoachingItemsPayload = z.object({
  contract_version: z.literal(DSK_COACHING_CONTRACT_VERSION),
  bias_alerts: z.array(BiasAlertSchema),
  technique_recommendations: z.array(TechniqueRecommendationSchema),
  metadata: CoachingMetadataSchema,
});

export type DskCoachingItems = z.infer<typeof DskCoachingItemsPayload>;
