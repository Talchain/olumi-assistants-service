/**
 * ⛔ THE CONVERSATION AS THE USER SAW IT (DL #75 5911353017; AIQ rows 5911326118; restore #2361).
 *
 * The served rows of MRR `3b6369b0` (30 Sep 01:42:37–01:44:10Z), exactly as stored except for shortened texts: every
 * Agent turn is a claim row, then the Agent's internal sub-turns (the turn executor's `sha256:` rows), then the Agent's
 * answer row (`agent_turn:`). `readRecent` answers newest first, so the fixture is reversed for the readers.
 */
import { describe, it, expect, vi } from 'vitest';

import { conversationAsSeen, isAgentAnswerRow, withTextAsSeen, AGENT_ANSWER_REQUEST_HASH_PREFIX } from '../conversation-as-seen.js';
import { historyFromDurableTurns, DURABLE_SEED_TURNS, DURABLE_SEED_ROWS_READ } from '../../agent-lane/history-store.js';
import { maintainRollingSummaryForCommit } from '../../rolling-summary/capture.js';
import { MonotonicRollingSummaryStoreFake } from '../../../../tests/utils/rolling-summary-store-fake.js';
import { assembleExplicitGenerateBrief } from '../../routing/assemble-explicit-generate-brief.js';
import type { SessionTurnWithContent } from '../conversation-content.js';

const A = (x: string) => `agent_turn:${x.repeat(64).slice(0, 64)}`;
const S = (x: string) => `sha256:${x.repeat(32).slice(0, 32)}`;
const row = (turn_id: string, request_hash: string, user_message: string | null, assistant_message: string | null) =>
  ({ turn_id, request_hash, user_message, assistant_message }) as unknown as SessionTurnWithContent;

const BRIEF = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 Pro subscribers.';
const REASON = 'The user asked to run the analysis after confirming how MRR is calculated.';
const OLDEST_FIRST = [
  row('a096:claim', A('7'), null, null),
  row('graph_registration:4072', 'graph_registration:fefa3', null, null),
  row('8f22e3d6', S('9'), null, 'I ran a first analysis on the model I have just drafted.'),
  row('a096', A('7'), BRIEF, 'I’ve drafted a provisional model, but it cannot yet be analysed.'),
  row('e3d5:claim', A('5'), null, null),
  row('085f9d61', S('2'), null, 'Recorded as yours: “MRR” is “Pro plan monthly price” × “Paying subscribers”.'),
  row('e3d5', A('5'), 'Yes — Is “MRR” your “Pro plan monthly price” × “Paying subscribers”?', 'Recorded, as you confirmed.'),
  row('745a:claim', A('b'), null, null),
  row('0899b727', S('4'), REASON, 'Raise price to £59 scored highest in 100% of runs.'),
  row('745a', A('b'), 'Run the analysis', 'On the current model, raising Pro price to £59 does best.'),
];
const NEWEST_FIRST = [...OLDEST_FIRST].reverse();

type Item = { role: string; content: unknown };
const said = (items: unknown[], role: string) => (items as Item[]).filter((i) => i.role === role)
  .map((i) => (typeof i.content === 'string' ? i.content : (i.content as { text: string }[])[0]!.text));

describe('AIQ row 1 — the Agent’s memory rebuilt after a redeploy holds only what the user said and read', () => {
  it('RED: the served MRR rows seed exactly the user’s three turns and the Agent’s three replies', () => {
    const items = historyFromDurableTurns(NEWEST_FIRST);
    expect(said(items, 'user')).toEqual([BRIEF, 'Yes — Is “MRR” your “Pro plan monthly price” × “Paying subscribers”?', 'Run the analysis']);
    expect(said(items, 'assistant')).toEqual([
      'I’ve drafted a provisional model, but it cannot yet be analysed.', 'Recorded, as you confirmed.', 'On the current model, raising Pro price to £59 does best.']);
    const all = JSON.stringify(items);
    for (const unseen of [REASON, '100% of runs', 'I ran a first analysis', 'Recorded as yours']) expect(all).not.toContain(unseen);
  });

  it('a row without a request hash is not the Agent’s (fails closed)', () => {
    expect(historyFromDurableTurns([{ user_message: 'typed', assistant_message: 'reply' }])).toEqual([]);
  });
});

