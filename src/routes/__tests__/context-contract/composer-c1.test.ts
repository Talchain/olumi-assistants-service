/** C1 acceptance: real Fastify route; storage/snapshot ports and scripted HTTP provider only. */
import { it, expect, vi, describe, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { capture, object, array, valueAt, type Obj, type Snapshot } from './provider-harness.js';
import policy from '../../../orchestrator-v5/agent-lane/guidance/reasoning-interventions.json';
import { computeAnalysisAffectingGraphHash } from '../../../orchestrator-v5/context/graph-hash.js';
import { composeReplyShape } from '../../../orchestrator-v5/agent-lane/reply/compose-reply.js';
import { guidanceHistoryOf } from '../../../orchestrator-v5/agent-lane/turn-context/guidance-history.js';

vi.setConfig({ testTimeout: 60_000 });
const row = (id: string) => policy.rows.find(r => r.policy_id === id)!;
const why = row('RC-WIDEN').science_basis.summary;
const message = 'Our churn is 3%. What should we examine next?';
const reply = 'Our churn is 3%.\n\n- Name another risk.\n- Test it with customer evidence.\n\nWhich risk could change your plan?';
const response = (text = reply): Obj => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
type Trigger = 'W6' | 'P4' | 'S1' | 'none';
function snapshot(s: Snapshot, trigger: Trigger): Snapshot {
  // Synthetic canonical-state controls; no derived selector signal or selector double.
  const g = s.graph;
  g.nodes = g.nodes.filter(n => n.kind !== 'risk');
  const own = g.nodes.find(n => n.id === 'raise_price_to_54')!;
  own.proposed_by = 'user'; own.interventions = { monthly_new_pro_subscribers: { value: 0.1, raw_value: 50, source: 'user', unit: 'subscribers/month' } };
  g.nodes.push({ id: 'retain_subscribers', kind: 'option', label: 'Retain subscribers', interventions: {
    pro_subscribers_today: { value: 0.2, raw_value: 400, unit: 'subscribers', source: 'user' },
  } });
  if (trigger !== 'W6') g.nodes.push({ id: 'risk1', kind: 'risk', label: 'Delivery risk' }, { id: 'risk2', kind: 'risk', label: 'Retention risk' });
  for (const n of g.nodes) {
    if (n.observed_state) object(n.observed_state).source = 'user';
    delete n.nonlinear_identity; delete n.temporal_identity; delete n.goal_horizon_months;
  }
  g.edges = g.edges.filter(e => g.nodes.some(n => n.id === e.from) && g.nodes.some(n => n.id === e.to));
  for (const e of g.edges) { e.provenance = { source: 'user', magnitude: 'user_stated' }; delete e.defaulted; e.strength = { mean: 0.5, std: 0.1 }; }
  if (trigger === 'S1') {
    const e = g.edges.find(e => e.from === 'pro_price' && e.to === 'mrr')!;
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }; e.defaulted = true;
  }
  s.analysis_option_participation = [];
  s.analysis_state.leader_claim = { permitted: trigger === 'P4', separation: trigger === 'P4' ? 'separated' : 'overlapping', withheld_reason: null };
  s.analysis_result = { ...(trigger === 'P4' ? { leading_option_id: 'raise_price_to_59' } : {}), enrichment: {}, computed_against_hash: computeAnalysisAffectingGraphHash(g as never) };
  s.graph_hash = String(s.analysis_result.computed_against_hash);
  s.current_read = { analysis_ready: { status: 'ready', may_run: true, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } }, computed_against_hash: s.graph_hash, current_analysis_hash: s.graph_hash };
  return s;
}
const carriers = (w: Awaited<ReturnType<typeof capture>>) => valueAt(w.calls.flatMap(c => c.payloads), 'eligible_intervention');
function assertShape(b: Obj, science = why): void {
  const shape = object(b._answer_shape);
  expect(array(shape.bullets).length).toBeGreaterThan(0);
  for (const bullet of array(shape.bullets)) expect(String(bullet).trim().split(/\s+/).length).toBeLessThanOrEqual(8);
  expect([shape.headline, ...array(shape.bullets)].join(' ').trim().split(/\s+/).length).toBeLessThanOrEqual(80);
  expect(String(b.assistant_text)).toContain('3%');
  // Host-authored native Markdown disclosure; model text cannot replace its body.
  expect(String(b.assistant_text)).toContain(`<details>\n<summary>Why?</summary>\n\n${science}\n\n</details>`);
  expect(String(b.assistant_text)).toContain('Which risk could change your plan?');
}
async function run(trigger: Trigger, opts: Parameters<typeof capture>[2] = {}) {
  return capture('ordinary-converse', 'run2', { readSnapshot: async s => snapshot(s, trigger),
    payload: { message }, providerReply: () => response(), ...opts });
}
it('A1 recorded conversation: one W6 carrier, science verbatim, short actions, user figure, same wire', async () => {
  const w = await run('W6');
  if (process.env.S8_CAPTURE_DIR) {
    mkdirSync(process.env.S8_CAPTURE_DIR, { recursive: true });
    writeFileSync(`${process.env.S8_CAPTURE_DIR}/conversation-A1.json`, JSON.stringify({ request: { kind: 'message', scenario_id: w.seed.scenario_id, agent_session_id: `sess_${w.seed.scenario_id}`, message }, provider: w.calls, reply: w.response }, null, 2));
  }
  expect(carriers(w)).toEqual([{ policy_id: 'RC-WIDEN', variant_id: 'W6', name: row('RC-WIDEN').name, why,
    trigger: row('RC-WIDEN').trigger_predicate.variants![6].when }]);
  assertShape(w.response);
  expect(array(object(w.response._answer_shape).bullets)).toContain(object(object(object(w.response.guidance).slot1).primary_action).label);
  expect(object(object(w.response.guidance).slot1)).toMatchObject({ policy_id: 'RC-WIDEN', variant: 'W6' });
});
it('A2 no trigger: no carrier, no Why?, direct grounded answer', async () => {
  const w = await run('none', { providerReply: () => response('Our churn is 3%.') });
  expect(carriers(w)).toEqual([]);
  expect(w.response.assistant_text).toBe('Our churn is 3%.');
  expect(String(w.response.assistant_text)).not.toContain('Why?');
});
it.each(['complete_stale', 'unknown_degraded'] as const)('A3 %s Run never grants a Run-dependent method; structure may grant W6', async kind => {
  const w = await run('W6', { readSnapshot: async s => {
    const result = snapshot(s, 'W6'); result.analysis_state.run_state.kind = kind; return result;
  } });
  expect(carriers(w)).toHaveLength(1);
  expect(object(carriers(w)[0])).toMatchObject({ policy_id: 'RC-WIDEN', variant_id: 'W6' });
});
it.each(['complete_stale', 'unknown_degraded'] as const)('A3 %s Run cannot license the leader method', async kind => {
  const w = await run('P4', { readSnapshot: async s => {
    const state = snapshot(s, 'P4'); state.analysis_state.run_state.kind = kind; return state;
  } });
  expect(carriers(w)).toEqual([]);
});
it('A3 unreadable graph never grants an intervention', async () => {
  const w = await run('W6', { readSnapshot: async _s => {
    return { graph: null, graph_hash: null };
  } });
  expect(carriers(w)).toEqual([]);
});
it.each([['W6', 'RC-WIDEN', 'W6'], ['P4', 'RC-PREMORTEM', null], ['S1', 'RC-STRENGTHEN-ITEM', 'S1']] as const)(
  'A4 %s: wire reuses exactly one pre-reply selection', async (trigger, id, variant) => {
    let replied = false;
    let installed = false;
    let selections = () => 0;
    const w = await run(trigger, { readSnapshot: async s => {
      // Observe the real selector; no return value or predicate is replaced. The epoch cache may retain the same graph.
      if (!installed) {
        const spy = vi.spyOn(await import('../../../orchestrator-v5/agent-lane/guidance/index.js'), 'selectGuidance');
        selections = () => spy.mock.calls.length; installed = true;
      }
      return snapshot(s, replied ? 'none' : trigger);
    },
      providerReply: () => { replied = true; return response(); } });
    expect(carriers(w)).toHaveLength(1);
    expect(object(carriers(w)[0])).toMatchObject({ policy_id: id, variant_id: variant, why: row(id).science_basis.summary });
    const wire = object(object(w.response.guidance).slot1);
    expect(wire.policy_id).toBe(id); expect(wire.variant ?? null).toBe(variant);
    expect(selections(), 'exactly one selection, before the reply').toBe(1);
    vi.restoreAllMocks();
  });
