/**
 * LLM JSON Response Schema
 *
 * Zod schema for validating the JSON output from the deterministic LLM contract.
 * The LLM returns { text, insights[], recommended_actions[] }.
 */

import { z } from "zod";
import { ACTION_NAMES } from "./actions/types.js";

// ============================================================================
// Canonical enums
// ============================================================================

export const INSIGHT_TYPES = [
  'bias_detected',
  'missing_perspective',
  'assumption_risk',
  'opportunity',
  'calibration_concern',
  'structural_gap',
] as const;

export const INSIGHT_SEVERITIES = ['info', 'warning', 'important'] as const;

export const PRIORITIES = ['high', 'medium', 'low'] as const;

// ============================================================================
// Insight Schema
// ============================================================================

export const InsightSchema = z.object({
  type: z.enum(INSIGHT_TYPES),
  description: z.string().min(1),
  severity: z.enum(INSIGHT_SEVERITIES),
  target_id: z.string().optional(),
  science_concept: z.string().optional(),
});

// ============================================================================
// Recommended Action Schema
// ============================================================================

const PrioritySchema = z.enum(PRIORITIES);

/** Per-action discriminated union schemas. */
const SetFactorValueSchema = z.object({
  action_type: z.literal('set_factor_value'),
  target_id: z.string(),
  value: z.number(),
  raw_value: z.number().optional(),
  unit: z.string().optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const AddConstraintSchema = z.object({
  action_type: z.literal('add_constraint'),
  target_id: z.string(),
  constraint_type: z.enum(['threshold', 'range']).optional(),
  threshold: z.number(),
  label: z.string(),
  unit: z.string().optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const AddFactorSchema = z.object({
  action_type: z.literal('add_factor'),
  label: z.string(),
  category: z.enum(['controllable', 'observable', 'external']).optional(),
  connect_to: z.array(z.string()).optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const AdjustEdgeStrengthSchema = z.object({
  action_type: z.literal('adjust_edge_strength'),
  from: z.string(),
  to: z.string(),
  strength_mean: z.number().optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const AddOptionSchema = z.object({
  action_type: z.literal('add_option'),
  label: z.string(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const RemoveFactorSchema = z.object({
  action_type: z.literal('remove_factor'),
  target_id: z.string(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const SetGoalTargetSchema = z.object({
  action_type: z.literal('set_goal_target'),
  threshold: z.number(),
  unit: z.string().optional(),
  cap: z.number().optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const RunAnalysisSchema = z.object({
  action_type: z.literal('run_analysis'),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const ExplainResultSchema = z.object({
  action_type: z.literal('explain_result'),
  focus: z.string().optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const CompareOptionsSchema = z.object({
  action_type: z.literal('compare_options'),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const ChallengeAssumptionSchema = z.object({
  action_type: z.literal('challenge_assumption'),
  target_id: z.string().optional(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const RunPremortermSchema = z.object({
  action_type: z.literal('run_premortem'),
  target_id: z.string(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const WhatWouldFlipSchema = z.object({
  action_type: z.literal('what_would_flip'),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

const GenerateArtefactSchema = z.object({
  action_type: z.literal('generate_artefact'),
  artefact_type: z.string(),
  priority: PrioritySchema,
  rationale: z.string().optional(),
});

export const RecommendedActionSchema = z.discriminatedUnion('action_type', [
  SetFactorValueSchema,
  AddConstraintSchema,
  AddFactorSchema,
  AdjustEdgeStrengthSchema,
  AddOptionSchema,
  RemoveFactorSchema,
  SetGoalTargetSchema,
  RunAnalysisSchema,
  ExplainResultSchema,
  CompareOptionsSchema,
  ChallengeAssumptionSchema,
  RunPremortermSchema,
  WhatWouldFlipSchema,
  GenerateArtefactSchema,
]);

// ============================================================================
// Full LLM Response Schema
// ============================================================================

export const LLMResponseSchema = z.object({
  text: z.string().min(1),
  insights: z.array(InsightSchema).max(3).default([]),
  recommended_actions: z.array(RecommendedActionSchema).max(3).default([]),
});

export type ValidatedLLMResponse = z.infer<typeof LLMResponseSchema>;