describe('AIQ row 2 — brief assembly never selects a sub-turn’s text', () => {
  const base = { message: 'Yes, build the model now please', source: 'chip_click' as const, persistedBriefText: null };
  const PARAPHRASE = 'The user wants to decide whether to raise the Pro plan price from £49 to £59 a month for 1,500 subscribers.';

  it('RED: a newer brief-shaped sub-turn paraphrase loses to the user’s own brief', () => {
    // The Agent's first turn only: its claim, the build's first-analysis sub-turn, and the answer row carrying the brief.
    const firstTurn = [row('a096', A('7'), BRIEF, 'drafted'), row('8f22e3d6', S('9'), null, 'ran'), row('a096:claim', A('7'), null, null)];
    const recentTurns = [row('sub', S('1'), PARAPHRASE, 'ok'), ...firstTurn];
    expect(assembleExplicitGenerateBrief({ ...base, recentTurns })).toEqual({ brief: BRIEF, source: 'recent_turn' });
  });

  it('RED: when only a sub-turn is brief-shaped, no turn is used as the brief', () => {
    const recentTurns = [row('sub', S('1'), PARAPHRASE, 'ok'), row('745a:claim', A('b'), null, null), row('745a', A('b'), 'Run the analysis', 'done')];
    expect(assembleExplicitGenerateBrief({ ...base, recentTurns })).toBeNull();
  });

  it('CONTROL: an orchestrator-only conversation (no Agent rows) reads every row, exactly as before', () => {
    const recentTurns = [row('t2', S('2'), 'thanks', 'ok'), row('t1', S('1'), BRIEF, 'ok')];
    expect(assembleExplicitGenerateBrief({ ...base, recentTurns })).toEqual({ brief: BRIEF, source: 'recent_turn' });
  });
});

describe('the predicate', () => {
  it('only the Agent route’s hash marks an answer row; conversationAsSeen keeps order and falls back only when there is no Agent row', () => {
    expect(AGENT_ANSWER_REQUEST_HASH_PREFIX).toBe('agent_turn:');
    expect([A('1'), S('1'), 'graph_registration:x', '', undefined, null].map((h) => isAgentAnswerRow({ request_hash: h }))).toEqual([true, false, false, false, false, false]);
    expect(conversationAsSeen(OLDEST_FIRST).map((r) => r.turn_id)).toEqual(['a096:claim', 'a096', 'e3d5:claim', 'e3d5', '745a:claim', '745a']);
    const direct = [row('t1', S('1'), 'x', 'y'), row('t2', S('2'), 'z', 'w')];
    expect(conversationAsSeen(direct)).toEqual(direct);
  });
});

/**
 * P0 PARTNER's served replay (CURRENT-READ-v1 row 5): R3's MRR `9fc32bf8` on `e9fba88`, 12:19:05–12:20:27Z, as stored.
 * The real `historyFromDurableTurns` at `c782026a` reseeded 4 "user" items from these rows; the 4th was "the user pressed
 * Run", a sub-turn the user never typed.
 */
const SERVED_9FC32BF8_NEWEST_FIRST = [
  row('r10', A('d'), 'Run analysis.', '**On this model, raising the Pro price to £59 does best.'),
  row('r9', S('e'), 'the user pressed Run', 'Raise price to £59 scored highest against your goal in 100% of runs. This was a re-run.'),
  row('r8:claim', A('d'), null, null),
  row('r7', A('c'), 'Yes — Is “MRR” your “Pro plan monthly price” × “Paying subscribers”?', 'Recorded, as you confirmed: "MRR" is calculated as…'),
  row('r6', S('f'), null, 'Recorded as yours: "MRR" is "Pro plan monthly price"… The held change has lapsed because the model changed.'),
  row('r5:claim', A('c'), null, null),
  row('r4', A('b'), 'Should we raise our Pro plan price from £49 to £59 a month?', 'I’ve drafted a comparison, but its first pass…'),
  row('r3', S('a'), null, 'I ran a first analysis on the model I have just drafted.'),
  row('graph_registration:x', 'graph_registration:fe', null, null),
  row('r1:claim', A('b'), null, null),
];

