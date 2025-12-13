/**
 * CEE Edge Function Suggestions
 *
 * Suggests non-linear edge function types based on pattern matching
 * of node labels and relationship descriptions. Supports:
 * - linear (default)
 * - diminishing_returns (saturation effects)
 * - threshold (minimum requirements)
 * - s_curve (adoption/tipping points)
 * - noisy_or (generative relationships - multiple causes can produce effect)
 * - noisy_and_not (preventative relationships - inhibiting factors)
 * - logistic (continuous to binary mappings)
 *
 * Pure pattern matching - no LLM calls.
 */

export type EdgeFunctionType =
  | "linear"
  | "diminishing_returns"
  | "threshold"
  | "s_curve"
  | "noisy_or"
  | "noisy_and_not"
  | "logistic";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface EdgeFunctionParams {
  k?: number;
  threshold?: number;
  slope?: number;
  midpoint?: number;
  // Noisy-OR/AND-NOT parameters
  leak?: number; // Probability of effect even without cause (0-1)
  inhibition_strength?: number; // Strength of inhibition for noisy_and_not (0-1)
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

/**
 * Signal that contributed to a recommendation
 */
export interface RecommendationSignal {
  type: "node_type" | "label_pattern" | "keyword" | "relationship_type" | "domain_pattern";
  description: string;
  strength: "strong" | "moderate" | "weak";
}

export interface EdgeFunctionSuggestionOutput {
  suggested_function: EdgeFunctionType;
  suggested_params: EdgeFunctionParams;
  reasoning: string;
  /** Detailed signals that led to this recommendation */
  signals: RecommendationSignal[];
  alternatives: EdgeFunctionAlternative[];
  confidence: ConfidenceLevel;
  /** Note when current form matches recommendation */
  current_form_note?: string;
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
  // Noisy-OR patterns (generative relationships)
  {
    functionType: "noisy_or",
    params: { leak: 0.01 },
    keywords: [
      "causes",
      "generates",
      "produces",
      "leads to",
      "results in",
      "contributes to",
      "increases",
      "enables",
      "triggers",
      "activates",
      "drives",
      "promotes",
      "facilitates",
    ],
    reasoning:
      "Generative relationship where multiple causes can independently produce the effect (Noisy-OR)",
    weight: 12,
  },
  // Noisy-AND-NOT patterns (preventative relationships)
  {
    functionType: "noisy_and_not",
    params: { inhibition_strength: 0.8 },
    keywords: [
      "reduces",
      "prevents",
      "blocks",
      "inhibits",
      "decreases",
      "mitigates",
      "suppresses",
      "counteracts",
      "limits",
      "constrains",
      "dampens",
      "weakens",
      "undermines",
      "hinders",
    ],
    reasoning:
      "Preventative relationship where the cause inhibits or reduces the effect (Noisy-AND-NOT)",
    weight: 12,
  },
  // Logistic patterns (continuous to binary)
  {
    functionType: "logistic",
    params: { k: 5.0, midpoint: 0.5 },
    keywords: [
      "binary outcome",
      "yes or no",
      "pass or fail",
      "success or failure",
      "on or off",
      "probability of",
      "likelihood of",
      "chance of",
    ],
    reasoning:
      "Continuous input mapping to binary outcome - logistic function provides smooth probability transition",
    weight: 10,
  },
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
    { functionType: "noisy_and_not", weight: 4 }, // Risks typically inhibit outcomes
    { functionType: "threshold", weight: 3 },
    { functionType: "s_curve", weight: 2 },
  ],
  outcome: [
    { functionType: "noisy_or", weight: 3 }, // Outcomes can have multiple causes
    { functionType: "diminishing_returns", weight: 2 },
  ],
  option: [
    { functionType: "noisy_or", weight: 2 }, // Options generate outcomes
    { functionType: "linear", weight: 1 },
  ],
  // Factor nodes (external uncertainties) often have non-linear effects
  factor: [
    { functionType: "s_curve", weight: 3 },       // Market conditions often follow adoption curves
    { functionType: "threshold", weight: 2 },     // Regulatory factors have threshold effects
    { functionType: "diminishing_returns", weight: 2 }, // Resource constraints saturate
    { functionType: "noisy_and_not", weight: 2 }, // Some factors inhibit outcomes
  ],
  action: [
    { functionType: "noisy_or", weight: 3 }, // Actions generate outcomes
    { functionType: "diminishing_returns", weight: 2 }, // Repeated actions have diminishing impact
    { functionType: "linear", weight: 1 },
  ],
  // Binary nodes (true/false outcomes)
  binary: [
    { functionType: "noisy_or", weight: 4 }, // Binary outcomes from multiple causes
    { functionType: "logistic", weight: 3 }, // Continuous → binary mapping
  ],
};

