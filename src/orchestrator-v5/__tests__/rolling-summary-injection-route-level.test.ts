/**
 * Context Architecture v2 — S4-INJECT route-level pins (ROADMAP 1.73;
 * design pack 01 §2/§4, 05 §S4 inject row) at the REAL seam —
 * TurnExecutor → assembler → routing adapter. UNCONDITIONAL since the O-2
 * activation (CEE_ROLLING_SUMMARY DELETED; the activation condition is now
 * the loader's beyond-window gate):
 *
 *  - beyond-window history + stored summary → the routing user message
 *    carries the `conversation_summary` block + the precedence instruction
 *    + the extended window marker (`"summarised"`), and `v5.context_budget`
 *    carries populated `summary_lag_turns` + a
 *    `section_chars.conversation_summary` entry.
 *  - history that fits the window → NO block, NO instruction (below-window
 *    byte-identity at the prompt seam), `summary_lag_turns` stays null.
 *  - beyond window + summary-store failure → turn proceeds, no block,
 *    no error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';

import { setTestSink } from '../../utils/telemetry.js';
import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../context/context-pack-assembler.js';
import type { RollingSummary } from '../rolling-summary/summary-types.js';

const SCENARIO_ID = randomUUID();

interface MockTurn {
  turn_id: string;
  turn_class: string;
  handler_id: null;
  created_at: string;
  user_message: string;
  assistant_message: string;
}

/** turns 1..n (oldest..newest), returned NEWEST-FIRST as readRecent does. */
function turnsNewestFirst(n: number): MockTurn[] {
  const out: MockTurn[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      turn_id: `tttttttt-0000-4000-8000-${String(i).padStart(12, '0')}`,
      turn_class: 'coach',
      handler_id: null,
      created_at: new Date(Date.UTC(2026, 6, 10, 10, i, 0)).toISOString(),
      user_message: `Question ${i}`,
      assistant_message: `Answer ${i}`,
    });
  }
  return out.reverse();
}

// cap+1 turns → exactly ONE falls off the verbatim window (derive-don't-mirror).
const BEYOND_WINDOW_TURNS = turnsNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP + 1);
const NEWEST_TURN = BEYOND_WINDOW_TURNS[0]!;
const OLDEST_TURN = BEYOND_WINDOW_TURNS[BEYOND_WINDOW_TURNS.length - 1]!;

const STORED_SUMMARY: RollingSummary = {
  text: [
    'DECISION FRAME: Choosing a supplier.',
    'CONSTRAINTS & PREFERENCES: Keep Maria on the team.',
    'RESOLVED: (none)',
    'OPEN: Which region first?',
  ].join('\n'),
  slots: [
    { slot: 'FRAME', entries: [{ text: 'Choosing a supplier.', source_turn_ids: [] }] },
    {
      slot: 'CONSTRAINTS',
      entries: [{ text: 'Keep Maria on the team.', source_turn_ids: [OLDEST_TURN.turn_id] }],
    },
    { slot: 'RESOLVED', entries: [] },
    { slot: 'OPEN', entries: [{ text: 'Which region first?', source_turn_ids: [] }] },
  ],
  updated_turn_id: NEWEST_TURN.turn_id,
  updated_turn_created_at: NEWEST_TURN.created_at,
  version: 2,
  generator: 'incremental',
  schema_version: 1,
};

// Mutable per-test behaviour (the mocks below close over these).
let loadSummaryImpl: () => Promise<RollingSummary | null> = async () => STORED_SUMMARY;
let readRecentTurns: MockTurn[] = BEYOND_WINDOW_TURNS;

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: () => loadSummaryImpl(),
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  // The commit-seam maintainer (now unconditional) must never hit a real model.
  getRollingSummaryModel: () => ({
    summarise: async () => ({ text: 'DECISION FRAME: noop.' }),
  }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => readRecentTurns,
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

/** The serialised routing user message from the FIRST adapter call. */
function routingUserMessage(calls: ChatWithToolsArgs[]): string {
  expect(calls.length).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

interface SunkEvent {
  event: string;
  payload: Record<string, unknown>;
}

let events: SunkEvent[];

function contextBudgetEvents(): Array<Record<string, unknown>> {
  return events.filter((e) => e.event === 'v5.context_budget').map((e) => e.payload);
}

async function runTurn(): Promise<{ calls: ChatWithToolsArgs[] }> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload('What should I focus on?'), `req-${randomUUID()}`, {
    routingAdapter: adapter,
  });
  return { calls };
}

describe('S4-inject — route-level (unconditional, beyond-window activation)', () => {
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => {
      events.push({ event, payload: payload as Record<string, unknown> });
    });
    loadSummaryImpl = async () => STORED_SUMMARY;
    readRecentTurns = BEYOND_WINDOW_TURNS;
  });

  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('beyond-window history + stored summary → block + instruction + summarised marker; lag + section entry on v5.context_budget', async () => {
    const { calls } = await runTurn();
    const prompt = routingUserMessage(calls);
    expect(prompt).toContain('"conversation_summary":');
    expect(prompt).toContain('Keep Maria on the team.');
    expect(prompt).toContain('the structured state is correct');
    // #536 marker extension: cap+1 available, cap shown, 1 absorbed by the block.
    expect(prompt).toContain('"summarised": 1');

    const budgets = contextBudgetEvents();
    expect(budgets.length).toBeGreaterThan(0);
    const routing = budgets.find((b) => b.call_site === 'routing')!;
    expect(routing).toBeDefined();
    // Watermark = newest prior turn ⇒ lag 0 (populated, not null).
    expect(routing.summary_lag_turns).toBe(0);
    const sectionChars = routing.section_chars as Record<string, number>;
    expect(sectionChars.conversation_summary).toBeGreaterThan(0);
  });

  it('history fits the window → NO block, NO instruction, NO summarised marker; summary_lag_turns stays null', async () => {
    readRecentTurns = turnsNewestFirst(2);
    const { calls } = await runTurn();
    const prompt = routingUserMessage(calls);
    expect(prompt).not.toContain('"conversation_summary":');
    expect(prompt).not.toContain('the structured state is correct');
    expect(prompt).not.toContain('"summarised"');

    const routing = contextBudgetEvents().find((b) => b.call_site === 'routing')!;
    expect(routing).toBeDefined();
    expect(routing.summary_lag_turns).toBeNull();
    const sectionChars = routing.section_chars as Record<string, number>;
    expect(sectionChars.conversation_summary).toBe(0);
  });

  it('beyond window + summary-store failure → turn proceeds with no block, no error', async () => {
    loadSummaryImpl = async () => {
      throw new Error('RPC unavailable');
    };
    const { calls } = await runTurn();
    const prompt = routingUserMessage(calls);
    expect(prompt).not.toContain('"conversation_summary":');

    const routing = contextBudgetEvents().find((b) => b.call_site === 'routing')!;
    expect(routing).toBeDefined();
    expect(routing.summary_lag_turns).toBeNull();
  });
});
