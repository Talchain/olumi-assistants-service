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

import { tryStructureOriginAnswer } from '../../cee/context-integrity/structure-origin-answer.js';
import { constructionOperationId } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import registerRoute from '../assist.v1.scenario-graph-register.js';
import { createAgentCapabilities, type InternalDispatch } from '../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext } from '../../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { ProposalStore, createProposal, type StructuredProposal } from '../../orchestrator-v5/agent-lane/proposal.js';
import { proposalPendingAction, rehydrateProposals } from '../../orchestrator-v5/agent-lane/durable-proposal.js';
import { parsePendingAction } from '../../orchestrator-v5/session/pending-action.js';
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

async function world(row: { readonly graph: Rec; readonly brief: string; readonly message: string }, options: { race?: boolean; loseAcknowledgement?: boolean; hideLedger?: boolean } = {}) {
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
    const cold = restoreCard(held, offered, w.ctx);
    const approved = { ...w.ctx, turn_id: randomUUID(), user_turn_text: '', typed_approval_of: pid };
    const result = await w.caps(cold).authoriseChange(approved, { proposal_id: pid });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(result.follow_up).toBe('The changes on your card are saved together in the model.');
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
    expect(w.sent[0]!.expected_graph_identity_hash).toBe(computeGraphIdentityHash(w.original as never)?.value);
    expect(approvedGraphHeld(w.sent[0]!.graph, w.graph())).toBe(true);
    // Whole readback above must also contain EVERY requested change, not merely equal a candidate that omitted one.
    for (const requested of row.ops) {
      if (requested.op === 'rename') {
        const changed = w.graph().nodes.find((n: Rec) => n.id === requested.id);
        expect(changed.label).toBe(requested.new_label);
        expect(changed.label_authored).toBe(false);
        expect(changed.provenance).toBe(w.original.nodes.find((n: Rec) => n.id === requested.id).provenance);
        if (changed.provenance === 'ai_inferred') expect(tryStructureOriginAnswer(`Why is ${requested.new_label} in my model?`, w.graph())).toContain('was my suggestion, not something you wrote.');
      } else if (requested.op === 'remove') {
        expect(w.graph().nodes.some((n: Rec) => n.id === requested.id)).toBe(false);
        expect(w.graph().edges.some((e: Rec) => e.from === requested.id || e.to === requested.id)).toBe(false);
      } else if (requested.op === 'set_zero') {
        expect(w.graph().edges.some((e: Rec) => e.from === requested.id && e.to === requested.to_id)).toBe(false);
      } else {
        const statements = w.graph().nodes.find((n: Rec) => n.id === requested.id).user_statements;
        expect(statements).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'lead',
          statements: expect.arrayContaining([expect.objectContaining({ speaker: 'user', quote: requested.quote, reading: 'olumi', low: 2, high: 2 })]) })]));
      }
    }
    const options = (g: Rec) => g.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id).sort();
    expect(options(w.graph())).toEqual(options(w.original));
    const stripRef = ({ ref: _ref, ...n }: Rec): Rec => n;
    const changedNodes = new Set(row.ops.filter(op => op.kind !== 'link').map(op => op.id));
    for (const n of w.original.nodes as Rec[]) {
      if (!changedNodes.has(n.id)) expect(stripRef(w.graph().nodes.find((after: Rec) => after.id === n.id)), n.id).toEqual(stripRef(n));
    }
    for (const old of w.original.nodes.filter((n: Rec) => n.kind === 'option')) {
      const after = w.graph().nodes.find((n: Rec) => n.id === old.id);
      expect(after.interventions, old.id).toEqual(old.interventions);
      expect(after.raw_interventions, old.id).toEqual(old.raw_interventions);
    }
    const withoutRefs = { ...w.graph(), nodes: w.graph().nodes.map(({ ref: _ref, ...n }: Rec) => n) };
    const candidateWithoutRefs = { ...w.sent[0]!.graph, nodes: w.sent[0]!.graph.nodes.map(({ ref: _ref, ...n }: Rec) => n) };
    expect(normaliseGraphForIdentity(withoutRefs as never)?.graph).toEqual(normaliseGraphForIdentity(candidateWithoutRefs as never)?.graph);
    await w.caps(cold).authoriseChange(approved, { proposal_id: pid });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
  });
  it('a label-only race inside native registration refuses with zero writes', async () => {
    const w = await world(row, { race: true });
    const offered = await dispatchTool('propose_change', JSON.stringify({ ops: row.ops }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id);
    const result = await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(result).toMatchObject({ ok: false, mutated: false, applied: false });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(0);
  });
  it.each([false, true])('lost acknowledgement: retry needs the same native operation plus whole readback (ledger hidden: %s)', async hideLedger => {
    const w = await world(row, { loseAcknowledgement: true, hideLedger });
    const offered = await dispatchTool('propose_change', JSON.stringify({ ops: row.ops }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id);
    const pending = JSON.parse(JSON.stringify(w.proposals.get(pid))) as StructuredProposal;
    const press = { ...w.ctx, user_turn_text: '', typed_approval_of: pid };
    expect(await w.caps().authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: false, applied: false, refusal: 'not_confirmed' });
    const cold = restoreCard(pending, offered, w.ctx);
    const retry = await w.caps(cold).authoriseChange(press, { proposal_id: pid });
    if (hideLedger) expect(retry).toMatchObject({ ok: false, mutated: false });
    else {
      expect(retry, JSON.stringify(retry)).toMatchObject({ ok: true, mutated: false, applied: true, already_applied: true });
      expect(retry.follow_up).toBe('The changes on that card are already saved in the model. Nothing was applied twice.');
      await w.caps(cold).authoriseChange(press, { proposal_id: pid });
    }
    expect(w.writes).toHaveLength(1); expect(w.sent).toHaveLength(1);
  });
});

