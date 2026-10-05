/**
 * ⛔ A TURN COMMIT NEVER CARRIES THE COMPILER'S RECEIPT FORWARD (DL ruling, 5 Oct 2026, condition 1).
 *
 * `graph.stated_dispositions` is written ONLY by the register route, reconciled against the bytes it stores. Every
 * other writer must neither produce it nor carry it forward unchanged: an edit that removes a carrier would otherwise
 * leave a receipt advertising a write the stored graph no longer holds. `commitDirectAnswer` is the one place every
 * turn lane and system event persists through (`persist-graph-write.ts` header), so it drops the key there — before
 * anything hashes, versions or checks the bytes. Now that `GraphV3` declares the key, every lane that re-parses the
 * stored graph hands it to this function; the base commit's GraphV3 stripped it before it got here.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const { maintainSpy, llmChatMock } = vi.hoisted(() => ({
  maintainSpy: vi.fn(async (_arg: Record<string, unknown>) => undefined),
  llmChatMock: vi.fn(),
}));
vi.mock('../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: maintainSpy }));
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { SessionAppendOutcome, SessionStore, SessionTurnWrite } from '../session/store.js';

const SCENARIO_ID = 'efefefef-efef-4fef-8fef-efefefefefef';
const TURN_ID = '12121212-1212-4212-8212-121212121212';
type Rec = Record<string, unknown>;

const GRAPH: Rec = {
  goal_node_id: 'goal',
  nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue' }, { id: 'opt_a', kind: 'option', label: 'A' }],
  edges: [],
};
const RECEIPT = [{ stated_index: 0, stated_item: { kind: 'option', source_quote: 'Option A' },
  disposition: 'carried', location: { kind: 'node', node_id: 'opt_gone', path: [] }, stored_value: { id: 'opt_gone' } }];

const meta = (g: unknown) => ({
  scenario_id: SCENARIO_ID, turn_id: TURN_ID, turn_class: 'direct_answer' as const, handler_id: null,
  request_hash: 'sha256:test', llm_calls_used: 0, duration_ms: 1, handler_facts: [], graph: g, refBaseGraph: null,
});
function capturingStore() {
  const writes: SessionTurnWrite[] = [];
  const store = {
    ...createNoopSessionStore(),
    append: async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => { writes.push(write); return { id: 'turn-row' }; },
  } as SessionStore;
  return { store, writes };
}
const response = () => composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Edited.', stage: 'frame' });

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('no fetch'); }); });
afterAll(() => { fetchSpy.mockRestore(); });

describe('commitDirectAnswer drops graph.stated_dispositions', () => {
  it('⭐ RED: a turn write of a graph carrying the receipt persists the graph WITHOUT it', async () => {
    const s = capturingStore();
    await commitDirectAnswer(response(), meta({ ...structuredClone(GRAPH), stated_dispositions: structuredClone(RECEIPT) }), s.store);
    expect(s.writes).toHaveLength(1);
    const written = (s.writes[0] as unknown as Rec).graph as Rec;
    expect(written).not.toHaveProperty('stated_dispositions');
    // contrast: the rest of the graph is what the caller committed
    expect((written.nodes as Rec[]).map((n) => n.id)).toEqual(['goal', 'opt_a']);
  });

  it('CONTROL: a graph without the key is persisted exactly as the projection leaves it', async () => {
    const a = capturingStore();
    const b = capturingStore();
    await commitDirectAnswer(response(), meta(structuredClone(GRAPH)), a.store);
    await commitDirectAnswer(response(), meta({ ...structuredClone(GRAPH), stated_dispositions: structuredClone(RECEIPT) }), b.store);
    // Dropping the key leaves byte-identical bytes to a commit that never had it.
    expect(JSON.stringify((b.writes[0] as unknown as Rec).graph)).toBe(JSON.stringify((a.writes[0] as unknown as Rec).graph));
  });
});
