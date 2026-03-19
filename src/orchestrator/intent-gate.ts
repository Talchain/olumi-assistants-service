/**
 * Intent Gate — Deterministic Routing with LLM Fallback
 *
 * Strict whole-message equality matching against a frozen pattern table,
 * plus verb-prefix matching for research_topic and edit_graph.
 *
 * Pure function — no side effects, no logging, no async, no dependencies.
 *
 * | Tool             | Example patterns (after normalisation)                              |
 * |------------------|---------------------------------------------------------------------|
 * | run_analysis     | run it, analyse, analyze, run the analysis, simulate, ...           |
 * | draft_graph      | draft, draft a model, build the model, start over, new model, ...  |
 * | generate_brief   | generate brief, generate the brief, write the brief, create brief, decision brief, ... |
 * | explain_results  | explain, why, break it down, explain the results, ...              |
 * | edit_graph       | edit, modify, change, update the model, update the {X}, add a factor for {X}, ... |
 * | run_exercise     | pre-mortem, devil's advocate, disconfirmation, ...                  |
 * | research_topic   | research {topic}, look up {topic}, find data on {topic}, ...       |
 *
 * Excluded (too ambiguous without context — fall through to LLM):
 * go, let's go, do it, run (solo), why did, what happened
 *
 * Note: run_exercise is gate-only (not LLM-selectable). It is in the registry
 * under GATE_ONLY_TOOL_NAMES but NOT in TOOL_DEFINITIONS (invisible to LLM).
 */

// ============================================================================
// Types
// ============================================================================

export type ToolName = 'draft_graph' | 'edit_graph' | 'run_analysis' | 'explain_results' | 'generate_brief' | 'run_exercise' | 'research_topic';

export type ExerciseType = 'pre_mortem' | 'devil_advocate' | 'disconfirmation';

export interface IntentGateResult {
  tool: ToolName | null;
  routing: 'deterministic' | 'llm';
  confidence: 'exact' | 'none';
  normalised_message: string;
  matched_pattern?: string;
  /** Populated when tool === 'run_exercise' — the specific exercise type to run. */
  exercise?: ExerciseType;
  /** Populated when tool === 'research_topic' — the extracted query from the message. */
  research_query?: string;
}

// ============================================================================
// Normalisation
// ============================================================================

/**
 * Normalise user message for pattern matching.
 * - Lowercase
 * - Trim leading/trailing whitespace
 * - Replace curly apostrophes with ASCII
 * - Strip all trailing punctuation (. ! ? , ; : …)
 * - Collapse multiple spaces to single space
 */
