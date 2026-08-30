import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatArgs, CallOpts } from '../../../adapters/llm/types.js';
import { GraphV3, type GraphV3T, type NodeV3T } from '../../../schemas/cee-v3.js';
import { DRAFT_REQUEST_BUDGET_MS, LLM_POST_PROCESSING_HEADROOM_MS, getDraftLlmRetryBudgetMs } from '../../../config/timeouts.js';
import { getTurnExecutorBudgets } from '../../../orchestrator-v5/budgets.js';

const h = vi.hoisted(() => ({ chat: vi.fn(), resolve: vi.fn(), structured: true }));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapterWithResolution: h.resolve }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, cee: { ...actual.config.cee, get anthropicStructuredOutputs() { return h.structured; } } } };
});

import { factorEstimationDeadline, quantifyDraftFactors } from '../index.js';
import { FACTOR_QUANTIFICATION_SYSTEM_PROMPT } from '../prompt.js';
import { FACTOR_ESTIMATES_JSON_SCHEMA } from '../estimate-response.js';

/** The adapter is controlled; selection, deadline, prompt, parsing, adoption and metrics execute. */
const now = 1_800_000_000_000;
const gapId = (index: number): string => `gap_${String(index).padStart(2, '0')}`;
const edge = (from: string, to: string): GraphV3T['edges'][number] => ({
  from, to, strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
});
function graph(gaps = 1): GraphV3T {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Reliable service' },
      { id: 'a', kind: 'option', label: 'Gradual expansion', interventions: { capacity: 0.12 } },
      { id: 'b', kind: 'option', label: 'Faster expansion', interventions: { capacity: 0.24 } },
      { id: 'capacity', kind: 'factor', label: 'Capacity', category: 'controllable', observed_state: { value: 0.1, source: 'user_override' } },
      { id: 'stated', kind: 'factor', label: 'Stated churn', category: 'external', observed_state: { value: 0.12, source: 'brief_extraction' } },
      ...Array.from({ length: gaps }, (_, index): NodeV3T => ({ id: gapId(index), kind: 'factor', label: `Required baseline ${index}`, category: 'external' })),
    ],
    edges: [edge('a', 'capacity'), edge('b', 'capacity'), edge('capacity', 'goal'), edge('stated', 'goal'), ...Array.from({ length: gaps }, (_, index) => edge(gapId(index), 'goal'))],
  };
}
function input(model = graph(), start = now) {
  return {
    graph: model, brief: 'The controlled staffing rule supports baseline 0.6 with standard deviation 0.1. No bounds are available for the other baselines.',
    requestId: 'factor-stage', requestStartMs: start, targetId: 'goal',
    options: model.nodes.filter(node => node.kind === 'option').map(node => ({ id: node.id, interventions: node.interventions })),
  };
}
const unknown = (factor_id: string) => ({ factor_id, estimate_type: 'unknown', reasoning: 'The supplied context gives neither observations nor defensible quantitative bounds for this factor.', basis: [] });
const point = (factor_id: string) => ({ factor_id, estimate_type: 'estimated', value: 0.6, std: 0.1, reasoning: 'The controlled staffing rule supplies the central level and its standard deviation on this factor scale.', basis: ['brief'] });
function response(estimates: unknown[]) {
  return { content: JSON.stringify({ estimates }), model: 'claude-sonnet-5', latencyMs: 37, usage: { input_tokens: 140, output_tokens: 90 } };
}
const byId = (model: GraphV3T, id: string) => model.nodes.find(node => node.id === id)!;
const expiredStart = (): number => now - Math.max(DRAFT_REQUEST_BUDGET_MS, getTurnExecutorBudgets().turn_ms) - 1;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  h.chat.mockReset(); h.resolve.mockReset(); h.structured = true;
  h.resolve.mockReturnValue({ adapter: { chat: h.chat }, resolution: { provider: 'anthropic', resolved_model: 'claude-sonnet-5', resolution_source: 'task_default' } });
  h.chat.mockResolvedValue(response([point(gapId(0))]));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('stage metrics reflect accepted canonical outcomes rather than call success', () => {
  it('skips estimation when every retained option cuts the missing root off with its downstream intervention', async () => {
    const model = graph();
    model.edges = model.edges.filter(e => e.from !== gapId(0));
    model.edges.push(edge(gapId(0), 'capacity'));
    const before = structuredClone(model);
    const result = await quantifyDraftFactors(input(model));
    expect(result.model).toMatchObject({ kind: 'skipped', reason: 'no_gaps' });
    expect(result.metrics).toMatchObject({ required_inputs: 1, gaps_entering: 0, gaps_requested: 0, estimated: 0, explicit_unknown: 0, operational_unresolved: 0, fallback: 0, strict_evaluation_pass: true });
    expect(result.graph).toEqual(before);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.chat).not.toHaveBeenCalled();
  });

  it('requests the upstream root only for the retained option with an uncut downstream path', async () => {
    const model = graph();
    model.edges = model.edges.filter(e => e.from !== gapId(0));
    model.edges.push(edge(gapId(0), 'capacity'));
    model.nodes.push({ id: 'other', kind: 'factor', label: 'Other lever', category: 'controllable' });
    model.edges.push(edge('other', 'goal'));
    byId(model, 'a').interventions = { capacity: 0.12, other: 0.2 };
    byId(model, 'b').interventions = { other: 0.8 };
    h.chat.mockResolvedValue(response([unknown(gapId(0))]));
    const result = await quantifyDraftFactors(input(model));
    const [args] = h.chat.mock.calls[0] as [ChatArgs, CallOpts];
    const envelopes = [...args.userMessage.matchAll(/\[BEGIN_UNTRUSTED_USER_CONTENT\]\n([\s\S]*?)\n\[END_UNTRUSTED_USER_CONTENT\]/g)];
    const sent = JSON.parse(envelopes[1]![1]!) as Array<{ factor_id: string; requirement: { option_ids: string[] } }>;
    expect(sent).toEqual([expect.objectContaining({ factor_id: gapId(0), requirement: expect.objectContaining({ option_ids: ['b'] }) })]);
    expect(result.metrics).toMatchObject({ gaps_entering: 1, gaps_requested: 1, model_unknown: 1, explicit_unknown: 1, operational_unresolved: 0, fallback: 0, strict_evaluation_pass: true });
    expect(byId(result.graph, gapId(0)).prior).toMatchObject({ prior_is_unquantified: true, source: 'cee_inference' });
    expect(h.chat).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a reasoned estimate, model abstention and missing output while preserving supplied values', async () => {
    const model = graph(3);
    const before = structuredClone(model);
    h.chat.mockResolvedValue(response([point(gapId(0)), unknown(gapId(1))]));
    const result = await quantifyDraftFactors(input(model));
    expect(result.metrics).toMatchObject({
      required_inputs: 4, materiality: 'required_input_impact_unassessed', gaps_entering: 3, gaps_requested: 3,
      estimated: 1, model_unknown: 1, explicit_unknown: 2, operational_unresolved: 1, skipped_gaps: 0,
      fallback: 0, strict_evaluation_pass: false, protected_values_changed: 0, unresolved_origin: [], rejected: [],
      call: { call_made: true, provider: 'anthropic', model: 'claude-sonnet-5', input_tokens: 140, output_tokens: 90, provider_latency_ms: 37, cost_usd: null },
    });
    expect(h.resolve).toHaveBeenCalledExactlyOnceWith('factor_quantification');
    expect(h.chat).toHaveBeenCalledTimes(1);
    const [args, opts] = h.chat.mock.calls[0] as [ChatArgs, CallOpts];
    expect(args.system).toBe(FACTOR_QUANTIFICATION_SYSTEM_PROMPT);
    expect(args.outputSchema).toBe(FACTOR_ESTIMATES_JSON_SCHEMA);
    expect(opts.timeoutMs).toBe(factorEstimationDeadline(now) - now);
    expect(byId(result.graph, gapId(0)).observed_state).toMatchObject({ value: 0.6, std: 0.1, source: 'cee_inference', reasoning: { context_basis: ['brief'] } });
    expect(byId(result.graph, gapId(1)).prior).toMatchObject({ prior_is_unquantified: true, source: 'cee_inference', reasoning: { rationale: unknown(gapId(1)).reasoning } });
    expect(byId(result.graph, gapId(2)).prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
    expect(byId(result.graph, 'stated')).toEqual(byId(before, 'stated'));
    expect(byId(result.graph, 'capacity')).toEqual(byId(before, 'capacity'));
    expect(result.graph.edges).toEqual(before.edges);
    expect(model).toEqual(before);
    expect(GraphV3.safeParse(result.graph).success).toBe(true);
  });

  it('counts a justified model unknown as successful completion without fabricating numeric support', async () => {
    h.chat.mockResolvedValue(response([unknown(gapId(0))]));
    const result = await quantifyDraftFactors(input());
    expect(result.metrics).toMatchObject({ gaps_entering: 1, estimated: 0, model_unknown: 1, explicit_unknown: 1, operational_unresolved: 0, fallback: 0, strict_evaluation_pass: true });
    const node = byId(result.graph, gapId(0));
    expect(node.observed_state).toBeUndefined();
    expect(node.prior).not.toHaveProperty('range_min');
    expect(node.prior).not.toHaveProperty('range_max');
  });

  it.each(['omitted', 'malformed', 'provider_failure'])('records %s output as operational unknown, never a model-authored refusal', async fault => {
    if (fault === 'provider_failure') h.chat.mockRejectedValue(new Error('controlled provider failure'));
    else h.chat.mockResolvedValue(fault === 'omitted' ? response([]) : response([{ ...unknown(gapId(0)), value: 0.5 }]));
    const result = await quantifyDraftFactors(input());
    expect(result.model.kind).toBe(fault === 'provider_failure' ? 'llm_error' : fault === 'malformed' ? 'parse_failed' : 'ok');
    expect(result.metrics).toMatchObject({ estimated: 0, model_unknown: 0, explicit_unknown: 1, operational_unresolved: 1, fallback: 0, strict_evaluation_pass: false, call: { call_made: true } });
    expect(byId(result.graph, gapId(0)).prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
  });

  it('caps the requested queue at eight and leaves overflow explicitly unresolved', async () => {
    const requested = [gapId(9), ...Array.from({ length: 7 }, (_, index) => gapId(index))];
    h.chat.mockResolvedValue(response(requested.map(unknown)));
    const result = await quantifyDraftFactors({ ...input(graph(10)), importantIds: [gapId(9)] });
    expect(h.chat).toHaveBeenCalledTimes(1);
    const [args] = h.chat.mock.calls[0] as [ChatArgs, CallOpts];
    const envelopes = [...args.userMessage.matchAll(/\[BEGIN_UNTRUSTED_USER_CONTENT\]\n([\s\S]*?)\n\[END_UNTRUSTED_USER_CONTENT\]/g)];
    const sent = JSON.parse(envelopes[1]![1]!) as Array<{ factor_id: string }>;
    expect(sent.map(item => item.factor_id)).toEqual(requested);
    expect(result.metrics).toMatchObject({ required_inputs: 11, gaps_entering: 10, gaps_requested: 8, model_unknown: 8, explicit_unknown: 10, operational_unresolved: 0, skipped_gaps: 2, fallback: 0, strict_evaluation_pass: false, protected_values_changed: 0 });
    for (const id of [gapId(7), gapId(8)]) expect(byId(result.graph, id).prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
  });

  it('keeps protected labelled fallback visible and fails strict evaluation without overwriting it', async () => {
    const model = graph();
    byId(model, gapId(0)).prior = { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, value_tier: 'fallback_default', source: 'user_override' };
    const result = await quantifyDraftFactors(input(model));
    expect(result.model).toMatchObject({ kind: 'skipped', reason: 'no_gaps' });
    expect(result.metrics).toMatchObject({ gaps_entering: 0, gaps_requested: 0, estimated: 0, explicit_unknown: 0, fallback: 1, strict_evaluation_pass: false, protected_values_changed: 0 });
    expect(result.graph).toEqual(model);
    expect(h.chat).not.toHaveBeenCalled();
  });

  it.each([0.12, 0.24])('keeps unattributed existing %s protected and counts its attribution as unresolved', async value => {
    const model = graph();
    byId(model, gapId(0)).observed_state = { value };
    const result = await quantifyDraftFactors(input(model));
    expect(result.metrics).toMatchObject({ gaps_entering: 0, estimated: 0, fallback: 0, unresolved_origin: [gapId(0)], protected_values_changed: 0 });
    expect(byId(result.graph, gapId(0)).observed_state).toEqual({ value });
    expect(result.graph).toEqual(model);
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.chat).not.toHaveBeenCalled();
  });

  it('rejects an injected attempt to overwrite a supplied value and does not count it as an estimate', async () => {
    const model = graph();
    h.chat.mockResolvedValue(response([point('stated')]));
    const result = await quantifyDraftFactors(input(model));
    expect(result.model).toMatchObject({ kind: 'parse_failed' });
    expect(result.metrics).toMatchObject({ estimated: 0, operational_unresolved: 1, protected_values_changed: 0, strict_evaluation_pass: false });
    expect(byId(result.graph, 'stated')).toEqual(byId(model, 'stated'));
    expect(byId(result.graph, gapId(0)).prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
  });

  it('does not mutate an unchanged target when another model constraint changes during estimation', async () => {
    const model = graph();
    model.nodes.push({ id: 'budget_constraint', kind: 'constraint', label: 'Annual budget must stay below £100,000' });
    model.edges.push(edge('budget_constraint', 'goal'));
    const targetBefore = structuredClone(byId(model, gapId(0)));
    h.chat.mockImplementation(async () => {
      // Simulate a concurrent human edit after the prompt was formed.
      byId(model, 'budget_constraint').label = 'Annual budget must stay below £80,000';
      return response([point(gapId(0))]);
    });
    const result = await quantifyDraftFactors(input(model));
    expect(result.model.kind).toBe('ok');
    expect(result.metrics).toMatchObject({ estimated: 0, model_unknown: 0, explicit_unknown: 0, operational_unresolved: 1, strict_evaluation_pass: false, protected_values_changed: 0, rejected: [{ factor_id: gapId(0), reason: 'stale_or_unrequested' }] });
    expect(byId(result.graph, gapId(0))).toEqual(targetBefore);
    expect(byId(result.graph, 'budget_constraint').label).toBe('Annual budget must stay below £80,000');
    expect(result.graph).toEqual(model);
  });
});

describe('stage preserves request and completion budgets', () => {
  it('derives its deadline from both existing budgets without resetting elapsed time', () => {
    const start = now - 30_000;
    const deadline = factorEstimationDeadline(start, now);
    expect(deadline).toBeLessThanOrEqual(now + getDraftLlmRetryBudgetMs(30_000));
    expect(deadline).toBeLessThanOrEqual(start + getTurnExecutorBudgets().turn_ms - LLM_POST_PROCESSING_HEADROOM_MS);
    expect(deadline).toBeLessThan(factorEstimationDeadline(now, now));
  });

  it('spends no model call after budget expiry and records a new gap as skipped operational unknown', async () => {
    const result = await quantifyDraftFactors(input(graph(), expiredStart()));
    expect(result.model).toMatchObject({ kind: 'skipped', reason: 'deadline_expired', metadata: { call_made: false, input_tokens: null, output_tokens: null } });
    expect(result.metrics).toMatchObject({ gaps_entering: 1, gaps_requested: 1, estimated: 0, model_unknown: 0, explicit_unknown: 1, operational_unresolved: 1, skipped_gaps: 1, fallback: 0, strict_evaluation_pass: false });
    expect(byId(result.graph, gapId(0)).prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.chat).not.toHaveBeenCalled();
  });

  it('does not erase an earlier reasoned unknown when a later attempt has no budget', async () => {
    const model = graph();
    byId(model, gapId(0)).prior = { prior_is_unquantified: true, source: 'cee_inference', reasoning: { rationale: 'No audience or historical campaign data exists.', context_basis: ['previous_context'] } };
    const before = structuredClone(model);
    const result = await quantifyDraftFactors(input(model, expiredStart()));
    expect(result.model).toMatchObject({ kind: 'skipped', reason: 'deadline_expired' });
    expect(result.metrics).toMatchObject({ model_unknown: 0, operational_unresolved: 1, explicit_unknown: 1, skipped_gaps: 1, fallback: 0, strict_evaluation_pass: false });
    expect(result.graph).toEqual(before);
    expect(h.chat).not.toHaveBeenCalled();
  });

  it('keeps disabled structured-output execution separate from a model unknown', async () => {
    h.structured = false;
    const result = await quantifyDraftFactors(input());
    expect(result.model).toMatchObject({ kind: 'skipped', reason: 'structured_outputs_disabled' });
    expect(result.metrics).toMatchObject({ model_unknown: 0, explicit_unknown: 1, operational_unresolved: 1, skipped_gaps: 1, fallback: 0, strict_evaluation_pass: false });
    expect(h.chat).not.toHaveBeenCalled();
  });
});
