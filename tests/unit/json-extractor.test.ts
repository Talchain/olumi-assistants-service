/**
 * JSON Extractor Unit Tests
 *
 * Tests the robust JSON extraction utility that handles LLM responses
 * with conversational preamble, suffix text, and markdown code blocks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractJsonFromResponse, extractJson } from "../../src/utils/json-extractor.js";

// Mock telemetry to prevent actual emissions during tests
vi.mock("../../src/utils/telemetry.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  emit: vi.fn(),
  TelemetryEvents: {
    JsonExtractionRequired: "llm.json_extraction.required",
  },
}));

describe("extractJsonFromResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fast path - clean JSON", () => {
    it("parses valid JSON object without extraction", () => {
      const content = '{"nodes": [], "edges": []}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(false);
      expect(result.json).toEqual({ nodes: [], edges: [] });
    });

    it("parses valid JSON array without extraction", () => {
      const content = '[{"id": "1"}, {"id": "2"}]';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(false);
      expect(result.json).toEqual([{ id: "1" }, { id: "2" }]);
    });

    it("handles JSON with leading/trailing whitespace", () => {
      const content = '  \n  {"key": "value"}  \n  ';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(false);
      expect(result.json).toEqual({ key: "value" });
    });

    it("parses nested JSON objects", () => {
      const content = '{"outer": {"inner": {"deep": "value"}}}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(false);
      expect(result.json).toEqual({ outer: { inner: { deep: "value" } } });
    });
  });

  describe("markdown code blocks", () => {
    it("extracts JSON from ```json code block", () => {
      const content = '```json\n{"nodes": [{"id": "1"}]}\n```';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ nodes: [{ id: "1" }] });
      expect(result.extractionMethod).toBe("code_block");
    });

    it("extracts JSON from generic ``` code block", () => {
      const content = '```\n{"edges": [{"from": "a", "to": "b"}]}\n```';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ edges: [{ from: "a", to: "b" }] });
    });

    it("extracts JSON from code block with preamble text", () => {
      const content = 'Here is the JSON you requested:\n\n```json\n{"result": "success"}\n```';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ result: "success" });
      expect(result.preambleLength).toBeGreaterThan(0);
    });

    it("includes suffix length for code block extraction", () => {
      const content = '```json\n{"data": 1}\n```\n\nMore text after';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.suffixLength).toBeGreaterThan(0);
    });

    it("skips invalid first code block and uses valid second block", () => {
      const content = `Here's an example:
\`\`\`
not valid json
\`\`\`

And here's the actual result:
\`\`\`json
{"valid": true}
\`\`\``;
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ valid: true });
      expect(result.extractionMethod).toBe("code_block");
    });
  });

  describe("conversational preamble extraction", () => {
    it("handles 'I\\'ll construct...' preamble (the Claude Haiku case)", () => {
      const content = "I'll construct a decision graph for you based on your brief.\n\n{\"nodes\": [{\"id\": \"goal\", \"kind\": \"goal\", \"label\": \"Success\"}], \"edges\": []}";
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({
        nodes: [{ id: "goal", kind: "goal", label: "Success" }],
        edges: [],
      });
      expect(result.preambleLength).toBeGreaterThan(0);
    });

    it("handles 'Here is...' preamble", () => {
      const content = 'Here is the graph:\n{"nodes": []}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ nodes: [] });
    });

    it("handles 'Based on your request...' preamble", () => {
      const content = 'Based on your request, I have created the following structure:\n\n{"data": "value"}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ data: "value" });
    });

    it("handles multiline preamble", () => {
      const content = `I understand you want to create a decision model.
Let me help you with that.

Based on your brief, here's the structure:

{"nodes": [{"id": "n1", "kind": "option"}], "edges": []}`;
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({
        nodes: [{ id: "n1", kind: "option" }],
        edges: [],
      });
    });

    it("handles preamble containing braces before actual JSON (HIGH PRIORITY)", () => {
      // This is a critical case: preamble contains {foo} template-like text
      const content = 'Use `{config}` for settings. Here is the result: {"actual": "json"}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ actual: "json" });
      expect(result.extractionMethod).toBe("bracket_matching");
    });

    it("handles preamble with incomplete brace pairs before valid JSON", () => {
      const content = 'The format uses {placeholder} syntax like {name}. Output: {"valid": true, "count": 5}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ valid: true, count: 5 });
    });

    it("handles preamble with array-like brackets before valid JSON", () => {
      const content = 'Options include [a], [b], and [c]. Here is the data: [{"id": 1}, {"id": 2}]';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe("suffix text extraction", () => {
    it("handles JSON followed by explanation", () => {
      const content = '{"result": "done"}\n\nLet me know if you need anything else!';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ result: "done" });
      expect(result.suffixLength).toBeGreaterThan(0);
    });

    it("handles JSON with both preamble and suffix", () => {
      const content = 'Here is your result:\n{"value": 42}\nHope this helps!';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toEqual({ value: 42 });
      expect(result.preambleLength).toBeGreaterThan(0);
      expect(result.suffixLength).toBeGreaterThan(0);
    });
  });

  describe("complex nested structures", () => {
    it("handles deeply nested objects", () => {
      const content = '{"a": {"b": {"c": {"d": {"e": "deep"}}}}}';
      const result = extractJsonFromResponse(content);

      expect(result.json).toEqual({ a: { b: { c: { d: { e: "deep" } } } } });
    });

    it("handles arrays of objects", () => {
      const content = '[{"id": 1}, {"id": 2}, {"id": 3}]';
      const result = extractJsonFromResponse(content);

      expect(result.json).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it("handles mixed arrays and objects", () => {
      const content = '{"items": [{"name": "a"}, {"name": "b"}], "count": 2}';
      const result = extractJsonFromResponse(content);

      expect(result.json).toEqual({
        items: [{ name: "a" }, { name: "b" }],
        count: 2,
      });
    });

    it("handles strings containing braces", () => {
      const content = '{"code": "function() { return {x: 1}; }"}';
      const result = extractJsonFromResponse(content);

      expect(result.json).toEqual({ code: "function() { return {x: 1}; }" });
    });

    it("handles escaped quotes in strings", () => {
      const content = '{"message": "He said \\"hello\\""}';
      const result = extractJsonFromResponse(content);

      expect(result.json).toEqual({ message: 'He said "hello"' });
    });

    it("handles escaped backslashes", () => {
      const content = '{"path": "C:\\\\Users\\\\test"}';
      const result = extractJsonFromResponse(content);

      expect(result.json).toEqual({ path: "C:\\Users\\test" });
    });
  });

  describe("real-world LLM responses", () => {
    it("handles typical Claude draft_graph response with preamble", () => {
      const content = `I'll create a decision graph based on your budget allocation question.

{
  "nodes": [
    {"id": "goal-1", "kind": "goal", "label": "Maximize long-term success"},
    {"id": "opt-1", "kind": "option", "label": "Improve product quality"},
    {"id": "opt-2", "kind": "option", "label": "Invest in user growth"},
    {"id": "opt-3", "kind": "option", "label": "Expand customer support"}
  ],
  "edges": [
    {"from": "opt-1", "to": "goal-1"},
    {"from": "opt-2", "to": "goal-1"},
    {"from": "opt-3", "to": "goal-1"}
  ]
}`;
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(true);
      expect(result.json).toHaveProperty("nodes");
      expect(result.json).toHaveProperty("edges");
      const json = result.json as { nodes: unknown[]; edges: unknown[] };
      expect(json.nodes).toHaveLength(4);
      expect(json.edges).toHaveLength(3);
    });

    it("handles OpenAI-style clean JSON response", () => {
      const content = '{"nodes":[{"id":"g1","kind":"goal","label":"Success"}],"edges":[]}';
      const result = extractJsonFromResponse(content);

      expect(result.wasExtracted).toBe(false);
      expect(result.json).toHaveProperty("nodes");
    });
  });

  describe("error cases", () => {
    it("throws error for content without JSON", () => {
      const content = "This is just plain text with no JSON structure at all.";

      expect(() => extractJsonFromResponse(content)).toThrow(
        /No JSON structure found/
      );
    });

    it("throws error for malformed JSON", () => {
      const content = '{"unclosed": "object"';

      expect(() => extractJsonFromResponse(content)).toThrow();
    });

    it("throws error for unbalanced brackets", () => {
      const content = '{"nested": {"still": "going"';

      expect(() => extractJsonFromResponse(content)).toThrow();
    });

    it("throws error for empty content", () => {
      const content = "";

      expect(() => extractJsonFromResponse(content)).toThrow(
        /No JSON structure found/
      );
    });

    it("throws error for whitespace-only content", () => {
      const content = "   \n\t  ";

      expect(() => extractJsonFromResponse(content)).toThrow(
        /No JSON structure found/
      );
    });
  });

  describe("telemetry and logging", () => {
    it("does not log when extraction is not needed", async () => {
      const { log } = await import("../../src/utils/telemetry.js");
      const content = '{"clean": "json"}';

      extractJsonFromResponse(content, { task: "test", logWarnings: true });

      expect(log.warn).not.toHaveBeenCalled();
    });

    it("logs warning when extraction is needed", async () => {
      const { log, emit } = await import("../../src/utils/telemetry.js");
      const content = 'Preamble text {"extracted": "json"}';

      extractJsonFromResponse(content, {
        task: "draft_graph",
        model: "claude-3-5-haiku",
        correlationId: "test-123",
        logWarnings: true,
      });

      expect(log.warn).toHaveBeenCalled();
      expect(emit).toHaveBeenCalled();
    });

    it("emits telemetry for code block extraction", async () => {
      const { log, emit } = await import("../../src/utils/telemetry.js");
      const content = '```json\n{"from_block": true}\n```';

      extractJsonFromResponse(content, {
        task: "draft_graph",
        model: "claude-3-5-sonnet",
        logWarnings: true,
      });

      expect(log.warn).toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        "llm.json_extraction.required",
        expect.objectContaining({
          extraction_method: "code_block",
        })
      );
    });

    it("includes suffix_length in telemetry for all extraction methods", async () => {
      const { emit } = await import("../../src/utils/telemetry.js");

      // Boundary extraction
      extractJsonFromResponse('Preamble {"data": 1} suffix', { logWarnings: true });
      expect(emit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          suffix_length: expect.any(Number),
        })
      );

      vi.clearAllMocks();

      // Code block extraction
      extractJsonFromResponse('Preamble ```json\n{"x":1}\n``` suffix', { logWarnings: true });
      expect(emit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          suffix_length: expect.any(Number),
        })
      );
    });

    it("respects logWarnings: false option for logging but still emits telemetry", async () => {
      const { log, emit } = await import("../../src/utils/telemetry.js");
      const content = 'Preamble {"data": "value"}';

      extractJsonFromResponse(content, { logWarnings: false });

      // Logging should be suppressed
      expect(log.warn).not.toHaveBeenCalled();
      // But telemetry should still be emitted for monitoring
      expect(emit).toHaveBeenCalled();
    });
  });

  describe("includeRawContent option", () => {
    it("includes raw content when option is true", () => {
      const content = 'Preamble {"data": "value"} suffix';
      const result = extractJsonFromResponse(content, { includeRawContent: true });

      expect(result.rawContent).toBe(content);
    });

    it("excludes raw content by default", () => {
      const content = 'Preamble {"data": "value"}';
      const result = extractJsonFromResponse(content);

      expect(result.rawContent).toBeUndefined();
    });
  });

  describe("extractionMethod field", () => {
    it("returns fast_path for clean JSON", () => {
      const result = extractJsonFromResponse('{"clean": true}');
      expect(result.extractionMethod).toBe("fast_path");
    });

    it("returns code_block for markdown blocks", () => {
      const result = extractJsonFromResponse('```json\n{"x": 1}\n```');
      expect(result.extractionMethod).toBe("code_block");
    });

    it("returns boundary for simple preamble extraction", () => {
      const result = extractJsonFromResponse('Preamble {"x": 1}');
      expect(result.extractionMethod).toBe("boundary");
    });

    it("returns bracket_matching when first candidate fails", () => {
      const result = extractJsonFromResponse('Use {config} format: {"valid": true}');
      expect(result.extractionMethod).toBe("bracket_matching");
    });
  });
});

describe("extractJson convenience function", () => {
  it("returns just the parsed JSON", () => {
    const content = '{"simple": "value"}';
    const json = extractJson(content);

    expect(json).toEqual({ simple: "value" });
  });

  it("extracts JSON from preamble", () => {
    const content = 'Here is the result: {"extracted": true}';
    const json = extractJson(content);

    expect(json).toEqual({ extracted: true });
  });
});
