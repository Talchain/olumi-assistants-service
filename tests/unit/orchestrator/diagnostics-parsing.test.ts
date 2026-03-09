import { describe, it, expect } from 'vitest';
import {
  parseOrchestratorResponse,
  parseLLMResponse,
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

describe('Diagnostics parsing robustness (Task 9)', () => {
  it('Path 1 (tool-only): no text content → assistant_text null, no warnings', () => {
    const result = makeResult({
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'run_analysis', input: {} },
      ],
      stop_reason: 'tool_use',
    });

    const parsed = parseLLMResponse(result);
    expect(parsed.assistant_text).toBeNull();
    expect(parsed.parse_warnings).toEqual([]);
    expect(parsed.tool_invocations).toHaveLength(1);
  });

  it('Path 2 (full envelope): diagnostics + response + assistant_text → normal parse', () => {
    const raw = `<diagnostics>
Mode: INTERPRET
Route: none
</diagnostics>
<response>
  <assistant_text>Here is my analysis of the situation.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Here is my analysis of the situation.');
    expect(parsed.diagnostics).toContain('Mode: INTERPRET');
    expect(parsed.parse_warnings).toHaveLength(0);
  });

  it('Path 3 (partial envelope): <response> present, <diagnostics> missing → warn, parse response', () => {
    const raw = `<response>
  <assistant_text>Content without diagnostics.</assistant_text>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Content without diagnostics.');
    expect(parsed.diagnostics).toBeNull();
    expect(parsed.parse_warnings.some((w) => w.includes('diagnostics'))).toBe(true);
  });

  it('Path 4 (standalone tag): no <response> but <assistant_text> extractable → extract directly with warning', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<assistant_text>I can help with that pricing question.</assistant_text>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('I can help with that pricing question.');
    expect(parsed.diagnostics).toContain('Mode: INTERPRET');
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.parse_warnings.some((w) => w.includes('<assistant_text> found'))).toBe(true);
  });

  it('Path 5 (plain text): no XML structure → entire input as assistant_text with warning', () => {
    const raw = 'Just plain text response from the LLM without any XML tags.';

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe(raw);
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.parse_warnings.some((w) => w.includes('No <response> envelope'))).toBe(true);
  });

  it('Path 6 (empty): empty or whitespace-only input → generic fallback message', () => {
    const parsed = parseOrchestratorResponse('');
    expect(parsed.assistant_text).toContain('trouble processing');
    expect(parsed.parse_warnings.some((w) => w.includes('Empty'))).toBe(true);

    // Whitespace-only also triggers path 6
    const whitespace = parseOrchestratorResponse('   \n\n  ');
    expect(whitespace.assistant_text).toContain('trouble processing');
  });
});
