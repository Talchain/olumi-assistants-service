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
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    model: "claude-sonnet-4-5-20250929",
    latencyMs: 500,
    ...overrides,
  };
}

describe("Response Parser", () => {
  describe("parseLLMResponse", () => {
    it("extracts text from text blocks", () => {
      const result = makeResult({
        content: [
          { type: "text", text: "Hello world" },
          { type: "text", text: "Second paragraph" },
        ],
      });

      const parsed = parseLLMResponse(result);
      expect(parsed.assistant_text).toBe("Hello world\n\nSecond paragraph");
      expect(parsed.tool_invocations).toEqual([]);
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
