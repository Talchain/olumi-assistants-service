/**
 * Context Types for Orchestrator
 *
 * Compact representations for LLM context window management.
 * Full graph is sent to PLoT; compact graph is for LLM context only.
 */

import type { ObservedStateV3T } from '../../schemas/cee-v3.js';

// ============================================================================
// Compact Graph (for LLM context, not for PLoT)
// ============================================================================

export interface CompactNode {
  id: string;
  label: string;
  kind: string;
}

export interface CompactEdge {
  from: string;
  to: string;
  strength_mean: number;
  exists_probability: number;
}

export interface GraphV3Compact {
  nodes: CompactNode[];
  edges: CompactEdge[];
}

// ============================================================================
// Analysis Response Summary (for LLM context, not full response)
// ============================================================================

export interface OptionSummary {
  label: string;
  win_probability: number;
}

export interface DriverSummary {
  label: string;
  elasticity: number;
  direction: string;
}

export interface AnalysisResponseSummary {
  winner: string | null;
  option_probabilities: OptionSummary[];
  top_drivers: DriverSummary[];
  robustness_level: string | null;
  constraint_joint_probability: number | null;
}

// ============================================================================
// Edit Compact Graph (for edit_graph LLM prompt — more fields than CompactGraph)
// ============================================================================

export interface EditCompactNode {
  id: string;
  label: string;
  kind: string;
  category?: string;
  description?: string;
  observed_state?: Pick<ObservedStateV3T,
    'value' | 'raw_value' | 'baseline' | 'unit' | 'cap' | 'source' |
    'extractionType' | 'factor_type' | 'uncertainty_drivers' | 'std' | 'confidence'>;
  /** Existing explicit frame, never inferred from one observed pair. */
  scale_frame?: number;
  encoding_map?: Record<string, string>;
  factor_type?: string;
  uncertainty_drivers?: string[];
  is_baseline?: boolean;
  /** NodeV3's existing mirror also permits scalar/partial legacy entries. */
  interventions?: Record<string, unknown>;
}

export interface EditCompactEdge {
  from: string;
  to: string;
  label?: string;
  strength_mean: number;
  strength_std: number;
  exists_probability: number;
  effect_direction: string;
}

export interface EditCompactGraph {
  nodes: EditCompactNode[];
  edges: EditCompactEdge[];
}

// ============================================================================
// Token Budget
// ============================================================================

export interface TokenBudget {
  total: number;
  system_prompt: number;
  tools: number;
  graph: number;
  analysis: number;
  conversation: number;
  buffer: number;
}
