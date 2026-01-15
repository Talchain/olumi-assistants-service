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
  InterventionValueTypeT,
  RawInterventionValueT,
} from "../../schemas/cee-v3.js";
import { parseNumericValue, resolveRelativeValue, type ParsedValue } from "./numeric-parser.js";
import { matchInterventionToFactor } from "./factor-matcher.js";
import { normalizeToId } from "../utils/id-normalizer.js";
import {
  computeOptionStatus,
  categorizeUserQuestions,
  type StatusComputationInput,
} from "../transforms/option-status.js";
import { log } from "../../utils/telemetry.js";

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
  /** Raw categorical/boolean value (for non-numeric interventions) */
  raw_categorical_value?: string | boolean;
  /** Value type for categorical/boolean interventions */
  value_type?: InterventionValueTypeT;
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
 *
 * Supports the Raw+Encoded pattern for categorical/boolean interventions:
 * - status: "needs_encoding" when raw values exist but aren't fully encoded
 * - raw_interventions: preserves original categorical/boolean values
 */
export interface ExtractedOption {
  /** Generated option ID */
  id: string;
  /** Option label */
  label: string;
  /** Option description (if available) */
  description?: string;
  /** Option status */
  status: "ready" | "needs_user_mapping" | "needs_encoding";
  /** Matched interventions keyed by factor ID */
  interventions: Record<string, InterventionV3T>;
  /** Raw intervention values (for categorical/boolean, before encoding) */
  raw_interventions?: Record<string, RawInterventionValueT>;
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
  // "set price to £59" or "keep price at £49"
  {
    pattern: /\b(set|change|adjust|modify|keep|maintain)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:to|at)\s+([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
    targetGroup: 2,
    valueGroup: 3,
  },
  // "price of £59" or "price at £59" (fallback without leading verb)
  {
    pattern: /\b(?!(?:set|change|adjust|modify|keep|maintain|increase|decrease|reduce|raise|lower|cut|boost)\s)(\w+(?:\s+\w+)?)\s+(?:of|at|to)\s+([£$€¥₹]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
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
  "set", "change", "adjust", "modify", "keep", "maintain",
  "increase", "decrease", "reduce", "raise", "lower", "cut", "boost",
]);

// ============================================================================
// Categorical Extraction Patterns (Raw+Encoded Pattern Support)
// ============================================================================

/**
 * Patterns for extracting categorical interventions (non-numeric values).
 * These extract target+value pairs where the value is a string, not a number.
 */
const CATEGORICAL_PATTERNS = [
  // "launch in UK" / "expand to Germany" / "enter Japan market"
  {
    pattern: /\b(launch|expand|enter|deploy|roll\s*out)\s+(?:in|to|into)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\b(?:\s+market)?/gi,
    targetType: "location" as const,
    targetGroup: 1, // The action verb indicates the target type
    valueGroup: 2,  // The location/region is the value
    factorHint: "region",
  },
  // "hire contractors" / "use freelancers" / "employ consultants"
  {
    pattern: /\b(hire|employ|use|engage|bring\s+on)\s+(\w+(?:\s+\w+)?)/gi,
    targetType: "staffing" as const,
    targetGroup: 1,
    valueGroup: 2,
    factorHint: "staffing_model",
  },
  // "use React" / "adopt TypeScript" / "choose Vue" / "select Python"
  {
    pattern: /\b(use|adopt|choose|select|switch\s+to|migrate\s+to)\s+(\w+(?:\.\w+)?)/gi,
    targetType: "technology" as const,
    targetGroup: 1,
    valueGroup: 2,
    factorHint: "technology",
  },
  // "build in-house" / "buy from vendor" / "outsource to agency"
  {
    pattern: /\b(build|develop|create)\s+(in-?house|internally)/gi,
    targetType: "build_vs_buy" as const,
    targetGroup: 0, // Full match
    valueGroup: 0,
    staticValue: "build",
    factorHint: "approach",
  },
  {
    pattern: /\b(buy|purchase|license|acquire)\s+(?:from\s+)?(?:a\s+)?(\w+)?/gi,
    targetType: "build_vs_buy" as const,
    targetGroup: 0,
    valueGroup: 0,
    staticValue: "buy",
    factorHint: "approach",
  },
  {
    pattern: /\b(outsource|contract\s+out|delegate)\s+(?:to\s+)?(\w+(?:\s+\w+)?)?/gi,
    targetType: "build_vs_buy" as const,
    targetGroup: 0,
    valueGroup: 2,
    staticValue: "outsource",
    factorHint: "approach",
  },
];

/**
 * Boolean patterns for enable/disable style interventions.
 */
const BOOLEAN_PATTERNS = [
  // "enable feature X" / "disable dark mode" / "turn on notifications"
  {
    pattern: /\b(enable|activate|turn\s+on|switch\s+on)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/gi,
    booleanValue: true,
    targetGroup: 2,
  },
  {
    pattern: /\b(disable|deactivate|turn\s+off|switch\s+off)\s+(?:the\s+)?(\w+(?:\s+\w+)?)/gi,
    booleanValue: false,
    targetGroup: 2,
  },
  // "with feature X" / "without feature X"
  {
    pattern: /\b(with)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:feature|option|flag)/gi,
    booleanValue: true,
    targetGroup: 2,
  },
  {
    pattern: /\b(without)\s+(?:the\s+)?(\w+(?:\s+\w+)?)\s+(?:feature|option|flag)?/gi,
    booleanValue: false,
    targetGroup: 2,
  },
];

/**
 * Default encoding maps for common categorical dimensions.
 * These provide sensible numeric encodings when the user hasn't specified one.
 */
const DEFAULT_ENCODING_MAPS: Record<string, Record<string, number>> = {
  build_vs_buy: { build: 0, buy: 1, outsource: 2 },
  boolean: { false: 0, true: 1 },
};

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

// ============================================================================
// Categorical/Boolean Extraction (Raw+Encoded Pattern Support)
// ============================================================================

/**
 * Extract categorical interventions from option text.
 * These represent non-numeric values like locations, technologies, or choices.
 *
 * @param optionText - Option label or description text
 * @param source - Source of the option
 * @returns Array of raw extracted interventions with categorical values
 */
export function extractCategoricalInterventions(
  optionText: string,
  source: "brief_extraction" | "cee_hypothesis" = "brief_extraction"
): RawExtractedIntervention[] {
  const results: RawExtractedIntervention[] = [];
  const processedSegments = new Set<string>();

  // Try categorical patterns
  for (const patternDef of CATEGORICAL_PATTERNS) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(optionText)) !== null) {
      const fullMatch = match[0];

      // Skip if already processed
      if (processedSegments.has(fullMatch.toLowerCase())) {
        continue;
      }
      processedSegments.add(fullMatch.toLowerCase());

      // Extract the categorical value
      const rawValue = (patternDef as any).staticValue
        ? (patternDef as any).staticValue
        : cleanTargetText(match[patternDef.valueGroup] || fullMatch);

      if (!rawValue || rawValue.length === 0) {
        continue;
      }

      results.push({
        target_text: patternDef.factorHint,
        value: null, // No numeric value yet - needs encoding
        source,
        original_segment: fullMatch,
        raw_categorical_value: rawValue,
        value_type: "categorical",
      });
    }
  }

  // Try boolean patterns
  for (const patternDef of BOOLEAN_PATTERNS) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match;

    while ((match = regex.exec(optionText)) !== null) {
      const fullMatch = match[0];

      // Skip if already processed
      if (processedSegments.has(fullMatch.toLowerCase())) {
        continue;
      }
      processedSegments.add(fullMatch.toLowerCase());

      const targetText = cleanTargetText(match[patternDef.targetGroup] || "feature");

      results.push({
        target_text: targetText,
        value: null, // Will be encoded as 0/1
        source,
        original_segment: fullMatch,
        raw_categorical_value: patternDef.booleanValue,
        value_type: "boolean",
      });
    }
  }

  return results;
}

