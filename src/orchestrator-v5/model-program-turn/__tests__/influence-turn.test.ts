/**
 * Box 1a on the turn path (Paul's Q1, 28 Oct): the card shows every field of a link in words, a risk no one can size, a
 * declared carry-on and an unmeasured factor; the reading groups count them; an update adds, changes and removes a link by
 * id; the store reads them back; the result names what it waits on by the records' own labels; and a model saved before
 * them opens, compiles and draws as before, its bytes and its Run untouched. Synthetic studio and bakery only; every
 * expectation is written by hand from the fixtures.
 */
import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import type { CanonicalModelT } from '../../model-program/canonical.js';
import { compile } from '../../model-program/compile.js';
import { project } from '../../model-program/project.js';
import { mergeUpdate } from '../draft.js';
import { countStatedTime } from '../stated-time.js';
import { CanonicalUpdate, UPDATE_JSON_SCHEMA } from '../prompt.js';
import { evaluateCanonical } from '../evaluate.js';
import { readingOf, validatePostimage, verbatimIn } from '../postimage.js';
import { livingModelOf, MODEL_PROGRAM, programReadOf, reopenProgram } from '../program-store.js';
import { readingGroups, readingLine } from '../reading-groups.js';
import { ENGINE_VERSIONS, revisionDigest, type StoredRun } from '../run-receipt.js';
import { at, bakery, BRIEF, q } from './bakery.fixture.js';
import { studio, STUDIO_BRIEF } from './class-studio.fixture.js';

type Rec = Record<string, any>;
const WORDS = [STUDIO_BRIEF];
const MOOD_BASIS = 'No one can measure how members feel yet; repeat bookings might show it.';

