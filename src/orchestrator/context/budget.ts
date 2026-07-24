/**
 * Token Budget Calculator + a PATHOLOGICAL-INPUT SAFETY VALVE (ROADMAP 1.199, P5).
 *
 * ⚠ WHAT THIS IS — the honest label (budget-honesty, Q5). `enforceContextBudget`
 * is NOT the per-turn context-shaping policy. On the LIVE V5 seam
 * (context-budget-enforcement.ts:126) it is handed ONLY `graph_compact` +
 * `analysis_response`, and it only trims those two sections when a graph/analysis
 * is pathologically large — a coarse backstop against an oversized compact graph,
 * not the mechanism that shapes a normal turn. The real per-turn shaping is the
 * ENFORCED per-section budgets declared in the CONTEXT_POLICY (the 4000-char
 * `display_analysis` cut, the brief caps) — see
 * orchestrator-v5/context/context-policy.ts.
 *
 * The former 5→3→1 CONVERSATION-trim ladder was DELETED here (P5): it was wired
 * to NOTHING on the live seam — the only caller passes no `messages`
 * (context-budget-enforcement.ts:129-131, its `AssemblyEnforcementContext`
 * carries no messages field), and the V1/V4 routes that once passed a
 * conversation are dead. Dead code that reads as a live backstop is the
 * guarantee-theatre class (platform CLAUDE.md — the "dead ceiling masquerading
 * as the live policy" defect); it is removed rather than left as a false valve.
 * The live conversation-window bound is the verbatim-turns cap
 * (CONTEXT_PACK_RECENT_TURNS_CAP), declared in the policy's `memory_window`.
 *
 * calculateTokenBudget below is a general token-allocation CALCULATOR (still
 * used for the graph/analysis sub-budgets); its allocations name all sections
 * for completeness, but `enforceContextBudget` acts on graph + analysis only.
 *
 * Heuristic: 4 chars per token (sufficient for PoC).
 */

import { env } from "node:process";
import type { TokenBudget } from "./types.js";
import type { GraphV3Compact } from "./graph-compact.js";
import type { AnalysisResponseSummary } from "./analysis-compact.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Constants
// ============================================================================

/** Default context window for Claude models */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Characters per token heuristic */
const CHARS_PER_TOKEN = 4;

/** Budget allocation percentages */
const BUDGET_ALLOCATION = {
  system_prompt: 0.10,
  tools: 0.10,
  graph: 0.25,
  analysis: 0.15,
  conversation: 0.30,
  buffer: 0.10,
} as const;

// ============================================================================
// Budget Calculation
// ============================================================================

/**
 * Calculate token budget allocation.
 *
 * @param contextWindowTokens - Total context window in tokens (default: 200K)
 * @returns Token budget with allocations for each section
 */
export function calculateTokenBudget(
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW,
): TokenBudget {
  return {
    total: contextWindowTokens,
    system_prompt: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.system_prompt),
    tools: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.tools),
    graph: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.graph),
    analysis: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.analysis),
    conversation: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.conversation),
    buffer: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.buffer),
  };
}

/**
 * Estimate token count from a string using character heuristic.
 * ~4 characters per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check if a string fits within a token budget.
 */
export function fitsInBudget(text: string, budgetTokens: number): boolean {
  return estimateTokens(text) <= budgetTokens;
}

/**
 * Estimate token count from an arbitrary value using JSON serialisation.
 * Falls back to 0 for null/undefined.
 */
function estimateTokensForValue(value: unknown): number {
  if (value == null) return 0;
  return Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
}

// ============================================================================
// Budget Enforcement Context Shape
// ============================================================================

/**
 * The subset of EnrichedContext fields this safety valve manages.
 * `enforceContextBudget` operates on the COMPACT graph/analysis representations
 * ONLY — never on the conversation window (that is the O-2 / rolling-summary
 * lane's surface; the verbatim-turns cap in the CONTEXT_POLICY bounds it). The
 * former `messages` / `event_log_summary` fields were removed with the dead
 * conversation-trim ladder (P5) — they were consumed by nothing else.
 */
export interface BudgetEnforcementContext {
  // Compact graph — may be trimmed if pathologically over budget
  graph_compact?: GraphV3Compact | null;
  // Compact analysis summary — may be trimmed if pathologically over budget
  analysis_response?: AnalysisResponseSummary | null;
  // Pass-through fields (not touched by this safety valve)
  [key: string]: unknown;
}

// ============================================================================
// Budget Enforcement
// ============================================================================

/**
 * Default context budget (120k tokens — reserves ~80k for response + system prompt overhead
 * within a 200k context window). Configurable via ORCHESTRATOR_CONTEXT_BUDGET env var.
 */
const DEFAULT_CONTEXT_BUDGET = 120_000;

function getMaxTokens(): number {
  const raw = env.ORCHESTRATOR_CONTEXT_BUDGET;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CONTEXT_BUDGET;
}

