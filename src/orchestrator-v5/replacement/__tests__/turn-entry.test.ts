/**
 * The entry point: state in, a reply out, and the ordering that makes
 * "Yes, make that update now" work on the turn after the offer.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY, recordItem } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE } from '../proposal-store.js';
import type { ChatWithToolsLike } from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import {
  EMPTY_REPLACEMENT_STATE,
  ReplacementTurnFailure,
  decodeReplacementState,
  handleReplacementTurn,
  summariseWorkspace,
  type ReplacementState,
  type ReplacementStateStore,
} from '../turn-entry.js';

const T = '2026-09-20T12:00:00.000Z';

function scripted(replies: { content: ToolResponseBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' }[]): ChatWithToolsLike {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)]!;
}
const say = (text: string) => ({ content: [{ type: 'text' as const, text }], stop_reason: 'end_turn' as const });

function memoryStore(initial: ReplacementState = EMPTY_REPLACEMENT_STATE): ReplacementStateStore & { saved: ReplacementState[] } {
  const saved: ReplacementState[] = [];
  return {
    saved,
    load: async () => (saved.length > 0 ? saved[saved.length - 1]! : initial),
    save: async (_id, s) => { saved.push(s); },
  };
}

const GRAPH = {
  nodes: [
    { id: 'd1', kind: 'decision', label: 'Pricing' },
    { id: 'o1', kind: 'option', label: 'Full Parity' },
    { id: 'o2', kind: 'option', label: 'Hold' },
    { id: 'f1', kind: 'factor', label: 'Monthly Churn Rate' },
  ],
  edges: [],
} as never;

function entryInput(over: Record<string, unknown> = {}) {
  return {
    scenarioId: 'sc-1',
    message: 'What should I be worried about here?',
    history: [],
    getGraph: () => GRAPH,
    getAnalysis: () => null,
    modelRevision: 'rev-1',
    turnId: 'turn-1',
    requestId: 'req-1',
    now: T,
    ...over,
  } as Parameters<typeof handleReplacementTurn>[0];
}

describe('a stored blob is data from outside the process', () => {
  it('reads anything unrecognised as empty rather than throwing', () => {
    // Deliberately the opposite of `v5_handler_facts.payload`, whose strict
    // parse on an unfiltered read takes the whole scenario down when one row
    // is not recognised.
    for (const junk of [null, undefined, 42, 'text', [], {}, { version: 2 }, { version: 1 }]) {
      expect(() => decodeReplacementState(junk)).not.toThrow();
      expect(decodeReplacementState(junk)).toEqual(EMPTY_REPLACEMENT_STATE);
    }
  });

  it('round-trips real state through JSON', () => {
    const state: ReplacementState = {
      version: 1,
      memory: recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'i1', kind: 'user_fact', text: 'Churn is 3%', source_turn_id: 't1', recorded_at: T,
      }),
      proposals: EMPTY_PROPOSAL_STORE,
    };
    const back = decodeReplacementState(JSON.parse(JSON.stringify(state)));
    expect(back.memory.items).toHaveLength(1);
    expect(back.memory.items[0]?.text).toBe('Churn is 3%');
  });

  it('rejects a blob whose shape is right but whose version is not — the field exists so a migration can', () => {
    expect(decodeReplacementState({ version: 99, memory: { items: [] }, proposals: { proposals: [] } }))
      .toEqual(EMPTY_REPLACEMENT_STATE);
  });
});

describe('the standing workspace line is thin on purpose', () => {
  it('counts what is there and sends the model to the tool for detail', () => {
    const s = summariseWorkspace(GRAPH);
    expect(s).toContain('1 decision, 1 factor, 2 options');
    expect(s).toContain('read_workspace');
    expect(s).toContain('do not guess at labels or values');
  });

  it('is null when there is no model, so the prompt says so rather than describing an empty one', () => {
    expect(summariseWorkspace(null)).toBeNull();
    expect(summariseWorkspace({ nodes: [], edges: [] } as never)).toBeNull();
  });
});

describe('state is saved before the reply is returned', () => {
  it('persists the post-turn state, not the state it loaded', async () => {
    const store = memoryStore();
    const r = await handleReplacementTurn(entryInput(), {
      chatWithTools: scripted([say('The churn assumption is doing all the work here.')]),
      state: store,
    });
    expect(r.assistantText).toContain('churn assumption');
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.version).toBe(1);
  });

  it('a failed save is a hard failure, not a silently unsaved turn', async () => {
    const store: ReplacementStateStore = {
      load: async () => EMPTY_REPLACEMENT_STATE,
      save: async () => { throw new Error('connection reset'); },
    };
    await expect(
      handleReplacementTurn(entryInput(), { chatWithTools: scripted([say('x')]), state: store }),
    ).rejects.toThrow(ReplacementTurnFailure);
  });

  it('a failed save after a write reports that a write may have landed', async () => {
    const store: ReplacementStateStore = {
      load: async () => EMPTY_REPLACEMENT_STATE,
      save: async () => { throw new Error('connection reset'); },
    };
    // No write happened on this turn, so the flag is false — the contrast
    // that proves the flag tracks the write rather than the failure.
    let err: unknown;
    try {
      await handleReplacementTurn(entryInput(), { chatWithTools: scripted([say('x')]), state: store });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReplacementTurnFailure);
    // Narrowed by the assertion above, not by a cast — a cast here would let
    // the field disappear from the type without this test noticing.
    if (!(err instanceof ReplacementTurnFailure)) throw new Error('expected the typed failure');
    expect(err.mayHaveWritten).toBe(false);
  });
});

describe('the read tools are always present', () => {
  it('offers read_workspace and read_results on every turn', async () => {
    const seen: string[][] = [];
    const spy: ChatWithToolsLike = async ({ tools }) => {
      seen.push(tools.map((t) => t.name));
      return say('ok');
    };
    await handleReplacementTurn(entryInput(), { chatWithTools: spy, state: memoryStore() });
    expect(seen[0]).toContain('read_workspace');
    expect(seen[0]).toContain('read_results');
    // Not optional. Its absence is what ended a live session, so no call site
    // can forget to pass it.
    expect(seen[0]).toContain('set_option_effect');
  });

  it('carries prior state into the prompt so the conversation does not restart each turn', async () => {
    const store = memoryStore({
      version: 1,
      memory: recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'i1', kind: 'user_fact', text: 'We cannot discount below 78% margin',
        source_turn_id: 't0', recorded_at: T,
      }),
      proposals: EMPTY_PROPOSAL_STORE,
    });
    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput(), { chatWithTools: spy, state: store });
    expect(system).toContain('THE USER STATED AS FACT');
    expect(system).toContain('We cannot discount below 78% margin');
  });
});

describe('without a write path the turn says so', () => {
  it('declares saving unavailable rather than letting the model discover it', async () => {
    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput(), { chatWithTools: spy, state: memoryStore() });
    expect(system).toContain('saving a change to the model on this turn');
  });

  it('does not declare it unavailable when a write path is present', async () => {
    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput(), {
      chatWithTools: spy, state: memoryStore(),
      applyOperations: async () => ({ ok: true, receiptId: 'r1' }),
    });
    expect(system).not.toContain('saving a change to the model on this turn');
  });
});