describe('Box 1a: the card, the counts, the update and the store', () => {
  it('the reading card says every new field in the records\' own words, titles each link by what it joins, and refuses nothing', () => {
    const r = readingOf(studio(), { words: WORDS, approver: null });
    expect(r.ok).toBe(true);
    const rows = new Map((r.ok ? r.changes : []).map((c) => [c.id, c] as const));
    const row = (id: string) => { const c = rows.get(id)!; return [c.label, c.after]; };
    expect(row('evening_mood')).toEqual(['Evening classes → How members feel',
      '"Evening classes" ↑ raises "How members feel", judged likely, based on "Members have asked for evening slots.", in your words "Members have asked for evening slots"']);
    expect(row('mood_members')).toEqual(['How members feel → members',
      '"How members feel" affects "members", depending on conditions, judged unsure, based on "Happier members stay only if the classes suit them."']);
    expect(row('instructor_leaves')).toEqual(['The instructor leaves', 'with a chance not known yet, affecting "Keep at least 140 members", by a size not known yet, ↓ lowering it, from the start']);
    expect(row('carry_on')).toEqual(['Carry on as now', 'carries on as now, in your words "carry on as now"']);
    expect(row('member_mood')).toEqual(['How members feel', `not known yet, not measured, based on "${MOOD_BASIS}"`]);
    // An option that declares no carry-on says nothing of one (false is no claim).
    expect(rows.get('evening_classes')!.after).not.toMatch(/carries on/);
    expect(JSON.stringify(r)).not.toMatch(/undefined/);
  });

  it('every new field, changed alone, is said before and after (no unshown change)', () => {
    const one = (mutate: (m: CanonicalModelT) => void) => { const m = studio(); mutate(m); return m; };
    const link = (m: CanonicalModelT, id: string) => m.relations.find((x) => x.id === id) as Rec;
    const cases: [string, string, (m: CanonicalModelT) => void][] = [
      ['link from', 'evening_mood', (m) => { link(m, 'evening_mood').from = 'weekend_workshops'; }],
      ['link to', 'evening_mood', (m) => { link(m, 'evening_mood').to = 'members'; }],
      ['link direction', 'evening_mood', (m) => { link(m, 'evening_mood').direction = 'disputed'; }],
      ['link confidence', 'evening_mood', (m) => { link(m, 'evening_mood').confidence = 'unknown'; }],
      ['link basis', 'evening_mood', (m) => { link(m, 'evening_mood').basis = null; }],
      ['risk chance', 'instructor_leaves', (m) => { m.risks[0]!.occurrence = 'members'; }],
      ['risk size', 'instructor_leaves', (m) => { m.risks[0]!.severity = 'members'; }],
      ['risk on', 'instructor_leaves', (m) => { m.risks[0]!.effect_on = 'members'; }],
      ['risk direction', 'instructor_leaves', (m) => { m.risks[0]!.direction = 'up'; }],
      ['risk mode', 'instructor_leaves', (m) => { m.risks[0]!.mode = 'add'; }],
      ['carry-on withdrawn', 'carry_on', (m) => { m.options[2]!.carry_on = false; }],
      ['carry-on declared', 'evening_classes', (m) => { m.options[0]!.carry_on = true; }],
      ['unit null', 'members', (m) => { m.quantities.find((x) => x.id === 'members')!.unit = null; }],
      // TIME-AND-DECIDE-BY (29 Oct): when they must decide is its own card row.
      ['decide-by', 'decide_by', (m) => { m.decide_by = { date: '2026-11-05', quote: null }; }],
      // A quantity's stated_time is deliberately not a case: the card's diff leaves it out (postimage `bare`), because the figure
      // the host counts from it and the basis that names it are what the card says. Its change shows through them (below).
    ];
    const said = cases.map(([name, id, mutate]) => {
      const v = validatePostimage(studio(), one(mutate), { removals: [], words: WORDS, fresh: [] });
      const c = v.ok ? v.changes.find((x) => x.id === id) : undefined;
      return [name, v.ok ? 'ok' : v.code, c !== undefined && c.before !== c.after && !`${c.before} ${c.after}`.includes('undefined')];
    });
    expect(said).toEqual(cases.map(([name]) => [name, 'ok', true]));
    const change = (id: string, mutate: (m: CanonicalModelT) => void) => { const v = validatePostimage(studio(), one(mutate), { removals: [], words: WORDS, fresh: [] }); const c = v.ok ? v.changes.find((x) => x.id === id)! : undefined; return [c?.before, c?.after]; };
    expect(change('evening_mood', cases[2]![2])).toEqual(['"Evening classes" ↑ raises "How members feel"', '"Evening classes" affects "How members feel", in a disputed direction']);
    expect(change('carry_on', cases[10]![2])).toEqual(['carries on as now', null]);
    expect(change('members', cases[12]![2])).toEqual(['150 members', '150, not measured']);
    expect(change('instructor_leaves', cases[9]![2])).toEqual(['with a chance not known yet, affecting "Keep at least 140 members", by a size not known yet, ↓ lowering it',
      'with a chance not known yet, adding a size not known yet to "Keep at least 140 members", ↓ lowering it']);
    // A stated time changed alone, counted by the host (countStatedTime) as the drafting path does, is said through the counted
    // figure and its basis: when the evening classes start, 29 Mar 2027 is exactly 5 months from 29 Oct 2026, 29 Jan 2027 is 3.
    const stated = (date: string) => countStatedTime(one((m) => {
      m.quantities.push(q('months_left', 'month', { stated_time: { date, span: null, unit: null, said_on: null } }));
      m.options[0] = { ...m.options[0]!, sets: m.options[0]!.sets.map((x) => ({ ...x, starts_after_periods: 'months_left' })) };
    }), '2026-10-29');
    const t = validatePostimage(stated('2027-03-29'), stated('2027-01-29'), { removals: [], words: WORDS, fresh: [] });
    const counted = t.ok ? t.changes.find((x) => x.id === 'months_left') : undefined;
    expect([t.ok ? 'ok' : t.code, counted !== undefined && counted.before !== counted.after]).toEqual(['ok', true]);
    expect([counted!.before, counted!.after]).toEqual(['5 months, based on "Read as 29 Mar 2027 from your words: 5 months from 29 Oct 2026."',
      '3 months, based on "Read as 29 Jan 2027 from your words: 3 months from 29 Oct 2026."']);
  });

  it('reading groups: a link of theirs in their words is used, Olumi\'s link and risk are inferred, and no link is said on another line', () => {
    const groups = readingGroups(studio(), (quote) => verbatimIn(quote, WORDS));
    expect(Object.fromEntries(groups)).toEqual({
      takings_goal: 'used', keep_members: 'used', evening_classes: 'used', weekend_workshops: 'inferred', carry_on: 'used', instructor_leaves: 'inferred',
      classes_rel: 'other', takings_rel: 'other', evening_mood: 'used', mood_members: 'inferred',
      class_fee: 'used', classes_now: 'used', extra_classes: 'other', evening_extra: 'used', workshop_extra: 'inferred', takings_target: 'used', members: 'used',
      members_target: 'used', member_mood: 'inferred',
    });
    expect(readingLine(groups)).toBe('I used 11 things from your brief and added 5 of my own for you to check.');
  });

  it('an update adds, changes and removes a link by id; the card says each and history keeps what it replaced', () => {
    const saved = studio();
    const changed = { ...saved.relations[2]!, confidence: 'unsure' } as CanonicalModelT['relations'][number];
    const added = { ...saved.relations[3]!, id: 'workshop_mood', from: 'weekend_workshops', to: 'member_mood', direction: 'up', basis: null } as CanonicalModelT['relations'][number];
    const update = { version: 'canonical.v1' as const, question: null, period: null, coaching_questions: null, decide_by: null, quantities: [], relations: [changed, added], goals: [], limits: [], preferences: [], options: [], risks: [],
      claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: ['mood_members'] };
    const merged = mergeUpdate(saved, update);
    expect(merged.relations.map((r) => r.id)).toEqual(['classes_rel', 'takings_rel', 'evening_mood', 'workshop_mood']);
    expect(merged.quantities).toEqual(saved.quantities); // every record not returned is the saved one, exactly
    const v = validatePostimage(saved, merged, { removals: ['mood_members'], words: WORDS, fresh: [] });
    expect(v.ok).toBe(true);
    expect((v.ok ? v.changes : []).map((c) => [c.id, c.action, c.label, c.before, c.after])).toEqual([
      ['evening_mood', 'change', 'Evening classes → How members feel', 'judged likely', 'judged unsure'],
      ['workshop_mood', 'add', 'Weekend workshops → How members feel', null, '"Weekend workshops" ↑ raises "How members feel", judged unsure'],
      ['mood_members', 'remove', 'How members feel → members', '"How members feel" affects "members", depending on conditions, judged unsure, based on "Happier members stay only if the classes suit them."', null],
    ]);
    expect((v.ok ? v.model.history : []).map((h) => [h.id, h.change])).toEqual([['evening_mood', 'superseded'], ['mood_members', 'withdrawn']]);
  });

  it('the store saves and reads back the links, the unsized risk, the carry-on and the unmeasured factor exactly', () => {
    const program = { model_program: MODEL_PROGRAM, canonical: studio(), seed: 7, person_words: WORDS, runs: [] };
    const read = programReadOf({ living_model: JSON.parse(JSON.stringify(livingModelOf(program))) });
    expect(read.kind).toBe('program');
    expect(read.kind === 'program' ? read.program.canonical : null).toEqual(studio());
  });

  it('the result names what the members aim waits on by the records\' own labels, the link as from → to, and never as a figure to type in', () => {
    const e = evaluateCanonical(studio(), { sourceText: STUDIO_BRIEF, seed: 7, draws: 200 });
    const view = e.view as Rec;
    expect(view.goal_chance.waits_on).toEqual([
      { id: 'member_mood', code: 'unknown', label: 'How members feel', scope: ['keep_members'], answer: null, basis: MOOD_BASIS },
      { id: 'evening_mood', code: 'unknown', label: 'Evening classes → How members feel', scope: ['keep_members'], answer: null, basis: 'Members have asked for evening slots.' },
      { id: 'mood_members', code: 'unknown', label: 'How members feel → members', scope: ['keep_members'], answer: null, basis: 'Happier members stay only if the classes suit them.' },
      { id: 'instructor_leaves', code: 'unknown', label: 'The instructor leaves', scope: ['keep_members'], answer: null },
    ]);
    // Said once (29 Oct): one aim waits, so what it waits on is the waits_on list above (with each item's basis), not a note too.
    expect(view.goal_chance.notes).toEqual(expect.arrayContaining(['The risk ‘The instructor leaves’ is not in this run: The calculation cannot size it.']));
    expect(view.goal_chance.notes.join(' ')).not.toContain('‘Keep at least 140 members’ waits on');
    // Evening classes' link in words reaches only the members aim, which waits on it above; the option is compared on takings (spec §3.0).
    expect(view.goal_chance.notes.join(' ')).not.toContain('The option ‘Evening classes’ is not in this run');
    expect(JSON.stringify(view)).not.toMatch(/undefined|needs your answer/);
    // No partial chance is shown as the whole: each compared option's cell waits, not on an answer; the takings aim is shown on its own.
    expect(view.options.map((o: Rec) => [o.option_id, o.cell.kind, o.cell.face])).toEqual([['evening_classes', 'withheld', 'Chance not shown yet'], ['weekend_workshops', 'withheld', 'Chance not shown yet'], ['carry_on', 'withheld', 'Chance not shown yet']]);
    // Evening classes is compared on takings too (240 classes, £2,880): its link in words withholds only the members aim.
    expect(view.goal_chance.targets.per_target.map((t: Rec) => [t.constraint_id, t.options.map((o: Rec) => o.display)])).toEqual([['takings_goal', ['100%', '100%', '0%']]]);
  });
});

