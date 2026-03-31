/**
 * Tests for sanitiseAssistantHistory() — extracts .text from
 * JSON-polluted assistant turns in conversation history.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

// Import after mock is set up
import { sanitiseAssistantHistory } from "../../../../src/orchestrator/deterministic/pipeline.js";
import { log } from "../../../../src/utils/telemetry.js";

describe("sanitiseAssistantHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts .text from valid JSON assistant turn", () => {
    const messages = [
      { role: "assistant" as const, content: '{"text": "Hello", "insights": [{"type": "bias_detected"}], "recommended_actions": []}' },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe("Hello");
  });

  it("passes through plain text assistant turn unchanged", () => {
    const messages = [
      { role: "assistant" as const, content: "Hello" },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe("Hello");
  });

  it("passes through malformed JSON assistant turn unchanged", () => {
    const messages = [
      { role: "assistant" as const, content: "{broken" },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe("{broken");
  });

  it("passes through JSON with no text field unchanged", () => {
    const original = '{"insights": [{"type": "bias_detected"}]}';
    const messages = [
      { role: "assistant" as const, content: original },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe(original);
  });

  it("passes through JSON with empty text field unchanged", () => {
    const original = '{"text": "", "insights": []}';
    const messages = [
      { role: "assistant" as const, content: original },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe(original);
  });

  it("passes through JSON with whitespace-only text field unchanged", () => {
    const original = '{"text": "   ", "insights": []}';
    const messages = [
      { role: "assistant" as const, content: original },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe(original);
  });

  it("sanitises only polluted assistant turns in mixed history", () => {
    const polluted = '{"text": "Extracted", "insights": [], "recommended_actions": []}';
    const messages = [
      { role: "user" as const, content: "What should I do?" },
      { role: "assistant" as const, content: polluted },
      { role: "user" as const, content: "Tell me more" },
      { role: "assistant" as const, content: "Clean response" },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe("What should I do?");
    expect(result[1].content).toBe("Extracted");
    expect(result[2].content).toBe("Tell me more");
    expect(result[3].content).toBe("Clean response");
  });

  it("does not modify user messages even if they look like JSON", () => {
    const messages = [
      { role: "user" as const, content: '{"text": "sneaky"}' },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe('{"text": "sneaky"}');
  });

  it("passes through assistant turns with ToolResponseBlock[] content unchanged", () => {
    const blocks = [{ type: "text" as const, text: '{"text": "inside block"}' }];
    const messages = [
      { role: "assistant" as const, content: blocks },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe(blocks);
  });

  it("handles leading whitespace before JSON", () => {
    const messages = [
      { role: "assistant" as const, content: '  {"text": "Trimmed", "insights": []}' },
    ];
    const result = sanitiseAssistantHistory(messages);
    expect(result[0].content).toBe("Trimmed");
  });

  it("logs deterministic.history_json_extracted with correct fields on extraction", () => {
    const json = '{"text": "Hello world", "insights": [], "recommended_actions": []}';
    const messages = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: json },
    ];
    sanitiseAssistantHistory(messages);
    expect(log.debug).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledWith(
      { turn_index: 1, original_length: json.length, extracted_length: 11 },
      "deterministic.history_json_extracted",
    );
  });

  it("does not log when no extraction occurs", () => {
    const messages = [
      { role: "assistant" as const, content: "Plain text" },
    ];
    sanitiseAssistantHistory(messages);
    expect(log.debug).not.toHaveBeenCalled();
  });
});
