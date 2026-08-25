/**
 * Context Types for Orchestrator
 *
 * Compact representations for LLM context window management.
 * Full graph is sent to PLoT; compact graph is for LLM context only.
 */

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

// ============================================================================
// Conversation Summary (shared prompt projection)
// ============================================================================

/**
 * Read-only projection of the persisted rolling summary into an LLM prompt.
 *
 * This type lives in the shared context layer because both the V5 coaching
 * ContextPack and the V4 edit/repair context consume the exact same projected
 * bytes. Keeping one structural authority prevents the two prompt paths from
 * drifting on watermark, lag, or stale-disclosure semantics.
 */
export interface ConversationSummaryContext {
  /** Four-slot FRAME / CONSTRAINTS / RESOLVED / OPEN text, or empty on refusal. */
  readonly text: string;
  /** Newest committed turn absorbed by the stored summary. */
  readonly current_to_turn_id: string;
  /** Committed turns after the watermark. */
  readonly lag_turns: number;
  /** Whether the summary is stale or otherwise degraded. */
  readonly stale: boolean;
  /** In-band disclosure for stale, floor, or withheld summary states. */
  readonly note?: string;
}