// Source label patterns for preventative relationships (Noisy-AND-NOT)
const PREVENTATIVE_SOURCE_PATTERNS = [
  /risk/i,
  /threat/i,
  /competitor/i,
  /cost/i,
  /obstacle/i,
  /barrier/i,
  /challenge/i,
  /constraint/i,
  /limitation/i,
];

// Target label patterns for preventative relationships (Noisy-AND-NOT)
const PREVENTATIVE_TARGET_PATTERNS = [
  /safety/i,
  /protection/i,
  /mitigation/i,
  /success/i,
  /revenue/i,
  /profit/i,
  /growth/i,
  /quality/i,
];

// Investment/resource patterns for diminishing returns
const INVESTMENT_PATTERNS = [
  /spend/i,
  /investment/i,
  /budget/i,
  /resource/i,
  /effort/i,
  /time/i,
  /marketing/i,
  /advertising/i,
  /training/i,
];

// Label patterns that suggest specific functions
const LABEL_PATTERNS: { pattern: RegExp; functionType: EdgeFunctionType; weight: number }[] = [
  // Noisy-OR (generative patterns)
  { pattern: /cause|driver|enabler|contributor/i, functionType: "noisy_or", weight: 4 },
  { pattern: /opportunity|advantage|benefit/i, functionType: "noisy_or", weight: 3 },

  // Noisy-AND-NOT (preventative patterns)
  { pattern: /risk|threat|hazard/i, functionType: "noisy_and_not", weight: 4 },
  { pattern: /obstacle|barrier|blocker/i, functionType: "noisy_and_not", weight: 4 },
  { pattern: /competitor|competition/i, functionType: "noisy_and_not", weight: 3 },
  { pattern: /cost|expense/i, functionType: "noisy_and_not", weight: 2 },

  // Logistic (continuous to binary)
  { pattern: /probability|likelihood|chance/i, functionType: "logistic", weight: 3 },
  { pattern: /decision|choice|outcome/i, functionType: "logistic", weight: 2 },

  // Diminishing returns
  { pattern: /spending|investment|budget/i, functionType: "diminishing_returns", weight: 3 },
  { pattern: /training|learning|skill/i, functionType: "diminishing_returns", weight: 3 },
  { pattern: /quality|performance/i, functionType: "diminishing_returns", weight: 2 },
  { pattern: /marketing|advertising/i, functionType: "diminishing_returns", weight: 4 },

  // Threshold
  { pattern: /compliance|regulation|legal/i, functionType: "threshold", weight: 4 },
  { pattern: /safety|security/i, functionType: "threshold", weight: 3 },
  { pattern: /qualification|certification/i, functionType: "threshold", weight: 4 },

  // S-curve
  { pattern: /market share|adoption|growth/i, functionType: "s_curve", weight: 3 },
  { pattern: /viral|network|social/i, functionType: "s_curve", weight: 4 },
  { pattern: /awareness|reputation|brand/i, functionType: "s_curve", weight: 2 },

  // Factor-specific patterns (external uncertainties)
  { pattern: /market demand|demand level/i, functionType: "diminishing_returns", weight: 3 },
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
 * Result from score calculation including signals
 */
interface ScoreResult {
  scores: Map<EdgeFunctionType, number>;
  signals: RecommendationSignal[];
}

/**
 * Calculate match scores for all function types and collect signals
 */
function calculateScores(input: EdgeFunctionSuggestionInput): ScoreResult {
  const scores = new Map<EdgeFunctionType, number>([
    ["linear", 1], // Base score for linear (default)
    ["diminishing_returns", 0],
    ["threshold", 0],
    ["s_curve", 0],
    ["noisy_or", 0],
    ["noisy_and_not", 0],
    ["logistic", 0],
  ]);

  const signals: RecommendationSignal[] = [];

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
      signals.push({
        type: "keyword",
        description: `Keyword match for ${pattern.functionType}: "${pattern.keywords.find((k) => allText.toLowerCase().includes(k.toLowerCase()))}"`,
        strength: pattern.weight >= 10 ? "strong" : pattern.weight >= 5 ? "moderate" : "weak",
      });
    }
  }

  // Check node kind signals
  for (const node of [input.source_node, input.target_node]) {
    const kindSignals = KIND_SIGNALS[node.kind.toLowerCase()];
    if (kindSignals) {
      for (const signal of kindSignals) {
        const current = scores.get(signal.functionType) ?? 0;
        scores.set(signal.functionType, current + signal.weight);
        signals.push({
          type: "node_type",
          description: `Node kind "${node.kind}" suggests ${signal.functionType}`,
          strength: signal.weight >= 4 ? "strong" : signal.weight >= 2 ? "moderate" : "weak",
        });
      }
    }
  }

  // Check label patterns
  for (const node of [input.source_node, input.target_node]) {
    for (const labelPattern of LABEL_PATTERNS) {
      if (labelPattern.pattern.test(node.label)) {
        const current = scores.get(labelPattern.functionType) ?? 0;
        scores.set(labelPattern.functionType, current + labelPattern.weight);
        signals.push({
          type: "label_pattern",
          description: `Label "${node.label}" matches pattern for ${labelPattern.functionType}`,
          strength: labelPattern.weight >= 4 ? "strong" : labelPattern.weight >= 2 ? "moderate" : "weak",
        });
      }
    }
  }

  // Check preventative relationship patterns (Noisy-AND-NOT)
  const sourceIsPreventative = PREVENTATIVE_SOURCE_PATTERNS.some((p) => p.test(input.source_node.label));
  const targetIsPositive = PREVENTATIVE_TARGET_PATTERNS.some((p) => p.test(input.target_node.label));
  if (sourceIsPreventative && targetIsPositive) {
    const current = scores.get("noisy_and_not") ?? 0;
    scores.set("noisy_and_not", current + 5);
    signals.push({
      type: "relationship_type",
      description: `Preventative relationship: "${input.source_node.label}" inhibits "${input.target_node.label}"`,
      strength: "strong",
    });
  } else if (sourceIsPreventative) {
    const current = scores.get("noisy_and_not") ?? 0;
    scores.set("noisy_and_not", current + 2);
    signals.push({
      type: "relationship_type",
      description: `Source "${input.source_node.label}" is a preventative/risk factor`,
      strength: "moderate",
    });
  }

  // Check investment patterns for diminishing returns
  const sourceIsInvestment = INVESTMENT_PATTERNS.some((p) => p.test(input.source_node.label));
  if (sourceIsInvestment) {
    const current = scores.get("diminishing_returns") ?? 0;
    scores.set("diminishing_returns", current + 3);
    signals.push({
      type: "domain_pattern",
      description: `Investment/resource input "${input.source_node.label}" typically shows diminishing returns`,
      strength: "moderate",
    });
  }

  return { scores, signals };
}

