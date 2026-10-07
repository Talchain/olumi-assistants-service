import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { heldEventRiskLine, refusedEventRiskLine } from '../stated-event-risk-draft.js';
import { readStatedEventRisk } from '../../routing/stated-event-risk.js';
import type { AnswerShape } from '../../routing/answer-shape.js';

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] };
let saved: Graph = { nodes: [], edges: [] };
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  append: vi.fn(async (w: Rec) => {
    const id = String(w.turn_id);
    rows.set(id, { id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null,
      user_message: w.userMessage ?? null, pending_actions: w.pending_actions ?? [], llm_calls_used: w.llm_calls_used ?? 0 });
    return { id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
// This lane tests construction and reply, with no external storage or analysis calls.
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));
vi.mock('../../handlers/chip-click-dispatch.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  dispatchChipClickRunAnalysis: async () => ({ outcome: 'blocked', commitPerformed: false, graph: null, mayNameLeadingOption: false,
    analysisReady: { status: 'needs_user_input' }, response: { response_version: 2, assistant_text: 'A level is needed.', suggested_actions: [], insights: [], blocks: [] } }),
}));
const PREFIX = "We're deciding between hiring contractors and training in-house. ";
const STATED = 'Our key developer might leave, maybe 10–30% in the next 6 months.';
const NARRATION = 'The shared model is ready to explore.\n- Check the delivery assumptions.\n- Discuss the staffing choices.';
let cause = false;
let extraRisk = false;
let narratorText = NARRATION;
let buildOutput: Rec | undefined;
let activeBrief = '';
let askedToBuild = false;
const link = (from: string, to: string, direction: 'positive' | 'negative') => ({
  from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null,
});
function candidate() {
  return {
    goal: { metric: 'Delivery', operator: '>=', target_stated: false, value: null, unit: null, horizon_months: null,
      provenance: 'inferred', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null },
    constraints: [],
    options: ['Hiring contractors', 'Training in-house'].map((label, i) => ({ label, provenance: 'explicit', is_status_quo: false,
      changes: ['Delivery capacity'], interventions: [{ factor_label: 'Delivery capacity', value: i === 0 ? 0.8 : 0.6,
        value_kind: 'absolute', unit: null, provenance: 'inferred' }] })),
    factors: [{ label: 'Delivery capacity', role: 'controllable', baseline_known: false, baseline_value: null,
      unit: null, provenance: 'inferred', plausible_max: null }],
    risks: [{ label: 'Key developer leaves', provenance: 'explicit' }, ...(extraRisk ? [{ label: 'Supplier fails', provenance: 'explicit' }] : [])], outcomes: [{ label: 'Delivery outcome', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Delivery', 'positive'), link('Key developer leaves', 'Delivery outcome', 'negative'),
      link('Delivery outcome', 'Delivery', 'positive'), ...(cause ? [link('Delivery capacity', 'Key developer leaves', 'positive')] : []),
      ...(extraRisk ? [link('Supplier fails', 'Delivery outcome', 'negative')] : [])],
    identities: [], unknowns: [],
  };
}
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

describe('event-risk disclosure through the served build reply', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error('Unexpected external call');
      const body = JSON.parse(String(init?.body ?? '{}')) as Rec & { text?: { format?: { name?: string; type?: string } }; input?: { type?: string; output?: string }[] };
      if (body.text?.format?.name === 'brief_spans') return new Response(JSON.stringify(say(JSON.stringify({
        goal: 'Delivery', options: ['Hiring contractors', 'Training in-house'], limits: [], build: true,
      }))), { status: 200 });
      if (body.text?.format?.type === 'json_schema') return new Response(JSON.stringify(say(JSON.stringify(candidate()))), { status: 200 });
      if (!askedToBuild && saved.nodes.length === 0) {
        askedToBuild = true;
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'build_model_from_brief',
          call_id: 'build', arguments: JSON.stringify({ brief: activeBrief }) }] }), { status: 200 });
      }
      const output = body.input?.filter((i) => i.type === 'function_call_output').at(-1)?.output;
      if (output !== undefined) buildOutput = JSON.parse(output) as Rec;
      return new Response(JSON.stringify(say(narratorText)), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: saved, graph_hash: saved.nodes.length === 0 ? 'empty' : 'built',
      analysis_state: { run_state: { kind: 'never_run' } } }));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      saved = (req.body as { graph: Graph }).graph;
      return { registered: true, graph_hash: 'built', model_version: { version_number: 1 } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(() => { saved = { nodes: [], edges: [] }; rows.clear(); cause = false; extraRisk = false; narratorText = NARRATION; buildOutput = undefined; askedToBuild = false; });
  async function turn(brief: string) {
    activeBrief = brief;
    const turnId = randomUUID();
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: randomUUID(), turn_id: turnId, message: brief,
    } });
    expect(response.statusCode, response.body.slice(0, 500)).toBe(200);
    const body = response.json() as { assistant_text: string; _answer_shape?: AnswerShape; _agent: { tool_calls: { name: string; ok: boolean }[] } };
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
    expect(rows.get(turnId)?.assistant_message).toBe(body.assistant_text);
    return body;
  }
  const held = () => heldEventRiskLine('Key developer leaves', readStatedEventRisk(STATED)!.event_risk);
  const refused = () => refusedEventRiskLine('Key developer leaves');
  it('ER-2-refused: a cause-link disclosure reaches More detail once without model narration', async () => {
    cause = true;
    const body = await turn(PREFIX + STATED);
    expect(buildOutput?.not_represented).toContain(refused());
    expect(body.assistant_text).toContain(refused());
    expect(body.assistant_text.split(refused())).toHaveLength(2);
    expect(body._answer_shape?.detail).toContain(refused());
    expect(body._answer_shape?.bullets).not.toContain(refused());
  });
  it('ER-2-held: the user likelihood reaches More detail once without model narration', async () => {
    const body = await turn(PREFIX + STATED);
    expect(buildOutput?.not_represented).toContain(held());
    expect(body.assistant_text).toContain(held());
    expect(body.assistant_text.split(held())).toHaveLength(2);
    expect(body._answer_shape?.detail).toContain(held());
    expect(body._answer_shape?.bullets).not.toContain(held());
  });
  it.each(['paragraph', 'bullet'] as const)('ER-2-copy-%s: a verbatim narrator copy is moved to detail once', async (position) => {
    narratorText = position === 'bullet' ? `${NARRATION}\n- ${held()}` : `${NARRATION}\n\n${held()}`;
    const body = await turn(PREFIX + STATED);
    expect(body.assistant_text.split(held())).toHaveLength(2);
    expect(body._answer_shape?.detail).toContain(held());
    expect(body._answer_shape?.bullets).not.toContain(held());
  });
  it('ER-2-multi: each risk has its own disclosure in detail', async () => {
    extraRisk = true;
    const second = 'Our supplier fails, maybe 20% within a month.';
    const secondLine = heldEventRiskLine('Supplier fails', readStatedEventRisk(second)!.event_risk);
    const body = await turn(PREFIX + STATED + ' ' + second);
    for (const line of [held(), secondLine]) {
      expect(body.assistant_text.split(line)).toHaveLength(2);
      expect(body._answer_shape?.detail).toContain(line);
    }
    expect(body._answer_shape?.bullets?.length).toBeLessThanOrEqual(3);
  });
  it('ER-2-control: no likelihood keeps the current reply and shape byte-identical', async () => {
    const body = await turn(PREFIX + 'Our key developer might leave in the next 6 months.');
    expect({ text: body.assistant_text, shape: body._answer_shape }).toMatchSnapshot();
  });
});
