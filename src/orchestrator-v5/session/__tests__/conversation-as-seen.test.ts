/**
 * ⛔ THE CONVERSATION AS THE USER SAW IT (DL #75 5911353017; AIQ rows 5911326118; restore #2361).
 *
 * The served rows of MRR `3b6369b0` (30 Sep 01:42:37–01:44:10Z), exactly as stored except for shortened texts: every
 * Agent turn is a claim row, then the Agent's internal sub-turns (the turn executor's `sha256:` rows), then the Agent's
 * answer row (`agent_turn:`). `readRecent` answers newest first, so the fixture is reversed for the readers.
 */
import { describe, it, expect } from 'vitest';

import { conversationAsSeen, isAgentAnswerRow, AGENT_ANSWER_REQUEST_HASH_PREFIX } from '../conversation-as-seen.js';
import { historyFromDurableTurns } from '../../agent-lane/history-store.js';
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
