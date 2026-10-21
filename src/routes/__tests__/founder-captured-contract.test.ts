/** Captured e625 graph; declared arguments, actual register/compound ports, no live provider or engine. */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../tests/utils/mock-session-store.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { createAgentCapabilities, levelFrameOf, type InternalDispatch } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { ProposalStore, createProposal, type StructuredProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { approvalChipsFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { proposalPendingAction, rehydrateProposals } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { parsePendingAction, type PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { commitOptionLevelsInProcess } from '../../orchestrator-v5/system-events/dispatch.js';
import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { validateGraphStructure, contextNodeIds } from '../../orchestrator/graph-structure-validator.js';
import { approvedGraphHeld, draftHistory, prepareRequestedRebuild } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement.js';
import { buildModelFromBrief, constructionOperationId } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import { runPreparingDraftReplacement } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement-context.js';
import { runAgentTurn, type CallModel } from '../../orchestrator-v5/agent-lane/runtime/agent-loop.js';
import { log } from '../../utils/telemetry.js';
import { narrateWriteOutcome } from '../../orchestrator-v5/agent-lane/write-outcome.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../orchestrator-v5/build-turn-context.js';
import { createRunAnalysisHandler } from '../../orchestrator-v5/tools/handlers/run-analysis.js';
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

async function world(row: { readonly graph: Rec; readonly brief: string; readonly message: string }, options: { race?: boolean; loseAcknowledgement?: boolean; hideLedger?: boolean; provider?: (...args: any[]) => Promise<any>; ledger?: Rec; pending?: PendingAction[]; objections?: { finding_id: string; analysis_id: string; statement: string }[] } = {}) {
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
    ...(options.pending === undefined ? {} : { readPendingActions: async () => options.pending! }),
    readCommittedTurnLedger: async () => ({ first_user_message: row.brief, user_message_turn_ids: ['first'], ...options.ledger, write_turn_ids: options.hideLedger ? [] : writes.map(w => w.turn_id),
      complete: options.ledger?.complete ?? true }) as never, readStatedObjections: async () => options.objections ?? [] });
  const ctx = { scenario_id: sid, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: row.message, user_text: row.message, user_text_complete: true, verified_user_messages: [row.message] } satisfies AgentToolContext;
  return { graph: () => graph, original, writes, sent, proposals, caps, ctx };
}


const captured = JSON.parse(readFileSync(new URL('./fixtures/founder-e625-before-goal-change.json', import.meta.url), 'utf8')) as Rec;
const rebuildCapture = JSON.parse(readFileSync(new URL('./fixtures/founder-e625-rebuild-read04.json', import.meta.url), 'utf8')) as Rec;
const source = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
const goalArgs = { constraint_type: 'at_least', value: 250000, unit: '£', rationale: source, governing_outcome: 'Angel funding secured', goal_change_quote: source, later_ambition_quote: captured.brief_text };
async function goalWorld(change?: (graph: Rec) => void, message = source) {
  const graph = structuredClone(captured.graph); change?.(graph);
  const w = await world({ graph, brief: captured.brief_text, message });
  w.ctx.verified_user_messages = [captured.brief_text, source, message]; return w;
}
const offer = (w: Awaited<ReturnType<typeof goalWorld>>, extra: Rec = {}) => dispatchTool('propose_goal_target', JSON.stringify({ ...goalArgs, ...extra }), w.ctx, w.caps());
const noPath = (g: Rec) => validateGraphStructure(GraphV3.parse(g), { leaveOutInertRisks: true }).violations.filter(v => v.code === 'NO_PATH_TO_GOAL');
const valueOf = (w: Awaited<ReturnType<typeof world>>, r: Rec) => w.proposals.get(String(r.proposal_id))!.operations[0]!.value as Rec;
const events = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(([x]: unknown[]) => x as Rec).filter((x: Rec) => x.event === 'v5.agent.tool_refused');

describe('captured G1 whole goal-change scope', () => {
  it('complete card → cold own press → one native save/retry; all words, settings and directed relationships survive', async () => {
    const w = await goalWorld(); const r = await offer(w);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
    const v = valueOf(w, r); expect(v.scope_excluded).toEqual(['larger_fund_secured']);
    expect(r.public_label).toContain('“Larger fund secured” leads only to the earlier aim');
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original); expect(noPath(v.candidate)).toEqual([]);
    const held = w.proposals.get(String(r.proposal_id))!, cold = restoreCard(held, r, w.ctx), c = w.caps(cold);
    for (const ctx of [{ ...w.ctx, user_turn_text: 'Yes, at least' }, { ...w.ctx, typed_approval_of: 'another-card' }]) {
      expect(await c.authoriseChange(ctx, { proposal_id: held.proposal_id })).toMatchObject({ ok: false, mutated: false });
    }
    expect(w.writes).toHaveLength(0);
    const press = { ...w.ctx, user_turn_text: '', typed_approval_of: held.proposal_id };
    expect(await c.authoriseChange(press, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(v.candidate, w.graph())).toBe(true);
    expect(w.graph().nodes.filter((n: Rec) => n.kind === 'goal').map((n: Rec) => n.id)).toEqual(['angel_funding_secured']);
    for (const n of w.original.nodes.filter((n: Rec) => !['funding_secured', 'angel_funding_secured'].includes(n.id))) {
      expect(w.graph().nodes.find((x: Rec) => x.id === n.id)).toEqual(n.id === 'larger_fund_secured' ? { ...n, analysis_participation: 'retained_excluded' } : n);
    }
    expect(w.graph().nodes.find((n: Rec) => n.id === 'funding_secured').description).toContain(captured.brief_text);
    expect(w.graph().edges.map((e: Rec) => [e.from, e.to])).toEqual(w.original.edges.map((e: Rec) => [e.from, e.to]));
    expect(noPath(w.graph())).toEqual([]);
    expect(assessCanonicalAnalysisReadiness(w.graph()).blockingIssues.map(i => i.code)).toEqual(['MISSING_FACTOR_LEVEL', 'MISSING_FACTOR_LEVEL', 'MISSING_FACTOR_LEVEL']);
    expect(await c.authoriseChange(press, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, mutated: false, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });
  // ⭐ DL ruling 21 Oct (structure class) supersedes "blocked": a dead end cannot change the result, so it is context (kept,
  // said, never a block); and so is the earlier goal's own branch that a protected item keeps in the model (below).
  it('a branch also reaching the new goal stays active; an unrelated dead end is context, never a block', async () => {
    const w = await goalWorld(g => {
      g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === 'larger_fund_secured')), to: 'angel_funding_secured' });
      g.nodes.push({ id: 'unrelated', kind: 'outcome', label: 'Unrelated unresolved outcome', provenance: 'ai_inferred' });
      g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === 'poc_quality')), to: 'unrelated' });
    });
    const r = await offer(w); expect(r.ok, JSON.stringify(r)).toBe(true); const v = valueOf(w, r);
    expect(v.scope_excluded).toEqual([]); expect(v.candidate.nodes.find((n: Rec) => n.id === 'larger_fund_secured').analysis_participation).toBeUndefined();
    expect(noPath(v.candidate)).toEqual([]); expect([...contextNodeIds(GraphV3.parse(v.candidate) as never)].sort()).toEqual(['funding_secured', 'unrelated']);
    expect(w.writes).toHaveLength(0);
  });
  it.each(['option', 'lever target', 'limit'])('a protected %s leaves the complete goal card available with no branch excluded', async kind => {
    const w = await goalWorld(g => {
      if (kind === 'limit') g.goal_constraints = [...(g.goal_constraints ?? []), { constraint_id: 'protected', node_id: 'larger_fund_secured', operator: '>=', value: 10, unit: '£', value_frame: 'level', provenance: 'explicit' }];
      else {
        const id = kind === 'option' ? 'current_split_reference' : 'founder_time_on_angel_outreach';
        g.edges = g.edges.filter((e: Rec) => e.from !== id);
        g.edges.push({ from: id, to: 'funding_secured', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
      }
    });
    const r = await offer(w); expect(r.ok, JSON.stringify(r)).toBe(true); const v = valueOf(w, r);
    expect(v.scope_excluded).toEqual([]); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    for (const n of w.original.nodes.filter((n: Rec) => !['funding_secured', 'angel_funding_secured'].includes(n.id))) {
      expect(v.candidate.nodes.find((x: Rec) => x.id === n.id)).toEqual(n);
    }
    expect(v.candidate.edges).toEqual(w.original.edges);
    expect(r.public_label).not.toContain('its words and links also stay visible');
    // Recording a goal waives nothing: the earlier goal's branch is said as context, never silently dropped from the model.
    expect(contextNodeIds(GraphV3.parse(v.candidate) as never).size).toBeGreaterThan(0);
    const held = w.proposals.get(String(r.proposal_id))!, operations = structuredClone(held.operations);
    const forged = operations[0]!.value as Rec;
    forged.scope_excluded = ['larger_fund_secured'];
    forged.candidate.nodes.find((n: Rec) => n.id === 'larger_fund_secured').analysis_participation = 'retained_excluded';
    const broken = createProposal({ scenario_id: held.scenario_id, user_id: held.user_id,
      base_graph_identity_hash: held.base_graph_identity_hash, operations, provenance: held.provenance,
      validation: held.validation, public_label: held.public_label });
    w.proposals.put(broken);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: broken.proposal_id }, { proposal_id: broken.proposal_id })).toMatchObject({ ok: false, mutated: false, refusal: 'incomplete_goal_postimage' });
    expect(w.writes).toHaveLength(0);
    const cold = restoreCard(held, r, w.ctx);
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: held.proposal_id }, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(w.graph().edges).toEqual(w.original.edges);
    for (const n of w.original.nodes.filter((n: Rec) => !['funding_secured', 'angel_funding_secured'].includes(n.id))) {
      expect(w.graph().nodes.find((x: Rec) => x.id === n.id)).toEqual(n);
    }
    expect(contextNodeIds(GraphV3.parse(w.graph()) as never).size).toBeGreaterThan(0);
  });
  it('reads FINAL removals and rejects forged scope ids or changed retained reasoning at approval', async () => {
    const quote = 'Remove the link from Larger fund secured to Angel funding secured.';
    const w = await goalWorld(g => g.edges.push({ ...structuredClone(g.edges.find((e: Rec) => e.from === 'larger_fund_secured')), to: 'angel_funding_secured' }), source + ' ' + quote);
    const r = await offer(w, { remove_mechanisms: [{ kind: 'link', id: 'larger_fund_secured', label: 'Larger fund secured', to_id: 'angel_funding_secured', to_label: 'Angel funding secured', quote }] });
    expect(r.ok, JSON.stringify(r)).toBe(true); const v = valueOf(w, r);
    expect(v.scope_excluded).toEqual(['larger_fund_secured']);
    expect(v.candidate.edges.some((e: Rec) => e.from === 'larger_fund_secured' && e.to === 'angel_funding_secured')).toBe(false);
    const held = w.proposals.get(String(r.proposal_id))!;
    for (const fault of ['scope', 'reasoning']) {
      const operations = structuredClone(held.operations), changed = operations[0]!.value as Rec;
      if (fault === 'scope') changed.scope_excluded = [];
      else changed.candidate.nodes.find((n: Rec) => n.id === 'larger_fund_secured').description = 'Dropped dissent';
      // Mint a valid card around a bad prepared candidate; bypassing signature integrity is not the contract under test.
      const broken = createProposal({ scenario_id: held.scenario_id, user_id: held.user_id,
        base_graph_identity_hash: held.base_graph_identity_hash, operations, provenance: held.provenance,
        validation: held.validation, public_label: held.public_label });
      w.proposals.put(broken);
      expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: broken.proposal_id }, { proposal_id: broken.proposal_id })).toMatchObject({ ok: false, mutated: false, refusal: 'incomplete_goal_postimage' });
    }
    expect(w.writes).toHaveLength(0);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: held.proposal_id }, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1);
  });
  it('native CAS race writes nothing, including scope flags', async () => {
    const w = await world({ graph: captured.graph, brief: captured.brief_text, message: source }, { race: true });
    w.ctx.verified_user_messages = [captured.brief_text, source]; const r = await offer(w); expect(r.ok).toBe(true);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: String(r.proposal_id) }, { proposal_id: String(r.proposal_id) })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
  });
});

