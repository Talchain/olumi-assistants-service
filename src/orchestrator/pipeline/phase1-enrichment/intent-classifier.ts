/**
 * Intent Classifier
 *
 * Classifies the user's conversational stance into one of four categories:
 * explain, recommend, act, conversational.
 *
 * This is DIFFERENT from the existing intent-gate.ts which maps to tool names.
 * This classifies conversational intent for context enrichment.
 *
 * Pure function — no LLM calls, no I/O.
 */

import type { IntentClassification } from "../types.js";

// ============================================================================
// Keyword Sets
// ============================================================================

const EXPLAIN_KEYWORDS = [
  'why', 'how', 'what does', 'explain', 'tell me about', 'what happened',
  'what is', 'what are', 'help me understand', 'can you explain',
  'break it down', 'walk me through',
];

const RECOMMEND_KEYWORDS = [
  'should i', 'which', 'what do you think', 'recommend', 'suggest', 'advise',
  'what would you', 'best option', 'what should', 'do you think',
  'would you recommend', 'your advice',
];

const ACT_KEYWORDS = [
  'add', 'remove', 'change', 'edit', 'update', 'run', 'analyse', 'analyze',
  'draft', 'create', 'delete', 'modify', 'build', 'generate', 'simulate',
  'set', 'make', 'do this', 'do that', 'do it',
];

// ============================================================================
// Classifier
// ============================================================================

/**
 * Classify the user's conversational intent from their message.
 *
 * Priority when multiple keyword sets match: act > recommend > explain > conversational
 *
 * No LLM fallback in this skeleton (add in A.2+).
 */
export function classifyUserIntent(message: string): IntentClassification {
  const lower = message.toLowerCase();

  const matchesAct = ACT_KEYWORDS.some(kw => lower.includes(kw));
  const matchesRecommend = RECOMMEND_KEYWORDS.some(kw => lower.includes(kw));
  const matchesExplain = EXPLAIN_KEYWORDS.some(kw => lower.includes(kw));

  // Priority: act > recommend > explain > conversational
  if (matchesAct) return 'act';
  if (matchesRecommend) return 'recommend';
  if (matchesExplain) return 'explain';
  return 'conversational';
}
