/**
 * Context Fabric — Types and Zod Schemas
 *
 * Contracts for the 3-zone cache-aware context assembly pipeline.
 * These types are scoped to the context-fabric module and do not
 * replace or modify existing orchestrator types.
 *
 * Built in isolation — wired into the turn handler in a separate change
 * behind CEE_ORCHESTRATOR_CONTEXT_ENABLED.
 */

import { z } from "zod";

// ============================================================================
// Route & Stage Enums
// ============================================================================

/**
 * Routes that use context assembly.
 * RUN_ANALYSIS is excluded: it's a passthrough to PLoT with no LLM call.
 * Using a const array + z.enum gives both a Zod schema and a TS type
 * that makes getProfile('RUN_ANALYSIS') a compile-time error.
 */
const CONTEXT_FABRIC_ROUTES = ['CHAT', 'DRAFT_GRAPH', 'EDIT_GRAPH', 'EXPLAIN_RESULTS', 'GENERATE_BRIEF'] as const;
export const ContextFabricRouteSchema = z.enum(CONTEXT_FABRIC_ROUTES);
export type ContextFabricRoute = z.infer<typeof ContextFabricRouteSchema>;

const DECISION_STAGES = ['frame', 'ideate', 'evaluate_pre', 'evaluate_post', 'decide', 'optimise'] as const;
export const DecisionStageSchema = z.enum(DECISION_STAGES);
export type DecisionStage = z.infer<typeof DecisionStageSchema>;

// ============================================================================
// Graph & Analysis Summaries
// ============================================================================

export const GraphSummarySchema = z.object({
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  goal_node_id: z.string().nullable(),
  option_node_ids: z.array(z.string()),
  compact_edges: z.string(), // "node_a -> node_b (0.6)" format — IDs only, no labels
});
export type GraphSummary = z.infer<typeof GraphSummarySchema>;

export const DriverSummarySchema = z.object({
  node_id: z.string(),
  sensitivity: z.number(),
  confidence: z.string(),
  fact_id: z.string().optional(),
});
export type DriverSummary = z.infer<typeof DriverSummarySchema>;

export const AnalysisSummarySchema = z.object({
  winner_id: z.string(),
  winner_probability: z.number().min(0).max(1),
  winner_fact_id: z.string().optional(),
  winning_margin: z.number().min(0).max(1),
  margin_fact_id: z.string().optional(),
  robustness_level: z.string(),
  robustness_fact_id: z.string().optional(),
  top_drivers: z.array(DriverSummarySchema),
  fragile_edge_ids: z.array(z.string()),
});
export type AnalysisSummary = z.infer<typeof AnalysisSummarySchema>;

// ============================================================================
// Decision State
// ============================================================================

// TODO: import string length limits from Platform Contract when available

const FramingSchema = z.object({
  goal: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
  brief_text: z.string().optional(),
  stage: DecisionStageSchema,
});
export type Framing = z.infer<typeof FramingSchema>;

export const DecisionStateSchema = z.object({
  // Canonical (system-generated, trusted)
  // CRITICAL: canonical fields contain IDs and numbers ONLY — never user-authored labels/names/text
  graph_summary: GraphSummarySchema.nullable(),
  analysis_summary: AnalysisSummarySchema.nullable(),
  event_summary: z.string(),

  // User-originated (untrusted — wrapped in delimiters at render time)
  framing: FramingSchema.nullable(),
  user_causal_claims: z.array(z.string()),
  unresolved_questions: z.array(z.string()),
});
export type DecisionState = z.infer<typeof DecisionStateSchema>;

// ============================================================================
// Conversation Turn & Tool Output
// ============================================================================

export const ToolOutputSchema = z.object({
  tool_name: z.string(),
  system_fields: z.record(z.unknown()),
  user_originated_fields: z.record(z.unknown()),
}).strict();
export type ToolOutput = z.infer<typeof ToolOutputSchema>;

export const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  tool_outputs: z.array(ToolOutputSchema).optional(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

// ============================================================================
// Route Profile
// ============================================================================

export const RouteProfileSchema = z.object({
  route: ContextFabricRouteSchema,
  max_turns: z.number().int().positive(),
  include_graph_summary: z.boolean(),
  include_full_graph: z.boolean(),
  include_analysis_summary: z.boolean(),
  include_full_analysis: z.boolean(),
  include_archetypes: z.boolean(),
  include_selected_elements: z.boolean(),
  token_budget: z.number().int().positive(),
});
export type RouteProfile = z.infer<typeof RouteProfileSchema>;

// ============================================================================
// Token Budget (zone-based)
// ============================================================================

export interface TokenBudget {
  zone1: number;
  zone2: number;
  zone3: number;
  safety_margin: number;
  effective_total: number;
}

// ============================================================================
// Assembled Context
// ============================================================================

export interface AssembledContext {
  zone1: string;
  zone2: string;
  zone3: string;
  full_context: string;
  estimated_tokens: number;
  context_hash: string;
  profile_used: ContextFabricRoute;
  prompt_version: string;
  budget: TokenBudget;
  within_budget: boolean;
  overage_tokens: number;
  truncation_applied: boolean;
}
