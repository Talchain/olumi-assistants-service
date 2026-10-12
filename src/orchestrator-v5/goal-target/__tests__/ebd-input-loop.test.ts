/**
 * EBD — the deadline ("event by date") model's input loop, at its producers (Paul's hiring test, 12 Oct 2026, scenario
 * 4184e877). The end-to-end replay is `ebd-paul-hiring-replay.route.test.ts`; these rows pin each producer by identity.
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { decisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { draftedTeamPartOf, eventModelAsk, withEventShareDate } from '../event-by-date-model.js';
import { chanceGoalDeadlineAsk } from '../goal-kind.js';

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
const drafted = (): Rec => { const a = admitCandidateModel(candidate(), {}, BRIEF, undefined, undefined, undefined, undefined, undefined,
  { event_by_date_prompted: true }); return plain({ nodes: a.nodes, edges: a.edges }); };
const dated = (): Rec => plain(withEventShareDate(drafted(), '2027-04-12', '2026-10-12'));
const askContext = { builtOrRan: true, awaitingApproval: false, restingText: '', questionsToggle: false, recentReplies: [] };
const LEVEL_ASK = /before any option changes it|treat it as zero/;

describe('E1 — the deadline model has ONE readiness question, its own', () => {
  it.each([
    ['no deadline yet', drafted, chanceGoalDeadlineAsk('next feature launch')],
    ['deadline held, no team time', dated, 'How long would next feature launch take with the team you have now?'],
  ])('%s: the Run, graph-readiness, the canonical payload and the coach say the same sentence', (_name, graph, expected) => {
    const g = graph(), team = draftedTeamPartOf(g)!.team.id;
    expect(eventModelAsk(g)).toBe(expected);
    expect(decisionInputAsk(g, askContext)).toBe(expected);
    const run = resolveRunAdmission(g);
    expect(run.willProceed).toBe(false);
    // Bound by identity: the team part's own gap, still the level-gap code (required, never offered), with the model's ask.
    expect(run.assessment.blockingIssues.filter(i => i.factor_id === team))
      .toEqual([expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', factor_id: team, message: expected })]);
    expect((assessRouteAdmission(g).readiness_issues ?? []).filter((i: Rec) => i.factor_id === team).map((i: Rec) => i.message)).toEqual([expected]);
    const payload = buildCanonicalAnalysisReadyFromGraph(g) as Rec;
    expect(payload.blockers.filter((b: Rec) => b.factor_id === team).map((b: Rec) => b.message)).toEqual([expected]);
    expect(JSON.stringify(payload)).not.toMatch(LEVEL_ASK);
  });
  it('CONTRAST: an ordinary root with no level keeps the status-quo level ask, byte for byte', () => {
    const g = drafted();
    g.nodes.push({ id: 'fac_velocity', kind: 'factor', label: 'Team velocity', category: 'observable' });
    g.edges.push({ from: 'fac_velocity', to: 'event_goal', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
    const issues = resolveRunAdmission(g).assessment.blockingIssues.filter(i => i.code === 'MISSING_FACTOR_LEVEL');
    expect(issues.find(i => i.factor_id === 'fac_velocity')?.message)
      .toBe('What is "Team velocity" today, before any option changes it? Without a current level the analysis would treat it as zero.');
    expect(issues.find(i => i.factor_id === 'event_team')?.message).toBe(chanceGoalDeadlineAsk('next feature launch'));
  });
});
