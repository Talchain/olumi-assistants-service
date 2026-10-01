/**
 * ⭐ AI HARNESS G1 — HOSTILE PROOF (Paul's approval, 1 Oct: "pressed guidance does not immediately reappear"). Paul's
 * 1 Oct test: "Strengthen the model" came back on the reply to its own press, so it looped. The live route, the real
 * loop, the model stubbed, and a store double that keeps the answer rows AS JSON and reads them back the way the store
 * does (the newest rows, merged by `mergeAgentGuidance`), so a RESTART (fresh modules, every process Map gone) reads
 * the same record. Plus CODEX_CLI_OVERFLOW's five cases on #2459 (5933575763).
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  AGENT_GUIDANCE_MERGE_WINDOW,
  mergeAgentGuidance,
  parseAgentGuidanceSnapshot,
  toAgentGuidanceSnapshot,
  type AgentGuidanceRecord,
} from '../../coaching/agent-guidance-snapshot.js';

type Row = { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] };
const rows = new Map<string, Row>();
const guidanceRows: Array<{ scenario_id: string; json: string }> = [];
const control = { failReads: 0, barrier: null as null | { waiting: number; release: () => void; released: Promise<void> } };
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; agent_guidance?: AgentGuidanceRecord | null }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    const prior = rows.get(k);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: [] });
    // As the column stores it: the envelope, as JSON. Nothing in-process survives but these bytes.
    if (w.agent_guidance != null) guidanceRows.push({ scenario_id: w.scenario_id, json: JSON.stringify(toAgentGuidanceSnapshot(w.agent_guidance)) });
    return { id: rows.get(k)!.id };
  }),
  readMostRecentAgentGuidance: vi.fn(async (sid: string) => {
    if (control.barrier !== null) {
      const b = control.barrier;
      b.waiting += 1;
      if (b.waiting >= 2) b.release();
      await b.released;
    }
    if (control.failReads > 0) { control.failReads -= 1; throw new Error('read failed'); }
    const mine = guidanceRows.filter((r) => r.scenario_id === sid).slice(-AGENT_GUIDANCE_MERGE_WINDOW);
    return mine.length === 0 ? null : mergeAgentGuidance(mine.map((r) => parseAgentGuidanceSnapshot(JSON.parse(r.json))));
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string };
const CURRENT = { run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' }, usable_for_chips: true, leader_claim: { permitted: false } };
const STRENGTHEN: Chip = { id: 'agent-next-strengthen', label: 'Strengthen the model', message: 'What would most strengthen this model?' };
const PREMORTEM: Chip = { id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?' };
const ALL = ['agent-next-pre-mortem', 'agent-next-what-would-change', 'agent-next-strengthen'];
const NO_STRENGTHEN = ['agent-next-pre-mortem', 'agent-next-what-would-change'];

let description = 'Engineers on the sprint';
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({
    graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size', description }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] },
    // The analysis hash ignores a description: only the persisted graph moves (CODEX_CLI_OVERFLOW P1).
    graph_hash: 'h0',
    analysis_ready: { status: 'ready', may_run: true },
    analysis_state: CURRENT,
  }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('a pressed next step does not come back until the state changes (live route, durable record)', () => {
  let app: FastifyInstance;
  let scenario = '';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Sizing the link from team size to velocity would help most.' }] }] }), { status: 200 })));
    app = await freshApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { scenario = randomUUID(); description = 'Engineers on the sprint'; control.failReads = 0; control.barrier = null; });

  const turn = async (message: string, chip?: Chip, turnId: string | null = randomUUID()): Promise<string[]> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, ...(turnId !== null ? { turn_id: turnId } : {}), message, ...(chip !== undefined ? { chip } : {}) } });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { suggested_actions: Chip[] }).suggested_actions.map((c) => c.id);
  };

  it('RED: pressed → not on its own reply, not on the next turn, not after a restart; back when the model changes', async () => {
    expect(await turn('What do you make of this?')).toEqual(ALL);
    expect(await turn(STRENGTHEN.message, STRENGTHEN)).toEqual(NO_STRENGTHEN);
    expect(await turn('Ok, and what else?')).toEqual(NO_STRENGTHEN);
    await app.close();
    app = await freshApp();
    expect(await turn('Where were we?')).toEqual(NO_STRENGTHEN);
    // A persisted DESCRIPTION edit (the analysis hash does not move): the step is eligible again.
    description = 'Engineers and the PM on the sprint';
    expect(await turn('I reworded the team size description. What now?')).toEqual(ALL);
    expect(JSON.stringify(guidanceRows)).not.toMatch(/strengthen this model|Strengthen the model/);
  });

  it('RED (P1 replay): offer on turn A → press on turn B → a retry of A does not bring the pressed step back', async () => {
    const a = randomUUID();
    expect(await turn('What do you make of this?', undefined, a)).toEqual(ALL);
    expect(await turn(STRENGTHEN.message, STRENGTHEN)).toEqual(NO_STRENGTHEN);
    expect(await turn('What do you make of this?', undefined, a)).toEqual(NO_STRENGTHEN);
  });

  it('RED (P1 failed read): a turn whose read fails persists nothing, so the press survives once reads recover', async () => {
    expect(await turn(STRENGTHEN.message, STRENGTHEN)).toEqual(NO_STRENGTHEN);
    const before = guidanceRows.length;
    control.failReads = 1;
    // The failed turn cannot know the press: every step is eligible on THIS reply, and no record is written from it.
    expect(await turn('And now?')).toEqual(ALL);
    expect(guidanceRows.length).toBe(before);
    expect(await turn('And after that?')).toEqual(NO_STRENGTHEN);
  });

  it('RED (P2 unnamed turn): a press with no turn_id still writes its row', async () => {
    expect(await turn(STRENGTHEN.message, STRENGTHEN, null)).toEqual(NO_STRENGTHEN);
    expect(await turn('And now?')).toEqual(NO_STRENGTHEN);
  });

  it('RED (P1 two tabs): both read the same record, each presses a different step; neither press is lost', async () => {
    expect(await turn('What do you make of this?')).toEqual(ALL);
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    control.barrier = { waiting: 0, release, released };
    const [x, y] = await Promise.all([turn(STRENGTHEN.message, STRENGTHEN), turn(PREMORTEM.message, PREMORTEM)]);
    control.barrier = null;
    expect(x).not.toContain('agent-next-strengthen');
    expect(y).not.toContain('agent-next-pre-mortem');
    expect(await turn('Where are we?')).toEqual(['agent-next-what-would-change']);
  });
});
