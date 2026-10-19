/**
 * ⛔ THE LAST CHECK'S FOUR REPRODUCTIONS (Codex, #2969 @ 41b7f181: FAIL with 4 BLOCKING; DL 12 Oct "POSITIVE ATTESTATION
 * ONLY", cut to LABEL-ONLY by Paul's test the same day: a misattributed chance becomes LABELLED, never withheld). Each is the
 * checker's own reproduction, ported verbatim in its inputs and bound by identity. RED on 41b7f181, GREEN after.
 *
 * A type-less `brief_extraction` is the person's BY ITS STAMP ALONE (`stampOnly`): every gate keeps staging's reading (origin
 * human — nothing newly withheld), and the goal-chance census reads it as UNVERIFIED, so the chance says so.
 *
 *   1. A drafter-only figure is never the person's: the constructor → store → loader → Run path licensed 31% on a
 *      drafter-only 73% goal level (type-less `brief_extraction`), with the drafter-only option settings uncounted. The
 *      legacy prose extractor's invented setting of 7 reached the Run as `brief_extraction` too.
 *   2. The draft transforms (V3 goal/factor, V2 factor) stamp type-less human claims; V2 discarded an explicit `inferred`.
 *   3. An ACCEPTED Olumi starting value (or link) is still Olumi's: the result resting on it is provisional.
 *   4. Check estimates lists exactly what the chance face names (the same census): the 31% face named one starting value
 *      and one option setting; the panel said "Olumi supplied 1".
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../../agent-lane/runtime/build-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { goalChanceLicenceForAgent, goalChanceLicenceOf, UNVERIFIED_SOURCES_NOTE } from '../goal-chance-licence.js';
import { goalChanceCellFacesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { goalChanceEstimateCounts, inputOriginOf, settingOriginOf } from '../../agent-lane/goal-chance-estimate-attribution.js';
import { provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { extractInterventionsForOption } from '../../../cee/extraction/intervention-extractor.js';
import { transformNodeToV3 } from '../../../cee/transforms/schema-v3.js';
import { transformNodeToV2 } from '../../../cee/transforms/schema-v2.js';
import { actionFactsOf } from '../../agent-lane/actions/state.js';
import { decidePress } from '../../agent-lane/actions/handlers.js';
import { sayOlumiEstimates } from '../../agent-lane/olumi-estimates-feeding-result.js';
import { withStatedSd } from '../../__tests__/support/supported-spread.support.js';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => structuredClone(x);
const sid = '9c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
const fixture = JSON.parse(readFileSync(new URL('../../../../tests/fixtures/plot/v2-run-golden-minimal.json', import.meta.url), 'utf8'));

async function construct(brief: string, draft: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = clone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'checker' } };
  }) as never, (async () => ({ text: JSON.stringify(draft) })) as never);
  if (!(result as Rec).ok || graph === undefined) throw new Error(JSON.stringify(result));
  return GraphV3.parse(graph) as Rec;
}

async function runGraph(graph: Rec, rowsOf: (req: Rec) => Rec[]): Promise<{ sent: Rec; result: Rec }> {
  const bytes = JSON.stringify(graph);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(sid, 'independent-final', {
    loadGraphAndBriefText: async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 3 }),
    readMostRecentPendingActions: async () => [],
  } as never);
  let sent: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: {
    run: async (req: Rec) => { sent = req; return { ...clone(fixture), option_comparison: rowsOf(req) }; },
    validatePatch: async () => {},
  } } as never);
  const outcome = await handler({ payload: { scenario_id: sid, turn_id: 'independent' }, requestId: 'independent-final',
    signal: new AbortController().signal, context: {}, orientationText: '' } as never) as Rec;
  return { sent: sent!, result: outcome.handler_facts?.[0]?.result };
}

const basis = { reference: 'today', denominator: null, period_months: 3, period_kind: 'at_end', effect_unit: 'percentage points at month three',
  effects_at_period_end: true, also_required: null, open_question: null };
// The checker's draft: the brief states the 85% target and "no additional staff today" — never 73%, 2 or 3 people.
const draftOf = (): Rec => ({
  goal: { kind: null, deliverable: null, metric: 'Quality', operator: '>=', target_stated: true, value: 85, unit: '%', horizon_months: 3,
    provenance: 'explicit', frame: 'level', quantity_frame: 'level', baseline_known: true, baseline_value: 73, baseline_provenance: 'explicit',
    scope: null, basis: clone(basis) },
  constraints: [],
  options: [
    { label: 'Improve support', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Support effort', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit' }] },
    { label: 'Improve training', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Training effort', value: 3, value_kind: 'absolute', unit: 'people', provenance: 'explicit' }] },
    { label: 'Carry on', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
  ],
  factors: [
    { label: 'Support effort', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 10 },
    { label: 'Training effort', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 10 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Support effort', to: 'Quality', direction: 'positive', provenance: 'ai_proposed', effect_amount: 5, effect_per_source_change: 1,
      effect_provenance: 'ai_proposed', definitional: null, basis: 'Support improves quality.' },
    { from: 'Training effort', to: 'Quality', direction: 'positive', provenance: 'ai_proposed', effect_amount: 4, effect_per_source_change: 1,
      effect_provenance: 'ai_proposed', definitional: null, basis: 'Training improves quality.' },
  ],
  identities: [], unknowns: [], decision_question: null,
});
const brief = 'Should we improve support, improve training, or carry on? Our target is quality at least 85% at three months. '
  + 'We have no additional support or training staff today.';
const rowsOf = (req: Rec): Rec[] => (req.options as Rec[]).map((o, i) => ({ option_id: o.id, probability_of_goal: o.is_baseline ? 0 : [0.31, 0.46, 0.2][i],
  outcome: { mean: 82, std: 4, p10: 77, p50: 82, p90: 90 },
  probability_of_goal_precision: { basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95, n_informative: 10000, n_met: 3100,
    interval_lower: 0.30, interval_upper: 0.32 } }));
const licenceOfResult = (result: Rec): Rec | undefined => goalChanceLicenceForAgent({ type: 'analysis_result', enrichment: result.enrichment }) as Rec | undefined;
const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;

describe('BLOCKING 1 — a drafter-only figure is never counted as the person\'s on the chance (constructor → store → loader → Run)', () => {
  it('RED on 41b7f181: the drafter-only 73% goal level is disclosed as unverified, and the 31% chance is shown LABELLED', async () => {
    const g = await construct(brief, draftOf());
    const quality = node(g, 'quality');
    // Identity: THIS goal level — the drafter's 73, which the brief never states, stored with a bare brief stamp.
    expect(quality.observed_state).toMatchObject({ raw_value: 73, source: 'brief_extraction' });
    expect(quality.observed_state).not.toHaveProperty('extractionType');
    // The behaviour first: the Run's chance is shown LABELLED (provisional, with the note).
    const { result } = await runGraph(g, rowsOf);
    const l = licenceOfResult(result)!;
    expect(l).toBeDefined();
    expect(l.provisional).toBe(true);
    expect(l.notes).toContain(UNVERIFIED_SOURCES_NOTE);
    // Why: the chance's census discloses it as unverified; every gate keeps staging's reading (nothing newly withheld).
    expect(inputOriginOf(quality.observed_state)).toBe('unverified');
    expect(provenanceOf({ value: quality.observed_state })).toMatchObject({ origin: 'human', stampOnly: true });
  });

  it('RED on 41b7f181: the drafter-only option settings (2 and 3 people, never in the brief) are disclosed as unverified, never the person\'s', async () => {
    const g = await construct(brief, draftOf());
    for (const [option, factor, raw] of [['improve_support', 'support_effort', 2], ['improve_training', 'training_effort', 3]] as const) {
      const cell = node(g, option).interventions[factor];
      expect(cell).toMatchObject({ source: 'brief_extraction' });
      expect([cell.raw_value, cell.value]).toContain(raw);
      expect(settingOriginOf(cell, node(g, factor))).toBe('unverified');
      expect(provenanceOf({ setting: cell, target: node(g, factor) })).toMatchObject({ origin: 'human', stampOnly: true });
    }
    // Counted (never omitted) on the chance's census, per option — the face then carries the note.
    const counts = goalChanceEstimateCounts(g, ['improve_support', 'improve_training'], 'quality');
    expect(counts.unverifiedSettingsByOption).toMatchObject({ improve_support: 1, improve_training: 1 });
  });

  it('RED on 41b7f181: the legacy prose extractor\'s invented setting of 7 is disclosed as unverified', async () => {
    const g = await construct(brief, draftOf());
    const extracted = extractInterventionsForOption('Set Support effort to 7 people', undefined, g.nodes, g.edges, 'quality', new Set(), [],
      undefined, 'improve_support', brief) as Rec;
    const cell = extracted.interventions.support_effort;
    expect(cell).toMatchObject({ source: 'brief_extraction' });
    expect(settingOriginOf(cell, node(g, 'support_effort'))).toBe('unverified');
    expect(provenanceOf({ setting: cell, target: node(g, 'support_effort') })).toMatchObject({ origin: 'human', stampOnly: true });
  });

  it('CONTROL: the typed door\'s verified figure (`explicit` beside the stamp) is the person\'s', () => {
    const typed = { value: 0.49, raw_value: 49, cap: 100, source: 'brief_extraction', extractionType: 'explicit' };
    expect(provenanceOf({ value: typed }).origin).toBe('human');
    expect(provenanceOf({ value: typed })).not.toHaveProperty('stampOnly');
    expect(inputOriginOf(typed)).toBe('human');
    expect(settingOriginOf({ value: 49, source: 'brief_extraction', extractionType: 'explicit' }, undefined)).toBe('human');
  });
});

describe('BLOCKING 2 — the draft transforms never stamp a bare human claim; V2 keeps an explicit `inferred`', () => {
  const factor = { id: 'f', kind: 'factor', label: 'Draft quantity', data: { value: 0.73, unit: '%', raw_value: 73, cap: 100 } };
  const goal = { id: 'gg', kind: 'goal', label: 'Draft goal', goal_baseline: 0.73, goal_baseline_raw: 73, goal_threshold_cap: 100, goal_threshold_unit: '%' };

  it('RED on 41b7f181: V3 factor and goal, and V2 factor, with no extraction type → disclosed as unverified', () => {
    const v3f = transformNodeToV3(factor as never) as Rec;
    const v3g = transformNodeToV3(goal as never) as Rec;
    const v2f = transformNodeToV2(factor as never) as Rec;
    for (const os of [v3f.observed_state, v3g.observed_state, v2f.observed_state]) {
      expect(os).toMatchObject({ value: 0.73, source: 'brief_extraction' });
      expect(inputOriginOf(os)).toBe('unverified');
      expect(provenanceOf({ value: os })).toMatchObject({ origin: 'human', stampOnly: true });
    }
  });

  it('RED on 41b7f181: V2 keeps an explicit `inferred` — Olumi\'s, never discarded into a brief stamp', () => {
    const v2 = transformNodeToV2({ ...factor, data: { ...factor.data, extractionType: 'inferred' } } as never) as Rec;
    expect(v2.observed_state).toMatchObject({ source: 'cee_inference', extractionType: 'inferred' });
    expect(provenanceOf({ value: v2.observed_state }).origin).toBe('ai');
  });

  it('RED on 41b7f181 (V2 dropped it): an `explicit` extraction type is carried and attests the person\'s figure (V2 and V3)', () => {
    const data = { ...factor.data, extractionType: 'explicit' };
    for (const os of [(transformNodeToV3({ ...factor, data } as never) as Rec).observed_state, (transformNodeToV2({ ...factor, data } as never) as Rec).observed_state]) {
      expect(os).toMatchObject({ source: 'brief_extraction', extractionType: 'explicit' });
      expect(provenanceOf({ value: os }).origin).toBe('human');
      expect(inputOriginOf(os)).toBe('human');
    }
  });
});

// The checker's generic all-human graph (two targets and a limit, every input the person's).
function allHumanGraph(): Rec {
  const labels: Rec = { g: 'Quality', second: 'Reach', limit: 'Expense', root: 'Effort', ext: 'Weather', outside: 'Morale' };
  const nodes: Rec[] = ['g', 'second', 'limit', 'root', 'ext', 'outside'].map((id) => ({ id, kind: id === 'g' ? 'goal' : 'factor', label: labels[id],
    observed_state: { value: 0.2, raw_value: 20, cap: 100, unit: '%', source: 'user_override' } }));
  Object.assign(nodes[0]!, { goal_threshold_frame: 'level', goal_threshold_raw: 70, goal_threshold_cap: 100, goal_threshold: 0.7, goal_threshold_unit: '%',
    goal_direction: '>=', goal_target_basis: { quantity_frame: 'level', target_frame: 'level', target_raw: 70, reference: 'today', period_months: 3,
      period_kind: 'at_end', effect_unit: 'percentage points at month three', effects_at_period_end: true, source: 'olumi_reading' } });
  const cell = (): Rec => ({ value: 0.6, raw_value: 60, unit: '%', source: 'user_specified' });
  for (const id of ['a', 'b']) {
    nodes.push({ id, kind: 'option', label: `Plan ${id}`, interventions: Object.fromEntries(nodes.filter((n) => n.kind !== 'option').map((n) => [n.id, cell()])) });
  }
  const pairs = [['root', 'g'], ['ext', 'second'], ['g', 'outside'], ...['a', 'b'].flatMap((o) => ['g', 'second', 'limit', 'root', 'ext', 'outside'].map((n) => [o, n]))];
  return { nodes, edges: pairs.map(([from, to]) => ({ from, to, strength: { mean: 0.3, std: 0.05 }, exists_probability: 1, effect_direction: 'positive',
    provenance: { source: 'user_specified', magnitude: 'user_stated' } })),
  goal_constraints: [
    { constraint_id: 'tg', node_id: 'g', operator: '>=', value: 70, unit: '%', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'ts', node_id: 'second', operator: '>', value: 50, unit: '%', value_frame: 'level', role: 'goal_target' },
    { constraint_id: 'lim', node_id: 'limit', operator: '<=', value: 80, unit: '%', value_frame: 'level' },
  ] };
}
const precision = { n_informative: 10000, standard_error: 0.005 };
const env = (): Rec => ({ option_comparison: ['a', 'b'].map((id, i) => ({ option_id: id, probability_of_goal: 0.31 + i * 0.1,
  probability_of_joint_goal: 0.21 + i * 0.1, probability_of_joint_goal_precision: precision,
  constraint_probabilities: { tg: 0.31 + i * 0.1, ts: 0.45 + i * 0.1, lim: 0.8 },
  constraint_probabilities_precision: { tg: precision, ts: precision, lim: precision } })) });
const lic = (g: Rec): Rec | null => goalChanceLicenceOf(env(), g, 'g', () => false, undefined, g, { storedConstraints: [], sentConstraints: [] }) as Rec | null;

describe('BLOCKING 3 — acceptance is not authorship: a result resting on an accepted Olumi figure is provisional', () => {
  it('CONTROL: the all-human graph is licensed and not provisional', () => {
    const l = lic(allHumanGraph())!;
    expect(l).not.toBeNull();
    expect(l.provisional).toBeUndefined();
  });

  it('RED on 41b7f181: an accepted Olumi STARTING VALUE (user_confirmed on Effort) → provisional; still counted as accepted, never the person\'s', () => {
    const g = allHumanGraph();
    node(g, 'root').observed_state.source = 'user_confirmed';
    expect(goalChanceEstimateCounts(g, ['a', 'b'], 'g').acceptedValues).toBe(1);
    expect(lic(g)!.provisional).toBe(true);
  });

  it('RED on 41b7f181: an accepted Olumi LINK SIZE (olumi_estimate + a confirm review on Effort → Quality) → provisional', () => {
    const g = allHumanGraph();
    g.edges[0].provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } };
    expect(goalChanceEstimateCounts(g, ['a', 'b'], 'g').acceptedLinks).toBe(1);
    expect(lic(g)!.provisional).toBe(true);
  });
});

describe('BLOCKING 4 — Check estimates lists exactly what the 31% chance face names (one census)', () => {
  it('RED on 41b7f181: the face names 1 starting value and 1 option setting; the panel lists the same 2 figures', async () => {
    const base = await construct(brief, draftOf());
    for (const n of base.nodes as Rec[]) {
      if (n.observed_state) { n.observed_state.source = 'user_override'; delete n.observed_state.extractionType; delete n.observed_state.user_material_unverified; }
    }
    for (const e of base.edges as Rec[]) { e.provenance = { ...e.provenance, source: 'user_specified', magnitude: 'user_stated' }; e.exists_probability = 1; delete e.defaulted; }
    for (const n of base.nodes as Rec[]) for (const c of Object.values((n.interventions ?? {}) as Rec)) (c as Rec).source = 'user_specified';
    // ⭐ STEP 8 (Codex R2 #3443): a size alone carries no supported spread, which withholds the chance. This row's subject is the
    // census, so both sizes read a SUPPORTED control: the user also states each one's standard deviation, through the actual writer.
    const g = await withStatedSd(await withStatedSd(clone(base), sid, 'support_effort', 'quality'), sid, 'training_effort', 'quality');
    Object.assign(node(g, 'support_effort').observed_state, { source: 'cee_inference', extractionType: 'inferred' });
    node(g, 'improve_support').interventions.quality = { value: 0.8, raw_value: 80, unit: '%', source: 'cee_hypothesis',
      target_match: { node_id: 'quality', match_type: 'exact_id', confidence: 'high' } };
    const { result } = await runGraph(g, rowsOf);
    const analysis = { type: 'analysis_result', enrichment: result.enrichment, computed_against_hash: result.graph_hash_at_run };
    const face = new Map(goalChanceCellFacesForAgent(analysis, g, true));
    expect(face.get('improve_support')).toContain('using Olumi\'s estimates for 1 starting value and 1 option setting');
    const facts = actionFactsOf({ scenarioId: sid, graph: g, graphHash: result.graph_hash_at_run, analysisResult: analysis,
      analysisState: { run_state: { kind: 'complete_current', computed_at: result.computed_at } }, analysisReady: { status: 'ready' } } as never) as Rec;
    const panel = facts.olumiEstimates as Rec;
    const l = licenceOfResult(result)!;
    const faceTotal = (l.olumi_estimate_value_count ?? 0) + (l.olumi_estimate_link_count ?? 0)
      + Object.values((l.olumi_estimate_settings_by_option ?? {}) as Rec).reduce((a: number, b) => a + (b as number), 0);
    // Equal by construction: the panel's figures ARE the face's census.
    expect(faceTotal).toBe(2);
    expect(panel.count).toBe(faceTotal);
    expect((panel.values as Rec[]).map((v) => v.id).sort()).toEqual(['improve_support:quality', 'support_effort']);
  });
});

// ── NARROW RE-CHECK r2 (Codex, #2969 @ d7d78505: FAIL, prior #4 open for JOINT chances; DL 12 Oct option C) ───────────────
// The checker's own graph and Run, verbatim in its inputs: a joint over ‘Quality’ ≥ 70% and ‘Reach’ > 50% while ‘Cost’ ≤ 80%.
// An Olumi input feeding ONLY the secondary target (Audience → Reach) was named on the joint's 21% / 31% faces, while Check
// estimates said "None of the figures behind this result are Olumi's estimates": the panel walked its own node set and
// dropped the joint's other event nodes. The panel now calls the SAME census over the licence's OWN recorded inputs.
describe('NARROW RE-CHECK r2 — Check estimates on a JOINT chance lists exactly what its face names', () => {
  const jsid = 'acdca123-4567-4000-8000-123456789abc';
  const precision = { n_informative: 10000, standard_error: 0.005 };
  const rawJointGraph = (): Rec => {
    const names: Record<string, string> = { g: 'Quality', other: 'Reach', limit: 'Cost', x: 'Effort', y: 'Audience' };
    const nodes: Rec[] = Object.entries(names).map(([id, label]) => ({ id, label, kind: id === 'g' ? 'goal' : 'factor',
      observed_state: { value: 0.2, baseline: 0.2, raw_value: 20, cap: 100, unit: '%', source: 'user_override' } }));
    Object.assign(nodes[0]!, { goal_threshold_frame: 'level', goal_threshold_raw: 70, goal_threshold_cap: 100, goal_threshold: 0.7,
      goal_threshold_unit: '%', goal_direction: '>=', goal_target_basis: { quantity_frame: 'level', target_frame: 'level', target_raw: 70,
        reference: 'today', period_months: 3, period_kind: 'at_end', effect_unit: 'percentage points at month three', effects_at_period_end: true,
        source: 'olumi_reading' } });
    for (const id of ['a', 'b']) nodes.push({ id, kind: 'option', label: `Plan ${id}`, interventions: Object.fromEntries(Object.keys(names)
      .map((n) => [n, { value: id === 'a' ? 0.6 : 0.7, raw_value: id === 'a' ? 60 : 70, unit: '%', source: 'user_specified' }])) });
    nodes.push({ id: 'd', kind: 'decision', label: 'Which plan?' });
    const pairs = [['d', 'a'], ['d', 'b'], ['x', 'g'], ['y', 'other'], ...['a', 'b'].flatMap((o) => Object.keys(names).map((n) => [o, n]))];
    return { nodes, edges: pairs.map(([from, to]) => ({ from, to, strength: { mean: 0.3, std: 0.05 }, exists_probability: 1,
      effect_direction: 'positive', provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 0.3, amount_unit: '%',
        per_source_change: 1, per_source_change_unit: '%', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } })),
    goal_constraints: [
      { constraint_id: 'primary', node_id: 'g', operator: '>=', value: 70, unit: '%', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'secondary', node_id: 'other', operator: '>=', operator_as_stated: '>', value: 50, unit: '%', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'budget', node_id: 'limit', operator: '<=', value: 80, unit: '%', value_frame: 'level' },
    ] };
  };
  // ⭐ STEP 8 (Codex R2 #3443): the user's two sizes (Effort → Quality, Audience → Reach) carry no supported spread alone, which
  // withholds the joint. These rows' subject is the census, so each reads a SUPPORTED control: the user also states its
  // standard deviation, recorded by the actual chat writer (`withStatedSd`).
  let attestedJoint: Rec;
  beforeAll(async () => { attestedJoint = await withStatedSd(await withStatedSd(rawJointGraph(), jsid, 'x', 'g'), jsid, 'y', 'other'); });
  const jointGraph = (): Rec => clone(attestedJoint);
  const jointRows = (req: Rec): Rec[] => (req.options as Rec[]).map((o, i) => ({ option_id: o.id, probability_of_goal: 0.41 + i * 0.1,
    probability_of_goal_precision: precision, probability_of_joint_goal: 0.21 + i * 0.1, probability_of_joint_goal_precision: precision,
    constraint_probabilities: Object.fromEntries(((req.goal_constraints ?? []) as Rec[]).map((c) => [c.constraint_id,
      c.node_id === 'g' ? 0.41 + i * 0.1 : c.node_id === 'other' ? 0.51 + i * 0.1 : 0.8])),
    constraint_probabilities_precision: Object.fromEntries(((req.goal_constraints ?? []) as Rec[]).map((c) => [c.constraint_id, precision])),
    outcome: { mean: 82, std: 4, p10: 77, p50: 82, p90: 90 } }));
  async function runJoint(g: Rec): Promise<{ licence: Rec; faces: Map<string, string>; panel: Rec | null; read: Rec }> {
    const bytes = JSON.stringify(g);
    const snapshot = await loadScenarioSnapshotForRunAnalysis(jsid, 'checker', {
      loadGraphAndBriefText: async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 3 }),
      readMostRecentPendingActions: async () => [],
    } as never);
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: {
      run: async (req: Rec) => ({ ...clone(fixture), option_comparison: jointRows(req) }), validatePatch: async () => {},
    } } as never);
    const outcome = await handler({ payload: { scenario_id: jsid, turn_id: 'check' }, requestId: 'check', signal: new AbortController().signal,
      context: {}, orientationText: '' } as never) as Rec;
    const result = outcome.handler_facts?.[0]?.result as Rec;
    const analysis = { type: 'analysis_result', enrichment: result.enrichment, computed_against_hash: result.graph_hash_at_run };
    const read = { scenarioId: jsid, graph: g, graphHash: result.graph_hash_at_run, analysisResult: analysis,
      analysisState: { run_state: { kind: 'complete_current', computed_at: result.computed_at } }, analysisReady: { status: 'ready' } };
    return { licence: goalChanceLicenceForAgent(analysis) as Rec, faces: new Map(goalChanceCellFacesForAgent(analysis, g, true)),
      panel: (actionFactsOf(read as never) as Rec).olumiEstimates as Rec | null, read };
  }
  const NONE = "None of the figures behind this result are Olumi's estimates.";

  it('RED on d7d78505: an Olumi STARTING VALUE feeding only the secondary target (Audience) — the joint face names it, and the panel lists exactly it', async () => {
    const g = jointGraph();
    Object.assign(node(g, 'y').observed_state, { source: 'cee_inference', extractionType: 'inferred' });
    const { licence, faces, panel } = await runJoint(g);
    expect(licence.targets.joint.status).toBe('licensed');
    expect(licence.olumi_estimate_value_count).toBe(1);
    expect([...faces.values()].some((f) => f.includes('using Olumi\'s estimates for 1 starting value'))).toBe(true);
    // Bound by identity: THE figure the face counts — Audience's starting value — and nothing else.
    expect(panel).not.toBeNull();
    expect((panel!.values as Rec[]).map((v) => v.id)).toEqual(['y']);
    expect(panel!.links).toEqual([]);
    expect(panel!.count).toBe(1);
    expect(sayOlumiEstimates(panel as never)).not.toContain(NONE);
  });

  it('RED on d7d78505: an Olumi LINK SIZE feeding only the secondary target (Audience → Reach) — the joint face names it, and the panel lists exactly it', async () => {
    const g = jointGraph();
    Object.assign(g.edges.find((e: Rec) => e.from === 'y' && e.to === 'other').provenance, { source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    const { licence, faces, panel } = await runJoint(g);
    expect(licence.targets.joint.status).toBe('licensed');
    expect(licence.olumi_estimate_link_count).toBe(1);
    expect([...faces.values()].some((f) => f.includes('using Olumi\'s estimates for 1 relationship'))).toBe(true);
    expect(panel).not.toBeNull();
    expect((panel!.links as Rec[]).map((l) => l.id)).toEqual(['y->other']);
    expect(panel!.values).toEqual([]);
    expect(panel!.count).toBe(1);
    expect(sayOlumiEstimates(panel as never)).not.toContain(NONE);
  });

  it('CONTROL (single goal): with no joint, the panel is the scored goal\'s own census — exactly Effort\'s Olumi value', async () => {
    // The same graph with the secondary target and the limit taken out (their nodes, links, settings and rows).
    const keep = new Set(['g', 'x', 'a', 'b', 'd']);
    const g = jointGraph();
    g.nodes = (g.nodes as Rec[]).filter((n) => keep.has(n.id));
    for (const o of g.nodes as Rec[]) if (o.interventions) o.interventions = Object.fromEntries(Object.entries(o.interventions).filter(([k]) => keep.has(k)));
    g.edges = (g.edges as Rec[]).filter((e) => keep.has(e.from) && keep.has(e.to));
    g.goal_constraints = [];
    Object.assign(node(g, 'x').observed_state, { source: 'cee_inference', extractionType: 'inferred' });
    const { licence, faces, panel } = await runJoint(g);
    expect(licence.targets).toBeUndefined();
    expect(licence.olumi_estimate_value_count).toBe(1);
    expect([...faces.values()].some((f) => f.includes('using Olumi\'s estimates for 1 starting value'))).toBe(true);
    expect((panel!.values as Rec[]).map((v) => v.id)).toEqual(['x']);
    expect(panel!.count).toBe(1);
  });

  it('CONTROL: every input the person\'s — the joint face names no estimate, and the panel says none', async () => {
    const { licence, panel } = await runJoint(jointGraph());
    expect(licence.targets.joint.status).toBe('licensed');
    expect(licence.olumi_estimate_value_count ?? 0).toBe(0);
    expect(panel!.count).toBe(0);
    expect(sayOlumiEstimates(panel as never)).toContain(NONE);
  });

  it('GUARD: on a Run that is not the model\'s current one (graph hash ≠ the Run\'s), no census is said — never "none are Olumi\'s"', async () => {
    const { read } = await runJoint(jointGraph());
    const stale = { ...read, graphHash: `${String(read.graphHash)}-moved` };
    const facts = actionFactsOf(stale as never) as Rec;
    expect(facts.olumiEstimates).toBeNull();
    const pressed = decidePress({ id: 'act:check_estimates' }, facts as never) as Rec;
    expect(pressed.kind).toBe('reply');
    expect(pressed.reply.text).not.toContain(NONE);
    expect(pressed.reply.text).toBe('I can’t show the estimates yet: it needs a current analysis first.');
  });
});
