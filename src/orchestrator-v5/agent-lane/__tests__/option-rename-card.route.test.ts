/**
 * ⭐ S5 (DL 15 Oct; served hiring e2e on CEE c1e944a4, scenario e9e63843, turn 16): the canvas set "Hire two developers" to 3
 * developers; the receipt said so, and a reopen kept the name "Hire two developers" beside raw_value 3. Olumi proposes, the user
 * authors: the SAME receipt now offers ONE rename card, and nothing is renamed until its press.
 *
 * Through the REAL route: the forwarded `option_intervention_edit` answers with the served receipt, the read-back serves the
 * served committed graph, and the reply carries the card (its words in `detail`, "Rename it") beside the receipt, unchanged.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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
const WORDS = '‘Hire two developers’ now sets ‘Developer hires from today’ to 3 developers, but its name still says two. '
  + 'Rename it ‘Hire three developers’?';

describe('the canvas edit\'s receipt offers ONE rename card when the figure contradicts the option\'s name', () => {
  let app: FastifyInstance;
  let proposals: { get: (id: string) => Rec | undefined };
  let graph: Rec = FX.after_edit;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const mod = await import('../../../routes/agent-v1-turn.js');
    ({ agentProposals: proposals } = await import('../held-approval-offers.js') as never);
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (_req, reply) => reply.code(200).send({ response_version: 2, assistant_text: FX.receipt,
      blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse', graph_hash: 'b843f5b54c724c6a' }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'b843f5b54c724c6a' }));
    await app.register(mod.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const edit = (optionId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO,
    turn_id: '7627ee4d-6302-491f-9d35-54543d1afea1', stage: 'analyse', event: { ...FX.edit_event, option_id: optionId } } });

  it('RED: the served edit → the receipt unchanged, plus ONE rename card naming the clash; nothing renamed', async () => {
    const r = await edit('hire_two_developers');
    expect(r.statusCode).toBe(200);
    const body = r.json() as Rec;
    expect(body.assistant_text).toBe(FX.receipt);
    const [card, amend] = body.suggested_actions as Rec[];
    expect(card).toMatchObject({ label: 'Rename it', message: 'Yes, rename it.', detail: WORDS });
    expect(amend?.id).toBe('agent-amend-proposal');
    // The card names exactly the stored proposal: ONE rename, card-only, the label the card showed as its gate.
    expect(String(card!.id)).toMatch(/^agent-approve-proposal:/);
    const stored = proposals.get(String(card!.id).replace(/^agent-approve-proposal:/, ''));
    expect(stored?.operations).toEqual([{ op: 'rename_option', path: 'hire_two_developers',
      value: { expected_label: 'Hire two developers', label: 'Hire three developers' } }]);
    expect(stored?.public_label).toBe(WORDS);
    // Olumi proposes; nothing renamed: the only write this turn is the forwarded edit's own.
    expect(graph.nodes.find((n: Rec) => n.id === 'hire_two_developers').label).toBe('Hire two developers');
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
});
