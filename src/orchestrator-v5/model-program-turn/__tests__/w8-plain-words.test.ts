/**
 * W8 (acceptance check 7, "what Olumi says", judged as the person reads it): the host's own words on the reading card, the
 * Analysis tab and the canvas's provenance, each family on its real producer (readingOf, evaluateCanonical, project). A
 * synthetic repair shop, never a brief's or journey's words. Each row is RED with its producer's change reverted.
 */
import { describe, expect, it } from 'vitest';
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { compile } from '../../model-program/compile.js';
import { project } from '../../model-program/project.js';
import { evaluateCanonical } from '../evaluate.js';
import { readingOf } from '../postimage.js';
import { PROGRAM_TURN_FACTS_PREFIX, programTurnFacts } from '../program-tools.js';
import { programInstructions } from '../../core-route/instructions.js';
import { readingGroups } from '../reading-groups.js';
import { at, q } from './bakery.fixture.js';

type Json = Record<string, any>;
const BRIEF = 'We fix 60 jobs a week and want to reach 75 jobs a week. Each mechanic does 10 to 20 jobs a week. We could hire one mechanic, or keep the team as it is. We charge £20 per customer per month.';

function shop(): CanonicalModelT {
  return {
    version: 'canonical.v1', question: 'Should the shop hire a mechanic?', period: 'week',
    quantities: [
      q('jobs_now', 'job/week', { value: 60, quote: 'We fix 60 jobs a week' }),
      q('extra_mechanics', 'mechanic', { value: 0, author: 'structure', basis: 'Zero is no extra mechanic; the options set it.' }),
      q('per_mechanic', 'job/week/mechanic', { kind: 'coefficient', value: 15, low: 10, high: 20, range_kind: 'bounds', floor: 0, quote: 'Each mechanic does 10 to 20 jobs a week' }),
      q('extra_jobs', 'job/week', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('total_jobs', 'job/week', { kind: 'derived', status: 'derived', author: 'olumi' }),
      q('target', 'job/week', { value: 75, quote: 'want to reach 75 jobs a week' }),
      q('fee', 'GBP/customer/month', { value: 20, quote: 'We charge £20 per customer per month' }),
    ],
    relations: [
      { form: 'definition', id: 'extra_rel', defines: 'extra_jobs', op: 'product', parts: [{ id: 'extra_mechanics', power: 1 }, { id: 'per_mechanic', power: 1 }], author: 'olumi', quote: null, ...at },
      { form: 'definition', id: 'total_rel', defines: 'total_jobs', op: 'sum', parts: [{ id: 'jobs_now', sign: 1 }, { id: 'extra_jobs', sign: 1 }], author: 'olumi', quote: null, ...at },
    ],
    goals: [{ id: 'reach_75', label: 'Reach 75 jobs a week', measure: { quantity: 'total_jobs', per: null, cmp: '>=', target: 'target', frame: 'level', reference: null, aggregation: 'end',
      window: null, measure_by: 'person', assumptions: [], exclusions: [] }, question: null, author: 'person', quote: 'want to reach 75 jobs a week', ...at }],
    limits: [], preferences: [],
    options: [
      { id: 'hire', label: 'Hire one mechanic', sets: [{ quantity: 'extra_mechanics', to: null, value: 1, low: null, high: null, range_kind: null, question: null, starts_after_periods: 0,
        author: 'person', quote: 'We could hire one mechanic' }], status: 'live', developed_from: null, carry_on: false, author: 'person', quote: 'We could hire one mechanic', ...at },
      { id: 'keep', label: 'Keep the team', sets: [], status: 'live', developed_from: null, carry_on: true, author: 'person', quote: 'keep the team as it is', ...at },
    ],
    risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
    title: null, coaching_questions: [], decide_by: null,
  } as CanonicalModelT;
}
const card = () => {
  const v = readingOf(shop(), { words: [BRIEF], approver: null });
  if (!v.ok) throw new Error(JSON.stringify(v));
  return v.changes;
};
const after = (id: string) => card().find((c) => c.id === id)?.after;
const view = () => evaluateCanonical(shop(), { sourceText: BRIEF, seed: 7, draws: 2000 }).view as Json;
const cellOf = (v: Json, id: string) => (v.options as Json[]).find((o) => o.option_id === id)!;
const count = (text: string, part: string) => text.split(part).length - 1;

describe('W8 c7: the words a person reads, at their producers', () => {
  it('card, c7.7: an option says what it changes, once, never "compared, sets X 0 to Option: X 1"; its own setting is no second line', () => {
    expect(after('hire')).toBe('sets "extra mechanics" to 1 mechanic from the start, in your words "We could hire one mechanic"');
    // Paul 28 Oct (remove the false host phrases): an option with no settings is NOT said to carry on as now; its own words say it.
    expect(after('keep')).toBe('carries on as now, in your words "keep the team as it is"');
    // The option's own setting (compile.ts `normalise`: "Hire one mechanic: extra mechanics") is said on the option's line.
    expect(card().filter((c) => c.label.includes(': '))).toEqual([]);
    expect(card().some((c) => c.id === 'hire__extra_mechanics')).toBe(false);
  });

  it('card, W8 run 3 (no reading card: unshown_change on sets.0.to): an option whose own setting has no figure shows on the card, saying its status; an asked one\'s question is said once, on its own row', () => {
    // Olumi's option sets a figure to its OWN setting (`inlineQuantityId`), which has no figure.
    const m = shop();
    const card = (status: 'asked' | 'unknown' | 'not_applicable' | 'unsupported') => {
      const own = q('share__extra_mechanics', 'mechanic', { author: 'olumi', status, question: status === 'asked' ? 'How many mechanics could you share with the other branch?' : null });
      const share = { ...m.options[0]!, id: 'share', label: 'Share a mechanic', author: 'olumi' as const, quote: null, developed_from: null,
        sets: [{ ...m.options[0]!.sets[0]!, to: 'share__extra_mechanics', value: null, author: 'olumi' as const, quote: null }] };
      const v = readingOf({ ...m, quantities: [...m.quantities, own], options: [...m.options, share] } as CanonicalModelT, { words: [BRIEF], approver: null });
      if (!v.ok) throw new Error(`${v.code} ${JSON.stringify(v.ids)}`);
      return v.changes;
    };
    const line = (status: Parameters<typeof card>[0]) => card(status).find((c) => c.id === 'share')?.after;
    expect(line('asked')).toBe('sets "extra mechanics" to a figure still to be given (in mechanics) from the start');
    expect(line('unknown')).toBe('sets "extra mechanics" to a figure not known yet (in mechanics) from the start');
    expect(line('not_applicable')).toBe('sets "extra mechanics" to no figure, as it does not apply (in mechanics) from the start');
    expect(line('unsupported')).toBe('sets "extra mechanics" to no figure the model can use (in mechanics) from the start');
    // Asked, it keeps its own row (`foldedInto`), which asks the question; the option's line does not ask it again.
    expect(card('asked').filter((c) => (c.after ?? '').includes('How many mechanics could you share')).map((c) => c.id)).toEqual(['share__extra_mechanics']);
  });

  it('reply, W8 run 3: the first reply\'s facts hold a reading card only when the turn holds one, and the reply names a card only when the state holds it', () => {
    // prompts-v2 (29 Oct, INTEGRATION §5): the turn's guidance is facts only; the rule is the program instructions', said once.
    const facts = (readingCard: boolean) => JSON.parse(programTurnFacts('first_model', { awaiting_approval: readingCard ? [{ proposal_id: 'p1', reading: true }] : [] }, { readingCard })
      .slice(PROGRAM_TURN_FACTS_PREFIX.length)) as Record<string, unknown>;
    expect(facts(true)).toEqual({ trigger: 'first_model', reading_card: true, held_proposals: ['p1'] });
    expect(facts(false)).toEqual({ trigger: 'first_model', reading_card: false, held_proposals: [] });
    expect(programInstructions().split('Refer to a reading or change card only when the supplied state actually holds it.')).toHaveLength(2);
  });

  it('card, c7.1 and c7.7: a worked-out figure is one line with its relation, said as a short sentence by name, never "X is Y 0 multiplied by Z"', () => {
    const labels = card().map((c) => c.label);
    expect(labels.filter((l) => l === 'total jobs')).toHaveLength(1);
    expect(labels.filter((l) => l === 'extra jobs')).toHaveLength(1);
    // Acceptance 29 Oct (c7.7: "worked out as "X" multiplied by "Y"" read as a filled template): the sum or product itself.
    expect(after('total_rel')).toBe('"jobs now" plus "extra jobs", in jobs per week');
    expect(after('extra_rel')).toBe('"extra mechanics" times "per mechanic", in jobs per week');
    expect(card().map((c) => c.after ?? '').join(' ')).not.toMatch(/worked out as|multiplied by/);
    // The first reply's counts read the same map, so a folded figure is counted once, as its line.
    expect(readingGroups(shop(), () => true).has('total_jobs')).toBe(false);
  });

  it('card, c7.3: a unit as a person writes it, never unit algebra', () => {
    expect(after('per_mechanic')).toBe('from 10 to 20 jobs per mechanic per week, most likely 15 (firm ends) (never below 0: Olumi’s reading), in your words "Each mechanic does 10 to 20 jobs a week"');
    expect(after('fee')).toBe('£20 per customer per month, in your words "We charge £20 per customer per month"');
    expect(card().map((c) => c.after ?? '').join(' ')).not.toMatch(/\b[a-z]+\/[a-z]+|GBP\//);
  });

  it('card, c7.3: no classification tag on a whole figure ("a fact, known", "a result, worked out from the model"); structure said plainly', () => {
    const said = card().map((c) => c.after ?? '').join(' | ');
    expect(said).not.toMatch(/\ba (fact|rate|result)\b|\bknown\b|worked out from the model|fixed part of the model’s structure|\bcompared\b/);
    expect(after('extra_mechanics')).toBe('0 mechanics, based on "Zero is no extra mechanic; the options set it.", part of how the model is set up');
    expect(after('jobs_now')).toBe('60 jobs per week, in your words "We fix 60 jobs a week"');
  });

  it('analysis, c7.6: the settings tested are explained beside the overall chance, so 0% / 100% / 100% beside about 50% reads as agreeing', () => {
    const v = view(), hire = cellOf(v, 'hire');
    expect(hire.main_driver.kind).toBe('available');
    expect(hire.main_driver.detail).toContain('With ‘per mechanic’ held at its low end (10 jobs per mechanic per week), the chance is ');
    expect(hire.main_driver.detail).toContain(`Each of these holds ‘per mechanic’ at one value. The overall chance, ${hire.cell.display}, allows for every value it can take.`);
    // The leader names what it is most sensitive to, and never repeats the settings.
    expect(v.leader.words).toContain('Its chance is most sensitive to ‘per mechanic’ (your range).');
    expect(v.leader.words).not.toMatch(/at its (low end|middle|high end)/);
  });

  it('analysis, c7.1: a range\'s reading ("values near its middle are likelier …") is said once in the whole view', () => {
    const text = JSON.stringify(view());
    expect(count(text, 'values near its middle are likelier than values near its ends')).toBe(1);
    // Acceptance 29 Oct (c7.1: the same assumption under every option): the range both chances rest on is named once, beside
    // the chances, for each option; neither option's own line says it again.
    const reading = '‘per mechanic’ follows Olumi’s provisional reading of your range, 10 to 20 jobs per mechanic per week';
    expect(count(text, reading)).toBe(1);
    expect((view().goal_chance.notes as string[]).filter((n) => n.includes(`Each assumes ${reading}`))).toHaveLength(1);
    for (const id of ['hire', 'keep']) expect(cellOf(view(), id).cell.face).not.toContain(reading);
  });

  it('analysis, c7.2 and c7.3: a chance, then what it rests on, one point per sentence, in plain words', () => {
    const v = view(), keep = cellOf(v, 'keep').cell.face as string, hire = cellOf(v, 'hire').cell.face as string;
    // Acceptance 29 Oct (c7.1): what both chances rest on alike is said once, beside the chances, one point per sentence.
    expect(hire).toBe(`‘Hire one mechanic’: ${cellOf(v, 'hire').cell.display} chance of ‘total jobs’ being at least 75 jobs per week, in this model.`);
    const shared = (v.goal_chance.notes as string[]).filter((n) => n.startsWith('Each option’s chance rests'));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.startsWith('Each option’s chance rests on Olumi’s reading of your figures (not yet confirmed). Each assumes ‘per mechanic’ follows')).toBe(true);
    expect(count(JSON.stringify(v), 'Olumi’s reading of your figures (not yet confirmed)')).toBe(1);
    expect(keep).toContain('Whatever the uncertain figures turn out to be, ‘total jobs’ is 60 jobs per week, below 75 jobs per week.');
    for (const face of [hire, keep, v.leader.words as string]) expect(face).not.toMatch(/with each option in effect|simulated draw| \/ |, if /);
    expect(v.leader.words).toContain('the next most likely. It rests on the same reading and assumption as each option’s chance.');
  });

  it('canvas provenance (DL, served 1c16eb41): a figure Olumi asks of the person, with no words of theirs, claims no origin: not "From your brief", not Olumi\'s', () => {
    const m = shop();
    m.quantities.push(q('parts_delay', 'job/week', { status: 'asked', question: 'How many jobs a week wait on parts?' }),
      q('weekend_jobs', 'job/week', { value: 5, quote: 'about 5 at weekends' }));
    const total = m.relations.find((r) => r.id === 'total_rel');
    if (total?.form === 'definition' && total.op === 'sum') total.parts.push({ id: 'parts_delay', sign: -1 }, { id: 'weekend_jobs', sign: 1 });
    const nodes = project(m, compile(m), { brief: BRIEF }).graph.nodes as Json[];
    const provenance = (id: string) => nodes.find((n) => n.id === id)!.provenance;
    expect(provenance('parts_delay')).toBeUndefined();
    // Contrasts: their brief's figure stays from the brief; a figure they gave later stays theirs as added.
    expect(provenance('jobs_now')).toBe('from_brief');
    expect(provenance('weekend_jobs')).toBe('user_set');
  });
});
