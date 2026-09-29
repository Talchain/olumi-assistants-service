/**
 * Readiness assessment module for CEE input validation
 *
 * Computes a readiness score (0-1) indicating how prepared a brief is
 * for decision graph generation. Higher scores indicate briefs that
 * are more likely to produce high-quality graphs.
 */

import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { validateBriefPreflight, type PreflightResult } from "./preflight.js";

// ============================================================================
// Types
// ============================================================================

export type ReadinessLevel = "ready" | "needs_clarification" | "not_ready";

export type ReadinessAssessment = {
  /** Overall readiness score (0-1) */
  score: number;

  /** Categorical readiness level */
  level: ReadinessLevel;

  /** Breakdown of contributing factors */
  factors: {
    length_score: number;
    clarity_score: number;
    decision_relevance_score: number;
    specificity_score: number;
    context_score: number;
  };

  /** Suggested clarification questions if level is "needs_clarification" */
  suggested_questions?: string[];

  /** Brief explanation of the assessment */
  summary: string;

  /** Preflight validation result */
  preflight: PreflightResult;
};

// ============================================================================
// Scoring Constants
// ============================================================================

/** Weights for each scoring factor (must sum to 1.0) */
const FACTOR_WEIGHTS = {
  length: 0.15,
  clarity: 0.25,
  decision_relevance: 0.30,
  specificity: 0.15,
  context: 0.15,
};

/** Thresholds for readiness levels */
const READINESS_THRESHOLDS = {
  ready: 0.7,          // score >= 0.7 = ready to draft
  needs_clarification: 0.4, // 0.4 <= score < 0.7 = needs clarification
  // score < 0.4 = not ready
};

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Score based on brief length (optimal range: 50-500 characters)
 */
function scoreLengthFactor(length: number): number {
  if (length < 20) return 0.1;
  if (length < 50) return 0.4;
  if (length <= 500) return 1.0;
  if (length <= 1000) return 0.9;
  if (length <= 2000) return 0.7;
  return 0.5; // Very long briefs are harder to process
}

/**
 * Score based on clarity indicators
 * - Uses dictionary coverage and entropy from preflight
 */
function scoreClarityFactor(preflight: PreflightResult): number {
  const { dictionary_coverage, entropy } = preflight.metrics;

  // Ideal: high dictionary coverage (>0.6), moderate entropy (3.5-4.5)
  let score = 0;

  // Dictionary coverage component (0-0.6)
  if (dictionary_coverage >= 0.7) score += 0.6;
  else if (dictionary_coverage >= 0.5) score += 0.4;
  else if (dictionary_coverage >= 0.3) score += 0.2;

  // Entropy component (0-0.4)
  // Normal English: ~4.0-4.5 bits/char
  if (entropy >= 3.5 && entropy <= 5.0) score += 0.4;
  else if (entropy >= 3.0 && entropy <= 5.5) score += 0.2;

  return score;
}

/**
 * Score based on decision relevance (from preflight)
 */
function scoreDecisionRelevanceFactor(preflight: PreflightResult): number {
  return preflight.metrics.decision_relevance_score;
}

/**
 * Score based on specificity indicators
 * - Numbers, percentages, dates
 * - Named entities (capitalized words)
 * - Specific terms vs generic language
 */
function scoreSpecificityFactor(brief: string): number {
  let score = 0.3; // Base score

  // Numbers/metrics present (suggests concrete data)
  if (/\d+/.test(brief)) score += 0.2;

  // Percentages or currency
  if (/\d+%|\$\d+|€\d+|£\d+/.test(brief)) score += 0.15;

  // Time references (suggests concrete timeline)
  if (/\b(month|year|week|day|quarter|Q[1-4]|20\d{2})\b/i.test(brief)) score += 0.1;

  // Named entities (capitalized words that aren't sentence starters)
  const namedEntities = brief.match(/(?<=[a-z]\s)[A-Z][a-z]+/g) || [];
  if (namedEntities.length > 0) score += 0.1;

  // Comparative language (suggests trade-off thinking)
  if (/\b(versus|vs\.?|compared to|rather than|instead of)\b/i.test(brief)) score += 0.15;

  return Math.min(1.0, score);
}

/**
 * Score based on context completeness
 * - Goals mentioned
 * - Constraints mentioned
 * - Stakeholders mentioned
 * - Success criteria mentioned
 */
function scoreContextFactor(brief: string): number {
  let score = 0.2; // Base score

  // Goal/objective indicators
  if (/\b(goal|objective|aim|target|want to|need to|trying to)\b/i.test(brief)) {
    score += 0.2;
  }

  // Constraint indicators
  if (/\b(constraint|limit|budget|deadline|must|cannot|requirement)\b/i.test(brief)) {
    score += 0.2;
  }

  // Stakeholder indicators
  if (/\b(team|customer|user|stakeholder|client|manager|employee|developer)\b/i.test(brief)) {
    score += 0.15;
  }

  // Success criteria indicators
  if (/\b(success|measure|metric|KPI|outcome|result|impact)\b/i.test(brief)) {
    score += 0.15;
  }

  // Problem statement
  if (/\b(problem|challenge|issue|concern|risk)\b/i.test(brief)) {
    score += 0.1;
  }

  return Math.min(1.0, score);
}

