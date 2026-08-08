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

// Lane 22: the declined-preservation fallback is now the richer clarify
// copy (composeEditClarifyResponse parts, with 1–3 factor/option-label
// chips), not the chip-less NO_OP_FALLBACK_TEXT.
const FALLBACK_SENTINEL = 'The model is unchanged so far.';

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

  // Lane 22 — R10 relaxation + richer fallback (live 2026-07-07 failure:
  // coaching_dropped:true, clarification_preserved:false, ZERO chips).

  it('preserves a clarifying question that says "graph" by transforming it to "model"', async () => {
    const q = 'Should I update the graph to include the velocity target as a constraint?';
    const result = await runNoOp(q);
    expect(result.noOpClarificationPreserved).toBe(true);
    expect(result.assistantText).toBe(
      'Should I update the model to include the velocity target as a constraint?',
    );
  });

  it('preserves a claim-safe question that mentions a "path" to the goal', async () => {
    const q = 'That option has no path to the goal yet. Should I connect it first?';
    const result = await runNoOp(q);
    expect(result.noOpClarificationPreserved).toBe(true);
    expect(result.assistantText).toBe(q);
  });

  it('declined preservation ships the clarify fallback WITH label chips (never zero-chip canned copy)', async () => {
    const result = await runNoOp('Which node did you mean — the cost one or the time one?');
    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
    expect(result.suggestedActions).toBeDefined();
    expect(result.suggestedActions!.length).toBeGreaterThan(0);
    // Chips are drawn from graph labels (factor "Price") via the shared
    // clarify chip builder; the click prompt is the safe question form.
    const labels = result.suggestedActions!.map((a) => a.label);
    expect(labels).toContain('Change Price');
    // The value-less edit-verb prompt trap must not come back: no chip
    // prompt may start with a bare edit verb.
    for (const a of result.suggestedActions!) {
      expect(a.prompt).not.toMatch(/^\s*(?:change|update|edit|modify|set|adjust)\b/i);
    }
  });

  it('no-coaching no-op also ships the clarify fallback with chips', async () => {
    const result = await runNoOp(undefined);
    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
    expect(result.suggestedActions).toBeDefined();
    expect(result.suggestedActions!.length).toBeGreaterThan(0);
  });
});

/**
 * ⭐ ROADMAP 2.427 — the LLM-suggestion loop, closed at the preservation trip
 * test.
 *
 * This branch is the ONE surface where the edit LLM's own prose reaches
 * `assistantText` verbatim, which makes it the one surface where the product
 * can advise a phrasing it would then refuse — the closed loop the 2.11
 * diagnosis named ("the assistant suggests phrasings that cannot return to the
 * lane that suggested them"). The three pre-existing trip conditions all ask
 * what the text CLAIMS; none asked what it ADVISES.
 *
 * These cases drive the REAL handler, so they bind the production wiring
 * (`findNonRoutableConfigureAdvice` in the trip test), not just the predicate.
 */
describe('handleEditGraph no-op — ROADMAP 2.427 advice routability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DECLINES preservation when the question advises an option phrasing that would not route', async () => {
    // Verbatim the phrasing PR #487's round-3 review caught the misroute
    // clarify shipping: it names an option and the configure gate rejects it.
    const q =
      "I need a value first. Say 'the acquisition option sets Setup Cost to £2m' and I'll apply it.";
    const result = await runNoOp(q);

    expect(result.noOpClarificationPreserved).toBe(false);
    expect(result.assistantText).not.toContain('the acquisition option sets Setup Cost');
    expect(result.assistantText).toContain(FALLBACK_SENTINEL);
  });

  it('PRESERVES a question advising the phrasing the product actually sanctions', () => {
    // The discriminating twin. Same shape of sentence, same option reference,
    // same quoting grammar — only the advised phrasing differs, and this one
    // routes. Without this half, the test above would be satisfied by a guard
    // that simply declined every quoted option reference.
    const advised = "Set the Cloud-Native CRM option's effect on Adoption Complexity to 0.7";
    const q = `I need a value first. Say '${advised}' and I'll apply it.`;
    return runNoOp(q).then((result) => {
      expect(result.noOpClarificationPreserved).toBe(true);
      expect(result.assistantText).toContain(advised);
    });
  });

  it('leaves advice that names no option alone (scope guard)', async () => {
    // Factor-only advice is deliberately out of scope — see
    // `configure-option-advice.ts`. A guard that reached here would discard
    // working clarifying questions.
    const q = 'What number should this be? Say "Set Price to 0.8" when you know it.';
    const result = await runNoOp(q);
    expect(result.noOpClarificationPreserved).toBe(true);
  });
});
