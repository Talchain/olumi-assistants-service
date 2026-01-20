/**
 * CEE Multi-Turn Clarifier Integration
 *
 * Enables iterative graph refinement through strategic questioning.
 *
 * ## Known Limitations / Coupling Risks
 *
 * **Prompt Coupling**: The clarifier currently reuses existing LLM operations:
 * - Question generation uses `clarify_brief` operation (round: 0)
 * - Answer incorporation uses `draft_graph` operation with a special brief
 *
 * This means changes to `clarify_brief` or `draft_graph` prompts can
 * inadvertently break clarifier behavior. A future improvement would be
 * to introduce dedicated operations/task IDs:
 * - `clarifier_question_generation` - For generating clarifying questions
 * - `clarifier_answer_incorporation` - For incorporating answers into graph
 *
 * This would decouple the clarifier from the core draft/clarify prompts
 * and allow independent prompt tuning.
 */

export {
  detectConvergence,
  type ConvergenceInput,
  type ConvergenceDecision,
  type ConvergenceStatus,
  type ConvergenceReason,
  type ConvergenceThresholds,
} from "./convergence.js";

export {
  detectAmbiguities,
  type Ambiguity,
  type AmbiguityType,
} from "./ambiguity-detector.js";

export {
  selectBestQuestion,
  rankAndScoreCandidates,
  scoreQuestionCandidate,
  createQuestionCandidate,
  type QuestionCandidate,
  type QuestionType,
  type ConversationHistoryEntry,
} from "./question-selector.js";

export {
  generateQuestionCandidates,
} from "./question-generator.js";

export {
  cacheQuestion,
  retrieveQuestion,
  deleteQuestion,
  clearQuestionCache,
  type CachedQuestion,
} from "./question-cache.js";

export {
  incorporateAnswer,
  type AnswerProcessorInput,
  type AnswerProcessorOutput,
} from "./answer-processor.js";

export {
  ANSWER_INCORPORATION_SYSTEM_PROMPT,
  QUESTION_GENERATION_SYSTEM_PROMPT,
  buildAnswerIncorporationPrompt,
  buildQuestionGenerationPrompt,
} from "./prompts.js";
