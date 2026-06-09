/**
 * R10 — V4 handleEditGraph no-op clarification preservation.
 *
 * When the LLM returns zero operations with a clarifying question in
 * coaching.summary, the no-op branch now scrubs + guards it and renders it as
 * assistantText (instead of always substituting NO_OP_FALLBACK_TEXT). A
 * conservative trip test falls back to the deterministic copy on any
 * success/mutation claim, denial/jargon phrase, internal vocabulary, or raw
 * id/path. These tests drive the real handler with a mocked no-op adapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return false;
              if (ceeProp === 'patchBudgetEnabled') return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';

// Apostrophe-free substring of NO_OP_FALLBACK_TEXT (the real copy uses a curly
// apostrophe in "couldn't"), so the assertion is robust to apostrophe style.
const FALLBACK_SENTINEL = 'see a concrete change to make';

function makeContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Revenue' },
        { id: 'factor_1', kind: 'factor', label: 'Price' },
      ],
      edges: [
        {
          from: 'factor_1',
          to: 'goal_1',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1,
          effect_direction: 'positive',
        },
      ],
    },
    messages: [{ role: 'user', content: 'make it better' }],
    scenario_id: '11111111-2222-3333-4444-555555555555',
    framing: { stage: 'evaluate' },
    analysis_response: null,
  };
}

function makeNoOpAdapter(coaching?: string, warnings: string[] = []): LLMAdapter {
  return {
    name: 'mock',
    model: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        operations: [],
        removed_edges: [],
        warnings,
        ...(coaching ? { coaching: { summary: coaching } } : {}),
      }),
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    chatWithTools: vi.fn(),
  } as unknown as LLMAdapter;
}

async function runNoOp(coaching?: string, warnings: string[] = []) {
  return handleEditGraph(makeContext(), 'make it better', makeNoOpAdapter(coaching, warnings), 'req', 'turn');
}

describe('handleEditGraph no-op — R10 clarification preservation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves a clean clarifying question verbatim (modulo scrub)', async () => {
    const q = 'Which factor did you mean — the one driving cost, or the one driving time?';
    const result = await runNoOp(q);
    expect(result.wasRejected).toBe(false);
    expect(result.noOpClarificationPreserved).toBe(true);
    expect(result.assistantText).toBe(q);
  });

  it('preserves the brief false-positive example question', async () => {
    const q = 'Which price-related factor should this option affect?';
    const result = await runNoOp(q);
    expect(result.noOpClarificationPreserved).toBe(true);
    expect(result.assistantText).toBe(q);
  });

  it('falls back when the summary makes a success/mutation claim', async () => {
    const result = await runNoOp('Done — updated Price.');
    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
  });

  it('falls back when there is no coaching summary', async () => {
    const result = await runNoOp(undefined);
    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
  });

  it('falls back on denial / jargon phrasing', async () => {
    const result = await runNoOp("I haven't applied any changes; the validator rejected it.");
    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
  });

  it('falls back on internal structural vocabulary (node)', async () => {
    const result = await runNoOp('Which node did you mean — the cost one or the time one?');
    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
  });
});
