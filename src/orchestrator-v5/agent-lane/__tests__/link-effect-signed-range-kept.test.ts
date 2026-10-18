/**
 * ⭐ G3 a735 (DL-3 GO 17 Oct; e2e/VERIFY-a7357c48-unseen.md first loss; reviews/LANE-A-G3a735-trace/): a switch option's effect on
 * the goal, stated as a RANGE in the goal's unit, was saved as its low end and labelled Olumi's estimate, with no range. The stored
 * drafter output shows the AI did state the range, on THAT link, signed as the cut it is (−6 to −4 here), and sized the link at the
 * low end. The host loss: the verifier took only positive ends, so the whole statement was refused as malformed, and the user's
 * range reached no record and no reader. ⭐ GREEN CORE (DL-3 ruling B; AIE A3 13:11Z; spec §1): a drafted end of the user's range is
 * Olumi's approximation, never the user's figure. It stays Olumi's estimate with its basis; the user's range is recorded on the link
 * as theirs and said beside it. SYNTHETIC brief (an analogue of the served shape, never the brief itself).
 */
import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { figureTheUserWrote } from '../stated-by-user.js';
import { draftStatements, sourceMapOf } from '../construction-source-map.js';
import { linkHoldsStatedRange } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const GOAL = 'We want to bring daily food waste down from about 40 kg today to at most 30 kg by the end of next year.';
// The range writes the same COMPLETE unit the AI claims ("kg"): a period only the words state keeps it unconverted (R5 row below).
const RANGE = 'Our kitchen manager reckons switching on a pre-order system would cut waste by between 4 and 6 kg.';
const OTHER = 'Our supplier thinks smaller daily deliveries would cut waste by between 4 and 6 kg.';
const BRIEF = `${GOAL} ${RANGE} ${OTHER} We can afford only one of them this year.`;
/** BUDDY-A #3356 R1 B1: the same sentence in POUNDS, on the kilogram goal. */
const RANGE_LB = RANGE.replace('6 kg.', '6 lb.');
const BRIEF_LB = BRIEF.replace(RANGE, RANGE_LB);
/**
 * BUDDY-A #3356 R2 B1: a goal in metres and the sentence's own unit as written. Control: all in "metres" (a bare "6 m" reads as
 * six million). Counterexample: the goal and the statement in "m", the sentence in "mm" ("m" is a prefix of "mm").
 */
type Metres = 'metres' | 'mm' | 'borrowed';
const unitOfMetres = (w: Metres): string => (w === 'mm' ? 'm' : 'metres');
/** R3 (BUDDY-A): the range in mm, and a DIFFERENT quantity written as "6 metres" later in the same sentence. */
const writtenAfter = (w: Metres): string => (w === 'borrowed' ? '6 mm while the conveyor platform stands 6 metres high' : `6 ${w}`);
const inMetres = (text: string, written: Metres): string => text.replace('at most 30 kg', `at most 30 ${unitOfMetres(written)}`)
  .replace('about 40 kg', `about 40 ${unitOfMetres(written)}`).replace('6 kg.', `${writtenAfter(written)}.`);
const PRE = 'Pre-order system in use';
const DEL = 'Smaller daily deliveries';
const WASTE = 'Daily food waste';

