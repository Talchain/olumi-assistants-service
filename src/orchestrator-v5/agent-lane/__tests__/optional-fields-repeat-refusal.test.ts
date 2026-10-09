import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { runAgentTurn, type CallModel, type ModelCallRequest } from '../runtime/agent-loop.js';
import { ProposalStore } from '../proposal.js';

const message = 'Trial takes 0.3 days, my own figure; for Full use your own estimate of 20 days';
const ctx = { scenario_id: '06fc3b51-0000-4000-8000-000000000000', authenticated_user_id: 'user', request_id: 'cut1', user_text: message, user_turn_text: message };
const graph = { nodes: [
  { id: 'goal', kind: 'goal', label: 'Delivery' },
  { id: 'duration', kind: 'factor', label: 'Duration', observed_state: { value: 0.1, cap: 100, unit: 'days' } },
  { id: 'trial', kind: 'option', label: 'Trial' }, { id: 'full', kind: 'option', label: 'Full' },
], edges: ['trial', 'full'].map(from => ({ from, to: 'duration', strength: { mean: 1, std: 0 }, exists_probability: 1 })) };
const entries = [
  { option_label: 'trial', factor_label: 'duration', value: 0.3, user_stated: true, basis: 'my own figure' },
  { option_label: 'full', factor_label: 'duration', value: 20, basis: 'Olumi estimate requested by the user' },
];
function real() {
  const store = new ProposalStore();
  const d: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h0' } });
  return { store, caps: createAgentCapabilities(d, store) };
}
async function proposal(extra: Record<string, unknown>, valid = false) {
  const { store, caps } = real();
  const interventions = valid ? [{ ...entries[0], ...extra }] : entries.map(e => ({ ...e, ...extra }));
  const result = await dispatchTool('propose_option_interventions', JSON.stringify({ interventions }), ctx, caps);
  const p = typeof result.proposal_id === 'string' ? store.get(result.proposal_id) : undefined;
  return { result, p, store };
}
const fixture = new URL('./fixtures/cut1-valid-range-base.json', import.meta.url);
function stable(p: NonNullable<Awaited<ReturnType<typeof proposal>>['p']>) {
  // Proposal identity is content-addressed: compare every serialized byte, including proposal_id.
  return JSON.stringify(p);
}

describe('cut1 real level handler', () => {
  it.each([{ range_meaning: 'likely_range' }, { likely_low: 0, likely_high: 0 }])('R1: stray range %j keeps BOTH id-bound levels and discloses omissions', async extra => {
    const { result, p, store } = await proposal(extra);
    expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(1);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(p?.operations.filter(o => o.op === 'set_option_intervention').map(o => ({ path: o.path, value: o.value }))).toEqual([
      { path: 'full::duration', value: { normalised: 0.2, raw: 20, cap: 100, basis: entries[1].basis, derived_frame: null, unit: 'days', authored_by: 'model_proposed' } },
      { path: 'trial::duration', value: { normalised: 0.003, raw: 0.3, cap: 100, basis: entries[0].basis, derived_frame: null, unit: 'days', authored_by: 'user_stated' } },
    ]);
    expect(result.refusal).toBeUndefined();
    expect(result.detail).toContain('No likely range was recorded');
    expect(result.ranges_not_recorded).toHaveLength(2);
  });
  it('R2: valid range proposal content is byte-identical to the base', async () => {
    const { result, p } = await proposal({ likely_low: 0.1, likely_high: 0.5, range_user_stated: true, range_meaning: 'likely_range' }, true);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(p).toBeDefined();
    const content = stable(p!);
    if (process.env.CUT1_CAPTURE_BASE === '1') writeFileSync(fixture, content + '\n');
    expect(content).toBe(readFileSync(fixture, 'utf8').trimEnd());
    expect(result.detail).toBeUndefined();
  });
  it('R1 control: invalid range cannot confer user authorship on an unwritten level', async () => {
    const { caps, store } = real();
    const r = await caps.proposeOptionInterventions({ ...ctx, user_text: 'Please estimate duration' }, { interventions: [{ ...entries[0], range_meaning: 'likely_range' }] } as never);
    expect(r.ok).toBe(true);
    expect(store.get(String(r.proposal_id))?.operations[0].value).toMatchObject({ authored_by: 'model_proposed' });
  });
});

const tool = 'propose_option_interventions';
const call = (n: number) => ({ type: 'function_call', name: tool, call_id: `c${n}`, arguments: '{"interventions":[]}' });
const say = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'No levels were given; please supply them.' }] }];
async function loop(codes: (string | null)[], stubborn = false) {
  const { caps } = real();
  let dispatches = 0;
  // The refusing double uses the REAL handler's empty_proposal path. Other codes/success are scripted controls.
  const guarded = { ...caps, proposeOptionInterventions: async (...args: Parameters<typeof caps.proposeOptionInterventions>) => {
    const code = codes[dispatches++];
    if (code === 'empty_proposal') return caps.proposeOptionInterventions(...args);
    return code === null ? caps.proposeOptionInterventions(ctx, { interventions: entries }) : { ok: false, mutated: false, refusal: code, detail: `Missing ${code}` };
  } };
  const seen: ModelCallRequest[] = [];
  const model: CallModel = async req => {
    seen.push(structuredClone(req));
    const offered = req.tools.some(t => (t as { name: string }).name === tool);
    return { output: seen.length <= codes.length && (offered || stubborn) ? [call(seen.length)] : say };
  };
  const result = await runAgentTurn({ ctx, history: [], message, instructions: 'i', maxOutputTokens: 200, maxHops: 6 }, guarded, model);
  return { result, seen, dispatches };
}

