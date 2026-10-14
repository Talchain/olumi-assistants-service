/**
 * ⭐ G THROUGH THE REAL ROUTE: the user's "relative to today" clarification → the card → the chip press → the one writer →
 * the store → the read-back → the reply (bG brief continuation; DL whole-system rule).
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject, the UI's request shape: `message`; then `source: 'chip_click'`,
 * `chip: { id }`, as DGAI `buildPayload.ts` sends a press) → the REAL Agent loop → the REAL `propose_goal_target` and its hook
 * → the card's chip → the press → `authoriseChange` → the REAL in-process level door (`commitOptionLevelsInProcess` →
 * `goal_reading`) → the session store's append → the read-back. The graphs are the two served `/graph` reads, verbatim.
 * Scripted: only the Agent's outputs (its one tool call and its words). 0 provider calls. TESTED, not WIRE-WITNESSED.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the G route replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the G route replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../../agent-lane/approval-chips.js';
import { ALREADY_SAVED_NOTE } from '../held-change-target.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const read = (f: string): Rec => (JSON.parse(readFileSync(`tests/fixtures/batch-g/${f}`, 'utf8')) as Rec).body as Rec;
const SAVED = read('served-hiring-read-14-after-approve-20261013T074403Z.json');
const ASKED = read('served-hiring-read-19-after-reopen-20261013T131858Z.json');
const CLARIFIED = "I mean 10% relative to today's productivity, not percentage points.";
const QUESTION = 'Does “increase productivity by at least 10%” mean 10% relative to today\'s productivity, or 10 percentage points on a productivity score?';
const READING = '‘productivity’ up at least 10% from today at three months, measured against today\'s development productivity'
  + '; also required, not part of this target: maintaining code quality; launch readiness';
const CARD = `Confirm this reading of your target: ${READING}. Question being answered: ${QUESTION}`;
/** The AIE's receipt; its closing full stop is not doubled after the answer's own "." (the card's rule). */
const RECEIPT = `Confirmed the saved target reading: ${READING}. Your recorded answer was: “${CLARIFIED}”`;
const ROUTE_MS = 60_000;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === 'productivity')!;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
/** The second turn-14 call, reconstructed (the capture holds only the refusal codes): at least 10 %. */
const TARGET = { constraint_type: 'at_least', value: 10, unit: '%', rationale: 'The user clarified the target is relative to today.' };

