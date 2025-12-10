/**
 * Risk Tolerance Elicitation Module
 *
 * Assesses user risk tolerance through a series of scenario-based questions.
 * Maps responses to a risk profile with a recommended utility coefficient.
 *
 * Two modes:
 * - get_questions: Returns questions for the user to answer
 * - process_responses: Calculates risk profile from user responses
 *
 * @example
 * // Get questions
 * elicitRiskTolerance({ mode: 'get_questions', context: 'product' })
 * // → { questions: [...], provenance: 'cee' }
 *
 * // Process responses
 * elicitRiskTolerance({
 *   mode: 'process_responses',
 *   responses: [{ question_id: 'q1', option_id: 'o1' }, ...]
 * })
 * // → { profile: {...}, breakdown: {...}, confidence: 'high', provenance: 'cee' }
 */

// ===== Types =====

export interface RiskToleranceOption {
  id: string;
  label: string;
  description?: string;
  risk_score: number; // 0 = risk averse, 50 = neutral, 100 = risk seeking
}

export interface RiskToleranceQuestion {
  id: string;
  question: string;
  category: "certainty" | "loss_aversion" | "time_preference";
  options: RiskToleranceOption[];
}

export interface RiskToleranceQuestionnaire {
  context: "product" | "business";
  questions: RiskToleranceQuestion[];
}

export interface RiskToleranceInput {
  mode: "get_questions" | "process_responses";
  context?: "product" | "business";
  responses?: Array<{ question_id: string; option_id: string }>;
}

export interface GetQuestionsOutput {
  questions: Array<{
    id: string;
    question: string;
    options: Array<{
      id: string;
      label: string;
      description?: string;
      risk_score: number;
    }>;
  }>;
  provenance: "cee";
}

export interface RiskProfile {
  type: "risk_averse" | "risk_neutral" | "risk_seeking";
  score: number; // 0-100
  reasoning: string;
  recommended_coefficient: number; // 0.2, 0.5, or 0.8
}

export interface RiskBreakdown {
  certainty: number; // 0-100
  loss_aversion: number; // 0-100
  time_preference: number; // 0-100
}

export interface ProcessResponsesOutput {
  profile: RiskProfile;
  breakdown: RiskBreakdown;
  confidence: "high" | "medium" | "low";
  provenance: "cee";
}

export type RiskToleranceOutput = GetQuestionsOutput | ProcessResponsesOutput;

// ===== Question Data =====