/**
 * Determine confidence level based on score distribution and signal quality
 *
 * Improved calibration (Task 2):
 * - High confidence requires multiple strong signals AND clear margin
 * - Reduces false positives by requiring corroboration
 * - Accounts for signal strength distribution
 */
function determineConfidence(
  scores: Map<EdgeFunctionType, number>,
  winnerScore: number,
  signals: RecommendationSignal[]
): ConfidenceLevel {
  // Get all non-winner scores
  const allScores = Array.from(scores.values());
  const secondHighest = allScores
    .filter((s) => s !== winnerScore)
    .sort((a, b) => b - a)[0] ?? 0;

  const margin = winnerScore - secondHighest;

  // Count signal strengths
  const strongSignals = signals.filter((s) => s.strength === "strong").length;
  const moderateSignals = signals.filter((s) => s.strength === "moderate").length;

  // High confidence requires:
  // - Winner score >= 12 (multiple strong patterns matched)
  // - Margin >= 6 over second place (clear winner)
  // - At least 2 strong signals OR 1 strong + 2 moderate (corroboration)
  if (
    winnerScore >= 12 &&
    margin >= 6 &&
    (strongSignals >= 2 || (strongSignals >= 1 && moderateSignals >= 2))
  ) {
    return "high";
  }

  // Medium confidence requires:
  // - Winner score >= 6
  // - Margin >= 3
  // - At least 1 strong signal OR 2 moderate signals
  if (
    winnerScore >= 6 &&
    margin >= 3 &&
    (strongSignals >= 1 || moderateSignals >= 2)
  ) {
    return "medium";
  }

  return "low";
}

