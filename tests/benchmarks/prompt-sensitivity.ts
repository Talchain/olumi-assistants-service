/**
 * Prompt Sensitivity Measurement (Task 5)
 *
 * Deterministic, repeatable transformations applied to gold briefs:
 *   1. synonym_swap — replace domain nouns with fixed synonyms
 *   2. clause_reorder — swap major clause order at defined split point
 *   3. passive_voice — convert specified sentences to passive voice
 *
 * Each transformation is deterministic and stored alongside originals.
 */

import type { GoldBriefWithTransforms, SynonymMap } from "./gold-briefs/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransformationType = "synonym_swap" | "clause_reorder" | "passive_voice";

export interface TransformedBrief {
  /** Original brief ID */
  original_id: string;
  /** Which transformation was applied */
  transformation: TransformationType;
  /** The transformed text */
  text: string;
}

export interface SensitivityComparison {
  brief_id: string;
  transformation: TransformationType;
  /** Did the transformation break option count? */
  option_count_changed: boolean;
  /** Did the transformation break node set? */
  node_set_changed: boolean;
  /** Perturbation structural stability */
  perturbation_structural_stability: number;
  /** Average structural stability from seed-varied runs */
  seed_structural_stability: number;
  /** Is perturbation variation larger than seed variation? */
  perturbation_exceeds_seed: boolean;
}

// ---------------------------------------------------------------------------
// Transformation Functions
// ---------------------------------------------------------------------------

/**
 * 1. Synonym swap: replace key domain nouns with fixed synonyms.
 * Case-insensitive replacement using word boundaries.
 */
export function applySynonymSwap(text: string, synonymMap: SynonymMap): string {
  let result = text;
  for (const [original, replacement] of Object.entries(synonymMap)) {
    // Word-boundary-aware, case-insensitive replacement
    const regex = new RegExp(`\\b${escapeRegex(original)}\\b`, "gi");
    result = result.replace(regex, (match) => {
      // Preserve case of first character
      if (match[0] === match[0]!.toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }
  return result;
}

/**
 * 2. Clause reorder: swap the two halves of the brief at the defined split point.
 */
export function applyClauseReorder(text: string, splitIndex: number): string {
  if (splitIndex <= 0 || splitIndex >= text.length) return text;
  const first = text.slice(0, splitIndex).trim();
  const second = text.slice(splitIndex).trim();
  return `${second} ${first}`;
}

/**
 * 3. Passive voice: convert specified sentences to passive voice.
 * Simple heuristic: for each target sentence, prepend "It is the case that"
 * and lowercase the original sentence start.
 *
 * This is a deterministic approximation — real passive voice conversion
 * would require NLP, but we need reproducibility over linguistic accuracy.
 */
export function applyPassiveVoice(text: string, sentenceIndices: number[]): string {
  // Split on sentence boundaries (period + space or end of string)
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const result = sentences.map((sentence, idx) => {
    if (sentenceIndices.includes(idx)) {
      const trimmed = sentence.trim();
      // Lowercase first char, wrap in passive construction
      const passivised = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
      // Remove trailing period for re-wrapping
      const withoutEnd = passivised.replace(/[.!?]+$/, "");
      return `It is the case that ${withoutEnd}.`;
    }
    return sentence;
  });
  return result.join(" ").replace(/\s+/g, " ").trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Apply All Transformations
// ---------------------------------------------------------------------------

/**
 * Generate all three transformed versions of a gold brief.
 */
export function generateTransformedBriefs(
  brief: GoldBriefWithTransforms,
): TransformedBrief[] {
  const results: TransformedBrief[] = [];

  // Synonym swap
  if (brief.transformations.synonym_map) {
    results.push({
      original_id: brief.id,
      transformation: "synonym_swap",
      text: applySynonymSwap(brief.brief_text, brief.transformations.synonym_map),
    });
  }

  // Clause reorder
  if (brief.transformations.clause_split_index !== undefined) {
    results.push({
      original_id: brief.id,
      transformation: "clause_reorder",
      text: applyClauseReorder(brief.brief_text, brief.transformations.clause_split_index),
    });
  }

  // Passive voice
  if (brief.transformations.passive_voice_sentences) {
    results.push({
      original_id: brief.id,
      transformation: "passive_voice",
      text: applyPassiveVoice(brief.brief_text, brief.transformations.passive_voice_sentences),
    });
  }

  return results;
}
