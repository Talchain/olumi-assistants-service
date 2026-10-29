/**
 * Box 1a (Paul's Q1, 28 Oct: "links in words by default and numbers only where they're real"): an influence is a link in
 * words, never calculated; a risk no one can size and an unmeasured factor are never lowered; an aim any of them reaches is
 * withheld naming them, while a numeric sibling aim still calculates. Synthetic class studio only; every expectation is
 * written by hand from the fixture, with a contrast beside each absence.
 */
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { CanonicalModel, type CanonicalModelT } from '../canonical.js';
import { compile } from '../compile.js';
import { project } from '../project.js';
import { simulate } from '../simulate/simulate.js';
import { CANONICAL_JSON_SCHEMA, UPDATE_JSON_SCHEMA } from '../../model-program-turn/prompt.js';
import { studio, STUDIO_BRIEF } from '../../model-program-turn/__tests__/class-studio.fixture.js';

type Rec = Record<string, any>;
const HOST = new Set(['approval', 'approved_by', 'author_id']);
const unhosted = (v: unknown): unknown => (Array.isArray(v) ? v.map(unhosted) : v !== null && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !HOST.has(k)).map(([k, x]) => [k, unhosted(x)])) : v);
const MOOD = 'rests on "How members feel", which is not measured: No one can measure how members feel yet; repeat bookings might show it.';
const EVENING_LINK = 'rests on the link "Evening classes → How members feel", which is in words, never calculated.';
const MOOD_LINK = 'rests on the link "How members feel → members", which is in words, never calculated.';
const RISK = 'rests on the risk "The instructor leaves", which the calculation cannot size.';
const goalOf = (c: ReturnType<typeof compile>, id: string) => c.perGoal.find((g) => g.goal_id === id)!;

