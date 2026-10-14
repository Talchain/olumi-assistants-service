import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextStepBlockerForAgent } from '../next-step-blocker.js';
import { riskOccurrenceAskWords } from '../risk-occurrence.js';

type Rec = Record<string, any>;
/** Served marketing e2e 0dac5dcc, the GET /graph body after the revised-draft approval: the Run is withheld on one unvalued risk. */
const BODY = (JSON.parse(readFileSync(new URL('./fixtures/marketing-e2e-0dac5dcc-read02-after-approve.json', import.meta.url), 'utf8')) as Rec).body as Rec;
const ASK = 'How likely or how large is "Limited marketing experience" today? Olumi can’t run the numbers until this risk has a figure.';
const RISK = 'limited_marketing_experience';
const read = (body: Rec = BODY) => ({ raw: body.graph, analysis_state: body.analysis_state, analysis_ready: body.current_read.analysis_ready,
  analysis_result: body.analysis_result });
const copy = (): Rec => JSON.parse(JSON.stringify(BODY)) as Rec;
const canonicalState = async (body: Rec): Promise<Rec> => {
  const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
  const { ProposalStore } = await import('../proposal.js');
  const dispatch = (async (path: string) => (path.endsWith('/graph') ? { status: 200, json: body } : { status: 500, json: {} })) as never;
  return (await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({ scenario_id: body.scenario_id,
    authenticated_user_id: null, request_id: 'run-withheld-step' })) as Rec;
};

describe('a Run withheld for a missing figure: that figure is the ONE next step (served marketing e2e 0dac5dcc)', () => {
  it('PRECONDITION: readiness withholds the Run on the risk, in its own words', () => {
    expect(BODY.current_read.analysis_ready.status).toBe('needs_user_input');
    expect(BODY.current_read.analysis_ready.blockers).toEqual([expect.objectContaining({ factor_id: RISK, blocker_type: 'missing_value', message: ASK })]);
  });

  it('⭐ RED on staging (it said "What\'s today\'s level of conversion rate?"): CURRENT MODEL STATE carries the risk\'s figure as the step', async () => {
    expect((await canonicalState(BODY)).next_step_blocker).toEqual({ kind: 'missing_input', ask: ASK });
  }, 60_000);

  it('where Olumi\'s starting-assumption card can exist (#3013: one goal window), the step names its proposing tool', () => {
    // The launch reading alone is the goal's one window (`riskOccurrenceWindowMonths`); readiness then asks the event-path question.
    const body = copy();
    delete body.graph.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months;
    const ask = `${riskOccurrenceAskWords('Limited marketing experience', 3)} Olumi can’t run the numbers until this risk has a figure.`;
    body.current_read.analysis_ready.blockers[0].message = ask;
    expect(nextStepBlockerForAgent(read(body))).toEqual({ kind: 'missing_input', ask,
      proposable_by: { tool: 'propose_assumptions', node_id: RISK, field: 'occurrence_range', window_months: 3 } });
  });

  it('CONTRAST: once readiness admits the Run, the later-stage step it had returns', () => {
    const body = copy();
    body.current_read.analysis_ready = { ...body.current_read.analysis_ready, status: 'ready', blockers: [] };
    expect(nextStepBlockerForAgent(read(body))).toEqual({ kind: 'missing_input', ask: 'What\'s today\'s level of conversion rate?' });
  });
});
