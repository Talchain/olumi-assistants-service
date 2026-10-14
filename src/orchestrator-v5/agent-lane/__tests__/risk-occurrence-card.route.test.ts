/**
 * ⭐ HIRING PATH (a) THROUGH THE REAL ROUTE (DL 14 Oct): "propose a labelled starting assumption" for the RISK root → ONE card
 * → the press → the one writer → the store → readiness admits the Run → a cold reopen keeps it.
 *
 * Served hiring post3007 (CEE 35a66525, `live/runs/2026-10-14T031016Z-hiring-post3007/hiring/reads/01`): the whole Run was
 * withheld on "Code quality deterioration" (a risk root, no level), and `propose_assumptions` refused it (`not_a_factor`), so
 * the ask's promise had no path. THE PATH: the REAL `agentV1TurnRoute` (Fastify inject, the UI's request shape) → the REAL
 * Agent loop → the REAL `propose_assumptions` → the card's chip → the press (`chip_click`) → `authoriseChange` → the REAL
 * in-process level door (`commitOptionLevelsInProcess` → `risk_occurrence`) → the store's append → the read-back. The graph is
 * the served `/graph` read, verbatim. Scripted: only the Agent's outputs. 0 provider calls. TESTED, not WIRE-WITNESSED.
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
  getAdapter: () => { throw new Error('Providers forbidden in the risk-occurrence route replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the risk-occurrence route replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { approvalChipIdFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
const SERVED = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body as Rec;
const RISK = 'code_quality_deterioration';
const LABEL = 'Code quality deterioration';
const ASK = 'How likely or how large is "Code quality deterioration" today? The numerical analysis is withheld until this risk has a '
  + 'supported value. You can also ask Olumi to propose a labelled starting assumption for review.';
const BASIS = 'Adding people under a three-month launch deadline often strains review time.';
const ARGS = { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: BASIS, user_stated: false,
  occurrence_range: { low_percent: 20, high_percent: 40 } }] };
const BLOCK = { version: 1, occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'olumi' }, horizon: { months: 3 } };
/** AIE_TEXT_PENDING: the card and receipt, literal here so a change to either is a visible diff. */
const CARD = 'Adopt Olumi’s starting assumption: the chance that ‘Code quality deterioration’ happens at least once within 3 months is '
  + '20–40%. It stays Olumi’s estimate after you approve it, and the size of its effect is still Olumi’s placeholder.\n'
  + `Olumi's proposed basis for this estimate (any claimed earlier statement remains unverified unless shown with its verified source): “${BASIS}”`;
const RECEIPT = 'Recorded Olumi’s starting assumption: the chance that ‘Code quality deterioration’ happens at least once within 3 months '
  + 'is 20–40%. It stays marked as Olumi’s estimate: your approval applied it, it did not make it your judgement.';
const ROUTE_MS = 60_000;
const riskOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === RISK)!;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
const levelAsks = (g: Rec): Rec[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[]).filter((i) => i.code === 'MISSING_FACTOR_LEVEL');

/** The served read in a stateful store: the read route, the level door's append (graph, facts) and its read-back. */
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
/** The readiness the model was SENT on the last turn: the item that IS the CURRENT MODEL STATE. */
const sentReadiness = (): Rec => {
  const state = sentBodies.flatMap((b) => ((b.input ?? []) as Rec[]).flatMap((i) => (Array.isArray(i.content) ? i.content as Rec[] : [])))
    .map((c) => String(c.text ?? '')).filter((t) => t.startsWith('CURRENT MODEL STATE')).at(-1)!;
  const json = state.slice(state.indexOf('{'));
  return (JSON.parse(json.slice(0, json.lastIndexOf('}') + 1)) as Rec).readiness as Rec;
};
const offerCard = async (turn: Awaited<ReturnType<typeof route>>) => {
  const offer = await turn({ message: 'Please propose a labelled starting assumption for it.', source: 'composer' },
    [call('propose_assumptions', ARGS), say('Here is Olumi’s starting assumption to review.')]);
  const proposed = (offer._agent.tool_calls as Rec[]).filter(c => c.name === 'propose_assumptions');
  expect(proposed, JSON.stringify(offer._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true, mutated: false })]);
  const pid = String(proposed[0]!.proposal_id);
  return { offer, pid, chip: (offer.suggested_actions as Rec[]).find(c => c.id === approvalChipIdFor(pid)) };
};