function normalise(message: string): string {
  return message
    .toLowerCase()
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[.!?,;:\u2026]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Pattern Table
// ============================================================================

/**
 * Frozen pattern tuples — the source of truth for deterministic routing.
 * Exported for testing and audit. Each tuple maps a normalised message
 * to exactly one ToolName. Strict whole-message equality only.
 */
const _patterns: readonly (readonly [string, ToolName])[] = Object.freeze(([
  // run_analysis
  // Note: prerequisite gating (graph + analysis_inputs present) is enforced by
  // DETERMINISTIC_PREREQUISITES in turn-handler.ts — not here. If prerequisites
  // are unmet the turn falls through to LLM, which explains what's missing.
  ['run it', 'run_analysis'],
  ['run the analysis', 'run_analysis'],
  ['run analysis', 'run_analysis'],
  ['analyse', 'run_analysis'],
  ['analyze', 'run_analysis'],
  ['analyse it', 'run_analysis'],
  ['analyze it', 'run_analysis'],
  ['run the model', 'run_analysis'],
  ['run simulation', 'run_analysis'],
  ['simulate', 'run_analysis'],
  ['evaluate options', 'run_analysis'],
  ['rerun', 'run_analysis'],
  ['re-run', 'run_analysis'],
  ['rerun it', 'run_analysis'],
  ['re-run it', 'run_analysis'],
  ['rerun the analysis', 'run_analysis'],
  ['re-run the analysis', 'run_analysis'],
  ['rerun the model', 'run_analysis'],

  // draft_graph
  ['draft', 'draft_graph'],
  ['draft a model', 'draft_graph'],
  ['build the model', 'draft_graph'],
  ['build a model', 'draft_graph'],
  ['create a model', 'draft_graph'],
  ['start over', 'draft_graph'],
  ['new model', 'draft_graph'],
  ['redraft', 'draft_graph'],
  ['draft it', 'draft_graph'],

  // generate_brief
  ['generate brief', 'generate_brief'],
  ['generate a brief', 'generate_brief'],
  ['generate the brief', 'generate_brief'],
  ['write the brief', 'generate_brief'],
  ['create brief', 'generate_brief'],
  ['create a brief', 'generate_brief'],
  ['create the brief', 'generate_brief'],
  ['decision brief', 'generate_brief'],
  ['generate report', 'generate_brief'],
  ['write report', 'generate_brief'],

  // explain_results
  ['explain', 'explain_results'],
  ['explain the results', 'explain_results'],
  ['explain results', 'explain_results'],
  ['why', 'explain_results'],
  ['break it down', 'explain_results'],
  ['explain it', 'explain_results'],

  // edit_graph
  ['edit', 'edit_graph'],
  ['edit the model', 'edit_graph'],
  ['edit model', 'edit_graph'],
  ['modify', 'edit_graph'],
  ['change', 'edit_graph'],
  ['update the model', 'edit_graph'],
  ['update model', 'edit_graph'],

  // run_exercise — gate-only (not in LLM tool registry)
  // pre_mortem patterns
  ['pre-mortem', 'run_exercise'],
  ['pre mortem', 'run_exercise'],
  ['premortem', 'run_exercise'],
  ['what could go wrong', 'run_exercise'],
  ['imagine this failed', 'run_exercise'],
  // devil_advocate patterns
  ["devil's advocate", 'run_exercise'],
  ['devils advocate', 'run_exercise'],
  ["play devil's advocate", 'run_exercise'],
  ['argue against this recommendation', 'run_exercise'],
  ['argue the other side', 'run_exercise'],
  // disconfirmation patterns
  ['disconfirmation', 'run_exercise'],
  ['what would change this', 'run_exercise'],
  ['what evidence would change this', 'run_exercise'],
  ['what would flip this', 'run_exercise'],
  ['prove me wrong', 'run_exercise'],
] as const).map(t => Object.freeze(t)));

/** Exported for testing — the frozen tuple array of [pattern, tool] pairs. */
export const INTENT_PATTERN_ENTRIES: readonly (readonly [string, ToolName])[] = _patterns;

/** Internal lookup map built from frozen pattern tuples. */
const INTENT_PATTERNS: ReadonlyMap<string, ToolName> = new Map(_patterns);

/**
 * Map from run_exercise pattern to ExerciseType.
 * Used by classifyIntent to populate IntentGateResult.exercise.
 */
export const PATTERN_TO_EXERCISE: ReadonlyMap<string, ExerciseType> = new Map([
  ['pre-mortem', 'pre_mortem'],
  ['pre mortem', 'pre_mortem'],
  ['premortem', 'pre_mortem'],
  ['what could go wrong', 'pre_mortem'],
  ['imagine this failed', 'pre_mortem'],
  ["devil's advocate", 'devil_advocate'],
  ['devils advocate', 'devil_advocate'],
  ["play devil's advocate", 'devil_advocate'],
  ['argue against this recommendation', 'devil_advocate'],
  ['argue the other side', 'devil_advocate'],
  ['disconfirmation', 'disconfirmation'],
  ['what would change this', 'disconfirmation'],
  ['what evidence would change this', 'disconfirmation'],
  ['what would flip this', 'disconfirmation'],
  ['prove me wrong', 'disconfirmation'],
]);

// ============================================================================
// Research Prefix Patterns
// ============================================================================

/**
 * Verb-prefix patterns for research_topic routing.
 * Matched against normalised message prefix. The remainder (after stripping
 * the prefix) becomes the research query. Only matches when a non-empty
 * topic follows the prefix.
 *
 * Ordered longest-first to avoid partial prefix matches.
 */
export const RESEARCH_PREFIXES: readonly string[] = Object.freeze([
  'find evidence for ',
  'find evidence on ',
  'search for ',
  'find data on ',
  'look up ',
  'research ',
]);

// ============================================================================
// Parameter Assignment Patterns
// ============================================================================

/**
 * Stopwords excluded from token overlap matching — common edit verbs, prepositions,
 * and value words that would inflate match scores against unrelated node labels.
 * Mirrors TOKEN_OVERLAP_STOPWORDS in edit-graph.ts (kept in sync deliberately —
 * do NOT import from edit-graph.ts, that function is private).
 */
const PARAM_OVERLAP_STOPWORDS = new Set([
  'set', 'the', 'to', 'a', 'an', 'of', 'for', 'and', 'in', 'on', 'is', 'it',
  'high', 'low', 'higher', 'lower', 'more', 'less', 'very', 'much',
  'make', 'change', 'update', 'adjust', 'increase', 'decrease', 'raise', 'reduce',
  'please', 'add', 'remove', 'delete', 'new', 'from', 'with', 'by', 'its', 'this',
  'that', 'value', 'level', 'factor', 'node', 'edge', 'option', 'model',
]);

/**
 * Check if the normalised message has significant token overlap with exactly one
 * node label from the provided list. Returns true only when exactly one label
 * matches (to prevent ambiguous routing when multiple nodes would qualify).
 *
 * Overlap threshold: ≥1 overlapping token AND ≥50% of label tokens matched.
 * Substring match: only when shorter token is ≥60% of longer (avoids "rate"→"corporate").
 */
function hasExactlyOneNodeOverlap(normalisedMessage: string, nodeLabels: string[]): boolean {
  const messageTokens = normalisedMessage
    .split(/\s+/)
    .filter((t) => t.length > 2 && !PARAM_OVERLAP_STOPWORDS.has(t));

  if (messageTokens.length === 0) return false;

  let matchCount = 0;
  for (const label of nodeLabels) {
    const labelTokens = label
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2 && !PARAM_OVERLAP_STOPWORDS.has(t));
    if (labelTokens.length === 0) continue;

    const overlapCount = labelTokens.filter((lt) =>
      messageTokens.some((mt) => {
        if (lt === mt) return true;
        const shorter = lt.length <= mt.length ? lt : mt;
        const longer = lt.length <= mt.length ? mt : lt;
        return longer.includes(shorter) && shorter.length / longer.length >= 0.6;
      }),
    ).length;

    if (overlapCount >= 1 && overlapCount / labelTokens.length >= 0.5) {
      matchCount++;
      if (matchCount > 1) return false; // ambiguous — multiple nodes match
    }
  }

  return matchCount === 1;
}

