/**
 * Recovery Batch C — THE CEE READBACK CHECK (CLAUDE.md §7: "everything survives reopening"; Batch C scope 5).
 *
 * ONE path per journey, every hop real: the drafter's candidate → admission (`admitCandidateModel`) → the stored graph
 * (the store's own `GraphV3` contract parse + JSON bytes) → the production snapshot loader
 * (`loadScenarioSnapshotForRunAnalysis`) → the real Run handler, which builds the EXACT PLoT request body (observed by the
 * handler's own probe, before any network) and its Run-input snapshot → reload from the same stored bytes → the same request.
 *
 * Expectations are written by hand in NATURAL units (never read back from the code under test):
 *   · hiring: +10% from today on a 0–100 change scale; denominator "today's productivity"; period three months;
 *     two developers × 4% each = +8%, one tech lead × 9% = +9%; no level today is sent or needed;
 *   · marketing: conversion ABOVE 15% (">"), at least 20 new customers, both as the goal's targets; the £100,000 limit kept
 *     a limit; strict operators reach the engine and the Run record;
 *   · an invalid denominator: no goal target is sent at all (no chance can be computed for a target nobody can read).
 */
import { describe, expect, it, vi } from 'vitest';

import { admitCandidateModel, type CandidateModel } from '../../../agent-lane/admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../../../agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { readFileSync } from 'node:fs';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { sentDigest } from '../run-input-snapshot.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { CONDITIONS_NOT_KEPT, goalTargetBasisOf } from '../../../goal-target/goal-target-basis.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { goalChanceTargetCause } from '../../../goal-target/goal-chance-gate.js';
import { groupedGoalPathLinks } from '../../../compose/grouped-link-sizing.js';
import { naturalAmountUnitsOf } from '../../../../cee/magnitude/frame-defaulted-links.js';
import { goalChanceLicenceForAgent, UNVERIFIED_SOURCES_NOTE, withGoalChanceLicence } from '../../../goal-target/goal-chance-licence.js';
import { goalChanceCellFacesForAgent, goalChanceNotesForAgent } from '../../../agent-lane/goal-chance-screen-lines.js';
import { projectCanonicalAnalysisCells } from '../../../../routes/canonical-analysis-view.js';
import { goalChanceWithheldForAgent } from '../../../agent-lane/goal-chance-withheld.js';
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { toTypedRunRows } from '../../../runs/typed-run-rows.js';

type Rec = Record<string, any>;

const SCENARIO = 'bc0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';

/** The stored bytes: the admitted model through the graph contract's own parse (it strips any undeclared field). */
function store(candidate: CandidateModel): string {
  const admitted = admitCandidateModel(candidate) as unknown as Rec;
  const parsed = GraphV3.parse({ nodes: admitted.nodes, edges: admitted.edges, goal_constraints: admitted.goal_constraints });
  return JSON.stringify(parsed);
}

/** Reload the stored bytes through the production loader and build the Run request the handler would send. */
async function runFromStore(bytes: string): Promise<{ payload: Rec; snapshot: Rec; reloaded: Rec }> {
  const reloaded = JSON.parse(bytes) as Rec;
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 3 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-batch-c-readback', port as never);
  let payload: Rec | undefined;
  let inputSnapshot: Rec | undefined;
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot,
    probe: async (sent) => { payload = sent.plotPayload as Rec; inputSnapshot = sent.runInputSnapshot as Rec; },
  });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-batch-c-readback', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-batch-c', scenario_id: SCENARIO, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-batch-c-readback', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(payload, 'the Run handler built a PLoT request').toBeDefined();
  return { payload: payload!, snapshot: inputSnapshot ?? {}, reloaded };
}

const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const edge = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((e) => e.from === from && e.to === to)!;
const frameOf = (n: Rec): number => (n.scale_frame ?? n.observed_state?.cap) as number;
const optionWire = (p: Rec, label: string): Rec => (p.options as Rec[]).find((o) => o.label === label)!;

