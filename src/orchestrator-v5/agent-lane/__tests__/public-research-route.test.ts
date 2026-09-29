/**
 * ⭐ PUBLIC RESEARCH R1 THROUGH THE AGENT ROUTE (seam #70 5849869441). The Agent can only OFFER a search; the user's
 * click on the control that shows the exact query runs ONE native web search, and the reply — the finding with its
 * sources — is what the answer row keeps, so a reload shows the same sources.
 *
 * The provider answers with the NATIVE research response AI Conversation captured under NE-20260926-02 (#70 5849971004).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { researchChipFor } from '../runtime/public-research.js';
import { readFileSync } from 'node:fs';

const NE02 = (JSON.parse(readFileSync(new URL('./fixtures/native-research-ne02.json', import.meta.url), 'utf8')) as { response: unknown }).response;

const SCENARIO = '8b3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d6f';
const Q = 'typical churn after a SaaS price rise of about 20%';
const SRC = 'https://sandhill.com/wp-content/uploads/2023/10/Allied-Advisers-report.pdf';
const appended: Record<string, unknown>[] = [];
/** Rows by turn id, read back as the route's turn claim and answer row expect. */
const rows = new Map<string, Record<string, unknown>>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: Record<string, unknown>) => {
    appended.push(w);
    rows.set(String(w.turn_id), { request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, response_emitted: w.response_emitted });
    return { id: `row-${rows.size}` };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** The native response with `extra` appended to its answer text (its citation indices stay valid: they precede it). */
const withExtraText = (response: unknown, extra: string): unknown => {
  const copy = JSON.parse(JSON.stringify(response)) as { output: Array<{ type: string; content?: Array<{ text?: string }> }> };
  const part = copy.output.find((o) => o.type === 'message')!.content![0]!;
  part.text = `${part.text ?? ''}\n\n${extra}`;
  return copy;
};

describe('public research: the Agent offers, the user\'s click searches once, the reply keeps the sources', () => {
  let app: FastifyInstance;
  let bodies: Record<string, unknown>[] = [];
  let research: 'ok' | 'fail' = 'ok';
  let researchExtra = '';
  let withheldRun = false;
  const searchCalls = () => bodies.filter((b) => JSON.stringify(b['tools'] ?? []).includes('web_search'));
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      if (JSON.stringify(body['tools'] ?? []).includes('web_search')) {
        if (research === 'fail') return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 });
        return new Response(JSON.stringify(researchExtra === '' ? NE02 : withExtraText(NE02, researchExtra)), { status: 200 });
      }
      // The Agent: first it offers the search, then it says so.
      const agentCalls = bodies.filter((b) => !JSON.stringify(b['tools'] ?? []).includes('web_search')).length;
      if (agentCalls === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'offer_public_research', call_id: 'c1', arguments: JSON.stringify({ query: Q }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'I can search the web for typical churn after a price rise if you press the button.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'x', suggested_actions: [], insights: [], blocks: [] }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Monthly churn' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: '0123456789abcdef',
      // A run exists and its leader is withheld (served `5668902`: `nonlinear_identity_sign_unproven`).
      ...(withheldRun ? {
        analysis_result: { type: 'analysis_result', summary: 'A provisional first pass.', computed_against_hash: '0123456789abcdef' },
        analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'nonlinear_identity_sign_unproven' } },
      } : {}),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { bodies = []; research = 'ok'; researchExtra = ''; withheldRun = false; appended.length = 0; rows.clear(); });

  type Body = { assistant_text: string; suggested_actions: { id: string; label: string; message: string; detail?: string }[]; _diagnostic_trace?: { fast_path?: string }; _agent?: { mutated?: boolean } };

  it('RED: when the Agent offers a search, the user gets ONE control showing the exact query — and nothing is searched', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What churn do other SaaS firms see after a price rise?' } });
    expect(r.statusCode).toBe(200);
    const b = r.json() as Body;
    const chip = researchChipFor(Q)!;
    expect(b.suggested_actions.filter((a) => a.id === chip.id)).toEqual([chip]);
    expect(searchCalls(), 'offering is not searching').toHaveLength(0);
  });

  /** The Agent offers the control on an earlier turn (only an offered control can search). */
  const offer = async () => {
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What churn do other SaaS firms see after a price rise?' } });
    bodies = [];
  };

  it('RED: the click runs ONE native web search carrying only the query, and the reply shows the finding with its source', async () => {
    await offer();
    const chip = researchChipFor(Q)!;
    // A turn id, as the UI always sends: the answer row is written for it.
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', message: chip.message, source: 'chip_click', chip: { id: chip.id },
    } });
    const b = r.json() as Body;
    expect(b._diagnostic_trace?.fast_path).toBe('research');
    expect(bodies, 'exactly one provider call, and it is the search').toHaveLength(1);
    expect(bodies[0]!['input']).toEqual([{ role: 'user', content: [{ type: 'input_text', text: Q }] }]);
    expect(bodies[0]).toMatchObject({ tools: [{ type: 'web_search' }], tool_choice: 'required', max_tool_calls: 3 });
    expect(b.assistant_text).toContain('less than 1% for enterprise SaaS. [1]');
    expect(b.assistant_text).toContain(`1. [sandhill.com](${SRC})`);
    expect(b._agent?.mutated).toBe(false);
    // What a reload reads: the answer row keeps the same finding and sources.
    expect(appended.map((w) => String(w.assistantMessage ?? '')).some((m) => m.includes(`1. [sandhill.com](${SRC})`))).toBe(true);
  });

  it('CONTRAST: the same words TYPED (no control) never search — they go to the Agent', async () => {
    const chip = researchChipFor(Q)!;
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message } });
    expect(searchCalls()).toHaveLength(0);
  });

  it('RED (#2042 N1): a control this scenario was never shown buys no search, and one press uses the control up', async () => {
    const other = researchChipFor('any query at all, sent directly')!;
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: other.message, source: 'chip_click', chip: { id: other.id } } });
    expect(searchCalls(), 'never offered').toHaveLength(0);
    await offer();
    const chip = researchChipFor(Q)!;
    const press = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip_click', chip: { id: chip.id } } });
    await press();
    await press();
    expect(searchCalls(), 'one offer, one search').toHaveLength(1);
  });

  it('CONTRAST: a search that fails says so and shows no finding; nothing is retried', async () => {
    research = 'fail';
    await offer();
    const chip = researchChipFor(Q)!;
    const b = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip_click', chip: { id: chip.id },
    } })).json() as Body;
    expect(searchCalls().length).toBeLessThanOrEqual(2);
    expect(b.assistant_text).toContain('The research did not finish, so no finding is shown');
    expect(b.assistant_text).not.toContain('**Sources**');
  });
  const WHY = /No single option can be put forward yet/;
  const RANKING = '- **Raising the price is the better option.** It beats holding the price for most SaaS firms.';
  const click = async () => {
    await offer();
    const chip = researchChipFor(Q)!;
    return (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d', message: chip.message, source: 'chip_click', chip: { id: chip.id },
    } })).json() as Body;
  };

  it('RED (served 5668902): a research answer whose source ranking is dropped gets no closing about the user\'s model', async () => {
    withheldRun = true;
    researchExtra = RANKING;
    const b = await click();
    expect(b._diagnostic_trace?.fast_path).toBe('research');
    expect(b.assistant_text, 'the wire drop ran: the ranking is gone').not.toContain('the better option');
    expect(b.assistant_text).toContain('less than 1% for enterprise SaaS. [1]');
    expect(b.assistant_text).not.toMatch(WHY);
  });

  it('PRECONDITION: with no withheld run the same answer keeps the sentence — the RED row\'s drop is the wire gate\'s', async () => {
    researchExtra = RANKING;
    const b = await click();
    expect(b.assistant_text).toContain('the better option');
    expect(b.assistant_text).not.toMatch(WHY);
  });
});
