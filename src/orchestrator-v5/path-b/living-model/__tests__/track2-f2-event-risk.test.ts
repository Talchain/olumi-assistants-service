/**
 * TRACK 2 F2 (21 Oct 2026), CEE half: an event that may happen within a window ("a 5–15% chance our key supplier fails
 * within 12 months"), stated on the core living model, through the real mapper, the stored projection and the Run
 * handler, up to the request PLoT receives (F1_OUT: written for the PLoT → ISL half, `scripts/track2/run-chain.sh`).
 * The engine contract is ISL's `event_risk.v1` (#228): PLoT and ISL need nothing new.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { BuildModelParams } from '../../tools/draft-tool.js';
import { diffLivingModels } from '../diff.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';
import { goalChanceEstimateCounts } from '../../../agent-lane/goal-chance-estimate-attribution.js';
import { applyExplicitEdit } from '../edit.js';
import { applyKernel } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER, OPTION_EFFECTS } from './fixtures.js';
import {
  CASCADE, CERTAIN_WITHIN_WINDOW, COSTED_HALF_SWITCH, COSTED_SWITCH, COSTED_SWITCH_IN_PLACE, COSTED_SWITCH_TWO_OPTIONS, HALF_MITIGATION, NO_CHANCE, NO_WINDOW, OLUMI_CHANCE, OLUMI_MITIGATION,
  PERCENT_PREVENTER, SHARED_PREVENTER, UNATTRIBUTED, UNIT_TEXT_PREVENTER, UNVERIFIED_MITIGATION, supplier,
} from './track2-f2-event-risk.fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

async function requestTheRunSends(name: string, model: LivingModelT): Promise<Rec> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `f2-${name}`, {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: `f2-${name}`, kind: 'message', message: 'Run analysis.' },
    requestId: `f2-${name}`, signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  const out = process.env.F1_OUT;
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${name}.cee-to-plot.json`), JSON.stringify(request, null, 2)); }
  return request!;
}

/**
 * A negative row, checked at both ends (codex integration review, 21 Oct, item 3: the old helper accepted any error and so
 * never reached the threshold). At the source, the mapper's goal carries no threshold, whatever the Run then does. At
 * the Run, the outcome is exactly the one named: refused with that readiness code (never any error), or sent with no
 * threshold in the payload.
 */
async function noChanceSent(name: string, model: LivingModelT, run: 'NO_PATH_TO_GOAL' | 'ORPHAN_NODE' | 'sent'): Promise<void> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const goal = (mapLivingModel(model).graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  expect(goal, name).not.toHaveProperty('goal_threshold_raw');
  expect(goal, name).not.toHaveProperty('goal_threshold');
  const sent = await requestTheRunSends(name, model).then((r) => r, (e: Error) => e.message);
  if (run !== 'sent') expect(sent, name).toBe(`Persisted graph is not analysis-ready: ${run}`);
  else if (typeof sent === 'string') expect.fail(`${name}: expected the Run to reach PLoT, got "${sent}"`);
  else {
    expect(node(sent, sent.goal_node_id), name).not.toHaveProperty('goal_threshold_raw');
    expect(node(sent, sent.goal_node_id), name).not.toHaveProperty('goal_threshold');
  }
}

/** The brief, as the person wrote it: every quote the supplier fixture attributes to them. */
const RISK_WORDS_FOR_KERNEL = 'we need at least £12k a month; today it is £16k. a 5–15% chance our key supplier fails within 12 months; dual-sourcing would cut that by 70%. if it does we lose £8k a month. dual-source the part, it costs £1k a month, or we carry on as now; we single-source today';
const node = (r: Rec, id: string) => (r.graph.nodes as Rec[]).find((n) => n.id === id)!;
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);