describe('Hiring path (a): Olumi’s starting assumption for the risk root, through the real route', () => {
  it('precondition (served): the risk root has no level and no cause, and readiness withholds the whole Run with the ask', () => {
    expect(riskOf(SERVED.graph)).toEqual({ id: RISK, ref: 'R1', kind: 'risk', label: LABEL, provenance: 'ai_inferred' });
    expect((SERVED.graph.edges as Rec[]).filter((e) => e.to === RISK)).toEqual([]);
    expect(buildCanonicalAnalysisReadyFromGraph(SERVED.graph)).toMatchObject({ may_run: false });
    expect(levelAsks(SERVED.graph).map((i) => [i.factor_id, i.message])).toEqual([[RISK, ASK]]);
  });

  it('GREEN: propose → ONE card → the press → saved as Olumi’s → the Run is admitted → a cold reopen keeps it', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const { offer, pid, chip } = await offerCard(turn);
    expect(chip, JSON.stringify(offer.suggested_actions)).toMatchObject({ label: 'Use as a starting assumption', detail: CARD });
    expect((offer.suggested_actions as Rec[]).filter(c => String(c.id).startsWith('agent-approve'))).toHaveLength(1);
    expect(JSON.parse(toolOutputs.at(-1)!)).toMatchObject({ ok: true, public_label: CARD,
      risk_assumption: { risk: LABEL, chance_low_percent: 20, chance_high_percent: 40, within_months: 3, olumis_estimate: true } });
    expect(w.graph()).toEqual(SERVED.graph);

    // The press, as the UI sends it.
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    const writes = (pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change');
    expect(writes, JSON.stringify(pressed._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: pid })]);
    // ONLY the risk's block moved; it stays Olumi's (approval is not authorship), and its link stays Olumi's placeholder.
    const expected = structuredClone(SERVED.graph) as Rec;
    riskOf(expected).event_risk = BLOCK;
    expect(w.graph()).toEqual(expected);
    expect((w.graph().edges as Rec[]).filter((e) => e.from === RISK).map((e) => e.provenance)).toEqual([
      { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true }]);
    expect(JSON.stringify(w.writes)).toContain(JSON.stringify(RECEIPT).slice(1, -1));

    // The Run: readiness admits it, no level is owed, and the Run's sent graph carries the risk with Olumi's range.
    expect(buildCanonicalAnalysisReadyFromGraph(w.graph())).toMatchObject({ may_run: true });
    expect(levelAsks(w.graph())).toEqual([]);
    const sent = guardAnalysisParticipation(w.graph(), { goalNodeId: 'productivity' });
    expect(sent).toMatchObject({ excludedNodeIds: [], refusals: [] });
    expect(riskOf(sent.graph as Rec).event_risk).toEqual(BLOCK);

    // A cold reopen (a fresh agent session over the stored model): the AI is sent a Run it may offer, the ask gone.
    sentBodies.length = 0;
    await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() });
    const readiness = sentReadiness();
    expect(readiness).toMatchObject({ checked: true, may_run: true });
    expect(JSON.stringify(readiness.needs_from_user ?? [])).not.toContain(LABEL);
  }, ROUTE_MS);

  it('CONTRAST: a typed yes is not the press (card-only): nothing is written and the Run stays withheld', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const { offer, pid } = await offerCard(turn);
    const typed = await turn({ message: 'Yes, use that.', source: 'composer', agent_session_id: offer._agent.session_id },
      [call('authorise_change', { proposal_id: pid }), say('Done.')]);
    expect((typed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change'))
      .toEqual([expect.objectContaining({ ok: false, mutated: false })]);
    expect(w.graph()).toEqual(SERVED.graph);
    expect(levelAsks(w.graph()).map((i) => i.factor_id)).toEqual([RISK]);
  }, ROUTE_MS);

  it('CONTRAST: a declined card writes nothing', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const { offer } = await offerCard(turn);
    await turn({ message: 'No, leave it as it is.', source: 'composer', agent_session_id: offer._agent.session_id }, [say('Left as it is.')]);
    expect(w.graph()).toEqual(SERVED.graph);
    expect(w.writes.filter((x) => x.graph !== undefined && x.graph !== null)).toEqual([]);
  }, ROUTE_MS);

  it('CONTRAST: a risk that holds a level gets no card (unchanged: not a factor)', async () => {
    const valued = structuredClone(SERVED) as Rec;
    riskOf(valued.graph).observed_state = { value: 0.3, source: 'cee_inference' };
    const w = world(valued);
    const turn = await route(w);
    const offer = await turn({ message: 'Please propose a labelled starting assumption for it.', source: 'composer' },
      [call('propose_assumptions', ARGS), say('Done.')]);
    expect((offer._agent.tool_calls as Rec[]).find(c => c.name === 'propose_assumptions')).toMatchObject({ ok: false, refusal: 'nothing_to_adopt' });
    expect(JSON.parse(toolOutputs.at(-1)!)).toMatchObject({ not_a_factor: [{ label: LABEL, kind: 'risk' }] });
    expect((offer.suggested_actions ?? []).filter((c: Rec) => String(c.id).startsWith('agent-approve'))).toEqual([]);
    expect(w.graph()).toEqual(valued.graph);
  }, ROUTE_MS);

  it('CONTRAST: a factor root is unchanged: its starting value is the value door’s own card, never a risk range', async () => {
    const blank = structuredClone(SERVED) as Rec;
    delete (blank.graph.nodes as Rec[]).find((n) => n.id === 'leadership_coverage')!.observed_state;
    const w = world(blank);
    const turn = await route(w);
    const offer = await turn({ message: 'Please propose a starting value for leadership coverage.', source: 'composer' },
      [call('propose_assumptions', { assumptions: [{ factor_label: 'Leadership coverage', value: 40, unit: '%', basis: BASIS, user_stated: false,
        occurrence_range: { low_percent: 20, high_percent: 40 } }] }), say('Done.')]);
    const proposed = (offer._agent.tool_calls as Rec[]).find(c => c.name === 'propose_assumptions')!;
    expect(proposed).toMatchObject({ ok: true });
    const out = JSON.parse(toolOutputs.at(-1)!) as Rec;
    expect(out).not.toHaveProperty('risk_assumption');
    expect(out.assumptions).toEqual([expect.objectContaining({ factor: 'Leadership coverage', value: 40, unit: '%' })]);
  }, ROUTE_MS);

  it('CONTRAST: a risk named without a range gets no card, and the Agent is told the range it may propose', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const { occurrence_range: _range, ...noRange } = ARGS.assumptions[0]!;
    const offer = await turn({ message: 'Please propose a labelled starting assumption for it.', source: 'composer' },
      [call('propose_assumptions', { assumptions: [noRange] }), say('Done.')]);
    expect((offer._agent.tool_calls as Rec[]).find(c => c.name === 'propose_assumptions')).toMatchObject({ ok: false, refusal: 'nothing_to_adopt' });
    expect(JSON.parse(toolOutputs.at(-1)!)).toMatchObject({ risk_occurrence_needed: [{ label: LABEL, within_months: 3 }] });
    expect(w.graph()).toEqual(SERVED.graph);
  }, ROUTE_MS);
});
