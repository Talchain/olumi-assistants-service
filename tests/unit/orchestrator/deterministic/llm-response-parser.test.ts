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

  it('strips unknown action_type entries and still parses as native', () => {
    // LLM occasionally hallucinates action types not in the schema.
    // The lenient path should strip those and return extraction_method: 'native'
    // rather than falling through to fallback (which would corrupt response.text).
    const input = JSON.stringify({
      text: 'Three directions worth considering:\n\n1. **Partnership** — lower risk.',
      insights: [],
      recommended_actions: [
        { action_type: 'explain_result', priority: 'high' },
        { action_type: 'generate_brief', priority: 'medium' }, // not in schema
        { action_type: 'run_analysis', priority: 'low' },
      ],
    });

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('native');
    expect(result.response.text).toBe('Three directions worth considering:\n\n1. **Partnership** — lower risk.');
    // Unknown action stripped; valid ones kept
    expect(result.response.recommended_actions).toHaveLength(2);
    expect(result.response.recommended_actions.map((a) => a.action_type)).toEqual([
      'explain_result',
      'run_analysis',
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it('strips all invalid actions when every entry has unknown action_type', () => {
    const input = JSON.stringify({
      text: 'Here is my response.',
      insights: [],
      recommended_actions: [
        { action_type: 'generate_brief', priority: 'high' },
        { action_type: 'summarise_decision', priority: 'medium' },
      ],
    });

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('native');
    expect(result.response.text).toBe('Here is my response.');
    expect(result.response.recommended_actions).toHaveLength(0);
  });

  it('does not corrupt response.text with raw JSON when action_type is invalid', () => {
    // This is the P0 regression: fallback path would set text = entire JSON buffer
    const input = JSON.stringify({
      text: 'Markdown-heavy response with **bold** and\n\nnewlines.',
      insights: [],
      recommended_actions: [{ action_type: 'hallucinated_action', priority: 'high' }],
    });

    const result = parseLLMJsonResponse(input);
    // Must NOT contain raw JSON syntax in the text field
    expect(result.response.text).not.toContain('"text":');
    expect(result.response.text).not.toContain('recommended_actions');
    expect(result.response.text).toBe('Markdown-heavy response with **bold** and\n\nnewlines.');
  });

  it('caps insights at 3 via lenient parse', () => {
    // Zod max(3) rejects 5 insights in strict mode; the lenient path should
    // truncate to 3 and return extraction_method:'native', not fallback.
    const input = JSON.stringify({
      text: 'Response.',
      insights: Array.from({ length: 5 }, (_, i) => ({
        type: 'assumption_risk',
        description: `Insight ${i}`,
        severity: 'info',
      })),
      recommended_actions: [],
    });

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('native');
    expect(result.response.text).toBe('Response.');
    expect(result.response.insights).toHaveLength(3);
    // Must NOT expose raw JSON as text
    expect(result.response.text).not.toContain('"insights"');
  });

  it('strips unknown insight type via lenient parse', () => {
    const input = JSON.stringify({
      text: 'Analysis complete.',
      insights: [
        { type: 'assumption_risk', description: 'Real insight', severity: 'info' },
        { type: 'hallucinated_type', description: 'Bad insight', severity: 'info' },
      ],
      recommended_actions: [],
    });

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('native');
    expect(result.response.text).toBe('Analysis complete.');
    expect(result.response.insights).toHaveLength(1);
    expect(result.response.insights[0].type).toBe('assumption_risk');
  });

  it('handles both invalid insight type and invalid action_type together', () => {
    const input = JSON.stringify({
      text: 'Combined lenient test.',
      insights: [
        { type: 'bias_detected', description: 'Valid insight', severity: 'warning' },
        { type: 'unknown_insight_type', description: 'Bad insight', severity: 'info' },
      ],
      recommended_actions: [
        { action_type: 'explain_result', priority: 'high' },
        { action_type: 'hallucinated_action', priority: 'medium' },
      ],
    });

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('native');
    expect(result.response.text).toBe('Combined lenient test.');
    expect(result.response.insights).toHaveLength(1);
    expect(result.response.recommended_actions).toHaveLength(1);
    expect(result.response.recommended_actions[0].action_type).toBe('explain_result');
  });

  it('applies lenient parse when JSON arrives in a markdown fence', () => {
    // fence/regex strategies now go through the same strictOrLenient helper
    const inner = JSON.stringify({
      text: 'Fenced with bad action.',
      insights: [],
      recommended_actions: [{ action_type: 'hallucinated_action', priority: 'high' }],
    });
    const input = `Here is my analysis:\n\`\`\`json\n${inner}\n\`\`\``;

    const result = parseLLMJsonResponse(input);
    expect(result.extraction_method).toBe('fence');
    expect(result.response.text).toBe('Fenced with bad action.');
    expect(result.response.recommended_actions).toHaveLength(0);
    expect(result.response.text).not.toContain('"text":');
  });
});