describe('Track 2 F2: an event risk reaches the engine as event_risk.v1, with its chance', () => {
  it('point statements: the risk reaches the engine as an event with its stated chance, window and mitigation', async () => {
    expect(reasons(supplier('point'))).toEqual([]);
    const r = await requestTheRunSends('point', supplier('point'));
    expect(node(r, 'supplier_fails')).toMatchObject({ kind: 'risk', event_risk: { version: 1,
      occurrence: { p_low: 0.05, p_high: 0.15, basis: 'user' }, horizon: { months: 12 },
      mitigations: [{ factor_id: 'dual_sourcing', occurrence_reduction: 0.7 }] } });
    const severity = (r.graph.edges as Rec[]).find((e) => e.from === 'supplier_fails' && e.to === 'gp')!;
    expect(severity).toMatchObject({ exists_probability: 1, provenance: { natural_effect: { amount: -8000 } } });
    expect((r.graph.edges as Rec[]).some((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')).toBe(true);
    // CONTRAST for every negative below: here the threshold IS sent, so a missing one there is the risk's refusal, not the goal's.
    expect(node(r, r.goal_node_id)).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 12000 });
  });

  // RULE 1, ruled (Science 21 Oct; CEE #3540 "stay within"): a floor that today's level already clears is a goal, scored on
  // its level at the end of the period. F2 goes THROUGH that path, never around it: the aim is the person's own, their words
  // carry the at-least cue, and the end-of-period reading is said beside it.
  it('a protective floor today already clears is kept as the goal (#3540), on the person\'s own aim and words', () => {
    const out = mapLivingModel(supplier('point'));
    expect(out.withheld).toEqual([]);
    expect((out.graph.nodes as Rec[]).find((n) => n.id === 'gp')).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 12000,
      observed_state: { raw_value: 16000 } });
    expect(out.assumed.map((a) => a.id)).toEqual(['gp']);
    expect(out.assumed[0]!.text).toMatch(/The chance is for its level at the end of the period, not along the way\.$/);
  });

  // The threshold still travels, but with no level today PLoT cannot convert it, so no chance is given (the chain's
  // no-cue row: GOAL_THRESHOLD_NOT_CONVERTIBLE, outcomes present, probability_of_goal absent for both options).
  it('NEGATIVE (no bypass): with no keep or at-least cue in their words, Olumi asks about the floor; no level today is sent', async () => {
    const noCue: LivingModelT = { ...supplier('point'), aims: [{ ...supplier('point').aims[0]!, quote: 'gross profit should be £12k or more; today it is £16k' }] };
    expect(reasons(noCue)).toEqual(['gp:stay_within_unconfirmed']);
    expect(mapLivingModel(noCue).assumed).toEqual([]);
    const r = await requestTheRunSends('no-cue', noCue);
    expect(node(r, r.goal_node_id)).not.toHaveProperty('observed_state');
  });

  it('exact statements: written for the chain (the DL\'s 0.900 / 0.970 row); today\'s rule withholds an exact drawn link', async () => {
    expect(reasons(supplier('exact'))).toEqual(expect.arrayContaining(['fails_gp:exact_not_drawable', 'cost_gp:exact_not_drawable']));
    await noChanceSent('exact', supplier('exact'), 'sent');
  });

  it('certain within its window (p = 1) is an event ISL evaluates: sent as stated, never refused', async () => {
    expect(reasons(CERTAIN_WITHIN_WINDOW)).toEqual([]);
    const r = await requestTheRunSends('certain', CERTAIN_WITHIN_WINDOW);
    expect(node(r, 'supplier_fails').event_risk.occurrence).toEqual({ p_low: 1, p_high: 1, basis: 'user' });
  });

  it('§3C: a present condition is never a risk. The AI is told so (schema row below); a chance only Olumi gave is sent as Olumi\'s', async () => {
    // DL ruling 23 Oct: Olumi's chance counts over the goal's own window (here 12 months, stated from today); without one
    // it is held with its preventer (mitigated-risk-window.test.ts).
    const windowed: LivingModelT = { ...OLUMI_CHANCE, aims: OLUMI_CHANCE.aims.map((a) => ({ ...a, target: { ...a.target!, period_months: 12 } })) };
    expect(reasons(windowed)).toEqual([]);
    const r = await requestTheRunSends('olumi-chance', windowed);
    expect(node(r, 'supplier_fails').event_risk.occurrence.basis).toBe('olumi');
    // Olumi's chance does not make the person's stated 70% Olumi's: the reduction keeps its own author.
    expect((r.graph.edges as Rec[]).find((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')!.provenance)
      .toMatchObject({ source: 'brief_extraction', magnitude: 'user_stated' });
  });

  it('NEGATIVE (buddy r1): a switch preventing two risks, or a switch in %, is refused by name before ISL sees it', async () => {
    expect(reasons(SHARED_PREVENTER)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'port_strike:risk_not_in_slice']));
    expect(reasons(PERCENT_PREVENTER)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    expect(reasons(UNIT_TEXT_PREVENTER)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    await noChanceSent('shared-preventer', SHARED_PREVENTER, 'NO_PATH_TO_GOAL');
    await noChanceSent('percent-preventer', PERCENT_PREVENTER, 'NO_PATH_TO_GOAL');
  });

  it('NEGATIVE: an unstated chance or window is never guessed; unverified words are no one\'s', async () => {
    expect(reasons(NO_CHANCE)).toEqual(['supplier_fails:risk_occurrence_unknown', 'gp:chance_rests_on_withheld']);
    expect(reasons(NO_WINDOW)).toEqual(['supplier_fails:risk_occurrence_unknown', 'gp:chance_rests_on_withheld']);
    expect(reasons(UNATTRIBUTED)).toEqual(['supplier_fails:risk_unattributed', 'gp:chance_rests_on_withheld']);
    for (const [name, m] of [['no-chance', NO_CHANCE], ['no-window', NO_WINDOW], ['unattributed', UNATTRIBUTED]] as const) await noChanceSent(name, m, 'NO_PATH_TO_GOAL');
  });

  it('NEGATIVE (§9): a cause into the event (a cascade) and a half-measure mitigation are not in this slice', async () => {
    expect(reasons(CASCADE)).toEqual(expect.arrayContaining(['demand_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    expect(reasons(HALF_MITIGATION)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    await noChanceSent('cascade', CASCADE, 'ORPHAN_NODE');
    await noChanceSent('half-mitigation', HALF_MITIGATION, 'NO_PATH_TO_GOAL');
  });

  // Served re-run (CEE 997f7a15): the drafter said the cost of the mitigation itself, and the whole risk was refused.
  it('a mitigation that costs money keeps its risk: the cost reaches the goal through the option, and the chance is sent', async () => {
    expect(reasons(COSTED_SWITCH)).toEqual([]);
    // The same engine graph as the cost said of the option, whose chain gives 0.9159 / 0.9732 (the analytic answer above).
    expect(mapLivingModel(COSTED_SWITCH).graph).toEqual(mapLivingModel(supplier('point')).graph);
    const r = await requestTheRunSends('costed-switch', COSTED_SWITCH);
    expect(node(r, 'supplier_fails')).toMatchObject({ kind: 'risk', event_risk: { mitigations: [{ factor_id: 'dual_sourcing', occurrence_reduction: 0.7 }] } });
    expect((r.graph.edges as Rec[]).filter((e) => e.from === 'dual_sourcing').map((e) => e.to)).toEqual(['supplier_fails']);
    expect((r.graph.edges as Rec[]).find((e) => e.from === 'dual_source__on' && e.to === 'gp')).toMatchObject({
      provenance: { source: 'brief_extraction', natural_effect: { amount: -1000 } } });
    expect(node(r, r.goal_node_id)).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 12000 });
  });

  // Codex r1/r2 item 4: drawn from the option's switch, the cost is still the person's to change on the canvas (#3557).
  it('the cost said of the mitigation stays editable: a gesture on its drawn edge reaches the stored link', () => {
    const drawn = { from: 'dual_source__on', to: 'gp' };
    const strength = applyExplicitEdit(COSTED_SWITCH, { kind: 'edge_strength_edit', ...drawn, magnitude: 0.1, direction_intent: 'preserve' });
    if (!('model' in strength)) throw new Error(`refused: ${strength.refused}`);
    expect(strength.model.links.find((l) => l.id === 'cost_gp')).toMatchObject({ from: 'dual_sourcing', to: 'gp', source: 'user', effect: { sign: '-' } });
    const del = applyExplicitEdit(COSTED_SWITCH, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [drawn] });
    if (!('model' in del)) throw new Error(`refused: ${del.refused}`);
    expect(del.model.links.map((l) => l.id)).toEqual(['fails_gp']);
    expect(mapLivingModel(del.model).graph.edges.some((e) => e.from === drawn.from)).toBe(false);
  });

  // Buddy review 5595870665 (on 1b7d4cea, which split one cost per option as `cost_gp__<option>`): two options switching the
  // same costed mitigation on keep ONE drawn cost edge under its stored id, from the switch itself, and it stays editable.
  it('two options: the cost stays one edge under its own id, editable on the canvas, and the risk is refused by name', () => {
    const graph = mapLivingModel(COSTED_SWITCH_TWO_OPTIONS).graph;
    expect(graph.edges.filter((e) => e.to === 'gp' && String(e.id).startsWith('cost_gp')).map((e) => [e.id, e.from])).toEqual([['cost_gp', 'dual_sourcing']]);
    expect(reasons(COSTED_SWITCH_TWO_OPTIONS)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice']));
    const drawn = { from: 'dual_sourcing', to: 'gp' };
    const strength = applyExplicitEdit(COSTED_SWITCH_TWO_OPTIONS, { kind: 'edge_strength_edit', ...drawn, magnitude: 0.1, direction_intent: 'preserve' });
    if (!('model' in strength)) throw new Error(`refused: ${strength.refused}`);
    expect(strength.model.links.find((l) => l.id === 'cost_gp')).toMatchObject({ from: 'dual_sourcing', source: 'user' });
    const del = applyExplicitEdit(COSTED_SWITCH_TWO_OPTIONS, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [drawn] });
    if (!('model' in del)) throw new Error(`refused: ${del.refused}`);
    expect(del.model.links.map((l) => l.id)).toEqual(['fails_gp']);
  });

  it('CONTROL: a costed switch that is not a clean 0/1 step keeps its link, and its risk is refused by name, as before', async () => {
    for (const [name, m] of [['costed-half-switch', COSTED_HALF_SWITCH], ['costed-switch-in-place', COSTED_SWITCH_IN_PLACE],
      ['costed-switch-two-options', COSTED_SWITCH_TWO_OPTIONS]] as const) {
      expect(reasons(m), name).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
      const graph = mapLivingModel(m).graph;
      expect((graph.edges as Rec[]).find((e) => e.id === 'cost_gp'), name).toMatchObject({ from: 'dual_sourcing', to: 'gp' });
      expect((graph.nodes as Rec[]).map((n) => n.id), name).not.toContain('dual_source__on');
      expect((graph.nodes as Rec[]).find((n) => n.kind === 'goal'), name).not.toHaveProperty('goal_threshold_raw');
    }
    // In place today, both options set the same level, so the Run is refused before PLoT whatever this rule does.
    await noChanceSent('costed-half-switch', COSTED_HALF_SWITCH, 'sent');
  });

  it('POSITIVE CONTROL: the Batch 0 known answer, with no risks, keeps its threshold (the chain can show a chance)', async () => {
    expect(node(await requestTheRunSends('control', KNOWN_ANSWER), 'g').goal_threshold_raw).toBe(100);
  });

  it('the kernel rewrites a risk\'s ids and checks its words; the proposal\'s diff names a changed risk', () => {
    const raw = structuredClone(supplier('point'));
    raw.factors[0]!.id = 'Dual Sourcing';
    raw.options[1]!.settings[0]!.factor_id = 'Dual Sourcing';
    raw.risks[0]!.mitigations[0]!.factor_id = 'Dual Sourcing';
    const { model, relabelled } = applyKernel(raw, ['we need at least £12k a month; today it is £16k']);
    expect(model.risks[0]!.mitigations[0]!.factor_id).toBe('dual_sourcing');
    expect(relabelled).toContainEqual({ id: 'supplier_fails', was: 'user' });
    const lower = { ...supplier('point'), risks: [{ ...supplier('point').risks[0]!, occurrence: { estimate_by: null, low: 0.05, high: 0.1 } }] };
    expect(diffLivingModels(supplier('point'), lower).map((c) => `${c.kind}:${c.id}:${c.change}`)).toEqual(['risk:supplier_fails:change']);
  });

  it('the AI is told an event is not a present condition; a model saved before risks reads none', () => {
    const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);
    expect(sent).toContain('a present condition (\\"we lack marketing experience\\") is a factor at its current level, never a risk');
    const before = structuredClone(KNOWN_ANSWER) as Rec;
    delete before.risks;
    expect(LivingModel.parse(before).risks).toEqual([]);
  });
  // Science 21 Oct (#3544): what the event does if it happens is an ordinary stated link, so it follows the same rule as any
  // other: stated and unhedged, it exists as stated with no label; stated under an assumption, it still exists as stated
  // but the existence label returns. The preventer's link carries no existence of its own (ISL reads the stated reduction).
  it('#3544 existence rule: a stated severity or preventer link carries no existence label; a hedged one does', () => {
    const existence = (m: LivingModelT, from: string, to: string) => {
      const e = (mapLivingModel(m).graph.edges as Rec[]).find((x) => x.from === from && x.to === to)!;
      return [e.exists_probability, linkDefaultAssumptionsOf(e).map((r) => r.code).includes('DEFAULT_EXISTS_PROBABILITY')];
    };
    expect(existence(supplier('point'), 'supplier_fails', 'gp')).toEqual([1, false]);
    expect(existence(supplier('point'), 'dual_sourcing', 'supplier_fails')).toEqual([1, false]);
    expect(goalChanceEstimateCounts(mapLivingModel(supplier('point')).graph, ['status_quo', 'dual_source'], 'gp'))
      .toMatchObject({ unverifiedLinks: 0, unverifiedValues: 0, unverifiedSettingsByOption: {} });
    const hedged: LivingModelT = { ...supplier('point'), conditions: [{ text: 'if the supplier cannot be replaced within the month',
      applies_to: ['fails_gp'], role: 'assumption', source: 'user', party: null, quote: null }] };
    expect(existence(hedged, 'supplier_fails', 'gp')).toEqual([1, true]);
  });
  // Codex integration review (21 Oct), item 1: the person's risk with Olumi's proposed step must not read as the person's
  // 70%. A mitigation carries its own attribution, as an option's setting does.
  it('a mitigation\'s reduction is labelled by its OWN author, never the risk\'s', () => {
    const preventer = (m: LivingModelT) => (mapLivingModel(m).graph.edges as Rec[]).find((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')!;
    expect(preventer(supplier('point')).provenance).toEqual({ source: 'brief_extraction', magnitude: 'user_stated' });
    expect(preventer(OLUMI_MITIGATION).provenance).toEqual({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    expect(preventer(UNVERIFIED_MITIGATION).provenance).toEqual({});
    // The risk's own figures stay the person's either way.
    expect(node({ graph: mapLivingModel(OLUMI_MITIGATION).graph }, 'supplier_fails').event_risk.occurrence.basis).toBe('user');
  });

  it('the kernel checks a mitigation\'s words on their own: the risk can be the person\'s while the reduction is not', () => {
    const halves: LivingModelT = { ...supplier('point'), risks: [{ ...supplier('point').risks[0]!,
      mitigations: [{ ...supplier('point').risks[0]!.mitigations[0]!, quote: 'dual-sourcing halves it' }] }] };
    const { model, relabelled } = applyKernel(halves, [RISK_WORDS_FOR_KERNEL]);
    expect(model.risks[0]!.source).toBe('user');
    expect(model.risks[0]!.mitigations[0]!.source).toBe('unverified');
    expect(relabelled).toContainEqual({ id: 'supplier_fails:dual_sourcing', was: 'user' });
    // CONTROL: words the brief does hold keep the reduction the person's.
    expect(applyKernel(supplier('point'), [RISK_WORDS_FOR_KERNEL]).model.risks[0]!.mitigations[0]!.source).toBe('user');
  });
  it('a canvas delete of a mitigation\'s edge is refused by name, never acknowledged and redrawn', () => {
    expect(applyExplicitEdit(supplier('point'), { kind: 'structural_delete', removed_node_ids: [],
      removed_edges: [{ from: 'dual_sourcing', to: 'supplier_fails' }] })).toEqual({ refused: 'link_is_mitigation' });
    // Codex: a stored link on the same edge removes only itself; the mitigation redraws the edge, so it is refused too.
    const restated: LivingModelT = { ...supplier('point'), links: [...supplier('point').links,
      { id: 'ds_fails', from: 'dual_sourcing', to: 'supplier_fails', source: 'user', party: null, quote: 'dual-sourcing makes failure less likely',
        effect: { estimate_by: null, form: 'direction_only', value: null, low: null, high: null, sd: null, unit: null, sign: '-' } }] };
    expect(applyExplicitEdit(restated, { kind: 'structural_delete', removed_node_ids: [],
      removed_edges: [{ from: 'dual_sourcing', to: 'supplier_fails' }] })).toEqual({ refused: 'link_is_mitigation' });
    // CONTROL: what the event does if it happens is an ordinary stated link, deleted as before.
    const sev = applyExplicitEdit(supplier('point'), { kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'supplier_fails', to: 'gp' }] });
    expect('model' in sev && sev.model.links.map((l) => l.id)).toEqual(['cost_gp']);
  });
});

// DL ruling on served F2 (L2, 21 Oct): "using Olumi's estimates for 1 starting value" was the mapper's own switch, a definition.
describe('the mapper\'s own switch and change lever are definitions, never Olumi\'s estimates', () => {
  const values = (g: Rec, options: string[], goal: string) => goalChanceEstimateCounts(g, options, goal).values;
  const F2 = ['status_quo', 'dual_source'];
  /** The mitigation step as Olumi's own starting value (0), under the given id. */
  const olumiStep = (id: string): LivingModelT => {
    const m = supplier('point');
    return { ...m, factors: [{ ...m.factors[0]!, id, source: 'olumi', quote: null }],
      options: m.options.map((o) => ({ ...o, settings: o.settings.map((x) => ({ ...x, factor_id: id })) })),
      risks: m.risks.map((r) => ({ ...r, mitigations: r.mitigations.map((x) => ({ ...x, factor_id: id })) })) };
  };

  it('F2: the chance rests on no Olumi starting value; the switch is still Olumi\'s construction, at 0', () => {
    const g = stored(supplier('point'));
    expect(node({ graph: g }, 'dual_source__on').observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
    expect(values(g, F2, 'gp')).toBe(0);
  });

  it('the exact sum\'s change lever: no Olumi starting value either', () => {
    expect(values(stored(OPTION_EFFECTS), ['a', 'b'], 'w')).toBe(0);
  });

  it('CONTRAST: Olumi\'s own starting value, the same 0 on the same path, still counts once, under any id', () => {
    expect(values(stored(olumiStep('dual_sourcing')), F2, 'gp')).toBe(1);
    // An item the model itself holds is its own, even under an id shaped like the mapper's switch.
    expect(values(stored(olumiStep('status_quo__on')), F2, 'gp')).toBe(1);
  });

  it('NEGATIVE (Codex r1 on #3581): nothing a graph carries can hide an estimate: a forged marker, or a legacy graph\'s look-alike', () => {
    const forged = stored(olumiStep('dual_sourcing'));
    for (const n of forged.nodes as Rec[]) if (n.observed_state) n.observed_state.structural = true;
    expect(values(forged, F2, 'gp')).toBe(1);
    const g = stored(supplier('point'));
    const legacy = structuredClone(g);
    delete legacy.living_model;
    expect(values(legacy, F2, 'gp')).toBe(1);
    const moved = structuredClone(g);
    node({ graph: moved }, 'dual_source__on').observed_state = { ...node({ graph: moved }, 'dual_source__on').observed_state, value: 1, raw_value: 1 };
    expect(values(moved, F2, 'gp')).toBe(1);
  });
});