describe('Box 1a: a model saved before links, carry-on and risk direction', () => {
  const priorVersions = { ...ENGINE_VERSIONS, engine: 'mp-synthetic-before-box1a' };
  /** The bakery as saved before Box 1a: no carry_on on its options, a sized risk with no direction, a history entry. */
  const stored = (): Rec => {
    const m = JSON.parse(JSON.stringify(bakery())) as Rec;
    m.options = m.options.map(({ carry_on: _carry, ...o }: Rec) => o);
    m.quantities.push(q('breakdown_chance', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', low: 0.05, high: 0.2, range_kind: 'plausible', basis: 'Ovens this age break down now and then.' }),
      q('lost_loaves', 'loaf/week', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: -100, low: -150, high: -50, range_kind: 'plausible', basis: 'A week without an oven.' }));
    m.risks = [{ id: 'breakdown', label: 'The oven breaks down', occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', mode: 'add', starts_after_periods: 0, author: 'olumi', quote: null, ...at }];
    m.history = [{ id: 'budget', change: 'superseded', old: '{"id":"budget","unit":"GBP","value":2500}', quote: null, author_id: null, approved_by: null }];
    // Saved before stated time and decide-by too (29 Oct), which the bakery fixture now carries.
    m.quantities = m.quantities.map(({ stated_time: _st, ...x }: Rec) => x);
    delete m.decide_by;
    return m;
  };
  /** The revision digest as computed before Box 1a, written out independently of run-receipt.ts. */
  const digestBefore = (canonical: Rec, words: readonly string[]): string => {
    const quantities = (canonical.quantities as Rec[]).map(({ direction, floor, ceiling, ...x }) => ({ ...x,
      ...(direction == null ? {} : { direction }), ...(floor == null ? {} : { floor }), ...(ceiling == null ? {} : { ceiling }) }));
    const lean = (v: unknown): unknown => (Array.isArray(v) ? v.map(lean) : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !(k === 'approved_by' && x == null)).map(([k, x]) => [k, lean(x)])) : v);
    const { title, coaching_questions: coaching, ...rest } = canonical;
    const named = { ...rest, ...(title == null ? {} : { title }), ...(coaching === undefined || coaching.length === 0 ? {} : { coaching_questions: coaching }) };
    return createHash('sha256').update(stableStringify({ canonical: lean({ ...named, quantities }), person_words: words }), 'utf8').digest('hex');
  };

  it('opens with no carry-on declared and its risk\'s direction unknown, its bytes and its Run untouched, then compiles and draws as before with no baseline claimed', () => {
    const canonical = stored();
    expect([canonical.options.some((o: Rec) => 'carry_on' in o), 'direction' in canonical.risks[0]]).toEqual([false, false]);
    const run: StoredRun = {
      run_id: 'mp_run_saved_before_box1a', computed_at: '2026-10-27T10:00:00.000Z',
      receipt: { revision_digest: digestBefore(canonical, [BRIEF]), versions: priorVersions, seed: 7, draws: 200 },
      result: { canonical_analysis_view: { marker: 'stored result, never recomputed',
        run: { run_id: 'mp_run_saved_before_box1a', graph_hash_at_run: 'old-graph', computed_at: '2026-10-27T10:00:00.000Z' }, staleness: { stale: false, reason: 'graph_hash_match' } },
        chances: null, compile: null },
    };
    const before = JSON.stringify({ living_model: { model_program: MODEL_PROGRAM, canonical, person_words: [BRIEF], seed: 7, runs: [run] } });
    const cold = JSON.parse(before);
    const opened = reopenProgram(cold, priorVersions)!;
    const m = opened.program.canonical;
    expect([m.options.map((o) => o.carry_on), m.risks.map((k) => k.direction)]).toEqual([[false, false], ['unknown']]);
    expect([opened.current, opened.engine_current, opened.run]).toEqual([true, true, run]);
    expect(m.history[0]!.old).toBe('{"id":"budget","unit":"GBP","value":2500}');
    expect(JSON.stringify(cold)).toBe(before);
    // Compiles as before: the sized risk lowered exactly as it was, the same goal and the same ask.
    const c = compile(m);
    expect([c.errors, c.perGoal.map((g) => [g.goal_id, g.status]), c.blockers]).toEqual([[], [['more_loaves', 'calculable']], [{ id: 'oven_price', code: 'asked', scope: ['within_budget'] }]]);
    expect(c.executable!.risks).toEqual([{ id: 'breakdown', occurrence: 'breakdown_chance', severity: 'lost_loaves', effect_on: 'sales', mode: 'add', from_period: 0 }]);
    // Draws as before, but claims no baseline: the flag was never declared, and none is read from its empty settings or name.
    const p = project(m, c, { brief: BRIEF });
    expect((p.graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => [n.id, 'is_baseline' in n])).toEqual([['second_oven', false], ['keep_one', false]]);
    expect((p.graph.edges as Rec[]).find((e) => e.id === 'breakdown__sales')).toMatchObject({ from: 'breakdown', to: 'sales', effect_direction: 'negative', effect_mode: 'add' });
    expect((p.graph.edges as Rec[]).find((e) => e.id === 'breakdown__sales')).not.toHaveProperty('direction_settled');
  });
});