/**
 * Node trim helpers — applied in priority order.
 * All helpers operate on a shallow copy; missing fields are silently skipped.
 *
 * Trim order (low-value first, user-visible state preserved as long as possible):
 *   Pass 1: plain_interpretation on edges (convenience text, raw numbers still exist)
 *   Pass 1b: uncertainty_drivers, extractionType, factor_type  (no-op on CompactNode — dropped at compaction)
 *   Pass 2: type, category, intervention_summary
 *   Pass 2b: raw_value, cap on external-factor nodes (prior-range representation)
 *   Pass 3: source provenance
 * Edge trim (separate pass after all node passes):
 *   Pass 4: drop exists field from edges (preserve graph structure — never delete edges)
 * Preserved throughout: label, value, unit
 */

/**
 * Drop plain_interpretation from all edges (pass 1 — first to go).
 * The raw strength numbers still exist on the edge.
 */
function trimCompactEdgePlainInterpretation(edge: GraphV3Compact['edges'][number]): GraphV3Compact['edges'][number] {
  const e = { ...edge } as unknown as Record<string, unknown>;
  delete e['plain_interpretation'];
  return e as unknown as GraphV3Compact['edges'][number];
}

function trimCompactNodeTier1(node: GraphV3Compact['nodes'][number]): GraphV3Compact['nodes'][number] {
  const n = { ...node } as unknown as Record<string, unknown>;
  // These fields were already dropped during compaction; kept explicit for forward-compat.
  delete n['uncertainty_drivers'];
  delete n['extractionType'];
  delete n['factor_type'];
  return n as unknown as GraphV3Compact['nodes'][number];
}

function trimCompactNodeTier2(node: GraphV3Compact['nodes'][number]): GraphV3Compact['nodes'][number] {
  // Drop type, category, intervention_summary (less user-visible than label/value)
  const n = { ...node } as unknown as Record<string, unknown>;
  delete n['type'];
  delete n['category'];
  delete n['intervention_summary'];
  return n as unknown as GraphV3Compact['nodes'][number];
}

/**
 * Drop prior-range fields (raw_value, cap) from external factor nodes.
 * External nodes have no controlled value — raw_value/cap represent range estimates only.
 * Controllable/observable nodes keep their raw_value for context.
 */
function trimCompactNodePriorRanges(node: GraphV3Compact['nodes'][number]): GraphV3Compact['nodes'][number] {
  if (node.category === 'external') {
    const n = { ...node } as unknown as Record<string, unknown>;
    delete n['raw_value'];
    delete n['cap'];
    return n as unknown as GraphV3Compact['nodes'][number];
  }
  return node;
}

function trimCompactNodeTier3(node: GraphV3Compact['nodes'][number]): GraphV3Compact['nodes'][number] {
  // Drop source provenance (metadata, not user-visible state)
  const n = { ...node } as unknown as Record<string, unknown>;
  delete n['source'];
  return n as unknown as GraphV3Compact['nodes'][number];
}

/**
 * Drop the exists field from all edges (pass 4).
 * Preserves graph structure (no edges deleted) while reducing token count.
 */
function trimCompactEdgeExists(edge: GraphV3Compact['edges'][number]): GraphV3Compact['edges'][number] {
  const e = { ...edge } as unknown as Record<string, unknown>;
  delete e['exists'];
  return e as unknown as GraphV3Compact['edges'][number];
}

/**
 * Pathological-input safety valve for the COMPACT graph/analysis sections.
 *
 * Trims ONLY `graph_compact` and `analysis_response` when they are
 * pathologically large. It does NOT shape the conversation window (the 5→3→1
 * conversation-trim ladder was deleted in P5 — it was dead on the live seam;
 * the verbatim-turns cap in the CONTEXT_POLICY bounds the window instead).
 *
 * Trimming behaviour (graph — preserves user-visible state as long as possible):
 * - Pass 1: drop plain_interpretation from edges (convenience text, raw numbers remain)
 * - Pass 1b: drop uncertainty_drivers, extractionType, factor_type (no-op on compact nodes)
 * - Pass 2: drop type, category, intervention_summary from nodes
 * - Pass 2b: drop raw_value, cap from external-factor nodes (prior ranges)
 * - Pass 3: drop source provenance from nodes
 * - Pass 4: drop exists field from edges (preserves graph structure — no edges deleted)
 * - Preserve throughout: label, value, unit
 *
 * Analysis trimming:
 * - Drop constraint_tensions, reduce top_drivers to 3
 *
 * This function NEVER throws. On any error, it logs and returns the context unchanged.
 *
 * @param context - The enriched context to enforce budget on
 * @param maxTokens - Maximum tokens (default: ORCHESTRATOR_CONTEXT_BUDGET env or 120000)
 * @returns A new context object with the same shape but potentially trimmed
 */
