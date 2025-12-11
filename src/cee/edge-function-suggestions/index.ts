/**
 * CEE Edge Function Suggestions
 *
 * Suggests non-linear edge function types based on pattern matching
 * of node labels and relationship descriptions. Supports:
 * - linear (default)
 * - diminishing_returns (saturation effects)
 * - threshold (minimum requirements)
 * - s_curve (adoption/tipping points)
 *
 * Pure pattern matching - no LLM calls.
 */

export type EdgeFunctionType =
  | "linear"
  | "diminishing_returns"
  | "threshold"
  | "s_curve";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface EdgeFunctionParams {
  k?: number;
  threshold?: number;
  slope?: number;
  midpoint?: number;
}

export interface NodeInfo {
  id: string;
  label: string;
  kind: string;
}

export interface EdgeFunctionSuggestionInput {
  edge_id: string;
  source_node: NodeInfo;
  target_node: NodeInfo;
  relationship_description?: string;
}

export interface EdgeFunctionAlternative {
  function_type: EdgeFunctionType;
  params: EdgeFunctionParams;
  reasoning: string;
}

export interface EdgeFunctionSuggestionOutput {
  suggested_function: EdgeFunctionType;
  suggested_params: EdgeFunctionParams;
  reasoning: string;
  alternatives: EdgeFunctionAlternative[];
  confidence: ConfidenceLevel;
  provenance: "cee";
}

// Pattern definitions for each function type
interface PatternMatch {
  functionType: EdgeFunctionType;
  params: EdgeFunctionParams;
  keywords: string[];
  reasoning: string;
  weight: number; // Higher weight = stronger match
}

const PATTERN_MATCHES: PatternMatch[] = [
  // Diminishing returns patterns
  {
    functionType: "diminishing_returns",
    params: { k: 2.0 },
    keywords: [
      "diminishing",
      "saturates",
      "saturation",
      "diminishes",
      "diminished",
      "marginal",
      "decreasing returns",
      "law of diminishing",
      "plateau",
      "levels off",
      "caps out",
      "maxes out",
    ],
    reasoning:
      "Relationship shows diminishing returns pattern - initial inputs have strong effects that taper off",
    weight: 10,
  },
  // Threshold patterns
  {
    functionType: "threshold",
    params: { threshold: 0.5, slope: 1.0 },
    keywords: [
      "threshold",
      "minimum",
      "critical",
      "required",
      "prerequisite",
      "must reach",
      "at least",
      "floor",
      "baseline",
      "cutoff",
      "qualifying",
      "hurdle",
    ],
    reasoning:
      "Relationship has a threshold effect - output only activates after input reaches critical level",
    weight: 10,
  },
  // S-curve patterns
  {
    functionType: "s_curve",
    params: { k: 5.0, midpoint: 0.5 },
    keywords: [
      "tipping point",
      "adoption curve",
      "s-curve",
      "sigmoid",
      "viral",
      "network effect",
      "exponential then plateau",
      "takes off",
      "hockey stick",
      "inflection point",
      "critical mass",
      "snowball",
    ],
    reasoning:
      "Relationship follows S-curve pattern - slow start, rapid middle growth, then saturation",
    weight: 10,
  },
];

// Semantic signals from node kinds
const KIND_SIGNALS: Record<string, { functionType: EdgeFunctionType; weight: number }[]> = {
  risk: [
    { functionType: "threshold", weight: 3 },
    { functionType: "s_curve", weight: 2 },
  ],
  outcome: [
    { functionType: "diminishing_returns", weight: 2 },
  ],
  option: [
    { functionType: "linear", weight: 1 },
  ],
  // Factor nodes (external uncertainties) often have non-linear effects
  factor: [
    { functionType: "s_curve", weight: 3 },       // Market conditions often follow adoption curves
    { functionType: "threshold", weight: 2 },     // Regulatory factors have threshold effects
    { functionType: "diminishing_returns", weight: 2 }, // Resource constraints saturate
  ],
  action: [
    { functionType: "diminishing_returns", weight: 2 }, // Repeated actions have diminishing impact
    { functionType: "linear", weight: 1 },
  ],
};

