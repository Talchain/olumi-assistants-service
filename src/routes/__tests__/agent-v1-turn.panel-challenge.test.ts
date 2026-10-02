/**
 * D2 S1 — THE REAL ROUTE: "Ask Olumi to challenge this" (ACCOUNTS, 2 Oct 2026; `method-turn/panel-challenge.ts`).
 *
 * Seams: the internal graph read, the provider's HTTP call (`fetch`, counted and captured), the session store, the
 * verified identity, and the collab store (the suite's own fixture store, `tests/collab/contracts.ts`). Everything
 * between the press and the wire is the production route.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  FIXTURE_GRAPH_VERSION_REF,
  FIXTURE_TARGET_ID,
  SENTINELS,
  createFixtureStore,
  fixtureEventB,
  fixtureParticipantA,
  fixtureParticipantB,
  fixtureRound,
  type FixtureCollabStore,
} from '../../../tests/collab/contracts.js';
import { assembleDisagreementView, summariseDisagreementForPrompt } from '../../collab/disagreement-read-model.js';
import type { CollabStore } from '../../collab/types.js';
import {
  PANEL_CHALLENGE_PREFIX,
  PANEL_CHALLENGE_UNAVAILABLE,
  panelChallengeFallback,
} from '../../orchestrator-v5/agent-lane/method-turn/panel-challenge.js';

const OWNER = SENTINELS.OWNER_USER_ID;
const ROUND = '0b5d6f0e-3c7a-4d0e-9a51-2f4b8c1d7e90';
const SCENARIO_BASE = '7d1e2f30-4a5b-4c6d-8e9f-a0b1c2d3e4';
let n = 0;
let SCENARIO = '';

let collab: FixtureCollabStore;
const seedRound = (over: { status?: 'open' | 'closed'; scenario_id?: string } = {}): FixtureCollabStore =>
  createFixtureStore({
    rounds: [fixtureRound({ round_id: ROUND, scenario_id: over.scenario_id ?? SCENARIO, status: over.status ?? 'closed' })],
    participants: [
      fixtureParticipantA({ round_id: ROUND, scenario_id: over.scenario_id ?? SCENARIO }),
      fixtureParticipantB({ round_id: ROUND, scenario_id: over.scenario_id ?? SCENARIO }),
    ],
    events: [fixtureEventB({ round_id: ROUND })],
    modelValues: { [FIXTURE_GRAPH_VERSION_REF]: { [FIXTURE_TARGET_ID]: SENTINELS.MODEL_VALUE } },
    scenarioOwners: { [over.scenario_id ?? SCENARIO]: OWNER },
  });
vi.mock('../../collab/store.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCollabStore: () => collab };
});

const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: OWNER })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: null, user_message: null, llm_calls_used: 0, pending_actions: [] });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'verified', userId: OWNER }) };
});

describe('D2 S1 — the press through the real route', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let modelBodies: unknown[] = [];
  let modelText = '';

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      modelCalls += 1;
      modelBodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelText }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [], edges: [] }, graph_hash: null, analysis_ready: { status: 'not_ready', may_run: false },
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    modelCalls = 0; modelBodies = []; modelText = '';
    n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`;
    collab = seedRound();
  });

  type Body = { assistant_text: string; suggested_actions: { id: string }[] };
  const press = async (roundId = ROUND) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Challenge our panel’s answers.', source: 'chip',
      chip: { id: `${PANEL_CHALLENGE_PREFIX}${roundId}` },
    } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Body;
  };
  // The N-suite fixture store is the contract's shape, not the port's type: adapted the way the panel-apply suites do.
  const viewNow = () => assembleDisagreementView(collab as unknown as CollabStore, { round_id: ROUND, requested_by: { kind: 'owner', user_id: OWNER } });

  it('a closed owned round → ONE model call, NO tools, the round’s summary in the instructions; a passing draft is sent', async () => {
    const view = await viewNow();
    // A draft that restates only numbers the round carries, and asks.
    const stated = view.per_target.flatMap((t) => t.positions.map((p) => p.value)).filter((v): v is number => v !== null);
    modelText = `One person answered: ${stated[0]}. What is that view based on, and has anyone challenged it?`;
    const b = await press();
    expect(modelCalls).toBe(1);
    const body = JSON.stringify(modelBodies[0]);
    expect(body).toContain(JSON.stringify(summariseDisagreementForPrompt(view)).slice(1, -1));
    const tools = (modelBodies[0] as { tools?: unknown[] } | undefined)?.tools;
    expect(tools === undefined || tools.length === 0, 'every tool withheld').toBe(true);
    expect(b.assistant_text).toBe(modelText);
    expect(b.suggested_actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
  });

  it('a draft that adjudicates ("the consensus …") is never sent: the code-owned fallback is', async () => {
    modelText = 'The consensus is clear: use the higher number.';
    const b = await press();
    expect(modelCalls).toBe(1);
    expect(b.assistant_text).toBe(panelChallengeFallback(await viewNow()));
  });

  it('an OPEN round → the round_open reply, NO model call', async () => {
    collab = seedRound({ status: 'open' });
    const b = await press();
    expect(modelCalls).toBe(0);
    expect(b.assistant_text).toBe(PANEL_CHALLENGE_UNAVAILABLE.round_open);
  });

  it('a round of ANOTHER decision → the unknown-round reply, NO model call (same bytes as an unknown id)', async () => {
    collab = seedRound({ scenario_id: 'aaaaaaaa-4a5b-4c6d-8e9f-a0b1c2d3e4ff' });
    const other = await press();
    collab = seedRound();
    const unknown = await press('99999999-3c7a-4d0e-9a51-2f4b8c1d7e90');
    expect(modelCalls).toBe(0);
    expect(other.assistant_text).toBe(PANEL_CHALLENGE_UNAVAILABLE.not_found);
    expect(unknown.assistant_text).toBe(other.assistant_text);
  });
});
