/**
 * THE RECONCILIATION MUST RUN ON THE PATH THE REAL ROUTE TAKES.
 *
 * ⛔ MEASURED ON DEPLOYED STAGING `34ee62f`, immediately after #1685 landed.
 *    The acceptance sequence (T1=14, a different turn moves it to 17, retry T1)
 *    produced:
 *
 *      "That change had already been recorded, so nothing new was written just
 *       now. I couldn't read the current value just now — open the model to
 *       check it."
 *      graph_patch: status=noop target_id=bc936d4c after=null
 *
 *    while the node carried `display_value: "17 months"` and the block carried
 *    `target_id`. **Nothing was unreadable. The reread never ran.**
 *
 *    Cause: `commit.ts` resolves `const store = sessionStore ?? getSessionStore()`
 *    so callers need not pass one — and the real route does not. But the
 *    reconciliation guard tested `sessionStore`, the OPTIONAL PARAMETER. With
 *    the default in play it was `undefined`, so the branch short-circuited.
 *
 * ⭐ EVERY existing test passed a store EXPLICITLY, so none of them could fail.
 *    This one calls `commitDirectAnswer` WITHOUT the argument — the shape the
 *    deployed route actually uses — and mocks `getSessionStore` instead.
 */
import { describe, it, expect, vi } from 'vitest';

const GRAPH_AT_17 = {
  nodes: [
    {
      id: 'bc936d4c',
      kind: 'factor',
      label: 'Sales Cycle Length',
      display_value: '17 months',
      observed_state: { unit: 'months', value: 0.85, raw_value: 17 },
    },
  ],
  edges: [],
};

const loadGraph = vi.fn(async () => GRAPH_AT_17);

vi.mock('../session/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session/index.js')>();
  return {
    ...actual,
    // The DEFAULT the real route relies on.
    getSessionStore: () => ({
      ...actual.createNoopSessionStore?.(),
      append: async () => ({ id: 'turn-row', replayedPriorTurn: true as const }),
      loadGraph,
    }),
  };
});

const { commitDirectAnswer } = await import('../commit.js');
const { composeDirectAnswerResponse } = await import('../compose.js');

const meta = () => ({
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 0,
  duration_ms: 1,
  handler_facts: [],
});

function composed() {
  const base = composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: 'Updated Sales Cycle Length from 17 months to 14 months.',
    stage: 'analyse',
  });
  return {
    ...base,
    blocks: [
      {
        type: 'graph_patch',
        status: 'applied',
        operation: 'set_factor_value',
        target_id: 'bc936d4c',
        before: { value: 17, unit: 'months' },
        after: { value: 14, unit: 'months' },
      },
    ],
  } as typeof base;
}

const blocksOf = (r: unknown) => ((r as { blocks?: unknown }).blocks ?? []) as Array<Record<string, unknown>>;

describe('the reconciliation runs on the DEFAULT store path', () => {
  it('RED: it rereads even when no sessionStore argument is passed', async () => {
    loadGraph.mockClear();
    // NOTE the two arguments. The deployed route does not pass a third.
    await commitDirectAnswer(composed(), meta() as never);
    expect(
      loadGraph,
      'the guard tested the optional parameter, so the reread never ran under the default',
    ).toHaveBeenCalledTimes(1);
  });

  it('RED: the prose names AUTHORITATIVE current state, not "I could not read it"', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never);
    expect(r.response.assistant_text).toMatch(/\b17\b/);
    expect(
      r.response.assistant_text,
      'this is the exact sentence deployed staging produced while the value was readable',
    ).not.toMatch(/couldn't read the current value/i);
  });

  it('RED: the patch carries current state rather than the null signal', async () => {
    const r = await commitDirectAnswer(composed(), meta() as never);
    const patch = blocksOf(r.response).find((b) => b.type === 'graph_patch');
    expect(patch?.status).toBe('noop');
    expect(patch?.after, 'null is the current-state-UNAVAILABLE signal; state was available').not.toBeNull();
    expect(patch?.after).toMatchObject({ raw_value: 17 });
  });
});
