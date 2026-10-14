/**
 * ⭐ SCIENCE (AIE MA3; DL 16:17Z 14 Oct, item moved from session 4): Paul's marketing goal is conversion over the first three
 * months AFTER LAUNCH. Turn 04 of e2e 0dac5dcc ("We have 6 months to launch our new features from last Friday, and that's
 * when the initial 3-month sales cycle starts.") went down the deliverable-redraft path and was refused
 * `revised_draft_has_no_target`. The launch date opens the goal's window: saved as `goal_horizon.deadline` it would be a
 * wrong horizon (a blocking class), and it is not a new deliverable. Until the model can hold it (reader-first, with the
 * window forecasts), the door prepares nothing and tells the AI the true reason, once.
 *
 * Corpus: the served marketing graph (`tests/fixtures/marketing-withheld-once/run-08.json`), through the real door
 * (`createAgentCapabilities(…).proposeGoalDeadline`, local dispatch, no provider). Contrast: the same graph read from today.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden'); }, getMaxTokensFromConfig: () => undefined,
}));
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const TURN_04 = "We have 6 months to launch our new features from last Friday, and that's when the initial 3-month sales cycle starts.";

function door(graph: Rec) {
  const dispatch: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h', brief_text: 'brief', scenario_created_at: '2026-10-09T10:00:00Z' } };
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(`Unexpected local dispatch ${path}`);
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { now: () => new Date('2026-10-14T16:00:00Z') });
  const ctx = { scenario_id: 'sid-launch', authenticated_user_id: null, request_id: 'r', user_text: TURN_04, user_turn_text: TURN_04 };
  return { call: (args: Rec) => caps.proposeGoalDeadline!(ctx as never, args as never) as Promise<Rec>, proposals };
}
const withBasis = (patch: Rec): Rec => ({ ...F.graph, nodes: (F.graph.nodes as Rec[]).map((n) => n.kind === 'goal' ? { ...n, goal_target_basis: { ...n.goal_target_basis, ...patch } } : n) });

describe('a launch date opens a launch-window goal\'s window: never its deadline, never a redraft', () => {
  it('RED: the served turn-04 call (deliverable "launch") is refused with the window\'s reason; nothing is prepared', async () => {
    const d = door(F.graph);
    const out = await d.call({ deadline_words: '6 months', deliverable: 'launch our new features' });
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'launch_opens_window' });
    expect(out.detail).toBe('‘Conversion rate’ is measured over the first three months after launch, so the launch date the user gave (“6 months”) '
      + 'is when that window starts, not the goal\'s deadline. Olumi cannot hold a launch date in the model yet, so nothing was prepared. '
      + 'Tell the user plainly, in one sentence: their targets stay measured over the first three months after launch, and their launch '
      + 'timing is noted in this conversation but does not change the calculation yet. Do not ask them to restate the date, and do not offer a deadline card.');
    expect(d.proposals.outstanding('sid-launch', null)).toEqual([]);
  });

  it('RED: the plain deadline call (no deliverable) is refused the same way: no goal_horizon card for a launch date', async () => {
    const out = await door(F.graph).call({ deadline_words: '6 months' });
    expect(out.refusal).toBe('launch_opens_window');
  });

  it('CONTROL: the same graph measured from TODAY keeps the existing deadline card (what the launch goal would wrongly get)', async () => {
    const out = await door(withBasis({ reference: 'today' })).call({ deadline_words: '6 months' });
    expect(out).toMatchObject({ ok: true, mutated: false, deadline: { goal: 'Conversion rate', date: '9 April 2027', words: '6 months' } });
  });
});
