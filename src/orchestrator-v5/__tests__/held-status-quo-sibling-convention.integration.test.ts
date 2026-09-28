/**
 * ⛔ A HELD STATUS QUO GOES TO PLoT IN ITS SIBLINGS' CONVENTION (DL #72 5865140074; MG root cause 5865254606).
 *
 * Served journey A, Runtime's #2212 gate run 3 (CEE a4f4d2b · PLoT c0f0a9a · ISL 9b8aa34): the status quo "Keep Current
 * Pricing" (no levels of its own) came back p10 0 · p50 0 · mean −41,379 while today's MRR is £75,000 — and the brief's
 * first pass and Run 1 both carried it.
 *
 * MEASURED on the real path (`loadScenarioSnapshotForRunAnalysis` → `createRunAnalysisHandler` → the `/v2/run` body):
 * the hold sent `pro_feature_value: 0.6` (normalised) beside its siblings' `75` (raw). One factor, two conventions; PLoT
 * saw values above 1 and normalised the whole request, so the status quo's 0.6 became 0.006 on the 0–100 frame and the
 * subscriber count went negative (0.8 × −£70.5k + 0.2 × £75k ≈ −£41.4k, served −41,379). With the status quo at the raw
 * 60, PLoT c0f0a9a → ISL 9b8aa34's REAL analyser returns it at 0.6 = £75,000 exactly.
 *
 * CAUSE: `buildHoldFactorValues` kept `raw_value` only on a factor with a usable CAP. Olumi's estimated factors carry
 * their frame as the pair itself (`{value: 0.6, raw_value: 60}`, `scale_frame` 100, no cap) — the CAPLESS FRAMED PAIR the
 * projection already recognises through its one owner, `recoverScaleFrame`, and emits demotably. The hold now asks the
 * same owner, so the projection sees the pair it was built to handle. A pair the owner refuses is still held at `value`.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { createRunAnalysisHandler, type ScenarioReader } from '../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../tools/registry.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import { makeMessagePayload } from './fixtures.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-held-status-quo-scale-frame-065352Z.json', import.meta.url), 'utf8'),
) as { run3: Json; run2: Json };
const SCENARIO_ID = 'c07018d1-7a34-4680-824d-4b92b940c899';

/** The `/v2/run` body `run_analysis` builds for a persisted graph — the real loader and handler, PLoT captured. */
async function wireOf(graph: Json): Promise<Record<string, Record<string, number>>> {
  let captured: Json | undefined;
  const plotClient = {
    run: vi.fn((payload: Json) => { captured = payload; return Promise.reject(new Error('captured')); }),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
  const store = createNoopSessionStore({ loadGraphResult: structuredClone(graph) });
  const scenarioReader: ScenarioReader = (id) => loadScenarioSnapshotForRunAnalysis(id, 'req-held-convention', store);
  const invocation = {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: 'req-held-convention',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-held-convention', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  try { await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation); } catch { /* the capture stops the run */ }
  expect(captured, 'run_analysis reached PLoT').toBeDefined();
  return Object.fromEntries((captured!.options as Json[]).map((o) => [o.id ?? o.option_id, o.interventions]));
}

/** Every factor's values across the options are in ONE convention: all levels (> 1) or all unit-interval (≤ 1). */
function conventionsPerFactor(wire: Record<string, Record<string, number>>): Record<string, string> {
  const byFactor: Record<string, Set<string>> = {};
  for (const iv of Object.values(wire)) {
    for (const [f, v] of Object.entries(iv)) (byFactor[f] ??= new Set()).add(v > 1 ? 'level' : 'unit');
  }
  return Object.fromEntries(Object.entries(byFactor).map(([f, s]) => [f, [...s].sort().join('+')]));
}

describe('RED — served run 3: the held status quo goes to PLoT in its siblings\' convention', () => {
  it('"Keep Current Pricing" is held at today\'s levels, £49 and 60 — beside its siblings\' 59/54 and 75', async () => {
    const wire = await wireOf(SERVED.run3);
    expect(wire).toEqual({
      keep_current_pricing: { pro_plan_price: 49, pro_feature_value: 60 },
      '59_with_feature_release': { pro_plan_price: 59, pro_feature_value: 75 },
      '54_with_feature_release': { pro_plan_price: 54, pro_feature_value: 75 },
    });
  });

  it('INVARIANT (the spec, not the symptom): no factor reaches PLoT in two conventions', async () => {
    const conventions = conventionsPerFactor(await wireOf(SERVED.run3));
    for (const [factor, c] of Object.entries(conventions)) expect(c, factor).not.toBe('level+unit');
  });
});

describe('unchanged — a pair the frame owner refuses is still held at its value; run 2 is byte-identical', () => {
  it('CONTROL: served run 2 (every factor unit-interval) goes to PLoT exactly as before', async () => {
    const wire = await wireOf(SERVED.run2);
    expect(wire).toEqual({
      increase_pro_to_59: { pro_plan_price: 0.295, pro_feature_release_availability: 1 },
      keep_49_with_release: { pro_plan_price: 0.245, pro_feature_release_availability: 1 },
      raise_pro_to_54: { pro_plan_price: 0.27, pro_feature_release_availability: 1 },
      carry_on_as_now: { pro_plan_price: 0.245, pro_feature_release_availability: 1 },
    });
  });

  it('CONTRAST: with no raw figure beside today\'s level there is no frame to prove, so the hold keeps the value (never invents)', async () => {
    const graph = structuredClone(SERVED.run3);
    const node = (graph.nodes as Json[]).find((n) => n.id === 'pro_feature_value')!;
    delete node.observed_state.raw_value;
    const wire = await wireOf(graph);
    expect(wire.keep_current_pricing).toEqual({ pro_plan_price: 49, pro_feature_value: 0.6 });
  });

  it('CONTRAST: a level ABOVE its frame (1.2 beside 120) is no unit-interval form, so the hold keeps the value', async () => {
    const graph = structuredClone(SERVED.run3);
    const node = (graph.nodes as Json[]).find((n) => n.id === 'pro_feature_value')!;
    node.observed_state = { ...node.observed_state, value: 1.2, raw_value: 120 };
    const wire = await wireOf(graph);
    expect(wire.keep_current_pricing).toEqual({ pro_plan_price: 49, pro_feature_value: 1.2 });
  });
});
