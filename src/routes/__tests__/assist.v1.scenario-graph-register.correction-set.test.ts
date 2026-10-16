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
import { approvalChipsFor } from '../../orchestrator-v5/agent-lane/approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash, normaliseGraphForIdentity } from '../../orchestrator-v5/context/graph-identity.js';
import { approvedGraphHeld } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement.js';

type Rec = Record<string, any>;
const fixture = (name: string): Rec => JSON.parse(readFileSync(new URL(`../../orchestrator-v5/agent-lane/__tests__/fixtures/${name}`, import.meta.url), 'utf8'));
const marketing = fixture('marketing-020148Z-draft-before-L20.json');
const capacity = fixture('capacity-003921Z-served-draft.json');
const hiring = JSON.parse(readFileSync(new URL('../../orchestrator-v5/statement-door/__tests__/fixtures/hiring-negative-r4-turn09.json', import.meta.url), 'utf8')) as Rec;
const cases = [
  { name: 'marketing', graph: marketing.graph, brief: marketing.brief_text,
    message: 'Rename “Hire marketing manager” to “Trial a marketing manager”. Remove the risk “Ad production costs erode budget”.',
    ops: [
      { op: 'rename', kind: 'option', id: 'hire_marketing_manager', label: 'Hire marketing manager', new_label: 'Trial a marketing manager', quote: 'Rename “Hire marketing manager” to “Trial a marketing manager”.' },
      { op: 'remove', kind: 'risk', id: 'ad_production_costs_erode_budget', label: 'Ad production costs erode budget', quote: 'Remove the risk “Ad production costs erode budget”.' },
    ] },
  { name: 'capacity', graph: capacity.graph, brief: 'Compare weekly support capacity with the current team, one specialist, or a half-time specialist.',
    message: 'Rename “Add half-time specialist” to “Trial a part-time specialist”. Set the direct link from “Existing team capacity” to “Weekly support capacity” to zero.',
    ops: [
      { op: 'rename', kind: 'option', id: 'add_half_time_specialist', label: 'Add half-time specialist', new_label: 'Trial a part-time specialist', quote: 'Rename “Add half-time specialist” to “Trial a part-time specialist”.' },
      { op: 'set_zero', kind: 'link', id: 'existing_team_capacity', label: 'Existing team capacity', to_id: 'weekly_support_capacity', to_label: 'Weekly support capacity', quote: 'Set the direct link from “Existing team capacity” to “Weekly support capacity” to zero.' },
    ] },
  { name: 'hiring', graph: hiring.graph, brief: 'Compare hiring a tech lead, one developer or two developers for productivity at month three.',
    message: 'Rename “Hire one developer” to “Contract one developer”. The tech lead would lift productivity from month 2.',
    ops: [
      { op: 'rename', kind: 'option', id: 'hire_one_developer', label: 'Hire one developer', new_label: 'Contract one developer', quote: 'Rename “Hire one developer” to “Contract one developer”.' },
      { op: 'option_timing', kind: 'option', id: 'hire_a_tech_lead', label: 'Hire a Tech lead', quote: 'The tech lead would lift productivity from month 2.', reading_words: 'lift productivity from month 2' },
    ] },
] as const;
const close: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of close.splice(0)) await fn(); });

async function world(row: (typeof cases)[number], race = false) {
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
      graph_hash: computeAnalysisAffectingGraphHash(graph), graph_identity_hash: computeGraphIdentityHash(graph) } };
    if (path.endsWith('/graph/register')) {
      sent.push(structuredClone(body));
      if (race) graph = { ...graph, nodes: graph.nodes.map((n: Rec, i: number) => i === 0 ? { ...n, label: `${n.label} changed concurrently` } : n) };
      const response = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body });
      return { status: response.statusCode, json: response.json() };
    }
    throw new Error(`No provider, engine or other writer is allowed: ${path}`);
  };
  const proposals = new ProposalStore();
  const caps = (store = proposals) => createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { turnAuthority: true });
  const ctx: AgentToolContext = { scenario_id: sid, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: row.message, user_text: row.message, user_text_complete: true, verified_user_messages: [row.message] };
  return { graph: () => graph, original, writes, sent, proposals, caps, ctx };
}

describe.each(cases)('native $name correction retains the saved model', row => {
  it('one current card, cold-restored approval, one native write and whole matching readback; every untouched option survives', async () => {
    const w = await world(row);
    const offered = await dispatchTool('propose_change', JSON.stringify({ ops: row.ops }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(1);
    const pid = String(offered.proposal_id);
    const held = w.proposals.get(pid)!;
    const chips = approvalChipsFor([{ name: 'propose_change', ...offered } as never], () => ({ proposal: held, result: offered }));
    expect(chips[0]).toMatchObject({ id: `agent-approve-proposal:${pid}`, label: 'Make this change', detail: held.public_label });
    const cold = new ProposalStore(); cold.put(JSON.parse(JSON.stringify(held)) as StructuredProposal);
    const approved = { ...w.ctx, turn_id: randomUUID(), user_turn_text: '', typed_approval_of: pid };
    const result = await w.caps(cold).authoriseChange(approved, { proposal_id: pid });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(result.follow_up).toBe('The changes on your card are saved together in the model.');
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
    expect(w.sent[0]!.expected_graph_identity_hash).toBe(computeGraphIdentityHash(w.original)?.value);
    expect(approvedGraphHeld(w.sent[0]!.graph, w.graph())).toBe(true);
    const options = (g: Rec) => g.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id).sort();
    expect(options(w.graph())).toEqual(options(w.original));
    const withoutRefs = { ...w.graph(), nodes: w.graph().nodes.map(({ ref: _ref, ...n }: Rec) => n) };
    const candidateWithoutRefs = { ...w.sent[0]!.graph, nodes: w.sent[0]!.graph.nodes.map(({ ref: _ref, ...n }: Rec) => n) };
    expect(normaliseGraphForIdentity(withoutRefs)?.graph).toEqual(normaliseGraphForIdentity(candidateWithoutRefs)?.graph);
    await w.caps(cold).authoriseChange(approved, { proposal_id: pid });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
  });
  it('a label-only race inside native registration refuses with zero writes', async () => {
    const w = await world(row, true);
    const offered = await dispatchTool('propose_change', JSON.stringify({ ops: row.ops }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id);
    const result = await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(result).toMatchObject({ ok: false, mutated: false, applied: false });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(0);
  });
});
