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
const RANGE = 'Our kitchen manager reckons switching on a pre-order system would cut waste by between 4 and 6 kg a day.';
const OTHER = 'Our supplier thinks smaller daily deliveries would cut waste by between 4 and 6 kg a day.';
const BRIEF = `${GOAL} ${RANGE} ${OTHER} We can afford only one of them this year.`;
/** BUDDY-A #3356 R1 B1: the same sentence in POUNDS, on the kilogram goal. */
const RANGE_LB = RANGE.replace('kg a day', 'lb a day');
const BRIEF_LB = BRIEF.replace(RANGE, RANGE_LB);
/**
 * BUDDY-A #3356 R2 B1: a goal in metres and the sentence's own unit as written. Control: all in "metres" (a bare "6 m" reads as
 * six million). Counterexample: the goal and the statement in "m", the sentence in "mm" ("m" is a prefix of "mm").
 */
type Metres = 'metres' | 'mm' | 'borrowed';
const unitOfMetres = (w: Metres): string => (w === 'mm' ? 'm' : 'metres');
/** R3 (BUDDY-A): the range in mm, and a DIFFERENT quantity written as "6 metres" later in the same sentence. */
const writtenAfter = (w: Metres): string => (w === 'borrowed' ? '6 mm a day while the conveyor platform stands 6 metres high' : `6 ${w} a day`);
const inMetres = (text: string, written: Metres): string => text.replace('at most 30 kg', `at most 30 ${unitOfMetres(written)}`)
  .replace('about 40 kg', `about 40 ${unitOfMetres(written)}`).replace('6 kg a day', writtenAfter(written));
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

const BASIS = 'Uses the stated lower end as a provisional planning effect.';
/** The sentence beside Olumi's estimate: the user's whole words as theirs, the figure used named as Olumi's separate approximation. */
const beside = (out: { loss: readonly Rec[] }): Rec | undefined => out.loss.find((l) => l.field_path.endsWith('.stated_range_beside_estimate'));
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

  it('⛔ BUDDY-A #3356 R1 contrast, real build → register: a range in POUNDS on a kilogram goal: Olumi\'s estimate, the range kept in lb', async () => {
    const out = admitted(draft({ pounds: true }), BRIEF_LB);
    expect(edgeFrom(out, PRE).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(beside(out)?.reason).toContain(`"${RANGE_LB}", as the brief puts it`);
    const graph = await registered(draft({ pounds: true }), BRIEF_LB);
    expect(savedEdge(graph).provenance.magnitude).toBe('olumi_estimate');
    expect(savedEdge(graph).provenance.natural_effect?.stated_range).toBeUndefined();
    expect(recordOn(graph)?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: RANGE_LB, form: 'range', low: 4, high: 6, unit: 'lb' })]);
  });

  it('⛔ BUDDY-A #3356 R2 contrast, real build → register: a range written in mm on a metre goal: Olumi\'s estimate, its basis kept', async () => {
    const graph = await registered(draft({ metres: 'mm' }), inMetres(BRIEF, 'mm'));
    expect(savedEdge(graph).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(savedEdge(graph).provenance.natural_effect?.stated_range).toBeUndefined();
  });

  it('⛔ BUDDY-A #3356 R3 contrast, real build → register: "4 and 6 mm … a platform 6 metres high" on a metre goal: Olumi\'s estimate', async () => {
    const brief = inMetres(BRIEF, 'borrowed');
    expect(brief).toContain('between 4 and 6 mm a day while the conveyor platform stands 6 metres high');
    const graph = await registered(draft({ metres: 'borrowed' }), brief);
    expect(savedEdge(graph).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(savedEdge(graph).provenance.natural_effect?.stated_range).toBeUndefined();
  });

  it('same-unit metres control: Olumi\'s estimate, the user\'s metres range recorded beside it (no unit makes a drafted end the user\'s)', async () => {
    const graph = await registered(draft({ metres: 'metres' }), inMetres(BRIEF, 'metres'));
    expect(savedEdge(graph).provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: BASIS });
    expect(recordOn(graph)?.statements).toEqual([expect.objectContaining({ form: 'range', low: 4, high: 6, unit: 'metres' })]);
  });
});