export function enforceContextBudget<T extends BudgetEnforcementContext>(
  context: T,
  maxTokens: number = getMaxTokens(),
): T {
  if (context == null) {
    log.error({ context }, 'enforceContextBudget: null/undefined context — returning unchanged');
    return context;
  }

  try {
    const budget = calculateTokenBudget(maxTokens);

    // Work on a shallow copy to avoid mutation
    let result: T = { ...context };

    // --- Graph budget enforcement (operates on graph_compact, not raw graph) ---
    if (result.graph_compact) {
      const graphTokens = estimateTokensForValue(result.graph_compact);
      if (graphTokens > budget.graph) {
        log.warn(
          { graphTokens, graphBudget: budget.graph },
          'enforceContextBudget: graph over budget — pass 1 trim (plain_interpretation on edges)',
        );
        // Pass 1: drop plain_interpretation from edges (convenience text, raw numbers remain)
        let trimmedGraph: GraphV3Compact = {
          ...result.graph_compact,
          nodes: result.graph_compact.nodes,
          edges: result.graph_compact.edges.map(trimCompactEdgePlainInterpretation),
          _node_count: result.graph_compact._node_count,
          _edge_count: result.graph_compact._edge_count,
        };

        // Pass 1b: drop low-value metadata fields (no-op on current CompactNode shape)
        if (estimateTokensForValue(trimmedGraph) > budget.graph) {
          log.warn(
            { graphBudget: budget.graph },
            'enforceContextBudget: graph still over budget — pass 1b trim (low-value metadata)',
          );
          trimmedGraph = {
            ...trimmedGraph,
            nodes: trimmedGraph.nodes.map(trimCompactNodeTier1),
          };
        }

        // Pass 2: still over budget — drop type, category
        if (estimateTokensForValue(trimmedGraph) > budget.graph) {
          log.warn(
            { graphBudget: budget.graph },
            'enforceContextBudget: graph still over budget — pass 2 trim (type, category)',
          );
          trimmedGraph = {
            ...trimmedGraph,
            nodes: trimmedGraph.nodes.map(trimCompactNodeTier2),
          };
        }

        // Pass 2b: still over budget — drop prior ranges from external nodes
        if (estimateTokensForValue(trimmedGraph) > budget.graph) {
          log.warn(
            { graphBudget: budget.graph },
            'enforceContextBudget: graph still over budget — pass 2b trim (prior ranges on external nodes)',
          );
          trimmedGraph = {
            ...trimmedGraph,
            nodes: trimmedGraph.nodes.map(trimCompactNodePriorRanges),
          };
        }

        // Pass 3: still over budget — drop source provenance
        if (estimateTokensForValue(trimmedGraph) > budget.graph) {
          log.warn(
            { graphBudget: budget.graph },
            'enforceContextBudget: graph still over budget — pass 3 trim (source)',
          );
          trimmedGraph = {
            ...trimmedGraph,
            nodes: trimmedGraph.nodes.map(trimCompactNodeTier3),
          };
        }

        // Pass 4: still over budget — drop exists field from edges (preserve graph structure)
        if (estimateTokensForValue(trimmedGraph) > budget.graph) {
          log.warn(
            { graphBudget: budget.graph },
            'enforceContextBudget: graph still over budget — pass 4 trim (edge exists field)',
          );
          trimmedGraph = {
            ...trimmedGraph,
            edges: trimmedGraph.edges.map(trimCompactEdgeExists),
          };
        }

        result = { ...result, graph_compact: trimmedGraph };
      }
    }

    // --- Analysis budget enforcement ---
    if (result.analysis_response) {
      const analysisTokens = estimateTokensForValue(result.analysis_response);
      if (analysisTokens > budget.analysis) {
        log.warn(
          { analysisTokens, analysisBudget: budget.analysis },
          'enforceContextBudget: analysis over budget — trimming',
        );
        const trimmedAnalysis: AnalysisResponseSummary = {
          ...result.analysis_response,
          top_drivers: result.analysis_response.top_drivers.slice(0, 3),
          constraint_tensions: undefined,
        };
        result = { ...result, analysis_response: trimmedAnalysis };
      }
    }

    // NOTE (P5, ROADMAP 1.199): the conversation-window budget enforcement
    // (the 5→3→1 message-trim ladder) was DELETED here. It was unreachable on
    // the live V5 seam — the sole caller (context-budget-enforcement.ts:126)
    // passes only graph_compact + analysis_response, never `messages` — so it
    // was a dead backstop that read as a live guarantee. The conversation
    // window is bounded by the verbatim-turns cap (CONTEXT_PACK_RECENT_TURNS_CAP,
    // declared in the CONTEXT_POLICY's memory_window), not here.

    return result;
  } catch (err) {
    log.error({ err }, 'enforceContextBudget: unexpected error — returning context unchanged');
    return context;
  }
}
