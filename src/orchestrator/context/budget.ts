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
 * Trimming behaviour:
 * - Graph over budget: drop `value` from nodes, drop edges below exists < 0.5
 * - Analysis over budget: drop constraint_tensions, reduce top_drivers to 3
 * - Conversation over budget: reduce to 3 turns, then 1 turn (always keep latest)
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
          'enforceContextBudget: graph over budget — trimming',
        );
        const trimmedGraph: GraphV3Compact = {
          ...result.graph_compact,
          nodes: result.graph_compact.nodes.map(({ value: _value, ...rest }) => rest),
          edges: result.graph_compact.edges.filter((e) => e.exists >= 0.5),
          _node_count: result.graph_compact._node_count,
          _edge_count: 0, // will be updated below
        };
        trimmedGraph._edge_count = trimmedGraph.edges.length;
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
