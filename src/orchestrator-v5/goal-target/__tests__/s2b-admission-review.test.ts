/** DL #2762 admission regressions. Structured drafter and registration are local stubs. */
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn(async () => undefined) }));
import { admitCandidateModel, type CandidateModel } from '../../agent-lane/admit-model.js';
import { buildModelFromBrief, buildCandidateSchema, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import { briefAttestsEventByDate, draftedTeamPartOf, missingEventCapacityOptionIds, teamTimeAsk, withEventShareDate } from '../event-by-date-model.js';
import * as EventModel from '../event-by-date-model.js';

type Rec = Record<string, any>;
const REF = '2026-10-07', DATE = '2027-04-07';
const BRIEF = 'We need to launch by April.';
const candidate = (): CandidateModel => ({
  goal: { kind: 'event_by_date', deliverable: 'launch', metric: 'launch', operator: '>=', unit: '% of launch',
    value: null, horizon_months: null, provenance: 'inferred' },
  options: [{ label: 'Hire two developers', provenance: 'explicit', added_capacity: {
    monthly_share_pct: 10, lead_months_low: 3, lead_months_high: 5 } },
  { label: 'Carry on', provenance: 'ai_proposed', is_status_quo: true }],
  factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [],
});
const admitted = (c = candidate(), brief = BRIEF): Rec => admitCandidateModel(c, {}, brief);
const dated = (): Rec => withEventShareDate(admitted(), DATE, REF) as Rec;
async function built(brief = BRIEF, c = candidate()): Promise<Rec> {
  return buildModelFromBrief('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', brief,
    async path => path.endsWith('/graph/register')
      ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } }
      : { status: 200, json: { graph: { nodes: [], edges: [] } } },
    async () => ({ text: JSON.stringify(c) }));
}

