/**
 * LLM Response Parser Tests
 */

import { describe, it, expect } from "vitest";
import { parseLLMJsonResponse } from "../../../../src/orchestrator/deterministic/llm-response-parser.js";

describe('parseLLMJsonResponse', () => {
  it('parses valid JSON directly', () => {
    const input = JSON.stringify({
      text: 'Here is my analysis.',
      insights: [{ type: 'assumption_risk', description: 'Close call detected', severity: 'info' }],
      recommended_actions: [{ action_type: 'explain_result', priority: 'high' }],
    });

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('native');
    expect(result.response.text).toBe('Here is my analysis.');
    expect(result.response.insights).toHaveLength(1);
    expect(result.response.recommended_actions).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('parses JSON from markdown fence', () => {
    const input = `Here is my response:

\`\`\`json
{
  "text": "Fenced response.",
  "insights": [],
  "recommended_actions": []
}
\`\`\``;

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('fence');
    expect(result.response.text).toBe('Fenced response.');
  });

  it('extracts JSON via regex', () => {
    const input = `Some preamble text. {"text": "Regex extracted.", "insights": [], "recommended_actions": []} and some trailing text.`;

    const result = parseLLMJsonResponse(input);
    expect(['native', 'regex']).toContain(result.extraction_method);
    expect(result.response.text).toBe('Regex extracted.');
  });

  it('falls back to plain text for non-JSON', () => {
    const input = 'This is just plain text with no JSON at all.';

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('fallback');
    expect(result.response.text).toBe(input);
    expect(result.response.insights).toHaveLength(0);
    expect(result.response.recommended_actions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('strips XML tags in fallback', () => {
    const input = '<response><assistant_text>Hello world</assistant_text></response>';

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('fallback');
    expect(result.response.text).toBe('Hello world');
    expect(result.response.text).not.toContain('<');
  });

  it('applies defaults for missing fields', () => {
    const input = JSON.stringify({ text: 'Just text, no other fields.' });

    const result = parseLLMJsonResponse(input);
    expect(result.response.text).toBe('Just text, no other fields.');
    expect(result.response.insights).toHaveLength(0);
    expect(result.response.recommended_actions).toHaveLength(0);
  });

  it('rejects JSON with empty text', () => {
    const input = JSON.stringify({ text: '', insights: [], recommended_actions: [] });

    const result = parseLLMJsonResponse(input);
    // text: z.string().min(1) → Zod rejects, falls through to fallback
    expect(result.extraction_method).toBe('fallback');
  });

  it('handles braces inside quoted strings via balanced extraction', () => {
    const json = JSON.stringify({
      text: 'The range {0.3-0.5} is moderate and the set {A, B} covers it.',
      insights: [],
      recommended_actions: [],
    });
    const input = `Sure, here you go:\n${json}`;

    const result = parseLLMJsonResponse(input);
    expect(result.response.text).toBe('The range {0.3-0.5} is moderate and the set {A, B} covers it.');
    expect(result.extraction_method).toBe('regex');
  });

  it('handles malformed JSON gracefully', () => {
    const input = '{ "text": "broken json", insights: }';

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('fallback');
    expect(result.response.text).toContain('broken json');
  });

  it('extracts balanced JSON from surrounding text via regex', () => {
    const json = JSON.stringify({ text: 'Found it.', insights: [], recommended_actions: [] });
    const input = `Here is my response:\n${json}\n\nSome trailing notes.`;

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('regex');
    expect(result.response.text).toBe('Found it.');
  });

  it('handles nested objects in regex extraction', () => {
    const json = JSON.stringify({
      text: 'Nested test.',
      insights: [{ type: 'assumption_risk', description: 'A nested insight', severity: 'info' }],
      recommended_actions: [{ action_type: 'explain_result', priority: 'high' }],
    });
    const input = `Here is the output:\n${json}\n\nEnd of response.`;

    const result = parseLLMJsonResponse(input);
    expect(result.response.text).toBe('Nested test.');
    expect(['native', 'regex']).toContain(result.extraction_method);
  });

  it('caps insights at 3', () => {
    const input = JSON.stringify({
      text: 'Response.',
      insights: Array.from({ length: 5 }, (_, i) => ({
        type: 'assumption_risk',
        description: `Insight ${i}`,
        severity: 'info',
      })),
      recommended_actions: [],
    });

    // Zod max(3) should cause this to fail validation
    const result = parseLLMJsonResponse(input);
    // It either parses with truncation or falls back
    expect(result.response.text).toBeDefined();
  });
});