describe('Box 1a: links in words, risks no one can size and unmeasured factors', () => {
  it('the strict draft and update schemas the drafter is sent accept the studio: two influences, an unsized risk, a declared carry-on and an unmeasured factor', () => {
    const ajv = new Ajv({ strict: false });
    const { history: _history, ...draft } = unhosted(studio()) as Rec;
    expect([ajv.validate(CANONICAL_JSON_SCHEMA, draft), ajv.errors ?? []]).toEqual([true, []]);
    // An update returning only the records it adds: the influences, the risk, the carry-on and the unmeasured factor.
    const m = studio();
    const update = unhosted({ version: m.version, question: null, period: null, coaching_questions: null, decide_by: null, quantities: m.quantities.filter((x) => x.id === 'member_mood'),
      relations: m.relations.filter((r) => r.form === 'influence'), goals: [], limits: [], preferences: [], options: m.options.filter((o) => o.id === 'carry_on'),
      risks: m.risks, claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], remove: [] });
    expect([ajv.validate(UPDATE_JSON_SCHEMA, update), ajv.errors ?? []]).toEqual([true, []]);
    expect(CanonicalModel.safeParse(m).success).toBe(true);
    // Contrast: the schema still refuses an influence of no direction it knows, and a carry-on that is not a yes or no.
    const bad = structuredClone(draft);
    bad.relations[2].direction = 'sideways';
    bad.options[2].carry_on = null;
    expect(ajv.validate(CANONICAL_JSON_SCHEMA, bad)).toBe(false);
  });

  it('compile withholds the members aim, naming the unmeasured factor, both links and the risk; the takings aim still calculates, and nothing in words is lowered', () => {
    const c = compile(studio());
    expect(c.errors).toEqual([]);
    expect([goalOf(c, 'takings_goal').status, goalOf(c, 'takings_goal').reasons]).toEqual(['calculable', []]);
    expect([goalOf(c, 'keep_members').status, goalOf(c, 'keep_members').reasons]).toEqual(['withheld', [MOOD, EVENING_LINK, MOOD_LINK, RISK]]);
    // Typed, in the model's order (quantities, relations, risks), each by its own id: no one's to answer as a figure.
    expect(c.blockers).toEqual([
      // Evening classes' own link in words reaches only the members aim: it never holds that option up on takings (spec §3.0).
      { id: 'member_mood', code: 'unknown', scope: ['keep_members'] }, { id: 'evening_mood', code: 'unknown', scope: ['keep_members'] },
      { id: 'mood_members', code: 'unknown', scope: ['keep_members'] }, { id: 'instructor_leaves', code: 'unknown', scope: ['keep_members'] },
    ]);
    const x = c.executable!;
    expect(x.goals.map((g) => g.id)).toEqual(['takings_goal']);
    expect(x.options.map((o) => o.id)).toEqual(['evening_classes', 'weekend_workshops', 'carry_on']);
    expect(x.risks).toEqual([]);
    expect(x.quantities.map((q) => q.id).sort()).toEqual(['class_fee', 'classes', 'classes_now', 'evening_extra', 'extra_classes', 'takings', 'takings_target', 'workshop_extra']);
    expect(x.withheld.map((w) => [w.id, w.kind, w.reason])).toEqual([
      ['keep_members', 'goal', [MOOD, EVENING_LINK, MOOD_LINK, RISK].join(' ')], ['instructor_leaves', 'risk', 'The calculation cannot size it.'],
    ]);
    // The sibling calculates for every option, evening classes too: 200 classes at £12 is £2,400; evening classes make 240
    // (£2,880), weekend workshops 220 (£2,640).
    const sim = simulate(x, { seed: 7, draws: 200 });
    expect(sim.options.map((o) => [o.option_id, (o.per_goal[0] as { chance: number }).chance])).toEqual([['evening_classes', 1], ['weekend_workshops', 1], ['carry_on', 0]]);
    // Contrast: without its two links and its risk, the members aim calculates (150 is at least 140).
    const plain = studio();
    plain.relations = plain.relations.filter((r) => r.form !== 'influence');
    plain.risks = [];
    const p = compile(plain);
    expect([goalOf(p, 'keep_members').status, p.blockers]).toEqual(['calculable', []]);
  });

  it('a fully qualitative factor (unit null, status unknown) linked by an influence, beside a numeric sibling: it never executes, the sibling calculates, and its aim is withheld naming it', () => {
    const m = studio();
    m.risks = [];
    const c = compile(m);
    expect(c.errors).toEqual([]);
    expect([goalOf(c, 'keep_members').status, goalOf(c, 'keep_members').reasons]).toEqual(['withheld', [MOOD, EVENING_LINK, MOOD_LINK]]);
    expect(goalOf(c, 'takings_goal').status).toBe('calculable');
    expect(c.executable!.quantities.map((q) => q.id)).not.toContain('member_mood');
    expect(c.executable!.quantities.map((q) => q.id)).toContain('takings'); // positive control
    // The factor is withheld by its own unit too: a figure on it is never read, whatever its status says.
    const given = studio();
    given.risks = [];
    given.relations = given.relations.filter((r) => r.id !== 'evening_mood');
    given.quantities = given.quantities.map((q) => (q.id === 'member_mood' ? { ...q, status: 'known', value: 7, basis: null } : q));
    const g = compile(given);
    expect([g.errors, goalOf(g, 'keep_members').status, goalOf(g, 'keep_members').reasons]).toEqual([[], 'withheld', ['rests on "How members feel", which is not measured.', MOOD_LINK]]);
    expect(g.executable!.quantities.map((q) => q.id)).not.toContain('member_mood');
  });

  it('an influence on an option\'s own setting withholds that option, naming the link; the aim and the other options still calculate', () => {
    const m = studio();
    m.relations.push({ ...m.relations[3]!, id: 'workshop_doubt', from: 'member_mood', to: 'workshop_extra', direction: 'unknown', confidence: 'unknown', basis: null } as CanonicalModelT['relations'][number]);
    const c = compile(m);
    const o = c.perOption.find((p) => p.option_id === 'weekend_workshops')!;
    // Its closure reaches the factor, so the link into the factor too.
    expect([o.status, o.reasons]).toEqual(['withheld', [MOOD, EVENING_LINK, 'rests on the link "How members feel → workshop extra", which is in words, never calculated.']]);
    expect(goalOf(c, 'takings_goal').status).toBe('calculable');
    expect(c.executable!.options.map((x) => x.id)).toEqual(['evening_classes', 'carry_on']);
  });

  it('an option\'s own link in words withholds each aim it reaches, naming it, never the option\'s chance on an aim it does not reach (spec §3.0)', () => {
    const c = compile(studio());
    // Evening classes adds 40 classes and, in words, lifts how members feel: the members aim is withheld naming that link; the
    // option itself is compared, on takings, by its 40 classes.
    expect(goalOf(c, 'keep_members').reasons).toContain(EVENING_LINK);
    expect(c.perOption.find((p) => p.option_id === 'evening_classes')).toMatchObject({ status: 'calculable', reasons: [] });
    // With no setting at all, its link still reaches only the members aim: on takings the model says it changes nothing, so it
    // draws what carrying on draws (£2,400, short of £2,600).
    const words = studio();
    words.options = words.options.map((o) => (o.id === 'evening_classes' ? { ...o, sets: [] } : o));
    const w = compile(words);
    expect(w.perOption.find((p) => p.option_id === 'evening_classes')!.status).toBe('calculable');
    const sim = simulate(w.executable!, { seed: 7, draws: 200 });
    expect(sim.options.map((o) => [o.option_id, (o.per_goal[0] as { chance: number }).chance])).toEqual([['evening_classes', 0], ['weekend_workshops', 1], ['carry_on', 0]]);
    // Contrast: the same link aimed at takings withholds the takings aim, for every option, naming it.
    const reach = studio();
    reach.relations = reach.relations.map((r) => (r.id === 'evening_mood' ? { ...r, to: 'takings' } : r)) as CanonicalModelT['relations'];
    const t = compile(reach);
    expect([goalOf(t, 'takings_goal').status, goalOf(t, 'takings_goal').reasons]).toEqual(['withheld', ['rests on the link "Evening classes → takings", which is in words, never calculated.']]);
  });

  it('Codex review 1: a risk no one can size on an option itself withholds that option, naming the risk, with its blocker', () => {
    const m = studio();
    m.risks.push({ ...m.risks[0]!, id: 'venue_lost', label: 'The weekend venue is lost', effect_on: 'weekend_workshops' });
    const c = compile(m);
    const o = c.perOption.find((p) => p.option_id === 'weekend_workshops')!;
    expect([o.status, o.reasons]).toEqual(['withheld', ['rests on the risk "The weekend venue is lost", which the calculation cannot size.']]);
    expect(c.executable!.options.map((x) => x.id)).toEqual(['evening_classes', 'carry_on']);
    expect(c.blockers.find((b) => b.id === 'venue_lost')).toEqual({ id: 'venue_lost', code: 'unknown', scope: ['weekend_workshops'] });
  });

  it('GAP 1 review (29 Oct): an option\'s link in words that reaches an aim\'s window figure through a risk\'s chance or a factor withholds that aim for every option, naming the option\'s link', () => {
    const windowed = () => {
      const m = studio();
      m.quantities.push({ ...m.quantities.find((x) => x.id === 'members')!, id: 'duration', label: 'duration', unit: 'month', value: 3, quote: null });
      m.goals = m.goals.map((g) => (g.id === 'takings_goal' ? { ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'duration' } } } : g));
      return m;
    };
    // Through a factor: evening classes → how members feel → duration. Both links are named, the option's too.
    const viaFactor = windowed();
    viaFactor.relations.push({ ...viaFactor.relations[3]!, id: 'term_mood', from: 'member_mood', to: 'duration', direction: 'unknown', confidence: 'unknown', basis: null } as CanonicalModelT['relations'][number]);
    const f = compile(viaFactor);
    expect(goalOf(f, 'takings_goal').status).toBe('withheld');
    expect(goalOf(f, 'takings_goal').reasons).toEqual(expect.arrayContaining([EVENING_LINK, 'rests on the link "How members feel → duration", which is in words, never calculated.']));
    expect(f.blockers.find((b) => b.id === 'evening_mood')!.scope).toContain('takings_goal');
    // Through a risk's chance: evening classes → the chance the term is cut → (sized) risk on duration.
    const viaRisk = windowed();
    const base = viaRisk.quantities.find((x) => x.id === 'members')!;
    viaRisk.quantities.push({ ...base, id: 'cut_chance', label: 'Chance the term is cut', unit: '1', value: 0.2, quote: null, floor: 0, ceiling: 1 },
      { ...base, id: 'cut_months', label: 'Months lost', unit: 'month', value: -1, quote: null });
    viaRisk.risks.push({ ...viaRisk.risks[0]!, id: 'term_cut', label: 'The term is cut short', effect_on: 'duration', direction: 'down', occurrence: 'cut_chance', severity: 'cut_months', mode: 'add' } as CanonicalModelT['risks'][number]);
    viaRisk.relations.push({ ...viaRisk.relations[3]!, id: 'evening_cut', from: 'evening_classes', to: 'cut_chance', direction: 'up', confidence: 'unsure', basis: null } as CanonicalModelT['relations'][number]);
    const r = compile(viaRisk);
    // GAP 2: the sized risk on the window length is named too; the length is read once and a draw cannot change it.
    expect([goalOf(r, 'takings_goal').status, goalOf(r, 'takings_goal').reasons]).toEqual(['withheld', ['rests on the link "Evening classes → Chance the term is cut", which is in words, never calculated.',
      'rests on the risk "The term is cut short" on "duration", which the calculation reads once as written and cannot change in a draw.']]);
    // Contrast: with neither link, over its three months the takings aim calculates.
    expect(goalOf(compile(windowed()), 'takings_goal').status).toBe('calculable');
  });

  it('Codex review 2: a link in words or an unsized risk on an aim\'s window figure withholds the aim, naming it', () => {
    const windowed = () => {
      const m = studio();
      m.quantities.push({ ...m.quantities.find((x) => x.id === 'members')!, id: 'duration', label: 'duration', unit: 'month', value: 3, quote: null });
      m.goals = m.goals.map((g) => (g.id === 'takings_goal' ? { ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'duration' } } } : g));
      return m;
    };
    // Contrast: over its three months, with nothing in words on its window, the takings aim calculates.
    expect(goalOf(compile(windowed()), 'takings_goal').status).toBe('calculable');
    const linked = windowed();
    linked.relations.push({ ...linked.relations[3]!, id: 'term_doubt', from: 'member_mood', to: 'duration', direction: 'unknown', confidence: 'unknown', basis: null } as CanonicalModelT['relations'][number]);
    const l = goalOf(compile(linked), 'takings_goal');
    // The factor it comes from is itself moved by evening classes in words, so that link reaches the window too (GAP 1 review).
    expect([l.status, l.reasons]).toEqual(['withheld', [EVENING_LINK, 'rests on the link "How members feel → duration", which is in words, never calculated.']]);
    const risked = windowed();
    risked.risks.push({ ...risked.risks[0]!, id: 'term_cut', label: 'The term is cut short', effect_on: 'duration', direction: 'down' });
    const r = goalOf(compile(risked), 'takings_goal');
    expect([r.status, r.reasons]).toEqual(['withheld', ['rests on the risk "The term is cut short", which the calculation cannot size.']]);
  });

  it('references: a link from or to a record of the wrong kind, or a risk on nothing in the model, is named (the existing undefined reference)', () => {
    const m = studio();
    m.relations.push({ ...m.relations[2]!, id: 'odd_link', from: 'takings_goal', to: 'evening_classes' } as CanonicalModelT['relations'][number]);
    m.risks.push({ ...m.risks[0]!, id: 'lost', effect_on: 'nowhere' });
    expect(compile(m).errors.map((e) => [e.code, e.items])).toEqual([
      ['undefined_ref', ['odd_link', 'takings_goal']], ['undefined_ref', ['odd_link', 'evening_classes']], ['undefined_ref', ['lost', 'nowhere']],
    ]);
  });

  it('project draws each influence from → to with its direction and basis, the risk on the aim with its own direction, and is_baseline only on the declared carry-on', () => {
    const m = studio();
    const p = project(m, compile(m), { brief: STUDIO_BRIEF });
    const edge = (id: string) => (p.graph.edges as Rec[]).find((e) => e.id === id);
    const node = (id: string) => (p.graph.nodes as Rec[]).find((n) => n.id === id)!;
    expect(edge('evening_classes__member_mood')).toEqual({ id: 'evening_classes__member_mood', from: 'evening_classes', to: 'member_mood', exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'brief_extraction', reasoning: 'Members have asked for evening slots.' }, origin: 'model_program:display',
      link_words: { direction: 'up', confidence: 'likely', basis: 'Members have asked for evening slots.' } });
    expect(edge('member_mood__members')).toEqual({ id: 'member_mood__members', from: 'member_mood', to: 'members', exists_probability: 1, direction_settled: false,
      provenance: { source: 'cee_hypothesis', reasoning: 'Happier members stay only if the classes suit them.' }, origin: 'model_program:display',
      link_words: { direction: 'conditional', confidence: 'unsure', basis: 'Happier members stay only if the classes suit them.' } });
    // The risk on an aim: the risk → quantity edge's own form, to the aim's card, signed by its own direction (it has no size).
    expect(edge('instructor_leaves__keep_members')).toEqual({ id: 'instructor_leaves__keep_members', from: 'instructor_leaves', to: 'keep_members', exists_probability: 1, effect_direction: 'negative',
      provenance: { source: 'cee_hypothesis', reasoning: 'if it happens' }, origin: 'model_program:display',
      link_words: { direction: 'down', confidence: null, basis: null } });
    expect(p.items.filter((i) => ['evening_mood', 'mood_members'].includes(i.record_id))).toEqual([
      { record_id: 'evening_mood', family: 'relation', shown_as: { edge: 'evening_classes__member_mood' }, in_calculation: false, why_out: 'A link in words: drawn, never calculated.', author: 'person', approval: 'proposed' },
      { record_id: 'mood_members', family: 'relation', shown_as: { edge: 'member_mood__members' }, in_calculation: false, why_out: 'A link in words: drawn, never calculated.', author: 'olumi', approval: 'proposed' },
    ]);
    expect(p.graph.nodes.filter((n) => n.kind === 'option').map((n) => [n.id, n.is_baseline ?? null])).toEqual([['evening_classes', null], ['weekend_workshops', null], ['carry_on', true]]);
    // The unmeasured factor is its own card, with no unit or scale drawn; the members aim is out of the analysis.
    expect(node('member_mood')).toMatchObject({ kind: 'factor', display_value: '?', analysis_participation: 'retained_excluded' });
    expect(node('member_mood')).not.toHaveProperty('observed_state');
    expect(JSON.stringify(p)).not.toMatch(/undefined|null null/);
    // Contrast: an option with no setting that does not declare itself the carry-on is no baseline; one with no direction is unsettled.
    const undeclared = studio();
    undeclared.options = undeclared.options.map((o) => ({ ...o, carry_on: false }));
    undeclared.risks = undeclared.risks.map((k) => ({ ...k, direction: 'unknown' as const }));
    const u = project(undeclared, compile(undeclared));
    expect(u.graph.nodes.filter((n) => n.kind === 'option').some((n) => 'is_baseline' in n)).toBe(false);
    expect((u.graph.edges as Rec[]).find((e) => e.id === 'instructor_leaves__keep_members')).toMatchObject({ direction_settled: false });
    expect((u.graph.edges as Rec[]).find((e) => e.id === 'instructor_leaves__keep_members')).not.toHaveProperty('effect_direction');
  });

  it('Q1 reader 1: every link in words and every unsized-risk edge carries its words as recorded, and no numerical link does', () => {
    const m = studio();
    const p = project(m, compile(m), { brief: STUDIO_BRIEF });
    const words = (p.graph.edges as Rec[]).filter((e) => 'link_words' in e).map((e) => [e.id, e.link_words]);
    expect(words).toEqual([
      ['evening_classes__member_mood', { direction: 'up', confidence: 'likely', basis: 'Members have asked for evening slots.' }],
      ['member_mood__members', { direction: 'conditional', confidence: 'unsure', basis: 'Happier members stay only if the classes suit them.' }],
      ['instructor_leaves__keep_members', { direction: 'down', confidence: null, basis: null }],
    ]);
    // Every other link keeps its own fields and no words: a definition's part, a setting, an aim's measure.
    expect((p.graph.edges as Rec[]).length).toBeGreaterThan(words.length);
  });

  it('Q1 reader 2: a goal or limit not calculated carries withheld_reason naming its links in words, its unsized risks and its other reason; one with no measure names what links to it', () => {
    const m = studio();
    m.goals.push({ ...m.goals[1]!, id: 'members_happy', label: 'Members are happy', measure: null, question: 'How would you tell the members are happy?', author: 'olumi', quote: null });
    m.limits.push({ id: 'neighbours', label: 'Keep the neighbours on side', measure: null, question: 'What would upset the neighbours?', author: 'olumi', quote: null, party: null, approval: 'proposed', approved_by: null, author_id: null });
    m.relations.push({ ...m.relations[2]!, id: 'evening_happy', to: 'members_happy', confidence: 'unsure', basis: null, author: 'olumi', quote: null } as CanonicalModelT['relations'][number],
      { ...m.relations[2]!, id: 'evening_neighbours', to: 'neighbours', direction: 'down', basis: 'Late classes are noisy.', author: 'olumi', quote: null } as CanonicalModelT['relations'][number]);
    m.risks.push({ ...m.risks[0]!, id: 'noise', label: 'Noise complaints', effect_on: 'members_happy' });
    const p = project(m, compile(m), { brief: STUDIO_BRIEF });
    const reason = (id: string) => (p.graph.nodes as Rec[]).find((n) => n.id === id)!.withheld_reason;
    // Every one of the compiler's reasons, each starting with a capital (DL, 28 Oct: correctness over shortening).
    expect(reason('keep_members')).toBe('Rests on "How members feel", which is not measured: No one can measure how members feel yet; repeat bookings might show it. '
      + 'Rests on the link "Evening classes → How members feel", which is in words, never calculated. Rests on the link "How members feel → members", which is in words, never calculated. '
      + 'Rests on the risk "The instructor leaves", which the calculation cannot size.');
    expect(reason('members_happy')).toBe('"Members are happy" has no measure yet, so it is left out of the chance. It is linked in words from "Evening classes → Members are happy" and the risk "Noise complaints".');
    expect(reason('mp:limit:neighbours')).toBe('"Keep the neighbours on side" has no measure yet, so the result does not cover it. It is linked in words from "Evening classes → Keep the neighbours on side".');
    // Contrast: the calculable takings aim carries none.
    expect((p.graph.nodes as Rec[]).find((n) => n.id === 'takings_goal')).not.toHaveProperty('withheld_reason');
  });

  it('assessor (28 Oct): withheld_reason keeps every one of the compiler\'s reasons: a link in words and a missing deadline; a window figure\'s own reason and a link', () => {
    const fee = (m: CanonicalModelT) => m.relations.push({ ...m.relations[3]!, id: 'fee_doubt', from: 'weekend_workshops', to: 'class_fee', direction: 'unknown', confidence: 'unknown', basis: null } as CanonicalModelT['relations'][number]);
    const reason = (m: CanonicalModelT) => (project(m, compile(m)).graph.nodes as Rec[]).find((n) => n.id === 'takings_goal')!.withheld_reason;
    // A link in words, and a setting that starts later on an aim with no deadline: both are said.
    const later = studio();
    fee(later);
    later.options = later.options.map((o) => (o.id === 'weekend_workshops' ? { ...o, sets: o.sets.map((s) => ({ ...s, starts_after_periods: 2 })) } : o));
    expect(reason(later)).toBe('Rests on the link "Weekend workshops → class fee", which is in words, never calculated. It changes over time, so it needs a deadline.');
    // A link in words, and a window whose length is a range: both, each a sentence.
    const ranged = studio();
    fee(ranged);
    ranged.quantities.push({ ...ranged.quantities.find((x) => x.id === 'members')!, id: 'duration', label: 'duration', unit: 'month', value: null, low: 2, high: 4, range_kind: 'bounds', quote: null });
    ranged.goals = ranged.goals.map((g) => (g.id === 'takings_goal' ? { ...g, measure: { ...g.measure!, window: { origin_event: null, origin_offset: null, start: 0, periods: 'duration' } } } : g));
    expect(reason(ranged)).toBe('The goal "Take £2,600 a month"\'s length "duration" is a range (2–4 month); the calculation needs one whole number of months. '
      + 'Rests on the link "Weekend workshops → class fee", which is in words, never calculated.');
  });

  it('PL (28 Oct): a goal with no measure, in a model with an error, keeps "The model has errors to fix first." beside its own reason and what links to it', () => {
    const m = studio();
    m.goals.push({ ...m.goals[1]!, id: 'members_happy', label: 'Members are happy', measure: null, question: 'How would you tell the members are happy?', author: 'olumi', quote: null });
    m.relations.push({ ...m.relations[2]!, id: 'evening_happy', to: 'members_happy', confidence: 'unsure', basis: null, author: 'olumi', quote: null } as CanonicalModelT['relations'][number]);
    const reason = (x: CanonicalModelT) => (project(x, compile(x)).graph.nodes as Rec[]).find((n) => n.id === 'members_happy')!.withheld_reason;
    const broken = structuredClone(m);
    broken.quantities.push({ ...broken.quantities[0]! }); // the id "class_fee" twice
    expect(reason(broken)).toBe('The model has errors to fix first. "Members are happy" has no measure yet, so it is left out of the chance. It is linked in words from "Evening classes → Members are happy".');
    // Contrast: with no error, its own reason and the link alone.
    expect(reason(m)).toBe('"Members are happy" has no measure yet, so it is left out of the chance. It is linked in words from "Evening classes → Members are happy".');
  });
});
