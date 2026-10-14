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
/** AIE packet 6e52e896 `event_risk.readiness_copy` (the eligible event path), then the ask's existing sentences. */
const ASK = 'Is ‘Code quality deterioration’ already true now? If so, say so. If not: How likely is ‘Code quality deterioration’ to happen at least once within 3 months? Olumi can’t run the numbers until '
  + 'this risk has a figure. Or ask Olumi to suggest a starting estimate for you to review.';
const BASIS = 'Adding people under a three-month launch deadline often strains review time.';
const ARGS = { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: BASIS, user_stated: false,
  occurrence_range: { low_percent: 20, high_percent: 40 } }] };
const BLOCK = { version: 1, occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'olumi' }, horizon: { months: 3 } };
/** AIE packet 6e52e896 (#94 6161383921) `event_risk.card` / `.basis_line` / `.receipt`, filled by hand: literals, so any change is a visible diff. */
const CARD = 'Adopt Olumi’s starting assumption: the chance that ‘Code quality deterioration’ happens at least once within 3 months is 20–40%. This is an estimate, not a measurement, and it stays Olumi’s after approval. How strongly it affects the model, and whether it does at all, are separate Olumi guesses you can change.'
  + `\nWhy Olumi suggests this (not checked against a source unless one is shown): “${BASIS}”`;
const RECEIPT = 'Recorded Olumi’s starting assumption: the chance that ‘Code quality deterioration’ happens at least once within 3 months is 20–40%. It stays marked as Olumi’s estimate: your approval applied it, it did not make it your judgement.';
const ROUTE_MS = 60_000;
/** The lapse a held card is said with (`heldLapseSentence`, 'model_changed'). */
const LAPSE = /no longer fits the model as it now stands, so it has lapsed/;
const onLatestRow = (w: { rows: SessionTurnWithContent[] }, chipId: string): boolean =>
  ((w.rows.find((r) => !r.turn_id.endsWith(':claim')) as Rec | undefined)?.pending_actions ?? []).some((p: Rec) => p.chip_id === chipId);
/** A claim that adopting the card licenses or readies the Run (PL 05:53Z: never made). */
const NO_RUN_CLAIM = /\b(you can|can now|ready to|able to) run\b|licen[cs]/i;
const riskOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === RISK)!;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
/** The served read with a saved 3-month window, 14 October 2026 to 14 January 2027 (Codex r1's shape). */
const DATED = (() => { const b = structuredClone(SERVED) as Rec; Object.assign(goalOf(b.graph), { goal_horizon: { deadline: '2027-01-14' },
  goal_horizon_reference_date: '2026-10-14', goal_horizon_months: 3, goal_horizon_stated_months: 3 }); return b; })();
const levelAsks = (g: Rec): Rec[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[]).filter((i) => i.code === 'MISSING_FACTOR_LEVEL');