/**
 * Regex patterns for bare parameter assignment messages.
 * Applied only when hasGraph === true and token overlap confirms a graph node match.
 *
 * Question exclusion happens before this list is checked (see classifyIntentWithContext).
 */
const PARAMETER_ASSIGNMENT_PATTERNS: readonly RegExp[] = Object.freeze([
  // "set X to Y"
  /^set\s+\w[\w\s]+?\s+to\s+\S/,
  // "X = Y"
  /^.+\s*=\s*.+$/,
  // "increase/raise X to Y"
  /^(?:increase|raise)\s+\w[\w\s]+?\s+to\s+\S/,
  // "reduce/decrease/lower X by Y"
  /^(?:reduce|decrease|lower)\s+\w[\w\s]+?\s+by\s+\S/,
  // "make X high/low/medium/small/large"
  /^make\s+\w[\w\s]+?\s+(?:very\s+)?(?:high|low|medium|small|large)$/,
  // "budget is £120k" / "team size is 7" — value with currency or digit
  /^(?:the\s+)?\w[\w\s]+?\s+is\s+[£$€]?\d/,
  // "X is high/low/very high/none" — value word assignment (not a question)
  /^(?:the\s+)?\w[\w\s]+?\s+is\s+(?:very\s+)?(?:high|low|medium|none|small|large|minimal|significant|critical|negligible)$/,
]);