describe('A6 persistence', () => {
  let first: Awaited<ReturnType<typeof run>>, loaded: Awaited<ReturnType<typeof run>>, saved: Obj, history: Obj;
  beforeAll(async () => {
  const rows = new Map<string, Obj>();
  const storage = {
    readCommittedTurn: vi.fn(async (_sid: string, tid: string) => rows.get(tid) ?? null),
    readGuidanceHistory: vi.fn(async () => guidanceHistoryOf([...rows.values()].reverse().flatMap(r => r.agent_guidance ? [r.agent_guidance] : []))),
    append: vi.fn(async (w: Obj) => { rows.set(String(w.turn_id), { id: `row-${rows.size}`, request_hash: w.request_hash,
      assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
      pending_actions: w.pending_actions ?? [], ...(w.agent_guidance ? { agent_guidance: structuredClone(w.agent_guidance) } : {}) });
      return { id: rows.get(String(w.turn_id))!.id }; }),
  };
  const payload = { message, turn_id: '22222222-2222-4222-8222-222222222222' };
  first = await run('W6', { storage, payload });
  saved = rows.get(payload.turn_id)!;
  loaded = await run('W6', { storage, payload, expectedCalls: 0 });
  history = object(await storage.readGuidanceHistory());
  if (process.env.S8_CAPTURE_DIR) writeFileSync(`${process.env.S8_CAPTURE_DIR}/conversation-A6.json`, JSON.stringify({ shown: first.response, saved, reloaded: loaded.response, reload_provider_calls: loaded.calls.length }, null, 2));
  });
  it('A6-text shown = saved = reloaded', () => {
    assertShape(first.response); expect(saved.assistant_message).toBe(first.response.assistant_text);
    assertShape(loaded.response); expect(loaded.response.assistant_text).toBe(saved.assistant_message);
  });
  it('A6-history committed guidance policy id matches the pre-reply selection and round-trips through readGuidanceHistory', () => {
    const policyId = String(object(carriers(first)[0]).policy_id);
    expect(policyId).toBe('RC-WIDEN');
    const event = object(object(saved.agent_guidance).entries)[policyId];
    expect(event).toMatchObject({ status: 'offered' });
    expect(history[policyId]).toEqual(event);
  });
  it.fails('GAP: the guidance variant and replayed chip are not persisted; the policy id round-trips only through the guidance history (owner: unassigned, candidate Lane 3)', () => {
    expect(object(object(loaded.response.guidance).slot1)).toMatchObject({ policy_id: 'RC-WIDEN', variant: 'W6' });
  });
});

