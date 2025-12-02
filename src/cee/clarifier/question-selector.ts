import type { Ambiguity } from "./ambiguity-detector.js";
import { randomUUID } from "node:crypto";

export type QuestionType = "binary" | "multiple_choice" | "open_ended";

export interface QuestionCandidate {
  id: string;
  question: string;
  question_type: QuestionType;
  options?: string[];
  targets_ambiguity: string;
  ambiguity_type: Ambiguity["type"];
  score: number;
}

export interface ConversationHistoryEntry {
  question_id: string;
  question?: string;
  answer?: string;
  /** Optional question type for diversity scoring (Enhancement 3.1) */
  question_type?: QuestionType;
}

// Heuristic scores by ambiguity type (Phase 1: no ISL dependency)
const AMBIGUITY_TYPE_SCORES: Record<Ambiguity["type"], number> = {
  missing_node: 0.8,
  uncertain_edge: 0.6,
  multiple_interpretations: 0.4,
};

// Question type diversity bonus
const DIVERSITY_BONUS = 0.1;

export function scoreQuestionCandidate(
  candidate: Omit<QuestionCandidate, "score">,
  conversationHistory: ConversationHistoryEntry[]
): number {
  let score = AMBIGUITY_TYPE_SCORES[candidate.ambiguity_type] ?? 0.5;

  // Check if this exact question was already asked (by comparing text)
  const alreadyAsked = conversationHistory.some(
    (h) => h.question?.toLowerCase() === candidate.question.toLowerCase()
  );
  if (alreadyAsked) {
    return 0; // Never ask the same question twice
  }

  // Enhancement 3.1: Apply diversity bonus if question type differs from recent history
  const recentHistory = conversationHistory.slice(-2);
  const recentTypes = new Set<QuestionType>();
  for (const entry of recentHistory) {
    if (entry.question_type) {
      recentTypes.add(entry.question_type);
    }
  }

  // Boost questions of a different type than recent ones
  if (recentTypes.size > 0 && !recentTypes.has(candidate.question_type)) {
    score += DIVERSITY_BONUS;
  }

  // Boost MCQ questions slightly (more actionable for users)
  if (candidate.question_type === "multiple_choice" && candidate.options?.length) {
    score += 0.05;
  }

  return Math.max(0, Math.min(1, score));
}

export function createQuestionCandidate(
  ambiguity: Ambiguity,
  question: string,
  questionType: QuestionType,
  options?: string[]
): Omit<QuestionCandidate, "score"> {
  return {
    id: `q_${randomUUID().slice(0, 8)}`,
    question,
    question_type: questionType,
    options,
    targets_ambiguity: ambiguity.description,
    ambiguity_type: ambiguity.type,
  };
}

export function selectBestQuestion(
  candidates: QuestionCandidate[],
  _conversationHistory: ConversationHistoryEntry[]
): QuestionCandidate | null {
  if (candidates.length === 0) return null;

  // Filter out questions with score <= 0.1 (not worth asking)
  const worthAsking = candidates.filter((q) => q.score > 0.1);
  if (worthAsking.length === 0) return null;

  // Sort by score descending (diversity bonus already applied in scoreQuestionCandidate)
  const ranked = worthAsking.sort((a, b) => b.score - a.score);

  // Return highest scored question
  return ranked[0];
}

export function rankAndScoreCandidates(
  candidates: Array<Omit<QuestionCandidate, "score">>,
  conversationHistory: ConversationHistoryEntry[]
): QuestionCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      score: scoreQuestionCandidate(c, conversationHistory),
    }))
    .sort((a, b) => b.score - a.score);
}
