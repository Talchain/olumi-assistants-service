/**
 * Intervention Extractor
 *
 * Extracts intervention mappings from option text by:
 * 1. Parsing numeric values from text
 * 2. Identifying factor targets mentioned
 * 3. Matching targets to graph nodes
 * 4. Determining option status
 */

import type {
  NodeV3T,
  EdgeV3T,
  InterventionV3T,
  OptionV3T,
  TargetMatchT,
} from "../../schemas/cee-v3.js";
import { parseNumericValue, resolveRelativeValue, type ParsedValue, type RelativeKind } from "./numeric-parser.js";
import { matchInterventionToFactor } from "./factor-matcher.js";
import { normalizeToId } from "../utils/id-normalizer.js";

/**
 * Raw extracted intervention before graph matching.
 */
export interface RawExtractedIntervention {
  /** Target text from the option (e.g., "price", "marketing spend") */
  target_text: string;
  /** Parsed numeric value (if found) */
  value: ParsedValue | null;
  /** Source of extraction */
  source: "brief_extraction" | "cee_hypothesis" | "user_specified";
  /** Original text segment */
  original_segment: string;
}

/**
 * Edge hint from V1 graph (option→factor edges that can inform intervention matching).
 */
export interface EdgeHint {
  /** The option node ID this edge comes from */
  from_option_id: string;
  /** The factor node ID this edge points to */
  to_factor_id: string;
  /** Edge weight from V1 (can indicate strength of relationship) */
  weight?: number;
}

/**
 * Option with interventions after extraction and matching.
 */
export interface ExtractedOption {
  /** Generated option ID */
  id: string;
  /** Option label */
  label: string;
  /** Option description (if available) */
  description?: string;
  /** Option status */
  status: "ready" | "needs_user_mapping";
  /** Matched interventions keyed by factor ID */
  interventions: Record<string, InterventionV3T>;
  /** Targets that couldn't be matched */
  unresolved_targets?: string[];
  /** Questions for the user */
  user_questions?: string[];
  /** Provenance */
  provenance?: {
    source: "brief_extraction" | "cee_hypothesis" | "user_specified";
    brief_quote?: string;
  };
}

/**
 * Pattern definitions for extracting intervention targets and values.
 */
