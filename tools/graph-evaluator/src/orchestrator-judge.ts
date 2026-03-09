/**
 * Orchestrator LLM-as-judge scorer.
 *
 * Uses gpt-4o to rate orchestrator responses on 9 qualitative dimensions.
 * Returns a Zod-validated JudgeResult or a graceful error.
 *
 * Judge model: always gpt-4o (consistent, available).
 * Rubric version: judge_rubric_v1.
 */

import { z } from "zod";
import { getProvider } from "./providers/index.js";
import type { OrchestratorFixture, JudgeResult } from "./types.js";

// =============================================================================
// Constants
// =============================================================================

const RUBRIC_VERSION = "judge_rubric_v1";

const JUDGE_MODEL_CONFIG = {
  id: "judge-gpt-4o",
  provider: "openai" as const,
  model: "gpt-4o",
  timeout_ms: 90_000,
  reasoning_effort: null,
};

// =============================================================================
// Zod schema for judge output validation
// =============================================================================

const DimensionScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  reason: z.string().min(1),
});

const JudgeOutputSchema = z.object({
  scores: z.object({
    scientific_polymath: DimensionScoreSchema,
    causal_mechanism: DimensionScoreSchema,
    coaching_over_telling: DimensionScoreSchema,
    grounded_quantification: DimensionScoreSchema,
    warm_directness: DimensionScoreSchema,
    appropriate_brevity: DimensionScoreSchema,
    constructive_challenge: DimensionScoreSchema,
    elicitation_quality: DimensionScoreSchema,
    session_coherence: DimensionScoreSchema,
  }),
  overall_impression: z.string().min(1),
  weighted_average: z.number(),
});

export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// =============================================================================
// Judge prompt builder
// =============================================================================

function buildJudgePrompt(
  fixture: OrchestratorFixture,
  modelResponse: string,
  modelName: string,
  conversationHistory?: string
): { system: string; user: string } {
  const system = `You are evaluating an AI assistant's response quality for Olumi, a science-powered decision coaching platform. The assistant should feel like a scientific polymath who coaches through causal reasoning — warm, direct, curious, grounded in the user's model.

Score each dimension 1-5. Return ONLY a JSON object with this exact structure:
{
  "scores": {
    "scientific_polymath": { "score": N, "reason": "one line" },
    "causal_mechanism": { "score": N, "reason": "one line" },
    "coaching_over_telling": { "score": N, "reason": "one line" },
    "grounded_quantification": { "score": N, "reason": "one line" },
    "warm_directness": { "score": N, "reason": "one line" },
    "appropriate_brevity": { "score": N, "reason": "one line" },
    "constructive_challenge": { "score": N, "reason": "one line" },
    "elicitation_quality": { "score": N, "reason": "one line" },
    "session_coherence": { "score": N, "reason": "one line" }
  },
  "overall_impression": "2-3 sentences on whether this feels like Olumi",
  "weighted_average": N
}

Dimension guide:
1. Scientific polymath (5 = draws on behavioural science, economics, statistics, systems thinking; 1 = generic AI tone)
2. Causal mechanism naming (5 = names specific mechanisms like "pricing affects demand through elasticity"; 1 = correlational "pricing is related to demand")
3. Coaching over telling (5 = asks questions that surface assumptions; 1 = lectures or prescribes)
4. Grounded quantification (5 = ties coaching to specific model numbers/factors/paths from context; 1 = generic advice or invented numbers)
5. Warm directness (5 = curious, warm, confident; 1 = robotic, transactional, or excessively cautious)
6. Appropriate brevity (5 = response length matches context; 1 = over-explains or too terse)
7. Constructive challenge (5 = pushes back on assumptions constructively; 1 = never challenges or is aggressive)
8. Elicitation quality (5 = questions surface hidden assumptions and causal structure; 1 = generic "tell me more")
9. Session coherence (5 = references earlier context naturally; 1 = treats turn as isolated)

Not every dimension applies to every response. If a dimension is not applicable (e.g., session_coherence on a first turn with no history), score 3 (neutral) and note "N/A for this context".

weighted_average = mean of all 9 scores / 5 (normalised to 0-1 scale).`;

  const parts: string[] = [];

  parts.push(`Evaluated model: ${modelName}`);
  parts.push(`Fixture: ${fixture.id} — ${fixture.name}`);
  parts.push(`Stage: ${fixture.stage}`);
  parts.push("");

  // Context provided to the assistant
  parts.push("CONTEXT PROVIDED TO THE ASSISTANT:");
  if (fixture.canonical_state) {
    parts.push("Canonical state:");
    parts.push(JSON.stringify(fixture.canonical_state, null, 2));
  }
  if (fixture.graph_context) {
    parts.push("Graph context:");
    parts.push(JSON.stringify(fixture.graph_context, null, 2));
  }
  if (!fixture.canonical_state && !fixture.graph_context) {
    parts.push("(No analysis or graph context provided)");
  }
  parts.push("");

  // Conversation history for multi-turn
  if (conversationHistory) {
    parts.push("CONVERSATION HISTORY:");
    parts.push(conversationHistory);
    parts.push("");
  }

  // User message
  const userMsg = fixture.turns
    ? fixture.turns.filter((t) => t.role === "user").pop()?.content ?? ""
    : fixture.user_message ?? "";
  parts.push("USER MESSAGE:");
  parts.push(userMsg);
  parts.push("");

  parts.push("ASSISTANT RESPONSE:");
  parts.push(modelResponse);

  return { system, user: parts.join("\n") };
}

