import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ProposalStore } from '../proposal.js';

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/s5-hiring-rename-e2e-c1e944a4.json', import.meta.url), 'utf8')) as Rec;
const SCENARIO = 'e9e63843-b4c9-4354-a976-1fb43a8a7303';
const modelOutputs: unknown[][] = [];
const provider = vi.fn(async () => new Response(JSON.stringify({ output: modelOutputs.shift() ?? [
  { type: 'message', content: [{ type: 'output_text', text: 'The rename is proposed for your approval.' }] },
] }), { status: 200 }));

describe('L20: board levels never author replacement names; declared renames keep their approval path', () => {
  let app: FastifyInstance;
  let proposals: ProposalStore;
  let graph: Rec = FX.after_edit;
  let committedEdit: Rec | undefined;
  let forwardedEvent: unknown;
  beforeAll(async () => {
    vi.stubGlobal('fetch', provider);
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const mod = await import('../../../routes/agent-v1-turn.js');
    ({ agentProposals: proposals } = await import('../held-approval-offers.js') as never);
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (req, reply) => {
      forwardedEvent = (req.body as Rec).event;
      if (committedEdit !== undefined) graph = committedEdit;
      return reply.code(200).send({ response_version: 2,
        assistant_text: `"Hire two developers" now sets "Developer hires from today" to ${graph.nodes.find((n: Rec) => n.id === 'hire_two_developers').interventions.developer_hires_from_today.raw_value} developers.`,
        blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse', graph_hash: 'b843f5b54c724c6a' });
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'b843f5b54c724c6a' }));
    await app.register(mod.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  beforeEach(() => {
    graph = structuredClone(FX.after_edit);
    committedEdit = undefined;
    forwardedEvent = undefined;
    provider.mockClear();
    modelOutputs.length = 0;
    for (const held of proposals.outstanding(SCENARIO, null)) proposals.discard(held.proposal_id);
  });

  const edit = (optionId: string, mode = 'openai', value = FX.edit_event.value) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': mode }, payload: { kind: 'system_event', scenario_id: SCENARIO,
    turn_id: '7627ee4d-6302-491f-9d35-54543d1afea1', stage: 'analyse', event: { ...FX.edit_event, option_id: optionId, value } } });

  it('PRECONDITION: the original served receipt and committed cell are preserved', () => {
    expect(FX.receipt).toBe('"Hire two developers" now sets "Developer hires from today" to 3 developers.');
    const option = graph.nodes.find((n: Rec) => n.id === 'hire_two_developers');
    expect(option.label).toBe('Hire two developers');
    expect(option.interventions.developer_hires_from_today).toMatchObject({ raw_value: 3, unit: 'developers' });
  });

  it.each(['openai', 'core'])('RED→GREEN (%s): a total 6→9 keeps the receipt and chosen name, with no host card or held proposal', async (mode) => {
    const option = graph.nodes.find((n: Rec) => n.id === 'hire_two_developers');
    const factor = graph.nodes.find((n: Rec) => n.id === 'developer_hires_from_today');
    factor.observed_state = { value: 0.3, raw_value: 6, unit: 'developers' };
    option.interventions.developer_hires_from_today = { value: 0.3, raw_value: 6, unit: 'developers' };
    committedEdit = structuredClone(graph);
    committedEdit.nodes.find((n: Rec) => n.id === option.id).interventions.developer_hires_from_today = {
      value: 0.45, raw_value: 9, unit: 'developers',
    };
    const unrelated = structuredClone(graph.nodes.filter((n: Rec) => n.id !== option.id));
    const outstanding = proposals.outstanding(SCENARIO, null);
    const r = await edit(option.id, mode, 0.45);
    expect(r.statusCode).toBe(200);
    const body = r.json() as Rec;
    expect(body.assistant_text).toBe('"Hire two developers" now sets "Developer hires from today" to 9 developers.');
    expect(body.suggested_actions).toEqual([]);
    expect(proposals.outstanding(SCENARIO, null)).toEqual(outstanding);
    expect(option.label).toBe('Hire two developers');
    expect(forwardedEvent).toEqual({ ...FX.edit_event, option_id: option.id, value: 0.45 });
    expect(graph.nodes.find((n: Rec) => n.id === option.id).interventions.developer_hires_from_today.raw_value).toBe(9);
    expect(graph.nodes.filter((n: Rec) => n.id !== option.id)).toEqual(unrelated);
    expect(provider).not.toHaveBeenCalled();
  });

  it('CONTRAST: AI-declared rename still produces its exact card, without renaming until approval', async () => {
    const quote = 'Rename Hire two developers to Hire three developers.';
    modelOutputs.push([{ type: 'function_call', name: 'propose_change', call_id: 'declared-rename',
      arguments: JSON.stringify({ ops: [{ op: 'rename', kind: 'option', id: 'hire_two_developers',
        new_label: 'Hire three developers', quote }] }) }]);
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: quote,
    } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Rec;
    const call = body._agent.tool_calls.find((c: Rec) => c.name === 'propose_change');
    expect(call).toMatchObject({ ok: true, mutated: false });
    const stored = proposals.get(call.proposal_id)!;
    expect(stored.operations).toEqual([{ op: 'rename_option', path: 'hire_two_developers',
      value: { expected_label: 'Hire two developers', label: 'Hire three developers' } }]);
    expect(body.suggested_actions.find((c: Rec) => c.id === `agent-approve-proposal:${stored.proposal_id}`)).toMatchObject({
      label: 'Rename it', message: 'Yes, rename it.',
      detail: `From your message: “${quote}”. Olumi proposes renaming ‘Hire two developers’ to ‘Hire three developers’. Rename it?`,
    });
    expect(graph.nodes.find((n: Rec) => n.id === 'hire_two_developers').label).toBe('Hire two developers');
    proposals.discard(stored.proposal_id);
  });

  it('CONTRAST: an edit that leaves the name true ("Hire one developer" at 1) → the receipt alone, no card', async () => {
    const r = await edit('hire_one_developer');
    expect(r.statusCode).toBe(200);
    expect((r.json() as Rec).suggested_actions).toEqual([]);
  });

  it('CONTRAST: before the edit (the name and level agree) → no card', async () => {
    graph = FX.before_edit;
    const r = await edit('hire_two_developers');
    expect((r.json() as Rec).suggested_actions).toEqual([]);
    graph = FX.after_edit;
  });
  // All prior parser/card negatives retained at the real consumer; prior substitution positives intentionally become no-card rows.
  it.each([
    ['one to two', 'Hire one developer', 'developers', 2],
    ['two to one', 'Hire two developers', 'developers', 1],
    ['campaigns', 'Run 2 campaigns', 'campaigns', 4],
    ['Tech Leads', 'Hire two Tech Leads', 'Tech Leads', 1],
    ['stores', 'Open three stores', 'stores', 25],
    ["a count of another quantity than the level's unit", 'Hire two developers', 'weeks', 3],
    ['no count in the name', 'Hire a Tech Lead', 'Tech Leads', 2],
    ['unrelated quantity and date in the name', 'Hire two developers for 2m revenue by 2026-09-01', 'developers', 9],
    ['two counts of the unit', 'Hire two developers or three developers', 'developers', 4],
    ['a fractional level', 'Hire two developers', 'developers', 2.5],
    ["a count that is not the unit's", 'Two-year plan with developers', 'developers', 3],
  ])('%s: a level does not propose any name', async (_row, label, unit, raw) => {
    const option = graph.nodes.find((n: Rec) => n.id === 'hire_two_developers');
    option.label = label;
    option.interventions.developer_hires_from_today = { raw_value: raw, unit };
    const r = await edit(option.id);
    expect(r.statusCode).toBe(200);
    expect(r.json().suggested_actions).toEqual([]);
    expect(option.label).toBe(label);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    ['Add two specialists', 3],
    ['Add one specialist', 2], // Prior name-collision negative: another option already has the proposed name.
  ])('capacity: %s set to %s offers no host card', async (label, raw) => {
    const option = graph.nodes.find((n: Rec) => n.id === 'hire_two_developers');
    option.label = label;
    option.interventions.developer_hires_from_today = { raw_value: raw, unit: 'specialists' };
    graph.nodes.push({ id: 'other', kind: 'option', label: 'Add two specialists' });
    const r = await edit(option.id);
    expect(r.json().suggested_actions).toEqual([]);
    expect(option.label).toBe(label);
    expect(provider).not.toHaveBeenCalled();
  });
});