describe('captured raw unit and same-turn retry', () => {
  const unit = '% of founder working time';
  const args = (g: Rec, value: number, sentUnit = unit) => ({ assumptions: g.nodes.filter((n: Rec) => n.kind === 'factor').map((n: Rec) => ({ factor_label: n.label, value, unit: sentUnit, user_stated: false, basis: 'Declared controlled estimate, not a user allocation.' })), option_levels: [] });
  it.each([0.4, 40])('%s means the raw percentage SHOWN; cold own press saves that exact amount once', async value => {
    const w = await goalWorld(); const r = await dispatchTool('propose_starting_point', JSON.stringify(args(w.graph(), value)), w.ctx, w.caps());
    expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.public_label).toContain(`= ${value}% of founder working time`); expect(w.writes).toHaveLength(0);
    const held = w.proposals.get(String(r.proposal_id))!, cold = restoreCard(held, r, w.ctx), c = w.caps(cold);
    const press = { ...w.ctx, user_turn_text: '', typed_approval_of: held.proposal_id };
    expect(await c.authoriseChange(press, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, applied: true }); expect(w.writes).toHaveLength(1);
    for (const n of w.graph().nodes.filter((n: Rec) => n.kind === 'factor')) expect(n.observed_state).toMatchObject({ value: value / 100, raw_value: value, unit, source: 'user_assumption' });
    expect(await c.authoriseChange(press, { proposal_id: held.proposal_id })).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(1);
  });
  it.each(['%', 'hours per week'])('refuses %s with factor/held-unit/frame, then accepts a held-unit retry', async sentUnit => {
    const w = await goalWorld(); const r = await dispatchTool('propose_starting_point', JSON.stringify(args(w.graph(), 40, sentUnit)), w.ctx, w.caps());
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'value_scope_mismatch', native_refusal: { valueIndex: 0 } });
    expect(r.detail).toContain('Founder time on angel outreach'); expect(r.detail).toContain('“% of founder working time”'); expect(r.detail).toContain('0–100'); expect(w.writes).toHaveLength(0);
    expect(await dispatchTool('propose_starting_point', JSON.stringify(args(w.graph(), 40)), w.ctx, w.caps())).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(0);
  });
  it('list diagnostics count arrays/index without exposing contents or changing AI input', async () => {
    const w = await goalWorld(), spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never); let hop = 0;
    const model: CallModel = async () => ({ output: hop++ === 0 ? [{ type: 'function_call', name: 'propose_starting_point', arguments: JSON.stringify(args(w.graph(), 40, '%')), call_id: 'lists' }] : [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] });
    try {
      const result = await runAgentTurn({ ctx: w.ctx, history: [], message: source, instructions: 'i', maxOutputTokens: 100 }, w.caps(), model);
      const e = events(spy); expect(e).toHaveLength(1); expect(e[0]).toMatchObject({ proposed: {}, proposed_preview: 'scalar_only_lists_omitted', assumption_count: 3, option_level_count: 0, value_index: 0 });
      expect(JSON.stringify(e)).not.toContain('Declared controlled estimate'); expect(result.tool_results[0]).not.toHaveProperty('proposed_preview'); expect(w.writes).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
});

