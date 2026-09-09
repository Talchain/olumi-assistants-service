import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';
import type { ConversationContext } from '../../types.js';
import { handleEditGraph } from '../../tools/edit-graph.js';
import {
  compactGraph,
  editCompactGraph,
  serialiseEditContextForLLMWithMeta,
  truncateGraphJsonWithMeta,
  EDIT_CONTEXT_GRAPH_JSON_DEFAULT_BYTES,
} from '../serialise.js';

// Reconstructed canonical shape, NOT a recovered provider response. The b0d
// capture distinguishes .75/.30/.80 option levels from a .20 factor state.
// Joined-copy tests deliberately use a coherent index scale, not the captured
// contaminated currency scale; showing data does not certify its semantics.
function configurationGraph(): GraphV3T {
  const option = (id: string, label: string, perception: number, price: number) => ({
    id, kind: 'option', label,
    interventions: {
      perception: { value: perception, raw_value: perception, unit: 'index', source: 'cee_hypothesis', value_confidence: 'low', reasoning: 'Provisional feature-release assumption', target_match: { node_id: 'perception', match_type: 'exact_id', confidence: 'high' } },
      price: { value: price / 100, raw_value: price, unit: '£', source: 'brief_extraction', target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' } },
    },
  });
  const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
  return GraphV3.parse({
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Pricing and feature release' },
      option('raise', 'Raise price, ship feature', 0.75, 59),
      { ...option('status_quo', 'Hold price, no feature', 0.30, 49), is_baseline: true },
      option('hold', 'Hold price, ship feature', 0.80, 49),
      { id: 'new_option', kind: 'option', label: 'Grandfather existing customers', interventions: {} },
      { id: 'perception', kind: 'factor', label: 'Pro Feature Value Perception', description: 'Qualitative customer response, not revenue', category: 'controllable', observed_state: { value: 0.20, unit: 'index', source: 'cee_inference', uncertainty_drivers: ['Customer response not measured'] } },
      { id: 'price', kind: 'factor', label: 'Pro Plan Monthly Price', observed_state: { value: 0.59, raw_value: 59, baseline: 49, unit: '£', cap: 100, source: 'brief_extraction' } },
      { id: 'churn', kind: 'risk', label: 'Churn Rate Uplift' },
      { id: 'goal', kind: 'goal', label: 'Reach £20k MRR within 12 months' },
    ],
    edges: [
      ...['raise', 'status_quo', 'hold', 'new_option'].flatMap(id => [edge('decision', id), edge(id, 'perception'), edge(id, 'price')]),
      edge('perception', 'goal'), edge('price', 'goal'), edge('price', 'churn'), edge('churn', 'goal'),
    ],
  });
}

function context(graph = configurationGraph()): ConversationContext {
  return {
    graph, analysis_response: null, framing: null, scenario_id: 'configuration-context',
    messages: [{ role: 'assistant', content: 'A 20% new-signup share is an assumption, not observed cohort data.' }],
  };
}

function nodesFrom(graph: unknown) {
  return GraphV3.pick({ nodes: true }).parse(graph).nodes;
}

function nodeFrom(graph: unknown, id: string) {
  const node = nodesFrom(graph).find(candidate => candidate.id === id);
  if (!node) throw new Error(`Missing graph node ${id}`);
  return node;
}

function mutableNode(graph: GraphV3T, id: string) {
  const node = graph.nodes.find(candidate => candidate.id === id);
  if (!node) throw new Error(`Missing fixture node ${id}`);
  return node;
}

function outboundGraph(text: string): unknown {
  const match = /## Current Graph[^\n]*\n[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text);
  if (!match?.[1]) throw new Error('Actual edit adapter input has no graph section');
  return JSON.parse(match[1]);
}

afterEach(() => vi.restoreAllMocks());

