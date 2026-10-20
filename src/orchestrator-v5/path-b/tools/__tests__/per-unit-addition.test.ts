/** L15: synthetic strict-output replays through the legacy B conversion and the real Run request, no provider or PLoT calls.
 * The user owns the central effect/raw range; existing D3 defaults remain Olumi illustrative assumptions.
 */
import { describe, expect, it, vi } from 'vitest';
import captured from './fixtures/l18-captured-sum.json';
import liveRows from './fixtures/l23-live-drafter-raw-5203fed5.json';
import { normaliseFactorValue } from '../../../tools/handlers/d1-shared/normalise-factor-value.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { admitCandidateModel, type CandidateModel } from '../../../agent-lane/admit-model.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { linkProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';

type Rec = Record<string, any>;
const SID = 'c1c1c1c1-0000-4000-8000-000000000015';
const UNIT = 'tickets per week';
const TODAY = 'The existing team clears 80 tickets per week.';
const EFFECT = 'Each extra specialist clears about 20 tickets per week, between 10 and 30.';
const SUM = 'Total capacity is the existing capacity plus the extra capacity.';
const BRIEF = `${TODAY} ${EFFECT} ${SUM} Hold adds 0 specialists. Grow adds 1 specialist. Our target is 100 tickets per week.`;
const said = (quote: string, subject: Rec, field: string, value: number, unit: string, extra: Rec = {}): Rec => ({
  quote, subject: { to_label: null, factor_label: null, ...subject }, field, form: 'point', value, low: null, high: null,
  unit, qualifier: null, conditions: null, speaker: 'user', ...extra,
});
const factor = (label: string, value: number, unit: string, origin = 'olumi'): Rec => ({ label, role: 'observable',
  baseline_known: true, baseline_value: value, unit, origin, stance: 'stated_current', provenance: 'inferred',
  plausible_max: null, baseline_evidence: null });
const link = (from: string, to: string, amount: number, origin = 'olumi', definitional = false): Rec => ({
  from, to, direction: 'positive', provenance: 'inferred', origin, stance: 'estimate', effect_amount: amount,
  effect_per_source_change: 1, effect_provenance: origin === 'user' ? 'explicit' : 'inferred', definitional,
  basis: null, source_quote: origin === 'user' ? EFFECT : SUM,
});
function draft(statementUnit = `${UNIT} per specialist`): Rec {
  return {
    goal: { metric: 'Total capacity', kind: null, deliverable: null, operator: '>=', target_stated: true, value: 100, unit: UNIT,
      horizon_months: null, provenance: 'explicit', frame: 'level', quantity_frame: 'level', baseline_known: true, baseline_value: 80,
      baseline_provenance: 'explicit', baseline_origin: 'user', baseline_stance: 'stated_current', target_origin: 'user', target_stance: 'target',
      source_quote: 'Our target is 100 tickets per week.', scope: null, basis: null },
    constraints: [], risks: [], outcomes: [], unknowns: [], unknown_concerns: [], decision_question: null,
    factors: [
      { ...factor('Existing capacity', 80, UNIT, 'user'), provenance: 'explicit', baseline_evidence: { quote: TODAY } },
      { ...factor('Extra specialists', 0, 'specialists'), role: 'controllable' },
      factor('Extra capacity', 0, UNIT),
    ],
    options: [
      { label: 'Hold', provenance: 'explicit', changes: [], interventions: [], is_status_quo: true, added_capacity: null },
      { label: 'Grow', provenance: 'explicit', changes: [], is_status_quo: false, added_capacity: null,
        interventions: [{ factor_label: 'Extra specialists', value: 1, value_kind: 'absolute', unit: 'specialists', provenance: 'explicit',
          origin: 'user', stance: 'hypothetical', stated_evidence: null }] },
    ],
    links: [link('Existing capacity', 'Total capacity', 1, 'olumi', true),
      link('Extra specialists', 'Extra capacity', 20, 'user'), link('Extra capacity', 'Total capacity', 1, 'olumi', true)],
    identities: [{ operation: 'sum', outcome: 'Total capacity', factors: ['Existing capacity', 'Extra capacity'],
      provenance: 'inferred', reading: null, evidence: null }],
    statements: [said(TODAY, { kind: 'factor', label: 'Existing capacity' }, 'level', 80, UNIT),
      said(TODAY, { kind: 'goal', label: 'Total capacity' }, 'level', 80, UNIT),
      said('Our target is 100 tickets per week.', { kind: 'goal', label: 'Total capacity' }, 'target', 100, UNIT),
      said('Grow adds 1 specialist.', { kind: 'option', label: 'Grow', factor_label: 'Extra specialists' }, 'level', 1, 'specialists'),
      said(EFFECT, { kind: 'link', label: 'Extra specialists', to_label: 'Extra capacity' }, 'effect', 20, statementUnit,
        { form: 'range', low: 10, high: 30, qualifier: 'about' })],
  };
}
/** The drafter bytes through the legacy B converter, kept as the spec the thin-core mapper must reach (sums, per-unit additions). */
async function replay(raw: Rec | string, brief = BRIEF): Promise<Rec> {
  const converted = candidateToGraph(typeof raw === 'string' ? JSON.parse(raw) : raw, { words: brief, recorded_at: '2026-10-20T08:00:00.000Z' });
  expect('refused' in converted, JSON.stringify(converted)).toBe(false);
  return GraphV3.parse((converted as { graph: Rec }).graph) as Rec;
}
const effectOf = (g: Rec): Rec => g.edges.find((e: Rec) => e.from === 'extra_specialists' && e.to === 'extra_capacity');
async function runRequest(graph: Rec, brief: string): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-l15', {
    loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: brief, revision: 1 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  } as never);
  let payload: Rec | undefined;
  const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot, probe: async (sent) => { payload = sent.plotPayload as Rec; } });
  await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
    session_id: SID, request_id: 'req-l15', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
    scenarioBriefText: null, persistedGraph: null },
  payload: makeMessagePayload({ turn_id: 't-l15', scenario_id: SID, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
  requestId: 'req-l15', signal: new AbortController().signal, orientationText: '' } as never);
  expect(payload).toBeDefined();
  return payload!;
}