/**
 * Interrogative words that start questions — used to exclude question-like messages
 * from parameter assignment routing.
 */
const QUESTION_STARTERS = new Set([
  'what', 'is', 'are', 'how', 'why', 'does', 'do', 'can', 'which', 'who', 'when', 'where',
]);

// ============================================================================
// Edit Prefix Patterns
// ============================================================================

/**
 * Verb-prefix patterns for edit_graph routing.
 * Matched against normalised message prefix. Only matches when a non-empty
 * target description follows the prefix (e.g. "update the team size factor").
 *
 * Ordered longest-first to avoid partial prefix matches.
 */
export const EDIT_PREFIXES: readonly string[] = Object.freeze([
  // Sorted strictly longest-first to prevent a shorter prefix consuming a match
  // before a longer, more specific prefix has a chance.
  // 18 chars
  'please update the ',
  'please change the ',
  'please modify the ',
  'please remove the ',
  'add an option for ',
  // 17 chars
  'add a factor for ',
  // 15 chars
  'please set the ',
  // 14 chars
  'please add an ',
  'add an option ',
  'remove factor ',
  'remove option ',
  // 13 chars
  'please add a ',
  'add a factor ',
  // 12 chars
  'add an edge ',
  // 11 chars
  'update the ',
  'change the ',
  'modify the ',
  'remove the ',
  'add a node ',
  // 8 chars
  'set the ',
]);

// ============================================================================
// Startup Validation
// ============================================================================

/**
 * Get all unique tool names referenced in the intent gate pattern table.
 * Used by startup validation to check against the tool registry.
 * Includes research_topic from prefix patterns (edit_graph already in exact-match table).
 */
export function getGateToolNames(): string[] {
  return [...new Set([..._patterns.map(([, tool]) => tool), 'research_topic'])];
}

// ============================================================================
// Gate Logic
// ============================================================================

/**
 * Classify user intent via strict whole-message equality matching,
 * then verb-prefix matching for research_topic and edit_graph.
 *
 * Pure function — no side effects, no async, no external dependencies.
 * Returns { tool, routing: 'deterministic', confidence: 'exact' } on match,
 * or { tool: null, routing: 'llm', confidence: 'none' } for LLM fallback.
 */
export function classifyIntent(message: string): IntentGateResult {
  const normalised = normalise(message);

  // 1. Exact whole-message match (all tools except research_topic)
  const tool = INTENT_PATTERNS.get(normalised) ?? null;

  if (tool) {
    const result: IntentGateResult = {
      tool,
      routing: 'deterministic',
      confidence: 'exact',
      normalised_message: normalised,
      matched_pattern: normalised,
    };
    if (tool === 'run_exercise') {
      result.exercise = PATTERN_TO_EXERCISE.get(normalised);
    }
    return result;
  }

  // 2. Verb-prefix match for research_topic
  for (const prefix of RESEARCH_PREFIXES) {
    if (normalised.startsWith(prefix)) {
      const remainder = normalised.slice(prefix.length).trim();
      // Only match when there's a clear topic (non-empty remainder)
      if (remainder.length > 0) {
        return {
          tool: 'research_topic',
          routing: 'deterministic',
          confidence: 'exact',
          normalised_message: normalised,
          matched_pattern: prefix.trim(),
          research_query: remainder,
        };
      }
    }
  }

  // 3. Verb-prefix match for edit_graph
  for (const prefix of EDIT_PREFIXES) {
    if (normalised.startsWith(prefix)) {
      const remainder = normalised.slice(prefix.length).trim();
      if (remainder.length > 0) {
        return {
          tool: 'edit_graph',
          routing: 'deterministic',
          confidence: 'exact',
          normalised_message: normalised,
          matched_pattern: prefix.trim(),
        };
      }
    }
  }

  return {
    tool: null,
    routing: 'llm',
    confidence: 'none',
    normalised_message: normalised,
  };
}

