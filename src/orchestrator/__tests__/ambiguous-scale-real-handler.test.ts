/**
 * THE REAL HANDLER MUST PUT THE CLARIFICATION IN `assistantText`.
 *
 * The sibling spec proves the copy CHANNEL works. This one proves the SITE uses
 * it: it drives the real `handleEditGraph` through the `preComposedOperations`
 * seam — which skips the edit_graph LLM call entirely — with an operation that
 * trips the real `ambiguous_scale_value` predicate, and asserts on what the user
 * would actually be told.
 *
 * Without this, removing `structural_guidance` from the rejection context leaves
 * the sibling spec fully green: it builds its own context, so it cannot observe
 * the site. That mutant was run and DID survive, which is why this file exists.
 */

import { describe, expect, it } from 'vitest';

import { handleEditGraph } from '../tools/edit-graph.js';
import type { ConversationContext } from '../types.js';
import type { LLMAdapter } from '../../adapters/llm/types.js';

/** Calling this fails the test: the pre-composed seam must not reach an LLM. */
const throwingAdapter = {
  chat: async () => {
    throw new Error('LLM must not be called on the preComposedOperations path');
  },
} as unknown as LLMAdapter;

function contextWithAmountFactor(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_a', kind: 'decision', label: 'Decide' },
        {
          id: 'fac_cost',
          kind: 'factor',
          label: 'Delivery cost',
          observed_state: { value: 200000, source: 'user_stated' },
        },
        { id: 'goal_m', kind: 'goal', label: 'Margin' },
      ],
      edges: [
        {
          from: 'fac_cost',
          to: 'goal_m',
          strength: { mean: -0.35, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative',
        },
      ],
    },
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'scn-ambiguous-scale-real',
  } as unknown as ConversationContext;
}

describe('handleEditGraph — ambiguous_scale_value tells the user what is actually wrong', () => {
  it('surfaces the clarification, never the generic structural line', async () => {
    const result = await handleEditGraph(
      contextWithAmountFactor(),
      'set delivery cost to 0.4',
      throwingAdapter,
      'req-ambiguous-1',
      'turn-ambiguous-1',
      {
        plotClient: null,
        preComposedOperations: [
          { op: 'update_node', path: 'fac_cost', value: { observed_state: { value: 0.4 } } },
        ],
      } as unknown as Parameters<typeof handleEditGraph>[5],
    );

    expect(result.wasRejected).toBe(true);
    expect(result.assistantText).toBeTruthy();

    // THE POINT: the user learns what is actually ambiguous and what to say next.
    expect(result.assistantText!).toContain('reads as a proportion');
    expect(result.assistantText!).toContain('Delivery cost');
    expect(result.assistantText!).toContain('Tell me the amount you want');

    // And is NOT told something false about model structure.
    expect(result.assistantText!).not.toContain('inconsistency in the model structure');

    // Raw codes stay internal.
    expect(result.assistantText!).not.toContain('ambiguous_scale_value');
  });

  it('offers the route out as a chip', async () => {
    const result = await handleEditGraph(
      contextWithAmountFactor(),
      'set delivery cost to 0.4',
      throwingAdapter,
      'req-ambiguous-2',
      'turn-ambiguous-2',
      {
        plotClient: null,
        preComposedOperations: [
          { op: 'update_node', path: 'fac_cost', value: { observed_state: { value: 0.4 } } },
        ],
      } as unknown as Parameters<typeof handleEditGraph>[5],
    );

    expect(result.suggestedActions?.some((a) => a.label === 'State the amount')).toBe(true);
  });
});
