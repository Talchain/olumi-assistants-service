/**
 * JSON Extractor Unit Tests
 *
 * Tests the robust JSON extraction utility that handles LLM responses
 * with conversational preamble, suffix text, and markdown code blocks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractJsonFromResponse, extractJson, closeTruncatedJson } from "../../src/utils/json-extractor.js";

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

// ───────────────────────────────────────────────────────────────────────────
// closeTruncatedJson — 2026-07-23 firefight: salvage a max_tokens-truncated
// draft by closing its structurally-complete prefix. Syntactic validity ONLY;
// the caller re-validates against the real schema.
// ───────────────────────────────────────────────────────────────────────────

describe("closeTruncatedJson — salvage a truncated draft", () => {
  const parseOk = (s: string | null): any => {
    expect(s).not.toBeNull();
    return JSON.parse(s as string);
  };

  it("recovers a graph truncated AFTER nodes+edges (mid-coaching) → valid graph WITH nodes and edges", () => {
    // The salvageable case: nodes and edges are both complete; the cut lands in
    // a later optional field. This is exactly what the adapter schema-accepts.
    const truncated =
      '{"nodes":[{"id":"dec","kind":"decision","label":"Pick"},' +
      '{"id":"opt_a","kind":"option","label":"A"}],' +
      '"edges":[{"from":"opt_a","to":"dec","strength":{"mean":0.5,"std":0.1}}],' +
      '"coaching":"You should consider the trade-off between speed and c';
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(Array.isArray(recovered.nodes)).toBe(true);
    expect(recovered.nodes).toHaveLength(2);
    expect(Array.isArray(recovered.edges)).toBe(true);
    expect(recovered.edges).toHaveLength(1);
    // The incomplete trailing field was dropped, not fabricated.
    expect(recovered.coaching).toBeUndefined();
  });

  it("drops the incomplete trailing array ELEMENT (cut mid-object) and keeps the complete ones", () => {
    const truncated =
      '{"nodes":[{"id":"a","kind":"factor","label":"A"},' +
      '{"id":"b","kind":"factor","label":"B"},' +
      '{"id":"c","kind":"fact'; // cut mid-key of the 3rd element
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(recovered.nodes).toHaveLength(2);
    expect(recovered.nodes.map((n: any) => n.id)).toEqual(["a", "b"]);
  });

  it("SAFETY: a graph cut INSIDE nodes (before edges emitted) salvages to syntactically-valid JSON that LACKS edges — the caller's schema gate must reject it", () => {
    // Proves the salvager never fabricates the missing required field; it only
    // closes complete data. `edges` is absent → the adapter's
    // AnthropicDraftResponse.safeParse (edges required) rejects it.
    const truncated =
      '{"nodes":[{"id":"a","kind":"factor","label":"A"},{"id":"b","kind":"opt';
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(recovered.nodes).toHaveLength(1);
    expect(recovered.edges).toBeUndefined();
  });

  it("drops an incomplete trailing NUMBER literal (could have been 0.7 or 0.75 — unknowable)", () => {
    const truncated = '{"edges":[{"from":"a","to":"b","strength":{"mean":0.5,"std":0.1}}],"score":0.7';
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(recovered.edges).toHaveLength(1);
    // The dangling `0.7` (which may have been mid-emission) is not trusted.
    expect(recovered.score).toBeUndefined();
  });

  it("handles escaped quotes and structural chars INSIDE string values without miscounting depth", () => {
    const truncated =
      '{"nodes":[{"id":"a","kind":"factor","label":"He said \\"go\\" — cost {high}, risk [low]"}],' +
      '"edges":[{"from":"a","to":"b","strength":{"mean":0.5,"std":0.1}}],"next":"';
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(recovered.nodes[0].label).toContain('"go"');
    expect(recovered.edges).toHaveLength(1);
  });

  it("closes deeply-nested still-open containers in the right order", () => {
    const truncated = '{"a":{"b":{"c":[1,2,3';
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(recovered).toEqual({ a: { b: { c: [1, 2] } } });
  });

  it("tolerates conversational preamble before the JSON", () => {
    const truncated = 'Here is your graph: {"nodes":[{"id":"a","kind":"decision","label":"X"}],"edges":[{"from":"a","to":"a"';
    const recovered = parseOk(closeTruncatedJson(truncated));
    expect(recovered.nodes).toHaveLength(1);
    // The last COMPLETE-element boundary is the closed nodes array; the edges
    // array had opened but held no complete element yet, so the salvage stops at
    // nodes. `{nodes}` with no edges then fails the schema gate downstream —
    // safe (no fabricated edges), just not a useful graph.
    expect(recovered.edges).toBeUndefined();
  });

  it("returns a byte-identical parse of ALREADY-complete JSON (idempotent on non-truncated input)", () => {
    const complete = '{"nodes":[{"id":"a","kind":"decision","label":"X"}],"edges":[]}';
    const recovered = parseOk(closeTruncatedJson(complete));
    expect(recovered).toEqual(JSON.parse(complete));
  });

  it("returns null when there is NO recoverable prefix (truncated before the first complete value)", () => {
    expect(closeTruncatedJson('{"nodes":[{"id":"a","kind":"dec')).toBeNull(); // no complete element yet
    expect(closeTruncatedJson('{"nodes":')).toBeNull(); // colon with no value
    expect(closeTruncatedJson('{"nodes')).toBeNull(); // mid-key
  });

  it("returns null for input with no JSON structure at all", () => {
    expect(closeTruncatedJson("I could not build a graph.")).toBeNull();
    expect(closeTruncatedJson("")).toBeNull();
  });
});
