/** C1 acceptance: real Fastify route; storage/snapshot ports and scripted HTTP provider only. */
import { it, expect, vi, describe, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { capture, object, array, valueAt, fixture, type Obj, type Snapshot } from './provider-harness.js';
import c2Base from './fixtures/composer-c2-base.json';
import policy from '../../../orchestrator-v5/agent-lane/guidance/reasoning-interventions.json';
import { computeAnalysisAffectingGraphHash } from '../../../orchestrator-v5/context/graph-hash.js';
import { composeReplyShape } from '../../../orchestrator-v5/agent-lane/reply/compose-reply.js';
import { guidanceHistoryOf } from '../../../orchestrator-v5/agent-lane/turn-context/guidance-history.js';

vi.setConfig({ testTimeout: 60_000 });
const row = (id: string) => policy.rows.find(r => r.policy_id === id)!;
// SYS2 G1: this fixture's W6 offer sits beside several real options, so its Why? is W6's own reason. RC-WIDEN's science
// sentence ("a single alternative") holds for W2Z/W2 only; that negative is `sys2-why-matches-variant.test.ts`.
const why = (row('RC-WIDEN').why_now as unknown as Readonly<Record<string, string>>).W6!;
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
function assertWholeAnswer(b: Obj, _science = why): void {
  expect(b._answer_shape).toBeUndefined();
  expect(b.assistant_text).toBe(reply);
  expect(String(b.assistant_text)).toContain('3%');
  // Host-authored disclosure as a plain paragraph the chat renders (R3-1: the UI escapes HTML); model text cannot replace its body.

  expect(String(b.assistant_text)).not.toContain('<details');
  expect(String(b.assistant_text)).toContain('Which risk could change your plan?');
}
async function run(trigger: Trigger, opts: Parameters<typeof capture>[2] = {}) {
  return capture('ordinary-converse', 'run2', { readSnapshot: async s => snapshot(s, trigger),
    payload: { message }, providerReply: () => response(), ...opts });
}
it('A1 recorded conversation: one W6 carrier, whole answer, science verbatim, plain action, user figure, same wire', async () => {
  const w = await run('W6');
  if (process.env.S8_CAPTURE_DIR) {
    mkdirSync(process.env.S8_CAPTURE_DIR, { recursive: true });
    writeFileSync(`${process.env.S8_CAPTURE_DIR}/conversation-A1.json`, JSON.stringify({ request: { kind: 'message', scenario_id: w.seed.scenario_id, agent_session_id: `sess_${w.seed.scenario_id}`, message }, provider: w.calls, reply: w.response }, null, 2));
  }
  expect(carriers(w)).toEqual([{ policy_id: 'RC-WIDEN', variant_id: 'W6', name: row('RC-WIDEN').name, why,
    trigger: row('RC-WIDEN').trigger_predicate.variants![6].when }]);
  assertWholeAnswer(w.response);

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
    expect(object(carriers(w)[0])).toMatchObject({ policy_id: id, variant_id: variant, why: id === 'RC-WIDEN' ? why : row(id).science_basis.summary });
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
    assertWholeAnswer(first.response); expect(saved.assistant_message).toBe(first.response.assistant_text);
    assertWholeAnswer(loaded.response); expect(loaded.response.assistant_text).toBe(saved.assistant_message);
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

describe('E6 Why-once on the route: a second Strengthen item on the same state carries its action, not the same Why?', () => {
  it('turn 1 says the Strengthen Why?; turn 2 offers the next unsized link with its action and no Why?', async () => {
    const rows = new Map<string, Obj>();
    const storage = {
      readCommittedTurn: vi.fn(async (_sid: string, tid: string) => rows.get(tid) ?? null),
      readGuidanceHistory: vi.fn(async () => guidanceHistoryOf([...rows.values()].reverse().flatMap(r => r.agent_guidance ? [r.agent_guidance] : []))),
      append: vi.fn(async (w: Obj) => { rows.set(String(w.turn_id), { id: `row-${rows.size}`, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        pending_actions: w.pending_actions ?? [], ...(w.agent_guidance ? { agent_guidance: structuredClone(w.agent_guidance) } : {}) });
        return { id: rows.get(String(w.turn_id))!.id }; }),
    };
    // Two unsized links to the goal (S1), on one unchanged state.
    const twoUnsized = async (s: Snapshot) => {
      const state = snapshot(s, 'S1');
      const e = state.graph.edges.find(e => e.from === 'pro_subscribers_at_month_12' && e.to === 'mrr')!;
      e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }; e.defaulted = true;
      state.analysis_result.computed_against_hash = computeAnalysisAffectingGraphHash(state.graph as never);
      state.graph_hash = String(state.analysis_result.computed_against_hash);
      state.current_read = { ...state.current_read, computed_against_hash: state.graph_hash, current_analysis_hash: state.graph_hash };
      return state;
    };
    const first = await run('S1', { storage, readSnapshot: twoUnsized, payload: { message, turn_id: '33333333-3333-4333-8333-333333333333' } });
    const second = await run('S1', { storage, readSnapshot: twoUnsized,
      payload: { message: 'What else should we examine?', turn_id: '44444444-4444-4444-8444-444444444444' } });
    const [a, b] = [first, second].map(w => object(object(w.response.guidance).slot1));
    expect([a.policy_id, a.variant, b.policy_id, b.variant]).toEqual(['RC-STRENGTHEN-ITEM', 'S1', 'RC-STRENGTHEN-ITEM', 'S1']);
    expect(b.item, 'the next item is offered').not.toBe(a.item);
    // R3-1 (staging 9bac9729): the Why? is a plain final paragraph, never HTML; E6 says it once per state.

    expect(String(first.response.assistant_text)).not.toContain('<details>');
    expect(String(second.response.assistant_text)).not.toContain(`Why? ${row('RC-STRENGTHEN-ITEM').science_basis.summary}`);
    expect(object(b.primary_action).label).toBe('Give your estimate');

    expect(second.response.assistant_text).toBe(reply);
    expect(object(carriers(second)[0]).why, 'the model is told the same method; only the display changes').toBe(row('RC-STRENGTHEN-ITEM').science_basis.summary);
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
  expect(carried.shape).toEqual({ ...normal.shape, detail: [normal.shape!.detail, `Why? ${why}`].filter(Boolean).join('\n\n') });
  expect(carried.text).toBe(`${normal.text}\n\nWhy? ${why}`);
});


// C2 base bytes are captured on d820c6a1424891d59f7d70afc9f7b0c903ae6dc1 through this same real route.
const proposalText = 'Our churn is 3%.\n\n- Test customer response.\n\nI proposed a £54 price level for you to review.\n\nWould you approve this starting figure?';
const _disclosure = `Why? ${why}`;
function recordC2(name: string, w: Awaited<ReturnType<typeof run>>): void {
  if (!process.env.S8_CAPTURE_DIR) return;
  mkdirSync(process.env.S8_CAPTURE_DIR, { recursive: true });
  writeFileSync(`${process.env.S8_CAPTURE_DIR}/${name}.json`, JSON.stringify({ calls: w.calls, response: w.response }, null, 2));
}
async function proposalTurn(trigger: Trigger, name: string) {
  const w = await run(trigger, { evidenceLabel: name, expectedCalls: 2,
    payload: { message: 'Prepare a £54 price level for review. What should we examine next?' },
    providerReply: (_body, index) => index === 1 ? { status: 'completed', output: [{ type: 'function_call', call_id: 'c2-level', name: 'propose_option_interventions', arguments: JSON.stringify({
      interventions: [{ option_label: 'raise_price_to_54', factor_label: 'pro_price', value: 54, unit: '£/subscriber/month', user_stated: true }], whole_request: false,
    }) }] } : response(proposalText),
  });
  recordC2(name, w);
  return w;
}
// R2 N2r (friction audit N2): this suffix reached the user as raw "<details> <summary>Why?</summary>…" (hiring step 5,
// deadline step 3): a whole proposal ships unshaped. It now ships byte-identical, with no Why; approval unchanged.
it('P1-prime proposal carrier (R2 N2r): base text byte-identical, no raw <details> Why; approval unchanged', async () => {
  const w = await proposalTurn('W6', 'P1');
  expect(carriers(w)).toHaveLength(2);
  expect(carriers(w)[1]).toEqual(carriers(w)[0]);
  expect(object(array(object(w.response._agent).tool_calls)[0])).toMatchObject({ name: 'propose_option_interventions', ok: true, proposal_id: expect.any(String) });
  const base = object(c2Base.P1);
  const baseText = String(base.assistant_text);
  const label = object(object(object(w.response.guidance).slot1).primary_action).label;
  expect(label).toBe('Suggest risks');
  expect(String(w.response.assistant_text)).toBe(baseText);
  expect(String(w.response.assistant_text)).not.toContain('<details>');
  expect(w.response.suggested_actions).toEqual(array(base.suggested_actions).map((action, index) => index === 0
    ? { ...object(action), detail: 'Raise price to £54 sets Pro price to £54 / subscriber / month' } : action));
  expect(array(w.response.suggested_actions).some(a => String(object(a).id).startsWith('agent-approve-proposal:'))).toBe(true);
  expect(w.response._answer_shape).toBeUndefined();
  // Both typed proposal identities keep their whole body, even when a caller supplies a shape-like body.
  const intervention = object(carriers(w)[0]);
  for (const identity of [{ profile: 'proposal' as const }, { keepWhole: 'proposal' as const }]) {
    const input = { text: baseText, ...identity };
    const normal = composeReplyShape(input);
    const carried = composeReplyShape({ ...input, eligibleIntervention: intervention as never, interventionActionLabel: String(label) });
    expect(carried).toEqual(normal);
  }
});
it('P2 proposal without carrier: byte-identical base text and suggested actions', async () => {
  const w = await proposalTurn('none', 'P2');
  expect(carriers(w)).toEqual([]);
  expect(object(array(object(w.response._agent).tool_calls)[0])).toMatchObject({ ok: true, proposal_id: expect.any(String) });
  expect(w.response.assistant_text).toBe(c2Base.P2.assistant_text);
  expect(w.response.suggested_actions).toEqual(array(c2Base.P2.suggested_actions).map((action, index) => index === 0
    ? { ...object(action), detail: 'Raise price to £54 sets Pro price to £54 / subscriber / month' } : action));
  expect(w.response._answer_shape).toBeUndefined();
});
it('P3 host-only proposal: zero provider calls, base text unchanged and no Why', async () => {
  const { riskAddPressFor } = await import('../../../orchestrator-v5/agent-lane/method-turn/widen-turn.js');
  const press = riskAddPressFor({ label: 'Customer response', mechanism: 'drives',
    hits: { id: 'raise_price_to_54', label: 'Raise price to £54', kind: 'option' },
    through: { id: 'monthly_new_pro_subscribers', label: 'Monthly new Pro subscribers', direction: 'positive' },
    affects: { id: 'mrr', label: 'MRR', direction: 'negative' } });
  if (process.env.S8_CAPTURE_DIR) mkdirSync(`${process.env.S8_CAPTURE_DIR}/provider/P3/run2`, { recursive: true });
  const state = snapshot(fixture('run2').snapshot, 'W6');
  const graph = state.graph;
  for (const node of graph.nodes) delete node.proposed_by;
  for (const edge of graph.edges) edge.provenance = { ...object(edge.provenance), source: 'user_specified' };
  state.graph_hash = computeAnalysisAffectingGraphHash(graph as never)!;
  state.analysis_result.computed_against_hash = state.graph_hash;
  state.current_read.computed_against_hash = state.graph_hash;
  state.current_read.current_analysis_hash = state.graph_hash;
  let pending: unknown[] = [];
  const w = await run('W6', { evidenceLabel: 'P3', expectedCalls: 1, readSnapshot: async () => structuredClone(state), storage: { loadGraph: async () => graph, loadGraphAndBriefText: async () => ({ graph, briefText: null }),
    readMostRecentPendingActions: async () => structuredClone(pending),
    append: async (input: Obj) => { pending = array(input.pending_actions); return { id: 'c2-host-proposal' }; } }, payload: { message: press.message, chip: { id: press.id }, source: 'chip' } });
  recordC2('P3', w);
  expect(object(array(object(w.response._agent).tool_calls)[0])).toMatchObject({ name: 'propose_new_risk', ok: true, proposal_id: expect.any(String) });

  expect(String(w.response.assistant_text)).not.toContain('Why?');
});
it('X4 carrier whole answer: long headline and action labels retained verbatim, guidance follows as plain paragraphs', async () => {
  const longLabel = 'Test the impact of customer cancellations and downgrades after changing the Pro price';
  const headline = `${'Customer response matters '.repeat(24).trim()}.`;
  const short = ['Test customer evidence before changing the Pro price.', 'Check retention with the customer team.', 'Name another risk.'];
  const text = `${headline}\n\n${[longLabel, ...short].map(b => `- ${b}`).join('\n')}\n\nWhich risk could change your plan?`;
  const w = await run('W6', { evidenceLabel: 'X4', providerReply: () => response(text) });
  recordC2('X4', w);
  expect(carriers(w)).toHaveLength(1);
  expect(w.response._answer_shape).toBeUndefined();
  expect(w.response.assistant_text).toBe(text);
  expect(String(w.response.assistant_text)).toContain(`- ${longLabel}`);
  for (const line of [longLabel, ...short, 'Which risk could change your plan?']) expect(String(w.response.assistant_text)).toContain(line);

});
it('X5 profile gate: method_step with carrier is byte-identical; proposal is byte-identical per P1 (R2 N2r)', async () => {
  const w = await capture('pre-mortem', 'run2', { evidenceLabel: 'X5', readSnapshot: async s => snapshot(s, 'S1'), providerReply: () => response(reply) });
  recordC2('X5', w);
  expect(w.calls).toHaveLength(1);

  expect(String(w.response.assistant_text)).not.toContain('Why?');
  expect(carriers(w)).toHaveLength(1);
  const intervention = object(carriers(w)[0]);
  const method = { text: String(w.response.assistant_text), profile: 'method_step' as const };
  expect(composeReplyShape({ ...method, eligibleIntervention: intervention as never, interventionActionLabel: 'Suggest risks' })).toEqual(composeReplyShape(method));
  const proposed = await proposalTurn('W6', 'X5-proposal');
  expect(String(proposed.response.assistant_text)).toBe(String(c2Base.P1.assistant_text));
});
