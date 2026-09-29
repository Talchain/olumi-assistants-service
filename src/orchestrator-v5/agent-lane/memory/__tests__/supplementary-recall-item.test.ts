/**
 * EXPERIMENT (exp/mem0-context-spike-20260929): how recalled words reach the Agent, and what is sent to Mem0.
 */
import { describe, expect, it, vi } from 'vitest';
import { runAgentTurn } from '../../runtime/agent-loop.js';
import {
  RECALL_BUDGET, RECALL_LABEL, byDeadline, memoryTextOf, recallMemories, rememberTurn, renderRecallItem, scenarioAllowed, toRecalledMemory,
  type Mem0Like,
} from '../supplementary-memory.js';
import type { SupplementaryConversationMemory } from '../memory-guard.js';

const ctx = { scenario_id: 'scn-a', authenticated_user_id: 'u', request_id: 'req-1' };
const base = { ctx, history: [{ role: 'user', content: [{ type: 'input_text', text: 'earlier' }] }], message: 'hello', instructions: 'x', maxOutputTokens: 64 };

function captureModel() {
  const seen: { input?: readonly unknown[] }[] = [];
  const callModel = vi.fn(async (req: { input?: readonly unknown[] }) => {
    seen.push(JSON.parse(JSON.stringify(req)));
    return { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] } as never;
  });
  return { seen, callModel: callModel as never };
}

const kept = (n: number, words = 'It is a moderate effect.'): SupplementaryConversationMemory[] => Array.from({ length: n }, (_, i) => ({
  memory_id: `m${i}`, user_words: words, answered_question: 'How strongly does price affect churn?', said_at: `2026-09-29T1${i}:00:00Z`,
  scenario_id: 'scn-a', user_id: 'u', source: 'mem0', scope: 'scenario', authoritative: false,
}));

describe('recall item in the Agent loop', () => {
  it('CONTRAST CONTROL — no recall → the request is byte-identical to a turn without the experiment', async () => {
    const a = captureModel();
    const b = captureModel();
    await runAgentTurn({ ...base }, {} as never, a.callModel);
    await runAgentTurn({ ...base, supplementaryRecall: undefined }, {} as never, b.callModel);
    expect(JSON.stringify(b.seen)).toBe(JSON.stringify(a.seen));
  });

  it('recall goes in as ONE user item before the live message, and is never handed on into history', async () => {
    const { seen, callModel } = captureModel();
    const text = renderRecallItem('scn-a', kept(1), [])!;
    const result = await runAgentTurn({ ...base, supplementaryRecall: text }, {} as never, callModel);
    const input = seen[0]!.input as { role?: string; content?: { text?: string }[] }[];
    const at = input.findIndex((i) => i.content?.[0]?.text === text);
    expect(at).toBe(1);
    expect(input[at]!.role).toBe('user');
    expect(input[input.length - 1]!.content?.[0]?.text).toBe('hello');
    expect(JSON.stringify(result.items)).not.toContain('supplementary_historical_recall');
  });
});

describe('renderRecallItem', () => {
  it('is a typed, non-authoritative envelope under the label', () => {
    const text = renderRecallItem('scn-a', kept(1), [])!;
    expect(text.startsWith(RECALL_LABEL)).toBe(true);
    const env = JSON.parse(text.slice(RECALL_LABEL.length + 1));
    expect(env).toMatchObject({ kind: 'supplementary_historical_recall', authoritative: false, scope: 'scenario', scenario_id: 'scn-a' });
    expect(env.items[0]).toMatchObject({ olumi_asked: 'How strongly does price affect churn?', user_said: 'It is a moderate effect.' });
  });

  it('is bounded: item count, item length and total size', () => {
    const text = renderRecallItem('scn-a', kept(9, 'x'.repeat(900)), [])!;
    const env = JSON.parse(text.slice(RECALL_LABEL.length + 1));
    expect(env.items.length).toBeLessThanOrEqual(RECALL_BUDGET.maxItems);
    expect(text.length - RECALL_LABEL.length - 1).toBeLessThanOrEqual(RECALL_BUDGET.maxTotalChars);
  });

  it('the MOST RELEVANT survive the budget, and are shown newest first', () => {
    const ms = kept(6).map((m, i) => ({ ...m, relevance: [0.1, 0.9, 0.2, 0.8, 0.3, 0.7][i]! }));
    const env = JSON.parse(renderRecallItem('scn-a', ms, [], { ...RECALL_BUDGET, maxItems: 3 })!.slice(RECALL_LABEL.length + 1));
    expect(env.items.map((x: { memory_id: string }) => x.memory_id)).toEqual(['m5', 'm3', 'm1']);
  });

  it('renders nothing when nothing survived the guard', () => {
    expect(renderRecallItem('scn-a', [], [])).toBeUndefined();
  });
});

describe('Mem0 adapter', () => {
  it('remember sends ONE user message — the user’s words and the question — verbatim, scoped, with metadata', async () => {
    const add = vi.fn(async () => ({}));
    const client = { add, search: vi.fn() } as unknown as Mem0Like;
    const r = await rememberTurn({ client, userId: 'u', scenarioId: 'scn-a', turnId: 't7', userWords: 'It is moderate', answeredQuestion: 'How strong is it?', graphRevision: 'rev', saidAt: '2026-09-29T10:00:00Z' });
    expect(r.ok).toBe(true);
    const [messages, opts] = add.mock.calls[0] as unknown as [unknown[], Record<string, unknown>];
    expect(messages).toEqual([{ role: 'user', content: memoryTextOf('It is moderate', 'How strong is it?') }]);
    expect(opts).toMatchObject({ userId: 'u', runId: 'scn-a', infer: false, metadata: { scenario_id: 'scn-a', turn_id: 't7', graph_revision_at_time: 'rev', source: 'conversation', role: 'user' } });
  });

  it('recall filters on user AND scenario, and never throws', async () => {
    const search = vi.fn(async () => { throw new Error('503'); });
    const out = await recallMemories({ client: { add: vi.fn(), search } as unknown as Mem0Like, userId: 'u', scenarioId: 'scn-a', query: 'q' });
    expect(out.memories).toEqual([]);
    expect(out.error).toContain('503');
    expect((search.mock.calls[0] as unknown as [string, { filters: unknown }])[1].filters).toEqual({ AND: [{ user_id: 'u' }, { run_id: 'scn-a' }] });
  });

  it('a hit keeps its OWN scope fields, so the guard can refuse a leaked one', () => {
    const m = toRecalledMemory({ id: 'h', memory: memoryTextOf('It is moderate', 'Q?'), userId: 'u', runId: 'scn-b', score: 0.8, metadata: { user_words: 'It is moderate', answered_question: 'Q?', said_at: 'x' } });
    expect(m).toMatchObject({ scenario_id: 'scn-b', user_id: 'u', verbatim: true, user_words: 'It is moderate' });
  });

  it('byDeadline gives up at the deadline and leaves the late promise alone', async () => {
    const late = new Promise((r) => setTimeout(() => r('late'), 200));
    expect(await byDeadline(late, Date.now() + 20)).toBeUndefined();
    expect(await byDeadline(Promise.resolve('on time'), Date.now() + 50)).toBe('on time');
  });

  it('scenario allowlist: empty or absent means nothing is sent or read', () => {
    expect(scenarioAllowed(undefined, 's')).toBe(false);
    expect(scenarioAllowed('', 's')).toBe(false);
    expect(scenarioAllowed('a, s ,b', 's')).toBe(true);
  });
});
