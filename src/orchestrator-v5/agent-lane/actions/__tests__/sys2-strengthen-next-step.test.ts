import { legacyDoorGraph } from '../../__tests__/licence-test-graphs.js';
/**
 * SYS2 S1 · A STRENGTHEN PRESS WITH NOTHING TO SIZE STILL ENDS WITH THE NEXT STEP THE MODEL IS WAITING FOR (core system 7).
 *
 * Paul's hiring transcript (staging, 11 Oct): every goal-path link was sized, the chance was withheld because the model
 * had no "today's level of productivity", and pressing Strengthen answered only
 *   "There is nothing to strengthen in this step: every link on your goal’s path already has a size."
 * His next message: "You're talking about links, but what about missing data from this decision?". The reply must end
 * with the ask the model is actually waiting on: the exact persisted words (`currentLevelQuestion`, `goalLevelAskOf`),
 * the same ones the `set_current_level` press says. With no such ask the reply is unchanged.
 */
import { describe, expect, it } from 'vitest';
import served from '../../__tests__/fixtures/m1-s1-served-graphs.json';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { actionFactsOf, type ActionRead } from '../state.js';
import { decidePress } from '../handlers.js';

const D3 = served.cases.find((c) => c.id === 'D3-cost-run')!;
const SCENARIO = '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';
const NOTHING = 'There is nothing to strengthen in this step: every link on your goal’s path already has a size.';
// Paul's served hiring ask, verbatim (live run 2026-10-11T222932Z, hiring/turns/04.json).
const LEVEL_ASK = "What's today's level of productivity?";

/** A bound current Run on D3 (every goal-path link sized: nothing in Strengthen's S1 scope). */
function ran(): ActionRead {
  const graph = legacyDoorGraph(D3.graph);
  const h = computeAnalysisAffectingGraphHash(graph as never)!;
  return {
    scenarioId: SCENARIO, graph, graphHash: h,
    analysisState: { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true, leader_claim: { permitted: true, separation: 'separated' } },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: h, data: {} },
    optionParticipation: [],
  };
}

describe('SYS2 S1 · Strengthen with nothing to size', () => {
  it('RED on 50530b5f: the model is waiting for today\'s level → the reply ends with that exact ask', () => {
    const facts = { ...actionFactsOf(ran()), currentLevelQuestion: LEVEL_ASK };
    const d = decidePress({ id: 'agent-next-strengthen' }, facts);
    expect(d.kind).toBe('reply');
    if (d.kind !== 'reply') return;
    expect(d.reply.reason).toBe('nothing_in_scope');
    expect(d.reply.text.startsWith(NOTHING)).toBe(true);
    expect(d.reply.text.trimEnd().endsWith(LEVEL_ASK)).toBe(true);
  });

  it('CONTRAST: no ask pending → the reply is byte-identical to today\'s', () => {
    const facts = { ...actionFactsOf(ran()), currentLevelQuestion: null };
    const d = decidePress({ id: 'agent-next-strengthen' }, facts);
    expect(d.kind).toBe('reply');
    if (d.kind !== 'reply') return;
    expect(d.reply).toMatchObject({ reason: 'nothing_in_scope', text: NOTHING });
  });

  it('CONTRAST: a disabled Strengthen (no current analysis) keeps its own reason and words', () => {
    const graph = legacyDoorGraph(D3.graph);
    const pre: ActionRead = { scenarioId: SCENARIO, graph, graphHash: computeAnalysisAffectingGraphHash(graph as never)!, analysisReady: { status: 'ready', may_run: true } };
    const d = decidePress({ id: 'agent-next-strengthen' }, { ...actionFactsOf(pre), currentLevelQuestion: LEVEL_ASK });
    expect(d).toMatchObject({ kind: 'reply', reply: { reason: 'needs_current_analysis', text: 'I can’t strengthen the model yet: it needs a current analysis first.' } });
  });
});