const PRODUCT_QUESTIONS: RiskToleranceQuestion[] = [
  {
    id: "q1_feature_launch",
    question:
      "You're deciding when to launch a new feature. The feature is functional but has some rough edges. What's your preference?",
    category: "certainty",
    options: [
      {
        id: "q1_o1",
        label: "Wait for polish",
        description: "Delay launch by 2 weeks to refine UX and fix edge cases",
        risk_score: 20,
      },
      {
        id: "q1_o2",
        label: "Soft launch",
        description: "Release to 10% of users, gather feedback, then iterate",
        risk_score: 50,
      },
      {
        id: "q1_o3",
        label: "Ship now",
        description: "Launch to all users immediately and fix issues as they arise",
        risk_score: 80,
      },
    ],
  },
  {
    id: "q2_mixed_results",
    question:
      "A recently launched feature shows mixed results: 60% of users love it, 25% are neutral, and 15% actively dislike it. What do you do?",
    category: "loss_aversion",
    options: [
      {
        id: "q2_o1",
        label: "Roll back",
        description: "Remove the feature to protect the unhappy 15%",
        risk_score: 15,
      },
      {
        id: "q2_o2",
        label: "Iterate",
        description: "Keep it live and address concerns through updates",
        risk_score: 50,
      },
      {
        id: "q2_o3",
        label: "Double down",
        description: "Expand the feature since majority likes it",
        risk_score: 85,
      },
    ],
  },
  {
    id: "q3_certainty",
    question:
      "You have two options for a product initiative. Which do you prefer?",
    category: "certainty",
    options: [
      {
        id: "q3_o1",
        label: "Guaranteed small win",
        description: "100% chance of 10% improvement in key metric",
        risk_score: 10,
      },
      {
        id: "q3_o2",
        label: "Moderate gamble",
        description: "60% chance of 30% improvement, 40% chance of no change",
        risk_score: 50,
      },
      {
        id: "q3_o3",
        label: "High-risk bet",
        description: "30% chance of 100% improvement, 70% chance of slight decline",
        risk_score: 90,
      },
    ],
  },
  {
    id: "q4_loss_sensitivity",
    question:
      "When evaluating a decision, what matters more to you?",
    category: "loss_aversion",
    options: [
      {
        id: "q4_o1",
        label: "Protect downside",
        description: "Minimise worst-case scenarios even if it limits upside",
        risk_score: 20,
      },
      {
        id: "q4_o2",
        label: "Balance both",
        description: "Accept moderate risks for moderate rewards",
        risk_score: 50,
      },
      {
        id: "q4_o3",
        label: "Maximise upside",
        description: "Accept significant risks for potential big wins",
        risk_score: 80,
      },
    ],
  },
  {
    id: "q5_time_preference",
    question:
      "You can choose between two product strategies:",
    category: "time_preference",
    options: [
      {
        id: "q5_o1",
        label: "Quick win",
        description: "Deliver 20% value in 1 month with high certainty",
        risk_score: 25,
      },
      {
        id: "q5_o2",
        label: "Balanced approach",
        description: "Deliver 50% value in 3 months with moderate certainty",
        risk_score: 50,
      },
      {
        id: "q5_o3",
        label: "Long-term payoff",
        description: "Potentially 200% value in 6 months but uncertain outcome",
        risk_score: 75,
      },
    ],
  },
];

const BUSINESS_QUESTIONS: RiskToleranceQuestion[] = [
  {
    id: "b1_market_entry",
    question:
      "You're considering entering a new market. What's your preferred approach?",
    category: "certainty",
    options: [
      {
        id: "b1_o1",
        label: "Pilot first",
        description: "Small-scale test in one region before committing resources",
        risk_score: 20,
      },
      {
        id: "b1_o2",
        label: "Phased rollout",
        description: "Gradual expansion with checkpoints to evaluate progress",
        risk_score: 50,
      },
      {
        id: "b1_o3",
        label: "Full commitment",
        description: "All-in launch to capture first-mover advantage",
        risk_score: 85,
      },
    ],
  },
  {
    id: "b2_investment",
    question:
      "A promising but unproven opportunity requires significant investment. How do you proceed?",
    category: "loss_aversion",
    options: [
      {
        id: "b2_o1",
        label: "Wait and see",
        description: "Let competitors test the waters first",
        risk_score: 15,
      },
      {
        id: "b2_o2",
        label: "Hedge bets",
        description: "Invest moderately while maintaining alternatives",
        risk_score: 50,
      },
      {
        id: "b2_o3",
        label: "Move fast",
        description: "Invest heavily to establish market leadership",
        risk_score: 85,
      },
    ],
  },
  {
    id: "b3_revenue_certainty",
    question:
      "For next quarter's revenue strategy, which approach appeals to you?",
    category: "certainty",
    options: [
      {
        id: "b3_o1",
        label: "Safe growth",
        description: "Focus on existing customers for guaranteed 5% growth",
        risk_score: 15,
      },
      {
        id: "b3_o2",
        label: "Balanced mix",
        description: "70% existing + 30% new customer acquisition",
        risk_score: 50,
      },
      {
        id: "b3_o3",
        label: "Aggressive expansion",
        description: "Prioritise new markets with potential 40% growth",
        risk_score: 85,
      },
    ],
  },
  {
    id: "b4_downturn",
    question:
      "During an economic downturn, what's your instinct?",
    category: "loss_aversion",
    options: [
      {
        id: "b4_o1",
        label: "Preserve capital",
        description: "Cut costs, reduce risk, weather the storm",
        risk_score: 20,
      },
      {
        id: "b4_o2",
        label: "Selective investment",
        description: "Maintain core operations, selectively invest in opportunities",
        risk_score: 50,
      },
      {
        id: "b4_o3",
        label: "Counter-cyclical move",
        description: "Invest aggressively while competitors retreat",
        risk_score: 80,
      },
    ],
  },
  {
    id: "b5_roi_timeline",
    question:
      "When evaluating strategic initiatives, what ROI timeline do you prefer?",
    category: "time_preference",
    options: [
      {
        id: "b5_o1",
        label: "Near-term focus",
        description: "Projects with <6 month payback, lower but certain returns",
        risk_score: 25,
      },
      {
        id: "b5_o2",
        label: "Medium-term balance",
        description: "1-2 year horizon with moderate uncertainty",
        risk_score: 50,
      },
      {
        id: "b5_o3",
        label: "Long-term vision",
        description: "3-5 year bets on transformative opportunities",
        risk_score: 75,
      },
    ],
  },
];

