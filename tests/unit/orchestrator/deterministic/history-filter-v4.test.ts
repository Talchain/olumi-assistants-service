/**
 * Tests for the v4 history filter.
 *
 * Verifies: cap at 10 messages, error pattern filtering,
 * system sentinel filtering, empty message filtering,
 * tool_use block filtering.
 */

import { describe, it, expect } from "vitest";
import { filterHistoryV4 } from "../../../../src/orchestrator/deterministic/history-filter-v4.js";

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
