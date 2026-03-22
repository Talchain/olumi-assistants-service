/**
 * Intent Gate — Deterministic Routing with LLM Fallback
 *
 * Strict whole-message equality matching against a frozen pattern table,
 * plus verb-prefix matching for research_topic and edit_graph.
 *
 * Pure function — no side effects, no logging, no async.
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

import { hasExactlyOneNodeOverlap } from "./tools/token-overlap.js";

// ============================================================================
// Types
// ============================================================================

export type ToolName = 'draft_graph' | 'edit_graph' | 'run_analysis' | 'explain_results' | 'generate_brief' | 'run_exercise' | 'research_topic';

export type ExerciseType = 'pre_mortem' | 'devil_advocate' | 'disconfirmation';

export interface IntentGateResult {
  tool: ToolName | null;
  routing: 'deterministic' | 'llm';
  /**
   * Confidence level for the routing decision.
   * - 'exact': strict whole-message or prefix match (highest confidence)
   * - 'high': heuristic match with corroborating evidence (e.g. token overlap)
   * - 'none': LLM fallback
   */
  confidence: 'exact' | 'high' | 'none';
  normalised_message: string;
  matched_pattern?: string;
  /** Populated when tool === 'run_exercise' — the specific exercise type to run. */
  exercise?: ExerciseType;
  /** Populated when tool === 'research_topic' — the extracted query from the message. */
  research_query?: string;
  /**
   * When true, the message originated from a UI chip click.
   * The context assembler uses this to inject the artefact appendix for artefact-related chips.
   */
  chip_origin?: boolean;
  /**
   * When true, the matched chip requires the artefact design appendix in the system prompt.
   * Only meaningful when chip_origin is true. False for UI-aligned (non-artefact) chips.
   */
  chip_artefact?: boolean;
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
 * Regex patterns for bare parameter assignment messages.
 * Applied only when hasGraph === true and token overlap confirms a graph node match.
 *
 * Question exclusion happens before this list is checked (see classifyIntentWithContext).
 *
 * V2 hardening (CEE_DETERMINISTIC_ROUTING_V2):
 * - Adjective-only values excluded via ADJECTIVE_ONLY_VALUES set
 * - "X = Y" restricted to numeric/currency right-hand side
 * - Strength level vocabulary expanded (moderate, very low)
 */
const PARAMETER_ASSIGNMENT_PATTERNS: readonly RegExp[] = Object.freeze([
  // "set X to Y" — Y must be numeric, currency, or strength level (validated post-match)
  /^set\s+\w[\w\s]+?\s+to\s+\S/,
  // "X = Y" — restricted to numeric or currency RHS to avoid matching prose
  /^.+\s*=\s*[£$€]?\d/,
  // "increase/raise X to/by Y"
  /^(?:increase|raise)\s+\w[\w\s]+?\s+(?:to|by)\s+\S/,
  // "reduce/decrease/lower X to/by Y"
  /^(?:reduce|decrease|lower)\s+\w[\w\s]+?\s+(?:to|by)\s+\S/,
  // "make X high/low/medium/small/large/moderate"
  /^make\s+\w[\w\s]+?\s+(?:very\s+)?(?:high|low|medium|moderate|small|large)$/,
  // "budget is £120k" / "team size is 7" — value with currency or digit
  /^(?:the\s+)?\w[\w\s]+?\s+is\s+[£$€]?\d/,
  // "X is high/low/very high/none" — recognised strength levels only (not adjective-only)
  /^(?:the\s+)?\w[\w\s]+?\s+is\s+(?:very\s+)?(?:high|low|medium|moderate|none|small|large|minimal|significant|critical|negligible)$/,
]);

/**
 * Adjective-only values that describe quality/state but are NOT settable parameters.
 * Messages like "budget is tight" or "timeline is aggressive" should NOT route to edit_graph.
 * Checked after pattern match but before returning deterministic routing.
 */
const ADJECTIVE_ONLY_VALUES: ReadonlySet<string> = new Set([
  'tight', 'aggressive', 'conservative', 'ambitious', 'flexible', 'rigid',
  'important', 'crucial', 'essential', 'key', 'vital', 'uncertain', 'unclear',
  'complex', 'complicated', 'simple', 'straightforward', 'difficult', 'easy',
  'good', 'bad', 'great', 'poor', 'strong', 'weak', 'fine', 'okay',
  'risky', 'safe', 'stable', 'unstable', 'volatile', 'fragile', 'robust',
  'limited', 'unlimited', 'sufficient', 'insufficient', 'adequate', 'inadequate',
]);

/**
 * Recognised strength levels that are valid settable parameter values.
 * Adjective-only words (ADJECTIVE_ONLY_VALUES) are NOT valid.
 */
const STRENGTH_LEVEL_VALUES: ReadonlySet<string> = new Set([
  'high', 'low', 'medium', 'moderate', 'none', 'small', 'large',
  'minimal', 'significant', 'critical', 'negligible',
  'very high', 'very low',
]);

/**
 * Check whether a value string is a settable parameter value:
 * - Numeric (possibly with currency prefix): "150k", "£120k", "$50000", "7"
 * - Percentage: "20%", "10.5%"
 * - Recognised strength level: "high", "very high", "moderate"
 *
 * Returns false for adjective-only values like "tight", "aggressive", "important".
 */