// Label patterns that suggest specific functions
const LABEL_PATTERNS: { pattern: RegExp; functionType: EdgeFunctionType; weight: number }[] = [
  // Diminishing returns
  { pattern: /cost|expense|spending|investment/i, functionType: "diminishing_returns", weight: 3 },
  { pattern: /training|learning|skill/i, functionType: "diminishing_returns", weight: 3 },
  { pattern: /quality|performance/i, functionType: "diminishing_returns", weight: 2 },

  // Threshold
  { pattern: /compliance|regulation|legal/i, functionType: "threshold", weight: 4 },
  { pattern: /safety|security|risk/i, functionType: "threshold", weight: 3 },
  { pattern: /qualification|certification/i, functionType: "threshold", weight: 4 },

  // S-curve
  { pattern: /market share|adoption|growth/i, functionType: "s_curve", weight: 3 },
  { pattern: /viral|network|social/i, functionType: "s_curve", weight: 4 },
  { pattern: /awareness|reputation|brand/i, functionType: "s_curve", weight: 2 },

  // Factor-specific patterns (external uncertainties)
  { pattern: /market demand|demand level/i, functionType: "diminishing_returns", weight: 3 },
  { pattern: /competitor|competition/i, functionType: "s_curve", weight: 3 },
  { pattern: /economic|economy|recession/i, functionType: "s_curve", weight: 3 },
  { pattern: /regulatory|regulation|policy/i, functionType: "threshold", weight: 4 },
  { pattern: /weather|climate|seasonal/i, functionType: "threshold", weight: 2 },
  { pattern: /exchange rate|currency|forex/i, functionType: "linear", weight: 2 },
];

/**
 * Check if text contains any of the keywords (case-insensitive)
 */
