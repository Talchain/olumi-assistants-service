/**
 * CURRENT-READ-v1 row 5 — the turn context's `prior_turns` read the conversation as the user SAW it: every row is kept
 * (ids for fact look-ups, turn-id watermarks), and an Agent sub-turn's text is blanked. Served MRR `9fc32bf8` shape.
 */
import { describe, it, expect, vi } from 'vitest';

const A = (x: string) => `agent_turn:${x.repeat(64).slice(0, 64)}`;
const S = (x: string) => `sha256:${x.repeat(32).slice(0, 32)}`;
const ROWS_NEWEST_FIRST = [
  { id: 'row-3', turn_id: 'r10', request_hash: A('d'), user_message: 'Run analysis.', assistant_message: 'On this model, raising the Pro price to £59 does best.' },
  { id: 'row-2', turn_id: 'r9', request_hash: S('e'), user_message: 'the user pressed Run', assistant_message: 'Raise price to £59 scored highest in 100% of runs.' },
  { id: 'row-1', turn_id: 'r8:claim', request_hash: A('d'), user_message: null, assistant_message: null },
];
vi.mock('../session/index.js', () => ({ getSessionStore: () => ({ readRecent: vi.fn(async () => ROWS_NEWEST_FIRST) }) }));

describe('turn context — prior_turns as the user saw them', () => {
  it('RED: the sub-turn row stays (id kept for its facts) but its text is gone; the Agent answer keeps its words', async () => {
    const { loadRecentConversationTurns } = await import('../build-turn-context.js');
    const turns = await loadRecentConversationTurns('9fc32bf8-0000-4000-8000-000000000000', 'req-1');
    expect(turns.map((t) => (t as { id: string }).id)).toEqual(['row-3', 'row-2', 'row-1']);
    expect(turns[1]).toMatchObject({ user_message: null, assistant_message: null });
    expect(turns[0]).toMatchObject({ user_message: 'Run analysis.' });
    expect(JSON.stringify(turns)).not.toContain('the user pressed Run');
  }, 120_000);
});