/**
 * Get default numeric encoding for a categorical value.
 * Returns undefined if no default encoding exists.
 */
function getDefaultEncoding(
  valueType: InterventionValueTypeT,
  rawValue: string | boolean,
  targetType?: string
): number | undefined {
  if (valueType === "boolean") {
    return rawValue ? 1 : 0;
  }

  if (targetType && DEFAULT_ENCODING_MAPS[targetType]) {
    const encoding = DEFAULT_ENCODING_MAPS[targetType][String(rawValue).toLowerCase()];
    if (encoding !== undefined) {
      return encoding;
    }
  }

  // No default encoding available
  return undefined;
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
 * Build interventions directly from V4 prompt data.
 *
 * V4 prompt instructs LLM to return option nodes with `data.interventions`
 * containing direct factor ID -> numeric value mappings. This provides
 * high-confidence interventions without text extraction.
 *
 * @param optionId - Option ID
 * @param optionLabel - Option label
 * @param v4Interventions - Direct factor -> value mapping from LLM
 * @param factors - All factor nodes for validation
 * @returns ExtractedOption with V4 interventions
 */
function buildInterventionsFromV4Data(
  optionId: string,
  optionLabel: string,
  v4Interventions: Record<string, number>,
  factors: NodeV3T[]
): ExtractedOption {
  const interventions: Record<string, InterventionV3T> = {};
  const factorIds = new Set(factors.map((f) => f.id));
  const missingFactors: string[] = [];

  for (const [factorId, value] of Object.entries(v4Interventions)) {
    // Validate factor exists in graph
    if (!factorIds.has(factorId)) {
      log.warn(
        { factorId, optionId, optionLabel },
        "V4 intervention targets non-existent factor"
      );
      missingFactors.push(factorId);
      continue;
    }

    // Get factor node for context
    const factor = factors.find((f) => f.id === factorId);

    interventions[factorId] = {
      value,
      unit: factor?.observed_state?.unit,
      source: "brief_extraction", // V4 prompt extracts from brief
      target_match: {
        node_id: factorId,
        match_type: "exact_id", // LLM provided exact ID
        confidence: "high", // Direct from V4 prompt = high confidence
      },
      value_confidence: "high",
      reasoning: "Direct from V4 prompt data.interventions",
    };
  }

  const hasInterventions = Object.keys(interventions).length > 0;
  const status = hasInterventions ? "ready" : "needs_user_mapping";

  return {
    id: optionId,
    label: optionLabel,
    interventions,
    status,
    unresolved_targets: missingFactors.length > 0 ? missingFactors : undefined,
    provenance: {
      source: "brief_extraction",
    },
  };
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
 * @param v4Interventions - Optional direct interventions from V4 prompt
 * @param nodeId - Optional node ID from graph (used to ensure option.id matches node.id)
 * @returns Extracted option with matched interventions
 */
export function extractInterventionsForOption(
  optionLabel: string,
  optionDescription: string | undefined,
  nodes: NodeV3T[],
  edges: EdgeV3T[],
  goalNodeId: string,
  existingIds: Set<string> = new Set(),
  edgeHints: EdgeHint[] = [],
  v4Interventions?: Record<string, number>,
  nodeId?: string
): ExtractedOption {
  // Use node ID if provided (ensures option.id matches graph node.id)
  // Fallback to normalized label for backwards compatibility
  const id = nodeId ?? normalizeToId(optionLabel, existingIds);

  // V4 prompt: If interventions are provided directly, use them (high confidence)
  if (v4Interventions && Object.keys(v4Interventions).length > 0) {
    const factors = nodes.filter((n) => n.kind === "factor");
    return buildInterventionsFromV4Data(id, optionLabel, v4Interventions, factors);
  }

  // Fallback: Extract interventions from text (legacy path)
  // Build set of hinted factor IDs for priority matching
  const hintedFactorIds = new Set(edgeHints.map(h => h.to_factor_id));

  // Extract raw numeric interventions from label and description
  const rawFromLabel = extractRawInterventions(optionLabel, "brief_extraction");
  const rawFromDesc = optionDescription
    ? extractRawInterventions(optionDescription, "brief_extraction")
    : [];

  // Extract categorical/boolean interventions (Raw+Encoded pattern)
  const catFromLabel = extractCategoricalInterventions(optionLabel, "brief_extraction");
  const catFromDesc = optionDescription
    ? extractCategoricalInterventions(optionDescription, "brief_extraction")
    : [];

  const allRaw = [...rawFromLabel, ...rawFromDesc];
  const allCategorical = [...catFromLabel, ...catFromDesc];

  // Match interventions to factors
  const interventions: Record<string, InterventionV3T> = {};
  const rawInterventions: Record<string, RawInterventionValueT> = {};
  const unresolvedTargets: string[] = [];
  const userQuestions: string[] = [];
  let hasNonNumericRaw = false;

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

  // Process categorical/boolean interventions (Raw+Encoded pattern)
  for (const cat of allCategorical) {
    if (!cat.raw_categorical_value || !cat.value_type) {
      continue;
    }

    // Try to match to a factor node
    const matchResult = matchInterventionToFactor(cat.target_text, nodes, edges, goalNodeId);

    // Determine factor ID - use matched node or generate from target
    const factorId = matchResult.matched && matchResult.node_id
      ? matchResult.node_id
      : normalizeToId(`factor_${cat.target_text}`, new Set(Object.keys(interventions)));

    // Try to get a default encoding
    const defaultEncoding = getDefaultEncoding(
      cat.value_type,
      cat.raw_categorical_value,
      cat.target_text
    );

    // Track the raw value (always)
    rawInterventions[factorId] = cat.raw_categorical_value;
    hasNonNumericRaw = hasNonNumericRaw || typeof cat.raw_categorical_value !== "number";

    if (defaultEncoding !== undefined) {
      // We have a default encoding - create intervention with raw_value
      const targetMatch: TargetMatchT = matchResult.matched && matchResult.node_id
        ? {
            node_id: matchResult.node_id,
            match_type: matchResult.match_type as "exact_id" | "exact_label" | "semantic",
            confidence: matchResult.confidence,
          }
        : {
            node_id: factorId,
            match_type: "semantic" as const,
            confidence: "low" as const,
          };

      interventions[factorId] = {
        value: defaultEncoding,
        source: cat.source,
        target_match: targetMatch,
        value_confidence: "medium",
        reasoning: cat.original_segment,
        raw_value: cat.raw_categorical_value,
        value_type: cat.value_type,
      };

      // Generate encoding question for non-default categories
      if (cat.value_type === "categorical" && !DEFAULT_ENCODING_MAPS[cat.target_text]) {
        userQuestions.push(
          `How should "${cat.raw_categorical_value}" be encoded numerically for "${cat.target_text}"?`
        );
      }
    } else {
      // No default encoding - mark as needing encoding
      // Still create a placeholder intervention with value=0
      const targetMatch: TargetMatchT = matchResult.matched && matchResult.node_id
        ? {
            node_id: matchResult.node_id,
            match_type: matchResult.match_type as "exact_id" | "exact_label" | "semantic",
            confidence: matchResult.confidence,
          }
        : {
            node_id: factorId,
            match_type: "semantic" as const,
            confidence: "low" as const,
          };

      interventions[factorId] = {
        value: 0, // Placeholder - needs encoding
        source: cat.source,
        target_match: targetMatch,
        value_confidence: "low",
        reasoning: cat.original_segment,
        raw_value: cat.raw_categorical_value,
        value_type: cat.value_type,
      };

      userQuestions.push(
        `How should "${cat.raw_categorical_value}" be encoded numerically for "${cat.target_text}"?`
      );
    }
  }

  // Determine status (now considers categorical/raw values)
  const status = determineOptionStatus(interventions, unresolvedTargets, userQuestions, hasNonNumericRaw);

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

  // Add raw_interventions if any categorical/boolean values were extracted
  if (Object.keys(rawInterventions).length > 0) {
    result.raw_interventions = rawInterventions;
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
 * Uses the shared computeOptionStatus() utility for consistent status computation
 * across draft-graph and graph-readiness endpoints.
 *
 * KEY RULE: Both exact_id AND exact_label matches count as "resolved".
 * Only semantic matches or unmatched targets block "ready" status.
 *
 * Status priority (highest to lowest):
 * 1. `needs_user_mapping`: No interventions, only semantic matches, or blocking questions
 * 2. `needs_encoding`: Has non-numeric raw values (categorical/boolean) awaiting encoding
 * 3. `ready`: Has at least one resolved intervention (exact_id or exact_label match)
 *
 * @param interventions - Matched interventions
 * @param unresolvedTargets - Targets that couldn't be matched
 * @param userQuestions - Questions for the user (both blocking and informational)
 * @param hasNonNumericRaw - Whether any non-numeric raw values exist
 */
function determineOptionStatus(
  interventions: Record<string, InterventionV3T>,
  unresolvedTargets: string[],
  userQuestions: string[],
  hasNonNumericRaw: boolean = false
): "ready" | "needs_user_mapping" | "needs_encoding" {
  // Categorize questions: blocking vs informational
  // Blocking: "What value should X be set to?" - requires user input
  // Informational: "Is X correctly mapped to Y?" - just confirmation, doesn't block
  const { blocking } = categorizeUserQuestions(userQuestions);

  // Check for categorical interventions that need encoding
  const needsEncodingCheck = Object.values(interventions).some(
    (i) => i.raw_value !== undefined && i.value_type === "categorical"
  );

  // Build input for shared status computation
  const input: StatusComputationInput = {
    interventions,
    unresolvedTargets,
    hasNonNumericRaw: hasNonNumericRaw || needsEncodingCheck,
    blockingQuestions: blocking,
  };

  // Use shared utility for consistent status computation
  const result = computeOptionStatus(input);
  return result.status;
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
  optionNodes: Array<{
    id?: string;
    label: string;
    description?: string;
    body?: string;
    v4Interventions?: Record<string, number>;
  }>,
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
      hintsForOption,
      node.v4Interventions,
      node.id
    );
    usedIds.add(option.id);
    results.push(option);
  }

  return results;
}

/**
 * Convert extracted option to V3 schema format.
 * Includes raw_interventions for Raw+Encoded pattern support.
 */
export function toOptionV3(extracted: ExtractedOption): OptionV3T {
  const result: OptionV3T = {
    id: extracted.id,
    label: extracted.label,
    description: extracted.description,
    status: extracted.status,
    interventions: extracted.interventions,
    unresolved_targets: extracted.unresolved_targets,
    user_questions: extracted.user_questions,
    provenance: extracted.provenance,
  };

  // Add raw_interventions if present (Raw+Encoded pattern)
  if (extracted.raw_interventions && Object.keys(extracted.raw_interventions).length > 0) {
    result.raw_interventions = extracted.raw_interventions;
  }

  return result;
}

/**
 * Batch convert extracted options to V3 format.
 */
export function toOptionsV3(extracted: ExtractedOption[]): OptionV3T[] {
  return extracted.map(toOptionV3);
}

/**
 * Get extraction statistics for telemetry.
 * Includes categorical/boolean stats for Raw+Encoded pattern adoption tracking.
 */
export interface ExtractionStatistics {
  options_total: number;
  options_ready: number;
  options_needs_mapping: number;
  options_needs_encoding: number;
  interventions_total: number;
  exact_id_matches: number;
  exact_label_matches: number;
  semantic_matches: number;
  unresolved_targets_total: number;
  user_questions_total: number;
  // Raw+Encoded pattern stats
  raw_interventions_total: number;
  categorical_interventions: number;
  boolean_interventions: number;
  options_with_raw_values: number;
}

export function getExtractionStatistics(options: ExtractedOption[]): ExtractionStatistics {
  const stats: ExtractionStatistics = {
    options_total: options.length,
    options_ready: 0,
    options_needs_mapping: 0,
    options_needs_encoding: 0,
    interventions_total: 0,
    exact_id_matches: 0,
    exact_label_matches: 0,
    semantic_matches: 0,
    unresolved_targets_total: 0,
    user_questions_total: 0,
    // Raw+Encoded pattern stats
    raw_interventions_total: 0,
    categorical_interventions: 0,
    boolean_interventions: 0,
    options_with_raw_values: 0,
  };

  for (const option of options) {
    // Track status distribution
    switch (option.status) {
      case "ready":
        stats.options_ready++;
        break;
      case "needs_encoding":
        stats.options_needs_encoding++;
        break;
      case "needs_user_mapping":
      default:
        stats.options_needs_mapping++;
        break;
    }

    stats.unresolved_targets_total += option.unresolved_targets?.length || 0;
    stats.user_questions_total += option.user_questions?.length || 0;

    // Track raw_interventions (Raw+Encoded pattern)
    if (option.raw_interventions && Object.keys(option.raw_interventions).length > 0) {
      stats.options_with_raw_values++;
      stats.raw_interventions_total += Object.keys(option.raw_interventions).length;
    }

    for (const intervention of Object.values(option.interventions)) {
      stats.interventions_total++;

      // Track match types
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

      // Track value types (Raw+Encoded pattern)
      if (intervention.value_type === "categorical") {
        stats.categorical_interventions++;
      } else if (intervention.value_type === "boolean") {
        stats.boolean_interventions++;
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