// ── Hiring ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const HIRING_BASIS = {
  reference: 'today', denominator: 'today’s productivity (monthly development capacity)', period_months: 3, period_kind: 'at_end',
  effect_unit: '% of today’s productivity per added person, at month three', effects_at_period_end: true,
  also_required: ['code quality maintained', 'spend within £200,000'], open_question: null,
};
const hiring = (basis: Rec | null = HIRING_BASIS): CandidateModel => ({
  goal: { metric: 'Productivity', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3, provenance: 'explicit',
    frame: 'change_abs', quantity_frame: 'change', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null, basis },
  constraints: [{ metric: 'First-year hiring cost', operator: '<=', value: 200000, unit: 'GBP', provenance: 'explicit', frame: 'level' }],
  options: [
    { label: 'Hire a tech lead', provenance: 'explicit', interventions: [
      { factor_label: 'Additional tech leads hired', value: 1, unit: 'people', provenance: 'explicit' },
      { factor_label: 'First-year hiring cost', value: 110000, unit: 'GBP', provenance: 'ai_proposed' }] },
    { label: 'Hire two developers', provenance: 'explicit', interventions: [
      { factor_label: 'Additional developers hired', value: 2, unit: 'people', provenance: 'explicit' },
      { factor_label: 'First-year hiring cost', value: 140000, unit: 'GBP', provenance: 'ai_proposed' }] },
    { label: 'Carry on with the current team', provenance: 'ai_proposed', is_status_quo: true },
  ],
  factors: [
    { label: 'Additional tech leads hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 5 },
    { label: 'Additional developers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 10 },
    { label: 'First-year hiring cost', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'explicit', plausible_max: 300000 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Additional tech leads hired', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed', effect_amount: 9,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'A ramped-up tech lead adds review and planning capacity.' },
    { from: 'Additional developers hired', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed', effect_amount: 4,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'Each developer adds capacity once recruited and ramped up.' },
    { from: 'First-year hiring cost', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed', effect_amount: 0,
      effect_per_source_change: 10000, effect_provenance: 'ai_proposed', definitional: null, basis: 'Spend itself adds no capacity.' },
  ],
  identities: [], unknowns: [], decision_question: null,
} as unknown as CandidateModel);

describe('readback — hiring: a change of +10% from today travels admission → store → Run request → reload unchanged', () => {
  it('RED: the Run request scores +10 on the 0–100 change scale, with no level today, and the stored basis keeps denominator and period', async () => {
    const { payload, reloaded } = await runFromStore(store(hiring()));
    const goal = node(payload.graph, 'productivity');
    expect(goal).toMatchObject({ quantity_frame: 'change', goal_threshold_frame: 'change_abs', goal_threshold_raw: 10, goal_threshold_unit: '%' });
    expect(goal.goal_threshold * goal.goal_threshold_cap).toBeCloseTo(10, 9);
    expect(goal.observed_state).toBeUndefined();
    expect(goalTargetBasisOf(node(reloaded, 'productivity'))).toMatchObject({
      denominator: 'today’s productivity (monthly development capacity)', period_months: 3, period_kind: 'at_end',
      effects_at_period_end: true, reference: 'today',
    });
  });

  it('RED: per-person effect × count, read off the request PLoT receives: two developers = +8%, one tech lead = +9%', async () => {
    const { payload } = await runFromStore(store(hiring()));
    const goal = node(payload.graph, 'productivity');
    const cap = goal.goal_threshold_cap as number;
    // The request carries each option's setting in the factor's OWN unit (people) beside the factor's frame (its cap);
    // PLoT normalises by that frame. The engine's paired change on the goal is β × Δ(people ÷ frame) × the goal's 0–100 scale.
    const change = (factor: string, option: string): number => {
      const f = node(payload.graph, factor);
      const set = (optionWire(payload, option).interventions as Rec)[factor] as number;
      const today = (f.observed_state?.raw_value ?? 0) as number;
      return (edge(payload.graph, factor, 'productivity').strength.mean as number) * ((set - today) / frameOf(f)) * cap;
    };
    expect(frameOf(node(payload.graph, 'additional_developers_hired'))).toBeGreaterThan(0);
    expect(change('additional_developers_hired', 'Hire two developers')).toBeCloseTo(8, 6);
    expect(change('additional_tech_leads_hired', 'Hire a tech lead')).toBeCloseTo(9, 6);
  });

  it('RED: the reopened goal never asks for today\'s level — a change in its own units is testable as it stands', async () => {
    const reloaded = JSON.parse(store(hiring())) as Rec;
    const verdict = targetTestabilityOf(reloaded) as Rec;
    const failures = (verdict.failures ?? []) as Rec[];
    expect(failures.filter((f) => f.code === 'missing_goal_baseline')).toEqual([]);
    expect(JSON.stringify(verdict)).not.toMatch(/today.s level/);
    expect(goalChanceTargetCause(reloaded, 'productivity')).toBeNull();
  });

  it('RED: reopening the stored bytes sends the SAME request (sent digest equal)', async () => {
    const bytes = store(hiring());
    const first = await runFromStore(bytes);
    const second = await runFromStore(bytes);
    expect(sentDigest(second.payload)).toBe(sentDigest(first.payload));
  });

  it('NEGATIVE (ruling 9): a missing denominator → the stored goal carries no threshold, and the Run sends none', async () => {
    const { payload, reloaded } = await runFromStore(store(hiring({ ...HIRING_BASIS, denominator: null })));
    expect(node(reloaded, 'productivity').goal_threshold).toBeUndefined();
    expect(node(payload.graph, 'productivity').goal_threshold).toBeUndefined();
    expect(payload.goal_threshold).toBeUndefined();
  });
});

// ── Marketing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const marketing = (): CandidateModel => ({
  goal: { metric: 'New customers', operator: '>=', target_stated: true, value: 20, unit: 'customers', horizon_months: null, provenance: 'explicit',
    frame: 'level', quantity_frame: 'level', baseline_known: true, baseline_value: 0, baseline_provenance: 'explicit', scope: null,
    basis: { reference: 'launch', denominator: null, period_months: 3, period_kind: 'over_period',
      effect_unit: 'customers, or percentage points of conversion, over the first three months after launch', effects_at_period_end: true,
      also_required: null, open_question: null } },
  constraints: [
    { metric: 'Conversion rate', operator: '>', value: 15, unit: '%', provenance: 'explicit', frame: 'level', role: 'target' },
    { metric: 'Annual marketing spend', operator: '<=', value: 100000, unit: 'GBP', provenance: 'explicit', frame: 'level', role: 'limit' },
  ],
  options: [
    { label: 'Hire a marketing manager', provenance: 'explicit', interventions: [
      { factor_label: 'Marketing manager hired', value: 1, unit: 'people', provenance: 'explicit' },
      { factor_label: 'Annual marketing spend', value: 90000, unit: 'GBP', provenance: 'ai_proposed' }] },
    { label: 'AI planning plus advertising', provenance: 'explicit', interventions: [
      { factor_label: 'Advertising spend', value: 60000, unit: 'GBP', provenance: 'ai_proposed' },
      { factor_label: 'Annual marketing spend', value: 70000, unit: 'GBP', provenance: 'ai_proposed' }] },
  ],
  factors: [
    { label: 'Marketing manager hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 3 },
    { label: 'Advertising spend', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'explicit', plausible_max: 100000 },
    { label: 'Annual marketing spend', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'explicit', plausible_max: 200000 },
    { label: 'Conversion rate', role: 'observable', baseline_known: false, baseline_value: 10, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Marketing manager hired', to: 'Conversion rate', direction: 'positive', provenance: 'ai_proposed', effect_amount: 4,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'A specialist improves targeting.' },
    { from: 'Advertising spend', to: 'Conversion rate', direction: 'positive', provenance: 'ai_proposed', effect_amount: 2,
      effect_per_source_change: 50000, effect_provenance: 'ai_proposed', definitional: null, basis: 'More reach brings warmer leads.' },
    { from: 'Conversion rate', to: 'New customers', direction: 'positive', provenance: 'ai_proposed', effect_amount: 2,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'Each point of conversion adds customers.' },
    { from: 'Annual marketing spend', to: 'New customers', direction: 'positive', provenance: 'ai_proposed', effect_amount: 0,
      effect_per_source_change: 10000, effect_provenance: 'ai_proposed', definitional: null, basis: 'Spend itself is the budget, not a driver.' },
  ],
  identities: [], unknowns: [], decision_question: null,
} as unknown as CandidateModel);

describe('readback — marketing: both targets are stored as the goal\'s targets and reach the engine strictly', () => {
  it('RED: the stored rows mark both targets (conversion ">" via operator_as_stated, the goal\'s own ">= 20") and keep the limit a limit', async () => {
    const reloaded = JSON.parse(store(marketing())) as Rec;
    const rows = reloaded.goal_constraints as Rec[];
    const conv = rows.find((r) => r.node_id === 'conversion_rate')!;
    const own = rows.find((r) => r.node_id === 'new_customers')!;
    const spend = rows.find((r) => r.node_id === 'annual_marketing_spend')!;
    expect(conv).toMatchObject({ operator: '>=', operator_as_stated: '>', value: 15, unit: '%', value_frame: 'level', role: 'goal_target' });
    expect(own).toMatchObject({ operator: '>=', value: 20, unit: 'customers', value_frame: 'level', role: 'goal_target' });
    expect(spend).toMatchObject({ operator: '<=', value: 100000, value_frame: 'level' });
    expect(spend.role).toBeUndefined();
  });

  it('RED: the PLoT request carries "> 15" and ">= 20" and "<= 100000" as explicit rows (no CEE-only keys); the Run record keeps ">"', async () => {
    const { payload, snapshot } = await runFromStore(store(marketing()));
    const sent = payload.goal_constraints as Rec[];
    const by = (nodeId: string): Rec => sent.find((r) => r.node_id === nodeId)!;
    expect(by('conversion_rate')).toMatchObject({ operator: '>', value: 15, unit: '%', value_frame: 'level' });
    expect(by('new_customers')).toMatchObject({ operator: '>=', value: 20, value_frame: 'level' });
    expect(by('annual_marketing_spend')).toMatchObject({ operator: '<=', value: 100000, value_frame: 'level' });
    for (const row of sent) {
      expect(row).not.toHaveProperty('role');
      expect(row).not.toHaveProperty('operator_as_stated');
    }
    const recorded = (snapshot.constraints as Rec[]) ?? [];
    expect(recorded.find((c) => c.node_id === 'conversion_rate')).toMatchObject({ operator: '>', raw: 15, frame: 'level' });
  });

  it('RED: reopening the stored bytes sends the SAME request', async () => {
    const bytes = store(marketing());
    const first = await runFromStore(bytes);
    const second = await runFromStore(bytes);
    expect(sentDigest(second.payload)).toBe(sentDigest(first.payload));
  });
});

describe('readback — AIE clause 3 and L6: each target is stored in its OWN frame, bound to its own row, and survives reopening', () => {
  it('RED (AIE clause 3): a secondary target stated as a change is stored as one of the goal\'s targets in its change frame — never forced into a level', () => {
    const m = marketing();
    const changed = { ...m, constraints: [
      { metric: 'Conversion rate', operator: '>=', value: 5, unit: '%', provenance: 'explicit', frame: 'change_abs', role: 'target' },
      ...m.constraints.filter((c) => (c as Rec).role === 'limit'),
    ] } as CandidateModel;
    const rows = (JSON.parse(store(changed)) as Rec).goal_constraints as Rec[];
    const conv = rows.find((r) => r.node_id === 'conversion_rate')!;
    expect(conv).toMatchObject({ value_frame: 'change_abs', value: 5, role: 'goal_target' });
    expect(conv.value_frame).not.toBe('level');
  });

  it('L6: every stored target row is bound BY IDENTITY to its own node and label, and a second save/reopen is byte-identical', async () => {
    const bytes = store(marketing());
    const g = JSON.parse(bytes) as Rec;
    const targets = (g.goal_constraints as Rec[]).filter((r) => r.role === 'goal_target');
    expect(targets.map((r) => [r.node_id, node(g, r.node_id).label, r.operator_as_stated ?? r.operator, r.value, r.unit])).toEqual([
      ['new_customers', 'New customers', '>=', 20, 'customers'],
      ['conversion_rate', 'Conversion rate', '>', 15, '%'],
    ]);
    // Reopen → save again: the store's own contract parse keeps every target row exactly (no role, operator or binding lost).
    expect(JSON.stringify(GraphV3.parse(JSON.parse(bytes)))).toBe(bytes);
    // And the production loader hands the Run the same bound rows.
    const { payload } = await runFromStore(bytes);
    const sent = payload.goal_constraints as Rec[];
    for (const t of targets) expect(sent.find((r) => r.constraint_id === t.constraint_id)).toMatchObject({ node_id: t.node_id, value: t.value });
  });
});

describe('readback — gap 1: a change goal\'s effects are stored and said in the goal\'s own change unit, never "percentage points"', () => {
  it('RED: each link into Productivity stores amount_unit "%" (of today\'s productivity), and the sizing line says it so', () => {
    const g = JSON.parse(store(hiring())) as Rec;
    for (const from of ['additional_developers_hired', 'additional_tech_leads_hired']) {
      const ne = edge(g, from, 'productivity').provenance.natural_effect;
      expect(ne.amount_unit, from).toBe('%');
    }
    // Every later reader/re-sizer reads the stored size in the SAME unit the construction wrote (else it is "not sized").
    expect(naturalAmountUnitsOf(g.nodes as Rec[]).get('productivity')).toBe('%');
    // The served sizing question for a link still to be sized into the goal says the goal's own unit — not "the model
    // units" (a change goal has no level today to carry one) and never "percentage points".
    const lines = groupedGoalPathLinks(g).filter((l) => l.to === 'productivity');
    expect(lines.map((l) => [l.from, l.target_unit])).toEqual([['first_year_hiring_cost', '%']]);
    for (const l of lines) expect(l.question).toBe('How much does Productivity change, in %, when First-year hiring cost changes by one GBP per change?');
  });

  it('CONTROL: a percentage LEVEL goal still says its size in points (unchanged)', () => {
    const level = hiring(); (level.goal as Rec).quantity_frame = 'level'; (level.goal as Rec).frame = 'level';
    Object.assign(level.goal as Rec, { baseline_known: true, baseline_value: 75, value: 85, basis: null });
    const g = JSON.parse(store(level)) as Rec;
    expect(edge(g, 'additional_developers_hired', 'productivity').provenance.natural_effect.amount_unit).toBe('percentage points');
  });
});

// ── RESPONSE → LICENCE → SCREEN (PL 6116591012 / 6116771927; independent check C-cee r1, test-evidence gap) ─────────────
// The same stored bytes → production loader → the REAL Run handler, now with PLoT ANSWERING (the response rows below are
// written by hand, in each goal's own units) → the licence the handler stores with the Run → the screen sentences read back
// against the reopened graph. Expected words are written by hand from the decision text, never read off the code.

/** The Run handler end to end, PLoT faked with `rowsOf(request)`: the request, the stored Run result, its screen view. */
async function runAndRead(bytes: string, rowsOf: (request: Rec) => Rec[], briefText: string | null = null, effectsTiming: 'not_stated' | 'later_or_partial' | null = null): Promise<{ payload: Rec; result: Rec; view: Rec; reloaded: Rec }> {
  const port = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(bytes), briefText, revision: 3 })),
    readMostRecentPendingActions: vi.fn(async () => []),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-batch-c-response', port as never);
  const run = vi.fn(async (request: Rec) => ({ ...structuredClone(minimalFixture), option_comparison: rowsOf(request) }));
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn() } as never, scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-batch-c-response',
    ...(effectsTiming === null ? {} : { kind: 'message', chip: { parameters: { effects_timing: effectsTiming } } }) }, requestId: 'req-batch-c-response',
    signal: new AbortController().signal, context: {}, orientationText: '' } as never) as Rec;
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0] as Rec;
  expect(fact.fact_type).toBe('run_analysis');
  const result = fact.result as Rec;
  return { payload: run.mock.calls[0]![0] as Rec, result, view: { type: 'analysis_result', enrichment: result.enrichment }, reloaded: JSON.parse(bytes) as Rec };
}

