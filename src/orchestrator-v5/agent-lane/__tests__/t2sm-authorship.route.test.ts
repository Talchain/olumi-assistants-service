import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { HistoryStore } from '../history-store.js';
import { ProposalStore } from '../proposal.js';

// Real agent route, tool dispatch, proposal/approval and canonical link writer.
// Only LLM responses and durable storage/transport are doubled; no authored stamp is manufactured.
type Rec = Record<string, any>;
const rows = new Map<string, Rec>();
const pending = new Map<string, unknown[]>();
const store = {
  ensureScenarioExists: async () => ({ user_id: null }),
  readCommittedTurn: async (_sid: string, tid: string) => rows.get(tid) ?? null,
  readRecent: async (sid: string) => [...rows.values()].filter(r => r.scenario_id === sid).reverse(),
  readFactsFor: async () => [],
  readAnalysisInvalidatedAt: async () => null,
  readMostRecentPendingActions: async (sid: string) => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return (pending.get(sid) ?? []).map(parsePendingAction).filter(x => x !== null);
  },
  append: async (w: Rec) => {
    if (!rows.has(w.turn_id)) {
      rows.set(w.turn_id, { ...w, id: `row-${rows.size}`, user_message: w.userMessage ?? null,
        assistant_message: w.assistantMessage ?? null });
      if (!w.turn_id.endsWith(':claim')) pending.set(w.scenario_id, structuredClone(w.pending_actions ?? []));
    }
    return { id: rows.get(w.turn_id)!.id };
  },
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let graph = buildD1Fixture();
let brief = '';
let sid = '';
let script: Rec[] = [];
let toolOutputs: Rec[] = [];
let writes = 0;
let completeSource = false;
const say = { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Review the proposed change.' }] }] };
const linkArgs = { from_label: 'Price', to_label: 'MRR', strength: 'weak', rationale: 'Record the stated band.' };
const assumptionArgs = (user_stated: boolean, basis = 'A new planning estimate.') => ({
  assumptions: [{ factor_label: 'Price', value: 17, unit: 'GBP', user_stated, basis }],
});
function queue(name: string, args: unknown) {
  script.push({ output: [{ type: 'function_call', name, call_id: randomUUID(), arguments: JSON.stringify(args) }] });
}

describe('T2sm authorship at the real agent route', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const readAuthorship = HistoryStore.prototype.authorshipWords;
    vi.spyOn(HistoryStore.prototype, 'authorshipWords').mockImplementation(function (this: HistoryStore, sessionId: string) {
      const words = readAuthorship.call(this, sessionId);
      // Fixture only: T1 owns fresh-session completeness. Preserve all actual evidence.
      return completeSource ? { ...words, complete: true } : words;
    });
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Rec;
      for (const item of body.input ?? []) {
        if (item.type === 'function_call_output') toolOutputs.push(JSON.parse(item.output));
      }
      return new Response(JSON.stringify(JSON.stringify(body.tools ?? []).includes('propose_link_strength') ? script.shift() ?? say : say), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { applyEdgeStrengthEdit } = await import('../../system-events/edge-strength-edit.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: computeAnalysisAffectingGraphHash(graph), brief_text: brief }));
    app.post('/orchestrate/v2/turn', async req => {
      const payload = req.body as Parameters<typeof applyEdgeStrengthEdit>[0]['payload'];
      const result = await applyEdgeStrengthEdit({ payload, event: (req.body as Rec).event,
        requestId: 't2sm-writer', persistedGraph: graph });
      expect(result.kind).toBe('mutated');
      if (result.kind === 'mutated') { graph = result.mutatedGraph as typeof graph; writes += 1; }
      return { assistant_text: 'Recorded.', graph, graph_hash: computeAnalysisAffectingGraphHash(graph) };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  beforeEach(() => {
    graph = buildD1Fixture();
    graph.nodes.find(n => n.id === 'f-budget')!.label = 'Price';
    graph.nodes.find(n => n.id === 'g-revenue')!.label = 'MRR';
    const price = graph.nodes.find(n => n.id === 'f-budget')!;
    delete price.observed_state;
    graph.edges.find(e => e.from === 'f-budget' && e.to === 'g-revenue')!.strength = { mean: 0.5, std: 0.1 };
    completeSource = false; brief = ''; sid = randomUUID(); script = []; toolOutputs = []; writes = 0;
  });
  async function turn(message: string, extra: Rec = {}) {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: sid, turn_id: randomUUID(), message, source: 'composer', ...extra,
    } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Rec;
  }
  function lastResult() { return toolOutputs.at(-1)!; }

  it.each([true, false])('row (a): earlier verified weak band survives user_stated=%s, approval and readback', async user_stated => {
    await turn('Price has a weak effect on MRR.');
    queue('propose_link_strength', { ...linkArgs, user_stated });
    const offered = await turn('Please record that link strength.');
    const call = offered._agent.tool_calls.find((c: Rec) => c.name === 'propose_link_strength');
    expect(call?.ok).toBe(true);
    expect(writes).toBe(0);
    const card = offered.suggested_actions.find((c: Rec) => c.id === `agent-approve-proposal:${call.proposal_id}`);
    expect(typeof card?.message).toBe('string');
    const saved = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(saved._agent.tool_calls.map((c: Rec) => ({ name: c.name, ok: c.ok }))).toEqual([{ name: 'authorise_change', ok: true }]);
    expect(writes).toBe(1);
    const read = (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${sid}/graph`, payload: {} })).json();
    const edge = read.graph.edges.find((e: Rec) => e.from === 'f-budget' && e.to === 'g-revenue');
    expect(edge.strength.mean).toBe(0.1);
    expect(edge.provenance.source).toBe('user_specified');
    expect(provenanceOf({ link: edge }).origin).toBe('human');
  });

  it('T2sm3 (b): a claimed-human band for another link is refused', async () => {
    await turn('Price has a weak effect on MRR.');
    queue('propose_link_strength', { ...linkArgs, from_label: 'Product quality', user_stated: true });
    await turn('Prepare the other link for review.');
    expect(lastResult().refusal).toBe('strength_not_stated');
    expect(writes).toBe(0);
  });

  it.each([undefined, false])('T2sm3 (b): another link without its own basis prepares no number with user_stated=%s', async user_stated => {
    await turn('Price has a weak effect on MRR.');
    const before = structuredClone(graph);
    queue('propose_link_strength', { ...linkArgs, from_label: 'Product quality', user_stated });
    const offered = await turn('Prepare the other link for review.');
    expect(lastResult().ok).toBe(false);
    expect(lastResult().refusal).toBe('strength_not_stated');
    expect(offered.suggested_actions.filter((c: Rec) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(graph).toEqual(before);
    expect(writes).toBe(0);
  });

  it('T2sm3 (b): a declared estimate for another link stays AI through approval/readback', async () => {
    await turn('Price has a weak effect on MRR.');
    queue('propose_link_strength', { ...linkArgs, from_label: 'Product quality', user_stated: false,
      basis: 'A new estimate: product quality is a secondary driver in this model.' });
    const offered = await turn('Prepare the other link for review.');
    expect(lastResult().input_claim.origin).toBe('ai');
    const card = offered.suggested_actions.find((c: Rec) => c.id === `agent-approve-proposal:${lastResult().proposal_id}`);
    const saved = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(saved._agent.tool_calls.map((c: Rec) => ({ name: c.name, ok: c.ok }))).toEqual([{ name: 'authorise_change', ok: true }]);
    const read = (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${sid}/graph`, payload: {} })).json();
    const edge = read.graph.edges.find((e: Rec) => e.from === 'f-quality' && e.to === 'g-revenue');
    expect(edge.strength.mean).toBe(0.1);
    expect(edge.provenance.source).toBe('cee_hypothesis');
    expect(provenanceOf({ link: edge }).origin).toBe('ai');
    expect(writes).toBe(1);
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(writes).toBe(1);
  });

  it.each(['absent', 'assistant', 'unverified'])('row (b) negative: %s band is never saved as human or AI', async where => {
    if (where === 'assistant') script.push({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Price has a weak effect on MRR.' }] }] });
    if (where === 'unverified') brief = 'Price has a weak effect on MRR.';
    await turn('Consider the price effect.');
    queue('propose_link_strength', { ...linkArgs, user_stated: false, rationale: '' });
    await turn('Please record that link strength.');
    expect(lastResult().refusal).toBe('strength_not_stated');
    expect(writes).toBe(0);
  });

  it.each([undefined, '', ' '])('a new plural link estimate with basis=%s is refused whole', async basis => {
    await turn('Consider the price effect.');
    queue('propose_link_strengths', { links: [{ ...linkArgs, user_stated: false, basis }], rationale: 'Prepare estimates.' });
    await turn('Prepare estimates for review.');
    expect(lastResult().ok).toBe(false);
    expect(lastResult().refusal).toBe('origin_unknown');
    expect(writes).toBe(0);
  });

  it('unverified link material is unknown even with false and a nonempty basis', async () => {
    completeSource = true;
    brief = 'Price has a weak effect on MRR.';
    await turn('Consider the supplied material.');
    queue('propose_link_strength', { ...linkArgs, user_stated: false, basis: 'Use the supplied band.' });
    await turn('Prepare that band for review.');
    expect(lastResult().refusal).toBe('strength_not_stated');
    expect(writes).toBe(0);
  });

  it('row (c): complete live history, unmatched claimed-human figure stays unknown', async () => {
    completeSource = true;
    await turn('Consider the assumptions.');
    queue('propose_assumptions', assumptionArgs(true));
    await turn('Prepare the proposed assumption.');
    expect(lastResult().refusal).toBe('origin_unknown');
    expect(writes).toBe(0);
  });

  it('unverified material remains unknown even with an explicit estimate declaration', async () => {
    completeSource = true;
    brief = 'Price is £17.';
    await turn('Consider the assumptions.');
    queue('propose_assumptions', assumptionArgs(false));
    await turn('Prepare the proposed assumption.');
    expect(lastResult().refusal).toBe('origin_unknown');
    expect(writes).toBe(0);
  });

  it('row (e): complete session with unreadable source material never attributes the unmatched figure to Olumi', async () => {
    completeSource = true;
    brief = 'The pricing figure was supplied in material whose contents could not be verified.';
    await turn('Consider the supplied material.');
    queue('propose_assumptions', assumptionArgs(true, 'From the supplied material; source could not be verified.'));
    await turn('Prepare the proposed assumption.');
    expect(lastResult().refusal).toBe('origin_unknown');
    expect(writes).toBe(0);
  });

  it('row (b) positive: an absent band declared as a new AI estimate with its basis can be offered', async () => {
    await turn('Consider the price effect.');
    queue('propose_link_strength', { ...linkArgs, user_stated: false, basis: 'Price is a secondary driver in this scenario.', rationale: 'A new Olumi estimate.' });
    const offered = await turn('Prepare an estimate for review.');
    expect(lastResult().ok).toBe(true);
    expect(lastResult().input_claim?.origin).toBe('ai');
    expect(writes).toBe(0);
    const card = offered.suggested_actions.find((c: Rec) => c.id === `agent-approve-proposal:${lastResult().proposal_id}`);
    const saved = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(saved._agent.tool_calls.map((c: Rec) => ({ name: c.name, ok: c.ok }))).toEqual([{ name: 'authorise_change', ok: true }]);
    expect(writes).toBe(1);
    const read = (await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${sid}/graph`, payload: {} })).json();
    const edge = read.graph.edges.find((e: Rec) => e.from === 'f-budget' && e.to === 'g-revenue');
    expect(edge.strength.mean).toBe(0.1);
    expect(edge.provenance.source).toBe('cee_hypothesis');
    expect(edge.provenance.input_claim).toEqual({ origin: 'ai', basis: 'Price is a secondary driver in this scenario.', source_quote: '', subject: { from: 'Price', to: 'MRR' } });
    expect(provenanceOf({ link: edge }).origin).toBe('ai');
  });

  it('a new estimate without a basis stays unknown', async () => {
    completeSource = true;
    await turn('Consider the assumptions.');
    queue('propose_assumptions', assumptionArgs(false, ' '));
    await turn('Prepare the proposed assumption.');
    expect(lastResult().refusal).toBe('origin_unknown');
    expect(writes).toBe(0);
  });

  it('T2sm3: an unrelated unverified amount cannot veto a declared own estimate', async () => {
    brief = 'MRR is £17.';
    await turn('Consider the price assumptions.');
    queue('propose_assumptions', assumptionArgs(false));
    await turn('Prepare a new price estimate for review.');
    expect(lastResult().ok).toBe(true);
    expect(lastResult().assumptions).toEqual([{ factor: 'Price', value: 17, unit: 'GBP', basis: 'A new planning estimate.' }]);
  });

  it('a genuinely new declared assumption with a basis still has AI authorship', async () => {
    await turn('Consider the assumptions.');
    queue('propose_assumptions', assumptionArgs(false));
    await turn('Prepare the proposed assumption.');
    expect(lastResult().ok).toBe(true);
    expect(lastResult().assumptions).toEqual([{ factor: 'Price', value: 17, unit: 'GBP', basis: 'A new planning estimate.' }]);
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph, graph_hash: 'h' } }), proposals);
    const result = await caps.proposeAssumptions!({ scenario_id: sid, authenticated_user_id: null, request_id: 'r',
      user_text: 'Consider the assumptions.', user_text_complete: true }, assumptionArgs(false));
    expect(proposals.get(String(result.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect(writes).toBe(0);
  });

  it('a declared replacement estimate with a basis stays AI-authored', async () => {
    graph.nodes.find(n => n.id === 'f-budget')!.observed_state = { value: 0.2, raw_value: 20, cap: 100, unit: 'GBP', source: 'cee_inference' };
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph, graph_hash: 'h' } }), proposals);
    const args = assumptionArgs(false);
    const result = await caps.proposeAssumptions!({ scenario_id: sid, authenticated_user_id: null, request_id: 'r',
      user_text: 'Consider a replacement estimate.', user_text_complete: true },
    { assumptions: args.assumptions.map(a => ({ ...a, revise: true })) });
    expect(result.ok).toBe(true);
    expect(proposals.get(String(result.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect((proposals.get(String(result.proposal_id))?.operations[0]?.value as Rec).authored_by).toBe('model_proposed');
  });

  it('row (d): absent completeness and a claimed-human miss are unknown at the capability boundary', async () => {
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph, graph_hash: 'h' } }), new ProposalStore());
    const result = await caps.proposeAssumptions!({ scenario_id: sid, authenticated_user_id: null, request_id: 'r',
      user_text: 'Consider the assumptions.', user_turn_text: 'Prepare the proposed assumption.' }, assumptionArgs(true));
    expect(result.refusal).toBe('origin_unknown');
  });
});
