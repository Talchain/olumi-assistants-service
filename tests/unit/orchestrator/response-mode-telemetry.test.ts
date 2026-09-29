import { describe, it, expect } from 'vitest';
import {
  parseLLMResponse,
  extractDeclaredMode,
  inferResponseMode,
  getFirstToolInvocation,
} from '../../../src/orchestrator/response-parser.js';
import type { ChatWithToolsResult } from '../../../src/adapters/llm/types.js';

function makeResult(overrides?: Partial<ChatWithToolsResult>): ChatWithToolsResult {
  return {
    content: [],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
    model: 'claude-sonnet-4-5-20250929',
    latencyMs: 500,
    ...overrides,
  };
}

describe('Response mode telemetry (Task 7)', () => {
  it('ACT turn with edit_graph: inferred ACT, tool_selected is edit_graph', () => {
    const xmlText = `<diagnostics>
Mode: ACT
Route: edit_graph
</diagnostics>
<response>
  <assistant_text>I'll add that factor to your model.</assistant_text>
</response>`;

    const result = makeResult({
      content: [
        { type: 'text', text: xmlText },
        { type: 'tool_use', id: 'toolu_1', name: 'edit_graph', input: { operations: [{ op: 'add_node', path: 'n1' }] } },
      ],
      stop_reason: 'tool_use',
    });

    const parsed = parseLLMResponse(result);

    // Declared mode from diagnostics
    expect(extractDeclaredMode(parsed.diagnostics)).toBe('ACT');

    // Inferred mode from behaviour
    expect(inferResponseMode(parsed)).toBe('ACT');

    // Tool selected
    const tool = getFirstToolInvocation(parsed);
    expect(tool?.name).toBe('edit_graph');

    // Patch ops count
    const ops = tool?.input as Record<string, unknown>;
    expect(Array.isArray(ops.operations)).toBe(true);
    expect((ops.operations as unknown[]).length).toBe(1);
  });

  it('INTERPRET turn without tools: inferred INTERPRET, tool_selected is null', () => {
    const xmlText = `<diagnostics>
Mode: INTERPRET
</diagnostics>
<response>
  <assistant_text>Competitor pricing is an important consideration. Here's what to think about...</assistant_text>
</response>`;

    const result = makeResult({
      content: [{ type: 'text', text: xmlText }],
    });

    const parsed = parseLLMResponse(result);

    // Declared mode
    expect(extractDeclaredMode(parsed.diagnostics)).toBe('INTERPRET');

    // Inferred mode
    expect(inferResponseMode(parsed)).toBe('INTERPRET');

    // No tool
    expect(getFirstToolInvocation(parsed)).toBeNull();
  });

  it('extractDeclaredMode returns unknown for null diagnostics', () => {
    expect(extractDeclaredMode(null)).toBe('unknown');
  });

  it('extractDeclaredMode returns unknown for missing mode line', () => {
    expect(extractDeclaredMode('Route: explain_results')).toBe('unknown');
  });

  it('inferResponseMode returns RECOVER for error language', () => {
    const result = makeResult({
      content: [{ type: 'text', text: "I'm sorry, I encountered an error processing that request." }],
    });
    const parsed = parseLLMResponse(result);
    expect(inferResponseMode(parsed)).toBe('RECOVER');
  });

  it('inferResponseMode returns SUGGEST for suggestion language', () => {
    const result = makeResult({
      content: [{ type: 'text', text: 'Would you like me to add a pricing factor to your model?' }],
    });
    const parsed = parseLLMResponse(result);
    expect(inferResponseMode(parsed)).toBe('SUGGEST');
  });
});