function noRun(s: Snapshot): Snapshot {
  const state = snapshot(s, 'none');
  state.graph.nodes = state.graph.nodes.filter(n => n.id !== 'retain_subscribers' && (n.kind !== 'option' || n.id === 'raise_price_to_54'));
  state.graph.edges = state.graph.edges.filter(e => state.graph.nodes.some(n => n.id === e.from) && state.graph.nodes.some(n => n.id === e.to));
  state.analysis_state = {} as Snapshot['analysis_state'];
  state.analysis_result = {} as Snapshot['analysis_result'];
  return state;
}
it.each([false, true])('R-NOREG no Run W2, no packet=%s: existing post-reply row', async noPacket => {
  const w = await run('none', { readSnapshot: async s => {
    const state = noRun(s);
    if (noPacket) state.graph_hash = null as unknown as string;
    return state;
  } });
  if (process.env.S8_CAPTURE_DIR) writeFileSync(`${process.env.S8_CAPTURE_DIR}/R-NOREG-${noPacket}.json`, JSON.stringify({ guidance: w.response.guidance, carriers: carriers(w) }, null, 2));
  expect(object(object(w.response.guidance).slot1)).toMatchObject({ policy_id: 'RC-WIDEN', variant: 'W2', primary_action: { label: 'Suggest options' } });
  if (noPacket) expect(carriers(w)).toEqual([]);
});
it.each(['run', 'draft'] as const)('Run-turn face %s: carrier appends Why in detail with byte-identical H/W/E/N', faceContract => {
  const input = { text: 'Our churn is 3%.\n\n- Test it with customer evidence.\n\nWhich risk could change your plan?',
    faceContract, profile: 'coaching' as const, widenedLine: 'Two routes were added.',
    chanceCells: [{ kind: 'figure' as const, display: '34%' }], horizonLine: 'The 12-month horizon remains untested.',
    detailLines: ['The comparison needs evidence.'] };
  const normal = composeReplyShape(input);
  const carried = composeReplyShape({ ...input, eligibleIntervention: { policy_id: 'RC-WIDEN', variant_id: 'W6', name: row('RC-WIDEN').name, why, trigger: row('RC-WIDEN').trigger_predicate.variants![6].when }, interventionActionLabel: 'Suggest risks' });
  expect(normal.shape).not.toBeNull();
  expect(carried.shape).toEqual({ ...normal.shape, detail: [normal.shape!.detail, `<details>\n<summary>Why?</summary>\n\n${why}\n\n</details>`].filter(Boolean).join('\n\n') });
  expect(carried.text).toBe(`${normal.text}\n\n<details>\n<summary>Why?</summary>\n\n${why}\n\n</details>`);
});