describe('all refused builds have one text-free capability observation', () => {
  it.each(['unavailable', 'empty', 'not found', 'existing', 'history'])('%s observes the reached branch and preserves result shape', async fault => {
    const w = await world({ graph: captured.graph, brief: captured.brief_text, message: source }, { ledger: { complete: fault !== 'history' }, provider: fault === 'unavailable' ? undefined : async () => { throw new Error('Unreached provider'); } });
    const spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
    const caps = fault === 'not found' ? createAgentCapabilities(async () => ({ status: 404, json: {} }), new ProposalStore(), async () => { throw new Error('Unreached provider'); }) : w.caps();
    const a = fault === 'empty' ? { brief: '' } : { brief: 'Private source password secret-beyond-bound '.repeat(12), ...(['history', 'not found'].includes(fault) ? { explicit_rebuild_request: source } : {}) };
    try {
      const r = await dispatchTool('build_model_from_brief', JSON.stringify(a), w.ctx, caps);
      const expected = { unavailable: 'construction_unavailable', empty: 'empty_brief', 'not found': 'not_found', existing: 'model_already_exists', history: 'history_unreadable' }[fault];
      expect(r).toMatchObject({ ok: false, mutated: false, refusal: expected }); expect(r).not.toHaveProperty('failed_checks');
      const e = events(spy); expect(e).toHaveLength(1); expect(e[0]).toMatchObject({ tool: 'build_model_from_brief', refusal: expected, failed_checks: [expected] });
      expect(JSON.stringify(e)).not.toMatch(/Private source|secret-beyond-bound|password/); expect(w.writes).toHaveLength(0);
    } finally { spy.mockRestore(); }
  });
  it('fixed retention enum names an identity collision without logging labels or exposing diagnostic fields', async () => {
    const bakery = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/bakery-prepare-only.json', import.meta.url), 'utf8'));
    const provider = async () => ({ text: JSON.stringify(bakery.draft), status: 'completed' as const });
    const seed = await runPreparingDraftReplacement('seed', () => buildModelFromBrief('seed', bakery.brief, async () => { throw new Error('No write allowed'); }, provider as never));
    expect(seed.ok).toBe(true); const graph = structuredClone(seed.prepared_graph) as Rec;
    graph.nodes.find((n: Rec) => n.kind === 'option').label = 'Private saved option, secret-value';
    const w = await world({ graph, brief: bakery.brief, message: source }, { provider }), spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
    try {
      const r = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Replacement context only', explicit_rebuild_request: source }), w.ctx, w.caps());
      expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'replacement_work_not_held' }); expect(r).not.toHaveProperty('missing_kind');
      expect(r.follow_up).toContain('Private saved option, secret-value');
      expect(narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r]).status).toBe(r.follow_up);
      const e = events(spy); expect(e).toHaveLength(1); expect(e[0]).toMatchObject({ missing_kind: 'saved_option', missing_count: 1, argument_length: source.length, argument_sha256: createHash('sha256').update(source).digest('hex') });
      expect(JSON.stringify(e)).not.toMatch(/Private saved option|secret-value|Replacement context/); expect(w.writes).toHaveLength(0);
    } finally { spy.mockRestore(); }
    expect(prepareRequestedRebuild(graph, seed.prepared_graph, levelFrameOf).missing_kind).toBe('saved_option');
  });
});

