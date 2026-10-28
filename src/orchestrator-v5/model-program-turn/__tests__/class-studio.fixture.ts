/**
 * THE SYNTHETIC CLASS STUDIO (Box 1a, Q1 28 Oct; never a test brief's words): one numeric path (classes × fee → takings, a
 * measured aim every option is compared on), two links in words (evening classes → how members feel → members), one risk no
 * one can size (the instructor leaving, on the members aim), an unmeasured factor (how members feel: unit null, unknown) and
 * the declared carry-on option.
 */
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { at, q } from './bakery.fixture.js';

export const STUDIO_BRIEF = 'Our studio teaches 200 classes a month at £12 a class and has 150 members. We want to take £2,600 a month and keep at least 140 members. '
  + 'We could add evening classes, which would add 40 classes a month, or carry on as now. Members have asked for evening slots.';
const MOOD_BASIS = 'No one can measure how members feel yet; repeat bookings might show it.';
const noFigure = { to: null, value: null, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0 } as const;

export function studio(): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'Should the studio add evening classes?', title: 'Evening classes or carry on?', period: 'month',
    quantities: [
      q('class_fee', 'GBP/class', { value: 12, quote: '£12 a class' }),
      q('classes_now', 'class/month', { value: 200, quote: 'teaches 200 classes a month' }),
      q('extra_classes', 'class/month', { value: 0, author: 'structure', basis: 'No extra classes when nothing changes.' }),
      q('evening_extra', 'class/month', { value: 40, quote: 'would add 40 classes a month' }),
      q('workshop_extra', 'class/month', { value: 20, author: 'olumi', basis: 'Olumi\'s proposed size for weekend workshops.' }),
      q('classes', 'class/month', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('takings', 'GBP/month', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('takings_target', 'GBP/month', { value: 2600, quote: 'take £2,600 a month' }),
      q('members', 'member', { value: 150, quote: 'has 150 members' }),
      q('members_target', 'member', { value: 140, quote: 'keep at least 140 members' }),
      q('member_mood', null, { label: 'How members feel', status: 'unknown', author: 'olumi', basis: MOOD_BASIS }),
    ],
    relations: [
      { form: 'definition', id: 'classes_rel', defines: 'classes', op: 'sum', parts: [{ id: 'classes_now', sign: 1 }, { id: 'extra_classes', sign: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'takings_rel', defines: 'takings', op: 'product', parts: [{ id: 'classes', power: 1 }, { id: 'class_fee', power: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'influence', id: 'evening_mood', from: 'evening_classes', to: 'member_mood', direction: 'up', confidence: 'likely', basis: 'Members have asked for evening slots.',
        author: 'person', quote: 'Members have asked for evening slots', ...at },
      { form: 'influence', id: 'mood_members', from: 'member_mood', to: 'members', direction: 'conditional', confidence: 'unsure', basis: 'Happier members stay only if the classes suit them.',
        author: 'olumi', quote: null, ...at },
    ],
    goals: [
      { id: 'takings_goal', label: 'Take £2,600 a month', measure: { quantity: 'takings', per: null, cmp: '>=', target: 'takings_target', frame: 'level', reference: null, aggregation: 'end',
        window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'We want to take £2,600 a month', ...at },
      { id: 'keep_members', label: 'Keep at least 140 members', measure: { quantity: 'members', per: null, cmp: '>=', target: 'members_target', frame: 'level', reference: null, aggregation: 'end',
        window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'keep at least 140 members', ...at },
    ],
    limits: [], preferences: [],
    options: [
      { id: 'evening_classes', label: 'Evening classes', sets: [{ ...noFigure, quantity: 'extra_classes', to: 'evening_extra', author: 'person', quote: 'add evening classes' }],
        status: 'live', developed_from: null, carry_on: false, author: 'person', quote: 'add evening classes', ...at },
      { id: 'weekend_workshops', label: 'Weekend workshops', sets: [{ ...noFigure, quantity: 'extra_classes', to: 'workshop_extra', author: 'olumi', quote: null }],
        status: 'live', developed_from: null, carry_on: false, author: 'olumi', quote: null, ...at },
      { id: 'carry_on', label: 'Carry on as now', sets: [], status: 'live', developed_from: null, carry_on: true, author: 'person', quote: 'carry on as now', ...at },
    ],
    risks: [{ id: 'instructor_leaves', label: 'The instructor leaves', occurrence: null, severity: null, effect_on: 'keep_members', direction: 'down', mode: null,
      starts_after_periods: 0, author: 'olumi', quote: null, ...at }],
    claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], coaching_questions: [], history: [],
  };
}
