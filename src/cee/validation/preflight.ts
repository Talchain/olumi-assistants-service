/**
 * Preflight validation module for CEE input validation
 *
 * Performs non-LLM checks before invoking the draft pipeline:
 * - Gibberish detection (entropy, dictionary coverage)
 * - Decision-relevance checks (question patterns, keywords)
 * - Length validation (min/max)
 * - Character validation (non-printable, excessive symbols)
 */

import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";

// ============================================================================
// Configuration
// ============================================================================

const BRIEF_MIN_LENGTH = 10;
const BRIEF_MAX_LENGTH = 5000;
const BRIEF_MIN_WORDS = 3;

// Common English words for dictionary coverage check
const COMMON_WORDS = new Set([
  // Articles & pronouns
  "the", "a", "an", "i", "we", "you", "he", "she", "it", "they", "me", "us", "him", "her", "them",
  "my", "our", "your", "his", "its", "their", "this", "that", "these", "those", "who", "what", "which",
  // Verbs
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "can", "may", "might", "must", "shall",
  "make", "made", "get", "go", "going", "come", "take", "see", "know", "think", "want", "need",
  "use", "find", "give", "tell", "work", "call", "try", "ask", "feel", "become", "leave", "put",
  "keep", "let", "begin", "seem", "help", "show", "hear", "play", "run", "move", "like", "live",
  "believe", "hold", "bring", "happen", "write", "provide", "sit", "stand", "lose", "pay", "meet",
  // Decision-related verbs
  "decide", "choose", "select", "pick", "consider", "evaluate", "assess", "determine", "conclude",
  "compare", "analyze", "review", "weigh", "hire", "fire", "buy", "sell", "invest", "launch",
  // Nouns
  "time", "year", "people", "way", "day", "man", "woman", "thing", "child", "world", "life",
  "hand", "part", "place", "case", "week", "company", "system", "program", "question", "work",
  "government", "number", "night", "point", "home", "water", "room", "mother", "area", "money",
  "story", "fact", "month", "lot", "right", "study", "book", "eye", "job", "word", "business",
  "issue", "side", "kind", "head", "house", "service", "friend", "father", "power", "hour",
  // Decision-related nouns
  "decision", "choice", "option", "alternative", "strategy", "plan", "goal", "objective",
  "outcome", "result", "impact", "risk", "benefit", "cost", "team", "project", "budget",
  "developer", "engineer", "manager", "employee", "customer", "product", "market", "data",
  // Adjectives
  "good", "new", "first", "last", "long", "great", "little", "own", "other", "old", "right",
  "big", "high", "different", "small", "large", "next", "early", "young", "important", "few",
  "public", "bad", "same", "able", "best", "better", "additional", "hire", "potential",
  // Prepositions & conjunctions
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "up", "about", "into", "over",
  "after", "beneath", "under", "above", "and", "or", "but", "if", "because", "as", "until",
  "while", "although", "whether", "before", "since", "so", "than", "when", "where", "how", "why",
  // Adverbs
  "not", "also", "very", "often", "however", "too", "usually", "really", "early", "never",
  "always", "sometimes", "together", "likely", "simply", "generally", "instead", "actually",
  // Question words
  "should", "whether", "how", "what", "why", "when", "where", "which", "whom",
]);