function matchesKeywords(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Calculate match scores for all function types
 */
function calculateScores(input: EdgeFunctionSuggestionInput): Map<EdgeFunctionType, number> {
  const scores = new Map<EdgeFunctionType, number>([
    ["linear", 1], // Base score for linear (default)
    ["diminishing_returns", 0],
    ["threshold", 0],
    ["s_curve", 0],
  ]);

  // Combine all text for keyword matching
  const allText = [
    input.relationship_description ?? "",
    input.source_node.label,
    input.target_node.label,
  ].join(" ");

  // Check keyword patterns
  for (const pattern of PATTERN_MATCHES) {
    if (matchesKeywords(allText, pattern.keywords)) {
      const current = scores.get(pattern.functionType) ?? 0;
      scores.set(pattern.functionType, current + pattern.weight);
    }
  }

  // Check node kind signals
  for (const node of [input.source_node, input.target_node]) {
    const kindSignals = KIND_SIGNALS[node.kind.toLowerCase()];
    if (kindSignals) {
      for (const signal of kindSignals) {
        const current = scores.get(signal.functionType) ?? 0;
        scores.set(signal.functionType, current + signal.weight);
      }
    }
  }

  // Check label patterns
  for (const node of [input.source_node, input.target_node]) {
    for (const labelPattern of LABEL_PATTERNS) {
      if (labelPattern.pattern.test(node.label)) {
        const current = scores.get(labelPattern.functionType) ?? 0;
        scores.set(labelPattern.functionType, current + labelPattern.weight);
      }
    }
  }

  return scores;
}

/**
 * Determine confidence level based on score distribution
 */
function determineConfidence(
  scores: Map<EdgeFunctionType, number>,
  winnerScore: number
): ConfidenceLevel {
  // Get all non-winner scores
  const allScores = Array.from(scores.values());
  const secondHighest = allScores
    .filter((s) => s !== winnerScore)
    .sort((a, b) => b - a)[0] ?? 0;

  const margin = winnerScore - secondHighest;

  if (winnerScore >= 10 && margin >= 5) {
    return "high";
  } else if (winnerScore >= 5 && margin >= 2) {
    return "medium";
  }
  return "low";
}

/**
 * Get reasoning for a function type match
 */
function getReasoningForType(functionType: EdgeFunctionType, input: EdgeFunctionSuggestionInput): string {
  const pattern = PATTERN_MATCHES.find((p) => p.functionType === functionType);
  if (pattern) {
    return pattern.reasoning;
  }

  // Default reasoning by type
  switch (functionType) {
    case "diminishing_returns":
      return `The relationship between "${input.source_node.label}" and "${input.target_node.label}" likely shows diminishing returns`;
    case "threshold":
      return `The relationship between "${input.source_node.label}" and "${input.target_node.label}" likely has a threshold effect`;
    case "s_curve":
      return `The relationship between "${input.source_node.label}" and "${input.target_node.label}" likely follows an S-curve pattern`;
    default:
      return "Linear relationship assumed - output scales proportionally with input";
  }
}

/**
 * Get default params for a function type
 */
function getDefaultParams(functionType: EdgeFunctionType): EdgeFunctionParams {
  switch (functionType) {
    case "diminishing_returns":
      return { k: 2.0 };
    case "threshold":
      return { threshold: 0.5, slope: 1.0 };
    case "s_curve":
      return { k: 5.0, midpoint: 0.5 };
    default:
      return {};
  }
}

/**
 * Suggest edge function type based on pattern matching
 */
export function suggestEdgeFunction(
  input: EdgeFunctionSuggestionInput
): EdgeFunctionSuggestionOutput {
  const scores = calculateScores(input);

  // Find the winner
  let winner: EdgeFunctionType = "linear";
  let winnerScore = 1;

  for (const [functionType, score] of scores) {
    if (score > winnerScore) {
      winner = functionType;
      winnerScore = score;
    }
  }

  const confidence = determineConfidence(scores, winnerScore);

  // Build alternatives (other types with scores > 0, excluding winner)
  const alternatives: EdgeFunctionAlternative[] = [];
  const types: EdgeFunctionType[] = ["linear", "diminishing_returns", "threshold", "s_curve"];

  for (const functionType of types) {
    if (functionType !== winner) {
      const score = scores.get(functionType) ?? 0;
      // Include if it has some score or if confidence is low (show options)
      if (score > 0 || confidence === "low") {
        alternatives.push({
          function_type: functionType,
          params: getDefaultParams(functionType),
          reasoning: getReasoningForType(functionType, input),
        });
      }
    }
  }

  // Sort alternatives by score (descending)
  alternatives.sort((a, b) => {
    const scoreA = scores.get(a.function_type) ?? 0;
    const scoreB = scores.get(b.function_type) ?? 0;
    return scoreB - scoreA;
  });

  return {
    suggested_function: winner,
    suggested_params: getDefaultParams(winner),
    reasoning: getReasoningForType(winner, input),
    alternatives,
    confidence,
    provenance: "cee",
  };
}

/**
 * Validate input for edge function suggestion
 */
export function validateEdgeFunctionInput(input: unknown): input is EdgeFunctionSuggestionInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // Check required fields
  if (typeof obj.edge_id !== "string" || !obj.edge_id) {
    return false;
  }

  // Validate source_node
  if (!obj.source_node || typeof obj.source_node !== "object") {
    return false;
  }
  const source = obj.source_node as Record<string, unknown>;
  if (
    typeof source.id !== "string" ||
    typeof source.label !== "string" ||
    typeof source.kind !== "string"
  ) {
    return false;
  }

  // Validate target_node
  if (!obj.target_node || typeof obj.target_node !== "object") {
    return false;
  }
  const target = obj.target_node as Record<string, unknown>;
  if (
    typeof target.id !== "string" ||
    typeof target.label !== "string" ||
    typeof target.kind !== "string"
  ) {
    return false;
  }

  // relationship_description is optional but must be string if present
  if (
    obj.relationship_description !== undefined &&
    typeof obj.relationship_description !== "string"
  ) {
    return false;
  }

  return true;
}
