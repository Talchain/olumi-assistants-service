/**
 * ⭐ E-TAIL (b) (DL option 1; AIE 6130197656 §2 ACK, 12 Oct): A HIRE'S LINK CARRIES AT MOST THE WHOLE DELIVERABLE, ON OLUMI'S
 * OWN PACE ONLY. Evidence: score run 4's deadline scenario (cdca7c76), the graph as stored before the turn-14 approval
 * (`agent-lane/__tests__/fixtures/run4-deadline-turn14-plain-approval.json`). Olumi's drafted pace for "Hire two developers"
 * is 35 % of the launch a month: by 12 April 2027 its raw link mean is 1.05, which the writer's base check refuses.
 *
 * Rows: (1) RED→GREEN, the date writes and the graph is editable, mean 1 and spread × 1/1.05; (2) the source facts are
 * unchanged and the raw moments and the limit are kept beside them as Olumi's assumption; (3) the reader that recognises
 * the deadline model agrees with the writer; (4) the uncapped control (the other hires, 0.6 and 0.54 raw); (5) the human
 * contrasts: a pace a person stated, or accepted on a hiring-times card, is never limited, and the date is refused as
 * before; (6) the limit's exact label is owed for the limited option only. The engine-input and read-back rows are in
 * `run4-deadline-plain-approval.route.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withEventShareDate } from '../event-by-date-model.js';
import { applyTeamShareEdit } from '../team-share-write.js';
import { computeAnalysisAffectingGraphHash as graphHash } from '../../context/graph-hash.js';
import { extraShareMoments, hirePaceIsOlumisOwn } from '../event-by-date-share.js';
import { shareByDateGoalOf } from '../goal-kind.js';
import { hireLinkLimitedFor, OLUMI_HIRE_LIMIT_NOTE } from '../share-by-date-run.js';
import { isEditableGraph } from '../../system-events/editable-graph.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, any>;
const FX: Rec = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/run4-deadline-turn14-plain-approval.json', import.meta.url), 'utf8'));
const DEADLINE = '2027-04-12', REFERENCE = '2026-10-12';
const graph = (): Rec => structuredClone(FX.graph);
/** The run-4 graph with its deadline and a team time the user typed as a range (the base door), so the model is recognised. */
function withTeamTime(g: Rec): Rec {
  const dated = withEventShareDate(g, DEADLINE, REFERENCE) as Rec;
  const team = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 6, high_months: 10,
    deadline: DEADLINE, reference_date: REFERENCE }, graphHash(dated as never)!);
  if (team.kind !== 'mutated') throw new Error(`team time: ${JSON.stringify(team)}`);
  return team.mutatedGraph as Rec;
}
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const link = (g: Rec, from: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === 'event_goal');
const RAW_2 = extraShareMoments(0.35, 6, 2, 4);

