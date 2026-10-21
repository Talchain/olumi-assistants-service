/**
 * TRACK 2 (21 Oct 2026, DL request): a goal with NO level today has no starting point, so an option's outcome mean (and
 * its p10 / p90) is the options' effects summed from zero: a figure nobody stated. The Run producer must not let one
 * reach `analysis_result`, whatever withhold ran first.
 *
 * The case (a held goal, an earlier GOAL_FIGURES_* withhold, no option with a chance): "at least £12,000 a month", today
 * unknown. "Pricing page" moves the goal only through Olumi's unsized link, so the placeholder withhold covers it first.
 * "Referral scheme" moves it through the person's own £2k, so nothing earlier covers it.
 *
 * The PLoT responses are RECORDED from the real chain, offline (CEE mapper → this Run handler's request → PLoT POST
 * /v2/run → a local ISL; `scripts/track2/run-chain.sh`, provenance in each fixture), never written by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { mapLivingModel } from '../../../path-b/living-model/mapper.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { createRunAnalysisHandler } from '../run-analysis.js';

type Json = Record<string, any>;
const SCENARIO = 'f0f0f0f0-0000-4000-8000-000000000012';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const olumi = { source: 'olumi' as const, party: null, quote: null };
const on = (factor_id: string, quote: string) => ({ factor_id, value: 1, low: null, high: null, unit: null, ...who(quote) });

/** `today`: the goal's level today in £, or null when nobody said it (the mapper holds it, `goal_level_unknown`). */
export const pricingAndReferral = (today: number | null): LivingModelT => ({
  aims: [{ id: 'gp', text: 'Monthly gross profit of at least £12,000', status: 'current', defined_as: null,
    ...who(today === null ? 'we need at least £12k a month' : `we need at least £12k a month; today it is £${today / 1000}k`),
    target: { quantity: 'monthly gross profit', comparator: '>=', value: 12000, low: null, high: null, unit: '£', by_when: null,
      baseline: 'today', current: today, current_source: null, current_unit: null, change_kind: null } }],
  options: [
    { id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or we carry on as now') },
    { id: 'pricing', label: 'New pricing page', developed_from: null, settings: [on('pricing_page', 'launch the new pricing page')], ...who('launch the new pricing page') },
    { id: 'referral', label: 'Referral scheme', developed_from: null, settings: [on('referral_running', 'start a referral scheme')], ...who('start a referral scheme') },
  ],
  factors: [
    { id: 'pricing_page', label: 'New pricing page live', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('we have no pricing page') },
    { id: 'referral_running', label: 'Referral scheme running', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('we have no referral scheme') },
  ],
  links: [
    // Olumi's guess that a pricing page helps, with no size: the placeholder the earlier withhold reads.
    { id: 'pricing_gp', from: 'pricing_page', to: 'gp', ...olumi,
      effect: { form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '+' } },
    { id: 'referral_gp', from: 'referral_running', to: 'gp', ...who('the referral scheme would add about £2k a month'),
      effect: { form: 'point', value: 2000, sd: null, low: null, high: null, unit: '£', sign: '+' } },
  ],
  conditions: [], views: [], history: [],
});

const stored = (model: LivingModelT): Json => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Json;

async function runOn(model: LivingModelT, name: string, body?: Json, patch: (g: Json) => Json = (g) => g): Promise<{ fact: RunAnalysisHandlerFact; request: Json }> {
  const graph = patch(stored(model));
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: null })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `req-${name}-load`, store as never);
  let request: Json | undefined;
  const run = vi.fn(async (payload: Json) => { request = payload; return clone(body ?? {}) as unknown as V2RunResponseEnvelope; });
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
    ...(body === undefined ? { probe: async (p: { plotPayload: Json }) => { request = p.plotPayload; } } : {}),
  } as never);
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: `req-${name}`, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: `t-${name}`, scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: `req-${name}`, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(request, JSON.stringify(outcome).slice(0, 600)).toBeDefined();
  const out = process.env.F1_OUT;
  if (out !== undefined && body === undefined) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${name}.cee-to-plot.json`), JSON.stringify(request, null, 2));
  }
  return { fact: outcome.handler_facts[0] as RunAnalysisHandlerFact, request: request! };
}

/** Every option record in the block that carries an outcome: (block path, option id, outcome). */
function outcomesIn(block: unknown): Array<{ at: string; id: string; outcome: Json }> {
  const found: Array<{ at: string; id: string; outcome: Json }> = [];
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Json;
    const id = typeof r.option_id === 'string' ? r.option_id : typeof r.id === 'string' ? r.id : undefined;
    if (id !== undefined && r.outcome !== null && typeof r.outcome === 'object') found.push({ at, id, outcome: r.outcome });
    for (const [k, x] of Object.entries(r)) walk(x, `${at}.${k}`);
  };
  walk(block, 'analysis_result');
  return found;
}
const FIGURES = ['mean', 'p10', 'p50', 'p90', 'std'] as const;
const figuresOf = (o: Json): string[] => FIGURES.filter((k) => typeof o[k] === 'number');

const RECORDED = (name: string): Json => {
  const { _provenance: _, ...body } = JSON.parse(readFileSync(new URL(`./fixtures/track2-from-zero-${name}.plot-response.json`, import.meta.url), 'utf8')) as Json;
  return body;
};

describe('Track 2: an option outcome measured from zero never reaches analysis_result', () => {
  it.skipIf(process.env.F1_OUT === undefined)('RECORD: the Run requests the real chain answers (F1_OUT)', async () => {
    await runOn(pricingAndReferral(null), 'held');
    await runOn(pricingAndReferral(10000), 'today');
  });

  it('PRECONDITIONS: the recorded Run has no chance for any option, and the placeholder withhold covers pricing only', async () => {
    const body = RECORDED('held');
    expect((body.option_comparison as Json[]).every((o) => o.probability_of_goal === undefined)).toBe(true);
    expect((body.inference_warnings as Json[]).map((w) => w.code)).toContain('GOAL_THRESHOLD_NOT_CONVERTIBLE');
    const { fact, request } = await runOn(pricingAndReferral(null), 'held', body);
    expect((request.graph.nodes as Json[]).find((n) => n.id === 'gp')).not.toHaveProperty('observed_state');
    const placeholder = (fact.result as Json).enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
    expect(placeholder?.option_ids).toEqual(['pricing']);
  });

  it('a held goal (no level today): no option outcome mean, p10 or p90 survives in analysis_result', async () => {
    const { fact } = await runOn(pricingAndReferral(null), 'held', RECORDED('held'));
    const shown = outcomesIn(buildAnalysisResultBlock(fact)).filter((o) => figuresOf(o.outcome).length > 0);
    expect(shown.map((o) => `${o.id} ${figuresOf(o.outcome).join('/')} at ${o.at}`)).toEqual([]);
  });

  // AIE MA1: a goal measured over the window from launch has no level today BY DEFINITION, and its outcome is that window's
  // forecast, so it keeps it (the served marketing run-08 basis, on this graph). Same graph, same recorded Run: only the basis differs.
  it('CONTROL: a launch-window goal keeps its outcome (no level today is its definition, not a gap)', async () => {
    const launch = (g: Json): Json => ({ ...g, nodes: (g.nodes as Json[]).map((n) => n.id !== 'gp' ? n : { ...n, goal_target_basis: {
      source: 'olumi_reading', reference: 'launch', target_raw: 12000, effect_unit: '£ a month over the first three months after launch',
      period_kind: 'over_period', target_frame: 'level', period_months: 3, quantity_frame: 'level', effects_at_period_end: true } }) });
    const { fact } = await runOn(pricingAndReferral(null), 'held', RECORDED('held'), launch);
    const byId = new Map(outcomesIn(buildAnalysisResultBlock(fact)).map((o) => [o.id, figuresOf(o.outcome)]));
    expect(byId.get('referral')).toEqual(['mean', 'p10', 'p50', 'p90', 'std']);
    expect(byId.get('pricing')).toEqual([]);
  });

  // With today's level the placeholder withhold still takes pricing, and staging's own target rule scopes carry_on; the
  // option nothing withheld keeps its outcome in the goal's own terms.
  it('CONTROL: a goal WITH today\'s level keeps the outcome of the option nothing withheld (referral)', async () => {
    const { fact } = await runOn(pricingAndReferral(10000), 'today', RECORDED('today'));
    const byId = new Map(outcomesIn(buildAnalysisResultBlock(fact)).map((o) => [o.id, figuresOf(o.outcome)]));
    expect(byId.get('referral')).toEqual(['mean', 'p10', 'p50', 'p90', 'std']);
    expect(byId.get('pricing')).toEqual([]);
  });
});
