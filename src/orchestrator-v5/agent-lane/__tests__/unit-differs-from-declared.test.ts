import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { unitComparisonKey } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { ProposalStore } from '../proposal.js';
import { runAgentTurn, type CallModel, type ModelCallRequest } from '../runtime/agent-loop.js';

const message = 'Set the Duration levels for the two options. Trial takes 0.3 days, which is my own figure. For Full, use your own estimate of 20 days.';
// Exact served graph from #2919, bound by option/factor ids.
const graph = {
  edges: [['trial', 'duration'], ['full', 'duration'], ['duration', 'goal']].map(([from, to]) => ({ from, to, strength: { std: 0.1, mean: 0.5 }, effect_direction: 'positive', exists_probability: 1 })),
  nodes: [{ id: 'goal', ref: 'G1', kind: 'goal', label: 'Service quality' },
    { id: 'duration', ref: 'F1', kind: 'factor', label: 'Duration', observed_state: { unit: 'days', value: 0.5 } },
    { id: 'trial', ref: 'O1', kind: 'option', label: 'Trial' }, { id: 'full', ref: 'O2', kind: 'option', label: 'Full' }],
  ref_high_water: { F: 1, G: 1, O: 2 },
};
const served = { graph, graph_hash: '47a9316509ef69ce' };
const llm = vi.fn(() => { throw new Error('Live LLM calls forbidden'); });
// Same read-only session/LLM harness as zz-2919 and agent-level-keeps-the-users-likely-range.
vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({ loadGraph: async () => graph, loadGraphAndBriefText: async () => ({ graph, briefText: null }),
    readMostRecentPendingActions: async () => [], readFactsFor: async () => [], readRecent: async () => [], readFactsWithTurnFor: async () => [],
    append: async () => { throw new Error('Session writes forbidden'); }, getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    ensureScenarioExists: async (_s: string, userId: string) => ({ user_id: userId }) }),
  resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {},
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llm, chatWithTools: llm }),
  getAdapterWithResolution: () => ({ adapter: { name: 'test', model: 'test-model', chat: llm, chatWithTools: llm },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' } }), getMaxTokensFromConfig: () => undefined,
}));
const ctx = { scenario_id: '1d4cbd25-98fb-47db-bbe7-29d61487ab4c', authenticated_user_id: 'user-a', request_id: 'unit-2919', user_text: message, user_turn_text: message };
const trial = { option_label: 'trial', factor_label: 'duration', value: 0.3, unit: 'days', user_stated: true, basis: 'the user explicitly gave their own figure' };
const full = { option_label: 'full', factor_label: 'duration', value: 20, unit: 'days', user_stated: false, basis: 'Olumi estimate requested by the user' };
const hours = { ...trial, value: 7.2, unit: 'hours' };
const detail = "Send Trial's figure exactly as the user wrote it, in days (the factor's unit); it was sent in hours. Nothing was changed.";
const fixture = new URL('./fixtures/unit-differs-same-unit-base.json', import.meta.url);
let createAgentCapabilities: typeof import('../runtime/agent-capabilities.js').createAgentCapabilities;
beforeAll(async () => { ({ createAgentCapabilities } = await import('../runtime/agent-capabilities.js')); });
afterAll(() => { expect(llm).not.toHaveBeenCalled(); });
function real(testGraph = graph) {
  const store = new ProposalStore();
  const read = vi.fn(async (path: string) => { expect(path).toContain('/graph'); return { status: 200, json: { ...served, graph: testGraph } }; });
  return { store, caps: createAgentCapabilities(read as never, store, undefined, 'full') };
}
async function propose(interventions: Record<string, unknown>[], declaredUnit = 'days', text = message) {
  const before = JSON.stringify(graph);
  const testGraph = { ...graph, nodes: graph.nodes.map(n => n.id === 'duration' ? { ...n, observed_state: { value: 0.5, unit: declaredUnit } } : n) };
  const { store, caps } = real(testGraph);
  const result = await caps.proposeOptionInterventions({ ...ctx, user_text: text, user_turn_text: text }, { interventions } as never);
  expect(JSON.stringify(graph)).toBe(before);
  return { result, store, proposal: store.get(String(result.proposal_id)) };
}
describe('unit differs from the declared factor unit', () => {
  it('U1: exact served sentence retains one id-bound mixed-authorship proposal', async () => {
    const { result, store, proposal } = await propose([trial, full]);
    expect(result.ok).toBe(true);
    expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(1);
    expect(result.interventions).toEqual([expect.objectContaining({ option: 'Full', factor: 'Duration', value: 20, stated_by: 'olumi_estimate' }), expect.objectContaining({ option: 'Trial', factor: 'Duration', value: 0.3, stated_by: 'user' })]);
    expect(proposal?.operations.map(op => ({ path: op.path, author: (op.value as { authored_by: string }).authored_by }))).toEqual([{ path: 'full::duration', author: 'model_proposed' }, { path: 'trial::duration', author: 'user_stated' }]);
  });
  it('U2 mixed: hours are left out, never demoted, while Full is kept; days resend is the user’s', async () => {
    const { result, proposal } = await propose([hours, full]);
    expect(result.ok).toBe(true);
    expect(result.interventions).toEqual([expect.objectContaining({ option: 'Full', stated_by: 'olumi_estimate' })]);
    expect(proposal?.operations.map(op => op.path)).toEqual(['full::duration']);
    expect(result.unit_differs).toEqual([expect.objectContaining({ option: 'Trial', factor: 'Duration', value: 7.2, declared_unit: 'days', sent_unit: 'hours', detail })]);
    expect(result.detail).toBe(detail);
    expect(result.not_the_users_figure).toBeUndefined();
    const resend = await propose([trial]);
    expect(resend.result.interventions).toEqual([expect.objectContaining({ option: 'Trial', stated_by: 'user' })]);
    expect(resend.proposal?.operations[0]).toMatchObject({ path: 'trial::duration', value: { authored_by: 'user_stated', raw: 0.3, unit: 'days' } });
  });
  it('U2 alone: typed refusal creates no proposal', async () => {
    const { result, store } = await propose([hours]);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'unit_differs_from_declared', detail });
    expect(result.not_the_users_figure).toBeUndefined();
    expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(0);
  });
  it('U3: same, absent and blank units retain every result/proposal byte from base', async () => {
    const controls = [];
    for (const unit of ['days', undefined, '  ']) {
      const { result, proposal } = await propose([{ ...trial, unit }, full]);
      controls.push({ result, proposal });
    }
    const content = JSON.stringify(controls);
    if (process.env.UNIT_CAPTURE_BASE === '1') writeFileSync(fixture, content + '\n');
    expect(content).toBe(readFileSync(fixture, 'utf8').trimEnd());
  });
  it('R2: descriptive, unknown and equivalent units retain every result/proposal byte from base', async () => {
    expect(unitComparisonKey('GBP')).toBe(unitComparisonKey('£'));
    expect(unitComparisonKey('Days')).toBe(unitComparisonKey('days'));
    expect(unitComparisonKey('day')).toBe(unitComparisonKey('days'));
    const controls = [];
    for (const [sentUnit, declaredUnit, value, text] of [
      ['% monthly churn rate', '%', 3, message.replace('0.3 days', '3%').replace('20 days', '20%')],
      ['Days', 'days', 0.3, message],
      ['day', 'days', 0.3, message],
      ['GBP', '£', 30, message.replace('0.3 days', '£30').replace('20 days', '£20')],
      ['unknown duration wording', 'days', 0.3, message],
      ['GBP recurring revenue', 'days', 0.3, message],
      ['% monthly churn rate', 'days', 0.3, message],
      ['percent', '%', 3, message.replace('0.3 days', '3%').replace('20 days', '20%')],
    ] as const) {
      const { result, proposal } = await propose([{ ...trial, value, unit: sentUnit }, { ...full, unit: declaredUnit }], declaredUnit, text);
      expect(result.ok, sentUnit).toBe(true);
      expect(result.unit_differs, sentUnit).toBeUndefined();
      expect(result.interventions, sentUnit).toContainEqual(expect.objectContaining({ option: 'Trial', stated_by: 'user' }));
      controls.push({ result, proposal });
    }
    const content = JSON.stringify(controls);
    const base = new URL('./fixtures/unit-differs-recognised-unit-base.json', import.meta.url);
    if (process.env.UNIT_CAPTURE_R2_BASE === '1') writeFileSync(base, content + '\n');
    expect(content).toBe(readFileSync(base, 'utf8').trimEnd());
  });
  it('R2 recognised: different time scales, money scales and dimensions refuse without a proposal', async () => {
    for (const [sentUnit, declaredUnit] of [['minutes', 'days'], ['£k', '£'], ['%', '£'], ['£/month', '£/year']] as const) {
      const { result, store } = await propose([{ ...trial, unit: sentUnit }], declaredUnit);
      expect(result, sentUnit).toMatchObject({ ok: false, mutated: false, refusal: 'unit_differs_from_declared' });
      expect(result.detail).toBe(`Send Trial's figure exactly as the user wrote it, in ${declaredUnit} (the factor's unit); it was sent in ${sentUnit}. Nothing was changed.`);
      expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(0);
    }
  });
  it('U4: two real hours refusals withhold this tool and carry the limitation', async () => {
    const { caps, store } = real();
    const seen: ModelCallRequest[] = [];
    const model: CallModel = async req => {
      seen.push(structuredClone(req));
      return { output: seen.length <= 2 ? [{ type: 'function_call', name: 'propose_option_interventions', call_id: `c${seen.length}`, arguments: JSON.stringify({ interventions: [hours] }) }]
        : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Please send Trial’s figure in days as written.' }] }] };
    };
    const result = await runAgentTurn({ ctx, history: [], message, instructions: 'i', maxOutputTokens: 200, maxHops: 6 }, caps, model);
    expect(result.tool_calls.map(call => call.refusal)).toEqual(['unit_differs_from_declared', 'unit_differs_from_declared']);
    expect(result.tool_results).toHaveLength(2);
    for (const refusal of result.tool_results) expect(refusal).toMatchObject({ ok: false, mutated: false, refusal: 'unit_differs_from_declared', detail });
    expect(seen[1].tools.some(t => (t as { name: string }).name === 'propose_option_interventions')).toBe(true);
    expect(seen[2].tools.some(t => (t as { name: string }).name === 'propose_option_interventions')).toBe(false);
    expect(JSON.stringify(seen[2].input)).toContain('was refused twice for the same reason');
    expect(JSON.stringify(seen[2].input)).toContain(detail);
    expect(seen[2].input).toContainEqual({ role: 'developer', content: [{ type: 'input_text', text: expect.stringContaining('was refused twice for the same reason (unit_differs_from_declared: ' + detail) }] });
    expect(result.stopped_reason).toBe('answered');
    expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(0);
  });
});