export type FactorName = "length" | "clarity" | "decision_relevance" | "specificity" | "context";

export type TargetedQuestion = {
  question: string;
  targets_factor: FactorName;
};

/**
 * Generate clarification questions based on missing context
 * Returns targeted questions with the factor they aim to improve
 */
function generateClarificationQuestions(
  brief: string,
  factors: ReadinessAssessment["factors"]
): string[] {
  const questions: string[] = [];

  // Low decision relevance
  if (factors.decision_relevance_score < 0.5) {
    questions.push("What specific decision are you trying to make?");
  }

  // Low specificity
  if (factors.specificity_score < 0.5) {
    questions.push("What are the key constraints or parameters for this decision?");
    questions.push("Are there specific metrics or success criteria you're targeting?");
  }

  // Low context
  if (factors.context_score < 0.5) {
    if (!/\b(goal|objective|aim)\b/i.test(brief)) {
      questions.push("What is the main goal or objective you're trying to achieve?");
    }
    if (!/\b(team|stakeholder|customer)\b/i.test(brief)) {
      questions.push("Who are the key stakeholders affected by this decision?");
    }
  }

  // Generic fallback questions
  if (questions.length === 0 && factors.clarity_score < 0.6) {
    questions.push("Could you provide more details about the context?");
    questions.push("What options are you currently considering?");
  }

  // Limit to 3 questions
  return questions.slice(0, 3);
}

/**
 * Generate targeted clarification questions based on weakest factors
 * Each question is tagged with the factor it aims to improve
 */
export function generateTargetedClarificationQuestions(
  brief: string,
  factors: ReadinessAssessment["factors"]
): TargetedQuestion[] {
  const questions: TargetedQuestion[] = [];

  // Sort factors by score (weakest first)
  const sortedFactors = Object.entries(factors)
    .map(([key, value]) => ({
      name: key.replace(/_score$/, "") as FactorName,
      score: value
    }))
    .sort((a, b) => a.score - b.score);

  // Generate questions targeting weakest factors
  for (const factor of sortedFactors) {
    if (factor.score >= 0.6 || questions.length >= 3) break;

    switch (factor.name) {
      case "decision_relevance":
        questions.push({
          question: "What specific decision are you trying to make?",
          targets_factor: "decision_relevance"
        });
        if (factor.score < 0.3) {
          questions.push({
            question: "What are the options you're choosing between?",
            targets_factor: "decision_relevance"
          });
        }
        break;

      case "specificity":
        questions.push({
          question: "What are the key constraints or parameters for this decision?",
          targets_factor: "specificity"
        });
        if (factor.score < 0.4) {
          questions.push({
            question: "Are there specific metrics or success criteria you're targeting?",
            targets_factor: "specificity"
          });
        }
        break;

      case "context":
        if (!/\b(goal|objective|aim)\b/i.test(brief)) {
          questions.push({
            question: "What is the main goal or objective you're trying to achieve?",
            targets_factor: "context"
          });
        }
        if (!/\b(team|stakeholder|customer)\b/i.test(brief)) {
          questions.push({
            question: "Who are the key stakeholders affected by this decision?",
            targets_factor: "context"
          });
        }
        if (!/\b(timeline|deadline|when)\b/i.test(brief)) {
          questions.push({
            question: "What is the timeline or deadline for this decision?",
            targets_factor: "context"
          });
        }
        break;

      case "clarity":
        questions.push({
          question: "Could you provide more details about the context?",
          targets_factor: "clarity"
        });
        questions.push({
          question: "What options are you currently considering?",
          targets_factor: "clarity"
        });
        break;

      case "length":
        questions.push({
          question: "Could you expand on the background and reasoning behind this decision?",
          targets_factor: "length"
        });
        break;
    }
  }

  // Limit to 3 questions and deduplicate
  const seen = new Set<string>();
  return questions
    .filter(q => {
      if (seen.has(q.question)) return false;
      seen.add(q.question);
      return true;
    })
    .slice(0, 3);
}

/**
 * Find the weakest factor from the assessment
 */
export function findWeakestFactor(factors: ReadinessAssessment["factors"]): FactorName {
  const entries = Object.entries(factors) as [string, number][];
  const sorted = entries.sort((a, b) => a[1] - b[1]);
  return sorted[0][0].replace(/_score$/, "") as FactorName;
}

/**
 * Compress previous answers for multi-round clarification
 * Returns a summarized context string suitable for LLM prompts
 */
