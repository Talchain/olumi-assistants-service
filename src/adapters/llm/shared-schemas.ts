/**
 * Shared Zod Schemas for LLM Adapter Responses
 *
 * These schemas define the common response structures used by both
 * Anthropic and OpenAI adapters. Provider-specific extensions can
 * use .extend() or .merge() on these base schemas.
 */

import { z } from "zod";
import { ProvenanceSource, NodeKind, StructuredProvenance, NodeData, FactorCategory } from "../../schemas/graph.js";

// ============================================================================
// Base Node Schema
// ============================================================================

/**
 * Base schema for graph nodes returned by LLM.
 * Used by both Anthropic and OpenAI adapters.
 */
export const LLMNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
  // Factor category (V12.4+): controllable, observable, external
  category: FactorCategory.optional(),
  // Node data depends on kind: FactorData for factors, OptionData (interventions) for options
  data: NodeData.optional(),
});

export type LLMNodeT = z.infer<typeof LLMNode>;

// ============================================================================
// Edge Strength Schema (V4 format)
// ============================================================================

/**
 * V4 edge strength schema (nested object from LLM).
 * Represents probabilistic edge strength with mean and standard deviation.
 */
export const EdgeStrength = z.object({
  mean: z.number(),
  std: z.number().positive(),
}).optional();

export type EdgeStrengthT = z.infer<typeof EdgeStrength>;

// ============================================================================
// Base Edge Schema
// ============================================================================

/**
 * Base schema for graph edges returned by LLM.
 * Supports both V4 format (strength object) and legacy format (weight).
 */
export const LLMEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  // V4 format (preferred) - from v4 prompt (nested)
  strength: EdgeStrength,
  exists_probability: z.number().min(0).max(1).optional(),
  // V4 format (flat) - added by normaliseDraftResponse()
  strength_mean: z.number().optional(),
  strength_std: z.number().optional(),
  belief_exists: z.number().optional(),
  effect_direction: z.enum(["positive", "negative"]).optional(),
  // Legacy format (deprecated, for backwards compatibility during transition)
  weight: z.number().optional(),
  belief: z.number().min(0).max(1).optional(),
  provenance: StructuredProvenance.optional(),
  provenance_source: ProvenanceSource.optional(),
});

export type LLMEdgeT = z.infer<typeof LLMEdge>;

// ============================================================================
// Draft Response Schema
// ============================================================================

/**
 * Schema for draft graph responses from LLM.
 * Contains nodes, edges, and optional rationales.
 */
export const LLMDraftResponse = z.object({
  nodes: z.array(LLMNode),
  edges: z.array(LLMEdge),
  rationales: z.array(z.object({ target: z.string(), why: z.string() })).optional(),
});

export type LLMDraftResponseT = z.infer<typeof LLMDraftResponse>;

// ============================================================================
// Options Response Schema
// ============================================================================

/**
 * Schema for options/suggestions responses from LLM.
 */
export const LLMOptionsResponse = z.object({
  options: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(3),
      pros: z.array(z.string()).min(2).max(3),
      cons: z.array(z.string()).min(2).max(3),
      evidence_to_gather: z.array(z.string()).min(2).max(3),
    })
  ),
});

export type LLMOptionsResponseT = z.infer<typeof LLMOptionsResponse>;

// ============================================================================
// Clarify Response Schema
// ============================================================================

/**
 * Schema for clarification question responses from LLM.
 */
export const LLMClarifyResponse = z.object({
  questions: z.array(
    z.object({
      question: z.string().min(10),
      choices: z.array(z.string()).optional(),
      why_we_ask: z.string().min(20),
      impacts_draft: z.string().min(20),
    })
  ).min(1).max(5),
  confidence: z.number().min(0).max(1),
  should_continue: z.boolean(),
});

export type LLMClarifyResponseT = z.infer<typeof LLMClarifyResponse>;

// ============================================================================
// Critique Response Schema (Anthropic-specific but exported for reuse)
// ============================================================================

/**
 * Schema for graph critique responses from LLM.
 */
export const LLMCritiqueResponse = z.object({
  issues: z.array(
    z.object({
      level: z.enum(["BLOCKER", "IMPROVEMENT", "OBSERVATION"]),
      note: z.string().min(10).max(280),
      target: z.string().optional(),
    })
  ),
  suggested_fixes: z.array(z.string()).max(5),
  overall_quality: z.enum(["poor", "fair", "good", "excellent"]).optional(),
});

export type LLMCritiqueResponseT = z.infer<typeof LLMCritiqueResponse>;

// ============================================================================
// ExplainDiff Response Schema (Anthropic-specific but exported for reuse)
// ============================================================================

/**
 * Schema for explaining differences between graphs.
 */
export const LLMExplainDiffResponse = z.object({
  rationales: z.array(
    z.object({
      target: z.string().min(1),
      why: z.string().min(10).max(280),
      provenance_source: z.string().optional(),
    })
  ).min(1),
});

export type LLMExplainDiffResponseT = z.infer<typeof LLMExplainDiffResponse>;
