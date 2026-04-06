/**
 * Response Normaliser
 *
 * Server-side guardrails applied to every deterministic pipeline response.
 */

import type { OrchestratorResponseEnvelope, SuggestedAction, TypedConversationBlock } from "../types.js";
import type { LLMJsonResponse } from "./types.js";
import { isValidAction } from "./actions/registry.js";
import { emit, log } from "../../utils/telemetry.js";

// ============================================================================
// Constants
// ============================================================================

const MAX_CHIPS = 3;
const MAX_INSIGHTS = 3;
const DEFAULT_TEXT = "I'm here to help with your decision. What would you like to explore?";

// ============================================================================
// Public API
// ============================================================================

/**
 * Normalise a response envelope — belt-and-braces guardrails.
 *
 * @param opts.v4Context — when provided, emits telemetry if DEFAULT_TEXT is used on a v4 turn.
 */
export function normaliseDeterministicResponse(
  envelope: OrchestratorResponseEnvelope,
  opts?: { v4Context?: { request_id: string; turn_id: string; execution_class: string } },
): OrchestratorResponseEnvelope {
  // 1. Empty text → default message
  if (!envelope.assistant_text || envelope.assistant_text.trim().length === 0) {
    envelope.assistant_text = DEFAULT_TEXT;

    if (opts?.v4Context) {
      log.warn({
        event: 'v4.normaliser_default_text_used',
        request_id: opts.v4Context.request_id,
        turn_id: opts.v4Context.turn_id,
        execution_class: opts.v4Context.execution_class,
      }, 'v4.normaliser_default_text_used');
    }
  }

  // 2. Strip any XML tags (belt-and-braces)
  envelope.assistant_text = stripXmlTags(envelope.assistant_text);

  // 3. Cap chips at MAX_CHIPS
  if (envelope.suggested_actions && envelope.suggested_actions.length > MAX_CHIPS) {
    envelope.suggested_actions = envelope.suggested_actions.slice(0, MAX_CHIPS);
  }

  // 4. Deduplicate blocks by type (keep first of each type)
  if (envelope.blocks.length > 0) {
    envelope.blocks = deduplicateBlocks(envelope.blocks);
  }

  // 5. Reject empty blocks
  envelope.blocks = envelope.blocks.filter((b) => !isEmptyBlock(b));

  // 6. Cap insights at 3
  if (envelope.insights && envelope.insights.length > MAX_INSIGHTS) {
    envelope.insights = envelope.insights.slice(0, MAX_INSIGHTS);
  }

  // 7. Validate suggested_actions reference valid actions
  if (envelope.suggested_actions) {
    envelope.suggested_actions = envelope.suggested_actions.filter((a) => {
      // Chip prompts are user-facing text, not action_type strings — always valid
      return a.label && a.label.trim().length > 0 && a.prompt && a.prompt.trim().length > 0;
    });
  }

  return envelope;
}

// ============================================================================
// Helpers
// ============================================================================

function stripXmlTags(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
}

function deduplicateBlocks(blocks: TypedConversationBlock[]): TypedConversationBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    // Allow multiple commentary blocks but deduplicate others
    if (block.block_type === 'commentary') return true;
    if (seen.has(block.block_type)) return false;
    seen.add(block.block_type);
    return true;
  });
}

function isEmptyBlock(block: TypedConversationBlock): boolean {
  switch (block.block_type) {
    case 'commentary': {
      // A commentary block is non-empty if it has EITHER substantive
      // narrative text OR at least one structured section with content.
      // The V4 explain_result action intentionally emits `narrative: ''`
      // and carries its content in `sections` — checking narrative alone
      // would silently drop those blocks from the envelope.
      const hasNarrative = !!block.data.narrative && block.data.narrative.trim().length > 0;
      const hasSections = Array.isArray(block.data.sections)
        && block.data.sections.some(
          (s) => (s.content && s.content.trim().length > 0)
            || (Array.isArray(s.items) && s.items.length > 0),
        );
      return !hasNarrative && !hasSections;
    }
    case 'graph_patch':
      return !block.data.operations || block.data.operations.length === 0;
    case 'fact':
      return !block.data.facts || block.data.facts.length === 0;
    default:
      return false;
  }
}

// ============================================================================
// Banned Term Scanner
// ============================================================================

const BANNED_TERMS: readonly string[] = Object.freeze([
  'TurnContext', 'blocks', 'chips', 'zones', 'CEE', 'PLoT', 'ISL',
  'Layer 0', 'Layer 1', 'Layer 2',
  'action_type', 'chip_metadata', 'response_version', 'eligible_actions', 'target_id',
  'exists_probability', 'voi', 'factor_sensitivity', 'recommendation_stability',
  'attribution_stability', 'rank_flip_rate', 'model_critiques', 'canonical_state',
  'headline_type', 'edge_e_values', 'dsk_claim_id', 'evidence_strength', 'E-value',
  'e_value', 'EVPI', 'evpi_percentage_points', 'conditional_winners', 'inference_warnings',
]);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pre-compiled word-boundary regexes for each banned term. */
const BANNED_REGEXES: Array<{ term: string; re: RegExp }> = BANNED_TERMS.map((term) => ({
  term,
  re: new RegExp('\\b' + escapeRegex(term) + '\\b', 'i'),
}));

/**
 * Scan user-visible surfaces of the LLM response for banned internal terms.
 * Scans: text, insights[].description, recommended_actions[].rationale.
 * Does NOT scan: science_concept, target_id (internal references).
 * Does NOT mutate any text.
 *
 * Returns array of matched term strings (empty if none).
 */
export function scanBannedTerms(
  llmResponse: LLMJsonResponse | null,
  envelope: OrchestratorResponseEnvelope,
  scenarioId: string,
  turnId: string,
): string[] {
  if (!llmResponse && !envelope.assistant_text) return [];

  // Collect all user-visible text surfaces
  const surfaces: string[] = [];
  if (envelope.assistant_text) surfaces.push(envelope.assistant_text);
  if (llmResponse?.insights) {
    for (const insight of llmResponse.insights) {
      if (insight.description) surfaces.push(insight.description);
    }
  }
  if (llmResponse?.recommended_actions) {
    for (const action of llmResponse.recommended_actions) {
      if (action.rationale) surfaces.push(action.rationale);
    }
  }

  const combined = surfaces.join(' ');
  const found: string[] = [];

  for (const { term, re } of BANNED_REGEXES) {
    if (re.test(combined)) {
      found.push(term);
      emit('deterministic.banned_term_detected', { term, scenario_id: scenarioId, turn_id: turnId });
    }
  }

  return found;
}