// Questionnaire registry
const QUESTIONNAIRES: Record<"product" | "business", RiskToleranceQuestionnaire> = {
  product: {
    context: "product",
    questions: PRODUCT_QUESTIONS,
  },
  business: {
    context: "business",
    questions: BUSINESS_QUESTIONS,
  },
};

// ===== Main Entry Point =====

export function elicitRiskTolerance(input: RiskToleranceInput): RiskToleranceOutput {
  if (input.mode === "get_questions") {
    return getQuestions(input.context || "product");
  } else {
    return processResponses(input.responses || [], input.context || "product");
  }
}

// ===== Get Questions =====

function getQuestions(context: "product" | "business"): GetQuestionsOutput {
  const questionnaire = QUESTIONNAIRES[context];

  return {
    questions: questionnaire.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        risk_score: o.risk_score,
      })),
    })),
    provenance: "cee",
  };
}

// ===== Process Responses =====

function processResponses(
  responses: Array<{ question_id: string; option_id: string }>,
  context: "product" | "business"
): ProcessResponsesOutput {
  const questionnaire = QUESTIONNAIRES[context];

  // Handle empty responses
  if (responses.length === 0) {
    return {
      profile: {
        type: "risk_neutral",
        score: 50,
        reasoning: "No responses provided. Defaulting to neutral risk profile.",
        recommended_coefficient: 0.5,
      },
      breakdown: {
        certainty: 50,
        loss_aversion: 50,
        time_preference: 50,
      },
      confidence: "low",
      provenance: "cee",
    };
  }

  // Map responses to scores by category
  const categoryScores: Record<string, number[]> = {
    certainty: [],
    loss_aversion: [],
    time_preference: [],
  };

  let validResponses = 0;

  for (const response of responses) {
    const question = questionnaire.questions.find((q) => q.id === response.question_id);
    if (!question) continue;

    const option = question.options.find((o) => o.id === response.option_id);
    if (!option) continue;

    categoryScores[question.category].push(option.risk_score);
    validResponses++;
  }

  // Calculate category averages
  const breakdown: RiskBreakdown = {
    certainty: calculateAverage(categoryScores.certainty),
    loss_aversion: calculateAverage(categoryScores.loss_aversion),
    time_preference: calculateAverage(categoryScores.time_preference),
  };

  // Calculate overall score (weighted average)
  const overallScore = Math.round(
    (breakdown.certainty * 0.4 + breakdown.loss_aversion * 0.35 + breakdown.time_preference * 0.25)
  );

  // Determine profile type
  const profile = determineProfile(overallScore, breakdown);

  // Determine confidence based on response coverage
  const totalQuestions = questionnaire.questions.length;
  const confidence = determineConfidence(validResponses, totalQuestions);

  return {
    profile,
    breakdown,
    confidence,
    provenance: "cee",
  };
}

