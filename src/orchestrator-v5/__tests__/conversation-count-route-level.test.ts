/**
 * The conversation's true length, pinned at the REAL seam:
 * TurnExecutor → buildTurnContext → SessionStore.countTurns → ContextPack
 * assembler → routing adapter → the prompt the model receives.
 *
 * WHY ROUTE-LEVEL AND NOT UNIT-ONLY. The projection can be perfectly correct
 * and still never run with the true total: the number has to survive
 * `buildTurnContext` and the turn-executor's assembler call. A unit test of
 * `projectConversation` would stay green with that wiring severed — a fix
 * landed in a gate nothing reaches. Sever `priorTurnsTotal:
 * context.prior_turns_total` in turn-executor.ts and this file goes red;
 * the unit suite does not.
 *
 * THE DEFECT, live on deployed build `f00b8ef` (2026-07-25). Scenario
 * `e1d9b089-…` holds 78 rows in `v5_conversation_turns`.
 * `SESSION_READ_WINDOW_TURNS` is absent from cee-staging's 114 env vars, so
 * the default 20 serves. Asked how many exchanges were on record, the coach
 * answered:
 *
 *   "Total turn count on record for this conversation is 20, and of those I
 *    can currently read 8 verbatim … the remaining 12 sit outside my visible
 *    window"
 *
 * `8 + 12 = 20`. The three numbers agreed with each other and were jointly
 * false, so no conformance check could see it. Positive control from the same
 * probe: a 10-turn scenario answered "10 turns recorded in total" — true. The
 * numbers below reproduce that live shape (78 stored, 20 read, 8 shown).
 *
 * ONLY the session store is faked, and it models the live SQL at the bytes:
 * `readRecent` returns a LIMIT-ed window, `countTurns` reports the total
 * behind that limit — the two reads that disagreed in production.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { SessionTurnWithContent } from '../session/conversation-content.js';

import { setTestSink } from '../../utils/telemetry.js';

const SCENARIO_ID = randomUUID();

/** The live threshold — `SESSION_READ_WINDOW_DEFAULT`, unset on staging. */
const READ_WINDOW = 20;
/** The live truth on the probed scenario. */
const STORED_TURNS = 78;

function windowRows(n: number): SessionTurnWithContent[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    scenario_id: SCENARIO_ID,
    user_id: null,
    turn_id: `t-${i}`,
    turn_class: 'direct_answer' as const,
    handler_id: null,
    request_hash: `sha256:t-${i}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 20,
    created_at: new Date(Date.UTC(2026, 6, 25, 12, 0, 0) - i * 60_000).toISOString(),
    user_message: `Earlier user message ${i}`,
    assistant_message: `Earlier assistant answer ${i}`,
  }));
}

/** Mutable per-test: what the store reports as the scenario's true total. */
let storedTotal: number | null = STORED_TURNS;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    // The WINDOW: `LIMIT 20` over however many rows exist, exactly as the
    // live SELECT returns it — so a short conversation yields a short window
    // and the two reads stay mutually consistent, as they are in production.
    readRecent: async () => windowRows(Math.min(READ_WINDOW, storedTotal ?? READ_WINDOW)),
    // The TOTAL, from behind that limit. `null` models a failed count read.
    countTurns: async () => {
      if (storedTotal === null) throw new Error('count read exploded');
      return storedTotal;
    },
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: 'Supplier decision brief.' }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what I would focus on.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

async function routingPrompt(): Promise<string> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(
    payload('How many exchanges have we had in this conversation in total?'),
    `req-${randomUUID()}`,
    { routingAdapter: adapter },
  );
  expect(calls.length).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

/** The `conversation` block as it is serialised into the prompt. */
function conversationBlock(prompt: string): {
  turn_count: number;
  window?: { shown: number; available: number; notice?: string };
} {
  const json = prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1);
  return (JSON.parse(json) as { conversation: never }).conversation;
}

describe('conversation length — route-level: the prompt states the CONVERSATION’s size, not the window’s', () => {
  beforeEach(() => {
    storedTotal = STORED_TURNS;
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('78 stored / 20 read / 8 shown — the ROUTING PROMPT states 78', async () => {
    const conversation = conversationBlock(await routingPrompt());
    expect(conversation.turn_count).toBe(STORED_TURNS);
    expect(conversation.window?.available).toBe(STORED_TURNS);
    // The window read is unchanged — only the CLAIM about the conversation.
    expect(conversation.window?.shown).toBe(8);
    // The exact bytes the pre-fix build sent, which the coach read back to the
    // user as the total. Neither number may be the window's own size.
    expect(conversation.turn_count).not.toBe(READ_WINDOW);
    expect(conversation.window?.available).not.toBe(READ_WINDOW);
  });

  it('and says so IN WORDS, with both numbers, in the same block', async () => {
    const notice = conversationBlock(await routingPrompt()).window?.notice ?? '';
    expect(notice).toContain('78 turns are on record');
    expect(notice).toContain('the 8 most recent are shown above');
    expect(notice).toContain('70 earlier ones are not shown');
    expect(notice).toContain('the true total is 78');
  });

  it('NEGATIVE CONTROL — a conversation that fits gets no disclosure at all', async () => {
    // Proof the assertions above can see an ABSENCE too: with the total equal
    // to what is shown there is nothing to disclose, and the key must vanish
    // rather than emit an empty or zero-valued marker.
    storedTotal = 8;
    const conversation = conversationBlock(await routingPrompt());
    expect(conversation.window?.notice).toBeUndefined();
  });

  it('DEGRADED — a failed count read declines to state a total rather than inventing one', async () => {
    storedTotal = null;
    const conversation = conversationBlock(await routingPrompt());
    const notice = conversation.window?.notice ?? '';
    expect(notice).toContain('could not be read this turn');
    expect(notice).toContain('do not state a total number of turns or exchanges');
    // The load-bearing assertion: the window's size must not be passed off as
    // the answer anywhere in the disclosure.
    expect(notice).not.toContain(String(READ_WINDOW));
  });
});
