/**
 * DL 23 Oct (Track 3 funding/hiring on cee 1d8f3c85): every Run cell said "‘<aim>’ has no target or deadline yet…", though both
 * aims carry deadlines and hiring carries its +10% target. The ONE "no target" gap (`goalTargetGapOf`) reads legacy
 * carriers only, and the core mapper wrote neither a held goal's deadline nor a relative target there. The mapper now writes
 * what the person said onto the held goal, so the gap asks only for what is missing: the £ target (funding), or nothing,
 * leaving target-testability to ask for today's level (hiring, `missing_goal_baseline`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { resolveRunAdmission } from '../../../tools/handlers/analysis-ready-core.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { goalTargetGapOf } from '../../../goal-target/goal-target-gap.js';
import { mapLivingModel } from '../mapper.js';

type Json = Record<string, any>;
const SCENARIO = 'f0f0f0f0-0000-4000-8000-000000000024';
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const on = (factor_id: string) => ({ factor_id, estimate_by: null, value: 1, low: null, high: null, unit: null, ...who('take on two people') });
const target = { low: null, high: null, baseline: null, current: null, current_source: null, current_unit: null, period_months: null, change_kind: null, source: null };
const model = (aimText: string, t: Json | null): LivingModelT => ({
  aims: [{ id: 'goal', text: aimText, status: 'current', defined_as: null, ...who(aimText), target: t as never }],
  options: [
    { status: 'feasible', id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or carry on') },
    { status: 'feasible', id: 'hire', label: 'Hire two people', developed_from: null, settings: [on('capacity')], ...who('hire two people') },
  ],
  factors: [{ estimate_by: null, kind: 'factor', limit: null, id: 'capacity', label: 'Team capacity', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('no extra capacity today') }],
  links: [{ id: 'cap_goal', from: 'capacity', to: 'goal', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'range', value: 0.6, sd: null, low: 0.2, high: 1, unit: '%', sign: '+' } }],
  risks: [], conditions: [], views: [], history: [],
});
/** Track 3 funding: Olumi's suggested measure (£, no figure), with the person's own deadline in words. */
const funding = (byWhen: string | null = 'within the next 2 months') => model('Secure funding within the next 2 months',
  { ...target, quantity: 'Funding secured', comparator: '>=', value: null, unit: '£', by_when: byWhen, period_months: byWhen === null ? null : 2, source: 'olumi' });
/** Track 3 hiring: the person's +10% relative change, with no level today. */
const hiring = (comparator: 'increase' | 'decrease' = 'increase') => model('Increase productivity by at least 10%',
  { ...target, quantity: 'Productivity', comparator, value: 10, unit: '%', change_kind: 'relative', by_when: 'in the next three months', period_months: 3 });
const stored = (m: LivingModelT): Json => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Json;
const goalOf = (g: Json): Json => (g.nodes as Json[]).find((n) => n.kind === 'goal')!;

/** The real Run's engine request (snapshot loader, then the handler up to the network). */
async function requestTheRunSends(graph: Json): Promise<Json> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'held-goal-run', {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [] } as never);
  let request: Json | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Json }) => { request = p.plotPayload; } } as never);
  await handler({ payload: { scenario_id: SCENARIO, turn_id: 'held-goal-run', kind: 'message', message: 'Run analysis.' },
    requestId: 'held-goal-run', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  return request!;
}

/**
 * The real Run, answered by a Run recorded from the real chain (`track2-from-zero-means`, held goal), on that recording's own
 * options (carry on, pricing, referral), with the hiring goal: its typed goal-figure reasons.
 */
async function hiringRunReasons(): Promise<Array<[string, string]>> {
  const pricingReferral: LivingModelT = { ...hiring(),
    options: [
      { status: 'feasible', id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or carry on') },
      { status: 'feasible', id: 'pricing', label: 'New pricing page', developed_from: null, settings: [on('pricing_page')], ...who('a pricing page') },
      { status: 'feasible', id: 'referral', label: 'Referral scheme', developed_from: null, settings: [on('referral_running')], ...who('a referral scheme') },
    ],
    factors: ['pricing_page', 'referral_running'].map((id) => ({ estimate_by: null, kind: 'factor' as const, limit: null, id, label: id === 'pricing_page' ? 'Pricing page live' : 'Referral running',
      value: 0, low: null, high: null, unit: null, defined_as: null, ...who('none today') })),
    links: ['pricing_page', 'referral_running'].map((from) => ({ id: `${from}_goal`, from, to: 'goal', source: 'olumi' as const, party: null, quote: null,
      effect: { estimate_by: null, form: 'range' as const, value: 0.6, sd: null, low: 0.2, high: 1, unit: '%', sign: '+' as const } })) };
  const graph = stored(pricingReferral);
  const { _provenance: _, ...body } = JSON.parse(readFileSync(new URL('../../../tools/handlers/__tests__/fixtures/track2-from-zero-held.plot-response.json', import.meta.url), 'utf8')) as Json;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'held-goal-recorded', { readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: JSON.parse(JSON.stringify(graph)), briefText: null })), loadGraph: vi.fn(async () => JSON.parse(JSON.stringify(graph))) } as never);
  const handler = createRunAnalysisHandler({ plotClient: { run: vi.fn(async () => JSON.parse(JSON.stringify(body))), validatePatch: vi.fn().mockResolvedValue({}) } as never,
    scenarioReader: vi.fn(async () => snapshot) } as never);
  const outcome = await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
    request_id: 'held-goal-recorded', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
  payload: makeMessagePayload({ turn_id: 't-held-goal', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
  requestId: 'held-goal-recorded', signal: new AbortController().signal, orientationText: '' } as never);
  return ((outcome as Json).handler_facts[0].result.enrichment.inference_warnings as Json[])
    .filter((w) => String(w.code).startsWith('GOAL_FIGURES')).map((w) => [w.code, w.message]);
}

