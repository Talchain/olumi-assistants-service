import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { Ambiguity } from "./ambiguity-detector.js";

export const ANSWER_INCORPORATION_SYSTEM_PROMPT = `You are an expert at refining decision graphs based on user clarification.

Your task is to minimally adjust an existing decision graph to incorporate new information from the user's answer to a clarifying question.

CONSTRAINTS:
- Preserve existing valid structure as much as possible
- Make only changes directly implied by the answer
- Maintain causal coherence between nodes
- Keep node/edge count within limits (max 30 nodes, max 50 edges)
- Use only these allowed node kinds: goal, decision, option, outcome, risk, action

OUTPUT:
Return ONLY a valid JSON object with the refined graph in GraphV1 format.`;

export function buildAnswerIncorporationPrompt(
  graph: GraphV1,
  brief: string,
  question: string,
  answer: string,
  conversationHistory: Array<{ question: string; answer: string }>
): string {
  const historyText =
    conversationHistory.length > 0
      ? `\n\nPREVIOUS CLARIFICATIONS:\n${conversationHistory
          .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`)
          .join("\n\n")}`
      : "";

  return `ORIGINAL BRIEF:
${brief}

CURRENT GRAPH:
${JSON.stringify(graph, null, 2)}
${historyText}

LATEST QUESTION:
${question}

USER'S ANSWER:
${answer}

Refine the graph to incorporate this clarification. Make minimal, targeted changes:
1. If the answer indicates a missing node → add it with appropriate edges
2. If the answer clarifies edge direction/strength → adjust belief values
3. If the answer resolves ambiguity → make structural change to reflect clarity
4. If the answer provides new constraints → add risk/outcome nodes as appropriate

Return the complete refined graph as valid JSON.`;
}

export const QUESTION_GENERATION_SYSTEM_PROMPT = `You are an expert at identifying ambiguities in decision models and generating strategic clarifying questions.

Your task is to generate a clarifying question that will maximally improve the quality of the decision graph.

QUESTION REQUIREMENTS:
1. Be specific to this decision context
2. Offer concrete options when possible (prefer multiple choice)
3. Feel natural and conversational, not interrogative
4. Focus on the highest-impact ambiguity first
5. Don't ask what's already been answered

PREFERRED QUESTION TYPES (in order):
1. multiple_choice - Most actionable (3-5 options)
2. binary - Yes/No questions for clear trade-offs
3. open_ended - Only when options can't be predetermined

OUTPUT FORMAT:
{
  "question": "Your clarifying question",
  "question_type": "multiple_choice" | "binary" | "open_ended",
  "options": ["Option A", "Option B", "Option C"],  // Required for multiple_choice
  "why_we_ask": "Brief explanation of why this matters",
  "targets_ambiguity": "What this resolves"
}`;

export function buildQuestionGenerationPrompt(
  graph: GraphV1,
  brief: string,
  ambiguities: Ambiguity[],
  conversationHistory: Array<{ question: string; answer: string }>
): string {
  const ambiguityList = ambiguities
    .map(
      (a, i) =>
        `${i + 1}. [${a.type}] ${a.description}${a.location ? ` (at: ${JSON.stringify(a.location)})` : ""}`
    )
    .join("\n");

  const historyText =
    conversationHistory.length > 0
      ? `\n\nQUESTIONS ALREADY ASKED:\n${conversationHistory
          .map((h, i) => `Q${i + 1}: ${h.question}`)
          .join("\n")}`
      : "";

  return `DECISION BRIEF:
${brief}

CURRENT GRAPH SUMMARY:
- ${(graph.nodes ?? []).length} nodes
- ${((graph as any).edges ?? []).length} edges
- Node kinds: ${[...new Set((graph.nodes ?? []).map((n: any) => n.kind))].join(", ")}

DETECTED AMBIGUITIES (prioritized):
${ambiguityList}
${historyText}

Generate ONE clarifying question that addresses the highest-priority ambiguity not yet covered by previous questions.

EXAMPLES OF GOOD QUESTIONS:
- "Should competitor response be modeled as affecting churn directly, or through market perception?"
  Options: ["Direct impact on churn", "Through market perception", "Both pathways"]
- "What timeframe should we consider for this decision?"
  Options: ["Next quarter", "Next year", "3-5 years", "Ongoing/indefinite"]
- "Is budget the primary constraint, or are there other factors equally important?"
  Options: ["Budget is primary", "Time is equally important", "Team capacity matters most", "All are roughly equal"]

Return your question as a JSON object.`;
}
