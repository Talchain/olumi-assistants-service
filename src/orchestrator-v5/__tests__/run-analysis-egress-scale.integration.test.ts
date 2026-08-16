/**
 * CEE → PLoT intervention value-scale protection (Tier 0, Phase 1) — egress
 * integration, exercising the LIVE run_analysis projection boundary
 * (`loadScenarioSnapshotForRunAnalysis` → run_analysis handler → PLoT payload).
 *
 * UNCONDITIONAL since 2026-07-20 (O-7 wave 2:
 * CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted, live-true on staging): the
 * evidence-gated shim canonicalises capped numeric interventions to RAW
 * user-scale (raw_value style AND brief-extraction style via proven
 * `observed_state` normalisation), while NEVER silently rewriting a `[0,1]`
 * value on a capped factor lacking evidence. The former flag-OFF legacy
 * projection no longer exists; these pins are the make-unconditional
 * mutation checks.
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
import { describe, it, expect, vi, afterEach } from 'vitest';

import { loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { _resetConfigCache } from '../../config/index.js';
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
afterEach(() => {
  _resetConfigCache();
});

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
          // Round 4: carries its consistent pair (0.45 * 20000 = 9000) so the
          // request is demotable; the pair-less bare-9000 variant (undemotable
          // → typed block) is pinned in run-analysis-final-payload-scale.test.ts.
          fac_already_raw: { value: 0.45, raw_value: 9000, unit: '£', source: 'user_specified', target_match: tm('fac_already_raw') },
          // uncapped factor → passthrough 0.3.
          fac_rate: { value: 0.3, source: 'user_specified', target_match: tm('fac_rate') },
          // Explicit Raw+Encoded categorical proof → passthrough 1, never
          // scaled. Canonical readiness verifies UK→1 exactly; absent or
          // mismatched proof remains needs_encoding in the transformer controls.
          fac_region: { value: 1, value_type: 'categorical', raw_value: 'UK', encoding_map: { UK: 1 }, source: 'user_specified', target_match: tm('fac_region') },
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

describe('run_analysis egress value-scale — loadScenarioSnapshotForRunAnalysis (unconditional)', () => {

  it('the loader preserves the ORIGINAL intervention objects — no projection before the scaffold (round 4)', async () => {
    // ROUND 4: the loader no longer projects to wire numbers — the one
    // request-level projection runs in run_analysis AFTER the scaffold (the
    // round-3 TOCTOU fix). The loader's job is faithful merge: raw_value /
    // value / unit fields survive untouched for the downstream projection.
    const store = createNoopSessionStore({ loadGraphResult: buildGraph() });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, REQUEST_ID, store);

    expect(snapshot.goal_node_id).toBe('goal_g');
    const byId = Object.fromEntries(snapshot.options.map((o) => [o.option_id, o.interventions]));
    const optEdit = byId.opt_edit as Record<string, Record<string, unknown>>;
    expect(optEdit.fac_spend).toMatchObject({ value: 0.25, raw_value: 5000 });
    expect(optEdit.fac_ambiguous).toMatchObject({ value: 0.4 });
    const optDraft = byId.opt_draft as Record<string, Record<string, unknown>>;
    expect(optDraft.fac_spend).toMatchObject({ value: 0.25 });
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

// (former "flag OFF is a byte-identical legacy no-op" describe removed
// 2026-07-20 — O-7 wave 2: CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted,
// live-true on staging; the legacy normalised projection no longer exists.
// The flag-ON pins above are the make-unconditional mutation checks.)

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

describe('run_analysis egress value-scale — PLoT payload (end-to-end, route-level)', () => {
  function makeCapturingHandler() {
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

    return { handler, plotClient, invocation, getPayload: () => capturedPayload };
  }

  it('sends the /v2/run payload in ONE COHERENT SCALE — unit here, because stranded siblings force a demote (round 4)', async () => {
    // ROUND 4 REFINEMENT of "sends RAW user-scale values unconditionally".
    // This fixture mixes raw-scale emissions (5000 / 50000 / 9000) with values
    // PLoT's fired gate would CORRUPT: an unproven 0.4 on a 50000-cap factor
    // (annihilated to 0.000008) and an encoded region code 1 (renormalised —
    // Finding B). Round 3 shipped that wire as-is. The coherent form of THIS
    // request is unit scale: every raw value with a known unit form demotes,
    // and the stranded values ship verbatim with the gate skipped. The
    // magnitudes are unchanged — 5000 on a 20000-cap factor IS 0.25 — and
    // PLoT was proven (live, b9f6b5a) to compute identical results for the
    // two coherent forms. `fac_already_raw` carries a consistent 0.45 pair in
    // this round's fixture so the request is demotable at all; the UNDEMOTABLE
    // variant of this shape must BLOCK instead, and is pinned in
    // run-analysis-final-payload-scale.test.ts.
    const { handler, plotClient, invocation, getPayload } = makeCapturingHandler();
    await handler(invocation);

    expect(plotClient.run).toHaveBeenCalledTimes(1);
    const payload = getPayload();
    expect(payload).toBeDefined();
    const options = payload!.options as Array<{ option_id: string; interventions: Record<string, number> }>;
    const optEdit = options.find((o) => o.option_id === 'opt_edit')!;
    expect(optEdit.interventions).toEqual({
      fac_spend: 0.25, // raw 5000 demoted to its consistent unit form (0.25 * 20000 = 5000)
      fac_budget: 0.5, // cap-denormalised 50000 demoted back to its pre-image
      fac_already_raw: 0.45, // consistent pair 0.45 / 9000 demoted (0.45 * 20000 = 9000)
      fac_rate: 0.3, // uncapped — verbatim
      fac_region: 1, // categorical code — verbatim (Finding B)
      fac_ambiguous: 0.4, // unproven [0,1] — verbatim, NOT annihilated
    });
    const optDraft = options.find((o) => o.option_id === 'opt_draft')!;
    expect(optDraft.interventions).toEqual({ fac_spend: 0.25 });

    // The coherence postcondition, on the final bytes.
    for (const o of options) {
      for (const [factorId, v] of Object.entries(o.interventions)) {
        expect(v >= 0 && v <= 1, `${o.option_id}/${factorId} within [0,1]; got ${v}`).toBe(true);
      }
    }
  });

});