const idOf = (request: Rec, label: string): string => (request.options as Rec[]).find((o) => o.label === label)!.id as string;
/** A PLoT option row with its Wilson precision (10,000 informative draws). */
const answered = (id: string, p: number, outcome: Rec): Rec => ({ option_id: id, probability_of_goal: p, outcome,
  probability_of_goal_precision: { basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95, n_informative: 10000,
    n_met: Math.round(p * 10000), interval_lower: Math.max(0, p - 0.01), interval_upper: Math.min(1, p + 0.01) } });
const precision = (p: number): Rec => ({ n_informative: 10000, standard_error: Math.sqrt((p * (1 - p)) / 10000) });

/** Hiring with every link into the goal sized (the hiring cost moves no capacity, so it has no link to size). */
const hiringSized = (): CandidateModel => {
  const h = hiring() as unknown as Rec;
  h.links = (h.links as Rec[]).filter((l) => l.from !== 'First-year hiring cost');
  return h as unknown as CandidateModel;
};
// The status quo's change from today is 0 on every draw (the same-draw reading); the options' changes vary.
const hiringAnswer = (request: Rec): Rec[] => [
  answered(idOf(request, 'Hire a tech lead'), 0.46, { mean: 9, std: 3, p10: 5, p50: 9, p90: 13 }),
  answered(idOf(request, 'Hire two developers'), 0.31, { mean: 8, std: 4, p10: 3, p50: 8, p90: 13 }),
  answered(idOf(request, 'Carry on with the current team'), 0, { mean: 0, std: 0, p10: 0, p50: 0, p90: 0 }),
];
/** AMENDED (AIE #94 6163023819, packet fc17c200; was #94 6160089127's "Carrying on as now: this Run uses …" lines): a CHANGE goal's
 * status-quo row is the AIE's generic line. */
const DOING_NOTHING = (label: string): string => `This Run can’t give a chance for carrying on as now, because it treats ‘${label}’ as unchanged `
  + `from today. Worth checking: how ‘${label}’ could change over the goal period if nothing is done, including any forecast or range already in the model.`;

