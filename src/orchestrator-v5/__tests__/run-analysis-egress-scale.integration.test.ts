/**
 * CEE → PLoT intervention value-scale protection (Phase 1) — egress integration.
 *
 * End-to-end proof that the evidence-gated value-scale shim runs at the
 * run_analysis projection boundary and that the PLoT payload receives RAW
 * user-scale values for capped numeric factors — for interventions carrying a
 * `raw_value` (edit_graph style) AND interventions relying on the target
 * factor's proven `observed_state` normalisation (brief-extraction style) —
 * while NEVER silently rewriting a `[0,1]` value on a capped factor that lacks
 * normalisation evidence.
 *
 * Production note on graph shape: `loadScenarioSnapshotForRunAnalysis` runs the
 * persisted graph through `GraphV3.safeParse`, which keeps the DECLARED
 * top-level `node.interventions` (as `z.any()` objects, so `raw_value`/`unit`
 * survive) and factor `observed_state`, while STRIPPING undeclared shapes
 * (`node.data`, top-level `options[]`) — see the dedicated parse-shape test
 * below. These fixtures therefore carry option interventions at the surviving
 * `node.interventions` location, matching what the readiness reader sees.
 *
 * Uses only injected mocks (noop session store, capturing PLoT client). No
 * live runs, no real Supabase, no graph mutation.
 */
import { describe, it, expect, vi } from 'vitest';

import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import {
  createRunAnalysisHandler,
  type ScenarioReader,
} from '../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../tools/registry.js';
import type { PLoTClient, PLoTClientRunOpts } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'req-egress-scale-1';

// Minimal valid PLoT /v2/run response (inlined to avoid a JSON import
// attribute) — enough for the handler to build a valid fact and return.
const PLOT_RESPONSE = {
  meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:egress-scale-test' },
  results: [{ option_id: 'opt_edit', option_label: 'Aggressive', win_probability: 1.0 }],
  response_hash: 'sha256:egress-scale-test-top',
  analysis_status: 'completed',
} as unknown as V2RunResponseEnvelope;

const edge = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 1,
  effect_direction: 'positive' as const,
});

const tm = (id: string) => ({ node_id: id, match_type: 'exact_id', confidence: 'high' });

/**
 * Graph fixture in the persisted (parse-surviving) shape:
 *  - option interventions live at top-level `node.interventions` (full objects);
 *  - capped factors carry `observed_state.{value,raw_value,cap}` so the
 *    normalised-convention evidence (value ≈ raw/cap) is provable;
 *  - `fac_ambiguous` is capped but carries NO `observed_state.raw_value`, so it
 *    has no evidence — its [0,1] intervention must NOT be multiplied.
 */