const INTERVENTION_PATTERNS = [
  // "set price to £59"
  {
    pattern: /\b(set|change|adjust|modify)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+to\s+([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
    targetGroup: 2,
    valueGroup: 3,
  },
  // "price of £59"
  {
    pattern: /\b(\w+(?:\s+\w+)?)\s+(?:of|at|to)\s+([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
    targetGroup: 1,
    valueGroup: 2,
  },
  // "£59 price"
  {
    pattern: /([£$€¥₹]\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?)\s+(\w+(?:\s+\w+)?)/gi,
    targetGroup: 2,
    valueGroup: 1,
  },
  // "increase price by 20%"
  {
    pattern: /\b(increase|decrease|reduce|raise|lower|cut|boost)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:by\s+)?(\d+(?:\.\d+)?%)/gi,
    targetGroup: 2,
    valueGroup: 0, // Full match needed for relative parsing
  },
  // "increase price to £59"
  {
    pattern: /\b(increase|decrease|reduce|raise|lower)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+to\s+([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?)/gi,
    targetGroup: 2,
    valueGroup: 3,
  },
];

/**
 * Words to skip when identifying targets.
 */
const SKIP_WORDS = new Set([
  "the", "a", "an", "to", "by", "at", "of", "for", "with", "from",
  "set", "change", "adjust", "modify", "increase", "decrease", "reduce", "raise", "lower", "cut", "boost",
]);

/**
 * Extract raw interventions from option text.
 *
 * @param optionText - Option label or description text
 * @param source - Source of the option
 * @returns Array of raw extracted interventions
 */
export function extractRawInterventions(
  optionText: string,
  source: "brief_extraction" | "cee_hypothesis" = "brief_extraction"
): RawExtractedIntervention[] {
  const results: RawExtractedIntervention[] = [];
  const processedSegments = new Set<string>();

  // Try each pattern
  for (const { pattern, targetGroup, valueGroup } of INTERVENTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;

    while ((match = regex.exec(optionText)) !== null) {
      const fullMatch = match[0];

      // Skip if already processed
      if (processedSegments.has(fullMatch.toLowerCase())) {
        continue;
      }
      processedSegments.add(fullMatch.toLowerCase());

      const targetText = cleanTargetText(match[targetGroup]);
      const valueText = valueGroup === 0 ? fullMatch : match[valueGroup];
      const value = parseNumericValue(valueText);

      if (targetText && !SKIP_WORDS.has(targetText.toLowerCase())) {
        results.push({
          target_text: targetText,
          value,
          source,
          original_segment: fullMatch,
        });
      }
    }
  }

  // If no patterns matched, try to extract any numeric values with nearby nouns
  if (results.length === 0) {
    const fallbackResults = extractFallbackInterventions(optionText, source);
    results.push(...fallbackResults);
  }

  return results;
}

/**
 * Clean target text by removing common prefixes/suffixes.
 */
function cleanTargetText(text: string): string {
  return text
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+(level|amount|value)$/i, "")
    .trim();
}

/**
 * Fallback extraction when no patterns match.
 */
function extractFallbackInterventions(
  text: string,
  source: "brief_extraction" | "cee_hypothesis"
): RawExtractedIntervention[] {
  const results: RawExtractedIntervention[] = [];

  // Find all numeric values
  const numericPattern = /([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/g;
  let match;

  while ((match = numericPattern.exec(text)) !== null) {
    const value = parseNumericValue(match[1]);
    if (!value) continue;

    // Look for a noun before or after the value
    const before = text.slice(Math.max(0, match.index - 30), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 30);

    const nounPattern = /\b([a-z]+(?:\s+[a-z]+)?)\b/gi;

    // Try to find a target in the text before the value
    const beforeMatches = [...before.matchAll(nounPattern)];
    const lastBefore = beforeMatches.length > 0 ? beforeMatches[beforeMatches.length - 1] : null;

    // Try to find a target in the text after the value
    const afterMatches = [...after.matchAll(nounPattern)];
    const firstAfter = afterMatches.length > 0 ? afterMatches[0] : null;

    const target = lastBefore?.[1] || firstAfter?.[1];
    if (target && !SKIP_WORDS.has(target.toLowerCase())) {
      results.push({
        target_text: target,
        value,
        source,
        original_segment: text.slice(
          Math.max(0, match.index - 20),
          Math.min(text.length, match.index + match[0].length + 20)
        ),
      });
    }
  }

  return results;
}

/**
 * Format a human-readable description of a relative value change.
 *
 * @param value - The parsed value containing relative information
 * @returns A description like "20% increase" or "2x multiplier"
 */
function formatRelativeDescription(value: ParsedValue): string {
  if (!value.isRelative) {
    return `value of ${value.value}`;
  }

  const direction = value.relativeDirection === "decrease" ? "decrease" : "increase";

  switch (value.relativeKind) {
    case "percent":
      return `${Math.abs(value.relativeValue ?? value.value)}% ${direction}`;
    case "multiplier":
      return `${value.relativeValue ?? value.value}x multiplier`;
    case "delta":
      return `${direction} of ${Math.abs(value.relativeValue ?? value.value)}`;
    default:
      // Fallback for legacy relative values
      if (value.relativeType === "percent") {
        return `${Math.abs(value.value)}% ${direction}`;
      }
      return `relative ${direction}`;
  }
}

/**
 * Extract interventions from an option and match to graph factors.
 *
 * @param optionLabel - Option label
 * @param optionDescription - Optional option description
 * @param nodes - Graph nodes
 * @param edges - Graph edges
 * @param goalNodeId - Goal node ID
 * @param existingIds - Set of existing option IDs
 * @param edgeHints - Optional V1 edges from this option to factors (high-confidence targets)
 * @returns Extracted option with matched interventions
 */
export function extractInterventionsForOption(
  optionLabel: string,
  optionDescription: string | undefined,
  nodes: NodeV3T[],
  edges: EdgeV3T[],
  goalNodeId: string,
  existingIds: Set<string> = new Set(),
  edgeHints: EdgeHint[] = []
): ExtractedOption {
  // Generate option ID
  const id = normalizeToId(optionLabel, existingIds);

  // Build set of hinted factor IDs for priority matching
  const hintedFactorIds = new Set(edgeHints.map(h => h.to_factor_id));

  // Extract raw interventions from label and description
  const rawFromLabel = extractRawInterventions(optionLabel, "brief_extraction");
  const rawFromDesc = optionDescription
    ? extractRawInterventions(optionDescription, "brief_extraction")
    : [];

  const allRaw = [...rawFromLabel, ...rawFromDesc];

  // Match interventions to factors
  const interventions: Record<string, InterventionV3T> = {};
  const unresolvedTargets: string[] = [];
  const userQuestions: string[] = [];

  for (const raw of allRaw) {
    const matchResult = matchInterventionToFactor(raw.target_text, nodes, edges, goalNodeId);

    // Boost confidence if the matched factor is in the edge hints
    const isHintedFactor = matchResult.node_id && hintedFactorIds.has(matchResult.node_id);
    const effectiveConfidence = isHintedFactor && matchResult.confidence !== "high"
      ? "high" as const  // Boost to high if hinted
      : matchResult.confidence;

    if (matchResult.matched && matchResult.node_id && raw.value) {
      const baseline = matchResult.matched_node?.observed_state?.value;
      const hasBaseline = baseline !== undefined;

      // P1-CEE-1: If value is relative but we have no baseline, do NOT emit an intervention
      if (raw.value.isRelative && !hasBaseline) {
        // Track as unresolved and generate user question
        unresolvedTargets.push(raw.target_text);

        // Generate specific question based on relative kind
        const factorLabel = matchResult.matched_node?.label || matchResult.node_id;
        const relativeDesc = formatRelativeDescription(raw.value);
        userQuestions.push(
          `What is the current ${factorLabel}? We need a baseline to apply the ${relativeDesc}.`
        );
        continue; // Do not emit intervention
      }

      // Resolve relative values if we have observed_state
      let finalValue = raw.value.value;
      if (raw.value.isRelative && hasBaseline) {
        finalValue = resolveRelativeValue(raw.value, baseline);
      }

      const targetMatch: TargetMatchT = {
        node_id: matchResult.node_id,
        match_type: isHintedFactor ? "exact_id" : matchResult.match_type as "exact_id" | "exact_label" | "semantic",
        confidence: effectiveConfidence,
      };

      interventions[matchResult.node_id] = {
        value: finalValue,
        unit: raw.value.unit,
        source: raw.source,
        target_match: targetMatch,
        value_confidence: raw.value.confidence,
        reasoning: raw.original_segment,
      };

      // Generate question if low confidence or no path to goal (unless boosted by hint)
      if (effectiveConfidence === "low") {
        userQuestions.push(
          `Is "${raw.target_text}" correctly mapped to the factor "${matchResult.matched_node?.label || matchResult.node_id}"?`
        );
      }
      if (!matchResult.has_path_to_goal && !isHintedFactor) {
        userQuestions.push(
          `The factor "${matchResult.matched_node?.label || matchResult.node_id}" doesn't have a path to the goal. Is this correct?`
        );
      }
    } else if (matchResult.matched && matchResult.node_id && !raw.value) {
      // Matched but no value - ask for value
      unresolvedTargets.push(raw.target_text);
      userQuestions.push(
        `What value should "${raw.target_text}" be set to for this option?`
      );
    } else {
      // Not matched
      unresolvedTargets.push(raw.target_text);
      userQuestions.push(
        `Which factor does "${raw.target_text}" correspond to in the decision model?`
      );
    }
  }

  // If no raw interventions found but we have edge hints, use hints to suggest targets
  if (allRaw.length === 0 && edgeHints.length > 0) {
    for (const hint of edgeHints) {
      const hintedNode = nodes.find(n => n.id === hint.to_factor_id);
      if (hintedNode) {
        userQuestions.push(
          `What value should "${hintedNode.label}" be set to for option "${optionLabel}"?`
        );
      }
    }
  }

  // Determine status
  const status = determineOptionStatus(interventions, unresolvedTargets, userQuestions);

  if (
    status === "needs_user_mapping" &&
    unresolvedTargets.length === 0 &&
    userQuestions.length === 0
  ) {
    userQuestions.push(
      `Which factor(s) does "${optionLabel}" change, and what value should each be set to?`
    );
  }

  const result: ExtractedOption = {
    id,
    label: optionLabel,
    status,
    interventions,
    provenance: {
      source: "brief_extraction",
    },
  };

  if (optionDescription) {
    result.description = optionDescription;
  }

  if (unresolvedTargets.length > 0) {
    result.unresolved_targets = unresolvedTargets;
  }

  if (userQuestions.length > 0) {
    result.user_questions = userQuestions;
  }

  return result;
}

/**
 * Determine option status based on interventions and unresolved targets.
 *
 * Rules:
 * - `ready`: Non-empty interventions, no critical issues
 * - `needs_user_mapping`: Empty interventions, unresolved targets, or low confidence matches
 */
function determineOptionStatus(
  interventions: Record<string, InterventionV3T>,
  unresolvedTargets: string[],
  userQuestions: string[]
): "ready" | "needs_user_mapping" {
  // No interventions at all
  if (Object.keys(interventions).length === 0) {
    return "needs_user_mapping";
  }

  // Has unresolved targets
  if (unresolvedTargets.length > 0) {
    return "needs_user_mapping";
  }

  // Has user questions (low confidence matches, missing paths, etc.)
  if (userQuestions.length > 0) {
    return "needs_user_mapping";
  }

  return "ready";
}

/**
 * Extract options from a list of option-like nodes.
 *
 * @param optionNodes - Nodes that represent options (kind='option' or similar)
 * @param allNodes - All graph nodes (for matching)
 * @param edges - Graph edges
 * @param goalNodeId - Goal node ID
 * @param edgeHints - Optional V1 edges from option→factor for improved targeting
 * @returns Array of extracted options
 */
export function extractOptionsFromNodes(
  optionNodes: Array<{ id?: string; label: string; description?: string; body?: string }>,
  allNodes: NodeV3T[],
  edges: EdgeV3T[],
  goalNodeId: string,
  edgeHints: EdgeHint[] = []
): ExtractedOption[] {
  const results: ExtractedOption[] = [];
  const usedIds = new Set<string>();

  for (const node of optionNodes) {
    const description = node.description || node.body;
    // Find edge hints for this option
    const hintsForOption = node.id
      ? edgeHints.filter(h => h.from_option_id === node.id)
      : [];

    const option = extractInterventionsForOption(
      node.label,
      description,
      allNodes,
      edges,
      goalNodeId,
      usedIds,
      hintsForOption
    );
    usedIds.add(option.id);
    results.push(option);
  }

  return results;
}

/**
 * Convert extracted option to V3 schema format.
 */
export function toOptionV3(extracted: ExtractedOption): OptionV3T {
  return {
    id: extracted.id,
    label: extracted.label,
    description: extracted.description,
    status: extracted.status,
    interventions: extracted.interventions,
    unresolved_targets: extracted.unresolved_targets,
    user_questions: extracted.user_questions,
    provenance: extracted.provenance,
  };
}

/**
 * Batch convert extracted options to V3 format.
 */
export function toOptionsV3(extracted: ExtractedOption[]): OptionV3T[] {
  return extracted.map(toOptionV3);
}

/**
 * Get extraction statistics for telemetry.
 */
export interface ExtractionStatistics {
  options_total: number;
  options_ready: number;
  options_needs_mapping: number;
  interventions_total: number;
  exact_id_matches: number;
  exact_label_matches: number;
  semantic_matches: number;
  unresolved_targets_total: number;
  user_questions_total: number;
}

export function getExtractionStatistics(options: ExtractedOption[]): ExtractionStatistics {
  const stats: ExtractionStatistics = {
    options_total: options.length,
    options_ready: 0,
    options_needs_mapping: 0,
    interventions_total: 0,
    exact_id_matches: 0,
    exact_label_matches: 0,
    semantic_matches: 0,
    unresolved_targets_total: 0,
    user_questions_total: 0,
  };

  for (const option of options) {
    if (option.status === "ready") {
      stats.options_ready++;
    } else {
      stats.options_needs_mapping++;
    }

    stats.unresolved_targets_total += option.unresolved_targets?.length || 0;
    stats.user_questions_total += option.user_questions?.length || 0;

    for (const intervention of Object.values(option.interventions)) {
      stats.interventions_total++;
      switch (intervention.target_match.match_type) {
        case "exact_id":
          stats.exact_id_matches++;
          break;
        case "exact_label":
          stats.exact_label_matches++;
          break;
        case "semantic":
          stats.semantic_matches++;
          break;
      }
    }
  }

  return stats;
}

// ============================================================================
// Price-Related Target Detection (for retry logic)
// ============================================================================

/**
 * Price-related synonyms for detecting when LLM missed a pricing factor.
 */
const PRICE_RELATED_TERMS = new Set([
  "price",
  "pricing",
  "cost",
  "fee",
  "rate",
  "subscription",
  "plan",
  "tier",
  "charge",
]);

/**
 * Check if any unresolved targets are price-related.
 * Used to trigger LLM retry with explicit factor requirement.
 *
 * @param options - Extracted options with potential unresolved_targets
 * @returns Object with detection result and specific terms found
 */
export function hasPriceRelatedUnresolvedTargets(
  options: ExtractedOption[]
): { detected: boolean; terms: string[] } {
  const foundTerms: string[] = [];

  for (const option of options) {
    if (!option.unresolved_targets) continue;

    for (const target of option.unresolved_targets) {
      const normalizedTarget = target.toLowerCase().trim();

      // Check if target matches any price-related term
      for (const term of PRICE_RELATED_TERMS) {
        if (normalizedTarget.includes(term) || term.includes(normalizedTarget)) {
          foundTerms.push(target);
          break;
        }
      }
    }
  }

  return {
    detected: foundTerms.length > 0,
    terms: [...new Set(foundTerms)], // Deduplicate
  };
}

/**
 * Generate a retry hint for the LLM when price-related targets are unresolved.
 *
 * @param terms - The unresolved price-related terms
 * @returns A hint string to append to the brief for retry
 */
export function generatePriceFactorHint(terms: string[]): string {
  const termList = terms.join(", ");
  return `\n\n[SYSTEM NOTE: The previous graph was missing a factor node for ${termList}. You MUST create a factor node (kind="factor") for this quantitative dimension. Example: { "id": "factor_price", "kind": "factor", "label": "Product Price", "data": { "value": <current_value>, "unit": "£" }}]`;
}
