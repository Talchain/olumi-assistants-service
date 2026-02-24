/**
 * Intent Gate — Deterministic Routing with LLM Fallback
 *
 * High-precision deterministic routing for common commands.
 * Everything that doesn't match a deterministic pattern falls through to LLM.
 *
 * Patterns (normalised: lowercase, trimmed, stripped trailing punctuation):
 *
 * | Pattern                                            | Tool           | Match style              |
 * |----------------------------------------------------|----------------|--------------------------|
 * | run / analyse / analyze / run the analysis / etc.  | run_analysis   | Full-message or start    |
 * | undo / undo that / undo last change                | undo_patch     | Full-message             |
 * | generate brief / write the brief / create brief    | generate_brief | Full-message or start    |
 * | draft / build the model / create a model / etc.    | draft_graph    | Full-message or start    |
 *
 * undo_patch is deterministic-only — NOT in LLM tool definitions.
 *
 * Required negative tests (must NOT match deterministically):
 * - "I want to run a marathon" → LLM
 * - "can you analyze why my draft failed" → LLM
 * - "undo my understanding of X" → LLM
 * - "can you run through the results?" → LLM
 */

import { log } from "../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export interface IntentResult {
  tool: string | null;
  routing: 'deterministic' | 'llm';
}

// ============================================================================
// Normalisation
// ============================================================================

/**
 * Normalise user message for pattern matching.
 * Lowercase, trim, strip trailing punctuation (. ! ? ,).
 */
function normalise(message: string): string {
  return message
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/, '')
    .trim();
}

// ============================================================================
// Pattern Definitions
// ============================================================================

/**
 * Full-message exact matches (after normalisation).
 * These are short, unambiguous commands.
 */
const EXACT_MATCHES: ReadonlyMap<string, string> = new Map([
  // run_analysis
  ['run', 'run_analysis'],
  ['run analysis', 'run_analysis'],
  ['run the analysis', 'run_analysis'],
  ['analyse', 'run_analysis'],
  ['analyze', 'run_analysis'],
  ['analyse it', 'run_analysis'],
  ['analyze it', 'run_analysis'],
  ['run it', 'run_analysis'],

  // undo_patch (deterministic-only — NOT in LLM tool registry)
  ['undo', 'undo_patch'],
  ['undo that', 'undo_patch'],
  ['undo last change', 'undo_patch'],
  ['undo the last change', 'undo_patch'],

  // generate_brief
  ['generate brief', 'generate_brief'],
  ['generate the brief', 'generate_brief'],
  ['write the brief', 'generate_brief'],
  ['write a brief', 'generate_brief'],
  ['create brief', 'generate_brief'],
  ['create the brief', 'generate_brief'],
  ['create a brief', 'generate_brief'],

  // draft_graph
  ['draft', 'draft_graph'],
  ['draft the graph', 'draft_graph'],
  ['draft the model', 'draft_graph'],
  ['draft a model', 'draft_graph'],
  ['build the model', 'draft_graph'],
  ['build a model', 'draft_graph'],
  ['create a model', 'draft_graph'],
  ['create the model', 'draft_graph'],
]);

/**
 * Start-of-message prefix patterns.
 * Must be followed by end-of-string or whitespace that doesn't form
 * a longer phrase that changes meaning.
 *
 * Kept conservative to avoid false positives like "run a marathon".
 */
const PREFIX_PATTERNS: ReadonlyArray<{ prefix: string; tool: string; requireEndOrPreposition: boolean }> = [
  // "run analysis with..." / "run the analysis for..."
  { prefix: 'run analysis', tool: 'run_analysis', requireEndOrPreposition: true },
  { prefix: 'run the analysis', tool: 'run_analysis', requireEndOrPreposition: true },

  // "generate brief for..." / "generate the brief with..."
  { prefix: 'generate brief', tool: 'generate_brief', requireEndOrPreposition: true },
  { prefix: 'generate the brief', tool: 'generate_brief', requireEndOrPreposition: true },
  { prefix: 'generate a brief', tool: 'generate_brief', requireEndOrPreposition: true },

  // "draft the graph for..." / "draft a model of..."
  { prefix: 'draft the graph', tool: 'draft_graph', requireEndOrPreposition: true },
  { prefix: 'draft a model', tool: 'draft_graph', requireEndOrPreposition: true },
  { prefix: 'draft the model', tool: 'draft_graph', requireEndOrPreposition: true },
];

/**
 * Prepositions that indicate the rest of the message parameterises the command.
 * e.g. "run analysis with 1000 samples" → still run_analysis
 */
const COMMAND_PREPOSITIONS = new Set([
  'with', 'for', 'using', 'on', 'again', 'now', 'please',
]);

// ============================================================================
// Gate Logic
// ============================================================================

/**
 * Resolve user intent via deterministic pattern matching.
 *
 * Returns { tool, routing: 'deterministic' } if a pattern matches,
 * or { tool: null, routing: 'llm' } for LLM fallback.
 */
export function resolveIntent(message: string): IntentResult {
  const normalised = normalise(message);

  // 1. Try exact match first (highest precision)
  const exactTool = EXACT_MATCHES.get(normalised);
  if (exactTool) {
    log.debug({ normalised, tool: exactTool }, "Intent gate: exact match");
    return { tool: exactTool, routing: 'deterministic' };
  }

  // 2. Try prefix patterns
  for (const { prefix, tool, requireEndOrPreposition } of PREFIX_PATTERNS) {
    if (!normalised.startsWith(prefix)) continue;

    const remainder = normalised.slice(prefix.length).trim();

    // Exact prefix match (nothing after)
    if (remainder === '') {
      log.debug({ normalised, tool, prefix }, "Intent gate: prefix match (exact)");
      return { tool, routing: 'deterministic' };
    }

    // Prefix followed by preposition → still the command
    if (requireEndOrPreposition) {
      const firstWord = remainder.split(/\s+/)[0];
      if (COMMAND_PREPOSITIONS.has(firstWord)) {
        log.debug({ normalised, tool, prefix, remainder }, "Intent gate: prefix match (preposition)");
        return { tool, routing: 'deterministic' };
      }
    }
  }

  // 3. No match → LLM fallback
  return { tool: null, routing: 'llm' };
}