// =============================================================================
// JSON extraction from judge response
// =============================================================================

function extractJSON(text: string): unknown | null {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // noop
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // noop
    }
  }

  // Try finding first { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // noop
    }
  }

  return null;
}

// =============================================================================
// Main judge function
// =============================================================================

export async function judgeOrchestratorResponse(
  fixture: OrchestratorFixture,
  modelResponse: string,
  modelName: string,
  conversationHistory?: string
): Promise<JudgeResult> {
  const { system, user } = buildJudgePrompt(
    fixture,
    modelResponse,
    modelName,
    conversationHistory
  );

  const provider = getProvider(JUDGE_MODEL_CONFIG);
  const result = await provider.chat(system, user, JUDGE_MODEL_CONFIG);

  const judge_latency_ms = result.latency_ms;
  const judge_cost_usd =
    ((result.input_tokens ?? 0) / 1_000_000) * 2.5 +
    ((result.output_tokens ?? 0) / 1_000_000) * 10.0;

  if (!result.ok || !result.text) {
    return makeErrorResult(
      `Judge call failed: ${result.error ?? "no response"}`,
      judge_latency_ms,
      judge_cost_usd
    );
  }

  // Parse and validate
  const parsed = extractJSON(result.text);
  if (parsed === null) {
    return makeErrorResult(
      `judge_invalid: could not extract JSON from judge response`,
      judge_latency_ms,
      judge_cost_usd
    );
  }

  const validation = JudgeOutputSchema.safeParse(parsed);
  if (!validation.success) {
    return makeErrorResult(
      `judge_invalid: ${validation.error.issues.map((i) => i.message).join("; ")}`,
      judge_latency_ms,
      judge_cost_usd
    );
  }

  const judgeOutput = validation.data;

  // Recompute weighted_average to ensure consistency
  const dimScores = Object.values(judgeOutput.scores).map((d) => d.score);
  const weightedAvg = dimScores.reduce((a, b) => a + b, 0) / (dimScores.length * 5);

  return {
    rubric_version: RUBRIC_VERSION,
    scores: judgeOutput.scores,
    overall_impression: judgeOutput.overall_impression,
    weighted_average: weightedAvg,
    judge_latency_ms,
    judge_cost_usd,
  };
}

function makeErrorResult(
  error: string,
  latencyMs: number,
  costUsd: number
): JudgeResult {
  const neutralDim = { score: 0, reason: error };
  return {
    rubric_version: RUBRIC_VERSION,
    scores: {
      scientific_polymath: neutralDim,
      causal_mechanism: neutralDim,
      coaching_over_telling: neutralDim,
      grounded_quantification: neutralDim,
      warm_directness: neutralDim,
      appropriate_brevity: neutralDim,
      constructive_challenge: neutralDim,
      elicitation_quality: neutralDim,
      session_coherence: neutralDim,
    },
    overall_impression: error,
    weighted_average: 0,
    judge_latency_ms: latencyMs,
    judge_cost_usd: costUsd,
    judge_error: error,
  };
}

// Re-export for testing
export { RUBRIC_VERSION, JudgeOutputSchema };