// ============================================================================
// Brief Detection Heuristic
// ============================================================================

/**
 * Decision-signal patterns that suggest the user is describing a decision brief
 * rather than asking a question or giving a command.
 */
const DECISION_BRIEF_PATTERN = /\b(choosing between|deciding (between|whether|on|if)|options? (?:are|include)|should (?:we|i)\b.{5,}|comparing|alternatives?\b.{5,}|evaluate\b.{5,}|pick between|trade[\s-]?off|versus|vs\.?\s)/i;

/**
 * Patterns that indicate the message is NOT a brief — it's a tool command,
 * a question about a topic, or a meta-request.
 */
const NON_BRIEF_PATTERN = /\b(explain|analyse|analyze|run|generate|edit|modify|what (?:is|are|does|did|would)|how (?:does|do|is|can)|why (?:did|does|is)|tell me about|can you)\b/i;

/**
 * Minimum message length for brief detection (matches DraftGraphInput schema min).
 */
const BRIEF_MIN_LENGTH = 30;

/**
 * Check if a message looks like a natural language decision brief.
 * Conservative heuristic: requires decision signals AND minimum length.
 *
 * Exported for testing.
 */
export function looksLikeDecisionBrief(message: string): boolean {
  if (message.trim().length < BRIEF_MIN_LENGTH) return false;
  if (NON_BRIEF_PATTERN.test(message)) return false;
  return DECISION_BRIEF_PATTERN.test(message);
}

/**
 * Context-aware intent classification that extends classifyIntent() with:
 * 1. Brief detection for first-turn scenarios (no graph in context).
 * 2. Bare parameter assignment detection when a graph is present.
 *
 * When no deterministic pattern matches AND the user has no graph AND the
 * message looks like a decision brief, routes to draft_graph deterministically.
 *
 * When a graph is present AND the message matches a parameter assignment pattern
 * AND exactly one graph node label overlaps with the message subject, routes to
 * edit_graph deterministically.
 *
 * Gated behind CEE_BRIEF_DETECTION_ENABLED feature flag (checked by caller).
 *
 * @param context.graphNodeLabels - Labels of all nodes in the current graph.
 *   Used for token overlap validation on parameter assignment routing.
 *   Optional for backwards compatibility — parameter assignment only fires when present.
 */
export function classifyIntentWithContext(
  message: string,
  context: { hasGraph: boolean; graphNodeLabels?: string[] },
): IntentGateResult {
  const result = classifyIntent(message);
  if (result.tool !== null) return result;

  // Brief detection: first-turn only (no graph), message looks like a decision brief
  if (!context.hasGraph && looksLikeDecisionBrief(message)) {
    return {
      tool: 'draft_graph',
      routing: 'deterministic',
      confidence: 'exact',
      normalised_message: normalise(message),
      matched_pattern: 'brief_detection',
    };
  }

  // Parameter assignment detection: only when graph exists and node labels are provided
  if (context.hasGraph && context.graphNodeLabels && context.graphNodeLabels.length > 0) {
    const normalised = normalise(message);

    // Exclude questions: messages starting with an interrogative or ending with '?'
    const firstWord = normalised.split(/\s+/)[0] ?? '';
    const isQuestion = QUESTION_STARTERS.has(firstWord) || message.trimEnd().endsWith('?');

    if (!isQuestion) {
      const patternMatches = PARAMETER_ASSIGNMENT_PATTERNS.some((re) => re.test(normalised));

      if (patternMatches) {
        // Only route deterministically when exactly one node label overlaps —
        // ambiguous multi-node matches fall through to LLM for disambiguation.
        if (hasExactlyOneNodeOverlap(normalised, context.graphNodeLabels)) {
          return {
            tool: 'edit_graph',
            routing: 'deterministic',
            confidence: 'exact',
            normalised_message: normalised,
            matched_pattern: 'parameter_assignment',
          };
        }
      }
    }
  }

  return result;
}
