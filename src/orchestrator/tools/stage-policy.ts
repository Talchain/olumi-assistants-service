/**
 * Stage-based Tool Allowlisting
 *
 * Deterministic server-side enforcement of which tools can be invoked
 * at each lifecycle stage. Pure function — no async, no side effects.
 *
 * Gate-only / latent tools (run_exercise, undo_patch) bypass the policy.
 * System events bypass the policy entirely (routed before intent gate).
 */

import type { DecisionStage } from "../types.js";

// ============================================================================
// Policy Table
// ============================================================================

/**
 * Per-stage tool allowlist.
 *
 * Tools not in a stage's set are blocked at that stage (unless override applies).
 * `optimise` uses the same set as `evaluate`.
 */
export const STAGE_TOOL_POLICY: Record<DecisionStage, ReadonlySet<string>> = {
  frame:    new Set(['draft_graph', 'research_topic']),
  ideate:   new Set(['edit_graph', 'research_topic', 'draft_graph']),
  evaluate: new Set(['run_analysis', 'explain_results', 'generate_brief', 'edit_graph']),
  decide:   new Set(['generate_brief', 'explain_results', 'edit_graph']),
  optimise: new Set(['edit_graph', 'run_analysis', 'explain_results', 'generate_brief']),
};

/**
 * Tools that bypass the stage policy entirely.
 * Gate-only and latent tools — they have their own prerequisites.
 */
const POLICY_BYPASS_TOOLS: ReadonlySet<string> = new Set([
  'run_exercise',
  'undo_patch',
]);

// ============================================================================
// Intent signals
// ============================================================================

const RESEARCH_INTENT_RE = /\bresearch\b|\bfind\s+(?:data|evidence|benchmarks?)\b|\blook\s+up\b|\bwhat\s+does\s+the\s+evidence\b|\bbenchmark/i;
const REBUILD_INTENT_RE = /\bstart\s+over\b|\brebuild\b|\bfrom\s+scratch\b|\bnew\s+model\b/i;

/**
 * Check if user message contains explicit research intent.
 */
export function hasExplicitResearchIntent(userMessage: string): boolean {
  return RESEARCH_INTENT_RE.test(userMessage);
}

/**
 * Check if user message contains explicit rebuild intent.
 */
export function hasExplicitRebuildIntent(userMessage: string): boolean {
  return REBUILD_INTENT_RE.test(userMessage);
}

// ============================================================================
// Guard
// ============================================================================

export interface StageGuardResult {
  allowed: boolean;
  /** Reason the tool was blocked (only set when allowed === false). */
  reason?: string;
}

/**
 * Check if a tool is allowed at the given stage.
 *
 * Special rules:
 * - `research_topic` in FRAME requires explicit research intent in the user message.
 * - `draft_graph` in IDEATE requires explicit rebuild intent ("start over", "rebuild", etc.).
 * - Gate-only / latent tools (run_exercise, undo_patch) always bypass.
 * - Unknown stage → permissive fallback (allowed: true).
 */
export function isToolAllowedAtStage(
  toolName: string,
  stage: DecisionStage | string,
  userMessage?: string,
): StageGuardResult {
  // Bypass tools always allowed
  if (POLICY_BYPASS_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  // Unknown stage → permissive fallback
  const allowedTools = STAGE_TOOL_POLICY[stage as DecisionStage];
  if (!allowedTools) {
    return { allowed: true };
  }

  // Base policy check
  if (!allowedTools.has(toolName)) {
    return {
      allowed: false,
      reason: `${toolName} is not available at stage '${stage}'`,
    };
  }

  // Special: research_topic in FRAME requires explicit intent
  if (toolName === 'research_topic' && stage === 'frame') {
    if (!userMessage || !hasExplicitResearchIntent(userMessage)) {
      return {
        allowed: false,
        reason: 'research_topic requires explicit research intent in FRAME stage',
      };
    }
  }

  // Special: draft_graph in IDEATE requires explicit rebuild intent
  if (toolName === 'draft_graph' && stage === 'ideate') {
    if (!userMessage || !hasExplicitRebuildIntent(userMessage)) {
      return {
        allowed: false,
        reason: 'draft_graph requires explicit rebuild intent in IDEATE stage',
      };
    }
  }

  return { allowed: true };
}