export function compressPreviousAnswers(
  previousAnswers: Array<{ question: string; answer: string }> | undefined
): string | undefined {
  if (!previousAnswers || previousAnswers.length === 0) {
    return undefined;
  }

  // Format as concise Q&A pairs
  const compressed = previousAnswers.map((qa, idx) => {
    // Truncate long answers to 200 chars
    const answer = qa.answer.length > 200
      ? qa.answer.slice(0, 197) + "..."
      : qa.answer;
    return `Q${idx + 1}: ${qa.question}\nA${idx + 1}: ${answer}`;
  }).join("\n\n");

  // Add context header
  return `[Previous clarifications]\n${compressed}`;
}

/**
 * Generate summary based on assessment
 */
function generateSummary(level: ReadinessLevel, factors: ReadinessAssessment["factors"]): string {
  if (level === "ready") {
    return "Brief is ready for decision graph generation. It contains clear decision context and sufficient detail.";
  }

  if (level === "not_ready") {
    const lowestFactor = Object.entries(factors)
      .sort((a, b) => a[1] - b[1])[0];
    return `Brief is not ready for processing. ${lowestFactor[0].replace(/_/g, " ")} is too low. Please provide a clearer decision statement.`;
  }

  // needs_clarification
  const weakFactors = Object.entries(factors)
    .filter(([_, score]) => score < 0.5)
    .map(([name]) => name.replace(/_/g, " "));

  if (weakFactors.length > 0) {
    return `Brief could benefit from clarification. Areas to improve: ${weakFactors.join(", ")}.`;
  }

  return "Brief is acceptable but could be improved with additional context.";
}

// ============================================================================
// Main Assessment Function
// ============================================================================

/**
 * Assess the readiness of a brief for decision graph generation
 */
export function assessBriefReadiness(brief: string): ReadinessAssessment {
  // Run preflight validation first
  const preflight = validateBriefPreflight(brief);

  // If preflight fails with errors, return not_ready
  if (!preflight.valid) {
    return {
      score: 0,
      level: "not_ready",
      factors: {
        length_score: 0,
        clarity_score: 0,
        decision_relevance_score: 0,
        specificity_score: 0,
        context_score: 0,
      },
      summary: `Brief failed validation: ${preflight.issues[0]?.message || "Invalid input"}`,
      preflight,
    };
  }

  const trimmedBrief = brief.trim();

  // Calculate individual factor scores
  const factors = {
    length_score: scoreLengthFactor(preflight.metrics.length),
    clarity_score: scoreClarityFactor(preflight),
    decision_relevance_score: scoreDecisionRelevanceFactor(preflight),
    specificity_score: scoreSpecificityFactor(trimmedBrief),
    context_score: scoreContextFactor(trimmedBrief),
  };

  // Calculate weighted overall score
  const score =
    factors.length_score * FACTOR_WEIGHTS.length +
    factors.clarity_score * FACTOR_WEIGHTS.clarity +
    factors.decision_relevance_score * FACTOR_WEIGHTS.decision_relevance +
    factors.specificity_score * FACTOR_WEIGHTS.specificity +
    factors.context_score * FACTOR_WEIGHTS.context;

  // Determine readiness level
  let level: ReadinessLevel;
  if (score >= READINESS_THRESHOLDS.ready) {
    level = "ready";
  } else if (score >= READINESS_THRESHOLDS.needs_clarification) {
    level = "needs_clarification";
  } else {
    level = "not_ready";
  }

  // Generate clarification questions if needed
  const suggested_questions =
    level !== "ready" ? generateClarificationQuestions(trimmedBrief, factors) : undefined;

  // Generate summary
  const summary = generateSummary(level, factors);

  // Round scores for cleaner output
  const roundedFactors = {
    length_score: Math.round(factors.length_score * 100) / 100,
    clarity_score: Math.round(factors.clarity_score * 100) / 100,
    decision_relevance_score: Math.round(factors.decision_relevance_score * 100) / 100,
    specificity_score: Math.round(factors.specificity_score * 100) / 100,
    context_score: Math.round(factors.context_score * 100) / 100,
  };

  const assessment: ReadinessAssessment = {
    score: Math.round(score * 100) / 100,
    level,
    factors: roundedFactors,
    suggested_questions,
    summary,
    preflight,
  };

  log.debug({
    event: "cee.readiness.assessed",
    score: assessment.score,
    level: assessment.level,
    factors: roundedFactors,
  }, `Brief readiness: ${level} (score: ${assessment.score})`);

  emit(TelemetryEvents.PreflightReadinessAssessed, {
    score: assessment.score,
    level: assessment.level,
    factors: roundedFactors,
  });

  return assessment;
}

// Export for testing
export const __test_only = {
  scoreLengthFactor,
  scoreClarityFactor,
  scoreDecisionRelevanceFactor,
  scoreSpecificityFactor,
  scoreContextFactor,
  generateClarificationQuestions,
  generateTargetedClarificationQuestions,
  findWeakestFactor,
  compressPreviousAnswers,
  FACTOR_WEIGHTS,
  READINESS_THRESHOLDS,
};
