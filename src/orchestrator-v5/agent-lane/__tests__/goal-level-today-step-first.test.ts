import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Rec = Record<string, any>;
/** Served staging build (synthetic brief B2: "cut … by a third", no level today), read as GET /graph. */
const BODY = (JSON.parse(readFileSync(new URL('./fixtures/change-goal-no-baseline-b2-served.json', import.meta.url), 'utf8')) as Rec).body as Rec;
const GOAL = 'average_onboarding_time_for_new_enterprise_clients';
const LEVEL_ASK = "What's today's level of Average onboarding time for new enterprise clients?";
const RUN_ASK = 'What is "Dedicated onboarding engineers per new client" today, before any option changes it? Without a current level the analysis would treat it as zero.';
const copy = (): Rec => JSON.parse(JSON.stringify(BODY)) as Rec;
const canonicalState = async (body: Rec): Promise<Rec> => {
  const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
  const { ProposalStore } = await import('../proposal.js');
  const dispatch = (async (path: string) => (path.endsWith('/graph') ? { status: 200, json: body } : { status: 500, json: {} })) as never;
  return (await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({ scenario_id: body.scenario_id,
    authenticated_user_id: null, request_id: 'goal-level-first' })) as Rec;
};

describe("a change target with no level today: the goal's own level is the ONE next step, ahead of the Run's missing figure", () => {
  it('PRECONDITION: the target lacks only today\'s level, and readiness withholds the Run on a factor', () => {
    expect(targetTestabilityOf(BODY.graph)).toEqual({ kind: 'not_testable', goal_id: GOAL,
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
    expect(BODY.current_read.analysis_ready.status).toBe('needs_user_input');
    expect(BODY.current_read.analysis_ready.blockers[0]).toEqual(expect.objectContaining({ blocker_type: 'missing_value', message: RUN_ASK }));
  });

  it('⭐ RED on staging cae490f4 (it named the factor gap): CURRENT MODEL STATE carries today\'s level of the goal as the step', async () => {
    expect((await canonicalState(BODY)).next_step_blocker).toEqual({ kind: 'missing_input', ask: LEVEL_ASK });
  }, 60_000);

  it("CONTRAST: once the goal's level today is held, the Run's own missing figure is the step again", async () => {
    const body = copy();
    const goal = body.graph.nodes.find((n: Rec) => n.id === GOAL);
    goal.observed_state = { value: 0.5, raw_value: 30, cap: 60, unit: 'days', baseline: 0.5 };
    expect(targetTestabilityOf(body.graph).kind).not.toBe('not_testable');
    expect((await canonicalState(body)).next_step_blocker).toEqual(expect.objectContaining({ kind: 'missing_input', ask: RUN_ASK }));
  }, 60_000);
});
