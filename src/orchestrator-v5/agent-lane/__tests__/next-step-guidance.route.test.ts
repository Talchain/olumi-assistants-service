/**
 * ⭐ AI HARNESS G1 — HOSTILE PROOF (Paul's approval, 1 Oct: "pressed guidance does not immediately reappear"). Paul's
 * 1 Oct test: "Strengthen the model" came back on the reply to its own press, so it looped. The live route, the real
 * loop, the model stubbed, and a store double that keeps the answer rows, so a RESTART (fresh modules, every process
 * Map gone) reads the same record back.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

type Guidance = { v: 1; entries: Record<string, { status: string; state_key_hash: string; turn_id: string | null }> };
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const guidanceRows: Array<{ scenario_id: string; record: Guidance }> = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[]; agent_guidance?: Guidance | null }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: [] });
      // As the column stores it: JSON, so nothing in-process survives but the bytes.
      if (w.agent_guidance != null) guidanceRows.push({ scenario_id: w.scenario_id, record: JSON.parse(JSON.stringify(w.agent_guidance)) as Guidance });
    }
    return { id: rows.get(k)!.id };
  }),
  readMostRecentAgentGuidance: vi.fn(async (sid: string) => [...guidanceRows].reverse().find((r) => r.scenario_id === sid)?.record ?? null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string };
type Body = { suggested_actions: Chip[] };

const CURRENT = { run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' }, usable_for_chips: true, leader_claim: { permitted: false } };
const STRENGTHEN = { id: 'agent-next-strengthen', label: 'Strengthen the model', message: 'What would most strengthen this model?' };
const SCENARIO = '7b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';

let graphHash = 'h0';
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({
    graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] },
    graph_hash: graphHash,
    analysis_ready: { status: 'ready', may_run: true },
    analysis_state: CURRENT,
  }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('a pressed next step does not come back until the state changes (live route, durable record)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Sizing the link from team size to velocity would help most.' }] }] }), { status: 200 })));
    app = await freshApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const turn = async (message: string, chip?: Chip): Promise<string[]> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message, ...(chip !== undefined ? { chip } : {}) } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as Body).suggested_actions.map((c) => c.id);
  };

  it('RED: pressed → not on its own reply, not on the next turn, not after a restart; back when the model changes', async () => {
    expect(await turn('What do you make of this?')).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change', 'agent-next-strengthen']);

    // The press. Its own reply must not offer it again (Paul's loop).
    expect(await turn(STRENGTHEN.message, STRENGTHEN)).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change']);
    // A follow-up in the same state.
    expect(await turn('Ok, and what else?')).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change']);

    // A restart: fresh modules, every process Map gone. Only the answer rows remember.
    await app.close();
    app = await freshApp();
    expect(await turn('Where were we?')).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change']);

    // The saved model changes (an edit elsewhere): the step is eligible again.
    graphHash = 'h1';
    expect(await turn('I changed the team size link. What now?')).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change', 'agent-next-strengthen']);

    // Content-free: the record holds policy ids, statuses, hashes and turn ids, never the chip's words.
    const last = guidanceRows.at(-1)!.record;
    expect(last.entries['RC-STRENGTHEN-ITEM']?.status).toBe('offered');
    expect(JSON.stringify(guidanceRows)).not.toMatch(/strengthen this model|Strengthen the model/);
  });
});
