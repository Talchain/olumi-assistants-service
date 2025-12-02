import type { GraphV1 } from "../../contracts/plot/engine.js";
import { log } from "../../utils/telemetry.js";
import type { Ambiguity } from "./ambiguity-detector.js";
import { buildQuestionGenerationPrompt } from "./prompts.js";
import {
  type QuestionCandidate,
  type QuestionType,
  createQuestionCandidate,
  rankAndScoreCandidates,
  type ConversationHistoryEntry,
} from "./question-selector.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { randomUUID } from "node:crypto";

interface GeneratedQuestion {
  question: string;
  question_type: QuestionType;
  options?: string[];
  why_we_ask?: string;
  targets_ambiguity?: string;
}

function parseQuestionFromLLMResponse(
  response: string,
  ambiguity: Ambiguity
): GeneratedQuestion | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn({ response_preview: response.slice(0, 200) }, "No JSON found in LLM question response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.question || typeof parsed.question !== "string") {
      log.warn({ parsed }, "Generated question missing required 'question' field");
      return null;
    }

    // Normalize question_type
    let questionType: QuestionType = "open_ended";
    if (parsed.question_type) {
      const normalizedType = parsed.question_type.toLowerCase().replace(/[_-]/g, "_");
      if (["binary", "multiple_choice", "open_ended"].includes(normalizedType)) {
        questionType = normalizedType as QuestionType;
      }
    }

    // Validate options for multiple_choice
    let options: string[] | undefined;
    if (questionType === "multiple_choice") {
      if (Array.isArray(parsed.options) && parsed.options.length >= 2) {
        options = parsed.options.filter(
          (o: any) => typeof o === "string" && o.trim().length > 0
        );
      }
      // If no valid options, downgrade to open_ended
      if (!options || options.length < 2) {
        questionType = "open_ended";
        options = undefined;
      }
    }

    return {
      question: parsed.question.trim(),
      question_type: questionType,
      options,
      why_we_ask: parsed.why_we_ask,
      targets_ambiguity: parsed.targets_ambiguity || ambiguity.description,
    };
  } catch (error) {
    log.warn(
      { error, response_preview: response.slice(0, 200) },
      "Failed to parse LLM question response"
    );
    return null;
  }
}

function generateFallbackQuestion(ambiguity: Ambiguity): GeneratedQuestion {
  // Generate a sensible fallback question based on ambiguity type
  switch (ambiguity.type) {
    case "missing_node":
      return {
        question: `The model may be missing some important factors. ${ambiguity.description} What additional elements should be considered?`,
        question_type: "open_ended",
        targets_ambiguity: ambiguity.description,
      };

    case "uncertain_edge":
      return {
        question: `There's uncertainty about some relationships in your model. ${ambiguity.description} Can you clarify how these factors relate?`,
        question_type: "multiple_choice",
        options: [
          "They're directly connected",
          "There's an intermediate factor",
          "The relationship is weak or uncertain",
          "They're not actually related",
        ],
        targets_ambiguity: ambiguity.description,
      };

    case "multiple_interpretations":
      return {
        question: `Some aspects of your decision could be interpreted different ways. ${ambiguity.description}`,
        question_type: "open_ended",
        targets_ambiguity: ambiguity.description,
      };

    default:
      return {
        question: `Could you provide more details about: ${ambiguity.description}`,
        question_type: "open_ended",
        targets_ambiguity: ambiguity.description,
      };
  }
}

export async function generateQuestionCandidates(
  ambiguities: Ambiguity[],
  graph: GraphV1,
  brief: string,
  conversationHistory: ConversationHistoryEntry[],
  requestId?: string
): Promise<QuestionCandidate[]> {
  if (ambiguities.length === 0) {
    return [];
  }

  const candidates: Array<Omit<QuestionCandidate, "score">> = [];
  const reqId = requestId || randomUUID();

  try {
    // Get LLM adapter (Fix 1.3: use correct task ID for model routing)
    const adapter = getAdapter("clarify_brief") as LLMAdapter;

    // Build history for prompt
    const historyForPrompt = conversationHistory.map((h) => ({
      question: h.question || "",
      answer: h.answer || "",
    }));

    const userPrompt = buildQuestionGenerationPrompt(
      graph,
      brief,
      ambiguities.slice(0, 3), // Focus on top 3 ambiguities
      historyForPrompt
    );

    const callOpts: CallOpts = {
      requestId: reqId,
      timeoutMs: 15000, // 15 second timeout for question generation
    };

    log.debug(
      { request_id: reqId, ambiguity_count: ambiguities.length },
      "Generating clarifying question via LLM"
    );

    // Use clarifyBrief method which is designed for question generation
    if ("clarifyBrief" in adapter && typeof adapter.clarifyBrief === "function") {
      const response = await adapter.clarifyBrief(
        {
          brief: userPrompt,
          round: 0,
          previous_answers: [],
        },
        callOpts
      );

      // Extract first question from clarifyBrief response
      if (response.questions && response.questions.length > 0) {
        const q = response.questions[0];
        const generated: GeneratedQuestion = {
          question: q.question,
          question_type: q.choices?.length ? "multiple_choice" : "open_ended",
          options: q.choices,
          why_we_ask: q.why_we_ask,
          targets_ambiguity: ambiguities[0].description,
        };
        candidates.push(
          createQuestionCandidate(
            ambiguities[0],
            generated.question,
            generated.question_type,
            generated.options
          )
        );
      }
    } else {
      // Fallback: use draftGraph and parse the response
      const response = await adapter.draftGraph(
        {
          brief: userPrompt,
          seed: Date.now(),
        },
        callOpts
      );

      // Try to parse question from response rationales or debug info
      const rawResponse = JSON.stringify(response);
      const generated = parseQuestionFromLLMResponse(rawResponse, ambiguities[0]);

      if (generated) {
        candidates.push(
          createQuestionCandidate(
            ambiguities[0],
            generated.question,
            generated.question_type,
            generated.options
          )
        );
      }
    }
  } catch (error) {
    log.warn(
      { error, request_id: reqId },
      "LLM question generation failed, using fallback"
    );
  }

  // If LLM didn't produce a question, use fallback for top ambiguity
  if (candidates.length === 0 && ambiguities.length > 0) {
    const fallback = generateFallbackQuestion(ambiguities[0]);
    candidates.push(
      createQuestionCandidate(
        ambiguities[0],
        fallback.question,
        fallback.question_type,
        fallback.options
      )
    );
  }

  // Also generate fallback questions for other ambiguities (lower priority)
  for (let i = 1; i < Math.min(ambiguities.length, 3); i++) {
    const fallback = generateFallbackQuestion(ambiguities[i]);
    candidates.push(
      createQuestionCandidate(
        ambiguities[i],
        fallback.question,
        fallback.question_type,
        fallback.options
      )
    );
  }

  // Score and rank all candidates
  return rankAndScoreCandidates(candidates, conversationHistory);
}
