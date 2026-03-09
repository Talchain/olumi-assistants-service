/**
 * Orchestrator evaluator adapter.
 *
 * Loads JSON fixtures from fixtures/orchestrator/, builds requests
 * with stage context and canonical_state, scores the XML envelope
 * response with orchestrator-scorer.
 *
 * Unlike other adapters, the orchestrator response is XML-based (not JSON).
 * The parseResponse method returns the raw text as a single-key object
 * since scoring operates on the raw XML string directly.
 *
 * Supports multi-turn fixtures: `turns` array with assistant null content
 * that gets auto-filled by the model during evaluation.
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
   * Build the context prefix (canonical_state, graph, stage) for user messages.
   */
  buildContextPrefix(fixture: OrchestratorFixture): string {
    const parts: string[] = [];

    if (fixture.canonical_state) {
      parts.push(
        "BEGIN_UNTRUSTED_CONTEXT",
        JSON.stringify(fixture.canonical_state, null, 2),
        "END_UNTRUSTED_CONTEXT",
        ""
      );
    }

    if (fixture.graph_context) {
      parts.push(
        "<GRAPH_CONTEXT>",
        JSON.stringify(fixture.graph_context, null, 2),
        "</GRAPH_CONTEXT>",
        ""
      );
    }

    parts.push(`[Stage: ${fixture.stage.toUpperCase()}]`);
    return parts.join("\n");
  }

  buildRequest(
    fixture: OrchestratorFixture,
    prompt: string
  ): { system: string; user: string } {
    const contextPrefix = this.buildContextPrefix(fixture);

    // For multi-turn fixtures, buildRequest returns the first user message.
    // Subsequent turns are handled by buildMultiTurnMessages().
    const userMsg = fixture.turns
      ? fixture.turns.find((t) => t.role === "user")?.content ?? ""
      : fixture.user_message ?? "";

    const user = [
      contextPrefix,
      "",
      "BEGIN_UNTRUSTED_CONTEXT",
      userMsg,
      "END_UNTRUSTED_CONTEXT",
    ].join("\n");

    return { system: prompt, user };
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
   * Each segment represents one LLM call needed.
   */
  getMultiTurnSegments(
    fixture: OrchestratorFixture
  ): Array<{ history: OrchestratorTurn[]; userMessage: string }> {
    if (!fixture.turns) return [];

    const segments: Array<{ history: OrchestratorTurn[]; userMessage: string }> = [];
    const contextPrefix = this.buildContextPrefix(fixture);

    // Walk through turns. Every time we hit an assistant null, the preceding
    // user message is the prompt. Everything before is history.
    for (let i = 0; i < fixture.turns.length; i++) {
      const turn = fixture.turns[i];
      if (turn.role === "assistant" && turn.content === null) {
        // The user message is the turn just before this
        const prevUser = i > 0 && fixture.turns[i - 1].role === "user"
          ? fixture.turns[i - 1].content ?? ""
          : "";
        // History is everything before the user message
        const history = fixture.turns.slice(0, Math.max(0, i - 1));

        segments.push({
          history,
          userMessage: [
            contextPrefix,
            "",
            "BEGIN_UNTRUSTED_CONTEXT",
            prevUser,
            "END_UNTRUSTED_CONTEXT",
          ].join("\n"),
        });
      }
    }

    // The final user message after the last assistant null
    const lastTurn = fixture.turns[fixture.turns.length - 1];
    if (lastTurn.role === "user") {
      const history = fixture.turns.slice(0, fixture.turns.length - 1);
      segments.push({
        history,
        userMessage: [
          contextPrefix,
          "",
          "BEGIN_UNTRUSTED_CONTEXT",
          lastTurn.content ?? "",
          "END_UNTRUSTED_CONTEXT",
        ].join("\n"),
      });
    }

    return segments;
  }

  parseResponse(raw: string): {
    parsed: Record<string, unknown> | null;
    error?: string;
  } {
    // The orchestrator response is XML, not JSON.
    // We wrap the raw text so the generic pipeline can handle it.
    if (!raw || raw.trim().length === 0) {
      return { parsed: null, error: "Empty response" };
    }

    // Basic check: does it look like it has the envelope?
    const hasDiagnostics = raw.includes("<diagnostics>");
    const hasResponse = raw.includes("<response>");

    if (!hasDiagnostics && !hasResponse) {
      return { parsed: null, error: "Response does not contain XML envelope" };
    }

    return { parsed: { _raw_xml: raw } };
  }

  score(
    fixture: OrchestratorFixture,
    parsed: Record<string, unknown> | null,
    response: LLMResponse
  ): GenericScoreResult {
    // Score using the raw text, not the parsed wrapper
    const rawText = response.raw_text ?? (parsed as Record<string, unknown> | null)?._raw_xml as string ?? null;
    const result = scoreOrchestrator(fixture, rawText);

    return {
      overall: result.overall,
      dimensions: {
        valid_envelope: result.valid_envelope,
        diagnostics_present: result.diagnostics_present,
        assistant_text_present: result.assistant_text_present,
        blocks_tag_present: result.blocks_tag_present,
        actions_tag_present: result.actions_tag_present,
        tool_selection_correct: result.tool_selection_correct,
        no_banned_terms: result.no_banned_terms,
        uncertainty_language: result.uncertainty_language,
        block_types_valid: result.block_types_valid,
        suggested_actions_valid: result.suggested_actions_valid,
        coaching_correct: result.coaching_correct,
        no_forbidden_phrases: result.no_forbidden_phrases,
        must_contain_met: result.must_contain_met,
        xml_well_formed: result.xml_well_formed,
      },
    };
  }
}