describe('current level plus a stated per-unit addition', () => {
  it('L18 capture: the captured draft-graph quantities survive reconstructed B draft/save/Run conversion', async () => {
    // The capture has draft_graph, not raw strict drafter bytes. Reconstruct ONLY its declared numeric/identity shape.
    const renames = [['Total capacity', captured.goal.label], ['Existing capacity', captured.factors[0].label],
      ['Extra specialists', captured.factors[1].label], ['Extra capacity', captured.factors[2].label],
      ['Hold', captured.options[0].label], ['Grow', captured.options[1].label]];
    let rawText = JSON.stringify(draft());
    for (const [before, after] of renames) rawText = rawText.replaceAll(before!, after!);
    const raw = JSON.parse(rawText);
    raw.statements = [];
    raw.factors.forEach((f: Rec, index: number) => {
      const os: Rec = captured.factors[index]!.observed_state;
      Object.assign(f, { baseline_value: os.raw_value ?? os.value, unit: os.unit, plausible_max: os.cap ?? null });
    });
    raw.links[1].effect_amount = captured.rate.value;
    raw.links[1].source_quote = captured.rate.quote;
    const graph = await replay(raw, captured.brief);
    const request = await runRequest(graph, captured.brief);
    const goal = request.graph.nodes.find((n: Rec) => n.id === captured.goal.id);
    const zero = request.graph.nodes.find((n: Rec) => n.id === captured.factors[2].id);
    expect(goal.nonlinear_identity).toEqual(captured.identity);
    expect(goal.goal_threshold_cap).toBe(captured.goal.goal_threshold_cap);
    expect(zero.scale_frame ?? zero.observed_state.cap).toBe(captured.goal.goal_threshold_cap);
    expect(zero.observed_state.value).toBe(captured.factors[2].observed_state.value);
    expect(zero.observed_state.source).toBe(captured.factors[2].observed_state.source);
    expect(zero.observed_state.std).toBeUndefined();
    for (const id of captured.identity.factor_ids) {
      const operand = request.graph.nodes.find((n: Rec) => n.id === id);
      expect(operand.scale_frame ?? operand.observed_state.cap).toBeGreaterThan(0);
    }
  });

  it.each(['tickets', 'parcels'])('L18 %s: every sum operand has an explicit frame in the saved Run request', async quantity => {
    const raw = JSON.parse(JSON.stringify(draft()).replaceAll('tickets', quantity));
    const brief = BRIEF.replaceAll('tickets', quantity);
    const graph = await replay(raw, brief);
    const request = await runRequest(graph, brief);
    const goal = request.graph.nodes.find((n: Rec) => n.kind === 'goal');
    const zero = request.graph.nodes.find((n: Rec) => n.id === 'extra_capacity');
    expect(goal.nonlinear_identity).toEqual({ operation: 'sum', factor_ids: ['existing_capacity', 'extra_capacity'], stated_in_brief: false });
    // PLoT resolveNodeFrame: positive explicit cap/scale_frame; a zero cannot recover raw/value.
    for (const id of goal.nonlinear_identity.factor_ids) {
      const node = request.graph.nodes.find((n: Rec) => n.id === id);
      const frame = node.scale_frame ?? node.observed_state?.cap;
      expect(Number.isFinite(frame) && frame > 0).toBe(true);
    }
    expect(zero.scale_frame ?? zero.observed_state.cap).toBe(goal.goal_threshold_cap);
    expect(zero.observed_state).toMatchObject({ value: 0, source: 'cee_inference', extractionType: 'inferred' });
    expect(zero.observed_state.std).toBeUndefined();
    expect(graph.nodes.find((n: Rec) => n.id === 'existing_capacity').observed_state.raw_value).toBe(80);
    expect(graph.edges.filter((e: Rec) => e.to === goal.id).map((e: Rec) => e.exists_probability)).toEqual([1, 1]);
    expect(effectOf(graph).provenance.natural_effect.amount).toBe(20);
  });

  it.each(['parcels per week', 'tickets per day', null])('L18 negative: an operand in %s inherits no goal frame or neighbouring frame', async unit => {
    const raw = draft();
    raw.factors[2].unit = unit;
    raw.factors.push(factor('Unrelated queue', 0, UNIT));
    const graph = await replay(raw);
    const zero = graph.nodes.find((n: Rec) => n.id === 'extra_capacity');
    expect(zero.scale_frame).toBeUndefined();
    expect(zero.observed_state.cap).toBeUndefined();
    const unrelated = graph.nodes.find((n: Rec) => n.id === 'unrelated_queue');
    expect(unrelated.scale_frame).toBeUndefined();
    expect(unrelated.observed_state.cap).toBeUndefined();
    expect(graph.nodes.find((n: Rec) => n.kind === 'goal').nonlinear_identity).toBeUndefined();
    const converted = candidateToGraph(raw, { words: BRIEF, recorded_at: '2026-10-20T08:00:00.000Z' });
    if ('refused' in converted) throw new Error(converted.refused);
    expect(converted.loss.some(row => row.field_path === 'nodes[total_capacity].nonlinear_identity_rejected' && row.severity === 'warn')).toBe(true);
  });

  it('L18 preserves an existing operand frame rather than replacing it with the goal frame', async () => {
    const raw = draft();
    raw.factors[2].plausible_max = 50;
    raw.factors.push(factor('Unrelated queue', 0, UNIT));
    const graph = await replay(raw);
    const zero = graph.nodes.find((n: Rec) => n.id === 'extra_capacity');
    expect(zero.scale_frame ?? zero.observed_state.cap).toBe(50);
    const unrelated = graph.nodes.find((n: Rec) => n.id === 'unrelated_queue');
    expect(unrelated.scale_frame ?? unrelated.observed_state.cap).toBeUndefined();
    expect(zero.observed_state.value).toBe(0);
  });

  it.each([
    ['support', BRIEF, draft()],
    ['packing', BRIEF.replaceAll('tickets', 'parcels').replaceAll('specialist', 'packer'),
      JSON.parse(JSON.stringify(draft()).replaceAll('tickets', 'parcels').replaceAll('specialist', 'packer'))],
  ])('%s retains the user central rate/raw range, Olumi D3 defaults and exact sum', async (_name, brief, raw) => {
    const graph = await replay(raw as Rec, brief as string);
    const rate = graph.edges.find((e: Rec) => e.to === 'extra_capacity' && e.from !== 'existing_capacity');
    expect(rate.provenance.magnitude).toBe('user_stated');
    expect(linkProvenanceOf(rate).origin).toBe('human');
    expect(rate.provenance.natural_effect.amount).toBe(20);
    expect(rate.strength.std).toBe(Math.abs(rate.strength.mean) / 2);
    expect(rate.exists_probability).toBe(0.8);
    const defaults = linkDefaultAssumptionsOf(rate);
    expect(defaults.map(d => ({ field: d.field_path, before: d.before, after: d.after }))).toEqual([
      { field: `edges[${rate.from}::${rate.to}].strength.std`, before: null, after: rate.strength.std },
      { field: `edges[${rate.from}::${rate.to}].exists_probability`, before: null, after: 0.8 },
    ]);
    expect(defaults[0].reason).toBe('Nobody stated how uncertain this strength is. Olumi uses half its size as the spread. It is not a measurement of anyone\'s confidence.');
    expect(defaults[1].reason).toBe('Nobody stated how likely this link is to exist. Applied the canonical default. A defaulted value and an elicited value are the same number, so the ledger is the only place the difference survives.');
    expect(rate.provenance.natural_effect.stated_range).toEqual({ low: 10, high: 30,
      text: (raw as Rec).statements.at(-1).quote, end: 'centre' });
    const request = await runRequest(graph, brief as string);
    expect(request.graph.nodes.find((n: Rec) => n.kind === 'goal').nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: ['existing_capacity', 'extra_capacity'], stated_in_brief: false });
    for (const from of ['existing_capacity', 'extra_capacity']) {
      const part = graph.edges.find((e: Rec) => e.from === from && e.to === 'total_capacity');
      expect(part.exists_probability).toBe(1);
      expect(part.provenance.definitional).toBe(true);
      expect(part.strength.std).toBeLessThan(Math.abs(part.strength.mean) / 2);
      expect(linkDefaultAssumptionsOf(part)).toEqual([]);
    }
    expect(request.graph.edges.find((e: Rec) => e.from === rate.from && e.to === rate.to).strength).toEqual(rate.strength);
  });

  it('absolute additions retain D3 defaults; GraphV3 still rejects zero-std causal carriers', async () => {
    const graph = await replay(draft(UNIT));
    const rate = effectOf(graph);
    expect(rate.provenance.magnitude).toBe('user_stated');
    expect(linkProvenanceOf(rate).origin).toBe('human');
    expect(rate.provenance.natural_effect.amount).toBe(20);
    expect(rate.strength.std).toBeGreaterThan(0);
    expect(rate.exists_probability).toBe(0.8);
    expect(linkDefaultAssumptionsOf(rate)).toHaveLength(2);
    const pointOnly = structuredClone(graph);
    Object.assign(effectOf(pointOnly), { strength: { ...rate.strength, std: 0 }, exists_probability: 1 });
    const parsed = GraphV3.safeParse(pointOnly);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join('.'))).toEqual([
      `edges.${pointOnly.edges.indexOf(effectOf(pointOnly))}.strength.std`,
    ]);
    const request = await runRequest(graph, BRIEF);
    expect(request.graph.nodes.find((n: Rec) => n.kind === 'goal').nonlinear_identity.operation).toBe('sum');
  });

  it('negative: a neighbouring link with the same number cannot supply this link’s authorship', async () => {
    const raw = draft();
    raw.statements.at(-1).subject.to_label = 'Total capacity';
    const graph = await replay(raw, `${BRIEF} Our unrelated queue has 20 tickets.`);
    expect(effectOf(graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it('negative: a rate with a different driver denominator stays a placeholder', async () => {
    const graph = await replay(draft(`${UNIT} per machine`));
    expect(effectOf(graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it.each(['parcels per week per specialist', 'tickets per day per specialist'])('negative: a different target numerator (%s) stays a placeholder', async unit => {
    const graph = await replay(draft(unit));
    expect(effectOf(graph).provenance.magnitude).toBe('olumi_placeholder');
  });

  it('the recorded range is independent of the D3 spread and existence assumptions', async () => {
    const original = effectOf(await replay(draft()));
    const brief = BRIEF.replace('10 and 30', '5 and 35');
    const raw = draft();
    Object.assign(raw.statements.at(-1), { low: 5, high: 35, quote: EFFECT.replace('10 and 30', '5 and 35') });
    const changed = effectOf(await replay(raw, brief));
    expect(changed.provenance.natural_effect.stated_range).toEqual({ low: 5, high: 35,
      text: raw.statements.at(-1).quote, end: 'centre' });
    expect(changed.strength).toEqual(original.strength);
    expect(changed.exists_probability).toBe(original.exists_probability);
  });

});

it.each(['tickets', 'parcels'])('L18C %s: coordinate frame is not a cap', async quantity => {
  const raw = JSON.parse(JSON.stringify(draft()).replaceAll('tickets', quantity));
  const graph = await replay(raw, BRIEF.replaceAll('tickets', quantity));
  const zero = graph.nodes.find((n: Rec) => n.id === 'extra_capacity');
  expect(zero.observed_state.cap).toBeUndefined();
  expect(zero.scale_frame).toBe(125);
});
it.each(['tickets', 'parcels'])('L18C %s: the operand accepts 150 on the saved coordinate frame', async quantity => {
  const graph = await replay(JSON.parse(JSON.stringify(draft()).replaceAll('tickets', quantity)), BRIEF.replaceAll('tickets', quantity));
  const zero = graph.nodes.find((n: Rec) => n.id === 'extra_capacity');
  expect(normaliseFactorValue({ rawInput: 150, unit: zero.observed_state.unit, factorUnit: zero.observed_state.unit,
    factorCap: zero.observed_state.cap, factorScaleFrame: zero.scale_frame,
    factorObservedValue: zero.observed_state.value, factorObservedRawValue: zero.observed_state.raw_value, inputHasUnit: true }))
    .toEqual({ raw_value: 150, value: 1.2 });
});
it('L18C R1 contract: exact zero, natural values, coefficient and actual ledger retained', async () => {
  const graph = await replay(draft());
  const request = await runRequest(graph, BRIEF);
  const zero = request.graph.nodes.find((n: Rec) => n.id === 'extra_capacity');
  expect(zero.observed_state.value).toBe(0);
  expect(zero.observed_state.raw_value).toBe(0);
  expect(zero.observed_state.std).toBeUndefined();
  expect(request.graph.nodes.find((n: Rec) => n.id === 'existing_capacity').observed_state.raw_value).toBe(80);
  const sum = request.graph.edges.find((e: Rec) => e.from === zero.id && e.to === 'total_capacity');
  expect(sum.strength.mean).toBe(1);
  expect(sum.provenance.natural_effect.strength_mean).toBe(1);
  expect(sum.provenance.natural_effect.amount).toBe(1);
  expect(sum.provenance.natural_effect.per_source_change).toBe(1);
  expect(sum.provenance.uncertainty_defaults.find((x: Rec) => x.code === 'NORMALISE_STRENGTH_RANGE').after).toBe(1);
  expect(effectOf(request.graph).provenance.natural_effect.amount).toBe(20);
  expect(effectOf(request.graph).strength.mean).toBeCloseTo(20 / 125);
});

it('L18C admission: an explicit capless frame maps known and estimated levels without enforcing a limit', () => {
  for (const baseline_known of [true, false]) {
    for (const baseline_value of [0, 80, 150]) {
      const raw = draft();
      Object.assign(raw.factors[2], { baseline_known, baseline_value, scale_frame: 125 });
      const admitted = admitCandidateModel(raw as CandidateModel, {});
      const operand = admitted.nodes.find(n => n.label === 'Extra capacity')!;
      expect(operand.scale_frame).toBe(125);
      expect(operand.observed_state).toEqual({ value: baseline_value / 125, raw_value: baseline_value,
        unit: UNIT, source: 'cee_inference', extractionType: 'inferred' });
    }
  }
});

// L23: untouched raw_text from #3509's actual provider record, never reconstructed from draft_graph.
const LIVE_RAW = liveRows[0]!.calls[0]!.raw_text;
const LIVE_BRIEF = "We are comparing two staffing options, labelled exactly \"Keep current staffing\" and \"Add one specialist\". Use the exact goal label \"Weekly support capacity\". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.";
const liveGoal = (graph: Rec): Rec => graph.nodes.find((n: Rec) => n.id === 'weekly_support_capacity');
it('L23 exact recorded drafter bytes: declared sum total survives conversion, save/readback and the Run request', async () => {
  const raw = JSON.parse(LIVE_RAW);
  expect(raw.goal).toMatchObject({ baseline_value: 80, baseline_origin: 'olumi', baseline_stance: 'estimate' });
  const graph = await replay(LIVE_RAW, LIVE_BRIEF);
  const request = await runRequest(graph, LIVE_BRIEF);
  for (const sent of [graph, request.graph]) {
    const goal = liveGoal(sent);
    expect(goal.observed_state).toMatchObject({ raw_value: 80, baseline: 80 / 125, value: 80 / 125,
      cap: 125, unit: 'tickets per week', source: 'cee_inference', extractionType: 'inferred' });
    expect(goal.nonlinear_identity).toEqual({ operation: 'sum',
      factor_ids: ['existing_team_capacity', 'additional_specialist_capacity'], stated_in_brief: false });
    const zero = sent.nodes.find((n: Rec) => n.id === 'additional_specialist_capacity');
    expect(zero.scale_frame).toBe(125);
    expect(zero.observed_state).toMatchObject({ raw_value: 0, value: 0, source: 'cee_inference' });
    expect(zero.observed_state.cap).toBeUndefined();
    for (const from of goal.nonlinear_identity.factor_ids) {
      const edge = sent.edges.find((e: Rec) => e.from === from && e.to === goal.id);
      expect(edge.provenance.definitional).toBe(true);
      expect(edge.exists_probability).toBe(1);
      expect(linkDefaultAssumptionsOf(edge)).toEqual([]);
    }
    const rate = sent.edges.find((e: Rec) => e.from === 'additional_specialists' && e.to === 'additional_specialist_capacity');
    expect(rate.provenance.magnitude).toBe('user_stated');
    expect(rate.provenance.natural_effect.amount).toBe(20);
    expect(rate.provenance.natural_effect.stated_range).toEqual({ low: 10, high: 30,
      text: 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.', end: 'centre' });
  }
});

it.each(['tickets', 'parcels'])('L23 %s: an Olumi-derived total keeps its author while the sum is structurally checked', async quantity => {
  const raw = JSON.parse(LIVE_RAW.replaceAll('tickets', quantity));
  const brief = LIVE_BRIEF.replaceAll('tickets', quantity);
  const graph = await replay(raw, brief);
  expect(liveGoal(graph).observed_state.raw_value).toBe(80);
  expect(liveGoal(graph).observed_state.source).toBe('cee_inference');
  expect(liveGoal(graph).nonlinear_identity.operation).toBe('sum');
});

it.each([
  ['unknown level', (raw: Rec) => { raw.goal.baseline_known = false; }],
  ['no identity', (raw: Rec) => { raw.identities = []; }],
  ['unknown origin', (raw: Rec) => { raw.goal.baseline_origin = 'unknown'; }],
  ['hypothetical total', (raw: Rec) => { raw.goal.baseline_stance = 'hypothetical'; }],
  ['target total', (raw: Rec) => { raw.goal.baseline_stance = 'target'; }],
  ['wrong arithmetic', (raw: Rec) => { raw.goal.baseline_value = 60; }],
  ['different operand unit', (raw: Rec) => { raw.factors[2].unit = 'parcels per week'; }],
  ['different total', (raw: Rec) => { raw.identities[0].outcome = 'Additional specialist capacity'; }],
])('L23 negative: %s cannot supply a supported derived total', async (_name, edit) => {
  const raw = JSON.parse(LIVE_RAW);
  (edit as (raw: Rec) => void)(raw);
  // An unrelated user number must never supply this goal's authorship or a missing sum.
  const graph = await replay(raw, `${LIVE_BRIEF} An unrelated queue has 80 tickets per week.`);
  expect(liveGoal(graph).observed_state).toBeUndefined();
  expect(liveGoal(graph).nonlinear_identity).toBeUndefined();
});

// L24: exact captured provider output, not reconstructed from draft_graph.
it('L24 recorded capacity drafter: per specialist stays a count through save and the Run request', async () => {
  const graph = await replay(liveRows[0]!.calls[0]!.raw_text, LIVE_BRIEF);
  const rate = graph.edges.find((e: Rec) => e.from === 'additional_specialists' && e.to === 'additional_specialist_capacity');
  expect(rate.provenance.natural_effect).toMatchObject({ amount: 20, per_source_change: 1,
    per_source_change_unit: 'specialist', stated_range: { low: 10, high: 30 } });
  const request = await runRequest(graph, LIVE_BRIEF);
  const driver = request.graph.nodes.find((n: Rec) => n.id === 'additional_specialists');
  expect(driver.observed_state).toMatchObject({ value: 0, unit: 'specialists', source: 'cee_inference' });
  expect(driver.observed_state).toEqual(graph.nodes.find((n: Rec) => n.id === driver.id).observed_state);
  expect(driver.observed_state.std).toBeUndefined();
  expect(request.graph.edges.find((e: Rec) => e.from === rate.from && e.to === rate.to)).toEqual(rate);
});
it.each(['tickets', 'parcels'])('L24 %s: the declared count keeps its rate, sum and spread with 0/1 options', async quantity => {
  const raw = JSON.parse(JSON.stringify(draft()).replaceAll('tickets', quantity));
  const graph = await replay(raw, BRIEF.replaceAll('tickets', quantity));
  expect(effectOf(graph).provenance.natural_effect).toMatchObject({ amount: 20, per_source_change: 1, per_source_change_unit: 'specialist' });
  const request = await runRequest(graph, BRIEF.replaceAll('tickets', quantity));
  expect(request.graph.nodes.find((n: Rec) => n.id === 'extra_specialists').observed_state.std).toBeUndefined();
  expect(request.graph.nodes.find((n: Rec) => n.id === 'total_capacity').nonlinear_identity)
    .toEqual({ operation: 'sum', factor_ids: ['existing_capacity', 'extra_capacity'], stated_in_brief: false });
});