/**
 * Get detailed reasoning for a function type match (Task 3)
 *
 * Returns contextualised reasoning that explains why the function type
 * was recommended based on the specific nodes in the relationship.
 */
function getReasoningForType(
  functionType: EdgeFunctionType,
  input: EdgeFunctionSuggestionInput,
  signals: RecommendationSignal[]
): string {
  const sourceLabel = input.source_node.label;
  const targetLabel = input.target_node.label;

  // Get strong/moderate signals for this function type
  const relevantSignals = signals.filter(
    (s) => s.description.toLowerCase().includes(functionType.replace("_", " ")) ||
           s.description.toLowerCase().includes(functionType.replace("_", "-"))
  );

  // Build reasoning based on function type with specific context
  switch (functionType) {
    case "noisy_or":
      return buildNoisyOrReasoning(sourceLabel, targetLabel, relevantSignals, input);

    case "noisy_and_not":
      return buildNoisyAndNotReasoning(sourceLabel, targetLabel, relevantSignals, input);

    case "logistic":
      return `The relationship between "${sourceLabel}" and "${targetLabel}" maps a continuous input to a binary outcome. Logistic function provides smooth probability transition around a midpoint.`;

    case "diminishing_returns":
      return buildDiminishingReturnsReasoning(sourceLabel, targetLabel, relevantSignals);

    case "threshold":
      return buildThresholdReasoning(sourceLabel, targetLabel, relevantSignals);

    case "s_curve":
      return buildSCurveReasoning(sourceLabel, targetLabel, relevantSignals);

    case "linear":
    default:
      return `Linear relationship assumed between "${sourceLabel}" and "${targetLabel}" - output scales proportionally with input. Consider whether non-linear effects apply.`;
  }
}

function buildNoisyOrReasoning(
  sourceLabel: string,
  targetLabel: string,
  signals: RecommendationSignal[],
  input: EdgeFunctionSuggestionInput
): string {
  const parts: string[] = [];

  parts.push(`"${sourceLabel}" is a generative cause of "${targetLabel}".`);
  parts.push(`Noisy-OR models independent causes that can each produce the effect.`);

  if (input.source_node.kind === "action" || input.source_node.kind === "option") {
    parts.push(`As an ${input.source_node.kind}, it contributes to the outcome alongside other factors.`);
  }

  if (signals.some((s) => s.strength === "strong")) {
    parts.push(`Strong causal language detected in the relationship.`);
  }

  parts.push(`The leak parameter (default 0.01) represents the baseline probability of the effect without this cause.`);

  return parts.join(" ");
}

function buildNoisyAndNotReasoning(
  sourceLabel: string,
  targetLabel: string,
  signals: RecommendationSignal[],
  input: EdgeFunctionSuggestionInput
): string {
  const parts: string[] = [];

  parts.push(`"${sourceLabel}" inhibits or reduces "${targetLabel}".`);
  parts.push(`Noisy-AND-NOT models preventative relationships where the cause blocks or diminishes the effect.`);

  if (input.source_node.kind === "risk" || input.source_node.kind === "factor") {
    parts.push(`As a ${input.source_node.kind} node, it represents an inhibiting factor.`);
  }

  if (signals.some((s) => s.type === "relationship_type")) {
    parts.push(`Preventative pattern detected between source and target.`);
  }

  parts.push(`The inhibition_strength parameter (default 0.8) controls how strongly the cause prevents the effect.`);

  return parts.join(" ");
}

function buildDiminishingReturnsReasoning(
  sourceLabel: string,
  targetLabel: string,
  signals: RecommendationSignal[]
): string {
  const parts: string[] = [];

  parts.push(`The relationship between "${sourceLabel}" and "${targetLabel}" shows diminishing returns.`);
  parts.push(`Initial increases in "${sourceLabel}" have strong effects on "${targetLabel}", but additional increases yield progressively smaller gains.`);

  if (signals.some((s) => s.type === "domain_pattern")) {
    parts.push(`This pattern is common for investment/resource relationships.`);
  }

  parts.push(`The k parameter (default 2.0) controls the rate of diminishment.`);

  return parts.join(" ");
}

