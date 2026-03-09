/**
 * Brief Intelligence Layer — canonical upstream intelligence from decision brief.
 * Contract owner: CEE
 * UI mirrors this type for local preview.
 * Canonical fixture: tools/fixtures/canonical/brief-intelligence.json
 * Shape changes require: version bump + UI type update + ablation retest.
 */

import { z } from "zod";

/**
 * Contract version for the Brief Intelligence Layer payload shape.
 * Bump on any breaking change. See governance rule in header comment.
 */
export const BIL_CONTRACT_VERSION = '1.1.0';

// ============================================================================
// Sub-schemas
// ============================================================================

const Confidence = z.number().min(0).max(1);

const GoalSchema = z.object({
  label: z.string(),
  measurable: z.boolean(),
  confidence: Confidence,
});

const OptionSchema = z.object({
  label: z.string(),
  confidence: Confidence,
});

const ConstraintType = z.enum(['hard_limit', 'success_condition', 'guardrail']);

const ConstraintSchema = z.object({
  label: z.string(),
  type: ConstraintType,
  confidence: Confidence,
});

const FactorSchema = z.object({
  label: z.string(),
  confidence: Confidence,
});

const MissingElement = z.enum([
  'goal',
  'constraints',
  'time_horizon',
  'success_metric',
  'status_quo_option',
  'risk_factors',
]);

const DskCueSchema = z.object({
  bias_type: z.string(),
  signal: z.string(),
  claim_id: z.string().nullable(),
  confidence: Confidence,
});

// ============================================================================
// Main payload
// ============================================================================

export const BriefIntelligencePayload = z.object({
  contract_version: z.literal(BIL_CONTRACT_VERSION),
  goal: GoalSchema.nullable(),
  options: z.array(OptionSchema),
  constraints: z.array(ConstraintSchema),
  factors: z.array(FactorSchema),
  completeness_band: z.enum(['low', 'medium', 'high']),
  causal_framing_score: z.enum(['strong', 'moderate', 'weak']),
  specificity_score: z.enum(['specific', 'moderate', 'vague']),
  ambiguity_flags: z.array(z.string()),
  missing_elements: z.array(MissingElement),
  dsk_cues: z.array(DskCueSchema),
});

export type BriefIntelligence = z.infer<typeof BriefIntelligencePayload>;