// ===== Helper Functions =====

function calculateAverage(scores: number[]): number {
  if (scores.length === 0) return 50; // Default to neutral
  return Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
}

function determineProfile(score: number, breakdown: RiskBreakdown): RiskProfile {
  let type: "risk_averse" | "risk_neutral" | "risk_seeking";
  let recommended_coefficient: number;
  let reasoning: string;

  if (score <= 35) {
    type = "risk_averse";
    recommended_coefficient = 0.8;
    reasoning = generateReasoning(type, breakdown);
  } else if (score >= 65) {
    type = "risk_seeking";
    recommended_coefficient = 0.2;
    reasoning = generateReasoning(type, breakdown);
  } else {
    type = "risk_neutral";
    recommended_coefficient = 0.5;
    reasoning = generateReasoning(type, breakdown);
  }

  return {
    type,
    score,
    reasoning,
    recommended_coefficient,
  };
}

function generateReasoning(
  type: "risk_averse" | "risk_neutral" | "risk_seeking",
  breakdown: RiskBreakdown
): string {
  const certaintyDesc = getCategoryDescription("certainty", breakdown.certainty);
  const lossDesc = getCategoryDescription("loss_aversion", breakdown.loss_aversion);
  const timeDesc = getCategoryDescription("time_preference", breakdown.time_preference);

  switch (type) {
    case "risk_averse":
      return `Your responses indicate a preference for certainty and downside protection. ${certaintyDesc} ${lossDesc} This suggests using a higher risk aversion coefficient to weight certain outcomes more heavily.`;
    case "risk_seeking":
      return `Your responses indicate comfort with uncertainty and willingness to accept risk for potential gains. ${certaintyDesc} ${lossDesc} This suggests using a lower risk aversion coefficient to give weight to high-potential outcomes.`;
    case "risk_neutral":
      return `Your responses indicate a balanced approach to risk, weighing potential gains against possible losses fairly. ${certaintyDesc} ${timeDesc} A moderate risk coefficient is recommended.`;
  }
}

function getCategoryDescription(category: string, score: number): string {
  if (category === "certainty") {
    if (score <= 35) return "You strongly prefer guaranteed outcomes.";
    if (score >= 65) return "You're comfortable with uncertain outcomes.";
    return "You balance certainty with opportunity.";
  }
  if (category === "loss_aversion") {
    if (score <= 35) return "You prioritise protecting against losses.";
    if (score >= 65) return "You focus on maximising potential gains.";
    return "You weigh gains and losses fairly.";
  }
  if (category === "time_preference") {
    if (score <= 35) return "You prefer near-term, reliable results.";
    if (score >= 65) return "You're willing to wait for larger payoffs.";
    return "You balance short-term and long-term thinking.";
  }
  return "";
}

function determineConfidence(validResponses: number, totalQuestions: number): "high" | "medium" | "low" {
  const coverage = validResponses / totalQuestions;
  if (coverage >= 0.8) return "high";
  if (coverage >= 0.5) return "medium";
  return "low";
}

// ===== Validation =====

export function validateRiskToleranceInput(input: unknown): input is RiskToleranceInput {
  if (!input || typeof input !== "object") return false;

  const obj = input as Record<string, unknown>;

  if (!["get_questions", "process_responses"].includes(obj.mode as string)) {
    return false;
  }

  if (obj.context !== undefined && !["product", "business"].includes(obj.context as string)) {
    return false;
  }

  if (obj.mode === "process_responses") {
    if (!Array.isArray(obj.responses)) {
      return false;
    }
    for (const resp of obj.responses) {
      if (!resp || typeof resp !== "object") return false;
      const r = resp as Record<string, unknown>;
      if (typeof r.question_id !== "string" || typeof r.option_id !== "string") {
        return false;
      }
    }
  }

  return true;
}

// ===== Exports for testing =====

export { PRODUCT_QUESTIONS, BUSINESS_QUESTIONS, QUESTIONNAIRES };
