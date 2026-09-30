/**
 * ⛔ A GRAPH WRITE WITH NO BASE STILL NEVER REISSUES A REF (DL CR B1 on #2357, reproduced by execution).
 *
 * `assignEntityRefs(graph, undefined)` assigns nothing (rule 6), and the draft/redraft commit and the executor's graph
 * commits passed no base: {O1, O2, high-water O:2} → redraft → stored with no refs and no high-water → the next added
 * option was O1 AGAIN; and an LLM-drafted model never got refs. The fix sits in the one place every graph write passes
 * (`commitDirectAnswer`, `refBaseFor`): the caller's base, else the executor's server read, else ONE read of the stored
 * graph. These rows drive `commitDirectAnswer` itself and assert the bytes handed to the store.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const { maintainSpy, llmChatMock } = vi.hoisted(() => ({
  maintainSpy: vi.fn(async (_arg: Record<string, unknown>) => undefined),
  llmChatMock: vi.fn(),
}));

vi.mock('../rolling-summary/capture.js', () => ({
  maintainRollingSummaryForCommit: maintainSpy,
}));

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

const SCENARIO_ID = 'abababab-abab-4bab-8bab-abababababab';
const TURN_ID = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
type Rec = Record<string, any>;

const option = (id: string, extra: Rec = {}) => ({ id, kind: 'option', label: id, ...extra });
const graph = (nodes: Rec[], extra: Rec = {}): Rec => ({
  goal_node_id: 'goal',
  nodes: [{ id: 'goal', kind: 'goal', label: 'Revenue' }, ...nodes],
  edges: [],
  ...extra,
});
/** The stored graph before a redraft: two options that hold O1 and O2, and the counter at 2. */
const STORED = graph([option('opt_a', { ref: 'O1' }), option('opt_b', { ref: 'O2' })], { ref_high_water: { G: 1, O: 2 } });
(STORED.nodes as Rec[])[0]!.ref = 'G1';
/** A redraft: a new model, new ids, no refs (the drafter knows nothing of them). */
const REDRAFT = graph([option('opt_x'), option('opt_y')]);

const meta = (g: unknown, extra: Rec = {}) => ({
  scenario_id: SCENARIO_ID, turn_id: TURN_ID, turn_class: 'direct_answer' as const, handler_id: null,
  request_hash: 'sha256:test', llm_calls_used: 0, duration_ms: 1, handler_facts: [], graph: g, ...extra,
});

function storeHolding(stored: unknown, opts: { readFails?: boolean } = {}) {
  const writes: SessionTurnWrite[] = [];
  const loadGraph = vi.fn(async () => {
    if (opts.readFails) throw new Error('simulated read failure');
    return stored === null ? null : (JSON.parse(JSON.stringify(stored)) as unknown);
  });
  const store = {
    ...createNoopSessionStore(),
    append: async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => { writes.push(write); return { id: 'turn-row' }; },
    loadGraph,
  } as SessionStore;
  return { store, writes, loadGraph };
}
const refs = (g: unknown) => Object.fromEntries(((g as Rec).nodes as Rec[]).map((n) => [n.id, n.ref]));
const written = (writes: SessionTurnWrite[]) => (writes[0] as unknown as Rec).graph as Rec;
const response = () => composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'Drafted.', stage: 'frame' });

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => { fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('no fetch'); }); });
afterAll(() => { fetchSpy.mockRestore(); });
beforeEach(() => { llmChatMock.mockClear(); maintainSpy.mockClear(); });

describe('a graph write with no base still never reissues a ref (DL CR B1 on #2357)', () => {
  it('RED: redraft over {O1, O2, high-water O:2} with no base → the new options are O3 and O4, never O1/O2 again', async () => {
    const s = storeHolding(STORED);
    await commitDirectAnswer(response(), meta(REDRAFT), s.store);
    const out = written(s.writes);
    expect(refs(out)).toEqual({ goal: 'G1', opt_x: 'O3', opt_y: 'O4' });
    expect(out.ref_high_water).toEqual({ G: 1, O: 4 });
  });

  it('RED: a first draft (nothing stored) gets complete refs — G1, O1, O2 — and the counter', async () => {
    const s = storeHolding(null);
    await commitDirectAnswer(response(), meta(REDRAFT), s.store);
    const out = written(s.writes);
    expect(refs(out)).toEqual({ goal: 'G1', opt_x: 'O1', opt_y: 'O2' });
    expect(out.ref_high_water).toEqual({ G: 1, O: 2 });
  });

  it('CONTROL: a caller-supplied base (the executor\'s server read) is used as given, with no extra read', async () => {
    const s = storeHolding(null);                                   // the store would say "nothing" — the base wins
    await commitDirectAnswer(response(), meta(REDRAFT, { refBaseGraph: STORED }), s.store);
    expect(refs(written(s.writes))).toEqual({ goal: 'G1', opt_x: 'O3', opt_y: 'O4' });
    expect(s.loadGraph).not.toHaveBeenCalled();
  });

  it('CONTROL: `refBaseGraph: null` (a known first write) allocates from 1 with no read', async () => {
    const s = storeHolding(STORED);
    await commitDirectAnswer(response(), meta(REDRAFT, { refBaseGraph: null }), s.store);
    expect(refs(written(s.writes))).toEqual({ goal: 'G1', opt_x: 'O1', opt_y: 'O2' });
    expect(s.loadGraph).not.toHaveBeenCalled();
  });

  it('CONTROL: when the stored graph cannot be read, nothing is assigned (rule 6) and the write still lands', async () => {
    const s = storeHolding(STORED, { readFails: true });
    await commitDirectAnswer(response(), meta(REDRAFT), s.store);
    expect(Object.values(refs(written(s.writes))).every((r) => r === undefined)).toBe(true);
  });

  it('CONTROL: a turn that writes no graph reads nothing for refs', async () => {
    const s = storeHolding(STORED);
    const { graph: _g, ...noGraph } = meta(REDRAFT);
    await commitDirectAnswer(response(), noGraph as never, s.store);
    expect(s.loadGraph).not.toHaveBeenCalled();
  });
});