function buildGraph() {
  return {
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Hit ARR target' },
      { id: 'dec_1', kind: 'decision', label: 'Growth plan' },
      {
        id: 'opt_edit',
        kind: 'option',
        label: 'Aggressive',
        interventions: {
          // raw_value present → use it (rule 1). 0.25*20000 == 5000 (consistent).
          fac_spend: { value: 0.25, raw_value: 5000, unit: '£', source: 'user_specified', target_match: tm('fac_spend') },
          // no raw_value, factor proves normalisation → 0.5 * 100000 = 50000.
          fac_budget: { value: 0.5, unit: '£', source: 'user_specified', target_match: tm('fac_budget') },
          // already-raw (> 1) on a capped factor → passthrough 9000.
          fac_already_raw: { value: 9000, unit: '£', source: 'user_specified', target_match: tm('fac_already_raw') },
          // uncapped factor → passthrough 0.3.
          fac_rate: { value: 0.3, source: 'user_specified', target_match: tm('fac_rate') },
          // categorical encoded value → passthrough 1, never scaled.
          fac_region: { value: 1, value_type: 'categorical', raw_value: 'UK', source: 'user_specified', target_match: tm('fac_region') },
          // [0,1] on a capped factor with NO evidence → passthrough 0.4 (NO corruption).
          fac_ambiguous: { value: 0.4, unit: '£', source: 'user_specified', target_match: tm('fac_ambiguous') },
        },
      },
      {
        id: 'opt_draft',
        kind: 'option',
        label: 'Baseline',
        // brief-extraction style: no raw_value on the intervention; denormalise
        // via the target factor's proven normalisation → 0.25 * 20000 = 5000.
        interventions: {
          fac_spend: { value: 0.25, unit: '£', source: 'brief_extraction', target_match: tm('fac_spend') },
        },
      },
      { id: 'fac_spend', kind: 'factor', label: 'Acquisition Spend', category: 'controllable', observed_state: { value: 0.25, raw_value: 5000, cap: 20000, unit: '£' } },
      { id: 'fac_budget', kind: 'factor', label: 'Marketing Budget', category: 'controllable', observed_state: { value: 0.5, raw_value: 50000, cap: 100000, unit: '£' } },
      { id: 'fac_already_raw', kind: 'factor', label: 'Headcount Cost', category: 'controllable', observed_state: { value: 0.45, raw_value: 9000, cap: 20000, unit: '£' } },
      { id: 'fac_rate', kind: 'factor', label: 'Churn Rate', category: 'observable', observed_state: { value: 0.3, unit: '%' } },
      { id: 'fac_region', kind: 'factor', label: 'Region', category: 'controllable', observed_state: { value: 0 } },
      { id: 'fac_ambiguous', kind: 'factor', label: 'Discount Fraction', category: 'controllable', observed_state: { value: 0.5, cap: 50000, unit: '£' } },
      { id: 'out_arr', kind: 'outcome', label: 'ARR' },
    ],
    edges: [
      edge('dec_1', 'opt_edit'),
      edge('dec_1', 'opt_draft'),
      edge('opt_edit', 'fac_spend'),
      edge('opt_edit', 'fac_budget'),
      edge('opt_edit', 'fac_already_raw'),
      edge('opt_edit', 'fac_rate'),
      edge('opt_edit', 'fac_region'),
      edge('opt_edit', 'fac_ambiguous'),
      edge('opt_draft', 'fac_spend'),
      edge('fac_spend', 'out_arr'),
      edge('fac_budget', 'out_arr'),
      edge('fac_already_raw', 'out_arr'),
      edge('fac_rate', 'out_arr'),
      edge('fac_region', 'out_arr'),
      edge('fac_ambiguous', 'out_arr'),
      edge('out_arr', 'goal_g'),
    ],
  };
}

describe('run_analysis egress value-scale — loadScenarioSnapshotForRunAnalysis', () => {
  it('denormalises capped interventions to raw user-scale; never multiplies an unproven [0,1]', async () => {
    const store = createNoopSessionStore({ loadGraphResult: buildGraph() });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, REQUEST_ID, store);

    expect(snapshot.goal_node_id).toBe('goal_g');

    const byId = Object.fromEntries(snapshot.options.map((o) => [o.option_id, o.interventions]));

    // edit_graph style (intervention carries raw_value, plus mixed branches).
    expect(byId.opt_edit).toEqual({
      fac_spend: 5000, // raw_value preferred (regression fixture: 0.25 → 5000)
      fac_budget: 50000, // 0.5 * 100000 cap_denormalised (factor evidence present)
      fac_already_raw: 9000, // already raw (> 1) passthrough — NOT 9000*20000
      fac_rate: 0.3, // uncapped passthrough
      fac_region: 1, // categorical preserved
      fac_ambiguous: 0.4, // capped but NO evidence → passthrough, NOT 0.4*50000
    });

    // brief-extraction style (no raw_value; denormalised via proven factor
    // normalisation) — the SAME boundary protection applies.
    expect(byId.opt_draft).toEqual({ fac_spend: 5000 }); // 0.25 * 20000
  });

  it('regression fixture: value 0.25 / raw_value 5000 / cap 20000 / unit £ → 5000, never 0.25', async () => {
    const store = createNoopSessionStore({ loadGraphResult: buildGraph() });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, REQUEST_ID, store);
    const optEdit = snapshot.options.find((o) => o.option_id === 'opt_edit')!;
    expect(optEdit.interventions.fac_spend).toBe(5000);
    expect(optEdit.interventions.fac_spend).not.toBe(0.25);
  });

  it('does not silently corrupt a [0,1] value on a capped factor lacking evidence', async () => {
    const store = createNoopSessionStore({ loadGraphResult: buildGraph() });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, REQUEST_ID, store);
    const optEdit = snapshot.options.find((o) => o.option_id === 'opt_edit')!;
    expect(optEdit.interventions.fac_ambiguous).toBe(0.4); // not 0.4 * 50000
  });

  it('does not mutate the persisted graph (read-only egress)', async () => {
    const graph = buildGraph();
    const optEditNode = graph.nodes.find((n) => n.id === 'opt_edit') as Record<string, any>;
    const facNode = graph.nodes.find((n) => n.id === 'fac_spend') as Record<string, any>;
    const before = JSON.stringify(graph);

    const store = createNoopSessionStore({ loadGraphResult: graph });
    await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, REQUEST_ID, store);

    // Persisted intervention + factor baseline are untouched (still normalised).
    expect(optEditNode.interventions.fac_spend.value).toBe(0.25);
    expect(facNode.observed_state.value).toBe(0.25);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('leaves the snapshot graph factor baselines unchanged (only interventions are projected)', async () => {
    const store = createNoopSessionStore({ loadGraphResult: buildGraph() });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, REQUEST_ID, store);
    const facSpend = (snapshot.graph.nodes as Array<Record<string, any>>).find((n) => n.id === 'fac_spend')!;
    // PLoT still owns factor-baseline normalisation; we do not touch observed_state.
    expect(facSpend.observed_state.value).toBe(0.25);
    expect(facSpend.observed_state.cap).toBe(20000);
  });
});