it.each(cases.slice(0, 2))('rename-only source cannot smuggle a removal on the $name native correction card', async row => {
  const message = row.ops[0].quote;
  const w = await world({ ...row, message });
  const out = await dispatchTool('propose_change', JSON.stringify({ ops: [row.ops[0], { ...row.ops[1], quote: message }] }), w.ctx, w.caps());
  expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'not_asked' });
  expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0); expect(w.writes).toHaveLength(0);
});

describe.each(['goal_direction', 'goal_horizon'] as const)('a correction cannot silently lose %s', missing => {
  it('refuses a complete own-card candidate that omitted an untouched goal field, before any native write', async () => {
    const row = cases[0];
    const graph = structuredClone(row.graph);
    const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    goal.goal_direction = '<=';
    goal.goal_horizon = { deadline: '2027-06-30' };
    const w = await world({ ...row, graph });
    const offered = await dispatchTool('propose_change', JSON.stringify({ ops: row.ops }), w.ctx, w.caps());
    expect(offered).toMatchObject({ ok: true, mutated: false });
    const original = w.proposals.get(String(offered.proposal_id))!;
    const operations = structuredClone(original.operations);
    const value = operations[0]!.value as Rec;
    delete value.candidate.nodes.find((n: Rec) => n.kind === 'goal')[missing];
    value.operation_id = constructionOperationId(w.ctx.scenario_id, 'goal-fields:' + computeGraphIdentityHash(value.candidate as never)!.value);
    // Simulates the preparation defect, before card identity is minted, not a tampered browser payload.
    const broken = createProposal({ scenario_id: original.scenario_id, user_id: original.user_id,
      base_graph_identity_hash: original.base_graph_identity_hash, operations,
      provenance: original.provenance, validation: original.validation, public_label: original.public_label });
    w.proposals.put(broken);
    const result = await w.caps().authoriseChange({ ...w.ctx, user_turn_text: '', typed_approval_of: broken.proposal_id }, { proposal_id: broken.proposal_id });
    expect(result).toMatchObject({ ok: false, mutated: false, applied: false });
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
  });
});


describe('retired full-redraft correction has no writer', () => {
  it.each([false, true])('unsupported revise_model (mixed: %s) offers no card or write', async mixed => {
    const row = cases[0], w = await world(row);
    const legacy = { op: 'revise_model', kind: 'goal', label: 'Goal', quote: row.message };
    const ops = mixed ? [row.ops[0], legacy] : [legacy];
    const result = await dispatchTool('propose_change', JSON.stringify({ ops }), w.ctx, w.caps());
    expect(result).toMatchObject({ ok: false, mutated: false });
    expect(result).not.toHaveProperty('proposal_id');
    expect(w.proposals.size()).toBe(0); expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0);
    expect(w.graph()).toEqual(w.original);
  });

  it('a cold historic replace_draft card has no execution path, including its own press', async () => {
    const row = cases[0], w = await world(row);
    const offered = await dispatchTool('propose_change', JSON.stringify({ ops: row.ops }), w.ctx, w.caps());
    const prepared = w.proposals.get(String(offered.proposal_id))!;
    const operations = structuredClone(prepared.operations);
    operations[0]!.op = 'replace_draft';
    const historic = createProposal({ scenario_id: prepared.scenario_id, user_id: prepared.user_id,
      base_graph_identity_hash: prepared.base_graph_identity_hash, operations, provenance: prepared.provenance,
      validation: prepared.validation, public_label: prepared.public_label });
    const cold = restoreCard(historic, { ...offered, proposal_id: historic.proposal_id }, w.ctx);
    const typed = await w.caps(cold).authoriseChange({ ...w.ctx, user_turn_text: 'Yes.' }, { proposal_id: historic.proposal_id });
    expect(typed.ok).toBe(false);
    const pressed = await w.caps(cold).authoriseChange({ ...w.ctx, user_turn_text: '', typed_approval_of: historic.proposal_id }, { proposal_id: historic.proposal_id });
    expect(pressed).toMatchObject({ ok: false, applied: false, mutated: false, refusal: 'retired_correction' });
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
  });
});