describe('E-tail (b): run 4\'s 35 % a month, limited to the whole launch', () => {
  it('precondition: the raw link for two developers is 1.05 (above the whole launch); the pace is Olumi\'s own', () => {
    expect(RAW_2.mean).toBeCloseTo(1.05, 10);
    expect(RAW_2.sd).toBe(0.20207259421636997);
    expect(hirePaceIsOlumisOwn(node(graph(), 'event_capacity_2'))).toBe(true);
  });

  it('(1) RED→GREEN: the date writes, the graph is editable; mean 1, spread scaled by the same factor (CV kept)', () => {
    const out = withEventShareDate(graph(), DEADLINE, REFERENCE) as Rec;
    expect(link(out, 'event_capacity_2').strength).toEqual({ mean: 1, std: RAW_2.sd / RAW_2.mean });
    expect(link(out, 'event_capacity_2').strength.std / 1).toBeCloseTo(RAW_2.sd / RAW_2.mean, 15);
    expect(link(out, 'event_capacity_2').provenance.natural_effect).toMatchObject({ amount: 100, strength_mean: 1 });
    expect(isEditableGraph(projectGraphForPersistence(out))).toBe(true);
  });

  it('(2) the source facts are unchanged; the raw moments and the limit sit beside them, marked as Olumi\'s assumption', () => {
    const before = node(graph(), 'event_capacity_2').observed_state.extra_share_by_date;
    const c = node(withEventShareDate(graph(), DEADLINE, REFERENCE) as Rec, 'event_capacity_2').observed_state.extra_share_by_date;
    expect(c).toMatchObject({ monthly_share: before.monthly_share, lead_low: before.lead_low, lead_high: before.lead_high, unit: before.unit,
      deadline: DEADLINE, reference_date: REFERENCE });
    expect(c.link_limit).toEqual({ raw_mean: RAW_2.mean, raw_sd: RAW_2.sd, entered_mean: 1, entered_sd: RAW_2.sd / RAW_2.mean, origin: 'olumi_assumption' });
  });

  it('(3) the reader that recognises the deadline model agrees with the writer', () => {
    expect(shareByDateGoalOf(withTeamTime(graph()))).not.toBeNull();
    // CONTRAST: the same graph with the limited link put back to its raw size is NOT the model the writer wrote.
    const raw = withTeamTime(graph());
    link(raw, 'event_capacity_2').strength = { mean: RAW_2.mean, std: RAW_2.sd };
    expect(shareByDateGoalOf(raw)).toBeNull();
  });

  it('(4) UNCAPPED CONTROL: the other hires keep their raw links, with no limit', () => {
    const out = withEventShareDate(graph(), DEADLINE, REFERENCE) as Rec;
    for (const [id, pace] of [['event_capacity_1', 0.2], ['event_capacity_4', 0.18]] as const) {
      const raw = extraShareMoments(pace, 6, 2, 4);
      expect(raw.mean).toBeLessThan(1);
      expect(link(out, id).strength).toEqual({ mean: raw.mean, std: raw.sd });
      expect(node(out, id).observed_state.extra_share_by_date.link_limit).toBeUndefined();
    }
  });

  it.each([
    ['a pace the person stated (a stated figure with their words)', (n: Rec) => {
      n.observed_state.extra_share_by_date.figures = { monthly_share: { value: 35, role: 'stated', source: 'user_override', quote: '35% a month' } };
      n.observed_state.extra_share_by_date.statement = { quote: '35% a month', form: 'about' };
    }],
    ['a pace accepted on a hiring-times card (figures with the person\'s review)', (n: Rec) => {
      n.observed_state.extra_share_by_date.figures = { monthly_share: { value: 35, role: 'olumi_estimate', source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } } };
    }],
  ])('(5) HUMAN CONTRAST — %s: never limited; the link stays 1.05 and the date is refused as before', (_name, mark) => {
    const g = graph(); mark(node(g, 'event_capacity_2'));
    expect(hirePaceIsOlumisOwn(node(g, 'event_capacity_2'))).toBe(false);
    const out = withEventShareDate(g, DEADLINE, REFERENCE) as Rec;
    expect(link(out, 'event_capacity_2').strength).toEqual({ mean: RAW_2.mean, std: RAW_2.sd });
    expect(node(out, 'event_capacity_2').observed_state.extra_share_by_date.link_limit).toBeUndefined();
    expect(isEditableGraph(projectGraphForPersistence(out))).toBe(false);
  });

  it('(6) the exact label is owed for the limited option only, and says the AIE\'s words', () => {
    const out = withTeamTime(graph());
    const option = (label: string): string => (out as Rec).nodes.find((n: Rec) => n.kind === 'option' && String(n.label).includes(label))?.id;
    expect(hireLinkLimitedFor(out, [option('two developers')])).toBe(true);
    expect(hireLinkLimitedFor(out, [option('Tech lead')])).toBe(false);
    expect(OLUMI_HIRE_LIMIT_NOTE).toBe("Olumi's provisional modelling estimate limits typical extra progress from these hires to 100% of the launch. "
      + 'The bell-curve analysis can still simulate values outside that figure.');
  });
});
