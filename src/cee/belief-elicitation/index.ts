/**
 * Belief Elicitation Module
 *
 * Converts natural language probability expressions to normalized 0-1 values.
 * Handles qualitative terms, percentages, fractions, and ambiguous expressions.
 *
 * @example
 * elicitBelief("pretty likely") → { suggested_value: 0.70, confidence: 'high' }
 * elicitBelief("about 70%") → { suggested_value: 0.70, confidence: 'high' }
 * elicitBelief("3 in 4") → { suggested_value: 0.75, confidence: 'high' }
 */

export interface ElicitBeliefInput {
  node_id: string;
  node_label: string;
  user_expression: string;
  target_type: "prior" | "edge_weight";
}

export interface ElicitBeliefOutput {
  suggested_value: number;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  needs_clarification: boolean;
  clarifying_question?: string;
  options?: Array<{ label: string; value: number }>;
  provenance: "cee";
}

// Qualitative probability mappings - comprehensive set
// Values based on research on probability word interpretation
const CERTAINTY_TERMS: Record<string, number> = {
  // Absolute certainty
  certain: 0.99,
  definitely: 0.95,
  absolutely: 0.95,
  certainly: 0.95,
  "for sure": 0.95,
  guaranteed: 0.99,
  inevitable: 0.99,
  undoubtedly: 0.95,
  unquestionably: 0.95,

  // High probability
  "very likely": 0.85,
  "highly likely": 0.85,
  "most likely": 0.80,
  probable: 0.75,
  probably: 0.75,
  likely: 0.70,
  "pretty likely": 0.70,
  "fairly likely": 0.70,
  "quite likely": 0.75,
  expected: 0.70,
  anticipate: 0.70,
  "good chance": 0.70,
  "strong chance": 0.80,

  // Moderate probability
  possible: 0.50,
  possibly: 0.50,
  maybe: 0.50,
  perhaps: 0.50,
  "even odds": 0.50,
  "fifty-fifty": 0.50,
  "50-50": 0.50,
  "toss-up": 0.50,
  "coin flip": 0.50,
  uncertain: 0.50,
  "might happen": 0.50,
  "could go either way": 0.50,

  // Low probability
  unlikely: 0.30,
  "pretty unlikely": 0.25,
  "fairly unlikely": 0.25,
  "quite unlikely": 0.20,
  improbable: 0.25,
  doubtful: 0.25,
  "slim chance": 0.20,
  "small chance": 0.25,
  "low chance": 0.25,
  "long shot": 0.15,
  "outside chance": 0.15,

  // Very low probability
  "very unlikely": 0.15,
  "highly unlikely": 0.10,
  rare: 0.10,
  "almost impossible": 0.05,
  "nearly impossible": 0.05,
  "remote chance": 0.10,
  "remote possibility": 0.10,

  // Impossibility
  impossible: 0.01,
  never: 0.01,
  "no chance": 0.01,
  "no way": 0.01,
  "not a chance": 0.01,
};

// Casual/informal terms that map to probabilities
const CASUAL_TERMS: Record<string, number> = {
  sure: 0.90,
  "pretty sure": 0.80,
  "fairly sure": 0.75,
  "quite sure": 0.80,
  "not sure": 0.50,
  unsure: 0.50,
  confident: 0.80,
  "very confident": 0.90,
  "not confident": 0.40,
  hopeful: 0.60,
  optimistic: 0.65,
  pessimistic: 0.35,
  skeptical: 0.30,
  "skeptical about": 0.30,
  worried: 0.40,
  concerned: 0.40,
  expect: 0.70,
  "don't expect": 0.30,
  doubt: 0.30,
  "highly doubt": 0.15,
  "strongly doubt": 0.15,
  believe: 0.70,
  "strongly believe": 0.85,
  "don't believe": 0.25,
  think: 0.65,
  "don't think": 0.35,
  assume: 0.65,
  guess: 0.55,
  "wild guess": 0.50,
  reckon: 0.60,
  suppose: 0.55,
  suspect: 0.60,
  "lean towards": 0.60,
  "leaning towards": 0.60,
  "tend to think": 0.60,
};

// Frequency-based terms
const FREQUENCY_TERMS: Record<string, number> = {
  always: 0.95,
  "almost always": 0.90,
  usually: 0.80,
  "more often than not": 0.65,
  often: 0.70,
  frequently: 0.70,
  sometimes: 0.50,
  occasionally: 0.35,
  rarely: 0.15,
  seldom: 0.15,
  "hardly ever": 0.10,
  "almost never": 0.05,
  never: 0.01,
};

