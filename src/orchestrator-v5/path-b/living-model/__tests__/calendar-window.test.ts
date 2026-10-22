/**
 * ⭐ A CALENDAR DEADLINE IS OLUMI'S LABELLED READING (DL 22 Oct). "By the end of March" fixes a date, so its window depends on the
 * day it is read: the AI marks it Olumi's (`period_by: 'olumi'`) and records that day (`period_read_on`); the mapper works out
 * the months from the person's words and that day by the date card's completed-month rule, and the goal keeps the deadline and
 * the day beside them. Never a month count the AI worked out, and never a window without its label. SYNTHETIC wording; the real
 * mapper, saved-graph projection, readiness and the risk window reader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { riskOccurrenceWindowMonths } from '../../../agent-lane/risk-occurrence.js';
import { completedMonthsBetween } from '../../../goal-target/deadline-date.js';
import { applyExplicitEdit } from '../edit.js';
import { createProposal } from '../../../agent-lane/proposal.js';
import { proposalPendingAction } from '../../../agent-lane/durable-proposal.js';
import { agentProposalRecord } from '../../../agent-lane/proposal-object/record.js';
import { mapLivingModel } from '../mapper.js';
import { OLUMI_CHANCE } from './track2-f2-event-risk.fixtures.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
type Target = NonNullable<LivingModelT['aims'][number]['target']>;
const READ_ON = '2026-10-22';
const CALENDAR = { by_when: 'by the end of March', period_months: null, period_by: 'olumi' as const, period_read_on: READ_ON };
const withTarget = (base: LivingModelT, target: Partial<Target>): LivingModelT => {
  const m = structuredClone(base);
  Object.assign(m.aims[0]!.target!, target);
  return m;
};
const stored = (m: LivingModelT): Rec => {
  expect(LivingModel.safeParse(m).success).toBe(true);
  return projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Rec;
};
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
/** The goal's window, wherever the mapper holds it: Olumi's target reading, or the held horizon with no scored target. */
const windowOf = (goal: Rec): unknown => goal.goal_target_basis?.period_months ?? goal.goal_horizon_months;
/** The label the reading adds: the deadline, the person's words, and the day it counts from (the living model differs by them too). */
const LABEL = ['goal_horizon', 'goal_horizon_reference_date', 'goal_deadline_as_stated'];
const unlabelled = ({ living_model: _lm, ...g }: Rec): Rec => ({ ...g,
  nodes: (g.nodes as Rec[]).map((n) => (n.kind === 'goal' ? Object.fromEntries(Object.entries(n).filter(([k]) => !LABEL.includes(k))) : n)) });