interface Shape {
  readonly on?: string; readonly low?: number; readonly high?: number; readonly negated?: true; readonly size?: number; readonly drawn?: 'positive';
  readonly pounds?: true;
  /** The goal, the statement's unit and the sentence in metres; the sentence's own unit as written. */
  readonly metres?: Metres;
}
const rangeStatement = (s: Shape): Rec => ({
  quote: s.on === DEL ? OTHER : s.pounds === true ? RANGE_LB : s.metres !== undefined ? inMetres(RANGE, s.metres) : RANGE,
  subject: { kind: 'link', label: s.on ?? PRE, to_label: WASTE, factor_label: null }, field: 'effect', form: 'range', value: null,
  low: s.low ?? -6, high: s.high ?? -4, unit: s.pounds === true ? 'lb' : s.metres !== undefined ? unitOfMetres(s.metres) : 'kg', qualifier: null, conditions: null,
  ...(s.negated === true ? { negated: true } : {}),
});
function draft(s: Shape = {}): Rec {
  if (s.metres !== undefined) {
    const d = draft({ ...s, metres: undefined });
    const u = unitOfMetres(s.metres);
    const unit = (x: Rec): Rec => ({ ...x, unit: x.unit === 'kg' ? u : x.unit, quote: typeof x.quote === 'string' ? inMetres(x.quote, s.metres!) : x.quote });
    return { ...d, goal: { ...d.goal, unit: u, source_quote: inMetres(GOAL, s.metres) }, statements: [...d.statements.slice(0, 2).map(unit), rangeStatement(s)] };
  }
  const option = (label: string, factor: string): Rec => ({ label, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
    interventions: [{ factor_label: factor, value: 100, value_kind: 'absolute', unit: '%', provenance: 'explicit' }] });
  const factor = (label: string): Rec => ({ label, role: 'controllable', baseline_known: false, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 });
  return {
    goal: { kind: null, deliverable: null, metric: WASTE, operator: '<=', target_stated: true, value: 30, unit: 'kg', horizon_months: null,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 40, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: GOAL, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      option('Pre-order system', PRE), option('Smaller deliveries', DEL),
    ],
    factors: [factor(PRE), factor(DEL)],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [
      // The served shape: the drafter sizes the link at one END of the range and flags that size as its own reading.
      { from: PRE, to: WASTE, direction: s.drawn ?? 'negative', provenance: 'explicit', effect_amount: (s.drawn === 'positive' ? 1 : -1) * (s.size ?? 4), effect_per_source_change: 100,
        effect_provenance: 'inferred', definitional: null, basis: 'Uses the stated lower end as a provisional planning effect.', source_quote: RANGE },
      { from: DEL, to: WASTE, direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null,
        effect_provenance: null, definitional: null, basis: null, source_quote: null },
    ],
    statements: [
      { quote: GOAL, subject: { kind: 'goal', label: WASTE, to_label: null, factor_label: null }, field: 'level', form: 'point', value: 40, low: null, high: null, unit: 'kg', qualifier: 'about', conditions: null },
      { quote: GOAL, subject: { kind: 'goal', label: WASTE, to_label: null, factor_label: null }, field: 'target', form: 'upper_bound', value: 30, low: null, high: null, unit: 'kg', qualifier: null, conditions: null },
      rangeStatement(s),
    ],
  };
}
const admitted = (model: Rec, brief = BRIEF) => admitCandidateModel(model as CandidateModel, {}, brief, (v, u) => figureTheUserWrote(v, u, brief));
const edgeFrom = (out: { nodes: readonly Rec[]; edges: readonly Rec[] }, label: string): Rec => {
  const id = out.nodes.find((n) => n.label === label)!.id;
  return out.edges.find((e) => e.from === id)!;
};
async function registered(model: Rec, brief = BRIEF): Promise<Rec> {
  let graph: Rec | undefined;
  const r = await buildModelFromBrief('5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(model), status: 'completed' })) as never) as Rec;
  expect(r.ok, JSON.stringify(r).slice(0, 1200)).toBe(true);
  return graph!;
}

/** What the build SAYS once on its turn (`not_represented`), through the real build and register. */
async function said(model: Rec, brief = BRIEF): Promise<string[]> {
  const r = await buildModelFromBrief('5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', brief, (async (path: string) => (path.endsWith('/graph/register')
    ? { status: 200, json: { registered: true, model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } })) as never,
    (async () => ({ text: JSON.stringify(model), status: 'completed' })) as never) as Rec;
  expect(r.ok, JSON.stringify(r).slice(0, 1200)).toBe(true);
  return r.not_represented as string[];
}

const BASIS = 'Uses the stated lower end as a provisional planning effect.';
/** The sentence beside Olumi's estimate: the user's whole words as theirs, the figure used named as Olumi's separate approximation. */
const beside = (out: { loss: readonly Rec[] }): Rec | undefined => out.loss.find((l) => l.field_path.endsWith('.stated_range_beside_estimate'));
/** The sentence for a range in another unit than the link's: theirs, and why the link is not sized from it (PL 13:22Z). */
const otherUnit = (out: { loss: readonly Rec[] }): Rec | undefined => out.loss.find((l) => l.field_path.endsWith('.stated_range_other_unit'));
// The AIE's words (prompt/AIE-UNIT-REFERENCE-WORDING-20261017-v1.json, 16:04Z).
const otherUnitWords = (quote: string, unit: string): string => `"${PRE}" → "${WASTE}": "${quote}", as stated in the brief. Olumi has not `
  + `converted this range into "${unit}" for this effect. The model currently holds a separate provisional Olumi estimate, not the stated range.`;
const recordOn = (graph: Rec): Rec | undefined => {
  const pre = graph.nodes.find((n: Rec) => n.label === PRE);
  const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
  return pre.user_statements?.find((r: Rec) => r.subject_key === `link|${pre.id}|${waste.id}||effect`);
};
const savedEdge = (graph: Rec): Rec => {
  const pre = graph.nodes.find((n: Rec) => n.label === PRE);
  const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
  return graph.edges.find((e: Rec) => e.from === pre.id && e.to === waste.id);
};

describe('a stated effect range stays the user\'s, on its link, beside Olumi\'s estimate (G3 a735)', () => {
  it('⭐ RED → GREEN: the drafted low end stays Olumi\'s estimate with its basis; the user\'s range is said beside it as theirs', () => {
    const out = admitted(draft());
    const edge = edgeFrom(out, PRE);
    expect(edge.provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(edge.provenance.natural_effect?.stated_range, 'no range is claimed as the size').toBeUndefined();
    expect(beside(out)?.reason, JSON.stringify(out.loss.map((l) => l.field_path))).toBe(`"${PRE}" → "${WASTE}": "${RANGE}", as the brief puts it. `
      + `The current calculation uses a separate approximation, Olumi's: raising "${PRE}" by 100 points lowers "${WASTE}" by 4 kg, not that range.`);
    expect(beside(out)?.before).toEqual({ low: 4, high: 6, text: expect.any(String) });
  });

  it('⭐ real build → register: the saved link is Olumi\'s estimate, and the user\'s range is recorded on it as written (4 to 6)', async () => {
    const graph = await registered(draft());
    expect(savedEdge(graph).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(savedEdge(graph).provenance.natural_effect?.stated_range).toBeUndefined();
    expect(recordOn(graph), JSON.stringify(graph.nodes.find((n: Rec) => n.label === PRE).user_statements ?? null)).toMatchObject({
      attest: { recorded_by: 'construction' }, statements: [expect.objectContaining({ speaker: 'user', quote: RANGE, form: 'range', low: 4, high: 6 })] });
    const pre = graph.nodes.find((n: Rec) => n.label === PRE);
    const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
    expect(linkHoldsStatedRange(graph, pre.id, waste.id)).toBe(true);
  });

  it('CONTRAST: a range the AI writes with positive ends is verified exactly as before, and the same as the signed one', () => {
    const key = `link|${PRE.toLowerCase()}|${WASTE.toLowerCase()}||effect`;
    const signed = sourceMapOf(draftStatements(draft()), BRIEF).verified.get(key);
    const positive = sourceMapOf(draftStatements(draft({ low: 4, high: 6 })), BRIEF).verified.get(key);
    expect(sourceMapOf(draft({ low: 4, high: 6 }).statements, BRIEF).verified.get(key)).toEqual(positive);
    expect(positive).toEqual([expect.objectContaining({ form: 'range', low: 4, high: 6, quote: RANGE })]);
    expect(signed).toEqual(positive);
    const out = admitted(draft({ low: 4, high: 6 }));
    expect(edgeFrom(out, PRE).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(beside(out)).toBeDefined();
  });

  it('CONTRAST: a range across zero is still refused (the sign is never dropped where it carries meaning)', () => {
    const map = sourceMapOf(draftStatements(draft({ low: -6, high: 4 })), BRIEF);
    expect(map.refused.find((r) => r.key?.startsWith('link|'))?.refusal).toBe('statement_malformed');
  });

  it('CONTRAST: a range signed AGAINST its own link\'s direction is never the user\'s: no record, nothing said beside', async () => {
    const out = admitted(draft({ drawn: 'positive' }));
    expect(edgeFrom(out, PRE).provenance.magnitude).toBe('olumi_estimate');
    expect(beside(out)).toBeUndefined();
    const graph = await registered(draft({ drawn: 'positive' }));
    expect(recordOn(graph)).toBeUndefined();
  });

  it('CONTRAST: a denied range is never a supplied effect: nothing holds it and nothing is said beside', async () => {
    const out = admitted(draft({ negated: true }));
    expect(edgeFrom(out, PRE).provenance.magnitude).toBe('olumi_estimate');
    expect(beside(out)).toBeUndefined();
    const graph = await registered(draft({ negated: true }));
    const pre = graph.nodes.find((n: Rec) => n.label === PRE);
    const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
    expect(linkHoldsStatedRange(graph, pre.id, waste.id)).toBe(false);
  });

  it('CONTRAST: a range stated for ANOTHER link is never said beside this one; that link keeps ITEM 3\'s sentence', () => {
    const out = admitted(draft({ on: DEL }));
    expect(edgeFrom(out, PRE).provenance).toMatchObject({ magnitude: 'olumi_estimate' });
    expect(out.loss.filter((l) => l.field_path.endsWith('.stated_range_beside_estimate'))).toEqual([]);
    expect(edgeFrom(out, DEL).provenance.magnitude).toBe('olumi_placeholder');
    const said = out.loss.filter((l) => l.field_path.endsWith('.stated_range_unsized'));
    expect(said, JSON.stringify(out.loss.map((l) => l.field_path))).toEqual([expect.objectContaining({ before: { low: 4, high: 6, text: expect.any(String) } })]);
    expect(said[0]!.reason).toContain(`"${DEL}" → "${WASTE}" is: "${OTHER}"`);
  });

  it('an Olumi size INSIDE the user\'s range (no end) is Olumi\'s estimate too, said beside their range', () => {
    const out = admitted(draft({ size: 5 }));
    expect(edgeFrom(out, PRE).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(beside(out)?.reason).toContain('lowers "Daily food waste" by 5 kg, not that range.');
  });

  it('⛔ BUDDY-A #3356 R1 contrast, real build → register: a range in POUNDS on a kilogram goal is never sized in kg: Olumi\'s placeholder, the range kept in lb', async () => {
    const out = admitted(draft({ pounds: true }), BRIEF_LB);
    expect(edgeFrom(out, PRE).provenance.magnitude).toBe('olumi_placeholder');
    expect(edgeFrom(out, PRE).provenance.natural_effect?.amount, 'no −4 kg taken from "4 to 6 lb"').toBeUndefined();
    expect(otherUnit(out)?.reason).toBe(otherUnitWords(RANGE_LB, 'kg'));
    expect(beside(out), 'never said as a range of this link\'s unit').toBeUndefined();
    const graph = await registered(draft({ pounds: true }), BRIEF_LB);
    expect(savedEdge(graph).provenance.magnitude).toBe('olumi_placeholder');
    expect(savedEdge(graph).provenance.natural_effect?.stated_range).toBeUndefined();
    // The user's words stay theirs, in the unit they wrote.
    expect(recordOn(graph)?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: RANGE_LB, form: 'range', low: 4, high: 6, unit: 'lb' })]);
  });

  it('⛔ BUDDY-A #3356 R2 contrast, real build → register: a range written in mm on a metre goal is never read in m: Olumi\'s placeholder, no record in m', async () => {
    const brief = inMetres(BRIEF, 'mm');
    const out = admitted(draft({ metres: 'mm' }), brief);
    expect(edgeFrom(out, PRE).provenance.magnitude).toBe('olumi_placeholder');
    expect(otherUnit(out)?.reason).toBe(otherUnitWords(inMetres(RANGE, 'mm'), 'm'));
    const key = `link|${PRE.toLowerCase()}|${WASTE.toLowerCase()}||effect`;
    const map = sourceMapOf(draftStatements(draft({ metres: 'mm' })), brief);
    // ⛔ BUDDY-A #3356 R5 B2: kept whole, with NO unit (never "m"), and never refused, so the licence still sees the user's range.
    expect(map.verified.get(key)).toEqual([expect.objectContaining({ form: 'range', low: 4, high: 6, unit: '', quote: inMetres(RANGE, 'mm') })]);
    expect(map.refused.find((r) => r.key === key)).toBeUndefined();
    const graph = await registered(draft({ metres: 'mm' }), brief);
    expect(savedEdge(graph).provenance.magnitude).toBe('olumi_placeholder');
    expect(savedEdge(graph).provenance.natural_effect?.stated_range).toBeUndefined();
    expect(recordOn(graph)?.statements, 'the human range, never in m').toEqual([expect.objectContaining({ speaker: 'user', quote: inMetres(RANGE, 'mm'), form: 'range', low: 4, high: 6, unit: '' })]);
    expect(linkHoldsStatedRange(graph, savedEdge(graph).from, savedEdge(graph).to), 'the licence withholds the chance resting on it').toBe(true);
  });

  it('⛔ BUDDY-A #3356 R3 + PL 13:22Z, real build → register: "4 and 6 mm … a platform 6 metres high": no human range in metres, no −4 metres size', async () => {
    const brief = inMetres(BRIEF, 'borrowed');
    expect(brief).toContain('between 4 and 6 mm while the conveyor platform stands 6 metres high');
    const out = admitted(draft({ metres: 'borrowed' }), brief);
    expect(edgeFrom(out, PRE).provenance.magnitude).toBe('olumi_placeholder');
    expect(edgeFrom(out, PRE).provenance.natural_effect?.amount, 'an unrelated six never supplies the unit').toBeUndefined();
    expect(otherUnit(out)?.reason).toBe(otherUnitWords(inMetres(RANGE, 'borrowed'), 'metres'));
    expect(beside(out)).toBeUndefined();
    const graph = await registered(draft({ metres: 'borrowed' }), brief);
    expect(savedEdge(graph).provenance.magnitude).toBe('olumi_placeholder');
    expect(recordOn(graph)?.statements, 'the human range, never in metres').toEqual([expect.objectContaining({ form: 'range', low: 4, high: 6, unit: '' })]);
    expect(linkHoldsStatedRange(graph, savedEdge(graph).from, savedEdge(graph).to)).toBe(true);
  });

  it('⛔ BUDDY-A #3356 R5 B1/B2, real build → register: "4 and 6 kg per week" (claimed kg per day, or kg), "kg a day" claimed kg, and "6 crates" beside "10 kg" are never the link\'s unit: kept whole with none, the chance withheld', async () => {
    const cases = [
      { words: 'between 4 and 6 kg per week', claimed: 'kg per day', goal: 'kg per day' },
      // A period only the words state: the AI's shortened claim never makes the two agree (BUDDY-A 16:19Z AMEND 2).
      { words: 'between 4 and 6 kg per week', claimed: 'kg', goal: 'kg' },
      { words: 'between 4 and 6 kg a day', claimed: 'kg', goal: 'kg' },
      { words: 'between 4 and 6 crates, with each crate weighing 10 kg', claimed: 'kg', goal: 'kg' },
      { words: 'between 4 and 6 lb a day', claimed: 'kg', goal: 'kg' },
      // BUDDY-A R6: a contained denominator is never the same rate.
      { words: 'between 4 and 6 kg per new client', claimed: 'kg per client', goal: 'kg per client' },
      // BUDDY-A R6: money is read by the same tail reader: a weekly saving is never a daily one.
      { words: 'between £4 and £6 a week', claimed: '£ per day', goal: '£ per day' },
      // BUDDY-A R7: a noun with other words is another population.
      { words: 'between 4 and 6 non-paying visitors', claimed: 'paying visitors', goal: 'paying visitors' },
      // BUDDY-A R8: "each" is per one unnamed item, never a total: no end of it becomes a −4 £ saving on a total.
      { words: 'between £4 and £6 each', claimed: '£', goal: '£' },
    ];
    for (const c of cases) {
      const range = RANGE.replace('between 4 and 6 kg', c.words);
      const brief = BRIEF.replace(RANGE, range).replaceAll('40 kg', `40 ${c.goal}`).replaceAll('30 kg', `30 ${c.goal}`);
      const d = draft();
      const model = { ...d, goal: { ...d.goal, unit: c.goal, source_quote: GOAL.replaceAll(' kg', ` ${c.goal}`) },
        statements: [...d.statements.slice(0, 2).map((x: Rec) => ({ ...x, unit: c.goal, quote: GOAL.replaceAll(' kg', ` ${c.goal}`) })),
          { ...rangeStatement({}), quote: range, unit: c.claimed }],
        links: d.links.map((l: Rec) => (l.from === PRE ? { ...l, source_quote: range } : l)) };
      const out = admitted(model, brief);
      expect(edgeFrom(out, PRE).provenance.magnitude, c.words).toBe('olumi_placeholder');
      // Olumi's placeholder may carry its own size (a money goal's is sized to its range); never an end of the user's range.
      expect([4, 6], `${c.words}: no end of the range in ${c.goal}`).not.toContain(Math.abs(edgeFrom(out, PRE).provenance.natural_effect?.amount ?? 0));
      expect(otherUnit(out)?.reason, c.words).toBe(otherUnitWords(range, c.goal));
      const graph = await registered(model, brief);
      expect(recordOn(graph)?.statements, c.words).toEqual([expect.objectContaining({ speaker: 'user', quote: range, form: 'range', low: 4, high: 6, unit: '' })]);
      expect(linkHoldsStatedRange(graph, savedEdge(graph).from, savedEdge(graph).to), c.words).toBe(true);
    }
  });

  it('PL 13:22Z, real build → register: a REAL point the user wrote in the link\'s own unit survives, even inside a range they gave in another unit', async () => {
    const POINT = 'In our trial the pre-order system in use cut daily food waste by 5 kg a day.';
    const brief = `${BRIEF_LB} ${POINT}`;
    const d = draft({ pounds: true });
    const model = { ...d, links: d.links.map((l: Rec) => (l.from === PRE ? { ...l, effect_amount: -5, effect_provenance: 'explicit', basis: null, source_quote: POINT } : l)) };
    const graph = await registered(model, brief);
    expect(savedEdge(graph).provenance.magnitude, JSON.stringify(savedEdge(graph).provenance)).toBe('user_stated');
    expect(savedEdge(graph).provenance.natural_effect).toMatchObject({ amount: -5 });
  });

  it('same-unit metres control: Olumi\'s estimate, the user\'s metres range recorded beside it (no unit makes a drafted end the user\'s)', async () => {
    expect(otherUnit(admitted(draft({ metres: 'metres' }), inMetres(BRIEF, 'metres'))), 'the same unit is never set aside').toBeUndefined();
    const graph = await registered(draft({ metres: 'metres' }), inMetres(BRIEF, 'metres'));
    expect(savedEdge(graph).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(recordOn(graph)?.statements).toEqual([expect.objectContaining({ form: 'range', low: 4, high: 6, unit: 'metres' })]);
  });

  /**
   * ⭐ A3 (T01, G3 unseen 8e9132fc: "the engineers' 6–10 saving held at its low end as Olumi's; the user was never told"). The
   * sentences above were computed at admission and never said: the build's one list of what it says (`not_represented`) left out
   * both codes. The build now says them, once, in the AIE's words.
   */
  /** Every sentence the build says about THIS link's range, beside or set aside (exact, so a repeat shows). */
  const aboutPre = (lines: readonly string[]): string[] => lines.filter((x) => x.startsWith(`"${PRE}" → "${WASTE}": `));
  it('⭐ A3: the build SAYS the user\'s range beside Olumi\'s estimate, once, and why an estimate in another unit was set aside, once', async () => {
    expect(aboutPre(await said(draft()))).toEqual([beside(admitted(draft()))!.reason]);
    expect(aboutPre(await said(draft({ pounds: true }), BRIEF_LB))).toEqual([otherUnitWords(RANGE_LB, 'kg')]);
  });

  it('A3 CONTRAST: the user\'s own point, a denied range, and a range stated for another link say nothing beside this link', async () => {
    const POINT = 'In our trial the pre-order system in use cut daily food waste by 5 kg a day.';
    const d = draft();
    const own = { ...d, links: d.links.map((l: Rec) => (l.from === PRE ? { ...l, effect_amount: -5, effect_provenance: 'explicit', basis: null, source_quote: POINT } : l)) };
    expect(aboutPre(await said(own, `${BRIEF} ${POINT}`))).toEqual([]);
    expect(aboutPre(await said(draft({ negated: true })))).toEqual([]);
    expect(aboutPre(await said(draft({ on: DEL })))).toEqual([]);
  });
});
