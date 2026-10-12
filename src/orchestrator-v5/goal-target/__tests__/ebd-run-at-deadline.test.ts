/**
 * EBD — the Run on the deadline model (Paul's hiring test, 12 Oct 2026). With the deadline card approved, the goal also
 * holds the month count ("6 months from 12 October 2026"), and §(ad)'s horizon verdict withheld every option's chance as
 * "Your goal is for month 6, and this model only has today's numbers." A share-by-date forecast is computed AT its
 * deadline (`withEventShareDate`), so it is tested at H. The ordinary level goal keeps its withhold (control).
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { draftedTeamPartOf, withEventShareDate } from '../event-by-date-model.js';
import { applyTeamShareEdit } from '../team-share-write.js';
import { goalKindOf } from '../goal-kind.js';
import { goalHorizonVerdict, heldGoalHorizonMonths, withholdGoalFiguresForUntestedHorizon } from '../goal-horizon-verdict.js';

type Rec = Record<string, any>;
const BRIEF = 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.';
const candidate = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'Next feature launch', operator: '>=', unit: '% of next feature launch',
    value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null, horizon_months: null, provenance: 'inferred' },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, added_capacity: null },
  ], factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
});
const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
/** The deadline card's postimage (12 April 2027, 6 months from 12 October 2026) with a stated team range held. */
const held = (): Rec => {
  const a = admitCandidateModel(candidate(), {}, BRIEF, undefined, undefined, undefined, undefined, undefined, { event_by_date_prompted: true });
  const g = plain(withEventShareDate(plain({ nodes: a.nodes, edges: a.edges }), '2027-04-12', '2026-10-12'));
  const part = draftedTeamPartOf(g)!;
  Object.assign(g.nodes.find((n: Rec) => n.id === part.goal.id), { goal_horizon_months: 6, goal_horizon_reference_date: '2026-10-12', goal_horizon_stated_months: 6 });
  const written = applyTeamShareEdit(g, { goal_id: part.goal.id, team_id: part.team.id, deadline: '2027-04-12', reference_date: '2026-10-12',
    low_months: 6, high_months: 10 }, computeAnalysisAffectingGraphHash(g as never)!);
  if (written.kind !== 'mutated') throw new Error('write');
  return written.mutatedGraph;
};
const rows = { option_comparison: ['event_option_1', 'event_option_2', 'event_option_3'].map(id => ({ option_id: id, probability_of_goal: 0.4 })) };

describe('EBD — a share-by-date chance is computed AT its deadline', () => {
  it('a share-by-date goal holding month 6 is tested at its deadline: no HORIZON_NOT_TESTED, figures kept', () => {
    const g = held();
    expect(goalKindOf(g)).toBe('share_by_date');
    expect(heldGoalHorizonMonths(g.nodes.find((n: Rec) => n.kind === 'goal'))).toBe(6);
    expect(goalHorizonVerdict(g)).toBe('computed_at_h');
    expect(JSON.stringify(withholdGoalFiguresForUntestedHorizon(rows, g))).toBe(JSON.stringify(rows));
  });
  it('CONTROL: an ordinary level goal holding month 6 with no carrier still says HORIZON_NOT_TESTED', () => {
    const g = { nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 20000, goal_threshold_unit: 'GBP', goal_threshold_frame: 'level', goal_direction: '>=',
        goal_horizon_months: 6, goal_horizon_reference_date: '2026-10-12', goal_horizon: { deadline: '2027-04-12' } },
      { id: 'event_option_1', kind: 'option', label: 'A' }, { id: 'event_option_2', kind: 'option', label: 'B' }, { id: 'event_option_3', kind: 'option', label: 'C' },
    ], edges: [] };
    expect(goalKindOf(g)).toBe('level');
    expect(goalHorizonVerdict(g)).toBe('withhold');
    expect(JSON.stringify(withholdGoalFiguresForUntestedHorizon(rows, g))).toContain('GOAL_FIGURES_HORIZON_NOT_TESTED');
  });
});
