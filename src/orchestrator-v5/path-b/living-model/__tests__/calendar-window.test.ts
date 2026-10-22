/**
 * ⭐ A CALENDAR DEADLINE IS OLUMI'S LABELLED READING (DL 22 Oct; Codex r1 on #3674). "By the end of September" fixes a date, so
 * its window depends on the day it is read: the AI reads the date (`period_deadline`, marked `period_by: 'olumi'`), the host
 * records the day (`period_read_on`, `withCalendarReadings`), and the mapper works out the whole calendar months between them;
 * the goal keeps the deadline and the day beside the window. Never a month count the AI worked out, never the clock, no date
 * parser. SYNTHETIC wording; the real mapper, saved-graph projection, risk window reader, change tool and card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { riskOccurrenceWindowMonths } from '../../../agent-lane/risk-occurrence.js';
import { wholeMonthsBetween } from '../../../goal-target/deadline-date.js';
import { applyExplicitEdit } from '../edit.js';
import { withCalendarReadings } from '../calendar-reading.js';
import { createProposal } from '../../../agent-lane/proposal.js';
import { proposalPendingAction } from '../../../agent-lane/durable-proposal.js';
import { agentProposalRecord } from '../../../agent-lane/proposal-object/record.js';
import { mapLivingModel } from '../mapper.js';
import { OLUMI_CHANCE } from './track2-f2-event-risk.fixtures.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
type Target = NonNullable<LivingModelT['aims'][number]['target']>;
const READ_ON = '2026-10-22';
const CALENDAR = { by_when: 'by the end of September', period_months: null, period_by: 'olumi' as const, period_deadline: '2027-09-30', period_read_on: READ_ON };
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

describe('a calendar deadline is Olumi\'s reading, from a recorded day, and labelled', () => {
  afterEach(() => vi.useRealTimers());

  it('"by the end of September", read on 22 Oct 2026 as 30 Sep 2027: an 11-month window, with the deadline and the day beside it', () => {
    const g = stored(withTarget(KNOWN_ANSWER, CALENDAR));
    const goal = goalOf(g);
    expect(goal).toMatchObject({ goal_horizon: { deadline: '2027-09-30' }, goal_horizon_reference_date: READ_ON, goal_deadline_as_stated: 'by the end of September',
      goal_target_basis: { source: 'olumi_reading', period_months: 11 } });
    expect(goal.goal_threshold).toBeDefined();
    expect(riskOccurrenceWindowMonths(g)).toBe(11);
  });

  it('Codex r1: whole calendar months as a month-end date counts them (31 Aug to 28 Feb is 6; 31 Jan to 28 Feb is 1); a stated day is the AI\'s reading, never dropped', () => {
    expect(wholeMonthsBetween('2026-08-31', '2027-02-28')).toBe(6);
    expect(wholeMonthsBetween('2027-01-31', '2027-02-28')).toBe(1);
    expect(wholeMonthsBetween(READ_ON, '2027-03-31')).toBe(5);
    expect(windowOf(goalOf(stored(withTarget(KNOWN_ANSWER, { ...CALENDAR, period_read_on: '2026-08-31', period_deadline: '2027-02-28' }))))).toBe(6);
    // "By 15 June next year", read on 22 Oct 2026: the AI's reading is 15 June 2027, so 7 whole months, never the month's end.
    const june = goalOf(stored(withTarget(KNOWN_ANSWER, { ...CALENDAR, by_when: 'by 15 June next year', period_deadline: '2027-06-15' })));
    expect(june).toMatchObject({ goal_horizon: { deadline: '2027-06-15' }, goal_target_basis: { period_months: 7 } });
  });

  it('INVARIANCE: the reading maps exactly as the person\'s own 11-month duration, Olumi\'s risk included, apart from its label', () => {
    const risky = withTarget(OLUMI_CHANCE, {});
    risky.risks[0]!.mitigations = [];
    risky.risks[0]!.horizon_months = 18;
    const calendar = stored(withTarget(risky, CALENDAR));
    const duration = stored(withTarget(risky, { by_when: 'within 11 months', period_months: 11, period_by: null, period_deadline: null, period_read_on: null }));
    expect(riskOccurrenceWindowMonths(calendar)).toBe(11);
    expect(unlabelled(calendar)).toEqual(unlabelled(duration));
    expect(goalOf(duration).goal_horizon_reference_date).toBeUndefined();
  });

  it('the day it was read decides the window, never the clock; the person\'s own duration keeps its window, whatever words sit beside it (Codex r1)', () => {
    expect(windowOf(goalOf(stored(withTarget(KNOWN_ANSWER, { ...CALENDAR, period_read_on: '2027-01-15' }))))).toBe(8);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const first = stored(withTarget(KNOWN_ANSWER, CALENDAR));
    vi.setSystemTime(new Date('2027-02-01T12:00:00Z'));
    expect(stored(withTarget(KNOWN_ANSWER, CALENDAR))).toEqual(first);
    expect(windowOf(goalOf(stored(withTarget(KNOWN_ANSWER, { by_when: 'within 6 months ending March 2027', period_months: 6, period_by: null, period_deadline: null, period_read_on: null }))))).toBe(6);
  });

  it('NEGATIVE: no window from a date or day that is not real, a deadline not after its day, no day, or under a month', () => {
    for (const target of [
      { ...CALENDAR, period_deadline: '2027-02-30' }, { ...CALENDAR, period_read_on: '22 October 2026' }, { ...CALENDAR, period_read_on: null },
      { ...CALENDAR, period_deadline: null }, { ...CALENDAR, period_deadline: READ_ON }, { ...CALENDAR, period_deadline: '2026-11-02' },
    ]) {
      const goal = goalOf(stored(withTarget(KNOWN_ANSWER, target)));
      expect(windowOf(goal), JSON.stringify(target)).toBeUndefined();
      expect(goal.goal_horizon_reference_date, JSON.stringify(target)).toBeUndefined();
    }
  });

  it('a relative change ("+25% by the end of September", every effect in %): its reading carries the 11-month window', () => {
    const m = withTarget(KNOWN_ANSWER, { ...CALENDAR, comparator: 'increase', value: 25, unit: '%', current: null, change_kind: 'relative', baseline: 'today' });
    m.links[0]!.effect = { ...m.links[0]!.effect, unit: '%', value: 10, sd: 2 };
    expect(goalOf(stored(m))).toMatchObject({ quantity_frame: 'change', goal_horizon_reference_date: READ_ON, goal_horizon: { deadline: '2027-09-30' },
      goal_target_basis: { quantity_frame: 'change', period_months: 11 } });
  });

  it('no scored target yet: the held window is 11 months, labelled with the deadline and the day', () => {
    const goal = goalOf(stored(withTarget(OLUMI_CHANCE, { ...CALENDAR, comparator: 'increase', value: 40000, current: null, unit: '£ per year', change_kind: 'absolute' })));
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal).toMatchObject({ goal_horizon_months: 11, goal_horizon_reference_date: READ_ON, goal_horizon: { deadline: '2027-09-30' } });
  });
});

describe('Codex r1 on #3674: the host records the day, keeps a saved reading while its words stand, and drops a count beside it', () => {
  const TODAY = '2026-11-03';
  const targetOf = (m: LivingModelT) => m.aims[0]!.target!;

  it('a new reading gets the host\'s day, never the AI\'s (a future one would move the window); a count beside it is dropped', () => {
    const sent = withTarget(KNOWN_ANSWER, { ...CALENDAR, period_read_on: '2031-01-01', period_months: 9 });
    expect(targetOf(withCalendarReadings(sent, undefined, TODAY))).toMatchObject({ period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: TODAY, period_months: null });
  });

  it('a saved reading stands while its words do: another day, a cleared reading or a count the AI sent never replace it; new words are a new reading', () => {
    const saved = withTarget(KNOWN_ANSWER, CALENDAR);
    for (const sent of [{ ...CALENDAR, period_read_on: '2026-11-01' }, { ...CALENDAR, period_by: null, period_deadline: null, period_read_on: null },
      { ...CALENDAR, period_by: null, period_deadline: null, period_read_on: null, period_months: 4 }, { ...CALENDAR, by_when: 'By the end of  September' }]) {
      expect(targetOf(withCalendarReadings(withTarget(KNOWN_ANSWER, sent), saved, TODAY)), JSON.stringify(sent))
        .toMatchObject({ period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: READ_ON, period_months: null });
    }
    expect(targetOf(withCalendarReadings(withTarget(KNOWN_ANSWER, { ...CALENDAR, by_when: 'by the end of October', period_deadline: '2027-10-31' }), saved, TODAY)))
      .toMatchObject({ period_deadline: '2027-10-31', period_read_on: TODAY });
    // CONTRAST: the person's own duration is untouched, and a stray day or date without a reading is dropped.
    const duration = withTarget(KNOWN_ANSWER, { by_when: 'within 6 months', period_months: 6, period_by: null, period_deadline: '2027-01-01', period_read_on: '2026-01-01' });
    expect(targetOf(withCalendarReadings(duration, undefined, TODAY))).toMatchObject({ period_months: 6, period_by: null, period_deadline: null, period_read_on: null });
  });

  it('a canvas edit of the target keeps Olumi\'s reading, its date and its day; a model saved before reads all three as null', () => {
    const out = applyExplicitEdit(withTarget(KNOWN_ANSWER, CALENDAR), { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' });
    expect('model' in out && out.model.aims[0]!.target).toMatchObject({ value: 110, ...CALENDAR });
    const old = structuredClone(KNOWN_ANSWER) as Rec;
    for (const k of ['period_by', 'period_deadline', 'period_read_on']) delete old.aims[0].target[k];
    expect(LivingModel.parse(old).aims[0]!.target).toMatchObject({ period_by: null, period_deadline: null, period_read_on: null });
  });

  it('a card says the reading as Olumi\'s: the date read, the day, and whose the window now is; no count shows as the person\'s', () => {
    const card = (before: Partial<Target>, after: Partial<Target>): string[] => {
      const aim = (t: Partial<Target>) => ({ id: 'a', text: 'Grow revenue', status: 'current', source: 'user', party: null, quote: 'grow revenue by the end of September',
        target: { quantity: 'revenue', comparator: '>=', value: 100, low: null, high: null, unit: '£k', by_when: 'by the end of September', period_months: null, period_by: null,
          period_deadline: null, period_read_on: null, baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null, ...t } });
      const p = createProposal({ scenario_id: 's', user_id: null, base_graph_identity_hash: 'pin', provenance: { authored_by: 'model_proposed' },
        operations: [{ op: 'living_change', path: 'aim:a', value: { change: 'change', before: aim(before), after: aim(after) } }] as never,
        validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
      const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
        { scenario_id: 's', emitted_at_iso: new Date().toISOString() });
      return (agentProposalRecord(carrier, { nodes: [], edges: [], living_model: {} })!.adds ?? []).flatMap((x) => (x.kind === 'change_note' ? [x.text] : []));
    };
    const [text] = card({}, { period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: READ_ON });
    expect(text).toBe('Changes ‘Grow revenue’: target date Olumi read was not stated, now “2027-09-30”; target day the date was read was not stated, '
      + 'now “2026-10-22” (Olumi’s estimate); target window is now Olumi’s estimate (was yours).');
  });
});