// Decision-related patterns
const DECISION_PATTERNS = [
  /\bshould\s+(i|we)\b/i,
  /\b(decide|deciding|decision)\b/i,
  /\b(choose|choosing|choice)\b/i,
  /\b(option|options|alternative|alternatives)\b/i,
  /\b(evaluate|evaluating|evaluation)\b/i,
  /\b(assess|assessing|assessment)\b/i,
  /\b(compare|comparing|comparison)\b/i,
  /\b(strategy|strategies|strategic)\b/i,
  /\b(recommend|recommendation)\b/i,
  /\b(pros?\s+and\s+cons?)\b/i,
  /\b(trade-?off|tradeoff)\b/i,
  /\b(best\s+(way|approach|option|choice))\b/i,
  /\b(better|worse|optimal|ideal)\b/i,
  /\b(invest|investment|investing)\b/i,
  /\b(hire|hiring|recruit)\b/i,
  /\b(launch|launching)\b/i,
  /\b(expand|expanding|expansion)\b/i,
  /\b(risk|risks|risky)\b/i,
  /\b(benefit|benefits)\b/i,
  /\b(cost|costs|budget)\b/i,
  /\bor\b.*\?$/i, // "X or Y?" pattern
  /\?$/, // Ends with question mark
];

// Gibberish indicators
const GIBBERISH_PATTERNS = [
  /^[^a-zA-Z]*$/, // No letters at all
  /(.)\1{5,}/, // Same character repeated 5+ times
  /[a-z]{15,}/i, // Very long word (15+ chars) without spaces
  /^[\W\d]+$/, // Only symbols and numbers
];

// ============================================================================
// Types
// ============================================================================

export type PreflightIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
};