function buildThresholdReasoning(
  sourceLabel: string,
  targetLabel: string,
  signals: RecommendationSignal[]
): string {
  const parts: string[] = [];

  parts.push(`"${targetLabel}" only activates after "${sourceLabel}" reaches a critical level.`);
  parts.push(`Below the threshold, changes in "${sourceLabel}" have minimal effect.`);

  if (signals.some((s) => s.description.includes("compliance") || s.description.includes("regulation"))) {
    parts.push(`Regulatory/compliance requirements often exhibit threshold behaviour.`);
  }

  parts.push(`The threshold parameter (default 0.5) sets the activation point; slope (default 1.0) controls transition sharpness.`);

  return parts.join(" ");
}

function buildSCurveReasoning(
  sourceLabel: string,
  targetLabel: string,
  signals: RecommendationSignal[]
): string {
  const parts: string[] = [];

  parts.push(`The relationship between "${sourceLabel}" and "${targetLabel}" follows an S-curve pattern.`);
  parts.push(`Initially slow growth accelerates through a tipping point, then saturates.`);

  if (signals.some((s) => s.description.includes("adoption") || s.description.includes("network"))) {
    parts.push(`This pattern is typical for adoption curves and network effects.`);
  }

  parts.push(`The k parameter (default 5.0) controls steepness; midpoint (default 0.5) sets the inflection point.`);

  return parts.join(" ");
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
    case "noisy_or":
      return { leak: 0.01 }; // 1% baseline probability without cause
    case "noisy_and_not":
      return { inhibition_strength: 0.8 }; // 80% inhibition strength
    case "logistic":
      return { k: 5.0, midpoint: 0.5 }; // Same as s_curve but for binary outcomes
    case "linear":
    default:
      return {};
  }
}

/**
 * All supported edge function types
 */
const ALL_FUNCTION_TYPES: EdgeFunctionType[] = [
  "linear",
  "diminishing_returns",
  "threshold",
  "s_curve",
  "noisy_or",
  "noisy_and_not",
  "logistic",
];

/**
 * Suggest edge function type based on pattern matching
 */
export function suggestEdgeFunction(
  input: EdgeFunctionSuggestionInput,
  currentForm?: EdgeFunctionType
): EdgeFunctionSuggestionOutput {
  // Task 4: Handle edge cases
  if (!input.source_node?.label || !input.target_node?.label) {
    // Gracefully handle missing labels
    return {
      suggested_function: "linear",
      suggested_params: {},
      reasoning: "Insufficient information to recommend a specific function type. Linear relationship assumed as default.",
      signals: [],
      alternatives: [],
      confidence: "low",
      provenance: "cee",
    };
  }

  const { scores, signals } = calculateScores(input);

  // Find the winner
  let winner: EdgeFunctionType = "linear";
  let winnerScore = 1;

  for (const [functionType, score] of scores) {
    if (score > winnerScore) {
      winner = functionType;
      winnerScore = score;
    }
  }

  const confidence = determineConfidence(scores, winnerScore, signals);

  // Build alternatives (other types with scores > 0, excluding winner)
  const alternatives: EdgeFunctionAlternative[] = [];

  for (const functionType of ALL_FUNCTION_TYPES) {
    if (functionType !== winner) {
      const score = scores.get(functionType) ?? 0;
      // Include if it has some score or if confidence is low (show options)
      if (score > 0 || confidence === "low") {
        alternatives.push({
          function_type: functionType,
          params: getDefaultParams(functionType),
          reasoning: getReasoningForType(functionType, input, signals),
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

  // Limit alternatives to top 3 to avoid overwhelming users
  const topAlternatives = alternatives.slice(0, 3);

  // Generate current form note if provided
  let current_form_note: string | undefined;
  if (currentForm) {
    if (currentForm === winner) {
      current_form_note = `Current function "${currentForm}" matches the recommendation.`;
    } else {
      const currentScore = scores.get(currentForm) ?? 0;
      const improvement = winnerScore - currentScore;
      if (improvement > 5) {
        current_form_note = `Current function "${currentForm}" differs from recommendation. Switching to "${winner}" may better model this relationship (score improvement: +${improvement}).`;
      } else {
        current_form_note = `Current function "${currentForm}" is reasonable. "${winner}" is a slight improvement based on detected patterns.`;
      }
    }
  }

  return {
    suggested_function: winner,
    suggested_params: getDefaultParams(winner),
    reasoning: getReasoningForType(winner, input, signals),
    signals,
    alternatives: topAlternatives,
    confidence,
    current_form_note,
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
