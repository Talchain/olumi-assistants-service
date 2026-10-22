/**
 * DL 23 Oct (candidate 5, Q2 coaching zeros 3/8): a sized link INTO a goal whose target states no figure yet was said to
 * the person as "whose strength isn't sized in the model yet", while the living model held Olumi's estimate for it. The
 * cause is the goal's frame: with no target figure the goal has no scale, so the link cannot be converted. The mapper
 * now holds it with its own reason (`link_goal_target_unknown`), the engine graph is unchanged (words only, no new
 * science), and the Run's withhold says the true reason: the figure is kept and used once the target sets the scale.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../../tools/registry.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { goalTargetUnknownLinks, mapLivingModel } from '../mapper.js';

type Json = Record<string, any>;
const SCENARIO = 'f0f0f0f0-0000-4000-8000-000000000023';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const on = (factor_id: string, quote: string) => ({ factor_id, estimate_by: null, value: 1, low: null, high: null, unit: null, ...who(quote) });
/** The recorded Run's own graph (`track2-from-zero-means`, held goal), so the recorded answer belongs to these options. */
const pricingAndReferral = (): LivingModelT => ({
  aims: [{ id: 'gp', text: 'Monthly gross profit of at least £12,000', status: 'current', defined_as: null, ...who('we need at least £12k a month'),
    target: { quantity: 'monthly gross profit', comparator: '>=', value: 12000, low: null, high: null, unit: '£', by_when: null, period_months: null,
      baseline: 'today', current: null, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [
    { status: 'feasible', id: 'carry_on', label: 'Carry on as now', developed_from: null, settings: [], ...who('or we carry on as now') },
    { status: 'feasible', id: 'pricing', label: 'New pricing page', developed_from: null, settings: [on('pricing_page', 'launch the new pricing page')], ...who('launch the new pricing page') },
    { status: 'feasible', id: 'referral', label: 'Referral scheme', developed_from: null, settings: [on('referral_running', 'start a referral scheme')], ...who('start a referral scheme') },
  ],
  factors: [
    { estimate_by: null, kind: 'factor', limit: null, id: 'pricing_page', label: 'New pricing page live', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('we have no pricing page') },
    { estimate_by: null, kind: 'factor', limit: null, id: 'referral_running', label: 'Referral scheme running', value: 0, low: null, high: null, unit: null, defined_as: null, ...who('we have no referral scheme') },
  ],
  links: [
    { id: 'pricing_gp', from: 'pricing_page', to: 'gp', source: 'olumi', party: null, quote: null,
      effect: { estimate_by: null, form: 'direction_only', value: null, sd: null, low: null, high: null, unit: null, sign: '+' } },
    { id: 'referral_gp', from: 'referral_running', to: 'gp', ...who('the referral scheme would add about £2k a month'),
      effect: { estimate_by: null, form: 'point', value: 2000, sd: null, low: null, high: null, unit: '£', sign: '+' } },
  ],
  risks: [], conditions: [], views: [], history: [],
});

/** Olumi's suggested measure with no figure (the Q2 shape), and Olumi's centred estimate on the referral link. */
const awaitingTarget = (opts: { targetValue?: number | null; bareRange?: true; olumiTarget?: true; statedLink?: true } = {}): LivingModelT => {
  const m = pricingAndReferral();
  return {
    ...m,
    aims: m.aims.map((a) => ({ ...a, target: { ...a.target!, value: opts.olumiTarget ? 12000 : opts.targetValue ?? null, source: opts.targetValue == null ? 'olumi' as const : null } })),
    links: m.links.map((l) => (l.id !== 'referral_gp' || opts.statedLink ? l : { ...l, source: 'olumi' as const, party: null, quote: null,
      effect: { estimate_by: null, form: 'range' as const, value: opts.bareRange ? null : 2000, sd: null, low: 500, high: 4000, unit: '£', sign: '+' as const } })),
  };
};
const stored = (model: LivingModelT): Json =>
  projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Json;
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);
const edge = (m: LivingModelT, from: string): Json => (mapLivingModel(m).graph.edges as Json[]).find((e) => e.from === from && e.to === 'gp')!;

/** The real Run handler on the stored graph, answered by a Run recorded from the real chain (`track2-from-zero-means`). */
async function placeholderWarning(model: LivingModelT): Promise<Json | undefined> {
  const graph = stored(model);
  const { _provenance: _, ...body } = JSON.parse(readFileSync(new URL('../../../tools/handlers/__tests__/fixtures/track2-from-zero-held.plot-response.json', import.meta.url), 'utf8')) as Json;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-tu-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: null })),
    loadGraph: vi.fn(async () => clone(graph)) } as never);
  const handler = createRunAnalysisHandler({
    plotClient: { run: vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope), validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot) } as never);
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'req-tu', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-tu', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-tu', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  return ((outcome.handler_facts[0] as Json).result.enrichment.inference_warnings as Json[]).find((w) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
}

