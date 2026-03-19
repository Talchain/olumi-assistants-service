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

// ============================================================================
// Fix 1 regression: diagnostics preamble stripping
// ============================================================================

describe('Diagnostics preamble stripping', () => {
  it('strips diagnostics preamble before <diagnostics> tag', () => {
    const raw = `Mode: INTERPRET. Stage: IDEATE. User asks about broadening...
<diagnostics>
Mode: INTERPRET
</diagnostics>
<response>
  <assistant_text>Here is my analysis.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Here is my analysis.');
    expect(parsed.assistant_text).not.toContain('Mode:');
    expect(parsed.assistant_text).not.toContain('IDEATE');
    expect(parsed.diagnostics).toContain('Mode: INTERPRET');
    expect(parsed.parse_warnings.some((w) => w.includes('preamble stripped'))).toBe(true);
  });

  it('strips untagged diagnostics when LLM omits <diagnostics> tags entirely', () => {
    const raw = `Mode: INTERPRET. Stage: IDEATE. User asks about broadening the model.
No tool needed.
<response>
  <assistant_text>Let me help with that.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Let me help with that.');
    expect(parsed.assistant_text).not.toContain('Mode:');
    expect(parsed.assistant_text).not.toContain('tool needed');
    expect(parsed.parse_warnings.some((w) => w.includes('preamble stripped'))).toBe(true);
  });

  it('strips multi-line diagnostics preamble with various keywords', () => {
    const raw = `Mode: ACT. Tool: draft_graph.
Stage: FRAME. Act-first drafting.
Context: user described a decision with two options.
Using: canonical_state graph fields.
<response>
  <assistant_text>Your model is ready.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Your model is ready.');
    expect(parsed.assistant_text).not.toContain('Mode:');
    expect(parsed.assistant_text).not.toContain('Stage:');
    expect(parsed.assistant_text).not.toContain('Context:');
  });

  it('does not strip non-diagnostics preamble text', () => {
    const raw = `Here is some normal preamble text.
<response>
  <assistant_text>Content here.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    // Normal text before <response> does not match diagnostics patterns
    // and would be stripped by extractTag finding <response> anyway
    expect(parsed.assistant_text).toBe('Content here.');
  });

  it('handles diagnostics-only output with no XML at all (Path 5 degradation)', () => {
    const raw = `Mode: INTERPRET. Stage: IDEATE. User asks about broadening the model.
No tool needed.
Here is my actual response to the user about their question.`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Here is my actual response to the user about their question.');
    expect(parsed.assistant_text).not.toContain('Mode:');
    expect(parsed.parse_warnings.some((w) => w.includes('preamble stripped'))).toBe(true);
  });

  it('does not strip prose containing words like suggest, act, recover, or interpret', () => {
    const raw = `I suggest you act on this quickly to recover your market share.
You should interpret the data carefully before making changes.
<response>
  <assistant_text>Here is the actual content.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    // The prose lines do NOT start with anchored prefixes like Mode:/Stage:
    // so they must not be stripped
    expect(parsed.assistant_text).toBe('Here is the actual content.');
    expect(parsed.parse_warnings.every((w) => !w.includes('preamble stripped'))).toBe(true);
  });

  it('does not strip prose lines that merely contain diagnostic keywords', () => {
    const raw = `The user wants to recover from a bad decision.
They need to act fast and suggest alternatives.
<response>
  <assistant_text>Let me help.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Let me help.');
    expect(parsed.parse_warnings.every((w) => !w.includes('preamble stripped'))).toBe(true);
  });

  it('fail-safe: restores original text when stripping would empty assistant_text', () => {
    // All lines match diagnostics patterns, no XML — stripping everything
    // would leave nothing. Parser should restore original.
    const raw = `Mode: INTERPRET. Stage: IDEATE.
Stage: FRAME. Something.
No tool needed.`;

    const parsed = parseOrchestratorResponse(raw);
    // Should NOT be empty — fail-safe restores the original text
    expect(parsed.assistant_text.length).toBeGreaterThan(0);
    expect(parsed.parse_warnings.some((w) => w.includes('restored original'))).toBe(true);
  });

  it('emits stripped_line_count in warning', () => {
    const raw = `Mode: ACT. Tool: draft_graph.
Stage: FRAME.
<response>
  <assistant_text>Content.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Content.');
    expect(parsed.parse_warnings.some((w) => w.includes('2 line(s)'))).toBe(true);
  });
});

// ============================================================================
// Fix 2 regression: suggested actions rescue from assistant_text
// ============================================================================

describe('Suggested actions rescue from assistant_text', () => {
  it('rescues facilitator/challenger actions from assistant_text when <suggested_actions> is empty', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Here is my analysis of the situation.

Facilitator: Need someone in 3 months — Timeline is tight, we need someone effective within 3 months.
Challenger: No rush, need it right — We can take 6 months. Getting the right setup matters more than speed.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Here is my analysis of the situation.');
    expect(parsed.assistant_text).not.toContain('Facilitator:');
    expect(parsed.assistant_text).not.toContain('Challenger:');
    expect(parsed.suggested_actions).toHaveLength(2);
    expect(parsed.suggested_actions[0]).toEqual({
      role: 'facilitator',
      label: 'Need someone in 3 months',
      message: 'Timeline is tight, we need someone effective within 3 months.',
    });
    expect(parsed.suggested_actions[1]).toEqual({
      role: 'challenger',
      label: 'No rush, need it right',
      message: 'We can take 6 months. Getting the right setup matters more than speed.',
    });
    expect(parsed.parse_warnings.some((w) => w.includes('Rescued'))).toBe(true);
  });

  it('does not rescue when <suggested_actions> already has actions', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Here is my analysis.

Facilitator: Stale leftover text — should be ignored.</assistant_text>
  <blocks></blocks>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Explore pricing</label>
      <message>Let us explore the pricing options.</message>
    </action>
  </suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    // Rescue should NOT fire because structured extraction found an action
    expect(parsed.suggested_actions).toHaveLength(1);
    expect(parsed.suggested_actions[0].label).toBe('Explore pricing');
    // The inline action-like text must remain in assistant_text untouched
    expect(parsed.assistant_text).toContain('Stale leftover text');
  });

  it('rescues actions with bold markdown role labels', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>The analysis shows two clear paths.

**Facilitator:** Go with Option A — It scores highest on your key drivers.
**Challenger:** Reconsider Option B — The sensitivity analysis shows fragile assumptions.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('The analysis shows two clear paths.');
    expect(parsed.suggested_actions).toHaveLength(2);
    expect(parsed.suggested_actions[0].role).toBe('facilitator');
    expect(parsed.suggested_actions[0].label).toBe('Go with Option A');
    expect(parsed.suggested_actions[1].role).toBe('challenger');
  });

  it('rescues actions from plain-text Path 5 output', () => {
    const raw = `Here is my analysis.

Facilitator: Explore further — Let us dig into the pricing model.
Challenger: Step back — Are we solving the right problem?`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Here is my analysis.');
    expect(parsed.suggested_actions).toHaveLength(2);
    expect(parsed.suggested_actions[0].role).toBe('facilitator');
    expect(parsed.suggested_actions[1].role).toBe('challenger');
  });

  it('rescues actions from Path 4 standalone <assistant_text>', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<assistant_text>Consider these perspectives.

Facilitator: Move forward — The data supports this direction.
Challenger: Wait for more data — Key assumptions remain untested.</assistant_text>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.assistant_text).toBe('Consider these perspectives.');
    expect(parsed.suggested_actions).toHaveLength(2);
  });

  it('does not rescue role-prefixed prose without label–message separator', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>The facilitator: the person who runs the meeting should remain neutral.
The challenger: someone who questions assumptions is valuable in any team.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    // No — or – separator means these are prose, not action chips
    expect(parsed.suggested_actions).toHaveLength(0);
    expect(parsed.assistant_text).toContain('facilitator');
    expect(parsed.assistant_text).toContain('challenger');
  });

  it('does not rescue lines that only have a role and label without a message separator', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Here is my analysis.

Facilitator: this is just a description without any dash separator.
Challenger: same here, no separator present.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    // Without — or – separator, these should NOT be rescued
    expect(parsed.suggested_actions).toHaveLength(0);
    expect(parsed.assistant_text).toContain('Facilitator:');
  });

  it('emits truncation warning when more than 4 inline actions found', () => {
    const raw = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Five paths forward.

Facilitator: Option A — Go with the first choice.
Challenger: Option B — Push back on assumptions.
Facilitator: Option C — A third alternative path.
Challenger: Option D — A fourth alternative path.
Facilitator: Option E — A fifth alternative path.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;

    const parsed = parseOrchestratorResponse(raw);
    expect(parsed.suggested_actions).toHaveLength(4);
    expect(parsed.parse_warnings.some((w) => w.includes('truncated to 4'))).toBe(true);
    // The fifth action-like line should remain in assistant_text
    expect(parsed.assistant_text).toContain('Option E');
  });
});