export type PreflightResult = {
  valid: boolean;
  issues: PreflightIssue[];
  metrics: {
    length: number;
    word_count: number;
    dictionary_coverage: number;
    entropy: number;
    decision_relevance_score: number;
  };
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Calculate Shannon entropy of a string (bits per character)
 * Higher entropy suggests more randomness/gibberish
 */
function calculateEntropy(text: string): number {
  if (!text || text.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const char of text.toLowerCase()) {
    freq.set(char, (freq.get(char) || 0) + 1);
  }

  let entropy = 0;
  const len = text.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Calculate dictionary coverage (0-1)
 * Percentage of words that are in common English dictionary
 */
function calculateDictionaryCoverage(text: string): number {
  const words = text.toLowerCase().match(/\b[a-z]+\b/g) || [];
  if (words.length === 0) return 0;

  const knownWords = words.filter(w => COMMON_WORDS.has(w));
  return knownWords.length / words.length;
}

/**
 * Calculate decision relevance score (0-1)
 * Based on presence of decision-related patterns
 */
function calculateDecisionRelevance(text: string): number {
  let score = 0;
  const maxScore = DECISION_PATTERNS.length;

  for (const pattern of DECISION_PATTERNS) {
    if (pattern.test(text)) {
      score += 1;
    }
  }

  // Normalize and cap at 1.0
  // Having 3+ patterns is considered highly relevant
  return Math.min(1.0, score / 3);
}

/**
 * Check if text appears to be gibberish
 */
function isLikelyGibberish(text: string, entropy: number, coverage: number): boolean {
  // Check explicit gibberish patterns
  for (const pattern of GIBBERISH_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // High entropy + low dictionary coverage = gibberish
  // Normal English text has entropy ~4.0-4.5 bits/char
  // Gibberish tends to have entropy > 5.0
  if (entropy > 5.0 && coverage < 0.3) {
    return true;
  }

  // Very low coverage alone is suspicious
  if (coverage < 0.15) {
    return true;
  }

  return false;
}

/**
 * Check for non-printable or suspicious characters
 */
function hasProblematicCharacters(text: string): { valid: boolean; issue?: string } {
  // Check for null bytes or control characters
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) {
    return { valid: false, issue: "Contains control characters" };
  }

  // Check for excessive special characters (>50% non-alphanumeric)
  const alphanumeric = text.match(/[a-zA-Z0-9\s]/g) || [];
  if (alphanumeric.length < text.length * 0.4) {
    return { valid: false, issue: "Excessive special characters" };
  }

  return { valid: true };
}

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Perform preflight validation on a brief before LLM processing
 */
export function validateBriefPreflight(brief: string): PreflightResult {
  const issues: PreflightIssue[] = [];
  const trimmedBrief = brief?.trim() || "";

  // Calculate metrics
  const length = trimmedBrief.length;
  const words = trimmedBrief.match(/\b\w+\b/g) || [];
  const wordCount = words.length;
  const entropy = calculateEntropy(trimmedBrief);
  const dictionaryCoverage = calculateDictionaryCoverage(trimmedBrief);
  const decisionRelevance = calculateDecisionRelevance(trimmedBrief);

  const metrics = {
    length,
    word_count: wordCount,
    dictionary_coverage: Math.round(dictionaryCoverage * 100) / 100,
    entropy: Math.round(entropy * 100) / 100,
    decision_relevance_score: Math.round(decisionRelevance * 100) / 100,
  };

  // Length validation
  if (length < BRIEF_MIN_LENGTH) {
    issues.push({
      code: "BRIEF_TOO_SHORT",
      severity: "error",
      message: `Brief must be at least ${BRIEF_MIN_LENGTH} characters (got ${length})`,
      details: { min_length: BRIEF_MIN_LENGTH, actual_length: length },
    });
  }

  if (length > BRIEF_MAX_LENGTH) {
    issues.push({
      code: "BRIEF_TOO_LONG",
      severity: "error",
      message: `Brief must be at most ${BRIEF_MAX_LENGTH} characters (got ${length})`,
      details: { max_length: BRIEF_MAX_LENGTH, actual_length: length },
    });
  }

  // Word count validation
  if (wordCount < BRIEF_MIN_WORDS) {
    issues.push({
      code: "BRIEF_TOO_FEW_WORDS",
      severity: "error",
      message: `Brief must contain at least ${BRIEF_MIN_WORDS} words (got ${wordCount})`,
      details: { min_words: BRIEF_MIN_WORDS, actual_words: wordCount },
    });
  }

  // Character validation
  const charCheck = hasProblematicCharacters(trimmedBrief);
  if (!charCheck.valid) {
    issues.push({
      code: "BRIEF_INVALID_CHARACTERS",
      severity: "error",
      message: charCheck.issue || "Brief contains invalid characters",
    });
  }

  // Gibberish detection
  if (isLikelyGibberish(trimmedBrief, entropy, dictionaryCoverage)) {
    issues.push({
      code: "BRIEF_APPEARS_GIBBERISH",
      severity: "error",
      message: "Brief appears to be gibberish or non-meaningful text",
      details: { entropy, dictionary_coverage: dictionaryCoverage },
    });
  }

  // Decision relevance warning (not an error, but helpful feedback)
  if (decisionRelevance < 0.2 && length >= BRIEF_MIN_LENGTH && wordCount >= BRIEF_MIN_WORDS) {
    issues.push({
      code: "BRIEF_LOW_DECISION_RELEVANCE",
      severity: "warning",
      message: "Brief does not appear to describe a decision. Consider rephrasing as a question or decision statement.",
      details: {
        decision_relevance_score: decisionRelevance,
        hint: "Try starting with 'Should I...', 'How should we...', or 'What is the best way to...'",
      },
    });
  }

  const hasErrors = issues.some(i => i.severity === "error");

  // Emit appropriate telemetry event
  if (!hasErrors) {
    emit(TelemetryEvents.PreflightValidationPassed, {
      metrics,
      issue_count: issues.length,
      warning_count: issues.filter(i => i.severity === "warning").length,
    });
  } else {
    emit(TelemetryEvents.PreflightValidationFailed, {
      metrics,
      issue_count: issues.length,
      error_count: issues.filter(i => i.severity === "error").length,
      issue_codes: issues.map(i => i.code),
    });
  }

  return {
    valid: !hasErrors,
    issues,
    metrics,
  };
}

// Export for testing
export const __test_only = {
  calculateEntropy,
  calculateDictionaryCoverage,
  calculateDecisionRelevance,
  isLikelyGibberish,
  hasProblematicCharacters,
  COMMON_WORDS,
  DECISION_PATTERNS,
};
