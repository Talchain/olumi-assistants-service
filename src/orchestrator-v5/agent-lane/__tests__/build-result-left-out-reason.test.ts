/**
 * ⭐ S7 B2 — THE BUILD TURN'S AI GETS THE TYPED REASON A RISK IS LEFT OUT OF THE RUN (capacity e2e c1e944a4/2c43f563, turn 01,
 * judge item 4). The build result carried each entity's `relies_on` stamp but not the reason, so the AI invented one: "the
 * specialist-start-delay risk is retained but excluded because you gave no deadline", while the host line in the same reply
 * said "This model can't yet apply that risk to that option alone". The build result now carries `left_out_of_run` exactly as
 * get_canonical_state gives it (`projectModelContext`), so the AI states THAT reason. Proven by identity in the tool result the
 * AI reads, on the capacity labels and on a second brief.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, projectModelContext, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import { reliesOnRiskLine } from '../../routing/relies-on-risk.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };

const CANDIDATE = {
  goal: { metric: 'Weekly support capacity', operator: '>=', value: 100, unit: 'tickets per week', provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Add one specialist', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Existing team capacity', role: 'observable', baseline_known: true, baseline_value: 80, unit: 'tickets per week', provenance: 'explicit' }],
  risks: [],
  outcomes: [{ label: 'Weekly support capacity', provenance: 'inferred' }],
  links: [{ from: 'Existing team capacity', to: 'Weekly support capacity', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};
const structured: CallStructuredModel = async () => ({ text: JSON.stringify(CANDIDATE) });

/** The re-read after registration returns `after`: an option, and a risk stamped as that option's precondition, unlinked. */
function dispatcher(after: unknown[]): InternalDispatch {
  let registered = false;
  return async (path) => {
    if (path.endsWith('/graph/register')) { registered = true; return { status: 200, json: {} }; }
    return { status: 200, json: { graph: { nodes: registered ? after : [], edges: [] }, graph_hash: registered ? 'after' : 'before' } };
  };
}

const graphOf = (option: string, risk: string) => [
  { id: 'goal_1', kind: 'goal', label: 'Weekly support capacity' },
  { id: 'opt_add', kind: 'option', label: option },
  { id: 'risk_pre', kind: 'risk', label: risk, relies_on: { option_id: 'opt_add' } },
];

describe('S7 B2: the build result carries the typed reason a risk is left out of the Run', () => {
  for (const [brief, option, risk] of [
    ['capacity (e2e c1e944a4 turn 01)', 'Add one specialist', 'Specialist start delay'],
    ['hiring', 'Hire a senior engineer', 'Candidate declines the offer'],
  ] as const) {
    it(`${brief}: left_out_of_run names the risk, its option and the model's own reason`, async () => {
      const caps = createAgentCapabilities(dispatcher(graphOf(option, risk)), new ProposalStore(), structured);
      const r = await caps.buildModelFromBrief(ctx, { brief: 'a brief' }) as Record<string, unknown>;
      const left = r.left_out_of_run as { id: string; label: string; relies_on: { option_id: string }; reason: string }[] | undefined;
      expect(left, 'the build result the AI reads carries the left-out risks').toBeDefined();
      expect(left!.map((x) => x.id)).toEqual(['risk_pre']);
      expect(left![0]!.relies_on).toEqual({ option_id: 'opt_add' });
      // By identity: the SAME reason line the host says, for THIS risk and option.
      expect(left![0]!.reason).toBe(reliesOnRiskLine(risk, option));
      expect(left![0]!.reason).toContain("can't yet apply that risk to that option alone");
      expect(left![0]!.reason).not.toMatch(/deadline/i);
      // And the same projection get_canonical_state gives (one source, never a second wording).
      const state = projectModelContext({ nodes: graphOf(option, risk) as never, edges: [], raw: {}, analysis_state: undefined, analysis_ready: undefined } as never);
      expect(r.left_out_of_run).toEqual(state.left_out_of_run);
    });
  }

  it('CONTRAST: a linked risk is in the Run, so nothing is left out and the key is absent', async () => {
    const after = graphOf('Add one specialist', 'Specialist start delay').map((n) => n.kind === 'risk' ? { id: n.id, kind: n.kind, label: n.label } : n);
    const caps = createAgentCapabilities(dispatcher(after), new ProposalStore(), structured);
    const r = await caps.buildModelFromBrief(ctx, { brief: 'a brief' }) as Record<string, unknown>;
    expect(r.confirmed_entities, 'the build itself succeeded').toBe(3);
    expect('left_out_of_run' in r).toBe(false);
  });
});