// Terms that need clarification (too ambiguous)
const AMBIGUOUS_TERMS = new Set([
  "good",
  "bad",
  "high",
  "low",
  "some",
  "many",
  "few",
  "most",
  "more",
  "less",
  "better",
  "worse",
  "ok",
  "okay",
  "fine",
  "normal",
  "average",
  "moderate",
  "decent",
  "reasonable",
  "significant",
  "substantial",
  "considerable",
  "meaningful",
  "important",
]);

/**
 * Main entry point for belief elicitation.
 * Parses natural language expressions and returns normalized probability values.
 */
export function elicitBelief(input: ElicitBeliefInput): ElicitBeliefOutput {
  const { user_expression, node_label, target_type } = input;
  const normalized = user_expression.trim().toLowerCase();

  if (!normalized) {
    return {
      suggested_value: 0.5,
      confidence: "low",
      reasoning: "No expression provided. Using neutral default.",
      needs_clarification: true,
      clarifying_question: `What probability would you assign to "${node_label}"?`,
      options: generateDefaultOptions(),
      provenance: "cee",
    };
  }

  // Try parsing strategies in order of specificity

  // 1. Try exact percentage match
  const percentageResult = parsePercentage(normalized);
  if (percentageResult !== null) {
    return {
      suggested_value: percentageResult,
      confidence: "high",
      reasoning: `Parsed "${user_expression}" as ${Math.round(percentageResult * 100)}% probability.`,
      needs_clarification: false,
      provenance: "cee",
    };
  }

  // 2. Try fraction match
  const fractionResult = parseFraction(normalized);
  if (fractionResult !== null) {
    return {
      suggested_value: fractionResult,
      confidence: "high",
      reasoning: `Parsed "${user_expression}" as ${Math.round(fractionResult * 100)}% probability.`,
      needs_clarification: false,
      provenance: "cee",
    };
  }

  // 3. Try decimal match
  const decimalResult = parseDecimal(normalized);
  if (decimalResult !== null) {
    return {
      suggested_value: decimalResult,
      confidence: "high",
      reasoning: `Parsed "${user_expression}" as ${Math.round(decimalResult * 100)}% probability.`,
      needs_clarification: false,
      provenance: "cee",
    };
  }

  // 4. Try qualitative term matching
  const qualitativeResult = matchQualitativeTerm(normalized);
  if (qualitativeResult !== null) {
    return {
      suggested_value: qualitativeResult.value,
      confidence: qualitativeResult.confidence,
      reasoning: `Interpreted "${user_expression}" as approximately ${Math.round(qualitativeResult.value * 100)}% probability based on common usage.`,
      needs_clarification: false,
      provenance: "cee",
    };
  }

  // 5. Check for ambiguous terms that need clarification
  if (isAmbiguous(normalized)) {
    const contextualQuestion = generateContextualQuestion(node_label, target_type, normalized);
    return {
      suggested_value: 0.5,
      confidence: "low",
      reasoning: `The term "${user_expression}" is ambiguous in a probability context.`,
      needs_clarification: true,
      clarifying_question: contextualQuestion,
      options: generateContextualOptions(normalized),
      provenance: "cee",
    };
  }

  // 6. Try partial match with hedging detection
  const hedgedResult = parseHedgedExpression(normalized);
  if (hedgedResult !== null) {
    return {
      suggested_value: hedgedResult.value,
      confidence: hedgedResult.confidence,
      reasoning: hedgedResult.reasoning,
      needs_clarification: false,
      provenance: "cee",
    };
  }

  // 7. Fallback: unrecognized expression
  return {
    suggested_value: 0.5,
    confidence: "low",
    reasoning: `Could not interpret "${user_expression}" as a probability. Using neutral default.`,
    needs_clarification: true,
    clarifying_question: `Could you express your belief about "${node_label}" as a percentage or using terms like "likely", "unlikely", "50-50"?`,
    options: generateDefaultOptions(),
    provenance: "cee",
  };
}

/**
 * Parse percentage expressions like "70%", "about 70%", "roughly 80 percent"
 */
function parsePercentage(expr: string): number | null {
  // Match patterns like: 70%, 70 percent, about 70%, roughly 80%, ~75%
  const patterns = [
    /(?:about|around|roughly|approximately|~|≈)?\s*(\d+(?:\.\d+)?)\s*(?:%|percent)/i,
    /(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:chance|probability|likely)?/i,
  ];

  for (const pattern of patterns) {
    const match = expr.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (value >= 0 && value <= 100) {
        return value / 100;
      }
    }
  }

  return null;
}

