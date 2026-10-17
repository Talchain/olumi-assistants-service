/** Captured e625 graph; declared arguments, actual register/compound ports, no live provider or engine. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../tests/utils/mock-session-store.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { createAgentCapabilities, type InternalDispatch } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { ProposalStore, type StructuredProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { approvalChipsFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { proposalPendingAction, rehydrateProposals } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { parsePendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { commitOptionLevelsInProcess } from '../../orchestrator-v5/system-events/dispatch.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../orchestrator-v5/build-turn-context.js';
import { createRunAnalysisHandler } from '../../orchestrator-v5/tools/handlers/run-analysis.js';
import { figureTheUserWrote } from '../../orchestrator-v5/agent-lane/stated-by-user.js';
import { sourceMapOf, subjectKey } from '../../orchestrator-v5/agent-lane/construction-source-map.js';
vi.mock('../../config/index.js', async original => {
 const actual = await original<typeof import('../../config/index.js')>();
 return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false, hmacSecret: 'native-founder-captured-contract-test-only-key' } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async original => ({ ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!) }));
vi.mock('../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import registerRoute from '../assist.v1.scenario-graph-register.js';
type Rec = Record<string, any>;
const close: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of close.splice(0)) await fn(); });
const jsonbOrder = (v: unknown): unknown => Array.isArray(v) ? v.map(jsonbOrder)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)).map(([k, x]) => [k, jsonbOrder(x)])) : v;
function restoreCard(proposal: StructuredProposal, result: Rec, ctx: AgentToolContext): ProposalStore {
  const chip = approvalChipsFor([{ name: 'propose_change', ...result } as never], () => ({ proposal, result: result as never }))[0]!;
  const carrier = parsePendingAction(jsonbOrder(JSON.parse(JSON.stringify(proposalPendingAction(proposal, chip,
    { scenario_id: ctx.scenario_id, emitted_at_iso: new Date().toISOString() })))));
  expect(carrier).not.toBeNull();
  const store = new ProposalStore();
  expect(rehydrateProposals([carrier!], store, { scenario_id: ctx.scenario_id, user_id: null })).toBe(1);
  return store;
}

async function world(row: { readonly graph: Rec; readonly brief: string; readonly message: string }, options: { race?: boolean; loseAcknowledgement?: boolean; hideLedger?: boolean; provider?: (...args: any[]) => Promise<any>; ledger?: Rec; objections?: { finding_id: string; analysis_id: string; statement: string }[] } = {}) {
  let graph = structuredClone(row.graph) as Rec;
  const original = structuredClone(graph);
  const writes: Rec[] = [];
  const sent: Rec[] = [];
  const sid = randomUUID();
  storeRef.value = {
    ...createMockSessionStore(),
    readRecent: async () => writes.map((write, i) => makeSessionTurnRow({ id: `row-${i}`, scenario_id: write.scenario_id, turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id, request_hash: write.request_hash, response_emitted: write.response_emitted, llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms })),
    readFactsWithTurnFor: async (ids: string[]) => writes.flatMap((write, i) => ids.includes(`row-${i}`) ? (write.handler_facts ?? []).map((fact: Rec) => ({ turn_id: `row-${i}`, fact_created_at: "2026-10-17T00:00:00.000Z", fact })) : []),
    append: vi.fn(async (write: Rec) => { writes.push(write); graph = structuredClone(write.graph); return { id: `row-${writes.length-1}` }; }),
    loadGraph: async () => structuredClone(graph), loadGraphAndBriefText: async () => ({ graph, briefText: row.brief }),
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null, scenarioExists: async () => true,
    readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify(); await registerRoute(app); await app.ready(); close.push(() => app.close());
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph), brief_text: row.brief, scenario_created_at: '2026-10-16T00:00:00.000Z',
      graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    if (path.endsWith('/graph/register')) {
      sent.push(structuredClone(body as Rec));
      if (options.race) graph = { ...graph, nodes: graph.nodes.map((n: Rec, i: number) => i === 0 ? { ...n, label: `${n.label} changed concurrently` } : n) };
      const response = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Rec });
      if (options.loseAcknowledgement && response.statusCode === 200) return { status: 503, json: {} };
      return { status: response.statusCode, json: response.json() };
    }
    throw new Error(`No provider, engine or other writer is allowed: ${path}`);
  };
  const proposals = new ProposalStore();
  const caps = (store = proposals) => createAgentCapabilities(dispatch, store, options.provider, 'full', undefined, { turnAuthority: true, commitOptionLevels: input => commitOptionLevelsInProcess(input, "native-captured-unit"),
    readCommittedTurnLedger: async () => ({ first_user_message: row.brief, user_message_turn_ids: ['first'], ...options.ledger, write_turn_ids: options.hideLedger ? [] : writes.map(w => w.turn_id),
      complete: options.ledger?.complete ?? true }) as never, readStatedObjections: async () => options.objections ?? [] });
  const ctx = { scenario_id: sid, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: row.message, user_text: row.message, user_text_complete: true, verified_user_messages: [row.message] } satisfies AgentToolContext;
  return { graph: () => graph, original, writes, sent, proposals, caps, ctx };
}


const captured = JSON.parse(readFileSync(new URL('./fixtures/founder-e625-before-goal-change.json', import.meta.url), 'utf8')) as Rec;
const source = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
async function goalWorld(change?: (graph: Rec) => void, message = source) {
  const graph = structuredClone(captured.graph); change?.(graph);
  const w = await world({ graph, brief: captured.brief_text, message });
  w.ctx.verified_user_messages = [captured.brief_text, source, message]; return w;
}

describe('D1: human percentages retain their raw unit before any card or native save', () => {
  const q80 = "I have been spending probably 80% of my time on it, and it's not complete, so I assume I would need to continue that amount of time to complete it quickly.";
  it.each([{ quote: q80, value: 80, raw: 80 }, { quote: q80, value: 0.8, raw: null },
    { quote: 'I spend 40% of my time on PoC testing.', value: 40, raw: 40 }, { quote: 'I spend 40% of my time on PoC testing.', value: 0.4, raw: null },
    { quote: 'I spend 0.4% of my time on PoC testing.', value: 0.4, raw: 0.4 }])('value=$value from “$quote” keeps exact human units (raw=$raw)', async ({ quote, value, raw }) => {
    const w = await goalWorld(undefined, 'Please record the level I stated earlier.');
    w.ctx.verified_user_messages.push(quote); w.ctx.user_text = quote + '\n' + w.ctx.user_turn_text;
    const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions: [{ factor_label: 'Founder time on PoC testing and improvement', value, unit: '% of founder working time', user_stated: true, basis: 'Your stated figure, not an estimate.', statements: [{ quote, form: 'point', value }] }], option_levels: [] }), w.ctx, w.caps());
    if (raw === null) {
      expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_in_users_words' });
      expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original); return;
    }
    expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.public_label).toContain(`${raw}% of founder working time`); expect(r.public_label).toContain(quote);
    const held = w.proposals.get(String(r.proposal_id))!, cold = restoreCard(held, r, w.ctx), c = w.caps(cold);
    const press = { ...w.ctx, user_turn_text: '', typed_approval_of: held.proposal_id };
    expect(await c.authoriseChange(press, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, applied: true }); expect(w.writes).toHaveLength(1);
    const stored = w.graph().nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement');
    expect(stored.observed_state).toMatchObject({ raw_value: raw, value: raw / 100, unit: '% of founder working time', source: 'user_override' });
    expect(stored.user_statements).toEqual(w.original.nodes.find((n: Rec) => n.id === stored.id).user_statements);
    expect(stored.observed_state.user_material_unverified).toBe(true);
    expect(await c.authoriseChange(press, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(1);
  });
});


it('the one numeric verifier keeps raw percentages distinct while retaining genuine share-unit conversion', () => {
  expect(figureTheUserWrote(0.8, '% of founder working time', 'I spend 80% of my time on it.')).toBe(false);
  expect(figureTheUserWrote(80, '% of founder working time', 'I spend 80% of my time on it.')).toBe(true);
  expect(figureTheUserWrote(0.8, 'proportion', 'I spend 80% of my time on it.')).toBe(true);
  expect(figureTheUserWrote(0.4, '%', 'I spend 0.4% of my time on it.')).toBe(true);
});
it('one percent verifies as 0.01 in a declared proportion, never a whole-share value of 1', () => {
  const quote = 'Pro contributes 1% of total MRR.';
  expect(figureTheUserWrote(0.01, 'proportion', quote)).toBe(true);
  expect(figureTheUserWrote(1, 'proportion', quote)).toBe(false);
  expect(figureTheUserWrote(1, '%', quote)).toBe(true);
});
it.each(['and', 'plus'])('same-turn pronoun stays an Olumi field reading even when the label contains %s', async join => {
  const quote = "I have been spending probably 80% of my time on it, and it's not complete, so I assume I would need to continue that amount of time to complete it quickly.";
  const w = await goalWorld(g => { g.nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement').label = `Founder time on PoC testing ${join} improvement`; }, quote);
  const label = w.graph().nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement').label;
  const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions: [{ factor_label: label, value: 80, unit: '% of founder working time', user_stated: true, basis: 'Your figure' }], option_levels: [] }), w.ctx, w.caps());
  expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.public_label).toContain('field binding unverified'); expect(r.public_label).toContain(quote);
  const pid = String(r.proposal_id); expect(await w.caps(restoreCard(w.proposals.get(pid)!, r, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
  expect(w.graph().nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement').observed_state).toMatchObject({ raw_value: 80, value: 0.8, user_material_unverified: true }); expect(w.writes).toHaveLength(1);
});
it('a complete current factor name keeps the genuine bound human figure positive', async () => {
  const quote = 'Founder time on PoC testing and improvement is 80% of founder working time today.';
  const w = await goalWorld(undefined, quote);
  const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions: [{ factor_label: 'Founder time on PoC testing and improvement', value: 80, unit: '% of founder working time', user_stated: true, basis: 'Your figure' }], option_levels: [] }), w.ctx, w.caps());
  expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.public_label).not.toContain('field binding unverified');
  const pid = String(r.proposal_id); expect(await w.caps(restoreCard(w.proposals.get(pid)!, r, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
  const os = w.graph().nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement').observed_state;
  expect(os).toMatchObject({ raw_value: 80, value: 0.8, source: 'user_override' }); expect(os.user_material_unverified).not.toBe(true); expect(w.writes).toHaveLength(1);
});

describe('D3: a numeric quote cannot ground a figure-free describes estimate', () => {
  it('the captured qualitative goal measure keeps its whole numeric source and qualifications without becoming a level estimate', () => {
    const held = captured.graph.nodes.find((n: Rec) => n.id === 'funding_secured').user_statements[0].statements[0];
    const subject = { kind: 'goal' as const, label: 'Funding secured' };
    const map = sourceMapOf([{ ...held, subject, field: 'measure' }], captured.brief_text);
    expect(map.refused).toEqual([]);
    expect(map.verified.get(subjectKey(subject, 'measure'))).toEqual([expect.objectContaining({ quote: held.quote,
      source: held.source, form: 'describes', qualifier: 'urgently', conditions: held.conditions, reading: 'olumi' })]);
  });
  it.each([{ quote: '20% of my time is going into them.', ok: false, unit: '% of founder working time' },
    { quote: '20% of my time is going into them.', ok: false, unit: '' },
    { quote: "I haven't started the job specifications, and if they're not completed, I cannot perform the recruitment process.", ok: true, unit: '% of founder working time' }])('qualitative zero from “$quote” in unit “$unit” is offered=$ok', async ({ quote, ok, unit }) => {
    const w = await goalWorld(undefined, quote);
    const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions: [{ factor_label: 'Founder time on job specifications', value: 0, unit, user_stated: false, basis: 'Olumi reads the quoted description as no time spent now; provisional, not a measurement.', statements: [{ quote, form: 'describes' }] }], option_levels: [] }), w.ctx, w.caps());
    if (!ok) { expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'description_not_stated' }); expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original); return; }
    expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.public_label).toContain(quote); expect(r.public_label).toContain('Olumi’s figure from them is its own estimate, not yours');
    expect(r.public_label).not.toContain('figure you gave'); const pid = String(r.proposal_id);
    expect(await w.caps(restoreCard(w.proposals.get(pid)!, r, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.find((n: Rec) => n.id === 'founder_time_on_job_specifications').observed_state).toMatchObject({ raw_value: 0, value: 0, source: 'user_assumption' }); expect(w.writes).toHaveLength(1);
  });
  it('a time percentage elsewhere in the whole statement does not become a figure for a unit-free experience estimate', async () => {
    const quote = "I can't spend more than 25% of my time on this, and I'm not that experienced with marketing.";
    const w = await goalWorld(g => { g.nodes.push({ id: 'marketing_experience', kind: 'factor', label: 'Marketing experience', scale_frame: 100, provenance: 'from_brief' }); }, quote);
    const r = await w.caps().proposeAssumptions(w.ctx, { assumptions: [{ factor_label: 'Marketing experience', value: 20, unit: '', user_stated: false,
      basis: 'Olumi proposes an experience estimate from the qualitative description, not from the time limit.', statements: [{ quote, form: 'describes' }] }] });
    expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.public_label).toContain(quote);
    expect(r.public_label).toContain('Olumi’s figure from them is its own estimate, not yours');
    expect(w.proposals.get(String(r.proposal_id))!.operations[0]!.value).toMatchObject({ authored_by: 'model_proposed', value: 20 });
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
  });
});

it('the real Run reader and final payload keep human 80% at model 0.8, never 0.8%', async () => {
  const quote = 'I have been spending probably 80% of my time on it.';
  const w = await goalWorld(undefined, 'Record those current levels.'); w.ctx.user_text = quote; w.ctx.verified_user_messages.push(quote);
  const assumptions = w.graph().nodes.filter((n: Rec) => n.kind === 'factor').map((n: Rec) => ({ factor_label: n.label,
    value: n.id === 'founder_time_on_poc_testing_and_improvement' ? 80 : 10, unit: '% of founder working time',
    user_stated: n.id === 'founder_time_on_poc_testing_and_improvement', basis: 'Controlled native reader test, other levels are Olumi assumptions.' }));
  const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions, option_levels: [] }), w.ctx, w.caps()), pid = String(r.proposal_id);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  expect(await w.caps(restoreCard(w.proposals.get(pid)!, r, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(w.graph()), briefText: captured.brief_text }), loadGraph: async () => structuredClone(w.graph()) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(w.ctx.scenario_id, 'native-D1-read', store as never);
  expect((snapshot.graph as Rec).nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement').observed_state).toMatchObject({ value: 0.8, raw_value: 80, unit: '% of founder working time' });
  let payload: Rec | undefined;
  const engine = vi.fn(async () => { throw new Error('No engine call'); });
  await createRunAnalysisHandler({ plotClient: { run: engine } as never, scenarioReader: async () => snapshot,
    probe: async sent => { payload = sent.plotPayload; } })({ payload: { kind: 'message', scenario_id: w.ctx.scenario_id, turn_id: randomUUID(), source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis', parameters: { effects_timing: 'not_stated' } } }, requestId: 'native-D1-read', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(payload).toBeDefined(); expect(engine).not.toHaveBeenCalled(); expect(w.writes).toHaveLength(1);
  expect(payload!.graph.nodes.find((n: Rec) => n.id === 'founder_time_on_poc_testing_and_improvement').observed_state).toMatchObject({ value: 0.8 });
});
