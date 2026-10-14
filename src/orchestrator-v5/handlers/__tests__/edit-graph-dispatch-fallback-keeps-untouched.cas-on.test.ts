import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
/**
 * An edit on a structurally-invalid base never writes the elements it did not
 * touch — and, because the targeted element's own result is lossy there, it
 * writes nothing at all.
 *
 * ── The defect (writer audit 27 Sep, reproduced at CEE staging ec90bc88) ────
 * When the stored graph passes the permissive ingress schema but FAILS strict
 * GraphV3, `graphStateToGraphV3WithParseResult` hands `handleEditGraph` a
 * `buildStructuralFallback` graph: bare `{id, kind, label}` nodes and
 * `{strength:{mean:0,std:0}, exists_probability:1, effect_direction:'positive'}`
 * edges. The handler applies the edit to that, skips strict validation because
 * the base is invalid, and `mergeAppliedGraphForPersistence` REPLACED the
 * stored `nodes`/`edges` with the result. Measured at ec90bc88 on the fixture
 * below: one rename changed 10/10 nodes and 12/12 edges of the stored model
 * (`observed_state`, `interventions`, `goal_threshold*`, provenance, `category`,
 * `scale_frame`, every edge's strength/probability/direction/provenance), and
 * the second edit repeated it. Three doors, each rowed below:
 *   · GM mode `shadow` (the referee never blocks) — an ordinary rename;
 *   · GM mode `off` (no referee call) — an ordinary rename;
 *   · GM mode `live` (the repo default) — a batch that projects to ZERO referee
 *     envelopes governs `proceed`, so the wipe committed under the reply
 *     "No change: the model already matched that. Nothing was updated."
 *
 * ── Why the rule is WITHHOLD, not merge-onto-raw ───────────────────────────
 * The targeted element's result is computed against the fallback too. Measured
 * on this fixture: a value write the valid path refuses as scale-ambiguous
 * APPLIED on the fallback (the screen reads the `scale_frame`/`raw_value` the
 * fallback dropped) and landed with no `raw_value`; a strength write landed as
 * `{mean: 0, std: 0}`. Merging those onto the stored node/edge would write a
 * mismatched value pair or an inert strength. So nothing is written, and the
 * reply says so with a typed code.
 *
 * ── The fixture ────────────────────────────────────────────────────────────
 * A real served graph (DL acceptance capture pj-20260927T150204Z/A01,
 * `json.draft_graph`, scenario 541c737e) with ONE edge's `strength.std` set to
 * 0 — the exact mark `buildStructuralFallback` itself leaves — plus the
 * `goal_node_id` a persisted graph carries. 0 of 791 real captured graphs
 * (Paul's exports + DL captures) failed GraphV3 on 28 Sep; `std: 0` is the one
 * invalidity CEE is known to manufacture, so it is the cause this file models.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You edit causal decision graphs'),
  getSystemPromptMeta: vi.fn().mockReturnValue({ source: 'default', prompt_version: 'v2' }),
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You edit causal decision graphs',
    meta: { source: 'default', prompt_version: 'v2' },
  }),
}));

const { llmChatMock, gmModeRef, storedGraphRef } = vi.hoisted(() => ({
  llmChatMock: vi.fn(),
  gmModeRef: { current: null as null | 'off' | 'shadow' | 'live' },
  storedGraphRef: { current: null as unknown },
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({ name: 'test', model: 'test-model', chat: llmChatMock }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
}));

// Only `features.graphManagementMode` is steered (null = the real resolved
// config); everything else is the real config object.
vi.mock('../../../config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ft, fp) {
              if (fp === 'graphManagementMode' && gmModeRef.current !== null) return gmModeRef.current;
              return Reflect.get(ft, fp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

// The strict persisted read returns the STORED graph (the server-side merge
// base); everything else in build-turn-context stays real.
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  // B-FIX1: the combined read follows the existing graph double.
  loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
  loadPersistedGraphStrict: vi.fn(async () => storedGraphRef.current),
  loadRecentConversationTurns: vi.fn(async () => []),
  loadMostRecentPendingActions: vi.fn(async () => []),
}));

import { ModelReadFailedError } from '../../graph-revision-conflict.js';
import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../commit.js';
import { type GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = '541c737e-225b-43ad-8d0e-82be55fa0c5f';
const STUB_REQUEST = {} as FastifyRequest;

type Json = Record<string, unknown>;
type FixtureEdge = Json & { strength: { std: number; mean: number } };

/** Real served graph; the ONE change is `decision_mrr->keep_current_pricing` std 0.01 → 0. */
function storedInvalidGraph(): Json {
  return {
    nodes: [
      { id: 'decision_mrr', kind: 'decision', label: 'Decision: MRR', provenance: 'ai_inferred' },
      {
        id: 'mrr', kind: 'goal', label: 'MRR', provenance: 'from_brief', goal_threshold: 0.8,
        observed_state: { cap: 125000, unit: '£ MRR per month', value: 0.6, source: 'brief_extraction', baseline: 0.6, raw_value: 75000 },
        goal_threshold_cap: 125000, goal_threshold_raw: 100000, goal_threshold_unit: '£ MRR per month',
        goal_threshold_frame: 'level', goal_threshold_cap_provenance: 'target_derived_headroom',
      },
      {
        id: 'raise_pro_price_to_59', kind: 'option', label: 'Raise Pro price to £59', provenance: 'from_brief',
        interventions: { pro_plan_price: { value: 0.295, source: 'brief_extraction' } },
      },
      { id: 'keep_current_pricing', kind: 'option', label: 'Keep current pricing', provenance: 'ai_inferred', is_baseline: true },
      {
        id: 'test_54_pro_price', kind: 'option', label: 'Test £54 Pro price', provenance: 'ai_inferred',
        interventions: { pro_plan_price: { value: 0.27, source: 'cee_hypothesis' } },
      },
      {
        id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', category: 'controllable', provenance: 'from_brief',
        observed_state: { cap: 200, unit: '£ per month', value: 0.245, source: 'brief_extraction', raw_value: 49, declared_scale: 'unit_interval' },
      },
      {
        id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', category: 'observable', provenance: 'ai_inferred', scale_frame: 100,
        observed_state: { unit: '% per month', value: 0.03, source: 'cee_inference', raw_value: 3, extractionType: 'inferred' },
      },
      {
        id: 'pro_paying_subscribers', kind: 'factor', label: 'Pro paying subscribers', category: 'observable', provenance: 'ai_inferred', scale_frame: 5000,
        observed_state: { unit: 'subscribers', value: 0.2, source: 'cee_inference', raw_value: 1000, extractionType: 'inferred' },
      },
      {
        id: 'gross_new_pro_subscribers_per_month', kind: 'factor', label: 'Gross new Pro subscribers per…', category: 'observable',
        provenance: 'ai_inferred', description: 'Gross new Pro subscribers per month', scale_frame: 500,
        observed_state: { unit: 'subscribers per month', value: 0.1, source: 'cee_inference', raw_value: 50, extractionType: 'inferred' },
      },
      {
        id: 'pro_plan_mrr', kind: 'outcome', label: 'Pro plan MRR', provenance: 'ai_inferred',
        nonlinear_identity: { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: false },
      },
    ],
    edges: [
      { to: 'raise_pro_price_to_59', from: 'decision_mrr', strength: { std: 0.01, mean: 1 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 },
      // ⚠ THE ONE CHANGE: std 0.01 → 0 (the fallback's own mark). This is what makes the base V3-invalid.
      { to: 'keep_current_pricing', from: 'decision_mrr', strength: { std: 0, mean: 1 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 },
      { to: 'test_54_pro_price', from: 'decision_mrr', strength: { std: 0.01, mean: 1 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 },
      { to: 'pro_plan_price', from: 'raise_pro_price_to_59', strength: { std: 0.01, mean: 1 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 },
      { to: 'pro_plan_price', from: 'test_54_pro_price', strength: { std: 0.01, mean: 1 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 },
      {
        to: 'pro_plan_price', from: 'keep_current_pricing', origin: 'repair', strength: { std: 0.01, mean: 1 },
        provenance: { source: 'cee_hypothesis', reasoning: 'Connectivity repair wired this option to a factor another option targets; no effect value is implied' },
        effect_direction: 'positive', exists_probability: 1,
      },
      {
        to: 'monthly_churn', from: 'pro_plan_price', strength: { std: 0.15, mean: 0.3 }, defaulted: true,
        provenance: {
          source: 'cee_hypothesis', magnitude: 'olumi_estimate',
          natural_effect: { amount: 0.15, amount_unit: 'percentage points', strength_mean: 0.3, per_source_change: 1, strength_mean_frame: 'edge_strength', per_source_change_unit: '£ per month' },
        },
        effect_direction: 'positive', exists_probability: 0.8,
      },
      { to: 'pro_paying_subscribers', from: 'monthly_churn', strength: { std: 0.125, mean: -0.5 }, defaulted: true, provenance: { source: 'cee_hypothesis' }, effect_direction: 'negative', exists_probability: 0.8 },
      { to: 'pro_paying_subscribers', from: 'gross_new_pro_subscribers_per_month', strength: { std: 0.125, mean: 0.5 }, defaulted: true, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 0.8 },
      { to: 'pro_plan_mrr', from: 'pro_plan_price', strength: { std: 0.125, mean: 0.5 }, defaulted: true, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 0.8 },
      { to: 'pro_plan_mrr', from: 'pro_paying_subscribers', strength: { std: 0.125, mean: 0.5 }, defaulted: true, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 0.8 },
      { to: 'mrr', from: 'pro_plan_mrr', strength: { std: 0.075, mean: 0.15 }, defaulted: true, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, effect_direction: 'positive', exists_probability: 0.8 },
    ],
    goal_node_id: 'mrr',
    goal_constraints: [
      {
        unit: '%', label: 'Monthly churn', value: 4, node_id: 'monthly_churn', operator: '<=', provenance: 'explicit',
        value_frame: 'level', constraint_id: 'agent-lane:monthly_churn:<=',
        provenance_unit_relabelled: { rule: 'agent_lane_limit_unit_v1', pre_normalisation_unit: '% per month', pre_normalisation_value: 4 },
      },
    ],
  };
}

/** The same graph with the one invalid std restored — the valid-base control. */

function editResponse(operations: unknown[]) {
  return { operations, removed_edges: [], warnings: [], coaching: { summary: 'Updated.', rerun_recommended: false } };
}

/** An ordinary rename of ONE node. */
const renameOps = (nodeId: string, from: string, to: string) => [
  { op: 'update_node', path: `/nodes/${nodeId}/label`, value: to, old_value: from, impact: 'minor', rationale: 'Rename.' },
];

/**
 * A batch that projects to ZERO referee envelopes: an `update_node` whose value
 * carries only the identity key (`projectOperation` skips `id`). On a valid
 * base it changes nothing; on the fallback it is still a "successful applied
 * mutation", so its commit carried the whole fallback graph.
 */

async function runEdit(stored: Json, operations: unknown[], message: string, turn: string) {
  storedGraphRef.current = stored;
  llmChatMock.mockResolvedValue({
    content: JSON.stringify(editResponse(operations)),
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: 'test-model',
    latencyMs: 1,
    stopReason: 'end_turn',
  });
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockClear();
  const result = await dispatchEditGraph({
    payload: {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: turn,
      stage: 'analyse' as const,
      message,
      turn_class: 'frame' as const,
      source: 'composer' as const,
    },
    requestId: `req-${turn}`,
    request: STUB_REQUEST,
    // The route reloads the stored graph as the ingress graph (the UI sends a
    // turn, never a graph) — the same bytes as the persisted merge base.
    graphState: JSON.parse(JSON.stringify(stored)) as GraphStateIngress,
    analysisState: null,
  });
  const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
  expect(calls).toHaveLength(1);
  const metadata = calls[0]![1];
  // `append_turn_atomic` semantics: a graph on the commit REPLACES the stored
  // graph; no graph leaves it as it was.
  const storedAfter = (metadata.graph as Json | undefined) ?? stored;
  return { result, metadata, storedAfter };
}

const nodeById = (g: Json, id: string) => (g.nodes as Array<Json & { observed_state: Json }>).find((n) => n.id === id);

beforeEach(() => {
  llmChatMock.mockReset();
  gmModeRef.current = null;
  storedGraphRef.current = null;
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockReset();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true as const,
    persisted_row_id: 'row-fallback',
    graphPersisted: true,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});




describe('controls', () => {
  it('CAS ON: an unrelated rename of a stored zero-sigma graph reaches the real edit provider and commits', async () => {
    __setUseAppendV6ForTest(true);
    gmModeRef.current = 'off';
    const stored = storedInvalidGraph();
    nodeById(stored, 'monthly_churn')!.observed_state.std = 0;
    const { metadata, storedAfter } = await runEdit(stored,
      renameOps('monthly_churn', 'Monthly churn', 'Monthly churn rate'), 'Rename Monthly churn to Monthly churn rate', 'zero-sigma');
    expect(metadata.graph).toBeDefined();
    expect(nodeById(storedAfter, 'monthly_churn')!.label).toBe('Monthly churn rate');
    expect((storedAfter.edges as FixtureEdge[])[1]!.strength.std).toBe(0);
    expect(nodeById(storedAfter, 'monthly_churn')!.observed_state.std).toBe(0);
  });

  it.each([0, -1])('CAS ON: stored std=%s preserves identity and commits', async std => {
    __setUseAppendV6ForTest(true);
    gmModeRef.current = 'off';
    const stored = storedInvalidGraph();
    (stored.edges as FixtureEdge[])[1]!.strength.std = std;
    const { metadata, storedAfter } = await runEdit(stored,
      renameOps('monthly_churn', 'Monthly churn', 'Monthly churn rate'), 'Rename Monthly churn to Monthly churn rate', `std-${std}`);
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    expect(metadata.expectedRevision).toBe(7);
    expect((storedAfter.edges as FixtureEdge[])[1]!.strength.std).toBe(std);
  });

  it.each([
    ['std', Infinity], ['mean', -7], ['mean', Infinity],
    ['mean', NaN], ['mean', -Infinity], ['exists_probability', -0.1], ['exists_probability', 1.1],
  ] as const)('CAS ON: stored %s=%s refuses before provider or append', async (field, value) => {
    __setUseAppendV6ForTest(true);
    gmModeRef.current = 'off';
    const stored = storedInvalidGraph();
    const edge = (stored.edges as FixtureEdge[])[1]!;
    if (field === 'exists_probability') edge[field] = value;
    else edge.strength[field] = value;
    await expect(runEdit(stored,
      renameOps('monthly_churn', 'Monthly churn', 'Monthly churn rate'), 'Rename Monthly churn to Monthly churn rate', 'invalid-number'))
      .rejects.toBeInstanceOf(ModelReadFailedError);
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(commitDirectAnswer).not.toHaveBeenCalled();
    expect(storedGraphRef.current).toBe(stored);
    expect(field === 'exists_probability' ? edge[field] : edge.strength[field]).toBe(value);
  });


});

afterEach(() => __setUseAppendV6ForTest(true));
