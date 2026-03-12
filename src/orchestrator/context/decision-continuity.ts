/**
 * Decision Continuity
 *
 * Builds a compact, structured summary of the current decision state for Zone 2.
 * Populated entirely from signals already present in EnrichedContext — no new
 * data dependencies, no LLM calls, no scoring logic invented here.
 */

import type { GraphV3Compact } from "./graph-compact.js";
import type { AnalysisResponseSummary } from "./analysis-compact.js";

// ============================================================================
// Types
// ============================================================================

export interface DecisionContinuity {
  goal: string | null;
  options: string[];
  constraints: string[];
  stage: string;
  graph_version: string | null;
  analysis_status: 'none' | 'current' | 'stale';
  top_drivers: string[];
  top_uncertainties: string[];
  last_patch_summary: string | null;
  active_proposal: string | null;
  assumption_count: number;
}

// ============================================================================
// Structural subset of EnrichedContext consumed here
// Avoids circular dependency with pipeline/types.ts.
// ============================================================================

export interface DecisionContinuityInput {
  framing?: {
    stage?: string;
    goal?: string;
    constraints?: string[];
    options?: string[];
  } | null;
  graph_compact?: GraphV3Compact | null;
  analysis_response?: AnalysisResponseSummary | null;
  context_hash?: string | null;
  // Raw graph/analysis for stale-check comparisons
  graph?: { hash?: unknown; [k: string]: unknown } | null;
  analysis?: { graph_hash?: unknown; [k: string]: unknown } | null;
  // Conversational state for pending clarification / pending proposal
  conversational_state?: {
    pending_clarification?: { original_edit_request?: string } | null;
    pending_proposal?: { original_edit_request?: string } | null;
    stated_constraints?: Array<{ label?: string; text?: string } | unknown>;
  } | null;
  // Conversation messages — look for most recent patch summary in blocks
  conversation_history?: Array<{
    role?: string;
    content?: string;
    blocks?: Array<{
      type?: string;
      data?: { summary?: string; patch_type?: string };
    }>;
  }>;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Determine analysis_status by comparing graph hash to analysis's source graph hash.
 * Returns 'none' when no analysis exists, 'stale' when hashes differ (and both are
 * present), 'current' otherwise (including when comparison is not possible).
 */
function deriveAnalysisStatus(
  graph: DecisionContinuityInput['graph'],
  analysis: DecisionContinuityInput['analysis'],
  analysisResponse: AnalysisResponseSummary | null | undefined,
): 'none' | 'current' | 'stale' {
  if (!analysisResponse) return 'none';

  // Attempt hash comparison using the same convention as pipeline.ts hasStaleAnalysisState
  const graphHash = typeof graph?.hash === 'string' ? graph.hash : null;
  const analysisSourceHash = typeof analysis?.graph_hash === 'string' ? analysis.graph_hash : null;

  if (graphHash !== null && analysisSourceHash !== null) {
    return graphHash !== analysisSourceHash ? 'stale' : 'current';
  }

  // Cannot compare — default to 'current' (graceful)
  return 'current';
}

/**
 * Extract top uncertainties from compact graph.
 * Factors with lowest exists_probability on outgoing edges or highest std (if available).
 * Uses edges only — no new scoring logic required.
 */
function deriveTopUncertainties(graphCompact: GraphV3Compact | null | undefined): string[] {
  if (!graphCompact || graphCompact.edges.length === 0) return [];

  // Collect minimum exists_probability per "from" node id
  const minExistsByNode = new Map<string, number>();
  for (const edge of graphCompact.edges) {
    const current = minExistsByNode.get(edge.from);
    if (current === undefined || edge.exists < current) {
      minExistsByNode.set(edge.from, edge.exists);
    }
  }

  if (minExistsByNode.size === 0) return [];

  // Sort by min exists ascending (lowest = most uncertain)
  const sorted = Array.from(minExistsByNode.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);

  // Map node_id → label
  const labelById = new Map(graphCompact.nodes.map((n) => [n.id, n.label]));

  return sorted
    .map(([nodeId]) => labelById.get(nodeId) ?? nodeId)
    .filter(Boolean);
}

/**
 * Find the most recent patch summary from conversation_history blocks.
 * Looks backwards through messages for the latest graph_patch block with a summary.
 */
function deriveLastPatchSummary(
  history: DecisionContinuityInput['conversation_history'],
): string | null {
  if (!history || history.length === 0) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!Array.isArray(msg.blocks)) continue;
    for (const block of msg.blocks) {
      if (block.type === 'graph_patch' && typeof block.data?.summary === 'string' && block.data.summary.length > 0) {
        return block.data.summary;
      }
    }
  }
  return null;
}

