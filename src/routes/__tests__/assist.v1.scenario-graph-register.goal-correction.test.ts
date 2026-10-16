/** Saved-model corrections: real canonical adapters → own card → one native CAS registration → whole readback. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!),
}));
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

import registerRoute from '../assist.v1.scenario-graph-register.js';
import { createAgentCapabilities, type InternalDispatch } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { ProposalStore, type StructuredProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { proposalPendingAction, rehydrateProposals } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { parsePendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { approvalChipsFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { approvedGraphHeld } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`../../orchestrator-v5/agent-lane/__tests__/fixtures/${name}`, import.meta.url), 'utf8'));
const capacity = fixture('capacity-003921Z-served-draft.json');
const source = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
const funding = fixture('funding-247ae5b4-before-target.json');
const cases = [
  { name: 'funding', graph: funding.graph, brief: funding.brief_text, message: source, value: 250000, unit: 'GBP', measures: 'angel funding' },
  { name: 'capacity', graph: capacity.graph, brief: 'Compare weekly support capacity under three staffing options.',
    message: 'Reach at least 300 tickets per week of support throughput.', value: 300, unit: 'tickets per week', measures: 'support throughput' },
] as const;
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

async function world(row: (typeof cases)[number], options: { race?: boolean; loseAcknowledgement?: boolean; hideLedger?: boolean } = {}) {
  let graph = structuredClone(row.graph) as Rec;
  const original = structuredClone(graph);
  const writes: Rec[] = [];
  const sent: Rec[] = [];
  const sid = randomUUID();
  storeRef.value = {
    append: vi.fn(async (write: Rec) => { writes.push(write); graph = structuredClone(write.graph); return { id: write.turn_id }; }),
    loadGraph: async () => structuredClone(graph), loadGraphAndBriefText: async () => ({ graph, briefText: row.brief }),
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null, scenarioExists: async () => true,
    readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [],
  };
  const app = Fastify(); await registerRoute(app); await app.ready(); close.push(() => app.close());
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph), brief_text: row.brief,
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
  const caps = (store = proposals) => createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { turnAuthority: true,
    readCommittedTurnLedger: async () => ({ first_user_message: row.brief, write_turn_ids: options.hideLedger ? [] : writes.map(w => w.turn_id),
      messages: [], complete: true }) as never });
  const ctx: AgentToolContext = { scenario_id: sid, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: row.message, user_text: row.message, user_text_complete: true, verified_user_messages: [row.message] };
  return { graph: () => graph, original, writes, sent, proposals, caps, ctx };
}

describe.each(cases)('saved $name target correction, native registration', row => {
  it('keeps the four complete time splits and all other source/conditions; one own card, one CAS write and whole readback', async () => {
    const w = await world(row);
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ constraint_type: 'at_least', value: row.value, unit: row.unit, measures: row.measures, rationale: row.message }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.writes).toHaveLength(0);
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!;
    expect(held.operations).toHaveLength(1); expect(held.operations[0]!.op).toBe('set_goal_target');
    expect(offered.public_label).toContain(row.message);
    expect(offered.public_label).toContain('Olumi');
    const oldUnit = w.original.nodes.find((n: Rec) => n.kind === 'goal').goal_threshold_unit;
    if (oldUnit !== row.unit) expect(offered.public_label).toContain(`changes the goal’s measurement from ${oldUnit} to ${row.unit}`);
    const cold = restoreCard(held, offered, w.ctx);
    const result = await w.caps(cold).authoriseChange({ ...w.ctx, turn_id: randomUUID(), user_turn_text: '', typed_approval_of: pid }, { proposal_id: pid });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
    expect(approvedGraphHeld(w.sent[0]!.graph, w.graph())).toBe(true);
    const strip = ({ ref: _ref, ...n }: Rec) => n;
    for (const n of w.original.nodes as Rec[]) {
      if (n.kind !== 'goal') expect(strip(w.graph().nodes.find((x: Rec) => x.id === n.id)), n.id).toEqual(strip(n));
    }
    expect(w.graph().options).toEqual(w.original.options);
    expect(w.graph().nodes.filter((n: Rec) => n.kind === 'option')).toHaveLength(w.original.nodes.filter((n: Rec) => n.kind === 'option').length);
    for (const key of Object.keys(w.original).filter(k => !['nodes', 'edges', 'goal_constraints'].includes(k))) expect(w.graph()[key], key).toEqual(w.original[key]);
    const goal = w.graph().nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal).toMatchObject({ goal_threshold_raw: row.value, goal_threshold_unit: row.unit });
    expect(goal.threshold_source).not.toBe('user');
    const constraint = w.graph().goal_constraints.find((r: Rec) => r.node_id === goal.id);
    expect(constraint).toMatchObject({ value: row.value, unit: row.unit, provenance: 'inferred', source_quote: row.message });
    for (const other of w.original.goal_constraints ?? []) if (other.node_id !== goal.id) expect(w.graph().goal_constraints).toContainEqual(other);
    expect(goal.user_statements).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'target', statements: [expect.objectContaining({ speaker: 'user', source: row.message, quote: row.message, reading: 'olumi' })] })]));
    expect(w.graph().edges).toEqual(w.original.edges);
    const again = await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(again).toMatchObject({ ok: true, applied: true, already_applied: true, mutated: false }); expect(w.writes).toHaveLength(1);
  });
  const offer = async (w: Awaited<ReturnType<typeof world>>, ctx = w.ctx) => dispatchTool('propose_goal_target', JSON.stringify({ constraint_type: 'at_least', value: row.value, unit: row.unit, measures: row.measures, rationale: row.message }), ctx, w.caps());
  it('a typed yes or a foreign card cannot save this interpretation', async () => {
    const w = await world(row), out = await offer(w), pid = String(out.proposal_id);
    expect(out.ok).toBe(true);
    for (const typed_approval_of of [undefined, 'another-proposal']) {
      const result = await w.caps().authoriseChange({ ...w.ctx, user_turn_text: 'Yes.', typed_approval_of }, { proposal_id: pid });
      expect(result.ok).toBe(false); expect(w.writes).toHaveLength(0);
    }
  });
  it('a later short confirmation reuses the complete verified source without a redraft', async () => {
    const w = await world(row), out = await offer(w, { ...w.ctx, user_turn_text: 'Yes, at least.' });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: false });
    expect(out.public_label).toContain(row.message); expect(w.writes).toHaveLength(0);
  });
  it('a label-only native registration race saves nothing', async () => {
    const w = await world(row, { race: true }), out = await offer(w), pid = String(out.proposal_id);
    const result = await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(result).toMatchObject({ ok: false, mutated: false, applied: false, refusal: 'superseded' }); expect(w.writes).toHaveLength(0);
  });
  it('lost acknowledgement recovers only its native ledger operation plus the complete cold postimage', async () => {
    const w = await world(row, { loseAcknowledgement: true }), out = await offer(w), pid = String(out.proposal_id), held = w.proposals.get(pid)!;
    const result = await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(result).toMatchObject({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }); expect(w.writes).toHaveLength(1);
    const cold = restoreCard(held, out, w.ctx);
    const recovered = await w.caps(cold).authoriseChange({ ...w.ctx, user_turn_text: '', typed_approval_of: pid }, { proposal_id: pid });
    expect(recovered).toMatchObject({ ok: true, mutated: false, applied: true, already_applied: true }); expect(w.writes).toHaveLength(1);
  });
  it('an equal graph without this operation in the ledger never proves this card was saved', async () => {
    const w = await world(row, { loseAcknowledgement: true, hideLedger: true }), out = await offer(w), pid = String(out.proposal_id), held = w.proposals.get(pid)!;
    await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    const result = await w.caps(restoreCard(held, out, w.ctx)).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(result.ok).toBe(false); expect(w.writes).toHaveLength(1);
  });
  it('unknown or incomplete source offers no target and writes nothing', async () => {
    for (const ctx of [{ user_text: '', user_turn_text: '', unverified_user_text: row.message }, { user_text_complete: false }]) {
      const w = await world(row), out = await offer(w, { ...w.ctx, ...ctx });
      expect(out.ok).toBe(false); expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0); expect(w.writes).toHaveLength(0);
    }
  });
  it('preserves all source rather than offering a card that would strip an unknown saved member', async () => {
    const custom = { ...row, graph: structuredClone(row.graph) };
    custom.graph.nodes.find((n: Rec) => n.kind === 'option').future_reasoning = { source: 'Human note', disagreement: 'Retain this tension' };
    const w = await world(custom), out = await offer(w);
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'target_would_change_other_work' }); expect(w.writes).toHaveLength(0);
  });

  it.each([
    ['Our budget is £40,000.', 40000, 'GBP', 'budget'],
    ['We have 3 engineers.', 3, 'engineers', 'engineers'],
  ] as const)('a background human fact (%s) cannot be auto-bound or human-stamped as this goal target', async (message, value, unit, measures) => {
    const w = await world(row);
    const out = await dispatchTool('propose_goal_target', JSON.stringify({ constraint_type: 'at_least', value, unit, measures, rationale: message }), { ...w.ctx, user_text: message, user_turn_text: message }, w.caps());
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    expect(out.mutated).toBe(false);
    if (!out.ok) { expect(out.refusal).toBe('target_would_change_other_work'); return; }
    const proposal = w.proposals.get(String(out.proposal_id))!;
    expect(proposal.public_label).toContain(message); expect(proposal.public_label).toContain('Olumi');
    const candidate = proposal.operations[0]!.value as Rec;
    expect(candidate.candidate.nodes.find((n: Rec) => n.kind === 'goal').threshold_source).not.toBe('user');
    expect(candidate.candidate.goal_constraints.find((r: Rec) => r.node_id === proposal.operations[0]!.path)).toMatchObject({ provenance: 'inferred', source_quote: message });
    const yes = await w.caps().authoriseChange({ ...w.ctx, user_turn_text: 'Yes.' }, { proposal_id: proposal.proposal_id });
    expect(yes.ok).toBe(false); expect(w.writes).toHaveLength(0);
  });

});
