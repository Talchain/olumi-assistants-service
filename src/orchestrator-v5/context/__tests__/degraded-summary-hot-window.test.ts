/**
 * Core Runtime — degraded rolling-summary continuity.
 *
 * The session read has already paid for and bounded a hot window (normally 20
 * turns). When the rolling-summary read is absent or earns zero coverage,
 * discarding rows 9..20 creates the sharpest possible memory cliff at the
 * exact moment the durable summary cannot help. These tests pin the fallback
 * to those already-fetched bytes and keep the existing whole-pack ceiling as
 * the sole budget authority.
 */

import { describe, expect, it } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { CONTEXT_POLICY, CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS } from '../context-policy.js';
import {
  CONTEXT_PACK_RECENT_TURNS_CAP,
  assembleContextPackWithSummary,
} from '../context-pack-assembler.js';
import { buildUserMessage } from '../../routing/route-with-tool-use.js';
import { priorTurnsFixture } from './context-budget-fixtures.js';

const HOT_WINDOW = 20;
const STORED_TOTAL = 28;
const EARLY_CONSTRAINT = 'The signed Bluebird licence expires on 17 September.';

function hotTurns() {
  return priorTurnsFixture(HOT_WINDOW).map((turn, index) => ({
    ...turn,
    user_message: index === 12 ? EARLY_CONSTRAINT : `Routine working note ${index}`,
    assistant_message: `Acknowledged working note ${index}`,
  }));
}

function assemble(args: {
  turns?: ReturnType<typeof hotTurns>;
  priorTurnsTotal?: number | null;
  conversationSummary?: {
    text: string;
    current_to_turn_id: string;
    lag_turns: number;
    stale: boolean;
    note?: string;
  };
  summarisedTurns?: number | null;
}) {
  return assembleContextPackWithSummary({
    payload: makeMessagePayload({
      scenario_id: '00000000-0000-4000-8000-000000000321',
      message: 'What constraints still govern the programme?',
    }),
    priorTurns: args.turns ?? hotTurns(),
    priorTurnsTotal: args.priorTurnsTotal === undefined ? STORED_TOTAL : args.priorTurnsTotal,
    priorFacts: [],
    priorFactsReadOk: true,
    brief: 'Plan the programme without breaching its signed licence.',
    graphContext: { status: 'canonical' },
    compactedGraph: {
      nodes: [
        { id: 'goal_launch', kind: 'goal', label: 'Launch safely' },
        { id: 'opt_phase', kind: 'option', label: 'Phase the launch' },
      ],
      edges: [],
      _node_count: 2,
      _edge_count: 0,
    },
    compactedConstraints: [],
    goalTarget: { status: 'set', value: 73, unit: '%' },
    conversationSummary: args.conversationSummary,
    summarisedTurns: args.summarisedTurns,
  }).contextPack;
}

describe('degraded-summary hot-window fallback', () => {
  it('retains already-fetched turns 9..20 when the summary read has no section', () => {
    const pack = assemble({ summarisedTurns: null });
    const prompt = buildUserMessage(pack, 'What constraints still govern the programme?');

    expect(pack.conversation.recent_turns).toHaveLength(HOT_WINDOW);
    expect(pack.conversation.window).toMatchObject({
      shown: HOT_WINDOW,
      available: STORED_TOTAL,
    });
    expect(pack.conversation.window?.summarised).toBeUndefined();
    expect(prompt).toContain(EARLY_CONSTRAINT);
    expect(pack.conversation.window?.notice).toContain('8 earlier ones are not shown');
  });

  it('uses the same fallback for an honest zero-coverage memory-hole section', () => {
    const pack = assemble({
      conversationSummary: {
        text: 'OPEN: Summary continuity could not be verified this turn.',
        current_to_turn_id: 'turn-20',
        lag_turns: 0,
        stale: true,
        note: 'No earlier turn is claimed as summarised.',
      },
      summarisedTurns: 0,
    });

    expect(pack.conversation.recent_turns).toHaveLength(HOT_WINDOW);
    expect(pack.conversation.window?.summarised).toBe(0);
    expect(pack.conversation_summary?.text).toContain('could not be verified');
    expect(buildUserMessage(pack, 'continue')).toContain(EARLY_CONSTRAINT);
  });

  it('does not present the fetched-window length as a total when the count read failed', () => {
    const pack = assemble({ summarisedTurns: null, priorTurnsTotal: null });
    const notice = pack.conversation.window?.notice ?? '';

    expect(pack.conversation.recent_turns).toHaveLength(HOT_WINDOW);
    expect(pack.conversation.window).toMatchObject({ shown: HOT_WINDOW, available: HOT_WINDOW });
    expect(notice).toContain('true total could not be read this turn');
    expect(notice).toContain('earlier turns may exist outside the fetched window');
    expect(notice).not.toContain('earlier turns exist that are not shown');
    expect(notice).toContain('do not state a total number of turns or exchanges');
  });

  it('keeps the normal eight-turn window when a healthy summary covers hidden turns', () => {
    const pack = assemble({
      conversationSummary: {
        text: `CONSTRAINTS: ${EARLY_CONSTRAINT}`,
        current_to_turn_id: 'turn-20',
        lag_turns: 0,
        stale: false,
      },
      summarisedTurns: HOT_WINDOW - CONTEXT_PACK_RECENT_TURNS_CAP,
    });

    expect(pack.conversation.recent_turns).toHaveLength(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(pack.conversation.recent_turns.some((turn) => turn.user_message === EARLY_CONSTRAINT)).toBe(false);
    expect(pack.conversation.window?.summarised).toBe(12);
    expect(buildUserMessage(pack, 'continue')).toContain(EARLY_CONSTRAINT);
  });

  it('preserves omitted-loader compatibility and short-window byte identity', () => {
    expect(assemble({}).conversation.recent_turns).toHaveLength(CONTEXT_PACK_RECENT_TURNS_CAP);

    const short = hotTurns().slice(0, 5);
    expect(assemble({ turns: short, summarisedTurns: null })).toEqual(
      assemble({ turns: short }),
    );
  });

  it('lets the existing whole-pack ceiling trim noisy fallback turns oldest-first', () => {
    const noisy = hotTurns().map((turn, index) => ({
      ...turn,
      user_message: `newest-rank-${index} ${'u'.repeat(1_900)}`,
      assistant_message: `answer-rank-${index} ${'a'.repeat(1_900)}`,
    }));
    const pack = assemble({ turns: noisy, summarisedTurns: null });
    const shown = pack.conversation.recent_turns.length;

    expect(shown).toBeLessThan(HOT_WINDOW);
    expect(shown).toBeGreaterThanOrEqual(CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS);
    expect(pack.conversation.recent_turns.map((turn) => turn.turn_id)).toEqual(
      Array.from({ length: shown }, (_, index) => `t-prev-${index}`),
    );
    expect(pack.brief?.text).toContain('signed licence');
    expect(pack.goal_target).toEqual({ status: 'set', value: 73, unit: '%' });
    expect(pack.conversation.window?.shown).toBe(shown);
  });

  it('publishes the fallback in the executable context policy', () => {
    expect(CONTEXT_POLICY.coach_converse.memory_window).toMatchObject({
      verbatim_turns: CONTEXT_PACK_RECENT_TURNS_CAP,
      rolling_summary: true,
      degraded_summary_fallback: 'fetched_hot_window',
    });
  });
});