describe('readback RESPONSE → LICENCE — hiring: a % CHANGE goal is said as "% higher than today", the status quo by assumption, Olumi\'s sizes named', () => {
  it('RED: the stored Run licenses each option on the ruled sentence; the status quo is "no change, by assumption" with no figure or interval', async () => {
    const { result, view, reloaded } = await runAndRead(store(hiringSized()), hiringAnswer);
    const licence = goalChanceLicenceForAgent(view)!;
    expect(licence.chance_words).toBe('chance of ‘Productivity’ being at least 10% higher than today at three months');
    expect(licence.status_quo).toEqual({ option_id: 'carry_on_with_the_current_team', line: DOING_NOTHING('Productivity') });
    expect(licence.withheld_option_ids).toEqual(['carry_on_with_the_current_team']);
    const sq = (result.enrichment.option_comparison as Rec[]).find((r) => r.option_id === 'carry_on_with_the_current_team')!;
    expect(sq).not.toHaveProperty('probability_of_goal_precision');
    expect(sq.outcome).toEqual({ mean: 0, p50: 0 });
    // Provisional (amendment 7): both effect sizes into the goal are Olumi's (9% per tech lead, 4% per developer, drafted
    // ai_proposed); each option's own setting (1 lead, 2 developers) is the user's.
    // ⛔ RE-SCOPE 2 (R5-2; DL AMEND) — CHANGED EXPECTATION (an added note; the faces are unchanged): the two starting values
    // (0 tech leads, 0 developers today) were drafted as the user's but admission could not verify them against a brief
    // (`user_material_unverified`, stored here with no brief). Neither Olumi's nor attested as the user's: UNVERIFIED, said once
    // beside the result — before, they were silently treated as nobody's ("zero estimates").
    expect(licence.provisional).toBe(true);
    expect(licence.notes!.filter((n) => n === UNVERIFIED_SOURCES_NOTE)).toHaveLength(1);
    const faces = goalChanceCellFacesForAgent(view, reloaded, true);
    expect([...faces]).toEqual([
      ['hire_a_tech_lead', '‘Hire a tech lead’: about 46% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).'],
      ['hire_two_developers', '‘Hire two developers’: about 31% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).'],
    ]);
    expect(goalChanceNotesForAgent(view, reloaded, true)).toEqual(expect.arrayContaining([DOING_NOTHING('Productivity'),
      'This assumes carrying on as now leaves ‘Productivity’ unchanged through month three; each option is measured against that.']));
    expect(JSON.stringify(licence)).not.toMatch(/percentage point/);
  });

  it('D3 (AIE #94 6128697025): the same Run with effects NOT stated at month three says why on each option, through the real handler', async () => {
    // The protected field as construction would store it (ruling 12); the CONTRAST is the test above (true → licensed, unchanged).
    const g = JSON.parse(store(hiringSized())) as Rec;
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    goal.goal_target_basis = { ...(goal.goal_target_basis as Rec), effects_at_period_end: false };
    const { result, view } = await runAndRead(JSON.stringify(g), hiringAnswer);
    expect(goalChanceLicenceForAgent(view), 'no chance is computed or licensed').toBeUndefined();
    const warning = (result.enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE'
      && (w.detail as Rec | undefined)?.reason === 'effects_at_period_end_unstated')!;
    // This stored goal holds no comparator, so the readiness words say no bound ("up 10% from today", `sayGoalChange`).
    expect(warning.message).toBe('The chance of reaching your target for ‘Productivity’ (up 10% from today) by month three isn’t shown: '
      + 'the model has not established how much of these effects would be in place by then.');
    // Each scored option but carrying on as now (`opt_only` is the harness fixture's own carrier row, as for every withhold).
    expect(warning.option_ids).toEqual(expect.arrayContaining(['hire_a_tech_lead', 'hire_two_developers']));
    expect(warning.option_ids).not.toContain('carry_on_with_the_current_team');
    for (const r of (result.enrichment.option_comparison as Rec[]).filter((x) => x.option_id !== 'carry_on_with_the_current_team')) {
      expect(r, String(r.option_id)).not.toHaveProperty('probability_of_goal');
    }
  });

  it('G (AIE #94 6128697025; amendments 6131950992): with the brief read, the same Run is licensed CONDITIONALLY through the real handler, and it survives the stored bytes', async () => {
    const g = JSON.parse(store(hiringSized())) as Rec;
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    goal.goal_target_basis = { ...(goal.goal_target_basis as Rec), effects_at_period_end: false };
    const brief = 'Should we hire a tech lead or two developers to raise productivity by at least 10% within three months?';
    const { result, payload, reloaded } = await runAndRead(JSON.stringify(g), hiringAnswer, brief, 'not_stated');
    // G2: the AI reading replaces the deleted word-list inference; outcome assertions remain unchanged.
    // The sent goal is the held one: the handler's own request carries the same basis (false, never flipped).
    expect(node(payload.graph, 'productivity').goal_target_basis).toMatchObject({ effects_at_period_end: false, period_months: 3 });
    // The AI reading is CEE's licence fact, never a new provider-envelope field.
    expect(result.enrichment).not.toHaveProperty('effects_timing');
    expect(result.enrichment).not.toHaveProperty('effects_timing_origin');
    expect((result.enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_CHANCE_LICENSED'))
      .toMatchObject({ effects_timing: 'not_stated', effects_timing_origin: 'olumi' });
    // The stored fact, as bytes, read cold.
    const view = { type: 'analysis_result', enrichment: (JSON.parse(JSON.stringify(result)) as Rec).enrichment };
    const licence = goalChanceLicenceForAgent(view)!;
    const note = 'Provisional: this calculation assumes the estimated effects are in place by month three. It does not model when they arrive.';
    expect(licence.period_end_assumption).toEqual({ origin: 'olumi', period_months: 3, reference: 'today' });
    expect(licence.chance_words).toBe('chance of ‘Productivity’ being at least 10% higher than today at three months');
    expect(goalChanceNotesForAgent(view, reloaded, true).filter((n) => n === note)).toHaveLength(1);
    expect([...goalChanceCellFacesForAgent(view, reloaded, true)].map(([id]) => id)).toEqual(['hire_a_tech_lead', 'hire_two_developers']);
    expect((result.enrichment.inference_warnings as Rec[]).some((w) => (w.detail as Rec | undefined)?.reason === 'effects_at_period_end_unstated')).toBe(false);
    expect(goalTargetBasisOf(node(reloaded, 'productivity'))!.effects_at_period_end).toBe(false);
    // The typed Run rows store each licensed chance as CONDITIONAL (permitted_with_caveat), never an unqualified permission.
    const rows = toTypedRunRows({ fact_type: 'run_analysis', fact_version: 1, noop: false, result: JSON.parse(JSON.stringify(result)) },
      { scenarioId: SCENARIO });
    expect(rows, JSON.stringify(rows).slice(0, 300)).toHaveProperty('ok');
    if (!('ok' in rows)) throw new Error(JSON.stringify(rows));
    const typed = Object.fromEntries(rows.ok.options.map((o) => [o.option_id, o.licence_status]));
    expect(typed).toMatchObject({ hire_a_tech_lead: 'permitted_with_caveat', hire_two_developers: 'permitted_with_caveat' });
    // CONTRAST, the same handler: a brief stating only half the gain by month three withholds with E's sentence.
    const half = await runAndRead(JSON.stringify(g), hiringAnswer, `${brief} We expect only half the productivity gain by month 3.`, 'later_or_partial');
    expect(goalChanceLicenceForAgent({ type: 'analysis_result', enrichment: half.result.enrichment })).toBeUndefined();
    expect((half.result.enrichment.inference_warnings as Rec[]).find((w) => (w.detail as Rec | undefined)?.reason === 'effects_at_period_end_unstated')!.message)
      .toBe('The chance of reaching your target for ‘Productivity’ (up 10% from today) by month three isn’t shown: '
        + 'the model has not established how much of these effects would be in place by then.');
  });

  it.each((JSON.parse(readFileSync('tests/fixtures/batch-g/AIE-G-TIMING-PHRASES-20261012.json', 'utf8')) as {
    cases: { id: string; text: string; expected: string }[] }).cases.map((c) => [c.id, c] as const))(
    'G corpus (AIE #94 6133027121), through the real Run handler — every case states timing, so all withhold (DL G r2, fail safe): %s', async (_id, c) => {
      const g = JSON.parse(store(hiringSized())) as Rec;
      const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
      goal.goal_target_basis = { ...(goal.goal_target_basis as Rec), effects_at_period_end: false };
      const brief = `Should we hire a tech lead or two developers to raise productivity by at least 10% within three months? ${c.text}`;
      const { result } = await runAndRead(JSON.stringify(g), hiringAnswer, brief);
      const view = { type: 'analysis_result', enrichment: (JSON.parse(JSON.stringify(result)) as Rec).enrichment };
      const withheld = (result.enrichment.inference_warnings as Rec[]).some((w) => (w.detail as Rec | undefined)?.reason === 'effects_at_period_end_unstated');
      const licence = goalChanceLicenceForAgent(view);
      const verdict = withheld && licence === undefined ? 'CONTRADICTS'
        : !withheld && licence?.period_end_assumption?.origin === 'olumi' ? 'NOT_A_CONTRADICTION' : 'OTHER';
      // The AIE's NOT_A_CONTRADICTION cases (GT05–GT10) state timing too, so they now withhold (listed in the G r2 handback).
      expect(verdict, `${c.id} (AIE: ${c.expected})`).toBe('CONTRADICTS');
    });

  it('RED (amendment 7, per option): an option whose OWN setting is Olumi\'s says so on its result only — never on another option\'s', async () => {
    const h = hiringSized() as unknown as Rec;
    // ‘Hire two developers’ drafted with Olumi's own level for developers (not the user's 2).
    (h.options as Rec[])[1].interventions[0].provenance = 'ai_proposed';
    const { view, reloaded } = await runAndRead(store(h as unknown as CandidateModel), hiringAnswer);
    const faces = goalChanceCellFacesForAgent(view, reloaded, true);
    expect(faces.get('hire_two_developers')).toBe('‘Hire two developers’: about 31% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model, using Olumi\'s estimates for 1 option setting and 2 relationships (see Check estimates).');
    expect(faces.get('hire_a_tech_lead')).toBe('‘Hire a tech lead’: about 46% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).');
  });
});

/**
 * Capacity, a percentage LEVEL (75% today) raised by 10 percentage points at three months — now THROUGH CONSTRUCTION (DL,
 * 12 Oct, after the frames fix 43e4c7e): the drafter's candidate (scripted, 0 LLM calls) → `buildModelFromBrief` (admission
 * with the brief's own readers, refit, the structural gate) → the registered graph → store → loader → Run → licence → screen.
 * The brief and candidate are written by hand; every offset is computed from the brief, never typed.
 */
const CAPACITY_BRIEF = 'We have 0 additional tech leads hired today. '
  + 'Our development capacity is 75% today: the rest of the team\'s time goes on meetings and support. '
  + 'We have 0 additional developers hired today. '
  + 'Should we hire a tech lead, hire two developers, or carry on with the current team? '
  + 'Hire a tech lead adds 1 tech lead. Hire two developers adds 2 developers. Carry on with the current team adds nobody. '
  + 'Goal: development capacity at least 10 percentage points higher than today at three months.';
const quoteIn = (brief: string, q: string): { quote: string; start: number; end: number } => {
  const start = brief.indexOf(q);
  if (start < 0 || brief.indexOf(q, start + 1) >= 0) throw new Error(`not exactly once in the brief: ${q}`);
  return { quote: q, start, end: start + q.length };
};
const settingEvidence = (brief: string, sentence: string, option: string, figure: string): Rec => {
  const e = quoteIn(brief, sentence);
  const o = quoteIn(brief, option);
  return { ...e, amount_start: brief.indexOf(figure, e.start), option_quote: option, option_start: o.start, option_end: o.end };
};
const capacityDraft = (): Rec => ({
  goal: { kind: null, deliverable: null, metric: 'Development capacity', operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3,
    provenance: 'explicit', frame: 'change_abs', quantity_frame: 'level', baseline_known: true, baseline_value: 75, baseline_provenance: 'explicit', scope: null,
    basis: { reference: 'today', denominator: 'today’s development capacity (75%)', period_months: 3, period_kind: 'at_end',
      effect_unit: 'percentage points of capacity per added person, at month three', effects_at_period_end: true, also_required: null, open_question: null } },
  constraints: [],
  options: [
    { label: 'Hire a tech lead', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null, interventions: [
      { factor_label: 'Additional tech leads hired', value: 1, value_kind: 'absolute', unit: 'people', provenance: 'explicit',
        stated_evidence: settingEvidence(CAPACITY_BRIEF, 'Hire a tech lead adds 1 tech lead.', 'Hire a tech lead', '1') }] },
    { label: 'Hire two developers', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null, interventions: [
      { factor_label: 'Additional developers hired', value: 2, value_kind: 'absolute', unit: 'people', provenance: 'explicit',
        stated_evidence: settingEvidence(CAPACITY_BRIEF, 'Hire two developers adds 2 developers.', 'Hire two developers', '2') }] },
    { label: 'Carry on with the current team', provenance: 'explicit', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
  ],
  factors: [
    { label: 'Additional tech leads hired', role: 'controllable', baseline_known: true, baseline_evidence: { quote: 'We have 0 additional tech leads hired today.' },
      baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 5 },
    { label: 'Additional developers hired', role: 'controllable', baseline_known: true, baseline_evidence: { quote: 'We have 0 additional developers hired today.' },
      baseline_value: 0, unit: 'people', provenance: 'explicit', plausible_max: 10 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Additional tech leads hired', to: 'Development capacity', direction: 'positive', provenance: 'ai_proposed', effect_amount: 9,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'A ramped-up tech lead adds review and planning capacity.' },
    { from: 'Additional developers hired', to: 'Development capacity', direction: 'positive', provenance: 'ai_proposed', effect_amount: 4,
      effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: null, basis: 'Each developer adds capacity once recruited and ramped up.' },
  ],
  identities: [], unknowns: [], decision_question: 'Should we hire a tech lead, hire two developers, or carry on with the current team?',
});

/** The real construction path, one scripted drafter call; the registered graph's stored bytes. */
async function constructedBytes(brief: string, draft: Rec | string): Promise<{ bytes: string; calls: number }> {
  let registered: unknown;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  let calls = 0;
  const call = (async () => { calls += 1; return { text: typeof draft === 'string' ? draft : JSON.stringify(draft) }; }) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  return { bytes: JSON.stringify(GraphV3.parse(registered)), calls };
}
async function capacityBytes(): Promise<string> {
  const { bytes, calls } = await constructedBytes(CAPACITY_BRIEF, capacityDraft());
  expect(calls).toBe(1);
  // What admission stored, by identity: today's 75% as the user's, Olumi's validated reading "level", sizes in points.
  const g = JSON.parse(bytes) as Rec;
  const goal = node(g, 'development_capacity');
  expect(goal.observed_state).toMatchObject({ raw_value: 75, source: 'brief_extraction', unit: '%' });
  expect(goal.goal_target_basis).toMatchObject({ quantity_frame: 'level', target_frame: 'change_abs', target_raw: 10, reference: 'today', period_months: 3 });
  expect(goalTargetBasisOf(goal)?.quantity_frame).toBe('level');
  for (const from of ['additional_tech_leads_hired', 'additional_developers_hired']) {
    expect(edge(g, from, 'development_capacity').provenance.natural_effect.amount_unit).toBe('percentage points');
  }
  return bytes;
}
// The status quo stays at today's 75% on every draw; the options' levels vary. D2 (DL ruling A, 12 Oct, recovery Batch D):
// WIRE-SHAPED, on the normalised scale the engine samples (0.75 = 75/100; served capacity 0.16 = 80/500), never raw 75.
const capacityAnswer = (request: Rec): Rec[] => [
  answered(idOf(request, 'Hire a tech lead'), 0.46, { mean: 0.84, std: 0.03, p10: 0.8, p50: 0.84, p90: 0.88 }),
  answered(idOf(request, 'Hire two developers'), 0.31, { mean: 0.83, std: 0.03, p10: 0.79, p50: 0.83, p90: 0.87 }),
  answered(idOf(request, 'Carry on with the current team'), 0, { mean: 0.75, std: 0, p10: 0.75, p50: 0.75, p90: 0.75 }),
];

describe('readback RESPONSE → LICENCE — capacity: a percentage LEVEL raised by 10 is said in POINTS (75% → 85%, never 82.5%)', () => {
  it('RED: "10 percentage points higher than today", never "10% higher"; the status quo (D2 contrast) keeps its true zero-spread line', async () => {
    const { result, view, reloaded } = await runAndRead(await capacityBytes(), capacityAnswer);
    const licence = goalChanceLicenceForAgent(view)!;
    expect(licence.chance_words).toBe('chance of ‘Development capacity’ being at least 10 percentage points higher than today at three months');
    // D2 CONTRAST (DL ruling A, 12 Oct, Batch D): a change target on a level quantity never records the frame it scored in
    // (its threshold is a change, its samples are levels), so carrying on is read on no frame: no "no change, by assumption"
    // and no "doesn't match today". It keeps its typed zero-spread reason and side, with the one line that says no future
    // event (capacity post3010 row 3), never a blank or a new withhold.
    expect(licence.status_quo).toBeUndefined();
    expect(licence.withheld_option_ids).toContain('carry_on_with_the_current_team');
    expect(licence.withheld_reason_by_option?.carry_on_with_the_current_team).toEqual({ reason: 'zero_spread', side: 'falls_short',
      line: 'Chance not shown: this result reports a very narrow central range or a very small spread. '
        + 'That alone does not establish certainty. Review whether the model captures the uncertainties that matter for this option.' });
    expect(JSON.stringify(licence)).not.toMatch(/by assumption|doesn’t match/);
    // Its row is the Run's own, intervals kept: none is removed for an assumption that is not claimed.
    expect((result.enrichment.option_comparison as Rec[]).find((r) => r.option_id === 'carry_on_with_the_current_team')!.outcome)
      .toEqual({ mean: 0.75, std: 0, p10: 0.75, p50: 0.75, p90: 0.75 });
    const faces = goalChanceCellFacesForAgent(view, reloaded, true);
    expect(faces.get('hire_a_tech_lead')).toBe('‘Hire a tech lead’: about 46% chance of ‘Development capacity’ being at least 10 percentage points higher than today at three months, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).');
    expect(JSON.stringify([...faces, licence])).not.toMatch(/10% higher/);
  });

  it('ADVERSE (AIE status-quo disposition): a status quo the Run MOVED (its draws spread around 78%, not today\'s 75%) is withheld until checked — never "no change", never a finding', async () => {
    // D2 (DL ruling A): wire-shaped, and moved on every frame (a spread), since this Run records no frame to compare a level in.
    const moved = (request: Rec): Rec[] => capacityAnswer(request).map((r) => (r.option_id === 'carry_on_with_the_current_team'
      ? { ...r, outcome: { mean: 0.78, std: 0.01, p10: 0.77, p50: 0.78, p90: 0.79 } } : r));
    const bytes = await capacityBytes();
    const { view } = await runAndRead(bytes, moved);
    const licence = goalChanceLicenceForAgent(view)!;
    expect(licence.status_quo).toBeUndefined();
    expect(JSON.stringify(licence)).not.toMatch(/by assumption/);
    expect(licence.withheld_option_ids).toContain('carry_on_with_the_current_team');
    expect(licence.withheld_reason_by_option?.carry_on_with_the_current_team).toEqual({ reason: 'reference_moved',
      line: 'Not shown: this run’s result for carrying on as now doesn’t match ‘Development capacity’ as it stands today in the model, so it needs checking first.' });
    expect(goalChanceCellFacesForAgent(view, JSON.parse(bytes), true).has('carry_on_with_the_current_team')).toBe(false);
  });
});

/**
 * Paul's own capacity level brief: the SERVED drafter response (row 470fa988, the frames spec's fixture) through
 * construction. ⛔ Batch C RE-SCOPE (DL after independent check r2, BLOCKING 1): the defined-by-parts level credit is out of
 * C, so the drafter's "inferred" 80 is NOT the user's and the goal holds no current level. Without an anchor the same-draw
 * reference is not established: no "no change" is claimed of carrying on, and the chance waits for the level, with the
 * true reason and its next step (a negative kept).
 */
const SERVED_CAPACITY = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };

describe('readback RESPONSE → LICENCE — the served capacity level brief (at least 100 tickets per week): withheld for its missing level', () => {
  it('WITHHOLD (re-scope): no current level is held, so no chance and no "no change" is said — the reason asks for the level', async () => {
    const { bytes, calls } = await constructedBytes(SERVED_CAPACITY.brief, SERVED_CAPACITY.raw_text);
    expect(calls).toBe(1);
    expect(node(JSON.parse(bytes), 'weekly_support_capacity').observed_state).toBeUndefined();
    const answer = (request: Rec): Rec[] => [
      answered(idOf(request, 'Keep current staffing'), 0, { mean: 80, std: 0, p10: 80, p50: 80, p90: 80 }),
      answered(idOf(request, 'Add one specialist'), 0.62, { mean: 100, std: 9, p10: 89, p50: 100, p90: 112 }),
    ];
    const { result, view } = await runAndRead(bytes, answer);
    // No chance is licensed for any option, so no status-quo line and no assumption either.
    expect(goalChanceLicenceForAgent(view)).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/by assumption|carrying on as now leaves/);
    const untestable = (result.enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE')!;
    expect(untestable.option_ids).toEqual(['keep_current_staffing', 'add_one_specialist']);
    expect(untestable.message).toContain('it needs today\'s level of Weekly support capacity');
    for (const row of result.enrichment.option_comparison as Rec[]) expect(row).not.toHaveProperty('probability_of_goal');
  });
});

// ── CENSUS (DL re-scope after independent check r2, BLOCKING 2; re-scope check r1, BLOCKING 1): goal conditions draft →
// admission → store → reader → licence. ONE RULE: a condition the drafter retained is never dropped and never changed. Six in →
// the SAME six bytes at admission, in the store, from the reader and in the licence's "does not include" line, each by identity:
// every comparison sign (> < >= <= = ≤ ≥), figure, period and reference kept. One that cannot be kept so refuses the reading.
const LONG_200 = `the release keeps every existing customer integration working without any change on their side, including the partner portal, the reporting exports and the single-sign-on flow, through the whole rollout`;
const LONG_400 = `${'the support rota stays covered every weekday from eight in the morning until eight in the evening, '.repeat(4)}with no single person on call for more than two weeks running`;
const SIX = ['code quality maintained', 'no weekend releases', 'the on-call load per person does not rise', LONG_200, LONG_400, 'docs updated {for every API} <change>'];
const OPERATORS = ['conversion > 15%', 'conversion < 15%', 'spend <= £200,000', 'NPS >= 40 by month six', 'headcount = 12 at launch',
  'churn ≤ 3% of today’s customers', 'uptime ≥ 99.9%   over the first quarter'];
const hiringWith = (also: readonly string[]): CandidateModel => {
  const h = hiringSized() as unknown as Rec;
  h.goal = { ...h.goal, basis: { ...HIRING_BASIS, also_required: [...also] } };
  return h as unknown as CandidateModel;
};
/** Every hop's conditions, and the licence's one "does not include" line. */
async function conditionHops(also: readonly string[]): Promise<{ admitted: unknown; stored: unknown; reader: unknown; covers: string[] }> {
  const admitted = node(admitCandidateModel(hiringWith(also)) as unknown as Rec, 'productivity').goal_target_basis?.also_required;
  const bytes = store(hiringWith(also));
  const goal = node(JSON.parse(bytes), 'productivity');
  const { view } = await runAndRead(bytes, hiringAnswer);
  const covers = (goalChanceLicenceForAgent(view)!.notes ?? []).filter((n) => n.startsWith('This chance covers '));
  return { admitted, stored: goal.goal_target_basis?.also_required, reader: goalTargetBasisOf(goal)?.also_required, covers };
}

describe('CENSUS — goal conditions: the same bytes at admission, in the store, from the reader and in the licence', () => {
  it('RED on 2ecbae5 and 5145af8 (r2 BLOCKING 2; re-scope r1 BLOCKING 1): none of six conditions is dropped or changed — not one over 300 characters, not its markup', async () => {
    expect(new Set(SIX).size).toBe(6);
    expect(LONG_400.length).toBeGreaterThan(300);
    expect(LONG_400.length).toBeLessThanOrEqual(500);
    const hops = await conditionHops(SIX);
    expect(hops.admitted).toEqual(SIX);
    expect(hops.stored).toEqual(SIX);
    expect(hops.reader).toEqual(SIX);
    expect(hops.covers).toEqual([`This chance covers ‘Productivity’ only. It does not include: ‘First-year hiring cost’ at most £200,000; ${SIX.join('; ')}.`]);
    for (const c of SIX) expect(hops.covers[0]!.split(c).length - 1, c).toBe(1);
  });

  it('RED on 5145af8 (re-scope r1 BLOCKING 1): every comparison survives every hop — > < >= <= = ≤ ≥, its period and reference', async () => {
    const hops = await conditionHops(OPERATORS);
    expect(hops.admitted).toEqual(OPERATORS);
    expect(hops.stored).toEqual(OPERATORS);
    expect(hops.reader).toEqual(OPERATORS);
    expect(hops.covers).toEqual([`This chance covers ‘Productivity’ only. It does not include: ‘First-year hiring cost’ at most £200,000; ${OPERATORS.join('; ')}.`]);
    // "conversion > 15%" and "conversion < 15%" stay two different conditions; "<=" is never "=".
    expect(hops.covers[0]).toContain('; conversion > 15%; conversion < 15%; spend <= £200,000; ');
  });

  // ⛔ RE-SCOPE 2 (R5-5; AIE e58 text) — CHANGED EXPECTATION: the face says exactly the AIE's sentence; the bounds (20
  // conditions, 500 characters, one line) stay in validation only and never reach the person's words.
  const UNSUPPORTED = 'No chance of meeting the target for ‘Productivity’ is shown yet: Olumi cannot keep every additional condition intact in this analysis.';
  it.each([
    ['more conditions than can be kept whole (21)', Array.from({ length: 21 }, (_, i) => `condition number ${i + 1} holds`)],
    ['a condition too long to keep word for word (501 characters)', ['code quality maintained', `conversion > 15% ${'x'.repeat(484)}`]],
    ['a condition over two lines', ['code quality maintained', 'conversion > 15%\nwithin six months']],
  ])('%s refuses the WHOLE reading, with the reason — never a subset, never a changed condition', (_name, also) => {
    const admitted = admitCandidateModel(hiringWith(also)) as unknown as Rec;
    const goal = node(admitted, 'productivity');
    // ⛔ RE-SCOPE 2 (R5-5 (a), DL ruling) — CHANGED EXPECTATION: the refused reading is no longer simply absent. Admission keeps
    // the goal's reading WITHOUT any condition (never a subset) and carries the AIE's sentence on the existing carrier
    // (`goal_target_basis.open_question` = `CONDITIONS_NOT_KEPT`), so the Run's gate says why no chance is shown after a reopen.
    expect(goal.goal_target_basis).toMatchObject({ open_question: CONDITIONS_NOT_KEPT });
    expect(goal.goal_target_basis.also_required ?? null).toBeNull();
    expect(goal).not.toHaveProperty('goal_threshold');
    const reasons = ((admitted.loss ?? []) as Rec[]).map((l) => l.reason);
    expect(reasons).toContain(UNSUPPORTED);
    expect(JSON.stringify(reasons)).not.toMatch(/at most 20|500 characters|one line|word for word|keep whole/);
  });
});

/** Marketing with every link into a target sized (one customer per point of conversion, on a 0–20% conversion frame). */
const marketingSized = (): CandidateModel => {
  const m = marketing() as unknown as Rec;
  m.links = (m.links as Rec[]).filter((l) => l.from !== 'Annual marketing spend')
    .map((l) => (l.from === 'Conversion rate' ? { ...l, effect_amount: 1 } : l));
  Object.assign((m.factors as Rec[]).find((f) => f.label === 'Conversion rate')!, { plausible_max: 20 });
  return m as unknown as CandidateModel;
};
const marketingAnswer = (request: Rec): Rec[] => {
  const target = (nodeId: string): string => (request.goal_constraints as Rec[]).find((r) => r.node_id === nodeId)!.constraint_id as string;
  const [customers, conversion] = [target('new_customers'), target('conversion_rate')];
  return ([['Hire a marketing manager', 0.6, 0.42, 0.3], ['AI planning plus advertising', 0.7, 0.55, 0.45]] as const).map(([label, nc, cv, both]) => ({
    ...answered(idOf(request, label), nc, { mean: 22, std: 4, p10: 17, p50: 22, p90: 27 }),
    constraint_probabilities: { [customers]: nc, [conversion]: cv },
    constraint_probabilities_precision: { [customers]: precision(nc), [conversion]: precision(cv) },
    probability_of_joint_goal: both, probability_of_joint_goal_precision: precision(both),
  }));
};

describe('readback RESPONSE → LICENCE — marketing: "above 15%" is said only where the engine scored ">"', () => {
  it('ADVERSE (amendment 7, real Run): conversion\'s level today is Olumi\'s estimate, so its own chance and the joint are never said', async () => {
    const { view } = await runAndRead(store(marketingSized()), marketingAnswer);
    const targets = goalChanceLicenceForAgent(view)!.targets!;
    expect(targets.per_target.map((t) => t.constraint_id)).toEqual(['agent-lane:new_customers:>=']);
    expect(targets.per_target[0]!.words).toBe('‘New customers’ being at least 20 customers over the first three months after launch');
    expect(targets.joint).toMatchObject({ status: 'withheld', reason: 'olumi_base' });
    expect(JSON.stringify([targets.per_target, targets.joint])).not.toMatch(/above 15%/);
  });

  /**
   * Once the user has confirmed conversion today (the approval card stores source `user_confirmed`), the licence the
   * handler writes (`withGoalChanceLicence`, run-analysis.ts) reads the request the handler BUILT from these stored bytes.
   */
  async function confirmed(): Promise<{ bytes: string; payload: Rec; reloaded: Rec }> {
    const g = JSON.parse(store(marketingSized())) as Rec;
    const conversion = node(g, 'conversion_rate');
    conversion.observed_state = { value: 0.5, unit: '%', source: 'user_confirmed', raw_value: 10, cap: 20, declared_scale: 'unit_interval' };
    conversion.provenance = 'user_set';
    const bytes = JSON.stringify(GraphV3.parse(g));
    const { payload, reloaded } = await runFromStore(bytes);
    return { bytes, payload, reloaded };
  }
  const licenceOver = (payload: Rec, reloaded: Rec, sent: unknown) => {
    const run = withGoalChanceLicence({ option_comparison: marketingAnswer(payload) }, reloaded, 'new_customers', undefined, undefined, reloaded,
      { storedConstraints: reloaded.goal_constraints, sentConstraints: sent });
    return goalChanceLicenceForAgent({ type: 'analysis_result', enrichment: run })!;
  };

  it('RED: the request the handler built sends ">" — so conversion\'s own chance is said "above 15%", and the joint names every condition', async () => {
    const { payload, reloaded } = await confirmed();
    expect((payload.goal_constraints as Rec[]).find((r) => r.node_id === 'conversion_rate')).toMatchObject({ operator: '>', value: 15 });
    const targets = licenceOver(payload, reloaded, payload.goal_constraints).targets!;
    expect(targets.per_target.map((t) => [t.words, t.pct_by_option])).toEqual([
      ['‘New customers’ being at least 20 customers over the first three months after launch', { hire_a_marketing_manager: 60, ai_planning_plus_advertising: 70 }],
      ['‘Conversion rate’ being above 15% over the first three months after launch', { hire_a_marketing_manager: 42, ai_planning_plus_advertising: 55 }],
    ]);
    expect(targets.joint).toMatchObject({ status: 'licensed', pct_by_option: { hire_a_marketing_manager: 30, ai_planning_plus_advertising: 45 } });
  });

  it('ADVERSE (r1 item 4): a Run whose request sent ">=" for the stated ">" withholds conversion\'s OWN chance too, and says so', async () => {
    const { payload, reloaded } = await confirmed();
    const oldWire = (payload.goal_constraints as Rec[]).map((r) => (r.node_id === 'conversion_rate' ? { ...r, operator: '>=' } : r));
    const targets = licenceOver(payload, reloaded, oldWire).targets!;
    expect(targets.per_target.map((t) => t.constraint_id)).toEqual(['agent-lane:new_customers:>=']);
    expect(targets.joint).toMatchObject({ status: 'withheld', reason: 'strict_not_preserved',
      line: 'The chance of meeting all of them together isn’t shown, and nor is the chance of ‘Conversion rate’ being above 15% on its own: the comparison the analysis used is not the one you stated.' });
    expect(JSON.stringify(targets.per_target)).not.toMatch(/above 15%/);
  });
});

// ── RE-SCOPE 2 (DL 12 Oct, R5-1; re-scope check r2 BLOCKING 1): the checker's EXACT case, loader → Run → screen ─────────────
// Every input made the person's (each starting value and each option cell from the brief WITH its attestation, each link
// stated by the user), then ONE Olumi `cee_hypothesis` setting DIRECTLY ON THE SCORED GOAL. The request carries it; the
// returned chance must say it rests on it — on that option's chance only — for the single target AND the joint.
// DL 12 Oct (last check BLOCKING 1/3): a figure is the person's only ATTESTED (`brief_extraction` + `explicit`); a type-less
// brief stamp is disclosed as unverified, and `user_confirmed` is Olumi's figure ACCEPTED (provisional) — neither is "theirs".
const allTheirs = (g: Rec): Rec => {
  for (const n of g.nodes as Rec[]) {
    if (n.observed_state) { n.observed_state.source = 'brief_extraction'; n.observed_state.extractionType = 'explicit'; delete n.observed_state.user_material_unverified; }
    if (n.kind === 'option' && n.interventions) for (const c of Object.values(n.interventions as Rec)) if (c && typeof c === 'object') Object.assign(c as Rec, { source: 'brief_extraction', extractionType: 'explicit' });
  }
  for (const e of g.edges as Rec[]) e.provenance = { ...e.provenance, source: 'user_specified', magnitude: 'user_stated' };
  return g;
};

describe('RE-SCOPE 2 R5-1 — the checker\'s case: Olumi\'s setting on the SCORED GOAL reaches the Run and is said', () => {
  it('RED on e58b8dbd (single): hiring — ‘Hire two developers’ sets ‘Productivity’ with Olumi\'s +8; its 31% says so, the other\'s does not', async () => {
    const g = allTheirs(JSON.parse(store(hiringSized())) as Rec);
    node(g, 'hire_two_developers').interventions.productivity = { value: 0.08, raw_value: 8, source: 'cee_hypothesis', target_match: { node_id: 'productivity' } };
    const { payload, view, reloaded } = await runAndRead(JSON.stringify(GraphV3.parse(g)), hiringAnswer);
    expect(optionWire(payload, 'Hire two developers').interventions).toMatchObject({ productivity: 8 });
    const licence = goalChanceLicenceForAgent(view)!;
    expect(licence.provisional).toBe(true);
    expect(licence.olumi_estimate_settings_by_option).toEqual({ hire_two_developers: 1 });
    const faces = goalChanceCellFacesForAgent(view, reloaded, true);
    expect(faces.get('hire_two_developers')).toBe('‘Hire two developers’: about 31% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model, using Olumi\'s estimates for 1 option setting (see Check estimates).');
    expect(faces.get('hire_a_tech_lead')).toBe('‘Hire a tech lead’: about 46% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model.');
  });

  it('CONTROL (single): the same graph with that setting the person\'s — the chance is not provisional and names no estimate', async () => {
    const g = allTheirs(JSON.parse(store(hiringSized())) as Rec);
    node(g, 'hire_two_developers').interventions.productivity = { value: 0.08, raw_value: 8, source: 'user_specified', target_match: { node_id: 'productivity' } };
    const { view, reloaded } = await runAndRead(JSON.stringify(GraphV3.parse(g)), hiringAnswer);
    expect(goalChanceLicenceForAgent(view)!.provisional).toBeUndefined();
    expect(goalChanceCellFacesForAgent(view, reloaded, true).get('hire_two_developers'))
      .toBe('‘Hire two developers’: about 31% chance of ‘Productivity’ being at least 10% higher than today at three months, in this model.');
  });

  /**
   * The joint through the handler's OWN request: the stored bytes → loader → the Run request the handler builds, and the
   * licence the handler writes over that request (`withGoalChanceLicence`, run-analysis.ts) — the existing marketing
   * readback pattern (`licenceOver`). (Through the handler's stored result this graph's conversion and limit P are withheld
   * by the existing R-c rule before any licence — not_returned — so the joint is read over the request it actually sent.)
   */
  it('RED on e58b8dbd (joint): marketing — ‘AI planning plus advertising’ sets ‘New customers’ with Olumi\'s 35; the joint says so', async () => {
    const g = allTheirs(JSON.parse(store(marketingSized())) as Rec);
    node(g, 'conversion_rate').observed_state = { value: 0.5, unit: '%', source: 'user_confirmed', extractionType: 'explicit', raw_value: 10, cap: 20, declared_scale: 'unit_interval' };
    node(g, 'ai_planning_plus_advertising').interventions.new_customers = { value: 0.7, raw_value: 35, source: 'cee_hypothesis', target_match: { node_id: 'new_customers' } };
    const { payload, reloaded } = await runFromStore(JSON.stringify(GraphV3.parse(g)));
    expect(optionWire(payload, 'AI planning plus advertising').interventions).toMatchObject({ new_customers: 35 });
    const run = withGoalChanceLicence({ option_comparison: marketingAnswer(payload) }, reloaded, 'new_customers', undefined, undefined, reloaded,
      { storedConstraints: reloaded.goal_constraints, sentConstraints: payload.goal_constraints });
    const view = { type: 'analysis_result', enrichment: run };
    const licence = goalChanceLicenceForAgent(view)!;
    expect(licence.targets!.joint).toMatchObject({ status: 'licensed', pct_by_option: { hire_a_marketing_manager: 30, ai_planning_plus_advertising: 45 } });
    expect(licence.provisional).toBe(true);
    expect(licence.olumi_estimate_settings_by_option).toEqual({ ai_planning_plus_advertising: 1 });
    const faces = goalChanceCellFacesForAgent(view, reloaded, true);
    expect(faces.get('ai_planning_plus_advertising')).toMatch(/^‘AI planning plus advertising’: about 45% chance of ‘New customers’ being at least 20 customers and ‘Conversion rate’ being above 15% .*, in this model, using Olumi's estimates for 1 option setting \(see Check estimates\)\.$/);
    expect(faces.get('hire_a_marketing_manager')).not.toMatch(/Olumi's estimates/);
  });
});

// ── RE-SCOPE 2 R5-5 (DL rulings 1 and 2): a reading refused FOR ITS CONDITIONS, through the real path ──────────────────────
// The real constructor (`buildModelFromBrief`, scripted drafter) → admission → stored bytes → the production loader → the
// Run handler's own request → the licence, the gate and the screen. The drafter keeps 21 conditions beside the target (more
// than can be kept whole), one of them NOT in the brief ("no releases on weekends").
// Hand-written expectations: the refused reading sends NO threshold, so no chance of meeting that target exists on the Run.
const TWENTY_ONE = [...Array.from({ length: 20 }, (_, i) => `condition number ${i + 1} holds`), 'no releases on weekends'];
const LEVEL_BRIEF = CAPACITY_BRIEF.replace('Goal: development capacity at least 10 percentage points higher than today at three months.',
  'Goal: development capacity at least 85% at three months.');
const NOT_KEPT = 'Not shown. Olumi cannot keep every additional condition intact in this analysis.';
const levelDraft = (also: readonly string[] | null): Rec => {
  const d = capacityDraft();
  Object.assign(d.goal as Rec, { frame: 'level', value: 85 });
  (d.goal as Rec).basis = { ...((d.goal as Rec).basis as Rec), denominator: null, also_required: also };
  return d;
};
async function refusedRun(brief: string, draft: Rec): Promise<{ payload: Rec; result: Rec; view: Rec; reloaded: Rec }> {
  const { bytes } = await constructedBytes(brief, draft);
  expect(LEVEL_BRIEF).not.toContain('no releases on weekends');
  return runAndRead(bytes, capacityAnswer);
}
const notTestable = (result: Rec): Rec[] => ((result.enrichment.inference_warnings ?? []) as Rec[]).filter((w) => w.code === 'GOAL_FIGURES_TARGET_NOT_TESTABLE');

describe('RE-SCOPE 2 R5-5 — a reading refused for its conditions survives the reopen as "no chance", said truly', () => {
  it('RED on e58b8dbd (LEVEL target): no threshold is sent, so no chance is licensed; the gate says the AIE\'s sentence on every cell', async () => {
    const { payload, result, view, reloaded } = await refusedRun(LEVEL_BRIEF, levelDraft(TWENTY_ONE));
    const goal = node(reloaded, 'development_capacity');
    expect(goal).not.toHaveProperty('goal_threshold');
    expect(goal.goal_target_basis).toMatchObject({ open_question: CONDITIONS_NOT_KEPT });
    expect(node(payload.graph, 'development_capacity')).not.toHaveProperty('goal_threshold');
    // e58b8dbd licensed 46% / 31% "chance of meeting your goal" here — scored on no target the person set.
    expect(goalChanceLicenceForAgent(view) ?? null).toBeNull();
    expect(notTestable(result)).toEqual([expect.objectContaining({ message: NOT_KEPT, detail: expect.objectContaining({ reason: 'conditions_not_kept' }) })]);
    expect(((result.enrichment.inference_warnings ?? []) as Rec[]).map((w) => w.code)).not.toContain('GOAL_FIGURES_PLACEHOLDER_PATH');
    const cells = projectCanonicalAnalysisCells(view as never, reloaded);
    for (const id of ['hire_a_tech_lead', 'hire_two_developers']) {
      expect(cells.find((c) => c.option_id === id)!.cell, id).toMatchObject({ kind: 'withheld', why: NOT_KEPT });
    }
    expect(cells.filter((c) => c.cell.kind === 'figure')).toEqual([]);
    for (const c of cells.filter((x) => x.cell.kind === 'withheld')) expect((c.cell as Rec).why, c.option_id).toBe(NOT_KEPT);
    expect([...goalChanceCellFacesForAgent(view, reloaded, true)]).toEqual([]);
    // The Agent's chat says the same sentence, as a statement — never a question, never an invitation to size a link.
    expect(goalChanceWithheldForAgent(view, reloaded)).toMatchObject({ withheld: true, say: CONDITIONS_NOT_KEPT });
    expect(JSON.stringify([...goalChanceCellFacesForAgent(view, reloaded, true), goalChanceNotesForAgent(view, reloaded, true)])).not.toMatch(/\d+%/);
  });

  it('CONTROL (LEVEL target, no conditions): the threshold is sent (0.85) and the chance is licensed on it', async () => {
    const { payload, view, reloaded } = await refusedRun(LEVEL_BRIEF, levelDraft(null));
    expect(node(payload.graph, 'development_capacity').goal_threshold).toBe(0.85);
    expect(goalChanceLicenceForAgent(view)).toBeDefined();
    const faces = goalChanceCellFacesForAgent(view, reloaded, true);
    expect(faces.get('hire_a_tech_lead')).toMatch(/^‘Hire a tech lead’: about 46% chance of ‘Development capacity’ being at least 85% at three months, in this model/);
    expect(faces.get('hire_two_developers')).toMatch(/^‘Hire two developers’: about 31% chance of ‘Development capacity’ being at least 85% at three months, in this model/);
  });

  it('RED on e58b8dbd (CHANGE frame): the conditions sentence wins over the placeholder-path warning — nothing false beside it', async () => {
    const draft = capacityDraft();
    (draft.goal as Rec).basis = { ...((draft.goal as Rec).basis as Rec), also_required: TWENTY_ONE };
    const { result, view, reloaded } = await refusedRun(CAPACITY_BRIEF, draft);
    expect(goalChanceLicenceForAgent(view) ?? null).toBeNull();
    expect(notTestable(result)).toEqual([expect.objectContaining({ message: NOT_KEPT })]);
    expect(((result.enrichment.inference_warnings ?? []) as Rec[]).map((w) => w.code)).not.toContain('GOAL_FIGURES_PLACEHOLDER_PATH');
    expect(goalChanceWithheldForAgent(view, reloaded)).toMatchObject({ withheld: true, say: CONDITIONS_NOT_KEPT });
    for (const c of projectCanonicalAnalysisCells(view as never, reloaded).filter((x) => x.cell.kind === 'withheld')) {
      expect((c.cell as Rec).why, c.option_id).toBe(NOT_KEPT);
    }
  });
});


describe('T4e K1: cold read never licenses an unknown sampled root as zero', () => {
  it.each(['risk', 'outcome'])('a stored %s root withholds with the named next step', async (kind) => {
    const graph = JSON.parse(store(marketing())) as Rec;
    const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    // The user's own risk still withholds and asks first; a DRAFTED one is left out instead (DL 19:26Z, the next row).
    graph.nodes.push({ id: 'unknown_root', kind, label: 'Delivery disruption', ...(kind === 'risk' ? { provenance: 'user_set' } : {}) });
    graph.edges.push({ from: 'unknown_root', to: goal.id, strength: { mean: -0.4, std: 0.1 },
      exists_probability: 1, effect_direction: 'negative' });
    const bytes = JSON.stringify(graph);
    const { AnalysisNotReadyError } = await import('../analysis-ready-core.js');
    try {
      await runFromStore(bytes);
      expect.unreachable('Unknown root must not produce a numerical request');
    } catch (error) {
      expect(error).toBeInstanceOf(AnalysisNotReadyError);
      const { assessCanonicalAnalysisReadiness } = await import('../../../../orchestrator/tools/analysis-ready-helper.js');
      expect(assessCanonicalAnalysisReadiness(JSON.parse(bytes)).blockingIssues.map(i => i.message)).toEqual([kind === 'risk'
        // AIE packet 6e52e896 `event_risk.readiness_copy`: a risk root on the event path is asked its occurrence within the goal's period.
        ? 'Is ‘Delivery disruption’ already true now? If so, say so. If not: How likely is ‘Delivery disruption’ to happen at least once within 3 months? Olumi can’t run the numbers until this risk has a figure. Or ask Olumi to suggest a starting estimate for you to review.'
        : 'What is "Delivery disruption" today, before any option changes it? Without a current level the analysis would treat it as zero.']);
    }
  });
  it('DL 19:26Z: a stored DRAFTED risk root with no figure is left out of the request (with its link), never sent as zero', async () => {
    const graph = JSON.parse(store(marketing())) as Rec;
    const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    graph.nodes.push({ id: 'unknown_root', kind: 'risk', label: 'Delivery disruption' });
    graph.edges.push({ from: 'unknown_root', to: goal.id, strength: { mean: -0.4, std: 0.1 },
      exists_probability: 1, effect_direction: 'negative' });
    const { payload } = await runFromStore(JSON.stringify(graph));
    const sent = payload.graph as Rec;
    expect((sent.nodes as Rec[]).map((n) => n.id)).not.toContain('unknown_root');
    expect((sent.edges as Rec[]).filter((e) => e.from === 'unknown_root' || e.to === 'unknown_root')).toEqual([]);
    expect((sent.nodes as Rec[]).map((n) => n.id)).toContain(goal.id);
  });
});