describe('P0 PARTNER’s served 9fc32bf8 replay — the reseeded Agent memory', () => {
  it('RED: "the user pressed Run" is gone; the 3 real sends stay, with the 3 replies the user read', () => {
    const items = historyFromDurableTurns(SERVED_9FC32BF8_NEWEST_FIRST);
    expect(said(items, 'user')).toEqual(['Should we raise our Pro plan price from £49 to £59 a month?',
      'Yes — Is “MRR” your “Pro plan monthly price” × “Paying subscribers”?', 'Run analysis.']);
    expect(said(items, 'assistant')).toHaveLength(3);
    const all = JSON.stringify(items);
    for (const unseen of ['the user pressed Run', '100% of runs', 'This was a re-run', 'has lapsed', 'I ran a first analysis', 'Recorded as yours']) {
      expect(all).not.toContain(unseen);
    }
  });

  it('the reseed cap counts AFTER the drop: 30 Agent turns (claim + sub-turn + answer) reseed the newest 20', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [
      row(`t${i}:claim`, A('1'), null, null), row(`s${i}`, S('2'), 'the user pressed Run', 'sub'), row(`t${i}`, A('1'), `user ${i}`, `reply ${i}`),
    ]).flat().reverse();
    expect(DURABLE_SEED_ROWS_READ).toBeGreaterThanOrEqual(rows.length);
    const users = said(historyFromDurableTurns(rows), 'user');
    expect(users).toHaveLength(DURABLE_SEED_TURNS);
    expect(users[0]).toBe('user 10');
    expect(users[19]).toBe('user 29');
  });
});

describe('withTextAsSeen — every row kept (ids, facts, watermarks), only unseen text blanked', () => {
  it('RED: turn context / rolling summary rows keep their ids and order; sub-turn texts become null', () => {
    const out = withTextAsSeen(SERVED_9FC32BF8_NEWEST_FIRST);
    expect(out.map((r) => r.turn_id)).toEqual(SERVED_9FC32BF8_NEWEST_FIRST.map((r) => r.turn_id));
    const sub = out.find((r) => r.turn_id === 'r9')!;
    expect([sub.user_message, sub.assistant_message]).toEqual([null, null]);
    expect(out.find((r) => r.turn_id === 'r10')!.user_message).toBe('Run analysis.');
    expect(JSON.stringify(out)).not.toContain('the user pressed Run');
  });

  it('CONTROL: an orchestrator-only conversation keeps every text', () => {
    const direct = [row('t1', S('1'), 'x', 'y')];
    expect(withTextAsSeen(direct)).toEqual(direct);
  });

  it('RED: the rolling summary never hands the summariser a sub-turn’s text', async () => {
    const summarise = vi.fn(async () => ({ text: 'DECISION FRAME: Pro price.' }));
    await maintainRollingSummaryForCommit({
      scenarioId: 'scenario-seen', turnId: 'r10', persistedRowId: 'row-10',
      historyReader: { readRecent: vi.fn(async () => SERVED_9FC32BF8_NEWEST_FIRST.map((r) => ({ ...r, created_at: '2026-09-30T12:20:00.000Z' }))) } as never,
      summaryStore: new MonotonicRollingSummaryStoreFake(),
      model: { summarise },
    });
    expect(summarise, 'the control: the summariser really ran').toHaveBeenCalled();
    const input = JSON.stringify(summarise.mock.calls);
    expect(input).toContain('Run analysis.');
    for (const unseen of ['the user pressed Run', '100% of runs', 'I ran a first analysis']) expect(input).not.toContain(unseen);
  });
});