describe('cut1 turn refusal budget', () => {
  it('R3: four scripted identical refusals dispatch only twice, then narrate with the actual limitation', async () => {
    const { result, seen, dispatches } = await loop(Array(4).fill('empty_proposal'));
    expect(dispatches).toBe(2);
    expect(result.tool_calls).toHaveLength(2);
    expect(result.tool_calls.every(c => c.refusal === 'empty_proposal')).toBe(true);
    expect(seen[1].tools.some(t => (t as { name: string }).name === tool)).toBe(true);
    expect(seen[2].tools.some(t => (t as { name: string }).name === tool)).toBe(false);
    expect(seen[2].reasoning_role).toBeUndefined();
    expect(JSON.stringify(seen[2].input)).toContain('was refused twice for the same reason');
    expect(JSON.stringify(seen[2].input)).toContain('No interventions were given.');
    expect(result.stopped_reason).toBe('answered');
  });
  it('R3 defensive dispatch: naming a withheld tool cannot reach its handler', async () => {
    const { result, dispatches } = await loop(Array(4).fill('empty_proposal'), true);
    expect(dispatches).toBe(2);
    expect(result.tool_calls.filter(c => c.refusal === 'empty_proposal')).toHaveLength(2);
  });
  it('R6: a different successful tool after the stop keeps normal effort and the limitation on every hop', async () => {
    const { caps } = real();
    const seen: ModelCallRequest[] = [];
    const model: CallModel = async req => {
      seen.push(structuredClone(req));
      if (seen.length <= 2) return { output: [call(seen.length)] };
      if (seen.length === 3) return { output: [{ type: 'function_call', name: 'get_canonical_state', call_id: 'other', arguments: '{"reason":"Continue with a different tool"}' }] };
      return { output: say };
    };
    const result = await runAgentTurn({ ctx, history: [], message, instructions: 'i', maxOutputTokens: 200, maxHops: 6 }, caps, model);
    expect(result.tool_calls.map(c => c.name)).toEqual([tool, tool, 'get_canonical_state']);
    expect(result.tool_calls[2].ok).toBe(true);
    expect(result.tool_results[2]).toMatchObject({ ok: true });
    for (const req of seen.slice(2)) {
      expect(req.reasoning_role).toBeUndefined();
      expect(req.tools.some(t => (t as { name: string }).name === tool)).toBe(false);
      expect(JSON.stringify(req.input)).toContain('was refused twice for the same reason');
      expect(JSON.stringify(req.input)).toContain('No interventions were given.');
    }
    expect(seen).toHaveLength(4);
    expect(result.stopped_reason).toBe('answered');
  });
  it('R4: different codes do not withhold', async () => {
    const { result, seen, dispatches } = await loop(['empty_proposal', 'not_found']);
    expect(dispatches).toBe(2);
    expect(seen[2].tools.some(t => (t as { name: string }).name === tool)).toBe(true);
    expect(result.tool_calls.map(c => c.refusal)).toEqual(['empty_proposal', 'not_found']);
  });
  it('R5: first refusal permits corrected success', async () => {
    const { result, seen, dispatches } = await loop(['empty_proposal', null]);
    expect(dispatches).toBe(2);
    expect(result.tool_calls[1].ok).toBe(true);
    expect(result.tool_results[1]).toMatchObject({ ok: true, proposal_id: expect.any(String) });
    expect(seen[1].tools.some(t => (t as { name: string }).name === tool)).toBe(true);
  });
});

describe('served-tool optional gap omissions', () => {
  it.each(['propose_option_interventions', 'propose_starting_point'])('C4: %s leaves out an invalid optional gap, retaining levels', async tool => {
    const { caps, store } = real();
    const levels = entries.map(entry => ({ ...entry, unmodelled_mechanisms: 'invented shape' }));
    const r = await dispatchTool(tool, JSON.stringify(tool === 'propose_starting_point' ? { assumptions: [], option_levels: levels } : { interventions: levels }), ctx, caps);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.detail).toContain('unmodelled_mechanisms');
    expect(store.get(String(r.proposal_id))?.operations.filter(o => o.op === 'set_option_intervention')).toHaveLength(2);
  });
});

describe('joined starting-point disclosures', () => {
  it('C14: both successful halves preserve omitted level-range details on the ONE joined result', async () => {
    const joinedGraph = { ...graph, nodes: [...graph.nodes, { id: 'baseline', kind: 'factor', label: 'Additional baseline' }],
      edges: graph.edges.map(edge => ({ ...edge, effect_direction: 'positive' })) };
    const d: InternalDispatch = async () => ({ status: 200, json: { graph: joinedGraph, graph_hash: 'h0' } });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(d, store);
    const r = await dispatchTool('propose_starting_point', JSON.stringify({
      assumptions: [{ factor_label: 'Additional baseline', value: 0.4, unit: 'days', basis: 'Starting estimate' }],
      option_levels: entries.map(entry => ({ ...entry, range_meaning: 'likely_range' })),
    }), ctx, caps);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.detail).toContain('No likely range was recorded');
    expect(r.ranges_not_recorded).toHaveLength(2);
    expect(r.assumptions_refused, JSON.stringify(r)).toBeUndefined();
    expect(store.outstanding(ctx.scenario_id, ctx.authenticated_user_id)).toHaveLength(1);
    expect(store.get(String(r.proposal_id))?.operations.map(op => op.op)).toEqual(['set_factor_value', 'set_option_intervention', 'set_option_intervention']);
  });
});