/** A served read in a stateful store: the read route, the level door's append (graph, facts, carriers) and its read-back. */
function world(body: Rec) {
  const sid = String(body.scenario_id);
  let bytes = JSON.stringify(body.graph);
  const graph = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const ledger: CommittedTurnLedger = { write_turn_ids: [], user_message_turn_ids: [], first_user_message: String(body.brief_text), complete: true } as never;
  const store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: String(body.brief_text) }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(x => x.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used, pending_actions: (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { opts?.onLatestRowId?.(latest()?.id ?? null); return (latest() as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readCommittedTurnLedger: async () => structuredClone(ledger),
    readFactsWithTurnFor: async ids => rows.flatMap(r => ids.includes(r.id) ? (writes.find(w => w.turn_id === r.turn_id)?.handler_facts ?? [])
      .map((fact: Rec) => ({ turn_id: r.id, fact_created_at: r.created_at, fact })) : []),
    append: async write => {
      writes.push(JSON.parse(JSON.stringify(write))); if (write.graph !== undefined && write.graph !== null) bytes = JSON.stringify(write.graph);
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: sid, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  live.store = store;
  const graphWire = () => ({ ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
    graph_identity_hash: computeGraphIdentityHash(graph() as never) });
  return { sid, rows, writes, graph, graphWire };
}

let agentScript: Rec[] = [];
const toolOutputs: string[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { agentScript = []; toolOutputs.length = 0; });
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    // What the tool returned to the Agent rides in the next request as a function_call_output: kept for the rows.
    for (const item of (Array.isArray(req.input) ? req.input : []) as Rec[]) if (item?.type === 'function_call_output') toolOutputs.push(String(item.output));
    return new Response(JSON.stringify(agentScript.shift() ?? say('Done.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec, script: Rec[] = []): Promise<Rec> => {
    agentScript = [...script];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}

describe('G through the real route: the 13:18 asked draft — clarification → card → press → saved → read back', () => {
  it('the clarification offers ONE card with its own button; the press writes only the answer; the reply and store say so', async () => {
    const w = world(ASKED);
    const turn = await route(w);
    const offer = await turn({ message: CLARIFIED }, [call('propose_goal_target', TARGET), say('Here is the reading to confirm.')]);
    const proposed = (offer._agent.tool_calls as Rec[]).filter(c => c.name === 'propose_goal_target');
    expect(proposed, JSON.stringify(offer._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true, mutated: false })]);
    const pid = String(proposed[0]!.proposal_id);
    const chip = (offer.suggested_actions as Rec[]).find(c => c.id === approvalChipIdFor(pid));
    expect(chip, JSON.stringify(offer.suggested_actions)).toMatchObject({ label: 'Yes, read it that way', message: 'Yes, read my target that way.', detail: CARD });
    expect(w.graph()).toEqual(ASKED.graph);
    // The press, as the UI sends it.
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    const writes = (pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change');
    expect(writes, JSON.stringify(pressed._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: pid })]);
    const answered = structuredClone(ASKED.graph) as Rec;
    delete goalOf(answered).goal_target_basis.open_question;
    expect(w.graph()).toEqual(answered);
    expect(goalOf(w.graph()).goal_target_basis).toMatchObject({ source: 'olumi_reading', also_required: ['maintaining code quality', 'launch readiness'] });
    // The committed row keeps the question's card and the user's verbatim answer (the existing ledger and history).
    const committed = JSON.stringify(w.writes);
    expect(committed).toContain(JSON.stringify(RECEIPT).slice(1, -1));
    expect(committed).toContain(JSON.stringify(CLARIFIED).slice(1, -1));
    expect(committed).toContain(JSON.stringify(QUESTION).slice(1, -1));
    // The same press again is the store's replay: nothing written twice.
    const graphRows = () => w.writes.filter((x) => x.graph !== undefined && x.graph !== null).length;
    const before = graphRows();
    await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect(graphRows()).toBe(before);
    expect(w.graph()).toEqual(answered);
  }, ROUTE_MS);
});

describe('G14 through the real route: the 07:44 saved goal — the restatement is "already saved", never "refused"', () => {
  it('the turn-14 words and the reconstructed call → ok, already_saved with the saved meaning reaching the Agent; no card, nothing written', async () => {
    const w = world(SAVED);
    const turn = await route(w);
    const body = await turn({ message: CLARIFIED }, [call('propose_goal_target', TARGET), say('Your saved goal already reads that way.')]);
    const proposed = (body._agent.tool_calls as Rec[]).filter(c => c.name === 'propose_goal_target');
    expect(proposed, JSON.stringify(body._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true, mutated: false })]);
    expect(proposed[0]!.refusal).toBeUndefined();
    const output = toolOutputs.map((o) => JSON.parse(o) as Rec).find((o) => o.already_saved === true);
    expect(output, toolOutputs.join('\n')).toMatchObject({ ok: true, mutated: false, already_saved: true,
      saved_goal: { target_frame: 'change_abs', target_raw: 10, reference: 'today', denominator: 'today’s productivity', period_months: 3 },
      saved_reading: '‘Productivity’ up at least 10% from today at three months, measured against today’s productivity; also required, not part of '
        + 'this target: maintaining code quality', note: ALREADY_SAVED_NOTE });
    expect((body.suggested_actions as Rec[] ?? []).filter(c => String(c.id).startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(w.graph()).toEqual(SAVED.graph);
  }, ROUTE_MS);
});
