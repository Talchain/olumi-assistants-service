/**
 * ⭐ THE USER'S OWN WORDS FOR TODAY'S LEVELS, ON ONE STARTING-FIGURES CARD (DL-3 17 Oct, founder G1). Served e6253e00: the
 * founder said "probably 80% of my time on it" and "I haven't started the job specifications", yet the Run stayed without its
 * three current levels: the AI never proposed them (turns 05–18 made no level call; its reasons were the referent of "it" and
 * "progress, not allocation"). The host already carries both readings: the figure stays the user's with WHICH factor it is
 * about as Olumi's reading, and "not started" gives Olumi's zero, never "you said 0". The AI is now told so (`statements`
 * (c)/(d) on `propose_assumptions`). THE PATH: the REAL `agentV1TurnRoute` → the REAL Agent loop → the REAL
 * `propose_assumptions` → ONE card → the press → the level writer → the store → readiness → a cold reopen. The graph is the
 * served `/graph` read and the typed words are the served turns, verbatim. Scripted: only the Agent's outputs. 0 provider
 * calls. TESTED, not WIRE-WITNESSED: whether the AI takes this up is the separate real-AI witness.
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
  getAdapter: () => { throw new Error('Providers forbidden in the founder-levels route replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the founder-levels route replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const FIXTURE = JSON.parse(readFileSync('tests/fixtures/founder-levels/served-founder-e6253e00-read01.json', 'utf8')) as Rec;
const SERVED = FIXTURE.body as Rec;
const T05 = String(FIXTURE.typed['05']);
const T08 = String(FIXTURE.typed['08']);
const POC = 'founder_time_on_poc_testing_and_improvement', JOB = 'founder_time_on_job_specifications', ANGEL = 'founder_time_on_angel_outreach';
const LABEL: Record<string, string> = { [POC]: 'Founder time on PoC testing and improvement', [JOB]: 'Founder time on job specifications',
  [ANGEL]: 'Founder time on angel outreach' };
const UNIT = '% of founder working time';
const Q80 = 'I have been spending probably 80% of my time on it, and it\'s not complete, so I assume I would need to continue that amount of time to complete it quickly.';
const Q05 = 'I haven\'t started the job specifications, and if they\'re not completed, I cannot perform the recruitment process.';
const BASIS = {
  poc: 'Your figure for the time it takes today; which activity “it” means is Olumi’s reading.',
  job: 'Olumi’s provisional assumption from “I haven’t started the job specifications”: no founder time goes into them now.',
  angel: 'Olumi’s estimate, assuming these three activities take all your working time: 100 − 80 − 0 = 20.',
};
/** The two cases the AI is now SENT on `propose_assumptions` (bank for the Founder; BUDDY-A 05:45Z wording, synthetic examples). */
const CASE_C = '(c) A figure they gave for this factor’s level today in words that do not name the factor (for example "about 60% of my working time goes on it"): '
  + 'where the conversation makes this factor the one they most likely meant, form "point" with that figure as value and user_stated true; the figure '
  + 'stays theirs, and which factor it is about stays Olumi’s unverified reading after approval, shown on the card for them to accept or correct. '
  + 'Ask once instead when two factors fit, or when its time, scope or denominator is unclear.';
const CASE_D = '(d) Words saying that work on this activity has not started (for example "nobody has begun the website redesign"): form "describes", '
  + 'user_stated false, value 0 and, as basis, your assumption that no time goes into it now; zero is your provisional assumption, never their figure '
  + 'or a measurement. Words saying only that a result is unfinished or not yet reached, a plan or need, an unknown, or that the work has started do '
  + 'not ground zero.';
const ARGS = { assumptions: [
  { factor_label: LABEL[POC], value: 80, unit: UNIT, user_stated: true, basis: BASIS.poc, statements: [{ quote: Q80, form: 'point', value: 80 }] },
  { factor_label: LABEL[JOB], value: 0, unit: UNIT, user_stated: false, basis: BASIS.job, statements: [{ quote: Q05, form: 'describes' }] },
  // BUDDY-A 05:45Z: 20 only as Olumi's estimate on a disclosed premise that these three activities take all the working time.
  { factor_label: LABEL[ANGEL], value: 20, unit: UNIT, user_stated: false, basis: BASIS.angel }] };
/** The ONE card, filled by the existing starting-figures door (literals, so any change is a visible diff). */
const CARD = `From your words: “${Q80} Or, if I was to complete it more slowly, I could spend less time on it.”. The quoted source is retained; these field bindings are Olumi’s reading, including after approval. Record 1 figure you gave and adopt 2 starting assumptions: ${LABEL[ANGEL]} = 20% of founder working time\nWhy Olumi suggests this (not checked against a source unless one is shown): “${BASIS.angel}”; ${LABEL[JOB]} = 0% of founder working time\nFrom your words: “${T05}” Olumi’s figure from them is its own estimate, not yours.\nWhy Olumi suggests this (not checked against a source unless one is shown): “${BASIS.job}”; ${LABEL[POC]} = 80% of founder working time (figure from the quoted message; field binding unverified)`;
const ROUTE_MS = 60_000;

