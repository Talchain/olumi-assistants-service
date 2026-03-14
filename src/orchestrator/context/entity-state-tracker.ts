/**
 * Cross-Turn Entity Memory — Entity State Tracker
 *
 * Tracks per-factor interaction state across conversation turns.
 * Conservative v1: only marks states with strong signal, never infers from loose mention.
 *
 * State rules:
 * - calibrated: edit_graph tool call that targeted this node AND a subsequent
 *   non-dismissal user message exists (evidence the edit was applied).
 *   Note: patch_accepted/patch_dismissed system events are not available in
 *   ConversationMessage[] (they arrive via request.system_event and [system]
 *   sentinels are ephemeral/not persisted). The subsequent-message + rejection
 *   filter is the strongest feasible signal.
 * - challenged: user explicitly questioned correctness/source of this factor
 * - untouched: factor exists in graph, user has never referenced it
 * - default: factor has source='assumption' provenance and user hasn't touched it
 *
 * Recency: latest action wins.
 */

import type { GraphV3Compact } from "./graph-compact.js";
import type { ConversationMessage } from "../types.js";

// ============================================================================
// Types
// ============================================================================

export type EntityState = 'calibrated' | 'challenged' | 'untouched' | 'default';

export interface EntityStateEntry {
  label: string;
  state: EntityState;
  last_action_turn: number;
  value?: number;
}

export interface EntityStateMap {
  [nodeId: string]: EntityStateEntry;
}

// ============================================================================
// Challenge detection patterns
// ============================================================================

/**
 * Patterns that indicate the user is questioning/challenging a factor.
 * Must co-occur with the factor's label in the same message.
 */
const CHALLENGE_PATTERNS = [
  /\bis\s+\S+\s+really\b/i,
  /\bwhere\s+did\s+\S+\s+come\s+from\b/i,
  /\bhow\s+did\s+you\s+(get|calculate|estimate|determine)\b/i,
  /\bwhy\s+is\s+\S+\s+(set\s+to|at|equal\s+to)\b/i,
  /\bare\s+you\s+sure\s+(about|that)\b/i,
  /\bthat\s+(seems|looks)\s+(wrong|off|too\s+high|too\s+low|incorrect)\b/i,
  /\bwhat\s+(is\s+the\s+)?source\s+(for|of)\b/i,
  /\bi\s+don'?t\s+(think|believe|agree)\b/i,
  /\bquestion(ing)?\s+(the|this|that)\b/i,
  /\bconfidence\s+(in|about|level)\b/i,
];

// ============================================================================
// Dismissal / rejection patterns — user rejecting a proposed edit
// ============================================================================

/**
 * Patterns that indicate the user rejected or dismissed a proposed edit.
 * If the first subsequent user message after an edit_graph proposal matches
 * any of these, we do NOT mark the factor as calibrated.
 */
const DISMISSAL_PATTERNS = [
  /^(no|nope|nah)\b/i,                                      // sentence-initial "no" only
  /\bundo\b/i,
  /\brevert\b/i,
  /\bcancel\b/i,
  /\bdismiss/i,
  /\breject/i,
  /\bdon'?t\s+(do|change|apply|update|modify|accept)\b/i,
  /\bthat'?s\s+wrong\b/i,                                   // "that's wrong" — scoped, not bare "wrong"
  /\bnot\s+what\s+i/i,
  /\btake\s+(it|that)\s+back\b/i,
];

/**
 * Check if a user message is a dismissal/rejection of a preceding edit.
 * Conservative: only checks for explicit rejection language.
 */
function isDismissal(userMessage: string): boolean {
  return DISMISSAL_PATTERNS.some((pattern) => pattern.test(userMessage));
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Check if a user message challenges a specific factor.
 * Requires both: (1) a challenge pattern AND (2) the factor's label in the message.
 */
function isChallenged(userMessage: string, label: string): boolean {
  const normMsg = userMessage.toLowerCase();
  const normLabel = label.toLowerCase();

  // Factor label must appear in the message
  if (!normMsg.includes(normLabel)) return false;

  // At least one challenge pattern must match
  return CHALLENGE_PATTERNS.some((pattern) => pattern.test(userMessage));
}

/**
 * Check if an assistant's tool_calls include an edit_graph targeting a specific node.
 * Looks for the node ID or label in the tool input (edit_description or changes array).
 */
function isCalibrated(
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
  nodeId: string,
  label: string,
): boolean {
  for (const tc of toolCalls) {
    if (tc.name !== 'edit_graph') continue;

    const input = tc.input;
    const inputStr = JSON.stringify(input).toLowerCase();
    const normLabel = label.toLowerCase();
    const normId = nodeId.toLowerCase();

    // Check if the edit_graph input references this node by ID or label
    if (inputStr.includes(normId) || inputStr.includes(normLabel)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Main export
// ============================================================================

/**
 * Track entity interaction states across conversation history.
 *
 * @param history - Last N conversation turns (already trimmed by caller)
 * @param graph - Current compact graph (provides factor list)
 * @returns Map of node ID → state entry
 */
export function trackEntityStates(
  history: ConversationMessage[],
  graph: GraphV3Compact | null | undefined,
): EntityStateMap {
  if (!graph || graph.nodes.length === 0) return {};

  // Filter to factors only — entity memory is strictly per-factor state.
  // Options, decision, and constraint nodes are excluded.
  const factors = graph.nodes.filter((n) => n.kind === 'factor');
  if (factors.length === 0) return {};

  const stateMap: EntityStateMap = {};

  // Initialize factor nodes — default states based on provenance
  for (const node of factors) {
    const isAssumption = node.source === 'assumption';
    stateMap[node.id] = {
      label: node.label,
      state: isAssumption ? 'default' : 'untouched',
      last_action_turn: -1,
      ...(node.value !== undefined ? { value: node.value } : {}),
    };
  }

  // Scan conversation history (oldest → newest) — latest action wins via overwrite
  for (let turnIdx = 0; turnIdx < history.length; turnIdx++) {
    const msg = history[turnIdx];

    if (msg.role === 'user') {
      // Check each factor for challenge patterns
      for (const node of factors) {
        if (isChallenged(msg.content, node.label)) {
          stateMap[node.id] = {
            ...stateMap[node.id],
            state: 'challenged',
            last_action_turn: turnIdx,
          };
        }
      }
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Only mark calibrated if a subsequent non-dismissal user message exists —
      // evidence the edit was applied (not just proposed). If the edit_graph call
      // is the last message with no follow-up, or the next user message rejects
      // the edit, we can't confirm it was accepted.
      const nextUserMsg = history
        .slice(turnIdx + 1)
        .find((m) => m.role === 'user');
      if (!nextUserMsg) continue;
      if (isDismissal(nextUserMsg.content)) continue;

      // Check for edit_graph tool calls that targeted specific factors
      for (const node of factors) {
        if (isCalibrated(msg.tool_calls, node.id, node.label)) {
          stateMap[node.id] = {
            ...stateMap[node.id],
            state: 'calibrated',
            last_action_turn: turnIdx,
          };
        }
      }
    }
  }

  return stateMap;
}