describe('Box 2 (Paul Q1/Q2, 28 Oct): an update returns Olumi\'s questions only when it makes the saved ones out of date', () => {
  const SAVED_QS = ['What would make the second oven worth its cost?', 'Who else would need to agree before you buy it?'];
  const NEW_QS = ['How sure are you that customers want more loaves?'];
  const coached = (): CanonicalModelT => ({ ...bakery(), coaching_questions: [...SAVED_QS] });
  /** An update that returns nothing: every family [], the question and time step null, Olumi's questions as given. */
  const none = (m: CanonicalModelT, coaching_questions: string[] | null) => ({ version: m.version, question: null, period: null, coaching_questions, decide_by: null, quantities: [], relations: [],
    goals: [], limits: [], preferences: [], options: [], risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] as string[] });
  const opts = { removals: [], words: [BRIEF], fresh: [] };

  it('the update\'s schema, parsed and as the drafter is sent it (strict output), accepts null and a list; the key is required and holds only words', () => {
    const ajv = new Ajv({ strict: false });
    for (const list of [null, NEW_QS, []]) {
      const update = none(bakery(), list);
      expect(CanonicalUpdate.safeParse(update).success, JSON.stringify(list)).toBe(true);
      expect([ajv.validate(UPDATE_JSON_SCHEMA, update), ajv.errors ?? []], JSON.stringify(list)).toEqual([true, []]);
    }
    const schema = UPDATE_JSON_SCHEMA as Rec;
    expect(schema.required).toContain('coaching_questions');
    expect(schema.properties.coaching_questions.description).toBe('Null unless this change makes the saved questions out of date (one is answered, settled or no longer applies, or the model now raises a more important one): then the whole new list, by the first draft\'s rules (up to three).');
    expect(schema.properties.coaching_questions.anyOf.map((x: Rec) => x.type)).toEqual(['array', 'null']);
    // Contrast: an update that leaves the key out, or puts a figure in the list, is refused by both.
    const { coaching_questions: _left, ...without } = none(bakery(), null);
    expect([CanonicalUpdate.safeParse(without).success, ajv.validate(UPDATE_JSON_SCHEMA, without)]).toEqual([false, false]);
    expect([CanonicalUpdate.safeParse({ ...without, coaching_questions: [3] }).success, ajv.validate(UPDATE_JSON_SCHEMA, { ...without, coaching_questions: [3] })]).toEqual([false, false]);
  });

  it('mergeUpdate: null keeps the saved questions, [] clears them, a list replaces them; nothing else moves', () => {
    const saved = coached();
    const merged = (list: string[] | null) => mergeUpdate(saved, none(saved, list));
    expect([merged(null).coaching_questions, merged([]).coaching_questions, merged(NEW_QS).coaching_questions]).toEqual([SAVED_QS, [], NEW_QS]);
    for (const list of [null, [], NEW_QS]) expect({ ...merged(list), coaching_questions: [] }, JSON.stringify(list)).toEqual({ ...saved, coaching_questions: [] });
  });

  it('the card says a changed list as ONE entry, "Olumi’s questions for you", both lists in full ("No questions" for none, never null); the approved model holds the new list', () => {
    const saved = coached();
    const card = (list: string[], from: CanonicalModelT = saved) => validatePostimage(from, { ...from, coaching_questions: list }, opts);
    const replaced = card(NEW_QS);
    expect(replaced.ok ? replaced.changes : replaced.code).toEqual([{ id: 'coaching_questions', kind: 'record', action: 'change', label: 'Olumi’s questions for you',
      before: `1. ${SAVED_QS[0]}\n2. ${SAVED_QS[1]}`, after: `1. ${NEW_QS[0]}`, author: 'olumi' }]);
    expect(replaced.ok ? replaced.model.coaching_questions : null).toEqual(NEW_QS);
    // [] clears them: the saved list before, "No questions" after; and from none, "No questions" before.
    const cleared = card([]);
    expect(cleared.ok ? cleared.changes.map((c) => [c.id, c.action, c.before, c.after]) : cleared.code).toEqual([['coaching_questions', 'change', `1. ${SAVED_QS[0]}\n2. ${SAVED_QS[1]}`, 'No questions']]);
    expect(cleared.ok ? cleared.model.coaching_questions : null).toEqual([]);
    const fromNone = card(NEW_QS, bakery());
    expect(fromNone.ok ? fromNone.changes.map((c) => [c.id, c.action, c.before, c.after]) : fromNone.code).toEqual([['coaching_questions', 'change', 'No questions', `1. ${NEW_QS[0]}`]]);
    // Beside a change to a figure: both are said, so the list never rides unseen (no unshown change).
    const base = saved.quantities.find((x) => x.id === 'base_sales')!;
    const both = validatePostimage(saved, { ...saved, coaching_questions: NEW_QS, quantities: saved.quantities.map((x) => (x.id === 'base_sales' ? { ...base, value: 320 } : x)) }, opts);
    expect(both.ok ? both.changes.map((c) => c.id) : both.code).toEqual(['base_sales', 'coaching_questions']);
    // The order is the first screen's, so a reordered list is a change; the same list is none.
    expect((card([SAVED_QS[1]!, SAVED_QS[0]!]) as Rec).changes?.map((c: Rec) => c.after)).toEqual([`1. ${SAVED_QS[1]}\n2. ${SAVED_QS[0]}`]);
    expect(card([...SAVED_QS])).toMatchObject({ ok: false, code: 'no_change' });
  });

  it('a model saved before coaching questions reads as none; an update that returns null keeps none, says nothing of them, and the digest counts no list', () => {
    const { coaching_questions: _c, title: _t, ...old } = JSON.parse(JSON.stringify(bakery())) as Rec;
    const read = programReadOf({ living_model: { model_program: MODEL_PROGRAM, canonical: old, seed: 7, person_words: [BRIEF], runs: [] } });
    expect(read.kind).toBe('program');
    const saved = (read.kind === 'program' ? read.program.canonical : null)!;
    expect(saved.coaching_questions).toEqual([]);
    const base = saved.quantities.find((x) => x.id === 'base_sales')!;
    // The update as the drafter now returns it (the key present, null), parsed by its own schema.
    const update = CanonicalUpdate.parse({ ...none(saved, null), quantities: [{ ...base, value: 320 }] });
    const merged = mergeUpdate(saved, update);
    expect(merged.coaching_questions).toEqual([]);
    const v = validatePostimage(saved, merged, opts);
    expect(v.ok ? v.changes.map((c) => c.id) : v.code).toEqual(['base_sales']);
    const { coaching_questions: _none, ...unlisted } = merged;
    expect(revisionDigest(merged, [BRIEF])).toBe(revisionDigest(unlisted as CanonicalModelT, [BRIEF]));
  });
});
