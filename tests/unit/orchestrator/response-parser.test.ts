import { describe, it, expect } from "vitest";
import {
  parseLLMResponse,
  hasToolInvocations,
  getFirstToolInvocation,
} from "../../../src/orchestrator/response-parser.js";
import type { ChatWithToolsResult } from "../../../src/adapters/llm/types.js";

function makeResult(overrides?: Partial<ChatWithToolsResult>): ChatWithToolsResult {
  return {
    content: [],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
    model: "claude-sonnet-4-5-20250929",
    latencyMs: 500,
    ...overrides,
  };
}

describe("Response Parser", () => {
  describe("parseLLMResponse", () => {
    it("extracts text from text blocks (no XML envelope)", () => {
      const result = makeResult({
        content: [
          { type: "text", text: "Hello world" },
          { type: "text", text: "Second paragraph" },
        ],
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.assistant_text).toBe("Hello world\n\nSecond paragraph");
      expect(parsed.tool_invocations).toEqual([]);
      expect(parsed.extracted_blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
    });

    it("returns null assistant_text when no text blocks", () => {
      const result = makeResult({
        content: [
          { type: "tool_use", id: "toolu_1", name: "run_analysis", input: {} },
        ],
        stop_reason: "tool_use",
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.assistant_text).toBeNull();
      expect(parsed.extracted_blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
    });

    it("extracts tool invocations from tool_use blocks", () => {
      const result = makeResult({
        content: [
          { type: "tool_use", id: "toolu_abc", name: "draft_graph", input: { brief: "test" } },
        ],
        stop_reason: "tool_use",
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.tool_invocations).toEqual([
        { id: "toolu_abc", name: "draft_graph", input: { brief: "test" } },
      ]);
    });

    it("handles mixed text and tool_use blocks", () => {
      const result = makeResult({
        content: [
          { type: "text", text: "Let me run the analysis." },
          { type: "tool_use", id: "toolu_1", name: "run_analysis", input: {} },
        ],
        stop_reason: "tool_use",
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.assistant_text).toBe("Let me run the analysis.");
      expect(parsed.tool_invocations).toHaveLength(1);
      expect(parsed.tool_invocations[0].name).toBe("run_analysis");
    });

    it("skips empty text blocks", () => {
      const result = makeResult({
        content: [
          { type: "text", text: "" },
          { type: "text", text: "  " },
          { type: "text", text: "Actual content" },
        ],
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.assistant_text).toBe("Actual content");
    });

    it("passes through stop_reason", () => {
      expect(parseLLMResponse(makeResult({ stop_reason: "end_turn" })).stop_reason).toBe("end_turn");
      expect(parseLLMResponse(makeResult({ stop_reason: "tool_use" })).stop_reason).toBe("tool_use");
      expect(parseLLMResponse(makeResult({ stop_reason: "max_tokens" })).stop_reason).toBe("max_tokens");
    });
  });

  // =========================================================================
  // XML Envelope Extraction
  // =========================================================================

  describe("XML envelope extraction", () => {
    it("strips diagnostics, extracts commentary + review_card + suggested_actions + tool_use", () => {
      const xmlText = `<diagnostics>
Route: explain_results. Using analysis fields.
</diagnostics>
<response>
  <assistant_text>The analysis suggests Option A leads.</assistant_text>
  <blocks>
    <block>
      <type>commentary</type>
      <title>Key Drivers</title>
      <content>Pricing is the primary driver of Option A's advantage.</content>
    </block>
    <block>
      <type>review_card</type>
      <tone>challenger</tone>
      <title>Assumption Risk</title>
      <content>What if pricing assumptions are 20% off?</content>
    </block>
  </blocks>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Explore drivers</label>
      <message>What are the most sensitive factors?</message>
    </action>
    <action>
      <role>challenger</role>
      <label>Test robustness</label>
      <message>How robust is this if pricing changes?</message>
    </action>
    <action>
      <role>facilitator</role>
      <label>Should be dropped</label>
      <message>This third action exceeds the cap of 2.</message>
    </action>
  </suggested_actions>
</response>`;

      const result = makeResult({
        content: [
          { type: "text", text: xmlText },
          { type: "tool_use", id: "toolu_explain", name: "explain_results", input: { focus: "drivers" } },
        ],
        stop_reason: "tool_use",
      });

      const parsed = parseLLMResponse(result);

      // Diagnostics stripped — assistant_text is from <assistant_text>, not raw
      expect(parsed.assistant_text).toBe("The analysis suggests Option A leads.");
      expect(parsed.assistant_text).not.toContain("Route: explain_results");

      // Blocks extracted — commentary and review_card only
      expect(parsed.extracted_blocks).toHaveLength(2);

      const commentary = parsed.extracted_blocks[0];
      expect(commentary.type).toBe("commentary");
      expect(commentary.title).toBe("Key Drivers");
      expect(commentary.content).toContain("Pricing is the primary driver");

      const reviewCard = parsed.extracted_blocks[1];
      expect(reviewCard.type).toBe("review_card");
      expect(reviewCard.tone).toBe("challenger");
      expect(reviewCard.title).toBe("Assumption Risk");
      expect(reviewCard.content).toContain("pricing assumptions");

      // Suggested actions capped at 2
      expect(parsed.suggested_actions).toHaveLength(2);
      expect(parsed.suggested_actions[0].label).toBe("Explore drivers");
      expect(parsed.suggested_actions[0].role).toBe("facilitator");
      expect(parsed.suggested_actions[0].prompt).toBe("What are the most sensitive factors?");
      expect(parsed.suggested_actions[1].label).toBe("Test robustness");
      expect(parsed.suggested_actions[1].role).toBe("challenger");

      // Tool invocation still extracted
      expect(parsed.tool_invocations).toHaveLength(1);
      expect(parsed.tool_invocations[0].name).toBe("explain_results");
    });

    it("never extracts FactBlock or GraphPatchBlock from text", () => {
      const xmlText = `<diagnostics>test</diagnostics>
<response>
  <assistant_text>Here's the result.</assistant_text>
  <blocks>
    <block>
      <type>fact</type>
      <content>Some fact data</content>
    </block>
    <block>
      <type>graph_patch</type>
      <content>Some patch data</content>
    </block>
    <block>
      <type>commentary</type>
      <content>Allowed block.</content>
    </block>
  </blocks>
  <suggested_actions></suggested_actions>
</response>`;

      const result = makeResult({
        content: [{ type: "text", text: xmlText }],
      });

      const parsed = parseLLMResponse(result);

      // Only commentary extracted — fact and graph_patch silently dropped
      expect(parsed.extracted_blocks).toHaveLength(1);
      expect(parsed.extracted_blocks[0].type).toBe("commentary");
    });

    it("gracefully handles malformed XML — falls back to stripped text", () => {
      const text = `<diagnostics>internal stuff</diagnostics>
Some text without a proper response envelope.`;

      const result = makeResult({
        content: [{ type: "text", text: text }],
      });

      const parsed = parseLLMResponse(result);

      // Diagnostics stripped, remaining text used as assistant_text
      expect(parsed.assistant_text).toBe("Some text without a proper response envelope.");
      expect(parsed.assistant_text).not.toContain("internal stuff");
      expect(parsed.extracted_blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
    });

    it("handles empty blocks and suggested_actions sections", () => {
      const xmlText = `<diagnostics>ok</diagnostics>
<response>
  <assistant_text>Just text.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

      const result = makeResult({
        content: [{ type: "text", text: xmlText }],
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.assistant_text).toBe("Just text.");
      expect(parsed.extracted_blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
    });
  });

  // =========================================================================
  // Existing helpers
  // =========================================================================

  describe("hasToolInvocations", () => {
    it("returns true when tool_use blocks present", () => {
      const parsed = parseLLMResponse(makeResult({
        content: [{ type: "tool_use", id: "t1", name: "test", input: {} }],
        stop_reason: "tool_use",
      }));
      expect(hasToolInvocations(parsed)).toBe(true);
    });

    it("returns false when no tool_use blocks", () => {
      const parsed = parseLLMResponse(makeResult({
        content: [{ type: "text", text: "Hello" }],
      }));
      expect(hasToolInvocations(parsed)).toBe(false);
    });
  });

  describe("getFirstToolInvocation", () => {
    it("returns first tool invocation", () => {
      const parsed = parseLLMResponse(makeResult({
        content: [
          { type: "tool_use", id: "t1", name: "first_tool", input: { a: 1 } },
          { type: "tool_use", id: "t2", name: "second_tool", input: { b: 2 } },
        ],
        stop_reason: "tool_use",
      }));

      const first = getFirstToolInvocation(parsed);
      expect(first).toEqual({ id: "t1", name: "first_tool", input: { a: 1 } });
    });

    it("returns null when no tool invocations", () => {
      const parsed = parseLLMResponse(makeResult({
        content: [{ type: "text", text: "Hello" }],
      }));
      expect(getFirstToolInvocation(parsed)).toBeNull();
    });
  });
});
