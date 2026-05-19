/**
 * V5 routing — shared low-level analytical-intent predicates.
 *
 * Single source of truth for two question-shape signals used by multiple
 * deterministic guards:
 *
 *   1. Mutation-signal detection — does the user's message contain a
 *      concrete graph-edit instruction (set X to N, add a Y, remove Z,
 *      adjust strength from A to B, etc.)? If yes, no analytical guard
 *      should short-circuit — let the normal edit-graph routing run.
 *
 *   2. Analytical-intent classification — is this message asking to
 *      understand, explain, or interrogate analysis results (or asking
 *      whether the analysis is still valid)? Lower-level than the
 *      post-analysis-advice-gate's 9-class taxonomy: this returns one
 *      of four broad shapes that downstream guards (stale-rerun,
 *      no-analysis, edit_graph no-op recovery) use to decide what to
 *      do when the gate's fresh-only short-circuit does not apply.
 *
 * The existing `tryPostAnalysisAdviceGate` keeps its 9-class taxonomy
 * and its fresh-path composers untouched — it imports
 * `MUTATION_SIGNAL_PATTERNS` from this module to avoid duplication, but
 * its decision tree and per-class data-availability checks are
 * preserved. The fresh-path tests must remain unchanged.
 *
 * Privacy: this module is pure pattern-matching. It contains no
 * telemetry, no copy, no graph or analysis content. All inputs are the
 * raw user message string.
 */

/**
 * Mutation-signal patterns. Hoisted from post-analysis-advice-gate.ts
 * (PR #173 + P0 deterministic post-analysis router) so every guard
 * shares the same negative gate. Patterns are written narrowly so
 * coaching questions that happen to use a mutation verb without a
 * concrete target ("What should we update based on this?") still pass
 * through to advice paths.
 */
export const MUTATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\bto\s+\S+/i,
  /\b(?:set|change|update|adjust|modify|raise|lower|increase|decrease|bump)\b[^.?!\n]{0,80}\b\d+(?:\.\d+)?%?\b/i,
  /\b(?:add|insert|create)\s+(?:a|an|new|another)\s+\S+/i,
  /\b(?:remove|delete|drop)\s+(?:the|that|this|my|our)\s+\S+/i,
  /\bfrom\s+\S+\s+to\s+\S+/i,
  /^\s*(?:set|remove|delete|drop|add|create|insert)\b/im,
];

/**
 * Does the message carry a concrete graph-mutation signal? When this
 * returns true, downstream analytical guards must NOT short-circuit —
 * the message is an edit request and should reach the edit-graph
 * dispatch path.
 */
export function hasMutationSignal(message: string): boolean {
  for (const re of MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

/**
 * Broad analytical-intent classes used by the stale-rerun guard, the
 * no-analysis guard, and the edit_graph no-op recovery branch.
 *
 *   - `explain`         — "walk me through the analysis", "explain the
 *                          result", "what does this mean", "help me
 *                          understand", "interpret this"
 *   - `what_drove`      — "what drove this", "why did X win", "what
 *                          made the result go this way"
 *   - `what_would_flip` — "what would flip this", "what would change
 *                          the result", "what would tip the balance"
 *   - `rerun_question`  — "is this stale", "do I need to re-run", "is
 *                          this still valid", "should I rerun analysis"
 */
export type AnalyticalIntentClass =
  | 'explain'
  | 'what_drove'
  | 'what_would_flip'
  | 'rerun_question';

interface IntentPattern {
  readonly cls: AnalyticalIntentClass;
  readonly pattern: RegExp;
}

const INTENT_PATTERNS: readonly IntentPattern[] = [
  // ── rerun_question (most specific — anchored on rerun/stale vocabulary) ─
  { cls: 'rerun_question', pattern: /\bdo\s+(?:i|we)\s+need\s+to\s+(?:re-?run|rerun|run\s+again)\b/i },
  { cls: 'rerun_question', pattern: /\bshould\s+(?:i|we)\s+(?:re-?run|rerun|run\s+again)\b/i },
  { cls: 'rerun_question', pattern: /\b(?:is|are)\s+(?:this|these|the|that|those)(?:\s+(?:result|results|analysis|outcome|outcomes))?\s+(?:still\s+)?(?:stale|out\s*of\s*date|outdated|valid|fresh|current)\b/i },
  { cls: 'rerun_question', pattern: /\bdoes\s+(?:this|the\s+(?:analysis|result))\s+need\s+(?:a\s+)?(?:re-?run|rerun|refresh)\b/i },
  { cls: 'rerun_question', pattern: /\bis\s+(?:the\s+)?(?:analysis|result)\s+out\s*of\s*date\b/i },

  // ── what_would_flip ──────────────────────────────────────────────
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+flip\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+change\s+(?:the\s+(?:result|outcome|leading\s+option|analysis|ranking|order)|things)\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+tip\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+it\s+take\s+to\s+(?:change|flip|reverse|move)\b/i },
  { cls: 'what_would_flip', pattern: /\bwhat\s+would\s+need\s+to\s+change\b/i },
  { cls: 'what_would_flip', pattern: /\bhow\s+(?:could|can|would)\s+(?:another\s+)?option\s+(?:win|look\s+better|come\s+(?:out\s+)?ahead)\b/i },

  // ── what_drove ───────────────────────────────────────────────────
  { cls: 'what_drove', pattern: /\bwhat\s+drove\b/i },
  { cls: 'what_drove', pattern: /\bwhy\s+did\s+(?:this|that|the\s+(?:result|analysis|outcome))\b/i },
  { cls: 'what_drove', pattern: /\bwhat\s+made\s+(?:this|that|the\s+(?:result|analysis|outcome))\b/i },
  { cls: 'what_drove', pattern: /\bwhat[''']?s\s+driving\b/i },
  { cls: 'what_drove', pattern: /\bwhich\s+(?:factor|driver)s?\s+(?:drove|drive|pushed)\b/i },

  // ── explain (broadest, evaluated last) ───────────────────────────
  { cls: 'explain', pattern: /\bexplain\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bwalk\s+me\s+through\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bwalk\s+me\s+through\b/i },
  { cls: 'explain', pattern: /\btell\s+me\s+about\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bwhat\s+do(?:es)?\s+(?:this|that|it|the\s+(?:analysis|result|outcome|number|score|finding|chart))\s+mean\b/i },
  { cls: 'explain', pattern: /\bhow\s+(?:should|do)\s+(?:i|we)\s+(?:read|interpret|understand)\b/i },
  { cls: 'explain', pattern: /\bhelp\s+me\s+(?:interpret|understand|make\s+sense\s+of|read)\b/i },
  { cls: 'explain', pattern: /\bexplain\s+(?:this|that|what[''']?s\s+going\s+on|what\s+happened|the\s+(?:reasoning|logic))\b/i },
  { cls: 'explain', pattern: /\bsummarise\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
  { cls: 'explain', pattern: /\bsummarize\s+(?:the|these|those|this|that)\s+(?:results?|analysis|outcomes?|findings?)\b/i },
];

/**
 * Classify a user message into one of four broad analytical-intent
 * shapes, or null when no analytical intent is detected.
 *
 * Order of precedence (rerun_question > what_would_flip > what_drove >
 * explain) is preserved by the order of INTENT_PATTERNS so a message
 * like "should I rerun before I explain the result" matches
 * `rerun_question` rather than `explain`.
 */
export function classifyAnalyticalIntent(
  message: string,
): AnalyticalIntentClass | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return null;
  for (const entry of INTENT_PATTERNS) {
    if (entry.pattern.test(trimmed)) return entry.cls;
  }
  return null;
}