function isSettableValue(valueStr: string): boolean {
  const trimmed = valueStr.trim().toLowerCase();
  if (!trimmed) return false;

  // Numeric or currency (£120k, $50000, 7, 150k, 20%, 10.5%)
  if (/^[£$€]?\d/.test(trimmed)) return true;
  if (/^\d+(\.\d+)?%?$/.test(trimmed)) return true;

  // Recognised strength levels (single words and "very X")
  if (STRENGTH_LEVEL_VALUES.has(trimmed)) return true;

  // Adjective-only values are NOT settable
  if (ADJECTIVE_ONLY_VALUES.has(trimmed)) return false;

  // Unknown single words — fall through to LLM (conservative)
  return false;
}

/**
 * Check whether a normalised message is an adjective-only description rather than
 * a settable parameter assignment. E.g. "budget is tight" vs "budget is 150k".
 *
 * Checks all parameter assignment patterns, not just "X is Y":
 * - "X is Y": validates Y is settable
 * - "set X to Y": validates Y is settable
 * - "increase/reduce X to/by Y": validates Y is settable
 * - "make X Y": validates Y is a strength level (already constrained by regex)
 * - "X = Y": already constrained to numeric RHS by regex
 */
function isAdjectiveOnlyAssignment(normalised: string): boolean {
  // "X is Y" pattern
  const isMatch = normalised.match(/\bis\s+(.+)$/);
  if (isMatch) {
    const valueStr = isMatch[1].trim();
    return !isSettableValue(valueStr);
  }

  // "set X to Y" pattern
  const setMatch = normalised.match(/^set\s+\w[\w\s]+?\s+to\s+(.+)$/);
  if (setMatch) {
    return !isSettableValue(setMatch[1].trim());
  }

  // "increase/raise/reduce/decrease/lower X to/by Y" pattern
  const changeMatch = normalised.match(/^(?:increase|raise|reduce|decrease|lower)\s+\w[\w\s]+?\s+(?:to|by)\s+(.+)$/);
  if (changeMatch) {
    return !isSettableValue(changeMatch[1].trim());
  }

  return false;
}

/**
 * Interrogative words that start questions — used to exclude question-like messages
 * from parameter assignment routing.
 */
const QUESTION_STARTERS = new Set([
  'what', 'is', 'are', 'how', 'why', 'does', 'do', 'can', 'which', 'who', 'when', 'where',
]);

// ============================================================================
// Chip Passthrough Patterns (V2)
// ============================================================================

/**
 * UI chip messages that must always route to LLM (never deterministic).
 *
 * Artefact chips need the artefact design appendix injected into the system prompt.
 * UI-aligned chips are long, specific messages that need full LLM context.
 *
 * Matching uses normalised substring containment — these are long, specific messages
 * that won't false-positive against natural conversation.
 */

/** Artefact chip patterns — need artefact appendix injected. */
const ARTEFACT_CHIP_PATTERNS: readonly string[] = Object.freeze([
  'assess these options',
  'decision matrix',
  'visualise sensitivity',
  'visualize sensitivity',
  'sensitivity breakdown',
  'compare options',
  'side by side',
  'run pre-mortem exercise',
  // Note: bare "pre-mortem" intentionally excluded — it should route to run_exercise
  // via the exact-match pattern table, not chip passthrough.
]);

/** UI-aligned chip patterns — long specific messages from v28 chips. */
const UI_CHIP_PATTERNS: readonly string[] = Object.freeze([
  'what baselines am i missing',
  'help me fill in the data gaps',
  'which edges are model-estimated',
  'help me calibrate the most important ones',
  'where would better data most improve this decision',
  'show me the relationships that could flip the recommendation',
]);

/**
 * Check whether a normalised message matches a chip passthrough pattern.
 * Returns { matched: true, artefact: boolean } when matched, null otherwise.
 *
 * Exported for testing.
 */
export function matchChipPattern(normalised: string): { matched: true; artefact: boolean } | null {
  for (const pattern of ARTEFACT_CHIP_PATTERNS) {
    if (normalised.includes(pattern)) {
      return { matched: true, artefact: true };
    }
  }
  for (const pattern of UI_CHIP_PATTERNS) {
    if (normalised.includes(pattern)) {
      return { matched: true, artefact: false };
    }
  }
  return null;
}

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
 * 1. Chip passthrough detection — UI chip clicks always route to LLM.
 * 2. Brief detection for first-turn scenarios (no graph in context).
 * 3. Bare parameter assignment detection when a graph is present.
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
 * @param context.deterministicRoutingV2 - When true, enables V2 patterns (chip passthrough,
 *   adjective-only exclusion). Checked by caller from CEE_DETERMINISTIC_ROUTING_V2 flag.
 */
export function classifyIntentWithContext(
  message: string,
  context: { hasGraph: boolean; graphNodeLabels?: string[]; deterministicRoutingV2?: boolean },
): IntentGateResult {
  const normalised = normalise(message);

  // V2: Chip passthrough — check before all other routing so chip clicks always go to LLM
  if (context.deterministicRoutingV2) {
    const chipMatch = matchChipPattern(normalised);
    if (chipMatch) {
      return {
        tool: null,
        routing: 'llm',
        confidence: 'none',
        normalised_message: normalised,
        matched_pattern: 'chip_passthrough',
        chip_origin: true,
        chip_artefact: chipMatch.artefact,
      };
    }
  }

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

      if (patternMatches && !isAdjectiveOnlyAssignment(normalised)) {
        // Only route deterministically when exactly one node label overlaps —
        // ambiguous multi-node matches fall through to LLM for disambiguation.
        if (hasExactlyOneNodeOverlap(normalised, context.graphNodeLabels)) {
          return {
            tool: 'edit_graph',
            routing: 'deterministic',
            confidence: 'high',
            normalised_message: normalised,
            matched_pattern: 'parameter_assignment',
          };
        }
      }
    }
  }

  return result;
}
