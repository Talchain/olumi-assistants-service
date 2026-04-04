/**
 * Tests for the v4 history filter.
 *
 * Verifies: cap at 10 messages, error pattern filtering,
 * system sentinel filtering, empty message filtering,
 * tool_use block filtering.
 */

import { describe, it, expect } from "vitest";
import { filterHistoryV4, sanitiseXmlHistory } from "../../../../src/orchestrator/deterministic/history-filter-v4.js";

type Msg = { role: 'user' | 'assistant'; content: string | Array<{ type: string; [k: string]: unknown }> };

describe("filterHistoryV4", () => {
  it("passes through plain text messages", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'What factors matter?' },
      { role: 'assistant', content: 'Here are the key factors for your decision.' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('What factors matter?');
  });

  it("caps at 10 messages, keeping most recent", () => {
    const messages: Msg[] = [];
    for (let i = 0; i < 14; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
    }

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(10);
    expect((result[0].content as string)).toBe('Message 4');
    expect((result[9].content as string)).toBe('Message 13');
  });

  it("extracts text from tool_call turns, dropping tool_use blocks", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'Run analysis' },
      { role: 'assistant', content: [{ type: 'text', text: 'Running the analysis now.' }, { type: 'tool_use', id: 'toolu_1', name: 'run_analysis', input: {} }] },
      { role: 'user', content: 'What happened?' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('Run analysis');
    expect(result[1].content).toBe('Running the analysis now.');
    expect(result[1].role).toBe('assistant');
    expect(typeof result[1].content).toBe('string');
    expect(result[2].content).toBe('What happened?');
  });

  it("drops tool_call turns with no text blocks", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'Run analysis' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'run_analysis', input: {} }] },
      { role: 'user', content: 'What happened?' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Run analysis');
    expect(result[1].content).toBe('What happened?');
  });

  it("drops empty and whitespace-only messages", () => {
    const messages: Msg[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: '   ' },
      { role: 'user', content: 'Real message' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Real message');
  });

  it("drops [system] sentinel messages", () => {
    const messages: Msg[] = [
      { role: 'user', content: '[system] User accepted patch abc. Applied (graph_hash: xyz).' },
      { role: 'assistant', content: 'Changes applied.' },
      { role: 'user', content: 'What now?' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Changes applied.');
    expect(result[1].content).toBe('What now?');
  });

  it("drops normaliser default text", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: "I'm here to help with your decision. What would you like to explore?" },
      { role: 'user', content: 'Add a factor' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Hi');
    expect(result[1].content).toBe('Add a factor');
  });

  it("drops error pattern messages", () => {
    const errorMessages: string[] = [
      "I couldn't generate the model. Try rephrasing your brief.",
      "Something went wrong while processing your request. Please try again.",
      "Unable to generate the decision model right now.",
      "Try rephrasing your request.",
    ];

    for (const errMsg of errorMessages) {
      const messages: Msg[] = [
        { role: 'user', content: 'Draft a model' },
        { role: 'assistant', content: errMsg },
        { role: 'user', content: 'Try again' },
      ];

      const result = filterHistoryV4(messages);
      expect(result).toHaveLength(2);
      expect(result.every((m) => typeof m.content === 'string' && m.content !== errMsg)).toBe(true);
    }
  });

  it("preserves valid assistant messages that contain error-like substrings in context", () => {
    // "please try again" in isolation should be filtered,
    // but a legitimate response mentioning "try" should be allowed
    const messages: Msg[] = [
      { role: 'user', content: 'What factors matter?' },
      { role: 'assistant', content: 'The model shows 3 factors. Consider adjusting the market size estimate.' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(filterHistoryV4([])).toEqual([]);
  });

  it("handles mixed valid and invalid messages", () => {
    const messages: Msg[] = [
      { role: 'user', content: '[system] patch applied' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'Set cost to 50' },
      { role: 'assistant', content: [{ type: 'text', text: 'Updated cost.' }, { type: 'tool_use', id: 'toolu_1', name: 'set_factor_value', input: {} }] },
      { role: 'assistant', content: 'Cost updated to 50.' },
      { role: 'user', content: 'Run analysis' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(4);
    expect(result[0].content).toBe('Set cost to 50');
    expect(result[1].content).toBe('Updated cost.');
    expect(result[2].content).toBe('Cost updated to 50.');
    expect(result[3].content).toBe('Run analysis');
  });
});

// ============================================================================
// P1 #2: XML history sanitisation
// ============================================================================

describe("sanitiseXmlHistory", () => {
  it("extracts <assistant_text> payload from XML-envelope content", () => {
    const xml = `<diagnostics>\n<turn_analysis>some internal stuff</turn_analysis>\n</diagnostics>\n<response>\n<assistant_text>Your model looks good. The key factor to address first is Development Capacity.</assistant_text>\n<blocks/>\n<suggested_actions/>\n</response>`;
    expect(sanitiseXmlHistory(xml)).toBe(
      'Your model looks good. The key factor to address first is Development Capacity.',
    );
  });

  it("passes through plain text unchanged", () => {
    const text = 'Your model looks good. The key factor to address first is Development Capacity.';
    expect(sanitiseXmlHistory(text)).toBe(text);
  });

  it("strips XML tags when no <assistant_text> but known envelope tags present", () => {
    const xml = '<diagnostics>\nsome analysis\n</diagnostics>\n<response>\nSome text without assistant_text tags.\n</response>';
    const result = sanitiseXmlHistory(xml);
    expect(result).not.toContain('<diagnostics>');
    expect(result).not.toContain('<response>');
    expect(result).toContain('Some text without assistant_text tags.');
  });

  it("handles malformed XML (missing closing tag) by stripping tags", () => {
    const xml = '<diagnostics>\nsome analysis\n<response>\n<assistant_text>Good text here.';
    // No closing </assistant_text> → regex won't match → falls through to tag stripping (has <diagnostics>)
    const result = sanitiseXmlHistory(xml);
    expect(result).not.toContain('<diagnostics>');
    expect(result).toContain('Good text here.');
  });

  it("returns empty string for empty <assistant_text> in full envelope", () => {
    const xml = '<diagnostics>\nstuff\n</diagnostics>\n<response>\n<assistant_text></assistant_text>\n<blocks/>\n</response>';
    const result = sanitiseXmlHistory(xml);
    // Empty <assistant_text> → returns '' immediately (not diagnostics text)
    expect(result).toBe('');
  });

  it("returns empty string for isolated empty <assistant_text></assistant_text>", () => {
    const xml = '<assistant_text></assistant_text>';
    const result = sanitiseXmlHistory(xml);
    // Isolated empty tag → regex matches and returns captured empty group
    expect(result).toBe('');
  });

  it("empty <assistant_text> is dropped by filterHistoryV4 empty-message guard", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'Draft a model' },
      {
        role: 'assistant',
        content: '<diagnostics>\nstuff\n</diagnostics>\n<response>\n<assistant_text></assistant_text>\n<blocks/>\n</response>',
      },
      { role: 'user', content: 'Try again' },
    ];

    const result = filterHistoryV4(messages);
    // The assistant message should be dropped (empty after sanitisation)
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Draft a model');
    expect(result[1].content).toBe('Try again');
  });

  it("does not modify user messages with angle brackets (called only on assistant)", () => {
    // sanitiseXmlHistory is only called for assistant-role messages.
    // This tests that content without known envelope tags passes through.
    const code = 'Use x < 5 && y > 3 to filter the data.';
    expect(sanitiseXmlHistory(code)).toBe(code);
  });
});

describe("filterHistoryV4 — XML sanitisation integration", () => {
  it("extracts assistant_text from XML-envelope assistant messages in history", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'Draft a model for my hiring decision' },
      {
        role: 'assistant',
        content: '<diagnostics>\n<turn_analysis>analysis</turn_analysis>\n</diagnostics>\n<response>\n<assistant_text>Here is your decision model with 8 factors.</assistant_text>\n<blocks/>\n<suggested_actions/>\n</response>',
      },
      { role: 'user', content: 'What should I focus on?' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(3);
    expect(result[1].content).toBe('Here is your decision model with 8 factors.');
  });

  it("does not modify user messages containing angle brackets", () => {
    const messages: Msg[] = [
      { role: 'user', content: 'The price range is $50-$100 and growth > 5%.' },
      { role: 'assistant', content: 'Understood, I will factor in that price range.' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('The price range is $50-$100 and growth > 5%.');
  });

  it("handles JSON-envelope history unchanged (existing behaviour)", () => {
    // JSON content is handled by sanitiseAssistantHistory upstream,
    // but even if it reaches filterHistoryV4, it should pass through
    // (no envelope XML tags present).
    const messages: Msg[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '{"text": "Hello!", "insights": []}' },
    ];

    const result = filterHistoryV4(messages);
    expect(result).toHaveLength(2);
    // JSON is not modified by XML sanitiser (no envelope tags)
    expect(result[1].content).toBe('{"text": "Hello!", "insights": []}');
  });
});
