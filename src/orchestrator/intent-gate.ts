/**
 * Intent Gate — Deterministic Routing with LLM Fallback
 *
 * Strict whole-message equality matching against a frozen pattern table.
 * No prefix matching, no substring matching, no word-count guards.
 * Pure function — no side effects, no logging, no async, no dependencies.
 *
 * | Tool             | Example patterns (after normalisation)                              |
 * |------------------|---------------------------------------------------------------------|
 * | run_analysis     | run it, analyse, analyze, run the analysis, simulate, ...           |
 * | draft_graph      | draft, draft a model, build the model, start over, new model, ...  |
 * | generate_brief   | brief, summary, generate brief, write the brief, write report, ... |
 * | explain_results  | explain, why, break it down, explain the results, ...              |
 * | edit_graph       | edit, modify, change, update the model, edit model, ...            |
 * | run_exercise     | pre-mortem, devil's advocate, disconfirmation, ...                  |
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

export type ToolName = 'draft_graph' | 'edit_graph' | 'run_analysis' | 'explain_results' | 'generate_brief' | 'run_exercise';

export type ExerciseType = 'pre_mortem' | 'devil_advocate' | 'disconfirmation';

export interface IntentGateResult {
  tool: ToolName | null;
  routing: 'deterministic' | 'llm';
  confidence: 'exact' | 'none';
  normalised_message: string;
  matched_pattern?: string;
  /** Populated when tool === 'run_exercise' — the specific exercise type to run. */
  exercise?: ExerciseType;
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
  ['write the brief', 'generate_brief'],
  ['create brief', 'generate_brief'],
  ['brief', 'generate_brief'],
  ['summary', 'generate_brief'],
  ['write a summary', 'generate_brief'],
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
// Startup Validation
// ============================================================================

/**
 * Get all unique tool names referenced in the intent gate pattern table.
 * Used by startup validation to check against the tool registry.
 */
export function getGateToolNames(): string[] {
  return [...new Set(_patterns.map(([, tool]) => tool))];
}

// ============================================================================
// Gate Logic
// ============================================================================

/**
 * Classify user intent via strict whole-message equality matching.
 *
 * Pure function — no side effects, no async, no external dependencies.
 * Returns { tool, routing: 'deterministic', confidence: 'exact' } on match,
 * or { tool: null, routing: 'llm', confidence: 'none' } for LLM fallback.
 */
export function classifyIntent(message: string): IntentGateResult {
  const normalised = normalise(message);

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

  return {
    tool: null,
    routing: 'llm',
    confidence: 'none',
    normalised_message: normalised,
  };
}
