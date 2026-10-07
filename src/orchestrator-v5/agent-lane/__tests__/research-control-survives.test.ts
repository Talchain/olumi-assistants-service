/**
 * ⭐ A SEARCH CONTROL THE AGENT WAS TOLD THE USER SEES, REACHES THE USER (S-B slice 1a; witnessed on staging 7 Oct 2026).
 *
 * `offer_public_research` answers the model "The user now sees a control…". On a Run that withholds its leader, the final
 * egress gate (`leader-final-egress.ts`, "3: chips") then removed that control because the query it quotes compared the
 * options, and the reply still said "it runs only if you press the control" (Render 10:17:54.742Z:
 * `agent_lane.leader_claim_residual_removed`, `removed_paths: ["suggested_actions[0]"]`; wire `suggested_actions: []`).
 *
 * THE INVARIANT (the spec, not the failure): an offer the tool accepted has its control on the wire. A query the gate
 * would remove is refused AT THE OFFER, with the reason, so the model can ask a neutral question or say no search is on
 * offer. The gate itself is unchanged: the offer reads its predicate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { researchChipFor } from '../runtime/public-research.js';
import { textAssertsLeadingOption } from '../../compose/leading-option-egress-guard.js';

const SCENARIO = '8b3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d70';
const OPTIONS = ['Hire a tech lead', 'Hire two developers'] as const;
/** A query that ranks the options: the gate removes a control that quotes it. */
const RANKING = 'Why is Hire a tech lead the best option for meeting a launch deadline?';
/** The same subject as one neutral public question: no option is put ahead. */
const NEUTRAL = 'How long do new engineering hires take to become productive before a launch deadline?';
const PROMISE = 'The search would look for that evidence; it runs only if you press the control.';
const NO_OFFER = 'No web search is on offer for that question.';

const rows = new Map<string, Record<string, unknown>>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: Record<string, unknown>) => {
    rows.set(String(w.turn_id), { request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, response_emitted: w.response_emitted });
    return { id: `row-${rows.size}` };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('an accepted search offer has its control on the wire', () => {
  let app: FastifyInstance;
  let bodies: Record<string, unknown>[] = [];
  let query = NEUTRAL;
  let withheldRun = true;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const raw = String(init?.body ?? '{}');
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      // The Agent offers the search first. Then it speaks from the tool's own answer: a promise only for an accepted offer.
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'offer_public_research', call_id: 'c1', arguments: JSON.stringify({ query }) }] }), { status: 200 });
      }
      const accepted = raw.includes('The user now sees a control');
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: accepted ? PROMISE : NO_OFFER }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'x', suggested_actions: [], insights: [], blocks: [] }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: {
        nodes: [
          { id: 'g', kind: 'goal', label: 'Meet the launch deadline' },
          { id: 'o1', kind: 'option', label: OPTIONS[0] },
          { id: 'o2', kind: 'option', label: OPTIONS[1] },
          { id: 'f', kind: 'factor', label: 'Delivery pace' },
        ],
        edges: [{ from: 'f', to: 'g' }],
      },
      graph_hash: '0123456789abcdef',
      ...(withheldRun ? {
        analysis_result: { type: 'analysis_result', summary: 'A provisional first pass.', computed_against_hash: '0123456789abcdef' },
        analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
      } : {}),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { bodies = []; query = NEUTRAL; withheldRun = true; rows.clear(); });

  type Body = {
    assistant_text: string;
    suggested_actions: { id: string; label: string; message: string; detail?: string }[];
    _agent?: { tool_calls?: { name: string; ok: boolean }[] };
  };
  const turn = async (): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What are the limits of this analysis?', source: 'chip', chip: { id: 'ask:limits' } } });
    expect(r.statusCode).toBe(200);
    return r.json() as Body;
  };
  const offers = (b: Body) => (b._agent?.tool_calls ?? []).filter((c) => c.name === 'offer_public_research');
  const controls = (b: Body) => b.suggested_actions.filter((a) => a.id.startsWith('agent-public-research:'));

  it('PRECONDITION: the gate’s own predicate reads the ranking query’s control as a leader claim, and not the neutral one', () => {
    const asserts = (q: string) => {
      const chip = researchChipFor(q)!;
      return [chip.label, chip.message, chip.detail].some((text) => textAssertsLeadingOption(text, { optionLabels: [...OPTIONS] }));
    };
    expect(asserts(RANKING)).toBe(true);
    expect(asserts(NEUTRAL)).toBe(false);
  });

  it('RED (staging 7 Oct): a query the gate would remove is refused at the offer; nothing promises a control that is not there', async () => {
    query = RANKING;
    const b = await turn();
    expect(offers(b), 'the Agent made the offer').toHaveLength(1);
    // The invariant: accepted ⇒ on the wire. Here the offer is refused, so there is no control and no promise of one.
    expect(offers(b)[0]!.ok).toBe(false);
    expect(controls(b)).toEqual([]);
    expect(b.assistant_text).not.toContain('press the control');
    expect(b.assistant_text).toContain(NO_OFFER);
  });

  it('CONTRAST: a neutral query on the same withheld Run is accepted, and its ONE control is on the wire', async () => {
    query = NEUTRAL;
    const b = await turn();
    expect(offers(b)).toEqual([expect.objectContaining({ name: 'offer_public_research', ok: true })]);
    expect(controls(b)).toEqual([researchChipFor(NEUTRAL)]);
    expect(b.assistant_text).toContain('press the control');
  });

  it.each([RANKING, NEUTRAL])('INVARIANT: for %j, every accepted offer has a control on the wire', async (q) => {
    query = q;
    const b = await turn();
    const accepted = offers(b).filter((c) => c.ok).length;
    expect(controls(b)).toHaveLength(accepted);
  });
});