describe('a sized link into a goal with no target figure is held for that reason, and said so', () => {
  it('the mapper holds it as link_goal_target_unknown; the engine graph is unchanged (still Olumi\'s placeholder)', () => {
    const m = awaitingTarget();
    expect(reasons(m)).toContain('referral_gp:link_goal_target_unknown');
    expect(reasons(m)).not.toContain('referral_gp:link_frame_unknown');
    expect(edge(m, 'referral_running')).toMatchObject({ defaulted: true, strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    expect(goalTargetUnknownLinks(stored(m))).toEqual([{ from: 'referral_running', to: 'gp', by: 'olumi' }]);
  });

  it('the Run\'s withhold says the true reason for that link, and never "not sized"; it is not offered to be sized', async () => {
    const w = await placeholderWarning(awaitingTarget());
    expect(w?.option_ids).toEqual(expect.arrayContaining(['referral']));
    expect(w!.message).toContain('Olumi’s estimate for the link from ‘Referral scheme running’ to ‘Monthly gross profit of at least £12,000’ is kept, and used once ‘Monthly gross profit of at least £12,000’ has a target figure, which sets its scale.');
    expect(w!.message).not.toMatch(/Referral scheme running’ to ‘[^’]+’[^.]*sized/);
    expect((w!.acceptable_links ?? []).filter((l: Json) => l.from === 'referral_running')).toEqual([]);
  });

  it('NEGATIVE: a genuinely unsized link (no figure at all) beside it still reads unsized, byte for byte', async () => {
    const m = awaitingTarget();
    expect(reasons(m).filter((r) => r.startsWith('pricing_gp:'))).toEqual([]);
    expect(goalTargetUnknownLinks(stored(m)).map((l) => l.from)).not.toContain('pricing_page');
    const w = await placeholderWarning(m);
    expect(w!.message.startsWith('This comparison turns on the link from ‘New pricing page live’ to ‘Monthly gross profit of at least £12,000’, whose strength isn\'t sized in the model yet.')).toBe(true);
  });

  it('NEGATIVE: a bare range with no figure of its own is unsized, not awaiting the target (link_range_no_law)', () => {
    const m = awaitingTarget({ bareRange: true });
    expect(reasons(m)).toContain('referral_gp:link_range_no_law');
    expect(reasons(m)).not.toContain('referral_gp:link_goal_target_unknown');
    expect(goalTargetUnknownLinks(stored(m))).toEqual([]);
  });

  it('whose figure it is: the person\'s own stated figure is never called Olumi\'s estimate', async () => {
    const m = awaitingTarget({ statedLink: true });
    expect(reasons(m)).toContain('referral_gp:link_goal_target_unknown');
    expect(goalTargetUnknownLinks(stored(m))).toEqual([{ from: 'referral_running', to: 'gp', by: 'stated' }]);
    const w = await placeholderWarning(m);
    expect(w!.message).toContain('The stated figure for the link from \u2018Referral scheme running\u2019 to \u2018Monthly gross profit of at least £12,000\u2019 is kept');
    expect(w!.message).not.toContain('Olumi\u2019s estimate');
  });

  it('SCOPE: a goal with a figure that is not the person\'s (target_not_theirs) keeps link_frame_unknown: only a figure-less target is this reason', () => {
    const m = awaitingTarget({ olumiTarget: true });
    expect(reasons(m)).toContain('gp:target_not_theirs');
    expect(reasons(m)).toContain('referral_gp:link_frame_unknown');
    expect(goalTargetUnknownLinks(stored(m))).toEqual([]);
  });

  it('with a target figure, the same link is sized from Olumi\'s estimate (regenerated), and nothing is held', () => {
    const m = awaitingTarget({ targetValue: 12000 });
    expect(reasons(m).filter((r) => r.startsWith('referral_gp:'))).toEqual([]);
    const e = edge(m, 'referral_running');
    expect(e.defaulted).toBeUndefined();
    expect(e.provenance).toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 2000, amount_unit: '£' } });
    expect(goalTargetUnknownLinks(stored(m))).toEqual([]);
  });
});