/**
 * Parse fraction expressions like "3 in 4", "3 out of 4", "3/4", "three quarters"
 */
function parseFraction(expr: string): number | null {
  // X in Y pattern: "3 in 4", "1 in 10"
  const inPattern = /(\d+)\s*(?:in|out of)\s*(\d+)/i;
  const inMatch = expr.match(inPattern);
  if (inMatch) {
    const numerator = parseFloat(inMatch[1]);
    const denominator = parseFloat(inMatch[2]);
    if (denominator > 0) {
      const value = numerator / denominator;
      if (value >= 0 && value <= 1) {
        return value;
      }
    }
  }

  // Slash fraction: "3/4", "1/2"
  const slashPattern = /(\d+)\s*\/\s*(\d+)/;
  const slashMatch = expr.match(slashPattern);
  if (slashMatch) {
    const numerator = parseFloat(slashMatch[1]);
    const denominator = parseFloat(slashMatch[2]);
    if (denominator > 0) {
      const value = numerator / denominator;
      if (value >= 0 && value <= 1) {
        return value;
      }
    }
  }

  // Word fractions
  const wordFractions: Record<string, number> = {
    "one half": 0.5,
    "a half": 0.5,
    half: 0.5,
    "one third": 0.333,
    "a third": 0.333,
    "two thirds": 0.667,
    "one quarter": 0.25,
    "a quarter": 0.25,
    "three quarters": 0.75,
    "one fifth": 0.2,
    "a fifth": 0.2,
    "two fifths": 0.4,
    "three fifths": 0.6,
    "four fifths": 0.8,
    "one tenth": 0.1,
    "a tenth": 0.1,
    "nine tenths": 0.9,
  };

  for (const [word, value] of Object.entries(wordFractions)) {
    if (expr.includes(word)) {
      return value;
    }
  }

  return null;
}

/**
 * Parse decimal expressions like "0.7", "point seven", ".75"
 */
function parseDecimal(expr: string): number | null {
  // Numeric decimal: "0.7", ".75"
  const decimalPattern = /^(?:about|around|roughly|approximately)?\s*(0?\.\d+)\s*$/;
  const decimalMatch = expr.match(decimalPattern);
  if (decimalMatch) {
    const value = parseFloat(decimalMatch[1]);
    if (value >= 0 && value <= 1) {
      return value;
    }
  }

  // Word decimal: "point seven", "point seven five"
  const wordDecimals: Record<string, number> = {
    "point one": 0.1,
    "point two": 0.2,
    "point three": 0.3,
    "point four": 0.4,
    "point five": 0.5,
    "point six": 0.6,
    "point seven": 0.7,
    "point eight": 0.8,
    "point nine": 0.9,
  };

  for (const [word, value] of Object.entries(wordDecimals)) {
    if (expr.includes(word)) {
      return value;
    }
  }

  return null;
}

/**
 * Match qualitative probability terms from our comprehensive mappings
 */
function matchQualitativeTerm(
  expr: string
): { value: number; confidence: "high" | "medium" | "low" } | null {
  // Try exact matches first (longer phrases before shorter)
  const allTerms = { ...CERTAINTY_TERMS, ...CASUAL_TERMS, ...FREQUENCY_TERMS };

  // Sort by length descending to match longer phrases first
  const sortedTerms = Object.entries(allTerms).sort(
    ([a], [b]) => b.length - a.length
  );

  for (const [term, value] of sortedTerms) {
    if (expr.includes(term)) {
      // Determine confidence based on how specific the match is
      const confidence = determineMatchConfidence(expr, term);
      return { value, confidence };
    }
  }

  return null;
}

/**
 * Determine confidence level based on match quality
 */
function determineMatchConfidence(
  expr: string,
  matchedTerm: string
): "high" | "medium" | "low" {
  // Exact match = high confidence
  if (expr === matchedTerm) {
    return "high";
  }

  // Match with minor additions (articles, hedges) = high confidence
  const minorAdditions = /^(i\s+|it's\s+|it is\s+|that's\s+|that is\s+|very\s+)?/;
  const cleaned = expr.replace(minorAdditions, "").trim();
  if (cleaned === matchedTerm) {
    return "high";
  }

  // Partial match in longer expression = medium confidence
  return "medium";
}

