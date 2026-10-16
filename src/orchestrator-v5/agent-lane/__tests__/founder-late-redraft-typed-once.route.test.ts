/**
 * ⭐ G1 THROUGH THE REAL ROUTE (founder verify 79d4da30; drafter rows hash-proven, `fixtures/founder-79d4da30-typed-turns.json`).
 *
 * Served: from turn 9 on, a revised draft's retained conversation read the user's typed messages twice. The history window had
 * moved each dropped typed message into the older words while the typed list still held it, and `authorshipWords` joined the
 * two, so `verified_user_messages` repeated a growing prefix (2, 3, 5 and 6 messages at turns 12, 13, 16 and 17). The redraft's
 * typed-origin match then stopped at the first repeat: every later message went to the drafter as "origin not verified", and
 * every typed message was appended again at the end, the brief included, after Paul's corrections. Offline replay of the
 * served turn-17 request (same input, prompt and schema hashes): the £250k target was held 0/3 as served, 2/3 de-duplicated.
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject) and its history store, Paul's served typed turns in order, then the
 * REAL `propose_change` revise_model door → `prepareRevisedDraft` → the drafter request. Scripted: the Agent's outputs and the
 * drafter's reply (the 57801434 recorded redraft), so this is TESTED, not WIRE-WITNESSED. 0 provider calls.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the G1 route row'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the G1 route row'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { constructionOperationId, LATER_MESSAGES_CONTEXT_LEAD } from '../runtime/build-model.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const DRAFT = JSON.parse(readFileSync(new URL('./fixtures/founder-57801434-targetless-revision.json', import.meta.url), 'utf8')) as Rec;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/founder-79d4da30-typed-turns.json', import.meta.url), 'utf8')) as {
  brief_text: string; turns: { turn: number; source: 'composer' | 'chip'; message: string }[];
};
const SID = DRAFT.scenario_id as string;
const BRIEF = DRAFT.brief_text as string;
/** Paul's served typed turns before the late redraft (turn 17), and that turn's correction. Both briefs are byte-identical. */
const TYPED = SERVED.turns.filter((t) => t.source === 'composer' && t.turn < 17).map((t) => t.message);
const LATE = SERVED.turns.find((t) => t.turn === 17)!.message;
const ROUTE_MS = 60_000;

const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });

let graph: Rec = structuredClone(DRAFT.graph);
const rows: SessionTurnWithContent[] = [];
const ledger: { write_turn_ids: string[]; user_message_turn_ids: string[]; first_user_message: string | null; complete: boolean;
  later_user_messages: { turn_id: string; text: string }[] } = {
  write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, BRIEF))], user_message_turn_ids: [], first_user_message: null,
  complete: true, later_user_messages: [] };
let agentScript: Rec[] = [];
const drafterInputs: string[] = [];
let app: FastifyInstance;

beforeAll(async () => {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  live.store = createMockSessionStore({
    loadGraph: async () => graph, loadGraphAndBriefText: async () => ({ graph, briefText: BRIEF }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(x => x.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used, pending_actions: (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { const latest = rows.find(r => !r.turn_id.endsWith(':claim'));
      opts?.onLatestRowId?.(latest?.id ?? null); return (latest as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readCommittedTurnLedger: async (): Promise<CommittedTurnLedger> => structuredClone(ledger),
    append: async write => {
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: SID, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Rec;
    const format = body.text?.format;
    if (format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    if (format?.type === 'json_schema') {
      drafterInputs.push(String(body.input));
      return new Response(JSON.stringify(say(DRAFT.turns[0].calls[0].raw_text)), { status: 200 });
    }
    return new Response(JSON.stringify(agentScript.shift() ?? say('Noted.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never),
    graph_identity_hash: computeGraphIdentityHash(graph as never), brief_text: BRIEF, scenario_created_at: '2026-10-16T00:07:00.000Z',
    analysis_ready: buildCanonicalAnalysisReadyFromGraph(graph) }));
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
  app.post('/assist/v1/scenarios/:id/graph/register', async (_req, reply) => reply.code(409).send({ details: { code: 'NOT_IN_THIS_ROW' } }));
  await app.register(agentV1TurnRoute); await app.ready();
}, ROUTE_MS);
afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** One typed turn as the browser sends it; its message lands in the committed ledger once its turn completes. */
async function typed(message: string, script: Rec[] = []): Promise<Rec> {
  agentScript = [...script];
  const turnId = randomUUID();
  const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: turnId, scenario_id: SID, message, source: 'composer' } });
  expect(r.statusCode, r.body.slice(0, 1500)).toBe(200);
  if (ledger.first_user_message === null) ledger.first_user_message = message.trim();
  else ledger.later_user_messages.push({ turn_id: turnId, text: message.trim() });
  ledger.user_message_turn_ids.push(turnId);
  return r.json() as Rec;
}

/** The retained conversation the drafter was sent (`firstConstructInput`), parsed from its own input. */
const retainedConversation = (input: string): Rec[] => {
  const at = input.indexOf(`${LATER_MESSAGES_CONTEXT_LEAD} `);
  expect(at, 'the drafter was sent the retained conversation').toBeGreaterThan(0);
  const rest = input.slice(at + LATER_MESSAGES_CONTEXT_LEAD.length + 1);
  return JSON.parse(rest.split('\n\n')[0]!) as Rec[];
};

describe('G1 through the real route: a late revised draft reads each typed message once, as the user’s', () => {
  it('RED: after Paul’s 14 typed turns, the turn-17 redraft’s retained conversation is each later typed message once, in order, all the user’s', async () => {
    expect(SERVED.brief_text.trim(), 'the served brief is the draft fixture’s brief').toBe(BRIEF.trim());
    expect(TYPED[0]!.trim()).toBe(BRIEF.trim());
    for (const message of TYPED) await typed(message);
    expect(TYPED.length, 'more than the 8-turn window, as served').toBeGreaterThan(8);
    const body = await typed(LATE, [
      call('propose_change', { ops: [{ op: 'revise_model', kind: 'goal', label: 'Funding secured', quote: LATE }] }),
      say('I have prepared a revised model for you to review.'),
    ]);
    const revise = (body._agent.tool_calls as Rec[]).filter((c) => c.name === 'propose_change');
    expect(revise, JSON.stringify(body._agent.tool_calls)).toHaveLength(1);
    // The first construct and its repair retry (the served row's two calls) each carry the retained conversation.
    expect(drafterInputs.length, 'the redraft reached the drafter').toBeGreaterThan(0);
    for (const input of drafterInputs) {
      expect(retainedConversation(input)).toEqual([...TYPED.slice(1), LATE].map((text) => ({ speaker: 'user', source: 'typed', text: text.trim() })));
    }
  }, ROUTE_MS * 4);
});
