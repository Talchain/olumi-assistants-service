/**
 * ⭐ S1 ANSWERED PAIRS THROUGH THE REAL ROUTE (TL 09:18Z; DL-3 10:1xZ). Served founder verify 79d4da30: Olumi's turn-8 reply
 * asked "What is that deadline?" and Paul typed "Let's assume 60 and possibly more if I needed to." (turn 9). Once the 8-turn
 * window dropped turn 9, the older words kept his sentence but not the question it answered, so no later AI call could read
 * what "60" was about (laneA/TRACE-60h-247ae5b4.md: the binding lives only in Olumi's question).
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject) and its history store; Paul's served composer turns in order, each
 * answered by Olumi's SERVED reply (`fixtures/founder-79d4da30-served-replies.json`, response_body.assistant_text); then one
 * more turn, whose SENT Agent request is read. Chip presses (turns 4, 5) are not replayed: no card is on offer here. Scripted:
 * the Agent's outputs, so this is TESTED, not WIRE-WITNESSED. 0 provider calls.
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
  getAdapter: () => { throw new Error('Providers forbidden in the S1 route row'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the S1 route row'); }, getMaxTokensFromConfig: () => undefined,
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
import { constructionOperationId } from '../runtime/build-model.js';
import { REASONING_CONTEXT_LABEL } from '../turn-context.js';
import { ANSWERED_EARLIER_LABEL, OLDER_WORDS_LABEL } from '../history-store.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const DRAFT = JSON.parse(readFileSync(new URL('./fixtures/founder-57801434-targetless-revision.json', import.meta.url), 'utf8')) as Rec;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/founder-79d4da30-typed-turns.json', import.meta.url), 'utf8')) as {
  scenario_id: string; brief_text: string; turns: { turn: number; source: 'composer' | 'chip'; message: string }[];
};
const REPLIES = JSON.parse(readFileSync(new URL('./fixtures/founder-79d4da30-served-replies.json', import.meta.url), 'utf8')) as {
  scenario_id: string; replies: Record<string, string>;
};
const SID = DRAFT.scenario_id as string;
const BRIEF = DRAFT.brief_text as string;
const TYPED = SERVED.turns.filter((t) => t.source === 'composer' && t.turn < 18);
const SIXTY = "Let's assume 60 and possibly more if I needed to.";
const ROUTE_MS = 60_000;

const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

let graph: Rec = structuredClone(DRAFT.graph);
const rows: SessionTurnWithContent[] = [];
const ledger: { write_turn_ids: string[]; user_message_turn_ids: string[]; first_user_message: string | null; complete: boolean;
  later_user_messages: { turn_id: string; text: string }[] } = {
  write_turn_ids: [registrationTurnId(SID, constructionOperationId(SID, BRIEF))], user_message_turn_ids: [], first_user_message: null,
  complete: true, later_user_messages: [] };
let agentScript: Rec[] = [];
const drafterInputs: string[] = [];
const agentBodies: Rec[] = [];
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
    agentBodies.push(body);
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

const textOf = (item: Rec): string => (Array.isArray(item?.content) ? item.content.map((c: Rec) => String(c?.text ?? '')).join('\n') : String(item?.content ?? ''));
/** The labelled item the Agent was SENT, parsed from its own input (one item per label). */
const sentItem = (body: Rec, label: string): Rec => {
  const items = (body.input as Rec[]).filter((i) => textOf(i).startsWith(label));
  expect(items, `the Agent was sent one "${label.slice(0, 40)}…" item`).toHaveLength(1);
  expect(items[0]!.role).toBe('user');
  return JSON.parse(textOf(items[0]!).slice(label.length + 1)) as Rec;
};

describe('S1 through the real route: a reply the window dropped still reaches the Agent beside the question it answered', () => {
  it('⭐ RED→GREEN: after the window drops turn 9, the SENT request pairs "Let\u2019s assume 60…" with Olumi\u2019s deadline question, as Olumi\u2019s', async () => {
    expect(REPLIES.scenario_id).toBe(SERVED.scenario_id);
    expect(SERVED.brief_text.trim()).toBe(BRIEF.trim());
    expect(TYPED.find((t) => t.turn === 9)!.message).toBe(SIXTY);
    expect(REPLIES.replies['8'], 'precondition: the served turn-8 reply asks the question, above a held-card notice').toContain('What is that deadline?');
    for (const t of TYPED) await typed(t.message, [say(REPLIES.replies[String(t.turn)]!)]);
    expect(TYPED.filter((t) => t.turn > 9).length, 'enough later turns to push turn 9 out of the 8-turn window').toBeGreaterThanOrEqual(8);
    agentBodies.length = 0;
    await typed('So which split of my time does the model favour now?');
    expect(agentBodies.length, 'the Agent was called').toBeGreaterThan(0);
    const sent = agentBodies[0]!;
    // Control: turn 9 is out of the window (only in the older words), so the pair is the only place its question can be.
    const windowUsers = (sent.input as Rec[]).filter((i) => i.role === 'user' && !textOf(i).startsWith(OLDER_WORDS_LABEL)).map(textOf);
    expect(windowUsers.some((t) => t === SIXTY), 'turn 9 has left the window').toBe(false);
    const older = (sent.input as Rec[]).find((i) => textOf(i).startsWith(OLDER_WORDS_LABEL));
    expect(textOf(older!), 'the older words keep the sentence').toContain(`"${SIXTY}"`);
    expect(textOf(older!), 'W2: Olumi\u2019s words never enter the older words').not.toContain('What is that deadline?');
    const pairs = sentItem(sent, ANSWERED_EARLIER_LABEL).answered_pairs as Rec[];
    const sixty = pairs.filter((p) => p.response?.text === SIXTY);
    expect(sixty, JSON.stringify(pairs).slice(0, 1500)).toHaveLength(1);
    expect(sixty[0]!.response).toEqual({ speaker: 'user', source: 'typed', text: SIXTY });
    expect(sixty[0]!.olumi.speaker).toBe('olumi');
    expect(sixty[0]!.olumi.source).toBe("the end of Olumi's reply, not a user statement");
    expect(sixty[0]!.olumi.text).toMatch(/when you need the first funding secured.*What is that deadline\?$/);
    // Olumi's side is never a verified user statement.
    const verified = (sentItem(sent, REASONING_CONTEXT_LABEL).verified_user_statements as Rec[]).map((s) => String(s.text));
    expect(verified.some((t) => t.includes('What is that deadline?'))).toBe(false);
  }, ROUTE_MS * 4);
});
