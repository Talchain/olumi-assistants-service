/**
 * MoE Spike — Zod schemas for specialist result and comparison payloads.
 *
 * Shadow mode only. Results are never surfaced to users or attached to envelopes.
 * Gated by MOE_SPIKE_ENABLED (default off).
 */

import { z } from "zod";

export const MOE_SPIKE_VERSION = '1.0.0';

// ============================================================================
// Sub-schemas (reuse confidence pattern from brief-intelligence.ts)
// ============================================================================

const Confidence = z.number().min(0).max(1);

const BiasSignalSchema = z.object({
  bias_type: z.string().min(1),
  signal: z.string().min(12),
  claim_id: z.literal(null),
  confidence: Confidence,
});

// ============================================================================
// MoeSpikeResult — returned by the specialist LLM
// ============================================================================

export const MoeSpikeResultPayload = z.object({
  version: z.literal(MOE_SPIKE_VERSION),
  framing_quality: z.enum(['strong', 'moderate', 'weak']),
  diversity_assessment: z.enum(['diverse', 'similar', 'single_lever']),
  stakeholder_completeness: z.enum(['complete', 'partial', 'missing']),
  bias_signals: z.array(BiasSignalSchema).max(3),
  missing_elements: z.array(
    z.enum([
      'goal',
      'constraints',
      'time_horizon',
      'success_metric',
      'status_quo_option',
      'risk_factors',
    ]),
  ),
});

export type MoeSpikeResult = z.infer<typeof MoeSpikeResultPayload>;

// ============================================================================
// MoeSpikeComparison — result of comparing spike with BIL
// ============================================================================

export const MoeSpikeComparisonPayload = z.object({
  version: z.literal(MOE_SPIKE_VERSION),
  brief_hash: z.string(),
  bias_agreed: z.array(z.string()),
  bias_spike_only: z.array(z.string()),
  bias_bil_only: z.array(z.string()),
  framing_agrees: z.boolean(),
  diversity_agrees: z.boolean(),
  missing_elements_spike_only: z.array(z.string()),
  missing_elements_bil_only: z.array(z.string()),
  spike_bias_count: z.number().int().min(0),
  bil_bias_count: z.number().int().min(0),
  verdict: z.enum(['spike_adds_value', 'spike_worse', 'equivalent']),
});

export type MoeSpikeComparison = z.infer<typeof MoeSpikeComparisonPayload>;
