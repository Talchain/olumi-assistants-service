/**
 * ⭐ G3 a735 (DL-3 GO 17 Oct; e2e/VERIFY-a7357c48-unseen.md first loss; reviews/LANE-A-G3a735-trace/): a switch option's effect on
 * the goal, stated as a RANGE in the goal's unit, was saved as its low end and labelled Olumi's estimate, with no range. The stored
 * drafter output shows the AI did state the range, on THAT link, signed as the cut it is (−6 to −4 here), and sized the link at the
 * low end. Two host losses: the verifier took only positive ends, so the whole statement was refused as malformed; and the size's
 * author came from the drafter's own flag (`inferred`), never from the verified statement (CONTRACT A: one authorship owner).
 * SYNTHETIC brief (an analogue of the served shape, never the brief itself).
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
const PRE = 'Pre-order system in use';
const DEL = 'Smaller daily deliveries';
const WASTE = 'Daily food waste';

interface Shape {
  readonly on?: string; readonly low?: number; readonly high?: number; readonly negated?: true; readonly size?: number; readonly drawn?: 'positive';
  readonly pounds?: true;
}
const rangeStatement = (s: Shape): Rec => ({
  quote: s.on === DEL ? OTHER : s.pounds === true ? RANGE_LB : RANGE, subject: { kind: 'link', label: s.on ?? PRE, to_label: WASTE, factor_label: null },
  field: 'effect', form: 'range', value: null, low: s.low ?? -6, high: s.high ?? -4, unit: s.pounds === true ? 'lb' : 'kg', qualifier: null, conditions: null,
  ...(s.negated === true ? { negated: true } : {}),
});
function draft(s: Shape = {}): Rec {
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

describe('a stated effect range stays the user\'s, on its link (G3 a735)', () => {
  it('⭐ RED → GREEN: the drafted low end of the AI\'s verified range is said WITH that range, never as Olumi\'s estimate', () => {
    const out = admitted(draft());
    const edge = edgeFrom(out, PRE);
    expect(edge.provenance.magnitude).toBe('user_stated');
    expect(edge.provenance.natural_effect).toMatchObject({ amount: -4, amount_unit: 'kg', stated_range: { low: 4, high: 6, end: 'low' } });
    expect(edge.provenance.basis).toBeUndefined();
    // Said as the brief reports it, whole, and the figure the calculation uses is named as a separate approximation.
    const note = out.loss.find((l) => l.field_path.endsWith('.stated_range_end'));
    expect(note?.reason, JSON.stringify(out.loss.map((l) => l.field_path))).toContain(`"${RANGE}", as the brief puts it`);
    expect(note!.reason).toContain('The current calculation uses a separate approximation');
  });

  it('⭐ real build → register: the saved link carries the range, and the user\'s range is recorded on it as written (4 to 6)', async () => {
    const graph = await registered(draft());
    const pre = graph.nodes.find((n: Rec) => n.label === PRE);
    const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
    const edge = graph.edges.find((e: Rec) => e.from === pre.id && e.to === waste.id);
    expect(edge.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: -4, stated_range: { low: 4, high: 6, end: 'low' } } });
    const record = pre.user_statements?.find((r: Rec) => r.subject_key === `link|${pre.id}|${waste.id}||effect`);
    expect(record, JSON.stringify(pre.user_statements ?? null)).toMatchObject({ attest: { recorded_by: 'construction' },
      statements: [expect.objectContaining({ speaker: 'user', quote: RANGE, form: 'range', low: 4, high: 6 })] });
    expect(linkHoldsStatedRange(graph, pre.id, waste.id)).toBe(true);
  });

  it('⛔ BUDDY-A #3356 R1 B1, real build → register: a range in POUNDS on a kilogram goal never makes the drafted −4 kg the user\'s; their range is kept with its own unit', async () => {
    const edge = edgeFrom(admitted(draft({ pounds: true }), BRIEF_LB), PRE);
    expect(edge.provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: 'Uses the stated lower end as a provisional planning effect.' });
    expect(edge.provenance.natural_effect?.stated_range).toBeUndefined();
    const graph = await registered(draft({ pounds: true }), BRIEF_LB);
    const pre = graph.nodes.find((n: Rec) => n.label === PRE);
    const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
    const saved = graph.edges.find((e: Rec) => e.from === pre.id && e.to === waste.id);
    expect(saved.provenance.magnitude).toBe('olumi_estimate');
    expect(saved.provenance.natural_effect?.stated_range).toBeUndefined();
    // The user's own words and range stay on the link, in pounds, as theirs.
    const record = pre.user_statements?.find((r: Rec) => r.subject_key === `link|${pre.id}|${waste.id}||effect`);
    expect(record?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: RANGE_LB, form: 'range', low: 4, high: 6, unit: 'lb' })]);
  });

  it('CONTRAST: a range the AI writes with positive ends is verified exactly as before, and the same as the signed one', () => {
    const key = `link|${PRE.toLowerCase()}|${WASTE.toLowerCase()}||effect`;
    const signed = sourceMapOf(draftStatements(draft()), BRIEF).verified.get(key);
    const positive = sourceMapOf(draftStatements(draft({ low: 4, high: 6 })), BRIEF).verified.get(key);
    // The raw positive range is the same statement as the AI's (no rewrite reaches it).
    expect(sourceMapOf(draft({ low: 4, high: 6 }).statements, BRIEF).verified.get(key)).toEqual(positive);
    expect(positive).toEqual([expect.objectContaining({ form: 'range', low: 4, high: 6, quote: RANGE })]);
    expect(signed).toEqual(positive);
    expect(edgeFrom(admitted(draft({ low: 4, high: 6 })), PRE).provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { stated_range: { low: 4, high: 6 } } });
  });

  it('CONTRAST: a range across zero is still refused (the sign is never dropped where it carries meaning)', () => {
    const map = sourceMapOf(draftStatements(draft({ low: -6, high: 4 })), BRIEF);
    expect(map.refused.find((r) => r.key?.startsWith('link|'))?.refusal).toBe('statement_malformed');
  });

  it('CONTRAST: a range signed AGAINST its own link\'s direction is never the user\'s, and sizes nothing', async () => {
    // The AI drew the link as raising waste, yet wrote the range as a cut: a contradiction, refused as before (no sign is guessed).
    const out = admitted(draft({ drawn: 'positive' }));
    expect(edgeFrom(out, PRE).provenance.magnitude).toBe('olumi_estimate');
    expect(edgeFrom(out, PRE).provenance.natural_effect?.stated_range).toBeUndefined();
    const graph = await registered(draft({ drawn: 'positive' }));
    const pre = graph.nodes.find((n: Rec) => n.label === PRE);
    const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
    expect(linkHoldsStatedRange(graph, pre.id, waste.id)).toBe(false);
  });

  it('CONTRAST: a denied range is never a supplied effect: the drafted end stays Olumi\'s, and nothing holds a range', async () => {
    const edge = edgeFrom(admitted(draft({ negated: true })), PRE);
    expect(edge.provenance.magnitude).toBe('olumi_estimate');
    expect(edge.provenance.natural_effect?.stated_range).toBeUndefined();
    const graph = await registered(draft({ negated: true }));
    const pre = graph.nodes.find((n: Rec) => n.label === PRE);
    const waste = graph.nodes.find((n: Rec) => n.label === WASTE);
    expect(linkHoldsStatedRange(graph, pre.id, waste.id)).toBe(false);
  });

  it('CONTRAST: a range stated for ANOTHER link never sizes this one, though the drafted figure equals one of its ends', () => {
    const out = admitted(draft({ on: DEL }));
    expect(edgeFrom(out, PRE).provenance).toMatchObject({ magnitude: 'olumi_estimate' });
    expect(edgeFrom(out, PRE).provenance.natural_effect?.stated_range).toBeUndefined();
    // The other link keeps the ranged-but-unsized contract (ITEM 3): Olumi's placeholder, said once against the user's range.
    expect(edgeFrom(out, DEL).provenance.magnitude).toBe('olumi_placeholder');
    const said = out.loss.filter((l) => l.field_path.endsWith('.stated_range_unsized'));
    expect(said, JSON.stringify(out.loss.map((l) => l.field_path))).toEqual([expect.objectContaining({ before: { low: 4, high: 6, text: expect.any(String) } })]);
    expect(said[0]!.reason).toContain(`"${DEL}" → "${WASTE}" is: "${OTHER}"`);
  });

  it('CONTRAST: an Olumi size that is no END of the user\'s range stays Olumi\'s estimate, with its basis', () => {
    const edge = edgeFrom(admitted(draft({ size: 5 })), PRE);
    expect(edge.provenance).toMatchObject({ magnitude: 'olumi_estimate', basis: 'Uses the stated lower end as a provisional planning effect.' });
    expect(edge.provenance.natural_effect?.stated_range).toBeUndefined();
  });
});
