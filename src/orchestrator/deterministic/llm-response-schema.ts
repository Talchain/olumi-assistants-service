/**
 * LLM JSON Response Schema
 *
 * Zod schema for validating the JSON output from the deterministic LLM contract.
 * The LLM returns { text, insights[], recommended_actions[] }.
 */

import { z } from "zod";
import { ACTION_NAMES } from "./actions/types.js";

// ============================================================================
// Insight Schema
// ============================================================================

export const InsightSchema = z.object({
  type: z.enum(['observation', 'suggestion', 'warning', 'question']),
  description: z.string().min(1),
  severity: z.enum(['info', 'medium', 'high']).optional(),
  target_id: z.string().optional(),
  science_concept: z.string().optional(),
});

// ============================================================================
// Recommended Action Schema
// ============================================================================

export const RecommendedActionSchema = z.object({
  action_type: z.string().min(1),
  target_id: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
  rationale: z.string().optional(),
});

// ============================================================================
// Full LLM Response Schema
// ============================================================================

export const LLMResponseSchema = z.object({
  text: z.string().min(1),
  insights: z.array(InsightSchema).max(5).default([]),
  recommended_actions: z.array(RecommendedActionSchema).max(4).default([]),
});

export type ValidatedLLMResponse = z.infer<typeof LLMResponseSchema>;