describe('GraphV3.safeParse shape — what the egress reader actually sees', () => {
  it('strips undeclared node.data but preserves top-level node.interventions (with nested raw_value)', () => {
    const graph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'G' },
        {
          id: 'opt_x',
          kind: 'option',
          label: 'X',
          // edit_graph writes here; this is STRIPPED by GraphV3 (undeclared).
          data: { interventions: { fac_a: { value: 0.25, raw_value: 5000 } } },
          // declared field; survives parse as z.any() objects (raw_value intact).
          interventions: { fac_b: { value: 0.5, raw_value: 9000, unit: '£' } },
        },
      ],
      edges: [],
    };
    const parsed = GraphV3.safeParse(graph);
    expect(parsed.success).toBe(true);
    const opt = (parsed.success ? parsed.data.nodes : []).find((n) => n.id === 'opt_x') as Record<string, any>;
    // node.data is stripped → edit-created data.interventions do NOT survive here.
    expect(opt.data).toBeUndefined();
    // top-level interventions survive verbatim, including nested raw_value.
    expect(opt.interventions).toEqual({ fac_b: { value: 0.5, raw_value: 9000, unit: '£' } });
  });
});

describe('run_analysis egress value-scale — PLoT payload (end-to-end)', () => {
  it('sends raw user-scale intervention values in the /v2/run payload', async () => {
    let capturedPayload: Record<string, unknown> | undefined;
    const plotClient = {
      run: vi.fn(
        (
          payload: Record<string, unknown>,
          _requestId: string,
          _opts?: PLoTClientRunOpts,
        ): Promise<V2RunResponseEnvelope> => {
          capturedPayload = payload;
          return Promise.resolve(
            JSON.parse(JSON.stringify(PLOT_RESPONSE)) as V2RunResponseEnvelope,
          );
        },
      ),
      validatePatch: vi.fn().mockResolvedValue({}),
    } as unknown as PLoTClient;

    const store = createNoopSessionStore({ loadGraphResult: buildGraph() });
    const scenarioReader: ScenarioReader = (scenarioId, _signal) =>
      loadScenarioSnapshotForRunAnalysis(scenarioId, REQUEST_ID, store);

    const handler = createRunAnalysisHandler({ plotClient, scenarioReader });

    const invocation: HandlerInvocation = {
      context: {
        stage: 'analyse',
        entity_registry: { option_ids: [], goal_id: null },
        capabilities: {},
        messages: [{ role: 'user', content: 'run analysis' }],
        session_id: SCENARIO_ID,
        request_id: REQUEST_ID,
        budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as unknown as HandlerInvocation['context'],
      payload: makeMessagePayload({
        turn_id: 't1',
        scenario_id: SCENARIO_ID,
        message: 'run analysis',
        turn_class: 'decide',
        stage: 'analyse',
      }),
      requestId: REQUEST_ID,
      signal: new AbortController().signal,
      orientationText: '',
    } as unknown as HandlerInvocation;

    await handler(invocation);

    expect(plotClient.run).toHaveBeenCalledTimes(1);
    expect(capturedPayload).toBeDefined();
    const options = capturedPayload!.options as Array<{ option_id: string; interventions: Record<string, number> }>;
    const optEdit = options.find((o) => o.option_id === 'opt_edit')!;
    expect(optEdit.interventions).toEqual({
      fac_spend: 5000,
      fac_budget: 50000,
      fac_already_raw: 9000,
      fac_rate: 0.3,
      fac_region: 1,
      fac_ambiguous: 0.4,
    });
    const optDraft = options.find((o) => o.option_id === 'opt_draft')!;
    expect(optDraft.interventions).toEqual({ fac_spend: 5000 });
  });
});