describe('edit model configuration context', () => {
  it('retains distinct source option assumptions instead of offering only the factor baseline', () => {
    const graph = configurationGraph();
    const projected = editCompactGraph(graph);
    for (const id of ['raise', 'status_quo', 'hold', 'new_option']) {
      expect(nodeFrom(projected, id).interventions).toEqual(nodeFrom(graph, id).interventions);
    }
    expect(nodeFrom(projected, 'perception').observed_state).toEqual(nodeFrom(graph, 'perception').observed_state);
    expect(nodeFrom(projected, 'perception').description).toBe('Qualitative customer response, not revenue');
    expect(nodeFrom(projected, 'status_quo').is_baseline).toBe(true);
  });

  it('preserves captured conflicting raw/model pairs without silently choosing a new default or scale', () => {
    const graph = configurationGraph();
    mutableNode(graph, 'perception').observed_state = { value: 0.2, raw_value: 20000, cap: 100000, unit: '£', source: 'brief_extraction', factor_type: 'cost' };
    const projected = editCompactGraph(graph);
    expect(nodeFrom(projected, 'perception').observed_state).toEqual(nodeFrom(graph, 'perception').observed_state);
    expect(nodeFrom(projected, 'raise').interventions).toEqual(nodeFrom(graph, 'raise').interventions);
    expect(nodeFrom(projected, 'new_option').interventions).toEqual({});
    expect(nodeFrom(projected, 'perception').scale_frame).toBeUndefined();
  });

  it('retains current/proposed price separately from the explicitly stored original baseline', () => {
    expect(nodeFrom(editCompactGraph(configurationGraph()), 'price').observed_state)
      .toEqual({ value: 0.59, raw_value: 59, baseline: 49, unit: '£', cap: 100, source: 'brief_extraction' });
  });

  it('retains explicit scale_frame separately from cap and does not infer it from one pair', () => {
    const graph = configurationGraph();
    const price = mutableNode(graph, 'price');
    price.scale_frame = 200;
    price.observed_state = { value: 0.295, raw_value: 59, unit: '£', source: 'user_confirmed' };
    expect(nodeFrom(editCompactGraph(graph), 'price')).toMatchObject({ scale_frame: 200, observed_state: price.observed_state });
    delete price.scale_frame;
    expect(nodeFrom(editCompactGraph(graph), 'price').scale_frame).toBeUndefined();
    expect(nodeFrom(editCompactGraph(graph), 'price').observed_state).not.toHaveProperty('cap');
  });

  it('keeps absolute percentage values distinct from an unvalued uplift risk', () => {
    const graph = configurationGraph();
    mutableNode(graph, 'price').label = 'Monthly churn rate';
    mutableNode(graph, 'price').observed_state = { value: 0.03, raw_value: 3, unit: '%', source: 'user_override' };
    const projected = editCompactGraph(graph);
    expect(nodeFrom(projected, 'price').observed_state).toEqual(nodeFrom(graph, 'price').observed_state);
    expect(nodeFrom(projected, 'churn').observed_state).toBeUndefined();
    expect(nodeFrom(projected, 'goal').observed_state).toBeUndefined();
    expect(nodeFrom(projected, 'goal').goal_threshold).toBeUndefined();
  });

  it('preserves zero and missingness, with no manufactured baseline, unit or frame', () => {
    const graph = configurationGraph();
    mutableNode(graph, 'perception').observed_state = { value: 0, source: 'user_override' };
    mutableNode(graph, 'new_option').interventions = { perception: 0 };
    const projected = editCompactGraph(graph);
    expect(nodeFrom(projected, 'perception').observed_state).toEqual({ value: 0, source: 'user_override' });
    expect(nodeFrom(projected, 'new_option').interventions).toEqual({ perception: 0 });
  });

  it('retains categorical meaning and uncertainty in a non-pricing configuration', () => {
    const graph = configurationGraph();
    const factor = mutableNode(graph, 'perception');
    factor.label = 'Delivery team';
    factor.encoding_map = { '0': 'Internal', '1': 'Partner' };
    factor.factor_type = 'categorical';
    factor.uncertainty_drivers = ['Partner availability'];
    mutableNode(graph, 'raise').interventions = { perception: { value: 1, raw_value: 'Partner', value_type: 'categorical', encoding_map: { Internal: 0, Partner: 1 }, source: 'cee_hypothesis', value_confidence: 'low', reasoning: 'Availability is unconfirmed' } };
    const projected = editCompactGraph(graph);
    expect(nodeFrom(projected, 'perception')).toMatchObject({ encoding_map: factor.encoding_map, factor_type: 'categorical', uncertainty_drivers: ['Partner availability'] });
    expect(nodeFrom(projected, 'raise').interventions).toEqual(nodeFrom(graph, 'raise').interventions);
  });

  it('does not promote unrelated heavy payloads or modify the input graph/general compact consumer', () => {
    const graph = configurationGraph();
    const before = structuredClone(graph);
    const price = mutableNode(graph, 'price');
    if (!price.observed_state) throw new Error('Fixture missing price');
    price.observed_state.unrelated_payload = 'unrelated-private-data';
    const projected = editCompactGraph(graph);
    expect(JSON.stringify(projected)).not.toContain('unrelated-private-data');
    expect(nodeFrom(graph, 'price').observed_state?.unrelated_payload).toBe('unrelated-private-data');
    expect(compactGraph(graph).nodes).toEqual(before.nodes.map(({ id, label, kind }) => ({ id, label, kind })));
  });

  it('feeds the same fields into the existing budgeted section and retains conversation/immutable inputs', () => {
    const ctx = context();
    const before = structuredClone(ctx);
    const rendered = serialiseEditContextForLLMWithMeta(ctx);
    expect(nodeFrom(outboundGraph(rendered.text), 'raise').interventions).toEqual(nodeFrom(ctx.graph, 'raise').interventions);
    expect(rendered.text).toContain('A 20% new-signup share is an assumption, not observed cohort data.');
    expect(rendered.truncations).toEqual([]);
    expect(JSON.stringify(outboundGraph(rendered.text)).length).toBeLessThanOrEqual(EDIT_CONTEXT_GRAPH_JSON_DEFAULT_BYTES);
    expect(ctx).toEqual(before);
  });

  it('keeps the existing graph truncation/disclosure policy, not an unbounded extra context section', () => {
    const graph = configurationGraph();
    const compact = editCompactGraph(graph);
    const cut = truncateGraphJsonWithMeta(compact, 2500);
    const rendered = serialiseEditContextForLLMWithMeta(context(graph), 2500);
    expect(cut.truncated).toBe(true);
    expect(rendered.text).toContain(`graph truncated: showing ${cut.keptNodes} of ${graph.nodes.length} nodes`);
    expect(outboundGraph(rendered.text)).toEqual(JSON.parse(cut.json));
    expect(rendered.truncations).toContainEqual(expect.objectContaining({ section: 'graph_json', disclosed: true }));
  });
});