/** The served read in a stateful store: the read route, the level door's append (graph, facts) and its read-back. */
function world(body: Rec, opts: { raceAfterWrite?: (g: Rec) => void; beforeDoorRead?: (g: Rec) => void } = {}) {
  const sid = String(body.scenario_id);
  let raced = false, doorRaced = false;
  let bytes = JSON.stringify(body.graph);
  const graph = (): Rec => JSON.parse(bytes);
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const ledger: CommittedTurnLedger = { write_turn_ids: [], user_message_turn_ids: [], first_user_message: String(body.brief_text), complete: true } as never;
  // Another writer that lands after the press's own read and before the level door reads the store (the buddy's r3 probe).
  const doorRead = () => {
    if (opts.beforeDoorRead !== undefined && !doorRaced && new Error().stack?.includes('executeOptionInterventionBatch')) {
      doorRaced = true; const g = graph(); opts.beforeDoorRead(g); bytes = JSON.stringify(g);
    }
  };
  const store = createMockSessionStore({
    loadGraph: async () => { doorRead(); return graph(); },
    loadGraphAndBriefText: async () => { doorRead(); return { graph: graph(), briefText: String(body.brief_text) }; },
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
  const graphWire = () => {
    // A concurrent writer that lands right after the risk's own write, before the press reads it back (Codex r1's race).
    if (opts.raceAfterWrite !== undefined && !raced && riskOf(graph()).event_risk !== undefined) {
      raced = true; const g = graph(); opts.raceAfterWrite(g); bytes = JSON.stringify(g);
    }
    return { ...structuredClone(body), graph: graph(), graph_hash: computeAnalysisAffectingGraphHash(graph() as never),
      graph_identity_hash: computeGraphIdentityHash(graph() as never) };
  };
  return { sid, rows, writes, graph, graphWire, replace: (g: Rec) => { bytes = JSON.stringify(g); } };
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
  it('precondition (served graph): the risk root has no level and no cause; readiness withholds the whole Run and asks the event question (AIE)', () => {
    expect(riskOf(SERVED.graph)).toEqual({ id: RISK, ref: 'R1', kind: 'risk', label: LABEL, provenance: 'ai_inferred' });
    expect((SERVED.graph.edges as Rec[]).filter((e) => e.to === RISK)).toEqual([]);
    expect(buildCanonicalAnalysisReadyFromGraph(SERVED.graph)).toMatchObject({ may_run: false });
    expect(levelAsks(SERVED.graph).map((i) => [i.factor_id, i.message])).toEqual([[RISK, ASK]]);
  });

  it('GREEN: propose → ONE card → the press → saved as Olumi’s → the Run is admitted → a cold reopen keeps it', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const { offer, pid, chip } = await offerCard(turn);
    expect(chip, JSON.stringify(offer.suggested_actions)).toMatchObject({ label: 'Use as a starting assumption', message: 'Yes, use that.', detail: CARD });
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
    // PL 05:53Z: the risk's own origin is unchanged; only its occurrence carries Olumi's basis.
    expect(riskOf(w.graph()).provenance).toBe(riskOf(SERVED.graph).provenance);
    expect(riskOf(w.graph()).event_risk.occurrence.basis).toBe('olumi');
    // Adoption alone never claims the Run: neither the card nor the receipt speaks of running.
    expect(`${chip!.detail}\n${pressed.assistant_text}`).not.toMatch(NO_RUN_CLAIM);
    expect((w.graph().edges as Rec[]).filter((e) => e.from === RISK).map((e) => e.provenance)).toEqual([
      { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true }]);
    expect(JSON.stringify(w.writes)).toContain(JSON.stringify(RECEIPT).slice(1, -1));
    // A duplicate press writes nothing twice: the model and the count of graph writes are unchanged.
    const graphWrites = w.writes.filter((x) => x.graph !== undefined && x.graph !== null).length;
    await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect(w.graph()).toEqual(expected);
    expect(w.writes.filter((x) => x.graph !== undefined && x.graph !== null)).toHaveLength(graphWrites);

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

  // Words typed that EXACTLY equal the one waiting card's button ARE that press (R2 T1, `agent-v1-turn.ts`); any other yes is not.
  it('CONTRAST: a typed yes that is not the card’s own words is not the press (card-only): nothing is written', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const { offer, pid } = await offerCard(turn);
    const typed = await turn({ message: 'Yes, go ahead.', source: 'composer', agent_session_id: offer._agent.session_id },
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

  it('#3024’s rule: an unrelated model edit never retires the waiting risk card; its press then writes', async () => {
    const w = world({ ...structuredClone(SERVED), scenario_id: randomUUID() });
    const turn = await route(w);
    const { offer, chip } = await offerCard(turn);
    const g = w.graph(); const before = computeAnalysisAffectingGraphHash(g as never);
    (g.edges as Rec[]).find((e) => e.from === 'leadership_coverage')!.strength = { mean: 0.1, std: 0.05 };
    expect(computeAnalysisAffectingGraphHash(g as never), 'the model moved').not.toBe(before);
    w.replace(g);
    const next = await turn({ message: 'And now?', source: 'composer', agent_session_id: offer._agent.session_id });
    expect(String(next.assistant_text)).not.toMatch(LAPSE);
    expect(onLatestRow(w, chip!.id), 'the card is still waiting').toBe(true);
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect((pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(riskOf(w.graph()).event_risk).toEqual(BLOCK);
    expect((w.graph().edges as Rec[]).find((e) => e.from === 'leadership_coverage')!.strength).toEqual({ mean: 0.1, std: 0.05 });
  }, ROUTE_MS);

  it('⛔ Codex r1 STALE WINDOW: a card made for 14 Oct–14 Jan, the saved window moved to 14 Nov–14 Feb (hash unchanged) → the press writes nothing, no receipt', async () => {
    const w = world(DATED);
    const turn = await route(w);
    const { offer, chip } = await offerCard(turn);
    const shifted = w.graph();
    Object.assign(goalOf(shifted), { goal_horizon: { deadline: '2027-02-14' }, goal_horizon_reference_date: '2026-11-14' });
    expect(computeAnalysisAffectingGraphHash(shifted as never)).toBe(computeAnalysisAffectingGraphHash(DATED.graph as never));
    w.replace(shifted);
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect((pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change'))
      .toEqual([expect.objectContaining({ ok: false, mutated: false })]);
    expect(riskOf(w.graph())).not.toHaveProperty('event_risk');
    expect(w.graph()).toEqual(shifted);
    expect(JSON.stringify([pressed.assistant_text, w.writes])).not.toContain(JSON.stringify(RECEIPT).slice(1, -1));
    // Codex r2: the obsolete card is retired and SAID (#3024's rule), never offered again as it stood.
    expect(String(pressed.assistant_text)).toMatch(LAPSE);
    expect((pressed.suggested_actions ?? []).some((c: Rec) => c.id === chip!.id)).toBe(false);
    expect(onLatestRow(w, chip!.id)).toBe(false);
  }, ROUTE_MS);

  it('⛔ buddy r3 (equal value, different identity): ANOTHER writer lands the EQUAL block between the press’s read and the door’s → the press is refused: no receipt, no write of its own', async () => {
    const w = world({ ...structuredClone(SERVED), scenario_id: randomUUID() }, { beforeDoorRead: (g) => { riskOf(g).event_risk = structuredClone(BLOCK); } });
    const turn = await route(w);
    const { offer, chip } = await offerCard(turn);
    const writesBefore = w.writes.filter((x) => x.graph).length;
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect(riskOf(w.graph()).event_risk, 'the equal block is the other writer’s').toEqual(BLOCK);
    const authorised = (pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change');
    expect(authorised, JSON.stringify(authorised)).toEqual([expect.objectContaining({ ok: false, mutated: false })]);
    expect(w.writes.filter((x) => x.graph), 'no graph write of its own').toHaveLength(writesBefore);
    expect(JSON.stringify([pressed.assistant_text, w.writes])).not.toContain(JSON.stringify(RECEIPT).slice(1, -1));
  }, ROUTE_MS);

  it('⛔ Codex r1 RACED READ-BACK: the goal moves from 3 to 6 months as the write lands → not confirmed: no receipt, no may_run', async () => {
    // Its own scenario: a proposal's id is its content's, so the GREEN row's applied card must not be this one.
    const w = world({ ...structuredClone(SERVED), scenario_id: randomUUID() }, { raceAfterWrite: (g) => { goalOf(g).goal_target_basis.period_months = 6; } });
    const turn = await route(w);
    const { offer, chip } = await offerCard(turn);
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect((pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change'))
      .toEqual([expect.objectContaining({ ok: false, mutated: true, refusal: 'not_confirmed' })]);
    expect(goalOf(w.graph()).goal_target_basis.period_months).toBe(6);
    // No receipt in the reply or its answer row (the door's own inner row records the write that did land), no Run offered on
    // the strength of it, and the reply says the save is unconfirmed.
    expect(JSON.stringify([pressed.assistant_text, w.writes.at(-1)])).not.toContain(JSON.stringify(RECEIPT).slice(1, -1));
    expect(pressed.suggested_actions ?? []).toEqual([]);
    expect(String(pressed.assistant_text)).toMatch(/could not be confirmed/);
    // Codex r2: the cold reopen admits no Run on the 3-month range under the 6-month goal; it asks the occurrence over 6 months.
    expect(buildCanonicalAnalysisReadyFromGraph(w.graph())).toMatchObject({ may_run: false });
    expect(levelAsks(w.graph()).filter((i) => i.factor_id === RISK).map((i) => i.message)).toEqual([
      'Is ‘Code quality deterioration’ already true now? If so, say so. If not: How likely is ‘Code quality deterioration’ to happen at least once within 6 months? Olumi can’t run the numbers until this risk has a figure. Or ask Olumi to suggest a starting estimate for you to review.']);
    sentBodies.length = 0;
    await turn({ message: 'Where are we?', source: 'composer', agent_session_id: randomUUID() });
    expect(sentReadiness()).toMatchObject({ checked: true, may_run: false });
    expect(JSON.stringify(sentReadiness())).toContain(LABEL);
  }, ROUTE_MS);

  it('PL 05:53Z: NO saved goal period → no card, and the ask never promises one', async () => {
    const unperiod = structuredClone(SERVED) as Rec;
    delete goalOf(unperiod.graph).goal_target_basis;
    const w = world(unperiod);
    const turn = await route(w);
    const offer = await turn({ message: 'Please propose a labelled starting assumption for it.', source: 'composer' },
      [call('propose_assumptions', ARGS), say('Done.')]);
    expect((offer._agent.tool_calls as Rec[]).find(c => c.name === 'propose_assumptions')).toMatchObject({ ok: false });
    expect((offer.suggested_actions ?? []).filter((c: Rec) => String(c.id).startsWith('agent-approve'))).toEqual([]);
    expect(w.graph()).toEqual(unperiod.graph);
    expect(levelAsks(w.graph()).filter((i) => i.factor_id === RISK).map((i) => i.message)).toEqual([
      'How likely or how large is "Code quality deterioration" today? Olumi can’t run the numbers until this risk has a figure.']);
  }, ROUTE_MS);

  it('PL 05:53Z: adoption alone never licenses the Run — another unresolved root still withholds it after the press', async () => {
    // A second risk root with no level, acting on the goal as the first does.
    const twoRoots = { ...structuredClone(SERVED), scenario_id: randomUUID() } as Rec;
    (twoRoots.graph.nodes as Rec[]).push({ id: 'key_developer_leaves', kind: 'risk', label: 'Key developer leaves', provenance: 'ai_inferred' });
    (twoRoots.graph.edges as Rec[]).push({ ...structuredClone((twoRoots.graph.edges as Rec[]).find((e) => e.from === RISK)!), from: 'key_developer_leaves' });
    expect(levelAsks(twoRoots.graph).map((i) => i.factor_id).sort()).toEqual(['code_quality_deterioration', 'key_developer_leaves']);
    const w = world(twoRoots);
    const turn = await route(w);
    const { offer, chip } = await offerCard(turn);
    const pressed = await turn({ message: chip!.message, source: 'chip_click', chip: { id: chip!.id }, agent_session_id: offer._agent.session_id });
    expect((pressed._agent.tool_calls as Rec[]).filter(c => c.name === 'authorise_change')).toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    expect(riskOf(w.graph()).event_risk).toEqual(BLOCK);
    expect(buildCanonicalAnalysisReadyFromGraph(w.graph())).toMatchObject({ may_run: false });
    expect(levelAsks(w.graph()).map((i) => i.factor_id)).toEqual(['key_developer_leaves']);
    expect(String(pressed.assistant_text)).toContain('The analysis can\'t run yet. Is ‘Key developer leaves’ already true now? If so, say so. If not: How likely is ‘Key developer leaves’ to happen at least once within 3 months?');
    expect(String(pressed.assistant_text)).not.toMatch(NO_RUN_CLAIM);
  }, ROUTE_MS);
});

/**
 * ⭐ S2 THE USER'S OWN CHANCE FOR THE RISK, THROUGH THE REAL ROUTE (DL 21:15Z 14 Oct; AIE AMEND 6179240850): Olumi asks the
 * risk's question; the user answers with their chance over a stated window; the Agent only replies; the route issues ONE card
 * quoting their sentence, bound by Olumi's own preceding question (never by elimination); the press writes it through the same
 * level door, as THEIRS (`basis: 'user'`), with their statement beside it; readiness stops asking.
 */
describe('S2: the user’s own chance for the risk root, through the real route', () => {
  const SAID = 'I’d say there’s about a 30% chance it slips within the next 3 months.';
  const ASKED = `The analysis can’t run yet. How likely is ‘${LABEL}’ to happen at least once within 3 months?`;
  const USER_CARD = `From your message: “${SAID}”. Olumi reads this as your estimate of about 30% that ‘${LABEL}’ happens at least once within the next 3 months `
    + 'from today. Record this reading? How strongly it affects ‘Productivity’ is a separate assumption: its effect on ‘Productivity’ is still Olumi’s placeholder, not yet sized.';
  const USERS = { version: 1, occurrence: { p_low: 0.3, p_high: 0.3, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: 3 } };
  const cardsOf = (body: Rec): Rec[] => ((body.suggested_actions ?? []) as Rec[]).filter((c) => String(c.id).startsWith('agent-approve'));
  const graphWrites = (w: { writes: Rec[] }): number => w.writes.filter((x) => x.graph !== undefined && x.graph !== null).length;

  it('RED→GREEN: Olumi asks → they answer with their chance → ONE card → the press → saved as THEIRS with their words → the ask closes', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const asked = await turn({ message: 'What do you still need from me?', source: 'composer' }, [say(ASKED)]);
    expect(cardsOf(asked)).toEqual([]);
    const said = await turn({ message: SAID, source: 'composer', agent_session_id: asked._agent.session_id }, [say('Thanks.')]);
    const cards = cardsOf(said);
    expect(cards, JSON.stringify(said.suggested_actions)).toHaveLength(1);
    expect(cards[0]).toMatchObject({ label: 'Record what you said', message: 'Yes, record what I said.', detail: USER_CARD });
    expect(graphWrites(w), 'nothing before the press').toBe(0);
    const pressed = await turn({ message: cards[0]!.message, source: 'chip_click', chip: { id: cards[0]!.id }, agent_session_id: said._agent.session_id });
    expect((pressed._agent.tool_calls as Rec[]).filter((c) => c.name === 'authorise_change'), JSON.stringify(pressed._agent.tool_calls))
      .toEqual([expect.objectContaining({ ok: true, mutated: true })]);
    const risk = riskOf(w.graph());
    expect(risk.event_risk).toEqual(USERS);
    expect(risk.occurrence_statement).toMatchObject({ speaker: 'user', quote: SAID, qualifier: 'about', period: '3 months' });
    const { event_risk: _e, occurrence_statement: _s, ...rest } = risk;
    expect(rest).toEqual(riskOf(SERVED.graph));
    expect(levelAsks(w.graph())).toEqual([]);
    expect(buildCanonicalAnalysisReadyFromGraph(w.graph())).toMatchObject({ may_run: true });
  }, ROUTE_MS);

  it('CONTRAST: “before launch”, an answer with no question asked, or a chance naming no risk when two are asked: no card, nothing written', async () => {
    const w = world(SERVED);
    const turn = await route(w);
    const asked = await turn({ message: 'What do you still need from me?', source: 'composer' }, [say(ASKED)]);
    expect(cardsOf(await turn({ message: 'I’d say there’s about a 30% chance it slips before launch.', source: 'composer',
      agent_session_id: asked._agent.session_id }, [say('Thanks.')]))).toEqual([]);
    const w1 = world({ ...structuredClone(SERVED), scenario_id: randomUUID() });
    const turn1 = await route(w1);
    expect(cardsOf(await turn1({ message: SAID, source: 'composer' }, [say('Thanks.')]))).toEqual([]);
    const two = structuredClone(SERVED) as Rec;
    two.scenario_id = randomUUID();
    two.graph.nodes.push({ id: 'key_developer_attrition', kind: 'risk', label: 'Key developer attrition', provenance: 'ai_inferred' });
    two.graph.edges.push({ from: 'key_developer_attrition', to: 'productivity', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.7, effect_direction: 'negative' });
    const w2 = world(two);
    const turn2 = await route(w2);
    expect(cardsOf(await turn2({ message: SAID, source: 'composer' }, [say('Thanks.')]))).toEqual([]);
    expect(graphWrites(w) + graphWrites(w1) + graphWrites(w2)).toBe(0);
  }, ROUTE_MS);
});
