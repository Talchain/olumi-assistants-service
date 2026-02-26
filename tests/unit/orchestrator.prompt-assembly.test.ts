/**
 * Tests for Orchestrator Prompt Assembly
 *
 * Verifies that assembleSystemPrompt:
 * - Loads Zone 1 (static prompt) from the prompt management system
 * - Appends Zone 2 (dynamic context) after Zone 1
 * - Is deterministic given the same ConversationContext input
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { assembleSystemPrompt } from '../../src/orchestrator/prompt-assembly.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import type { ConversationContext } from '../../src/orchestrator/types.js';

// Register defaults before tests (prompt store not available in unit tests)
beforeEach(() => {
  registerAllDefaultPrompts();
});

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    messages: [],
    framing: { stage: 'frame', goal: '' },
    ...overrides,
  } as ConversationContext;
}

describe('assembleSystemPrompt', () => {
  it('starts with Zone 1 prompt and contains all structural markers', async () => {
    const result = await assembleSystemPrompt(makeContext());

    // Zone 1 must be at the very start — first line is the prompt header
    expect(result.startsWith('Olumi Orchestrator')).toBe(true);

    // All Zone 1 structural markers present
    expect(result).toContain('<ROLE>');
    expect(result).toContain('<CORE_RULES>');
    expect(result).toContain('<TOOLS>');
    expect(result).toContain('<OUTPUT_FORMAT>');
    expect(result).toContain('<DIAGNOSTICS>');
    expect(result).toContain('<RULES_REMINDER>');
  });

  it('appends dynamic context (stage) after Zone 1', async () => {
    const result = await assembleSystemPrompt(makeContext({
      framing: { stage: 'evaluate', goal: '' },
    }));

    expect(result).toContain('Current stage: evaluate');
    // Zone 1 ends with </RULES_REMINDER>, Zone 2 follows after
    const rulesReminderEnd = result.indexOf('</RULES_REMINDER>');
    const stageIndex = result.indexOf('Current stage: evaluate');
    expect(rulesReminderEnd).toBeLessThan(stageIndex);
  });

  it('appends goal when present in context', async () => {
    const result = await assembleSystemPrompt(makeContext({
      framing: { stage: 'frame', goal: 'Increase market share by 15%' },
    }));

    expect(result).toContain('Decision goal: Increase market share by 15%');
  });

  it('omits goal line when goal is empty', async () => {
    const result = await assembleSystemPrompt(makeContext({
      framing: { stage: 'frame' },
    }));

    expect(result).not.toContain('Decision goal:');
  });

  it('defaults to frame stage when framing is null', async () => {
    const result = await assembleSystemPrompt(makeContext({
      framing: null,
    }));

    expect(result).toContain('Current stage: frame');
  });

  it('is deterministic for the same input', async () => {
    const ctx = makeContext({ framing: { stage: 'decide', goal: 'Pick vendor' } });

    const result1 = await assembleSystemPrompt(ctx);
    const result2 = await assembleSystemPrompt(ctx);

    expect(result1).toBe(result2);
  });
});