it('on the connected captured goal, omitted current level/earlier removal remain named on the valid card', async () => {
  const job = "The job specification is just the work I would be doing if I was focusing on that, so I'm not sure we should be focusing on it. The question I'm trying to answer is how to best divide my time.";
  const w = await goalWorld(); w.ctx.verified_user_messages.push(job);
  const r = await offer(w, { current_level: { value: 0, unit: '£' }, remove_mechanisms: [{ kind: 'factor', label: 'Founder time on job specifications', quote: job }] });
  expect(r.ok, JSON.stringify(r)).toBe(true); const omitted = r.not_included as Rec[];
  expect(omitted).toHaveLength(2); expect(omitted.every(p => p.refusal && p.detail)).toBe(true);
  expect(omitted.find(p => p.part.includes('removal'))).toMatchObject({ refusal: 'not_current_removal' });
  expect(r.public_label).toContain('Not included on this card'); expect(r.public_label).toContain('Today’s level');
  expect(r.public_label).not.toContain('Say so plainly'); expect(r.public_label).not.toContain('0 £');
  const pid = String(r.proposal_id);
  expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
  expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal').goal_threshold_raw).toBe(250000);
  expect(w.graph().nodes.some((n: Rec) => n.id === 'founder_time_on_job_specifications')).toBe(true); expect(w.writes).toHaveLength(1);
});

