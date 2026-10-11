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
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { sentDigest } from '../run-input-snapshot.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { goalTargetBasisOf } from '../../../goal-target/goal-target-basis.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { goalChanceTargetCause } from '../../../goal-target/goal-chance-gate.js';

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
