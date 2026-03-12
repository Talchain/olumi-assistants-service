/**
 * Token Budget Calculator and Context Budget Enforcement
 *
 * Budget allocation:
 * - System prompt + tools: ~20%
 * - Graph: ~25%
 * - Analysis: ~15%
 * - Conversation (incl. event log): ~30%
 * - Buffer: ~10%
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
 * The subset of EnrichedContext fields that budget enforcement manages.
 * Budget enforcement operates on compact representations — not raw graph/analysis.
 * Uses graph_compact and analysis_response (compact) — not the raw graph/analysis fields.
 */
export interface BudgetEnforcementContext {
  // Compact graph — may be trimmed if over budget
  graph_compact?: GraphV3Compact | null;
  // Compact analysis summary — may be trimmed if over budget
  analysis_response?: AnalysisResponseSummary | null;
  // Trimmed conversation messages
  messages?: Array<{ role: string; content: string }>;
  // Event log summary (counted within conversation budget, not trimmed)
  event_log_summary?: string;
  // Pass-through fields (not touched by budget enforcement)
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
 *   Pass 1: uncertainty_drivers, extractionType, factor_type  (no-op on CompactNode — dropped at compaction)
 *   Pass 2: type, category
 *   Pass 2b: raw_value, cap on external-factor nodes (prior-range representation)
 *   Pass 3: source provenance
 * Edge trim (separate pass after all node passes):
 *   Pass 4: drop exists field from edges (preserve graph structure — never delete edges)
 * Preserved throughout: label, value, unit
 */
function trimCompactNodeTier1(node: GraphV3Compact['nodes'][number]): GraphV3Compact['nodes'][number] {
  const n = { ...node } as unknown as Record<string, unknown>;
  // These fields were already dropped during compaction; kept explicit for forward-compat.
  delete n['uncertainty_drivers'];
  delete n['extractionType'];
  delete n['factor_type'];
  return n as unknown as GraphV3Compact['nodes'][number];
}

function trimCompactNodeTier2(node: GraphV3Compact['nodes'][number]): GraphV3Compact['nodes'][number] {
  // Drop type, category (less user-visible than label/value)
  const n = { ...node } as unknown as Record<string, unknown>;
  delete n['type'];
  delete n['category'];
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
 * Enforce context budget on an enriched context.
 *
 * Budget allocation (% of maxTokens):
 * - System prompt + tools: ~20% (fixed, not controlled here)
 * - Graph compact: ~25% → trim on excess
 * - Analysis compact: ~15% → trim on excess
 * - Conversation (5 turns): ~30% → reduce to 3, then 1 turn
 * - Event log summary: included in conversation budget
 * - Buffer: ~10% reserved
 *
 * Trimming behaviour (graph — preserves user-visible state as long as possible):
 * - Pass 1: drop uncertainty_drivers, extractionType, factor_type (no-op on compact nodes)
 * - Pass 2: drop type, category from nodes
 * - Pass 2b: drop raw_value, cap from external-factor nodes (prior ranges)
 * - Pass 3: drop source provenance from nodes
 * - Pass 4: drop exists field from edges (preserves graph structure — no edges deleted)
 * - Preserve throughout: label, value, unit
 *
 * Analysis trimming:
 * - Drop constraint_tensions, reduce top_drivers to 3
 *
 * Conversation trimming: reduce to 3 turns, then 1 turn (always keep latest)
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
          'enforceContextBudget: graph over budget — pass 1 trim (low-value metadata)',
        );
        // Pass 1: drop low-value metadata fields (no-op on current CompactNode shape)
        let trimmedGraph: GraphV3Compact = {
          ...result.graph_compact,
          nodes: result.graph_compact.nodes.map(trimCompactNodeTier1),
          edges: result.graph_compact.edges,
          _node_count: result.graph_compact._node_count,
          _edge_count: result.graph_compact._edge_count,
        };

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

    // --- Conversation budget enforcement ---
    const messages = result.messages ?? [];
    const convTokens = estimateTokensForValue(messages)
      + (result.event_log_summary ? estimateTokens(result.event_log_summary as string) : 0);
    if (convTokens > budget.conversation) {
      let reduced = messages.length;

      if (messages.length > 3) {
        reduced = 3;
        log.warn(
          { convTokens, convBudget: budget.conversation, originalCount: messages.length },
          'enforceContextBudget: conversation over budget — reducing to 3 turns',
        );
      }

      // Check again after reducing to 3
      const after3Tokens = estimateTokensForValue(messages.slice(-3));
      if (reduced === 3 && after3Tokens > budget.conversation) {
        reduced = 1;
        log.warn(
          { convTokens: after3Tokens, convBudget: budget.conversation },
          'enforceContextBudget: conversation still over budget — reducing to 1 turn',
        );
      }

      // Always keep the latest `reduced` messages
      result = { ...result, messages: messages.slice(-reduced) };
    }

    return result;
  } catch (err) {
    log.error({ err }, 'enforceContextBudget: unexpected error — returning context unchanged');
    return context;
  }
}
