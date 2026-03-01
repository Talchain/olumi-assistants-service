import { describe, it, expect } from "vitest";
import { extractJSON } from "../src/json-extractor.js";

describe("extractJSON", () => {
  it("returns parsed object directly for clean JSON", () => {
    const raw = '{"nodes": [], "edges": []}';
    const result = extractJSON(raw);
    expect(result.method).toBe("direct");
    expect(result.extraction_attempted).toBe(false);
    expect(result.parsed).toEqual({ nodes: [], edges: [] });
  });

  it("returns raw_text unchanged in all cases", () => {
    const raw = '{"x": 1}';
    const result = extractJSON(raw);
    expect(result.raw_text).toBe(raw);
  });

  it("strips json markdown fence and parses", () => {
    const raw = "```json\n{\"nodes\": [], \"edges\": []}\n```";
    const result = extractJSON(raw);
    expect(result.method).toBe("stripped_fence");
    expect(result.extraction_attempted).toBe(true);
    expect(result.parsed).toEqual({ nodes: [], edges: [] });
  });

  it("strips plain markdown fence (no json tag) and parses", () => {
    const raw = "```\n{\"nodes\": [], \"edges\": []}\n```";
    const result = extractJSON(raw);
    expect(result.method).toBe("stripped_fence");
    expect(result.parsed).toEqual({ nodes: [], edges: [] });
  });

  it("extracts JSON from prose preamble and postamble", () => {
    const raw =
      'Here is the graph I generated:\n\n{"nodes": [{"id": "a"}], "edges": []}\n\nI hope this helps!';
    const result = extractJSON(raw);
    expect(result.method).toBe("bracketed");
    expect(result.extraction_attempted).toBe(true);
    expect(result.parsed).toEqual({ nodes: [{ id: "a" }], edges: [] });
  });

  it("returns null parsed for completely invalid text", () => {
    const raw = "This is not JSON at all. No braces here.";
    const result = extractJSON(raw);
    expect(result.parsed).toBeNull();
    expect(result.method).toBeNull();
    expect(result.extraction_attempted).toBe(true);
  });

  it("returns null for text with braces but invalid JSON", () => {
    const raw = "Some text { not json } more text";
    const result = extractJSON(raw);
    expect(result.parsed).toBeNull();
    expect(result.method).toBeNull();
  });

  it("extracts outermost JSON object when nested objects present", () => {
    const raw = '{"outer": {"inner": {"deep": true}}, "other": 1}';
    const result = extractJSON(raw);
    expect(result.method).toBe("direct");
    expect(result.parsed).toEqual({
      outer: { inner: { deep: true } },
      other: 1,
    });
  });

  it("extracts outermost object when prose wraps nested JSON", () => {
    const raw = 'Result: {"a": {"b": 1}, "c": [1, 2, 3]} end';
    const result = extractJSON(raw);
    expect(result.method).toBe("bracketed");
    expect(result.parsed).toEqual({ a: { b: 1 }, c: [1, 2, 3] });
  });

  it("handles JSON with whitespace and newlines", () => {
    const raw = `{
  "nodes": [
    { "id": "n1", "kind": "goal" }
  ],
  "edges": []
}`;
    const result = extractJSON(raw);
    expect(result.method).toBe("direct");
    expect((result.parsed as { nodes: unknown[] }).nodes).toHaveLength(1);
  });
});