/**
 * Check if expression contains only ambiguous terms
 */
function isAmbiguous(expr: string): boolean {
  const words = expr.split(/\s+/);

  // If any word is in ambiguous set and no probability term found
  for (const word of words) {
    if (AMBIGUOUS_TERMS.has(word)) {
      // Check if there's also a probability term
      const hasQualitative = matchQualitativeTerm(expr) !== null;
      if (!hasQualitative) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Parse expressions with hedging words
 */
function parseHedgedExpression(
  expr: string
): { value: number; confidence: "high" | "medium" | "low"; reasoning: string } | null {
  // Patterns like "I'd say likely", "probably around 70%", "leaning likely"
  const hedgePrefixes = [
    /^(?:i'd say|i would say|i think|i believe|i guess|i'd guess)\s+/i,
    /^(?:probably|maybe|perhaps)\s+/i,
    /^(?:leaning|leaning towards?)\s+/i,
    /^(?:sort of|kind of|kinda|sorta)\s+/i,
  ];

  let cleanedExpr = expr;
  let hasHedge = false;

  for (const prefix of hedgePrefixes) {
    if (prefix.test(expr)) {
      cleanedExpr = expr.replace(prefix, "").trim();
      hasHedge = true;
      break;
    }
  }

  if (hasHedge && cleanedExpr !== expr) {
    // Try to parse the cleaned expression
    const percentResult = parsePercentage(cleanedExpr);
    if (percentResult !== null) {
      return {
        value: percentResult,
        confidence: "medium",
        reasoning: `Interpreted hedged expression "${expr}" as approximately ${Math.round(percentResult * 100)}%.`,
      };
    }

    const qualResult = matchQualitativeTerm(cleanedExpr);
    if (qualResult !== null) {
      return {
        value: qualResult.value,
        confidence: "medium",
        reasoning: `Interpreted hedged expression "${expr}" as approximately ${Math.round(qualResult.value * 100)}%.`,
      };
    }
  }

  return null;
}

/**
 * Generate contextual clarifying question
 */
function generateContextualQuestion(
  nodeLabel: string,
  targetType: "prior" | "edge_weight",
  _expression: string
): string {
  if (targetType === "edge_weight") {
    return `How strong is the influence? Could you express the relationship strength as a percentage or use terms like "strong", "moderate", "weak"?`;
  }

  return `What probability would you assign to "${nodeLabel}"? For example: "70%", "likely", "3 in 4", or "50-50".`;
}

/**
 * Generate contextual options based on the ambiguous term
 */
function generateContextualOptions(
  expr: string
): Array<{ label: string; value: number }> {
  // Check if it's a positive or negative leaning term
  const positiveLean = ["good", "high", "many", "most", "better", "significant", "substantial"];
  const negativeLean = ["bad", "low", "few", "less", "worse"];

  const isPositive = positiveLean.some((term) => expr.includes(term));
  const isNegative = negativeLean.some((term) => expr.includes(term));

  if (isPositive) {
    return [
      { label: "Very high (90%)", value: 0.9 },
      { label: "High (75%)", value: 0.75 },
      { label: "Moderately high (60%)", value: 0.6 },
    ];
  }

  if (isNegative) {
    return [
      { label: "Moderately low (40%)", value: 0.4 },
      { label: "Low (25%)", value: 0.25 },
      { label: "Very low (10%)", value: 0.1 },
    ];
  }

  return generateDefaultOptions();
}

/**
 * Generate default options for clarification
 */
function generateDefaultOptions(): Array<{ label: string; value: number }> {
  return [
    { label: "Very likely (85%)", value: 0.85 },
    { label: "Likely (70%)", value: 0.7 },
    { label: "Uncertain (50%)", value: 0.5 },
    { label: "Unlikely (30%)", value: 0.3 },
    { label: "Very unlikely (15%)", value: 0.15 },
  ];
}

/**
 * Validate input for belief elicitation
 */
export function validateElicitBeliefInput(input: unknown): input is ElicitBeliefInput {
  if (!input || typeof input !== "object") {
    return false;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.node_id !== "string" || !obj.node_id) {
    return false;
  }

  if (typeof obj.node_label !== "string" || !obj.node_label) {
    return false;
  }

  if (typeof obj.user_expression !== "string") {
    return false;
  }

  if (obj.target_type !== "prior" && obj.target_type !== "edge_weight") {
    return false;
  }

  return true;
}