it('complete approved captured correction reaches the real Run payload probe with the new goal; no engine call or extra write', async () => {
  const w = await goalWorld(), goal = await offer(w), pid = String(goal.proposal_id);
  expect(await w.caps(restoreCard(w.proposals.get(pid)!, goal, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
  const assumptions = w.graph().nodes.filter((n: Rec) => n.kind === 'factor').map((n: Rec, i: number) => ({ factor_label: n.label, value: [40, 40, 20][i], unit: '% of founder working time', user_stated: false, basis: 'Declared test assumptions, not witnessed user facts.' }));
  const levels = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions, option_levels: [] }), w.ctx, w.caps()), lid = String(levels.proposal_id);
  expect(levels.ok, JSON.stringify(levels)).toBe(true);
  expect(await w.caps(restoreCard(w.proposals.get(lid)!, levels, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: lid }, { proposal_id: lid })).toMatchObject({ ok: true, applied: true });
  expect(w.writes).toHaveLength(2); expect(assessCanonicalAnalysisReadiness(w.graph()).blockingIssues).toEqual([]);
  const probe = vi.fn(async () => {}), engine = vi.fn(async () => { throw new Error('No live engine calls'); });
  const handler = createRunAnalysisHandler({ plotClient: { run: engine } as never, probe,
    scenarioReader: () => loadScenarioSnapshotForRunAnalysis(w.ctx.scenario_id, 'native-complete-correction', {
      readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(w.graph()), briefText: captured.brief_text }), loadGraph: async () => structuredClone(w.graph()),
    } as never) });
  await handler({ payload: { kind: 'message', scenario_id: w.ctx.scenario_id, turn_id: randomUUID(), source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis', parameters: { effects_timing: 'not_stated' } } }, requestId: 'native-complete-correction', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(probe).toHaveBeenCalledTimes(1); expect(engine).not.toHaveBeenCalled(); expect(w.writes).toHaveLength(2);
  const sent = (probe.mock.calls[0] as unknown as [{ plotPayload: Rec }])[0].plotPayload;
  expect(sent.goal_node_id).toBe('angel_funding_secured');
  expect(sent.graph.nodes.some((n: Rec) => ['funding_secured', 'larger_fund_secured'].includes(n.id))).toBe(false);
  expect(sent.goal_constraints).toEqual(expect.arrayContaining([expect.objectContaining({ node_id: 'angel_funding_secured', value: 250000, operator: '>=' })]));
});

it('the prepared captured retention candidate cold-saves through the existing complete writer and reopens with the same sources', async () => {
  const message = "I've already agreed with this brief. Generate a new model based on this brief.";
  const w = await world({ graph: rebuildCapture.graph, brief: rebuildCapture.brief_text, message });
  const draft = structuredClone(w.original);
  const omitted = ['current_split_reference', 'funding_secured', 'investor_outreach_pipeline_stalls'];
  draft.nodes = draft.nodes.filter((n: Rec) => !omitted.includes(n.id));
  draft.edges = draft.edges.filter((e: Rec) => !omitted.includes(e.from) && !omitted.includes(e.to));
  const prepared = prepareRequestedRebuild(w.original, draft, levelFrameOf);
  expect(prepared.missing).toEqual([]); expect(prepared.retired).toEqual([]);
  const ledger = { complete: true, first_user_message: rebuildCapture.brief_text, user_message_turn_ids: ['first'], write_turn_ids: [] };
  const history = draftHistory(ledger, w.ctx.scenario_id, rebuildCapture.brief_text, w.ctx.turn_id);
  const base = computeGraphIdentityHash(w.original as never)!.value;
  // Writer integration only: this declared candidate is not a reconstruction of the historical constructor output.
  const proposal = createProposal({ scenario_id: w.ctx.scenario_id, user_id: null,
    base_graph_identity_hash: computeAnalysisAffectingGraphHash(w.original as never)!,
    operations: [{ op: 'apply_saved_correction', path: w.ctx.scenario_id, value: { candidate: prepared.candidate,
      base_identity: base, brief_text: rebuildCapture.brief_text, goal_turn_id: w.ctx.turn_id,
      operation_id: constructionOperationId(w.ctx.scenario_id, 'declared-captured-retention:' + base), explicit_rebuild_request: message,
      rebuild_history: { bound: history.bound, context: history.context, objections: [], unpressed_adoptions: [] } } }],
    provenance: { authored_by: 'model_proposed', basis: message }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: 'Declared complete captured retention candidate, sources and unknown adoption preserved.' });
  const offered = { ok: true, mutated: false, proposal_id: proposal.proposal_id, public_label: proposal.public_label };
  const cold = restoreCard(proposal, offered, w.ctx), caps = w.caps(cold);
  expect(await caps.authoriseChange(w.ctx, { proposal_id: proposal.proposal_id })).toMatchObject({ ok: false, mutated: false });
  expect(w.writes).toHaveLength(0);
  const press = { ...w.ctx, user_turn_text: '', typed_approval_of: proposal.proposal_id };
  expect(await caps.authoriseChange(press, { proposal_id: proposal.proposal_id })).toMatchObject({ ok: true, applied: true });
  expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(prepared.candidate, w.graph())).toBe(true);
  for (const n of w.original.nodes) expect(w.graph().nodes.find((x: Rec) => x.id === n.id)).toEqual(n);
  const reopened = await w.caps(new ProposalStore()).getCanonicalState(w.ctx) as Rec;
  const goal = w.graph().nodes.find((n: Rec) => n.kind === 'goal');
  expect(reopened.recorded_reasoning.find((n: Rec) => n.id === goal.id).user_statements).toEqual(goal.user_statements);
  const said = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
  expect(goal.user_statements).toMatchObject([{ field: 'target', statements: [{ speaker: 'user', quote: said, source: said }] }]);
  expect(await caps.authoriseChange(press, { proposal_id: proposal.proposal_id })).toMatchObject({ ok: true, already_applied: true });
  expect(w.writes).toHaveLength(1);
});

