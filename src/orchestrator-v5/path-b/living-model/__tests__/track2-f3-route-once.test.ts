/**
 * TRACK 2 F3 (21 Oct 2026): rule R (route-once, #2755) on the core path, against the Science ruling (DL relay ~00:4xZ):
 * route-once is NOT a valid belief rule for two distinct mechanisms in series (their doubts multiply: 0.8 × 0.8 = 0.64). It
 * is acceptable only as a convention for Olumi's own unvalidated default, and only when
 *  (a) the held downstream link stays named as an open doubt;
 *  (b) it reverts to per-link counting once anyone states or validates a belief about it;
 *  (c) the chance stays labelled provisional.
 * Offline, no sampler change: the living model through the mapper, the stored projection and the real Run handler, up to
 * the request PLoT receives (where the hold is applied, `run-analysis.ts` → `withHeldUserLinks`).
 */
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { endsOfGraph, heldLinkOf } from '../../../goal-target/held-user-links.js';
import { goalChanceEstimateCounts } from '../../../agent-lane/goal-chance-estimate-attribution.js';
import { mapLivingModel } from '../mapper.js';
import { livingViewOf } from '../view.js';

type Rec = Record<string, any>;
const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const olumi = { source: 'olumi' as const, party: null, quote: null };
const user = (quote: string) => ({ source: 'user' as const, party: null, quote });
const point = (value: number, unit: string | null) => ({ form: 'point' as const, value, sd: null, low: null, high: null, unit, sign: '+' as const });