describe('DL #2762 admission review', () => {
  it('P1-C budget exact brief keeps £200k limit and its canonical node; control no budget', () => {
    const c = candidate();
    const a = admitted({ ...c, constraints: [{ metric: 'Budget', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit' }] },
      'Budget is £200k. We need to launch by April.');
    expect(a.goal_constraints).toContainEqual(expect.objectContaining({ value: 200000, operator: '<=', unit: 'GBP', provenance: 'explicit' }));
    expect(a.nodes.some((n: Rec) => n.id === a.goal_constraints[0].node_id)).toBe(true);
    expect(GraphV3.safeParse({ nodes: a.nodes, edges: a.edges, goal_constraints: a.goal_constraints }).success).toBe(true);
    expect(admitted().goal_constraints).toEqual([]);
  });
  it('P1-C factors risks and option settings survive; unsupported goal links have words', () => {
    const c = candidate();
    const a = admitted({ ...c,
      factors: [{ label: 'Budget', role: 'controllable', baseline_known: true, baseline_value: 150000, unit: 'GBP', provenance: 'explicit', plausible_max: 300000 }],
      risks: [{ label: 'Supplier delay', provenance: 'explicit' }],
      options: c.options.map((o, i) => i === 0 ? { ...o, interventions: [{ factor_label: 'Budget', value: 200000, unit: 'GBP', provenance: 'explicit' }] } : o),
      links: [{ from: 'Supplier delay', to: 'launch', direction: 'negative', provenance: 'explicit' }],
    }, 'Budget is £200k. Supplier delay is a risk. We need to launch by April.');
    const budget = a.nodes.find((n: Rec) => n.label === 'Budget');
    expect(budget).toBeDefined();
    expect(a.nodes.find((n: Rec) => n.id === 'event_option_1').interventions[budget.id]).toMatchObject({ raw_value: 200000, unit: 'GBP' });
    expect(a.nodes.some((n: Rec) => n.label === 'Supplier delay')).toBe(true);
    expect(a.loss.some((l: Rec) => l.reason.includes('Supplier delay') && l.reason.includes('not used'))).toBe(true);
    expect(admitted().loss).toEqual([]);
  });
  it('P1-2 rename then approve keeps both user names; control default names track date', () => {
    const g = dated(), part = draftedTeamPartOf(g)!;
    part.goal.label = 'Launch customers can trust'; part.team.label = 'Our delivery team';
    const next = withEventShareDate(g, '2027-05-07', REF) as Rec, p = draftedTeamPartOf(next)!;
    expect(p.goal.label).toBe('Launch customers can trust'); expect(p.team.label).toBe('Our delivery team');
    const defaults = draftedTeamPartOf(withEventShareDate(dated(), '2027-05-07', REF))!;
    expect(defaults.goal.label).toContain('7 May 2027'); expect(defaults.team.label).toContain('7 May 2027');
  });
  it('P1-3 outside ordinary event phrasings attest; control money target stays ordinary', () => {
    // Outside sources: REVIEW-2762.md, Lens 3 P1-3 (reviewer-supplied phrases).
    for (const text of ['On-time feature launch', 'launch the app by March 2027 with the current team', 'ship the release by 1st May']) {
      expect(briefAttestsEventByDate(text), text).toBe(true);
    }
    expect(briefAttestsEventByDate('£150k MRR by March')).toBe(false);
  });
  it('P1-3 SENT empty-model instruction is conditional; control attested event gets it', async () => {
    const sent: string[] = [];
    const call: CallStructuredModel = async body => { sent.push(body.instructions); throw new Error('local capture only'); };
    const dispatch = async () => ({ status: 200, json: {} });
    await buildModelFromBrief('a', '£150k MRR by March', dispatch, call);
    await buildModelFromBrief('a', BRIEF, dispatch, call);
    expect(sent[0]).not.toContain('leave its factors, risks, outcomes, links and identities empty');
    expect(sent[1]).toContain('leave its factors, risks, outcomes, links and identities empty');
  });
  it('P1-3 empty normal fallback is a typed redraft with words; control usable event builds', async () => {
    const c = candidate(), r = await built('Improve product quality', c);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'construction_needs_redraft' });
    expect(r.detail).toContain('draft');
    expect((await built()).ok).toBe(true);
  });
  it('P2 backwards lead refuses only that part with words; control valid estimate is retained', () => {
    const c = candidate(), bad = { ...c, options: c.options.map((o, i) => i === 0 ? { ...o, added_capacity: {
      monthly_share_pct: 10, lead_months_low: 5, lead_months_high: 3 } } : o) };
    const a = admitted(bad);
    expect(a.nodes.some((n: Rec) => n.id === 'event_goal')).toBe(true);
    expect(a.nodes.some((n: Rec) => n.id === 'event_capacity_1')).toBe(false);
    expect(a.loss.some((l: Rec) => /lead time/i.test(l.reason) && /soonest|latest/.test(l.reason))).toBe(true);
    expect(admitted().nodes.some((n: Rec) => n.id === 'event_capacity_1')).toBe(true);
  });
  it('P2 monthly share upper bound refuses only invalid capacity; control 100% is allowed', () => {
    const schema = buildCandidateSchema() as Rec;
    expect(schema.properties.options.items.properties.added_capacity.anyOf[1].properties.monthly_share_pct.maximum).toBe(100);
    const c = candidate(), replace = (n: number) => ({ ...c, options: c.options.map((o, i) => i === 0 ? { ...o,
      added_capacity: { monthly_share_pct: n, lead_months_low: 3, lead_months_high: 5 } } : o) });
    expect(admitted(replace(101)).nodes.some((n: Rec) => n.id === 'event_capacity_1')).toBe(false);
    expect(admitted(replace(100)).nodes.some((n: Rec) => n.id === 'event_capacity_1')).toBe(true);
  });
  it('P2 Cut scope needs no start gap; control unresolved hiring needs start', () => {
    const c = candidate(), g = admitted({ ...c, options: [...c.options, { label: 'Cut scope', provenance: 'explicit' }] });
    expect(missingEventCapacityOptionIds(g)).toEqual([]);
    expect(EventModel.unresolvedEventOptionIds(g)).toContain('event_option_3');
    const hiring = admitted({ ...c, options: [{ label: 'Hire a contractor', provenance: 'explicit' }, c.options[1]!] });
    expect(missingEventCapacityOptionIds(hiring)).toEqual(['event_option_1']);
  });
  it('P2 options added after drafting are unresolved; control recorded options stay resolved', () => {
    const g = admitted();
    g.nodes.push({ id: 'later_hire', kind: 'option', label: 'Hire a contractor', interventions: {} });
    expect(missingEventCapacityOptionIds(g)).toContain('later_hire');
    g.nodes.push({ id: 'later_scope', kind: 'option', label: 'Reduce scope', interventions: {} });
    expect(EventModel.unresolvedEventOptionIds(g)).toContain('later_scope');
    expect(missingEventCapacityOptionIds(g)).not.toContain('later_scope');
    expect(missingEventCapacityOptionIds(admitted())).toEqual([]);
  });
  it('P2 empty stored graph can be redrafted; control a nonempty graph is protected', async () => {
    expect((await built()).ok).toBe(true);
    const r = await buildModelFromBrief('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', BRIEF,
      async () => ({ status: 200, json: { graph: { nodes: [{ id: 'user_node', kind: 'factor', label: 'User work' }], edges: [] } } }),
      async () => ({ text: JSON.stringify(candidate()) }));
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'model_already_exists' });
  });
  it('S1 most-likely time asks the ruled range and date refresh preserves it; control no time', () => {
    const g = dated();
    EventModel.eventShareCarrierOf(g)!.provenance.share_by_date.stated_time = { quantity: 'months_to_finish', most_likely: 6, unit: 'months', deadline: DATE, reference_date: REF };
    expect(teamTimeAsk(g)).toBe('Roughly how long could it take at the soonest, and at the latest, with the team you have now?');
    const updated = draftedTeamPartOf(withEventShareDate(g, '2027-05-07', REF))!;
    expect(EventModel.eventShareCarrierOf(withEventShareDate(g, '2027-05-07', REF))!.provenance.share_by_date.stated_time)
      .toMatchObject({ most_likely: 6, deadline: '2027-05-07' });
    expect(updated.team.observed_state?.value).toBeUndefined();
    expect(teamTimeAsk(dated())).toBe('How long would launch take with the team you have now?');
  });
});
