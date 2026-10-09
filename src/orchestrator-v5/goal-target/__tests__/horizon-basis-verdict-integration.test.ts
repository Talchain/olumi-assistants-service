/** S5 2b r13: the real mint, verdict, served cells and reply composer share one permission. */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { applyGoalSteadyEdit } from '../goal-steady-write.js';
import { goalHorizonVerdict, withReadTimeHorizonGate } from '../goal-horizon-verdict.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';
import { composeReplyShape } from '../../agent-lane/reply/compose-reply.js';
import { enforceAgentLaneLeaderClaimsAtWire, goalFigureCoHoldOf } from '../../agent-lane/withheld-leader-fail-closed.js';
import { WITHHELD_SEPARATION_UNAVAILABLE } from '../../compose/analysis-state-v1.js';
import { deriveAnswerTextFromShape } from '../../routing/answer-shape.js';

vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: new Proxy(actual.config, { get(target, key) {
    if (key === 'auth') return { ...target.auth, hmacSecret: 's5-r13-test-only-secret' };
    return Reflect.get(target, key);
  } }) };
});

type Rec = Record<string, any>;
// Science §(ad)'s ACKed sentence, including curly quotes and terminal full stop.
const WHY = 'You said ‘monthly recurring revenue’ stays about where it is over 9 months unless you act, so this is its chance once each option is in effect.';
const seed = (): Rec => ({ nodes: [
  { id: 'mrr', kind: 'goal', label: 'monthly recurring revenue', goal_horizon_months: 9,
    goal_threshold_unit: '£/month', goal_horizon: { deadline: '2027-03-31' } },
  { id: 'raise', kind: 'option', label: 'Raise prices' },
], edges: [] });
const minted = (): Rec => {
  const issued = applyGoalSteadyEdit(seed(), { goal_id: 'mrr', months: 9 }, 's5-r13');
  if (issued.kind !== 'mutated') throw new Error('real door mint refused');
  // The proof must also survive stored JSON bytes.
  return JSON.parse(JSON.stringify(issued.mutatedGraph));
};
const goal = (graph: Rec): Rec => graph.nodes[0];
function served(graph: Rec) {
  const result = { type: 'analysis_result', enrichment: {
    option_comparison: [{ option_id: 'raise', probability_of_goal: .46, win_probability: .7 }],
    // Recorded Run licence; the served route spec also exercises the real producer.
    inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', form: 'each', option_ids: ['raise'],
      pct_by_option: { raise: 46 }, goal_node_id: 'mrr', goal_label: 'monthly recurring revenue' }],
  } };
  const held = withReadTimeHorizonGate(result, graph, result.enrichment);
  const cells = projectCanonicalAnalysisCells(held as never, graph).map(row => row.cell);
  const coHold = goalFigureCoHoldOf([held], graph);
  const text = 'Your results are ready. Raise prices has about 46% chance.';
  // Withheld narration passes the same fail-closed egress as the route.
  // The positive cell/composer path has no leader claim to adjudicate.
  const wireText = coHold === undefined ? text : enforceAgentLaneLeaderClaimsAtWire({
    assistant_text: text, blocks: [held], suggested_actions: [],
    analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: {
      permitted: false, withheld_reason: WITHHELD_SEPARATION_UNAVAILABLE } },
  } as never, { requestId: 's5-r13', exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
    separationEstablished: false, leaderClaimWithheldReason: WITHHELD_SEPARATION_UNAVAILABLE,
    graph, analysisReady: undefined, protectedGoalChanceSay: coHold?.say,
  } as never).response.assistant_text;
  const reply = composeReplyShape({ faceContract: 'run', graph, text: wireText, chanceCells: cells });
  return { held, cells, reply };
}
function assertWithheld(graph: Rec) {
  expect(goalHorizonVerdict(graph)).toBe('withhold');
  const { held, cells, reply } = served(graph);
  expect(held.enrichment.option_comparison[0]).not.toHaveProperty('probability_of_goal');
  expect(cells).toHaveLength(1);
  expect(cells[0]?.kind).toBe('withheld');
  expect(reply.text).not.toContain('%');
  expect(reply.text).not.toContain(WHY);
}

describe('S5 door → merged verdict → served chance and Why?', () => {
  it('valid door-minted months attestation shows chance and the ACKed Why line byte-for-byte', () => {
    const graph = minted();
    expect(goalHorizonVerdict(graph)).toBe('steady_attested');
    const { held, cells, reply } = served(graph);
    expect(held.enrichment.option_comparison[0]?.probability_of_goal).toBe(.46);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ kind: 'figure' });
    expect(reply.shape).not.toBeNull();
    expect(reply.text).toContain('46%');
    expect(reply.shape!.detail.split('\n\n')).toContain(WHY);
    expect(reply.text).toContain(WHY);
    expect(reply.text).toBe(deriveAnswerTextFromShape(reply.shape!));
    process.stdout.write(`ACKed Why sha256: ${createHash('sha256').update(WHY, 'utf8').digest('hex')}\n`);
  });
  it('unattested months goal withholds', () => assertWithheld(seed()));
  it.each([
    ['label', (node: Rec) => { node.label = 'annual revenue'; }],
    ['unit', (node: Rec) => { node.goal_threshold_unit = '£/year'; }],
    ['months', (node: Rec) => { node.goal_horizon_months = 12; }],
    ['deadline', (node: Rec) => { node.goal_horizon.deadline = '2027-04-30'; }],
  ] as const)('a moved %s invalidates the minted attestation and withholds', (_name, change) => {
    const graph = minted(); change(goal(graph)); assertWithheld(graph);
  });
  it('deadline-only with an attestation still present withholds', () => {
    const graph = minted(); delete goal(graph).goal_horizon_months;
    expect(goal(graph).horizon_basis.proof).toMatch(/^[0-9a-f]{64}$/);
    assertWithheld(graph);
  });
});