describe('a calendar deadline is read by Olumi from a recorded day, and labelled', () => {
  afterEach(() => vi.useRealTimers());

  it('"by the end of March", read on 22 Oct 2026: a 5-month window, with the deadline and the day it counts from beside it', () => {
    const g = stored(withTarget(KNOWN_ANSWER, CALENDAR));
    const goal = goalOf(g);
    expect(goal).toMatchObject({ goal_horizon: { deadline: '2027-03-31' }, goal_horizon_reference_date: READ_ON, goal_deadline_as_stated: 'by the end of March',
      goal_target_basis: { source: 'olumi_reading', period_months: 5 } });
    expect(goal.goal_threshold).toBeDefined();
    expect(riskOccurrenceWindowMonths(g)).toBe(5);
    // The date card's own arithmetic, one rule: 22 Oct → 22 Mar is 5 whole months; 31 Mar does not complete a sixth.
    expect(completedMonthsBetween(READ_ON, '2027-03-31')).toBe(5);
    expect(completedMonthsBetween('2026-10-07', '2027-04-06')).toBe(5);
    expect(completedMonthsBetween('2026-10-07', '2027-04-07')).toBe(6);
  });

  it('INVARIANCE: the reading maps exactly as the person\'s own 5-month duration, Olumi\'s risk included, apart from its label', () => {
    const risky = withTarget(OLUMI_CHANCE, {});
    risky.risks[0]!.mitigations = [];
    risky.risks[0]!.horizon_months = 18;
    const calendar = stored(withTarget(risky, CALENDAR));
    const duration = stored(withTarget(risky, { by_when: 'within 5 months', period_months: 5, period_by: null, period_read_on: null }));
    expect(riskOccurrenceWindowMonths(calendar)).toBe(5);
    expect(unlabelled(calendar)).toEqual(unlabelled(duration));
    expect(goalOf(duration).goal_horizon_reference_date).toBeUndefined();
  });

  it('the day it was read decides the window, never the clock: read on 15 Dec it is 3 months; the same model on two days maps the same', () => {
    expect(windowOf(goalOf(stored(withTarget(KNOWN_ANSWER, { ...CALENDAR, period_read_on: '2026-12-15' }))))).toBe(3);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const first = stored(withTarget(KNOWN_ANSWER, CALENDAR));
    vi.setSystemTime(new Date('2027-02-01T12:00:00Z'));
    expect(stored(withTarget(KNOWN_ANSWER, CALENDAR))).toEqual(first);
  });

  it('never the AI\'s month count for a calendar date: a figure beside Olumi\'s reading is not used, and an unlabelled one gives no window', () => {
    expect(windowOf(goalOf(stored(withTarget(KNOWN_ANSWER, { ...CALENDAR, period_months: 9 }))))).toBe(5);
    const unlabelledCount = goalOf(stored(withTarget(KNOWN_ANSWER, { by_when: 'by the end of March', period_months: 5, period_by: null, period_read_on: null })));
    expect(windowOf(unlabelledCount)).toBeUndefined();
    expect(unlabelledCount.goal_horizon_reference_date).toBeUndefined();
    // CONTRAST: the person's own duration keeps its window, as before.
    expect(windowOf(goalOf(stored(withTarget(KNOWN_ANSWER, { by_when: 'within 18 months', period_months: 18, period_by: null, period_read_on: null }))))).toBe(18);
  });

  it('NEGATIVE: no window from a day that is not a real date, words that fix no calendar date, a duration marked as a reading, or under a month', () => {
    for (const target of [
      { ...CALENDAR, period_read_on: '2026-02-30' }, { ...CALENDAR, period_read_on: '22 October 2026' }, { ...CALENDAR, period_read_on: null },
      { ...CALENDAR, by_when: 'for the next product launch' }, { ...CALENDAR, by_when: 'within 6 months' },
      { ...CALENDAR, by_when: 'by 2 November 2026' },
    ]) {
      const goal = goalOf(stored(withTarget(KNOWN_ANSWER, target)));
      expect(windowOf(goal), JSON.stringify(target)).toBeUndefined();
      expect(goal.goal_horizon_reference_date, JSON.stringify(target)).toBeUndefined();
    }
  });

  it('a relative change ("+25% by the end of March", every effect in %): its reading carries the 5-month window', () => {
    const m = withTarget(KNOWN_ANSWER, { ...CALENDAR, comparator: 'increase', value: 25, unit: '%', current: null, change_kind: 'relative', baseline: 'today' });
    m.links[0]!.effect = { ...m.links[0]!.effect, unit: '%', value: 10, sd: 2 };
    const goal = goalOf(stored(m));
    expect(goal).toMatchObject({ quantity_frame: 'change', goal_horizon_reference_date: READ_ON, goal_horizon: { deadline: '2027-03-31' },
      goal_target_basis: { quantity_frame: 'change', period_months: 5 } });
  });

  it('no scored target yet: the held window is 5 months, labelled with the deadline and the day', () => {
    const goal = goalOf(stored(withTarget(OLUMI_CHANCE, { ...CALENDAR, comparator: 'increase', value: 40000, current: null, unit: '£ per year', change_kind: 'absolute' })));
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal).toMatchObject({ goal_horizon_months: 5, goal_horizon_reference_date: READ_ON, goal_horizon: { deadline: '2027-03-31' } });
  });

  it('a canvas edit of the target keeps Olumi\'s reading and its day; a model saved before reads both as null', () => {
    const out = applyExplicitEdit(withTarget(KNOWN_ANSWER, CALENDAR), { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' });
    expect('model' in out && out.model.aims[0]!.target).toMatchObject({ value: 110, ...CALENDAR });
    const old = structuredClone(KNOWN_ANSWER) as Rec;
    delete old.aims[0].target.period_by;
    delete old.aims[0].target.period_read_on;
    expect(LivingModel.parse(old).aims[0]!.target).toMatchObject({ period_by: null, period_read_on: null });
  });

  it('a card says the reading as Olumi\'s: the day it was read, and whose the window now is', () => {
    const card = (before: Partial<Target>, after: Partial<Target>): string[] => {
      const aim = (t: Partial<Target>) => ({ id: 'a', text: 'Grow revenue', status: 'current', source: 'user', party: null, quote: 'grow revenue by the end of March',
        target: { quantity: 'revenue', comparator: '>=', value: 100, low: null, high: null, unit: '£k', by_when: 'by the end of March', period_months: null, period_by: null,
          period_read_on: null, baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null, ...t } });
      const p = createProposal({ scenario_id: 's', user_id: null, base_graph_identity_hash: 'pin', provenance: { authored_by: 'model_proposed' },
        operations: [{ op: 'living_change', path: 'aim:a', value: { change: 'change', before: aim(before), after: aim(after) } }] as never,
        validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
      const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
        { scenario_id: 's', emitted_at_iso: new Date().toISOString() });
      return (agentProposalRecord(carrier, { nodes: [], edges: [], living_model: {} })!.adds ?? []).flatMap((x) => (x.kind === 'change_note' ? [x.text] : []));
    };
    expect(card({}, { period_by: 'olumi', period_read_on: READ_ON })).toEqual(['Changes ‘Grow revenue’: target day the date was read was not stated, now “2026-10-22” '
      + '(Olumi’s estimate); target window is now Olumi’s estimate (was yours).']);
    expect(card({ period_by: 'olumi', period_read_on: READ_ON }, { by_when: 'by the end of June', period_by: 'olumi', period_read_on: '2026-11-03' }))
      .toEqual(['Changes ‘Grow revenue’: target date was “by the end of March”, now “by the end of June” (yours); target day the date was read was “2026-10-22”, '
        + 'now “2026-11-03” (Olumi’s estimate).']);
  });
});