describe('a held goal carries what the person said, so the one gap asks only for what is missing', () => {
  it('Track 3 funding: no £ target but a deadline in words → the gap asks for the target only', () => {
    const g = stored(funding());
    expect(goalOf(g).goal_deadline_as_stated).toBe('within the next 2 months');
    expect(goalTargetGapOf(g)).toEqual({ kind: 'goal_target_missing', goal_id: 'goal', deadline_known: true,
      question: 'One gap: ‘Secure funding within the next 2 months’ has no target yet. What would count as meeting it?' });
  });

  it('Track 3 hiring: the +10% is the person\'s target, so the gap asks for no target; target-testability asks for today\'s level', () => {
    const g = stored(hiring());
    expect(goalOf(g)).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_direction: '>=',
      goal_deadline_as_stated: 'in the next three months' });
    expect(goalTargetGapOf(g)).toBeNull();
    expect(targetTestabilityOf(g)).toEqual({ kind: 'not_testable', goal_id: 'goal', failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
    expect(resolveRunAdmission(g).willProceed).toBe(true);
  });

  it('hiring, on the real Run: the reason the person reads is that today\'s level is missing, never a missing target', async () => {
    const reasons = await hiringRunReasons();
    expect(reasons).toContainEqual(['GOAL_FIGURES_MISSING_CURRENT_LEVEL', 'Not shown. Increase productivity by at least 10%\'s current level is missing.']);
    expect(reasons.map(([, m]) => m).join(' ')).not.toMatch(/no target/);
  });

  it('hiring: no unit is claimed for today\'s level the person has not given (the "%" is the change\'s, not productivity\'s)', () => {
    expect(goalOf(stored(hiring()))).not.toHaveProperty('goal_threshold_unit');
  });

  it('a relative DECREASE is held as a fraction below today, with a ceiling', () => {
    expect(goalOf(stored(hiring('decrease')))).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.1, goal_direction: '<=' });
  });

  it('fail closed: the engine gets the held change but no normalised threshold or scale, so it scores no chance from it', async () => {
    const request = await requestTheRunSends(stored(hiring()));
    const goal = (request.graph.nodes as Json[]).find((n) => n.id === 'goal')!;
    expect(goal).not.toHaveProperty('goal_threshold');
    expect(goal).not.toHaveProperty('goal_threshold_cap');
    expect(request).not.toHaveProperty('goal_threshold');
  });

  it('NEGATIVE: a genuinely target-less aim with no deadline still asks for its target and its deadline', () => {
    const g = stored(funding(null));
    expect(goalOf(g)).not.toHaveProperty('goal_deadline_as_stated');
    expect(goalTargetGapOf(g)?.question).toBe('One gap: ‘Secure funding within the next 2 months’ has no target or deadline yet. What would count as meeting it, and by when?');
  });

  it('NEGATIVE: an aim with no target at all keeps exactly today\'s goal node (nothing written)', () => {
    expect(goalOf(stored(model('Grow the business', null)))).toEqual({ id: 'goal', kind: 'goal', label: 'Grow the business', source_quote: 'Grow the business' });
  });

  it('NEGATIVE: an absolute change with no level today is not this carrier (only a relative one is held as legacy holds it)', () => {
    const g = stored(model('Add 50 sessions', { ...target, quantity: 'Sessions', comparator: 'increase', value: 50, unit: 'sessions', change_kind: 'absolute', by_when: null }));
    expect(goalOf(g)).not.toHaveProperty('goal_threshold_raw');
    expect(goalOf(g)).not.toHaveProperty('goal_threshold_frame');
  });
});