describe('real edit adapter input → controlled model reply → canonical configured option', () => {
  it.each([['raise', 0.75], ['hold', 0.80]] as const)('copies the named %s assumption, not factor .20 or another option', async (sourceId, expectedValue) => {
    const ctx = context();
    const before = structuredClone(ctx.graph);
    const unused = async (): Promise<never> => { throw new Error('Unexpected non-edit adapter call'); };
    const chat: LLMAdapter['chat'] = vi.fn(async args => {
      const graph = outboundGraph(args.system);
      const source = nodeFrom(graph, sourceId);
      const intervention: unknown = source.interventions?.perception;
      // The fixture is a controlled recipient, not a claim about real model
      // compliance. Its copy cannot work without the actual outbound value.
      expect(intervention).toMatchObject({ value: expectedValue, raw_value: expectedValue, unit: 'index', value_confidence: 'low' });
      expect(nodeFrom(graph, 'perception').observed_state?.value).toBe(0.20);
      expect(nodeFrom(graph, 'new_option').interventions).toEqual({});
      return {
        content: JSON.stringify({ operations: [
          { op: 'update_node', path: '/nodes/new_option/data/interventions/perception', value: intervention, old_value: null, impact: 'moderate', rationale: `Copy the approved ${sourceId} assumption, not the factor state` },
          { op: 'update_node', path: '/nodes/new_option/data/interventions/price', value: { value: 0.51, raw_value: 51, unit: '£' }, old_value: null, impact: 'moderate', rationale: 'Approved 20% new-signup assumption' },
        ], removed_edges: [], warnings: [], coaching: { summary: 'Configured the approved assumptions; the cohort mix remains uncertain.', rerun_recommended: true } }),
        usage: { input_tokens: 1, output_tokens: 1 }, model: 'controlled-fixture', latencyMs: 1,
      };
    });
    const adapter: LLMAdapter = { name: 'fixtures', model: 'controlled-fixture', chat, draftGraph: unused, suggestOptions: unused, clarifyBrief: unused, critiqueGraph: unused, explainDiff: unused };
    const result = await handleEditGraph(ctx, `Configure Grandfather existing customers: copy Pro Feature Value Perception from ${sourceId}; set blended price to £51 as agreed.`, adapter, `config-${sourceId}`, `turn-${sourceId}`, { maxRetries: 0, invocationInput: { confirmation_mode: 'apply_pending_proposal' } });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.wasRejected).toBe(false);
    const applied = GraphV3.parse(result.appliedGraph);
    expect(nodeFrom(applied, 'new_option').interventions).toMatchObject({
      perception: { value: expectedValue, raw_value: expectedValue, unit: 'index' },
      price: { value: 0.51, raw_value: 51, unit: '£' },
    });
    expect(nodeFrom(applied, sourceId)).toEqual(nodeFrom(before, sourceId));
    expect(nodeFrom(applied, 'perception')).toEqual(nodeFrom(before, 'perception'));
    expect(ctx.graph).toEqual(before);
  });
});
