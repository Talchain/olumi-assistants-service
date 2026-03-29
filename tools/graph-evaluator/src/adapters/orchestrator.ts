/**
 * Orchestrator evaluator adapter — v30.3 (JSON output contract).
 *
 * Loads JSON fixtures from fixtures/orchestrator/, builds requests
 * with TurnContext + eligible_actions, scores the JSON response
 * with orchestrator-scorer.
 *
 * The v30.3 prompt expects:
 *   system = prompt text + "\n\n<TURN_CONTEXT>\n" + JSON.stringify(turnContext) + "\n</TURN_CONTEXT>\n\n<ELIGIBLE_ACTIONS>\n" + JSON.stringify(eligible_actions) + "\n</ELIGIBLE_ACTIONS>"
 *   user   = user message + "\n\nRespond with valid JSON only."
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { scoreOrchestrator } from "../orchestrator-scorer.js";
import type {
  EvaluatorAdapter,
  OrchestratorFixture,
  OrchestratorTurn,
  LLMResponse,
  GenericScoreResult,
} from "../types.js";

const JSON_FORCING_SUFFIX = "\n\nRespond with valid JSON only.";

export class OrchestratorAdapter
  implements EvaluatorAdapter<OrchestratorFixture>
{
  async loadCases(dir: string): Promise<OrchestratorFixture[]> {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

    const fixtures: OrchestratorFixture[] = [];
    for (const file of jsonFiles) {
      const content = await readFile(join(dir, file), "utf-8");
      const fixture = JSON.parse(content) as OrchestratorFixture;
      fixtures.push(fixture);
    }
    return fixtures;
  }

  /**
   * Build the system prompt: prompt text + TURN_CONTEXT + ELIGIBLE_ACTIONS.
   */
  buildSystemPrompt(fixture: OrchestratorFixture, prompt: string): string {
    const ctx = fixture.turn_context;
    const parts: string[] = [
      prompt,
      "",
      "<TURN_CONTEXT>",
      JSON.stringify(ctx, null, 2),
      "</TURN_CONTEXT>",
      "",
      "<ELIGIBLE_ACTIONS>",
      JSON.stringify(ctx.eligible_actions),
      "</ELIGIBLE_ACTIONS>",
    ];
    return parts.join("\n");
  }

  /**
   * Build the user message with JSON-forcing suffix.
   */
  buildUserMessage(fixture: OrchestratorFixture): string {
    const userMsg = fixture.turns
      ? fixture.turns.find((t) => t.role === "user")?.content ?? ""
      : fixture.user_message ?? "";

    return userMsg + JSON_FORCING_SUFFIX;
  }

  buildRequest(
    fixture: OrchestratorFixture,
    prompt: string
  ): { system: string; user: string } {
    return {
      system: this.buildSystemPrompt(fixture, prompt),
      user: this.buildUserMessage(fixture),
    };
  }

  /**
   * Check if a fixture is multi-turn (has turns with null assistant content).
   */
  isMultiTurn(fixture: OrchestratorFixture): boolean {
    return (
      Array.isArray(fixture.turns) &&
      fixture.turns.some((t) => t.role === "assistant" && t.content === null)
    );
  }

  /**
   * Build conversation history string from completed turns (for judge context).
   */
  buildConversationHistory(turns: OrchestratorTurn[]): string {
    return turns
      .map((t) => `[${t.role.toUpperCase()}]: ${t.content ?? "(pending)"}`)
      .join("\n\n");
  }

  /**
   * Get all turn segments for a multi-turn fixture.
   * Returns pairs of (conversation history so far, next user message).
   */
  getMultiTurnSegments(
    fixture: OrchestratorFixture
  ): Array<{ history: OrchestratorTurn[]; userMessage: string }> {
    if (!fixture.turns) return [];

    const segments: Array<{ history: OrchestratorTurn[]; userMessage: string }> = [];

    for (let i = 0; i < fixture.turns.length; i++) {
      const turn = fixture.turns[i];
      if (turn.role === "assistant" && turn.content === null) {
        const prevUser = i > 0 && fixture.turns[i - 1].role === "user"
          ? fixture.turns[i - 1].content ?? ""
          : "";
        const history = fixture.turns.slice(0, Math.max(0, i - 1));

        segments.push({
          history,
          userMessage: prevUser + JSON_FORCING_SUFFIX,
        });
      }
    }

    // The final user message after the last assistant null
    const lastTurn = fixture.turns[fixture.turns.length - 1];
    if (lastTurn.role === "user") {
      const history = fixture.turns.slice(0, fixture.turns.length - 1);
      segments.push({
        history,
        userMessage: (lastTurn.content ?? "") + JSON_FORCING_SUFFIX,
      });
    }

    return segments;
  }

  parseResponse(raw: string): {
    parsed: Record<string, unknown> | null;
    error?: string;
  } {
    if (!raw || raw.trim().length === 0) {
      return { parsed: null, error: "Empty response" };
    }

    // Try to parse as JSON (strip markdown fences if present)
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith("```")) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return { parsed };
      }
      return { parsed: null, error: "Response is not a JSON object" };
    } catch (err) {
      return { parsed: null, error: `JSON parse failed: ${(err as Error).message}` };
    }
  }

  score(
    fixture: OrchestratorFixture,
    parsed: Record<string, unknown> | null,
    response: LLMResponse
  ): GenericScoreResult {
    const rawText = response.raw_text ?? null;
    const result = scoreOrchestrator(fixture, rawText);

    return {
      overall: result.overall,
      dimensions: {
        valid_json: result.valid_json,
        text_quality: result.text_quality,
        insight_compliance: result.insight_compliance,
        action_eligibility: result.action_eligibility,
        fabrication_check: result.fabrication_check,
        banned_terms: result.banned_terms,
        scenario_specific: result.scenario_specific,
      },
    };
  }
}