it.each([false, true])('the production rebuild card carries unknown adoption or uses a real unpressed record (proof: %s)', async proof => {
  const bakery = JSON.parse(readFileSync(new URL('../../orchestrator-v5/agent-lane/__tests__/fixtures/bakery-prepare-only.json', import.meta.url), 'utf8'));
  const provider = async () => ({ text: JSON.stringify(bakery.draft), status: 'completed' as const });
  const seed = await runPreparingDraftReplacement('seed', () => buildModelFromBrief('seed', bakery.brief, async () => { throw new Error('No construction write'); }, provider as never));
  expect(seed.ok).toBe(true); const graph = structuredClone(seed.prepared_graph) as Rec;
  const node = { id: 'earlier_olumi_option', kind: 'option', label: 'Earlier Olumi option', proposed_by: 'olumi', analysis_participation: 'retained_excluded', interventions: {} };
  graph.nodes.push(node);
  const pendingLink = { from: node.id, to: 'loyalty_card_running', strength: { mean: 1, std: 0.01 },
    exists_probability: 1, effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } };
  graph.edges.push(pendingLink); const pending: PendingAction[] = [];
  const message = "I've already agreed with this brief. Generate a new model based on this brief.";
  const w = await world({ graph, brief: bakery.brief, message }, { provider, pending });
  if (proof) {
    const adoption = createProposal({ scenario_id: w.ctx.scenario_id, user_id: null,
      base_graph_identity_hash: computeAnalysisAffectingGraphHash(w.original as never)!,
      operations: [{ op: 'adopt_olumi_option', path: node.id, value: { label: node.label, expected_interventions: {} } }],
      provenance: { authored_by: 'model_proposed', basis: 'Declared unpressed adoption' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Include the earlier Olumi option' });
    pending.push(proposalPendingAction(adoption, { id: 'agent-approve-proposal:' + adoption.proposal_id, label: 'Include option', message: 'Include the earlier option.' },
      { scenario_id: w.ctx.scenario_id, emitted_at_iso: new Date().toISOString() }));
  }
  const out = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: 'Declared replacement context', explicit_rebuild_request: message }), w.ctx, w.caps());
  expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(0);
  const pid = String(out.proposal_id), held = w.proposals.get(pid)!, candidate = (held.operations[0]!.value as Rec).candidate;
  expect(candidate.nodes.some((n: Rec) => n.id === node.id)).toBe(!proof);
  expect(candidate.edges.some((e: Rec) => e.from === node.id && e.to === pendingLink.to)).toBe(!proof);
  if (proof) expect(out.public_label).toContain('Saved relationships left out of this replacement: “Earlier Olumi option” → “Loyalty card running”');
  expect(out.public_label).toContain(proof ? 'Earlier Olumi suggestions left out' : 'Olumi cannot tell whether you adopted');
  if (!proof) expect(candidate.nodes.find((n: Rec) => n.id === node.id)).toEqual(node);
  const cold = restoreCard(held, out, w.ctx);
  expect(await w.caps(cold).authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
  expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
  expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(candidate, w.graph())).toBe(true);
});