/** Two DISTINCT Olumi mechanisms in series: pushing a moves b (Olumi's guess), and b moves the goal (another guess). */
const SERIAL: LivingModelT = {
  aims: [{ id: 'g', text: 'Reach 100 units', status: 'current', defined_as: null, ...user('we need at least 100 units; today we are at 70'),
    target: { quantity: 'units', comparator: '>=', value: 100, low: null, high: null, unit: 'units', by_when: null, baseline: 'today',
      current: 70, current_source: null, current_unit: null, change_kind: null } }],
  options: [
    { id: 'hold', label: 'Hold', settings: [], ...user('or we hold') },
    { id: 'push', label: 'Push', ...user('push a to 1'), settings: [{ factor_id: 'a', value: 1, low: null, high: null, unit: null, ...user('push a to 1') }] },
  ],
  factors: [
    { id: 'a', label: 'a', value: 0.5, low: null, high: null, unit: null, defined_as: null, ...user('a is at 0.5') },
    { id: 'b', label: 'b', value: 0.5, low: null, high: null, unit: null, defined_as: null, ...user('b is at 0.5') },
  ],
  links: [
    { id: 'a_b', from: 'a', to: 'b', ...olumi, effect: point(0.5, null) },
    { id: 'b_g', from: 'b', to: 'g', ...olumi, effect: point(40, 'units') },
  ],
  conditions: [], views: [], history: [],
};
const withLink = (id: string, patch: Rec): LivingModelT => ({ ...SERIAL, links: SERIAL.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

/** The whole request the real Run handler sends PLoT. */
async function requestTheRunSends(model: LivingModelT): Promise<Rec> {
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'f3', {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 'f3', kind: 'message', message: 'Run analysis.' },
    requestId: 'f3', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  return request!;
}

/** The existence each causal link is SENT with (the real Run handler, up to the PLoT request). */
async function sentExistence(model: LivingModelT): Promise<Record<string, number>> {
  const request = await requestTheRunSends(model);
  // Engine edges carry no id; a causal link is named by its ends.
  const sent = (from: string, to: string) => (request.graph.edges as Rec[]).find((e) => e.from === from && e.to === to)?.exists_probability;
  return { a_b: sent('a', 'b'), b_g: sent('b', 'g') };
}
const holdOf = (model: LivingModelT, from: string, to: string) => {
  const g = stored(model);
  const edge = (g.edges as Rec[]).find((e) => e.from === from && e.to === to);
  expect(edge, `${from}→${to} is in the stored graph`).toBeDefined();
  return heldLinkOf(edge, endsOfGraph(g)(edge))?.reason ?? null;
};

describe('Track 2 F3: route-once on core, against the Science ruling on distinct serial mechanisms', () => {
  it('PRECONDITION (the convention as built): two Olumi links in series are sent 0.8 and 1, so the route carries 0.8, not 0.64', async () => {
    expect(holdOf(SERIAL, 'b', 'g')).toBe('route_once');
    expect(await sentExistence(SERIAL)).toEqual({ a_b: 0.8, b_g: 1 });
  });

  // ⛔ RED ROW for the DL (21 Oct): nothing on the core path names a route-once-held link today (the view says
  // {"assumed":[],"withheld":[]}). `it.fails` banks the gap without breaking a gate; flip it to `it` with the fix.
  it.fails('(a) RED: the held downstream link stays NAMED as an open doubt where the AI reads the model (core view)', () => {
    const view = livingViewOf(stored(SERIAL)) as Rec;
    const named = [...(view.assumed ?? []), ...(view.withheld ?? [])].some((x: Rec) => x.id === 'b_g');
    expect(named, `core view names b_g as Olumi's uncounted doubt; it says: ${JSON.stringify({ assumed: view.assumed, withheld: view.withheld })}`).toBe(true);
  });

  it('(b) a link the person STATES is counted per link: their b → goal is theirs (1) and Olumi\'s a → b keeps its own doubt', async () => {
    const stated = withLink('b_g', user('b drives the goal'));
    expect(holdOf(stated, 'b', 'g')).toBeNull();
    expect(await sentExistence(stated)).toEqual({ a_b: 0.8, b_g: 1 });
  });

  it('(b) a link the person VALIDATES on the canvas (theirs, no quote) is counted per link too, never by route-once', async () => {
    const validated = withLink('b_g', { source: 'user', quote: null });
    expect(holdOf(validated, 'b', 'g')).toBeNull();
    expect(await sentExistence(validated)).toEqual({ a_b: 0.8, b_g: 1 });
  });

  it('(b) once the person states the UPSTREAM link, Olumi\'s downstream link is the route\'s first doubt and keeps its own 0.8', async () => {
    const upstream = withLink('a_b', user('pushing a moves b'));
    expect(holdOf(upstream, 'b', 'g')).toBeNull();
    expect(await sentExistence(upstream)).toEqual({ a_b: 1, b_g: 0.8 });
  });

  /** The person questions the held link: a challenge (AIE role), with their own words. */
  const challenged = (model: LivingModelT): LivingModelT => ({ ...model, conditions: [{ text: 'I am not sure b really moves the goal',
    applies_to: ['b_g'], role: 'challenge', ...user('I am not sure b really moves the goal') }] });

  it('Science ruling (b): a CHALLENGE alone is a question, not a belief: the Run is byte-identical, the hold stays', async () => {
    expect(holdOf(challenged(SERIAL), 'b', 'g')).toBe('route_once');
    expect(await requestTheRunSends(challenged(SERIAL))).toEqual(await requestTheRunSends(SERIAL));
  });

  it('Science ruling (b): a challenge plus a belief stated in reply (a strength figure) reverts it to per-link counting', async () => {
    const answered = challenged(withLink('b_g', user('yes: each point of b adds about 40 units')));
    expect(holdOf(answered, 'b', 'g')).toBeNull();
    expect(await sentExistence(answered)).toEqual({ a_b: 0.8, b_g: 1 });
  });

  it('(c) the chance stays provisional: the held link is still counted as Olumi\'s input on the goal\'s path', () => {
    const counts = goalChanceEstimateCounts(stored(SERIAL), ['hold', 'push'], 'g') as Rec;
    expect(counts.links, JSON.stringify(counts)).toBe(2);
  });
});