const nodeOf = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
const levelAsks = (g: Rec): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
  .filter((i) => i.code === 'MISSING_FACTOR_LEVEL').map((i) => String(i.factor_id ?? i.node_id));

/** The served read in a stateful store: the read route, the level writer's append and its read-back. */
function world(served: Rec) {
  // Each world is its own scenario: typed words from another test's turns never count as this one's.
  const sid = randomUUID();
  const body: Rec = { ...served, scenario_id: sid };
  let bytes = JSON.stringify(body.graph);
  const graph = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const ledger: CommittedTurnLedger = { write_turn_ids: [], user_message_turn_ids: [], first_user_message: String(body.brief_text), complete: true } as never;
  live.store = createMockSessionStore({
    loadGraph: async () => graph(),
    loadGraphAndBriefText: async () => ({ graph: graph(), briefText: String(body.brief_text) }),
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
  const graphWire = () => ({ ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
    graph_identity_hash: computeGraphIdentityHash(graph() as never) });
  return { sid, rows, writes, graph, graphWire };
}

let agentScript: Rec[] = [];
const toolOutputs: string[] = [];
const sentBodies: Rec[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { agentScript = []; toolOutputs.length = 0; sentBodies.length = 0; });
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const req = JSON.parse(String(init?.body ?? '{}')) as Rec;
    if (req.text?.format?.name === 'brief_spans') return new Response('{}', { status: 500 });
    sentBodies.push(req);
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

const press = async (turn: Awaited<ReturnType<typeof route>>, offer: Rec, sid: string) => {
  const pid = String((offer._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_assumptions')?.proposal_id);
  const chip = (offer.suggested_actions as Rec[]).find((c) => c.id === approvalChipIdFor(pid));
  return { pid, chip, pressed: chip === undefined ? undefined : await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: sid }) };
};
/** T05 then T08 typed in one session (the AI answers each in words), then the proposal on a later typed turn. */
const saidThenProposed = async (w: ReturnType<typeof world>, args: Rec) => {
  const turn = await route(w);
  const sid = String((await turn({ message: T05, source: 'composer' }, [say('Noted.')]))._agent.session_id);
  await turn({ message: T08, source: 'composer', agent_session_id: sid }, [say('Which activity is it?')]);
  const offer = await turn({ message: 'Can you just update the model to reflect our conversation?', source: 'composer', agent_session_id: sid },
    [call('propose_assumptions', args), say('Here is one card with today’s levels to review.')]);
  return { turn, sid, offer };
};
const graphWrites = (w: ReturnType<typeof world>) => w.writes.filter((x) => x.graph !== undefined && x.graph !== null).length;
const withoutLevels = (g: Rec) => ({ ...g, nodes: (g.nodes as Rec[]).filter((n) => ![POC, JOB, ANGEL].includes(n.id)) });

describe('the founder’s own words for today’s levels, through the real route', () => {
  it('precondition (served read): the three levels are missing and the two statements are the user’s typed turns', () => {
    expect(SERVED.graph_hash).toBe('0decea981b23b75b');
    expect(levelAsks(SERVED.graph).sort()).toEqual([ANGEL, JOB, POC].sort());
    for (const id of [POC, JOB, ANGEL]) expect(nodeOf(SERVED.graph, id).observed_state).toBeUndefined();
    expect(T08).toContain(Q80);
    expect(T05).toContain(Q05);
  });

  it('SENT: the AI is sent cases (c) and (d) on propose_assumptions, on the body actually sent', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    await turn({ message: T05, source: 'composer' }, [say('Noted.')]);
    const tool = (sentBodies[0]!.tools as Rec[]).find((t) => t.name === 'propose_assumptions')!;
    const words = String(tool.parameters.properties.assumptions.items.properties.statements.description);
    expect(words).toContain(`${CASE_C} ${CASE_D} Omit it otherwise.`);
  }, ROUTE_MS);

  it('GREEN: said earlier, proposed later → ONE card → the press → 80 stays the user’s with Olumi’s binding, 0 and 20 Olumi’s → no level ask → a cold reopen keeps the binding unverified', async () => {
    const w = world(SERVED);
    const { turn, sid, offer } = await saidThenProposed(w, ARGS);
    expect((offer._agent.tool_calls as Rec[]).filter((c) => c.name === 'propose_assumptions')).toEqual([expect.objectContaining({ ok: true, mutated: false })]);
    expect((offer.suggested_actions as Rec[]).filter((c) => String(c.id).startsWith('agent-approve'))).toHaveLength(1);
    const { chip, pressed } = await press(turn, offer, sid);
    expect(chip).toMatchObject({ label: 'Record 3 figures (2 Olumi estimates)', message: 'Yes, use those.', detail: CARD });
    expect((pressed!._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(graphWrites(w)).toBe(1);
    // The user's figure keeps its human origin; WHICH factor it is about stays Olumi's reading after approval (BUDDY-A Q2).
    expect(nodeOf(w.graph(), POC)).toMatchObject({ provenance: 'user_set',
      observed_state: { value: 0.8, raw_value: 80, unit: UNIT, source: 'user_override', user_material_unverified: true } });
    // Zero and twenty are Olumi's estimates the user accepted, never figures they gave.
    for (const [id, raw] of [[JOB, 0], [ANGEL, 20]] as const) {
      expect(nodeOf(w.graph(), id)).toMatchObject({ provenance: 'ai_inferred',
        observed_state: { value: raw / 100, raw_value: raw, unit: UNIT, source: 'user_assumption', reviewed_by_user: { intent: 'confirm' } } });
      expect(nodeOf(w.graph(), id).observed_state.user_material_unverified).toBeUndefined();
    }
    // Nothing else moves, except that the level writer stamps each option's setting of these factors with the factor's own
    // frame (its `scale_frame`, 100): 3 options × 3 factors, no value changed.
    const framed = structuredClone(SERVED.graph) as Rec;
    for (const o of (framed.nodes as Rec[]).filter((n) => n.kind === 'option')) {
      for (const id of [POC, JOB, ANGEL]) if (o.interventions?.[id] !== undefined) o.interventions[id].cap = nodeOf(SERVED.graph, id).scale_frame;
    }
    expect(nodeOf(SERVED.graph, POC).scale_frame).toBe(100);
    expect(withoutLevels(w.graph())).toEqual(withoutLevels(framed));
    expect(levelAsks(w.graph())).toEqual([]);
    // A duplicate press writes nothing twice.
    await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: sid });
    expect(graphWrites(w)).toBe(1);
    // A cold reopen (a fresh agent session): the AI reads the 80 as a human figure whose role is unverified.
    toolOutputs.length = 0;
    await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() }, [call('get_canonical_state', {}), say('Here.')]);
    const entity = (JSON.parse(toolOutputs.at(-1)!) as Rec);
    const find = (v: unknown): Rec | undefined => (Array.isArray(v) ? v.map(find).find(Boolean)
      : v !== null && typeof v === 'object' ? ((v as Rec).id === POC ? v as Rec : Object.values(v as Rec).map(find).find(Boolean)) : undefined);
    expect(find(entity)).toMatchObject({ raw_value: 80, value_provenance: { origin: 'user', role: 'unverified' } });
  }, 3 * ROUTE_MS);

  // ⛔ RED until the Founder's binder (PR1, DL-3 ruling A): T08 "names" the PoC factor only through its label word "and"
  // (factorTheUserNamed), so a figure proposed in the SAME turn it is said is saved as the user's verified field claim.
  it('RED until the binder: proposed in the same turn the figure is said, which factor it is about stays Olumi’s reading', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const sid = String((await turn({ message: T05, source: 'composer' }, [say('Noted.')]))._agent.session_id);
    const offer = await turn({ message: T08, source: 'composer', agent_session_id: sid }, [call('propose_assumptions', ARGS), say('Here is one card.')]);
    const { chip } = await press(turn, offer, sid);
    expect(chip?.detail).toContain(`${LABEL[POC]} = 80% of founder working time (figure from the quoted message; field binding unverified)`);
    expect(nodeOf(w.graph(), POC).observed_state).toMatchObject({ raw_value: 80, user_material_unverified: true });
  }, 3 * ROUTE_MS);

  it.each([
    ['zero claimed as the user’s figure', { ...ARGS.assumptions[1]!, user_stated: true, statements: [{ quote: Q05, form: 'point', value: 0 }] }, 'origin_unknown', true],
    ['a figure the user never said (80 before they said it)', ARGS.assumptions[0]!, 'origin_unknown', false],
    ['Olumi’s own words quoted as the user’s', { ...ARGS.assumptions[1]!, statements: [{ quote: 'Which activity is it?', form: 'describes' }] }, 'description_not_stated', true],
  ] as const)('⛔ CONTRAST: %s → refused, no card, nothing written', async (_why, a, refusal, saidT08) => {
    const w = world(SERVED);
    const turn = await route(w);
    const sid = String((await turn({ message: T05, source: 'composer' }, [say('Noted.')]))._agent.session_id);
    if (saidT08) await turn({ message: T08, source: 'composer', agent_session_id: sid }, [say('Which activity is it?')]);
    const offer = await turn({ message: 'Can you just update the model to reflect our conversation?', source: 'composer', agent_session_id: sid },
      [call('propose_assumptions', { assumptions: [a] }), say('Done.')]);
    expect((offer._agent.tool_calls as Rec[]).find((c) => c.name === 'propose_assumptions')).toMatchObject({ ok: false, mutated: false, refusal });
    expect((offer.suggested_actions ?? []).filter((c: Rec) => String(c.id).startsWith('agent-approve'))).toEqual([]);
    expect(w.graph()).toEqual(SERVED.graph);
    expect(graphWrites(w)).toBe(0);
  }, 3 * ROUTE_MS);
});