/**
 * Derive constraints from framing or stated_constraints.
 * Prefers framing.constraints (structured), falls back to conversational_state.stated_constraints.
 */
function deriveConstraints(input: DecisionContinuityInput): string[] {
  if (input.framing?.constraints && input.framing.constraints.length > 0) {
    return input.framing.constraints;
  }
  const stated = input.conversational_state?.stated_constraints;
  if (Array.isArray(stated) && stated.length > 0) {
    return stated.map((c) => {
      const obj = c as Record<string, unknown>;
      return typeof obj.label === 'string' ? obj.label
        : typeof obj.text === 'string' ? obj.text
        : String(c);
    }).filter(Boolean);
  }
  return [];
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Build a DecisionContinuity object from an enriched context.
 *
 * Safe to call with a minimal context (no graph, no analysis) — returns
 * null/empty fields gracefully without throwing.
 */
export function buildDecisionContinuity(input: DecisionContinuityInput): DecisionContinuity {
  const framing = input.framing;
  const graphCompact = input.graph_compact;
  const analysisResponse = input.analysis_response;

  // goal: goal node label from compact graph (kind==='goal'), fallback framing.goal
  let goal: string | null = null;
  if (graphCompact) {
    const goalNode = graphCompact.nodes.find((n) => n.kind === 'goal');
    if (goalNode) goal = goalNode.label;
  }
  if (!goal && framing?.goal) {
    goal = framing.goal;
  }

  // options: option node labels from compact graph, fallback framing.options
  let options: string[] = [];
  if (graphCompact) {
    const optionNodes = graphCompact.nodes.filter((n) => n.kind === 'option');
    if (optionNodes.length > 0) {
      options = optionNodes.map((n) => n.label);
    }
  }
  if (options.length === 0 && framing?.options && framing.options.length > 0) {
    options = framing.options;
  }

  // constraints
  const constraints = deriveConstraints(input);

  // stage
  const stage = framing?.stage ?? 'explore';

  // graph_version: the graph's own hash (structural identity), not the context hash.
  // Falls back to null when the graph or its hash is absent.
  const graph_version = typeof input.graph?.hash === 'string' ? input.graph.hash : null;

  // analysis_status
  const analysis_status = deriveAnalysisStatus(input.graph, input.analysis, analysisResponse);

  // top_drivers: top 3 factor labels from compact analysis sensitivity
  const top_drivers: string[] = analysisResponse
    ? analysisResponse.top_drivers.slice(0, 3).map((d) => d.factor_label)
    : [];

  // top_uncertainties: factors with lowest exists_probability
  const top_uncertainties = deriveTopUncertainties(graphCompact);

  // last_patch_summary: from conversation history
  const last_patch_summary = deriveLastPatchSummary(input.conversation_history);

  // active_proposal: from pending_proposal or pending_clarification
  let active_proposal: string | null = null;
  const pendingProposal = input.conversational_state?.pending_proposal;
  const pendingClarification = input.conversational_state?.pending_clarification;
  if (pendingProposal && typeof pendingProposal.original_edit_request === 'string') {
    active_proposal = pendingProposal.original_edit_request;
  } else if (pendingClarification && typeof pendingClarification.original_edit_request === 'string') {
    active_proposal = pendingClarification.original_edit_request;
  }

  // assumption_count: compact nodes where source === 'assumption'
  // CompactNode.source is CompactNodeSource | undefined; 'assumption' is a valid member
  const assumption_count = graphCompact
    ? graphCompact.nodes.filter((n) => n.source === 'assumption').length
    : 0;

  return {
    goal,
    options,
    constraints,
    stage,
    graph_version,
    analysis_status,
    top_drivers,
    top_uncertainties,
    last_patch_summary,
    active_proposal,
    assumption_count,
  };
}
