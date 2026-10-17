import { HistoryStore } from '../../orchestrator-v5/agent-lane/history-store.js';
import { userStatementOf } from '../../orchestrator-v5/agent-lane/user-statements.js';
import { prepareStatementCorrection, userStatementRecord, withUserStatement } from '../../orchestrator-v5/statement-door/statements.js';
import { subjectKey } from '../../orchestrator-v5/statement-door/subject.js';
import { typedByUser, userWordsOf } from '../../orchestrator-v5/agent-lane/stated-by-user.js';
import { log } from '../../utils/telemetry.js';
/** Saved-model corrections: real canonical adapters → own card → one native CAS registration → whole readback. */
import { applyGoalSteadyEdit } from '../../orchestrator-v5/goal-target/goal-steady-write.js';
import { horizonSteadyAttested } from '../../orchestrator-v5/goal-target/horizon-basis.js';
import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { guardAnalysisParticipation } from '../../orchestrator-v5/tools/handlers/run-analysis-participation-guard.js';
import { validateGraphStructure } from '../../orchestrator/graph-structure-validator.js';
import { boundNodeDescriptionForContext } from '../../orchestrator/context/graph-compact.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectAsCeeWriter } from '../../../tests/utils/inject-as-cee-writer.js';
import { withScenarioRevision } from '../../../tests/utils/revision-store-double.js';

vi.mock('../../config/index.js', async original => {
  const actual = await original<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false, hmacSecret: 'native-correction-horizon-test-only-key-20261016' } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../orchestrator-v5/session/index.js', async original => ({
  ...await original<Record<string, unknown>>(), getSessionStore: () => withScenarioRevision(storeRef.value!),
}));
vi.mock('../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

import { tryStructureOriginAnswer } from '../../cee/context-integrity/structure-origin-answer.js';
import { buildModelFromBrief, constructionOperationId } from '../../orchestrator-v5/agent-lane/runtime/build-model.js';
import { runPreparingDraftReplacement } from '../../orchestrator-v5/agent-lane/runtime/draft-replacement-context.js';
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

async function world(row: { readonly graph: Rec; readonly brief: string; readonly message: string }, options: { race?: boolean; loseAcknowledgement?: boolean; hideLedger?: boolean; provider?: (...args: any[]) => Promise<any>; ledger?: Rec; objections?: { finding_id: string; analysis_id: string; statement: string }[] } = {}) {
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
  const caps = (store = proposals) => createAgentCapabilities(dispatch, store, options.provider, 'full', undefined, { turnAuthority: true,
    readCommittedTurnLedger: async () => ({ first_user_message: row.brief, user_message_turn_ids: ['first'], ...options.ledger, write_turn_ids: options.hideLedger ? [] : writes.map(w => w.turn_id),
      complete: options.ledger?.complete ?? true }) as never, readStatedObjections: async () => options.objections ?? [] });
  const ctx = { scenario_id: sid, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: row.message, user_text: row.message, user_text_complete: true, verified_user_messages: [row.message] } satisfies AgentToolContext;
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
    const operations = prepared.operations.map((op, index) => index === 0
      ? { ...structuredClone(op), op: 'replace_draft' as const } : structuredClone(op));
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


describe('one native governing-outcome correction', () => {
  const source = 'If I could secure angel funding of even £250,000, that would buy me the breathing space to bring in technical resource and allow me to have more time.';
  const ambition = 'The larger fund of at least £1.3 million remains my later ambition, if the evidence supports it.';
  const args = { governing_outcome: 'Angel funding secured', goal_change_quote: source, later_ambition_quote: ambition,
    constraint_type: 'at_least', value: 250000, unit: '£', rationale: source };
  function funding(existing = true) {
    return { nodes: [
      { id: 'large_fund', kind: 'goal', label: 'Larger fund secured', goal_threshold_raw: 1300000, goal_threshold: 0.8,
        goal_threshold_cap: 1625000, goal_threshold_unit: '£',
        goal_threshold_frame: 'level', goal_direction: '>=', threshold_source: 'brief_extraction',
        goal_horizon: { deadline: '2027-12-31' }, goal_deadline_as_stated: 'by the end of next year',
        description: ambition },
      ...(existing ? [{ id: 'angel_fund', kind: 'outcome', label: 'Angel funding secured', description: 'Conditional on investor interest' }] : []),
      { id: 'focus', kind: 'option', label: 'Focus on the PoC', interventions: { effort: { value: 0.8 } } },
      { id: 'effort', kind: 'factor', label: 'Founder effort', observed_state: { value: 0.8, baseline: 0.8, source: 'brief_extraction' } },
      { id: 'rejected', kind: 'risk', label: 'Job-spec focus', description: 'Retained source: not the intended mechanism' },
    ], edges: [{ from: 'focus', to: 'effort', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      ...(existing ? [{ from: 'effort', to: 'angel_fund', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive' }] : []),
      { from: 'effort', to: 'large_fund', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.5, effect_direction: 'positive' }],
      goal_constraints: [{ constraint_id: 'original-target', node_id: 'large_fund', operator: '>=', value: 1300000,
        unit: '£', value_frame: 'level', role: 'goal_target', source_quote: ambition, provenance: 'explicit' }] };
  }
  const make = async (existing = true, options = {}) => {
    const parsed = GraphV3.safeParse(funding(existing)); expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    const w = await world({ graph: funding(existing), brief: ambition, message: source }, options);
    w.ctx.verified_user_messages = [ambition, source]; return w;
  };
  it.each([true, false])('prepares, cold-restores, presses and reads back the whole goal change (existing outcome %s)', async existing => {
    const w = await make(existing);
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('Olumi reads the target as');
    expect(offered.public_label).toContain('later ambition');
    expect(offered.public_label).toContain('1,300,000');
    expect(w.writes).toHaveLength(0);
    const proposal = w.proposals.get(String(offered.proposal_id))!;
    expect(proposal.operations).toHaveLength(1); expect(proposal.operations[0]!.op).toBe('repoint_goal');
    const chips = approvalChipsFor([{ name: 'propose_goal_target', ...offered } as never], () => ({ proposal, result: offered }));
    expect(chips.map(c => c.label)).toEqual(['Change the goal', 'At most instead', 'Change something first']);
    expect(offered.public_label).toContain('(at least £1,300,000)');
    expect(offered.public_label).not.toContain('>=');
    const cold = restoreCard(proposal, offered, w.ctx);
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, user_turn_text: 'Yes, at least' }, { proposal_id: proposal.proposal_id })).toMatchObject({ ok: false, mutated: false });
    const saved = await w.caps(cold).authoriseChange({ ...w.ctx, user_turn_text: '', typed_approval_of: proposal.proposal_id }, { proposal_id: proposal.proposal_id });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(w.sent).toHaveLength(1);
    const graph = w.graph(); const goal = graph.nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.label).toBe(args.governing_outcome); expect(goal.goal_threshold_raw).toBe(250000);
    expect(goal.goal_threshold_unit).toBe('£'); expect(goal.goal_direction).toBe('>=');
    expect(goal.threshold_source).toBe('cee_inference');
    expect(goal.user_statements[0].statements[0]).toMatchObject({ quote: source, source, reading: 'olumi' });
    const old = graph.nodes.find((n: Rec) => n.id === 'large_fund');
    expect(old).toMatchObject({ kind: 'outcome', goal_threshold_raw: 1300000, goal_horizon: { deadline: '2027-12-31' } });
    expect(old.description).toContain(ambition);
    expect(boundNodeDescriptionForContext(old.description)).toContain('at least £1.3 million');
    expect(boundNodeDescriptionForContext(old.description)).toContain('if the evidence supports it');
    expect(boundNodeDescriptionForContext(old.description)).toContain('later ambition');
    expect(old.description).toContain('Earlier saved bound: at least £1,300,000');
    expect(old.description).toContain('Earlier saved source quote');
    expect(old.description).toContain('they do not constrain the current goal');
    expect(graph.goal_constraints.some((r: Rec) => r.node_id === 'large_fund')).toBe(false);
    expect(graph.nodes.find((n: Rec) => n.kind === 'option')).toEqual(w.original.nodes.find((n: Rec) => n.kind === 'option'));
    const reopened = await w.caps(new ProposalStore()).getCanonicalState(w.ctx) as Rec;
    expect(reopened.goal.label).toBe(args.governing_outcome);
    const earlier = reopened.entities.find((n: Rec) => n.id === 'large_fund');
    expect(earlier.full_label).toBe(old.description);
    expect(earlier.full_label).toContain(ambition);
    expect(computeAnalysisAffectingGraphHash(graph as never)).not.toEqual(computeAnalysisAffectingGraphHash(w.original as never));
  });
  it('composes a requested removal on the same prepared card and one native save', async () => {
    const w = await make(); const quote = 'Remove the risk “Job-spec focus”.';
    w.ctx.user_turn_text = quote; w.ctx.user_text += '\n' + quote; w.ctx.verified_user_messages = [ambition, source, quote];
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, remove_mechanisms: [{ kind: 'risk', label: 'Job-spec focus', quote }] }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('does not mean it cannot happen'); expect(w.writes).toHaveLength(0);
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(w.graph().nodes.some((n: Rec) => n.id === 'rejected')).toBe(false);
  });
  it.each(['figure', 'source', 'reported', 'unit', 'ambition'] as const)('refuses unsupported %s with no proposal/write', async fault => {
    const w = await make(); const input = { ...args };
    if (fault === 'figure') input.value = 280000;
    if (fault === 'source') input.goal_change_quote = 'We need £250,000.';
    if (fault === 'reported') { input.goal_change_quote = 'Olumi suggested £250,000, but I reject that figure.'; w.ctx.verified_user_messages = [input.goal_change_quote]; }
    if (fault === 'unit') input.unit = 'customers';
    if (fault === 'ambition') input.later_ambition_quote = 'This is definitely the later ambition.';
    const result = await dispatchTool('propose_goal_target', JSON.stringify(input), w.ctx, w.caps());
    expect(result).toMatchObject({ ok: false, mutated: false }); expect(result).not.toHaveProperty('proposal_id');
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
  });
  it('names the native removal refusal while offering the valid goal change', async () => {
    const w = await make();
    const result = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, remove_mechanisms: [{ kind: 'risk', label: 'Missing risk', quote: source }] }), w.ctx, w.caps());
    expect(result).toMatchObject({ ok: true, mutated: false, not_included: [{ part: 'removal of Missing risk', refusal: 'subject_not_found' }] });
    expect(result.public_label).toContain('Missing risk'); expect(w.proposals.size()).toBe(1); expect(w.writes).toHaveLength(0);
  });
  it('a concurrent native edit refuses without saving any part of the goal change', async () => {
    const w = await make(true, { race: true });
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true });
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
  });
  it('includes the stated current level and modelled deadline on the same card/save', async () => {
    const w = await make();
    const quote = 'Angel funding secured is £0 today. I need at least £250,000 in angel funding by 30 June 2027.';
    w.ctx.user_text = quote; w.ctx.user_turn_text = quote; w.ctx.verified_user_messages = [ambition, quote];
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, goal_change_quote: quote,
      current_level: { value: 0, unit: '£' }, deadline_words: '30 June 2027' }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('£0'); expect(offered.public_label).toContain('2027'); expect(w.writes).toHaveLength(0);
    const pid = String(offered.proposal_id), cold = restoreCard(w.proposals.get(pid)!, offered, w.ctx);
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    const goal = w.graph().nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.observed_state).toMatchObject({ raw_value: 0, unit: '£', cap: goal.goal_threshold_cap, source: 'user_override' });
    expect(goal.goal_horizon).toEqual({ deadline: '2027-06-30' }); expect(goal.goal_horizon_months).toBeGreaterThan(0);
    expect(w.graph().nodes.find((n: Rec) => n.id === 'large_fund').goal_horizon).toEqual({ deadline: '2027-12-31' });
    expect(w.writes).toHaveLength(1);
  });
  it.each(['level', 'deadline'])('an unsupported %s is explicitly left out without losing the valid goal card', async missing => {
    const w = await make();
    const extra = missing === 'level' ? { current_level: { value: 200, unit: '£' } } : { deadline_words: 'tomorrow' };
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, ...extra }), w.ctx, w.caps());
    expect(offered).toMatchObject({ ok: true, mutated: false });
    expect((offered.not_included as Rec[])).toHaveLength(1); expect(offered.public_label).toContain('Not included on this card');
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal').goal_threshold_raw).toBe(250000);
  });
  it('requested factor removal shows its option-setting consequence and saves it with the goal', async () => {
    const w = await make(); const quote = 'Remove the factor “Founder effort”.';
    w.ctx.user_turn_text = quote; w.ctx.user_text += '\n' + quote; w.ctx.verified_user_messages = [ambition, source, quote];
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, remove_mechanisms: [{ kind: 'factor', label: 'Founder effort', quote }] }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('no longer sets it');
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.some((n: Rec) => n.id === 'effort')).toBe(false);
    expect(w.graph().nodes.find((n: Rec) => n.id === 'focus').interventions).not.toHaveProperty('effort'); expect(w.writes).toHaveLength(1);
  });
  it.each(['ambition', 'deadline', 'factor', 'new_target', 'new_source', 'forged_timing'] as const)('a prepared complete candidate cannot lose an untouched %s before minting', async missing => {
    const w = await make(); const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true });
    const original = w.proposals.get(String(offered.proposal_id))!, operations = structuredClone(original.operations);
    const value = operations[0]!.value as Rec, graph = value.candidate;
    if (missing === 'ambition') delete graph.nodes.find((n: Rec) => n.id === 'large_fund').description;
    if (missing === 'deadline') delete graph.nodes.find((n: Rec) => n.id === 'large_fund').goal_horizon;
    if (missing === 'new_target') graph.nodes.find((n: Rec) => n.kind === 'goal').goal_threshold_raw = 280000;
    if (missing === 'new_source') delete graph.nodes.find((n: Rec) => n.kind === 'goal').user_statements;
    if (missing === 'forged_timing') graph.nodes.find((n: Rec) => n.kind === 'goal').horizon_basis = { basis: 'steady_attested', source: 'user_stated', bound_months: 8 };
    if (missing === 'factor') graph.nodes.find((n: Rec) => n.id === 'effort').observed_state.value = 0.2;
    value.operation_id = constructionOperationId(w.ctx.scenario_id, 'broken-goal:' + computeGraphIdentityHash(graph as never)!.value);
    const broken = createProposal({ scenario_id: original.scenario_id, user_id: original.user_id,
      base_graph_identity_hash: original.base_graph_identity_hash, operations, provenance: original.provenance,
      validation: original.validation, public_label: original.public_label });
    w.proposals.put(broken);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: broken.proposal_id }, { proposal_id: broken.proposal_id })).toMatchObject({ ok: false, mutated: false, refusal: 'incomplete_goal_postimage' });
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });
  it('cold retry confirms the exact recorded operation and whole candidate without a second write', async () => {
    const w = await make(true, { loseAcknowledgement: true });
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true });
    const pid = String(offered.proposal_id), proposal = w.proposals.get(pid)!;
    const press = { ...w.ctx, typed_approval_of: pid };
    expect(await w.caps().authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: false, refusal: 'not_confirmed' });
    const cold = restoreCard(proposal, offered, w.ctx);
    expect(await w.caps(cold).authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, mutated: false, applied: true, already_applied: true });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
  });

  it('preserves the complete existing funding model while adding a new governing outcome', async () => {
    const recorded = fixture('funding-247ae5b4-before-target.json');
    const w = await world({ graph: recorded.graph, brief: recorded.brief_text, message: source });
    w.ctx.verified_user_messages = [source];
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, later_ambition_quote: undefined }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.filter((n: Rec) => n.kind === 'option')).toEqual(w.original.nodes.filter((n: Rec) => n.kind === 'option'));
    expect(w.graph().edges).toEqual(w.original.edges); expect(w.writes).toHaveLength(1);
  });

  it('cannot silently rescale an existing outcome’s old-unit current level during re-goal', async () => {
    const quote = 'I want at least 250000 customers to be our current aim.';
    const graph: Rec = funding(); graph.nodes.find((n: Rec) => n.id === 'angel_fund')!.observed_state = { value: 0.1, baseline: 0.1, raw_value: 10, cap: 100, unit: '£', source: 'user_override' };
    const w = await world({ graph, brief: ambition, message: quote });
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, unit: 'customers', goal_change_quote: quote, later_ambition_quote: undefined }), w.ctx, w.caps());
    expect(offered).toMatchObject({ ok: false, mutated: false, refusal: 'current_level_unit_change' });
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
  });

  it('keeps the existing science restriction on a newly selected forecast-chance outcome', async () => {
    const quote = 'I want the probability of launch on time to be at least 0.8.';
    const w = await world({ graph: funding(), brief: ambition, message: quote });
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ governing_outcome: 'On-time launch',
      goal_change_quote: quote, constraint_type: 'at_least', value: 0.8, unit: 'probability of launch on time', rationale: quote }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: false, mutated: false, refusal: 'goal_measures_a_forecast' });
    expect(w.proposals.size()).toBe(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
  });

  it('resolves an existing outcome id to the saved human label on its bound card', async () => {
    const w = await make();
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, governing_outcome: 'angel_fund' }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('Angel funding secured'); expect(offered.public_label).not.toContain('angel_fund');
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal').label).toBe('Angel funding secured'); expect(w.writes).toHaveLength(1);
  });

  it.each(['licensed', 'stale', 'none'] as const)('keeps earlier timing context without transferring its permission (%s)', async state => {
    let graph: Rec = funding(); graph.nodes.find((n: Rec) => n.id === 'large_fund').goal_horizon_months = 8;
    if (state !== 'none') {
      const issued = applyGoalSteadyEdit(graph, { goal_id: 'large_fund', months: 8 }, 'test-old-scenario');
      expect(issued.kind).toBe('mutated'); if (issued.kind !== 'mutated') throw Error('fixture judgement not issued');
      graph = issued.mutatedGraph; expect(horizonSteadyAttested(graph)).toBe(true);
      if (state === 'stale') graph.nodes.find((n: Rec) => n.id === 'large_fund').goal_horizon = { deadline: '2027-11-30' };
    }
    expect(horizonSteadyAttested(graph)).toBe(state === 'licensed');
    const w = await world({ graph, brief: ambition, message: source }); w.ctx.verified_user_messages = [ambition, source];
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id), cold = restoreCard(w.proposals.get(pid)!, offered, w.ctx);
    const saved = await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, applied: true });
    const earlier = w.graph().nodes.find((n: Rec) => n.id === 'large_fund');
    expect(earlier).not.toHaveProperty('horizon_basis');
    expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal')).not.toHaveProperty('horizon_basis');
    expect(horizonSteadyAttested(w.graph())).toBe(false);
    if (state !== 'none') { expect(earlier.description).toContain('8 months'); expect(earlier.description).toContain('user_stated'); }
    expect(w.writes).toHaveLength(1);
  });

  it('switching back never revives the earlier goal deadline or its former role', async () => {
    const graph = funding(); Object.assign(graph.nodes.find((n: Rec) => n.id === 'large_fund')!,
      { goal_horizon_months: 15, goal_horizon_reference_date: '2026-10-16', goal_horizon_stated_months: 15, goal_period: 'month' });
    const w = await world({ graph, brief: ambition, message: source }); w.ctx.verified_user_messages = [ambition, source];
    const first = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    const firstId = String(first.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: firstId }, { proposal_id: firstId })).toMatchObject({ ok: true, applied: true });
    const back = 'Make the larger fund of at least £1,500,000 the current goal again.';
    const current = { ...w.ctx, turn_id: randomUUID(), user_turn_text: back, user_text: back, verified_user_messages: [ambition, source, back] };
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ governing_outcome: 'Larger fund secured', goal_change_quote: back,
      constraint_type: 'at_least', value: 1500000, unit: '£', rationale: back }), current, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id), cold = restoreCard(w.proposals.get(pid)!, offered, current);
    expect(await w.caps(cold).authoriseChange({ ...current, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    const goal = w.graph().nodes.find((n: Rec) => n.kind === 'goal');
    for (const key of ['goal_horizon', 'goal_horizon_months', 'goal_deadline_as_stated', 'horizon_basis',
      'goal_horizon_reference_date', 'goal_horizon_stated_months', 'goal_period']) expect(goal).not.toHaveProperty(key);
    expect(goal.description).toMatch(/^Earlier aim \(history, later ambition\): at least £1,300,000/);
    expect(boundNodeDescriptionForContext(goal.description)).toContain('if the evidence supports it');
    expect(goal.description).not.toContain('Current governing goal proposed');
    expect(goal.description).toContain('31 December 2027');
    expect(goal.description).toContain('16 October 2026'); expect(goal.description).toContain('15 months');
    expect(goal.description).toContain('per month');
    expect(w.writes).toHaveLength(2);
  });

  it('retains the earlier aim outside this analysis so a ready chain stays ready', async () => {
    const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' });
    const g = { nodes: [
      { id: 'dec', kind: 'decision', label: 'How to split time' },
      { id: 'large_fund', kind: 'goal', label: 'Larger fund secured', goal_threshold_raw: 1300000, goal_threshold: 0.8, goal_threshold_cap: 1625000, goal_threshold_unit: '£',
        goal_threshold_frame: 'level', goal_direction: '>=', threshold_source: 'brief_extraction', description: ambition },
      { id: 'angel_fund', kind: 'outcome', label: 'Angel funding secured' },
      { id: 'focus', kind: 'option', label: 'Investor-led', interventions: { effort: { value: 0.8 } } },
      { id: 'spread', kind: 'option', label: 'Balanced', interventions: { effort: { value: 0.4 } } },
      { id: 'effort', kind: 'factor', label: 'Investor outreach time', category: 'controllable', observed_state: { value: 0.5, baseline: 0.5, source: 'brief_extraction' } },
    ], edges: [e('dec', 'focus'), e('dec', 'spread'), e('focus', 'effort'), e('spread', 'effort'), e('effort', 'angel_fund'), e('angel_fund', 'large_fund')],
      goal_constraints: [{ constraint_id: 'original-target', node_id: 'large_fund', operator: '>=', value: 1300000, unit: '£', value_frame: 'level', role: 'goal_target', source_quote: ambition, provenance: 'explicit' }] };
    const w = await world({ graph: g, brief: ambition, message: source }); w.ctx.verified_user_messages = [ambition, source];
    expect(assessCanonicalAnalysisReadiness(w.graph()).safeToAnalyse).toBe(true);
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('left out of this analysis');
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    const after = w.graph(), read = assessCanonicalAnalysisReadiness(after);
    expect(read.blockingIssues).toEqual([]); expect(read.safeToAnalyse).toBe(true);
    expect(after.nodes.find((n: Rec) => n.id === 'large_fund')).toMatchObject({ kind: 'outcome', analysis_participation: 'retained_excluded' });
    const wire = guardAnalysisParticipation(after, { goalNodeId: 'angel_fund', optionInterventionTargetIds: ['effort'], submittedOptionIds: ['focus', 'spread'] });
    expect(wire.refusals).toEqual([]); expect(wire.excludedNodeIds).toEqual(['large_fund']);
    expect((wire.graph as Rec).nodes.some((n: Rec) => n.id === 'large_fund')).toBe(false);
    expect((wire.graph as Rec).edges.some((e: Rec) => e.from === 'large_fund' || e.to === 'large_fund')).toBe(false);
    const ordinary = structuredClone(after); delete ordinary.nodes.find((n: Rec) => n.id === 'large_fund').analysis_participation;
    expect(assessCanonicalAnalysisReadiness(ordinary).safeToAnalyse).toBe(false);
    expect(validateGraphStructure(GraphV3.parse(ordinary), { leaveOutInertRisks: true }).violations.some(i => i.code === 'NO_PATH_TO_GOAL' && i.detail.includes('Larger fund'))).toBe(true);
    const changed = structuredClone(after); changed.nodes.find((n: Rec) => n.id === 'focus').interventions.large_fund = { value: 0.2 };
    expect(assessCanonicalAnalysisReadiness(changed).safeToAnalyse).toBe(false);
    const limited = structuredClone(after); limited.goal_constraints.push({ constraint_id: 'held-limit', node_id: 'large_fund', operator: '<=', value: 2000000, unit: '£', provenance: 'explicit' });
    limited.edges = limited.edges.filter((e: Rec) => e.from !== 'large_fund' && e.to !== 'large_fund');
    expect(assessCanonicalAnalysisReadiness(limited).safeToAnalyse).toBe(false);
    expect(validateGraphStructure(GraphV3.parse(limited), { leaveOutInertRisks: true }).violations.some(i => i.code === 'ORPHAN_NODE' && i.detail.includes('Larger fund'))).toBe(true);
    expect(w.writes).toHaveLength(1);
  });

  it('the recorded founder words still offer a goal card when earlier level and removal cannot be included', async () => {
    const recorded = fixture('funding-247ae5b4-before-target.json');
    const noFunding = "I feel like you're going down the wrong route. We have no funding. I cannot carry on as I am now. I need to get funding as soon as possible. I probably need a PoC as soon as I have an interview/meeting with an investor, but I obviously need to get investors to ask to speak to me first.";
    const job = "The job specification is just the work I would be doing if I was focusing on that, so I'm not sure we should be focusing on it. The question I'm trying to answer is how to best divide my time.";
    const update = "I feel like we're going around in circles. Can you just update the model to reflect our conversation so I can actually decide what to spend my time on?";
    const w = await world({ graph: recorded.graph, brief: recorded.brief_text, message: update });
    w.ctx.verified_user_messages = [noFunding, job, source, update]; w.ctx.user_text = w.ctx.verified_user_messages.join('\n');
    const offered = await dispatchTool('propose_goal_target', JSON.stringify({ ...args, later_ambition_quote: undefined,
      current_level: { value: 0, unit: '£' }, remove_mechanisms: [{ kind: 'factor', label: 'Founder job-spec time', quote: job }] }), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const omitted = offered.not_included as Rec[];
    expect(omitted).toHaveLength(2); expect(omitted.every(p => p.refusal && p.detail)).toBe(true);
    expect(omitted.find(p => p.part.includes('removal'))).toMatchObject({ refusal: 'not_current_removal' });
    expect(offered.public_label).toContain('Not included on this card');
    expect(offered.public_label).toContain('Today’s level');
    expect(offered.public_label).not.toContain('Say so plainly');
    expect(offered.public_label).not.toContain('0 £');
    expect(offered.public_label).not.toContain('not current removal permission');
    expect(omitted.find(p => p.part.includes('level'))?.detail).toContain('Say so plainly');
    expect(w.writes).toHaveLength(0);
    const pid = String(offered.proposal_id);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal').goal_threshold_raw).toBe(250000);
    expect(w.graph().nodes.some((n: Rec) => n.id === 'founder_job_spec_time')).toBe(w.original.nodes.some((n: Rec) => n.id === 'founder_job_spec_time'));
    expect(w.writes).toHaveLength(1);
  });

  it('keeps the outcome’s full conditional description first through card, save and cold context', async () => {
    const graph = funding();
    const condition = 'Only if investor interest is credible and the PoC supports it. Priya disputes whether more outreach alone can resolve the funding gap; this is uncertain and needs evidence before we commit.';
    graph.nodes.find((n: Rec) => n.id === 'angel_fund')!.description = condition;
    const w = await world({ graph, brief: ambition, message: source }); w.ctx.verified_user_messages = [ambition, source];
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!;
    const proposed = (held.operations[0]!.value as Rec).candidate.nodes.find((n: Rec) => n.kind === 'goal');
    expect(proposed.description).toBe(condition);
    expect(boundNodeDescriptionForContext(proposed.description)).toMatch(/^Only if investor interest is credible/);
    expect(boundNodeDescriptionForContext(proposed.description)).toContain('Priya disputes');
    const cold = restoreCard(held, offered, w.ctx);
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    const reopened = await w.caps(new ProposalStore()).getCanonicalState(w.ctx) as Rec;
    expect(reopened.entities.find((n: Rec) => n.id === 'angel_fund').full_label).toBe(condition);
    expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal').description).toBe(condition);
    expect(w.writes).toHaveLength(1);
  });

  it('ordinary target correction keeps the stated earlier ambition, source, conditions and dissent through cold native save', async () => {
    const graph = funding(false); graph.nodes[0].label = 'Funding secured';
    graph.nodes[0].description = 'Priya disputes this ambition unless the investor evidence improves. ' + ambition.repeat(3);
    const message = source + ' ' + ambition;
    const w = await world({ graph, brief: ambition, message }); w.ctx.verified_user_messages = [ambition, message];
    const request = { constraint_type: 'at_least', value: 250000, unit: '£', measures: 'Funding secured', rationale: source, later_ambition_quote: ambition };
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(request), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('The earlier target remains as history and later ambition');
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!;
    const value = held.operations[0]!.value as Rec;
    expect(held.operations[0]!.op).toBe('set_goal_target');
    const goal = value.candidate.nodes.find((n: Rec) => n.kind === 'goal');
    expect(goal.id).toBe('large_fund'); expect(goal.goal_threshold_raw).toBe(250000);
    expect(goal.goal_horizon).toEqual({ deadline: '2027-12-31' });
    expect(goal.description).not.toContain('governing aim before');
    expect(goal.description).not.toContain('does not set the current goal’s deadline');
    expect(goal.description).not.toContain('Earlier timing');
    expect(offered.public_label).toContain('saved target at least £1,300,000');
    expect(goal.description).toContain(graph.nodes[0].description);
    expect(boundNodeDescriptionForContext(goal.description)).toContain('Earlier target');
    expect(boundNodeDescriptionForContext(goal.description)).toContain('£1,300,000');
    expect(boundNodeDescriptionForContext(goal.description)).toContain('Priya disputes');
    expect(w.writes).toHaveLength(0);
    const cold = restoreCard(held, offered, w.ctx);
    const saved = await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(value.candidate, w.graph())).toBe(true);
    expect(w.graph().goal_constraints.filter((r: Rec) => r.role === 'goal_target').map((r: Rec) => r.value)).toEqual([250000]);
    expect(w.graph().nodes.filter((n: Rec) => n.kind === 'option')).toEqual(graph.nodes.filter((n: Rec) => n.kind === 'option'));
    const read = await w.caps(new ProposalStore()).getCanonicalState(w.ctx) as Rec;
    expect(read.entities.find((n: Rec) => n.id === 'large_fund').full_label).toContain(ambition);
    // An unbound AI reading cannot acquire human authorship or silently replace another saved aim.
    const unbound = await dispatchTool('propose_goal_target', JSON.stringify({ ...request, later_ambition_quote: 'The later ambition is £9 million.' }), w.ctx, w.caps());
    expect(unbound).toMatchObject({ ok: true, mutated: false });
    expect(unbound.public_label).toContain('Olumi’s unverified later-ambition reading');
    expect(unbound.public_label).toContain('approval does not verify them');
    expect(w.writes).toHaveLength(1);
    const unboundPid = String(unbound.proposal_id), unboundCard = w.proposals.get(unboundPid)!;
    const unboundCold = restoreCard(unboundCard, unbound, w.ctx);
    expect(await w.caps(unboundCold).authoriseChange(w.ctx, { proposal_id: unboundPid })).toMatchObject({ ok: false, mutated: false });
    expect(await w.caps(unboundCold).authoriseChange({ ...w.ctx, typed_approval_of: unboundPid }, { proposal_id: unboundPid })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(2);
    const afterUnbound = w.graph().nodes.find((n: Rec) => n.id === 'large_fund');
    expect(afterUnbound.description).toContain('Olumi’s unverified reading: “The later ambition is £9 million.”');
    expect(afterUnbound.user_statements.flatMap((r: Rec) => r.statements).some((s: Rec) => s.quote === 'The later ambition is £9 million.' && s.speaker === 'user')).toBe(false);
    expect(w.graph().goal_constraints.filter((r: Rec) => r.role === 'goal_target').map((r: Rec) => r.value)).toEqual([250000]);
  });

});


// Same synthetic bakery as the prepare-only contract: native saved replacement, no real provider or analysis.
const bakery = fixture('bakery-prepare-only.json');
const rebuildRequest = 'Please generate a replacement model for this scenario, retaining our current goal, options and recorded contributions.';
const framing = 'Olumi proposes checking whether a new market could sell 9999 loaves. This is an assumption, not a user figure.';
async function bakeryWorld(options: Parameters<typeof world>[1] = {}, change?: (g: Rec) => void) {
  const seed = await runPreparingDraftReplacement('bakery-seed', () => buildModelFromBrief('bakery-seed', bakery.brief,
    (async () => { throw new Error('Preparation must not dispatch'); }) as never,
    (async () => ({ text: JSON.stringify(bakery.draft), status: 'completed' })) as never));
  expect(seed.ok, JSON.stringify(seed)).toBe(true);
  const graph = structuredClone(seed.prepared_graph) as Rec;
  change?.(graph);
  const calls: Rec[] = [];
  const provider = vi.fn(async (req: Rec) => { calls.push(req); return { text: JSON.stringify(bakery.draft), status: 'completed' }; });
  const w = await world({ graph, brief: bakery.brief, message: rebuildRequest }, { provider, ...options });
  const offer = () => dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: rebuildRequest }), w.ctx, w.caps());
  return { ...w, offer, calls, provider };
}

/** The route reads authorship BEFORE recordTyped; coverage is not the current typed turn's provenance. */
function routeRebuildContext(w: Awaited<ReturnType<typeof bakeryWorld>>, message: string, turn = 17, source = 'composer', earlierRequest?: string) {
  const histories = new HistoryStore();
  const coverage: boolean[] = [];
  let current: Omit<typeof w.ctx, 'user_text_complete'> & { user_text_complete: boolean } = w.ctx;
  for (let i = 1; i <= turn; i++) {
    const text = i === turn ? message : i === 1 ? bakery.brief : i === turn - 1 && earlierRequest !== undefined ? earlierRequest : 'Keep the same current goal and all named options.';
    const body = { kind: 'message', source: i === turn ? source : 'composer', message: text };
    const typedNow = typedByUser(body) ? text : null;
    const authorship = histories.authorshipWords(w.ctx.scenario_id);
    current = { ...w.ctx, user_turn_text: typedNow ?? '', user_text: userWordsOf(authorship.verified, typedNow),
      verified_user_messages: [...authorship.verified, ...(typedNow === null ? [] : [typedNow])], user_text_complete: authorship.complete };
    coverage.push(current.user_text_complete);
    if (typedNow !== null) histories.recordTyped(w.ctx.scenario_id, typedNow, current.user_text_complete);
    histories.set(w.ctx.scenario_id, [...histories.get(w.ctx.scenario_id), { role: 'user', content: [{ type: 'input_text', text }] }]);
  }
  return { ctx: current, coverage };
}

describe('explicit CURRENT rebuild through the native correction writer', () => {
  // Seen 13695c88 inputs; the quoted tool arguments below are declared controls, NOT reconstructed historical arguments.
  it.each([
    [11, "I feel like we're going around in circles. Can you just update the model to reflect our conversation so I can actually decide what to spend my time on?", 'Can you just update the model to reflect our conversation so I can actually decide what to spend my time on?'],
    [16, "Okay, let's go with that. Send that brief, create a new model, and produce your estimates for me to review.", "Okay, let's go with that. Send that brief, create a new model, and produce your estimates for me to review."],
    [17, "I've already agreed with this brief. Generate a new model based on this brief.", 'Generate a new model based on this brief.'],
  ] as const)('route-shaped coverage at founder T%s still prepares a complete current-source card and cold-saves once', async (turn, message, quote) => {
    const w = await bakeryWorld();
    const { ctx, coverage } = routeRebuildContext(w, message, turn);
    expect(coverage).toEqual(Array(turn).fill(false));
    expect(ctx.verified_user_messages.at(-1)).toBe(message); expect(ctx.user_turn_text).toBe(message);
    const offered = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: quote }), ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!, value = held.operations[0]!.value as Rec;
    expect(held.provenance.basis).toBe(message); expect(value.explicit_rebuild_request).toBe(message);
    expect(value.goal_turn_id).toBe(ctx.turn_id); expect(offered.public_label).toContain(`From your current message: “${message}”`);
    const cold = restoreCard(held, offered, ctx);
    expect(await w.caps(cold).authoriseChange({ ...ctx, user_turn_text: 'Yes' }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(await w.caps(cold).authoriseChange({ ...ctx, typed_approval_of: 'another-card' }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
    const press = { ...ctx, user_turn_text: '', typed_approval_of: pid };
    expect(await w.caps(cold).authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(value.candidate, w.graph())).toBe(true);
    expect(w.graph().nodes.filter((n: Rec) => n.kind === 'option')).toEqual(w.original.nodes.filter((n: Rec) => n.kind === 'option'));
    expect(w.graph().nodes.find((n: Rec) => n.kind === 'goal')).toEqual(w.original.nodes.find((n: Rec) => n.kind === 'goal'));
    expect(await w.caps(cold).authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, mutated: false, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });

  it.each(['empty_rebuild_signal', 'card_press', 'not_whole_current_statement', 'current_turn_unverified'] as const)(
    'refusal diagnostics record %s locally without changing the AI-facing result', async check => {
      const w = await bakeryWorld();
      const message = check === 'card_press' ? 'Yes, make this change.' : rebuildRequest;
      const { ctx: typed } = routeRebuildContext(w, message);
      // The unverified case exercises the capability's defensive contract, not a claim that the typed route omits its turn.
      const ctx = { ...typed, ...(check === 'card_press' ? { typed_approval_of: 'another-card' } : {}),
        ...(check === 'current_turn_unverified' ? { verified_user_messages: [] } : {}) };
      const argument = check === 'empty_rebuild_signal' ? '' : check === 'not_whole_current_statement' ? 'generate a replacement model' : message;
      const info = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
      try {
        const out = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: argument }), ctx, w.caps());
        expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'current_request_required' });
        expect(Object.keys(out).sort()).toEqual(['detail', 'mutated', 'ok', 'refusal']);
        const events = info.mock.calls.map(([entry]) => entry as Rec).filter(e => e.event === 'v5.agent.tool_refused');
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ tool: 'build_model_from_brief', request_id: ctx.request_id, scenario_id: ctx.scenario_id,
          turn_id: ctx.turn_id, refusal: 'current_request_required', failed_checks: expect.arrayContaining([check]),
          argument_length: argument.length, argument_sha256: createHash('sha256').update(argument).digest('hex'),
          current_turn_length: message.length, current_turn_sha256: createHash('sha256').update(message).digest('hex'),
          arg_is_whole_turn: argument === message });
        expect(w.calls).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0);
      } finally { info.mockRestore(); }
    });

  it('refusal logs contain no raw argument, current text, brief or credentials, even beyond the preview bound', async () => {
    const w = await bakeryWorld();
    const message = 'Private current message: password secret-current-value. '.repeat(20);
    const argument = 'Private AI argument: Bearer secret-argument-value. '.repeat(20);
    const { ctx } = routeRebuildContext(w, message);
    const info = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
    try {
      const out = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: argument }), ctx, w.caps());
      expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'current_request_required' });
      const events = info.mock.calls.map(([entry]) => entry as Rec).filter(e => e.event === 'v5.agent.tool_refused');
      expect(events).toHaveLength(1);
      expect(Object.keys(events[0]).sort()).toEqual(['arg_is_whole_turn', 'argument_length', 'argument_sha256', 'current_turn_length',
        'current_turn_sha256', 'event', 'failed_checks', 'refusal', 'request_id', 'scenario_id', 'tool', 'turn_id'].sort());
      expect(events[0]).toMatchObject({ argument_length: argument.length, argument_sha256: createHash('sha256').update(argument).digest('hex'),
        current_turn_length: message.length, current_turn_sha256: createHash('sha256').update(message).digest('hex') });
      expect(JSON.stringify(events)).not.toMatch(/secret-current-value|secret-argument-value|Private current|Private AI|Bearer|password/);
      expect(JSON.stringify(events)).not.toContain(framing); expect(JSON.stringify(events)).not.toContain(bakery.brief);
      expect(Object.keys(out).sort()).toEqual(['detail', 'mutated', 'ok', 'refusal']);
      expect(w.calls).toHaveLength(0); expect(w.writes).toHaveLength(0);
    } finally { info.mockRestore(); }
  });

  it('incomplete typed-history coverage keeps restored source unknown while the complete ledger permits a card', async () => {
    const unknown = 'A colleague reported the pilot might be too risky; the speaker has not been verified.';
    const w = await bakeryWorld({ ledger: { complete: true, user_message_turn_ids: ['first', 'restored'],
      later_user_messages: [{ turn_id: 'restored', text: unknown }] } });
    const { ctx } = routeRebuildContext(w, rebuildRequest);
    expect(ctx.user_text_complete).toBe(false); expect(ctx.verified_user_messages).not.toContain(unknown);
    const out = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: rebuildRequest }), ctx, w.caps());
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: false });
    expect(w.calls[0].input).toContain(JSON.stringify({ speaker: 'unknown', source: 'stored, origin not verified', text: unknown }));
    expect(w.calls[0].input).not.toContain(JSON.stringify({ speaker: 'user', source: 'typed', text: unknown }));
    expect(w.writes).toHaveLength(0);
  });

  it.each([undefined, 'An incidental fragment supplied as a rebuild flag'])('first build follows normal construction on an empty scenario (flag: %s)', async flag => {
    const provider = vi.fn(async () => ({ text: JSON.stringify(bakery.draft), status: 'completed' }));
    const w = await world({ graph: { nodes: [], edges: [] }, brief: bakery.brief, message: bakery.brief }, { provider });
    const built = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: bakery.brief,
      ...(flag === undefined ? {} : { explicit_rebuild_request: flag }) }), w.ctx, w.caps());
    expect(built, JSON.stringify(built)).toMatchObject({ ok: true, mutated: true });
    expect(provider).toHaveBeenCalled();
    // The real register route and serialized append store the constructed graph once; this is no read-only success fake.
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
    expect(w.graph().nodes.length).toBeGreaterThan(0);
    expect(w.graph().nodes.some((n: Rec) => n.kind === 'goal')).toBe(true);
    expect(approvedGraphHeld(w.sent[0]!.graph, w.graph())).toBe(true);
    expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0);
  });

  it('⭐ prepares the full report with zero writes, cold-restores its own card, saves once and keeps exact sources from an earlier instant', async () => {
    const w = await bakeryWorld({}, g => { g.nodes[0].description = 'The manager disputes this forecast unless the pilot works.';
      const goal = g.nodes.find((n: Rec) => n.kind === 'goal'); goal.goal_horizon = { deadline: '2027-06-30' }; goal.goal_deadline_as_stated = 'by the end of June 2027'; });
    const offered = await w.offer();
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.writes).toHaveLength(0); expect(w.sent).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    expect(offered.prepared_graph).toBeUndefined(); expect(offered.pending_action).toBeUndefined();
    expect(offered.open_questions).toEqual(expect.arrayContaining([expect.stringMatching(/Which date/)]));
    expect(offered.not_represented).toEqual(expect.arrayContaining([expect.stringMatching(/Keep current setup/)]));
    expect(w.calls[0].input).toContain('context only, not user source');
    expect(JSON.stringify(w.calls)).toContain(framing);
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!;
    const value = held.operations[0]!.value as Rec;
    expect(value.candidate).toEqual(offered.proposed_model);
    for (const n of w.original.nodes) {
      const kept = value.candidate.nodes.find((x: Rec) => x.id === n.id);
      if (n.user_statements) expect(kept.user_statements).toEqual(n.user_statements);
      if (n.kind === 'option') expect(kept.interventions).toEqual(n.interventions);
    }
    expect(value.construction_report.open_questions).toEqual(offered.open_questions);
    const oldGoal = w.original.nodes.find((n: Rec) => n.kind === 'goal');
    expect(value.candidate.nodes.find((n: Rec) => n.id === oldGoal.id)).toEqual(oldGoal);
    expect(JSON.stringify(value.candidate)).not.toContain('9999');
    const cold = restoreCard(held, offered, w.ctx);
    const press = { ...w.ctx, turn_id: randomUUID(), user_turn_text: '', typed_approval_of: pid };
    const saved = await w.caps(cold).authoriseChange(press, { proposal_id: pid });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(w.sent).toHaveLength(1);
    expect(approvedGraphHeld(value.candidate, w.graph())).toBe(true);
    expect(w.graph().nodes.find((n: Rec) => n.id === oldGoal.id)).toEqual(oldGoal);
    expect(await w.caps(cold).authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, mutated: false, applied: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });
  it('lost acknowledgement: a cold retry recovers only its own native operation and complete candidate', async () => {
    const w = await bakeryWorld({ loseAcknowledgement: true }); const offered = await w.offer();
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true });
    const pid = String(offered.proposal_id), held = structuredClone(w.proposals.get(pid)!);
    const press = { ...w.ctx, user_turn_text: '', typed_approval_of: pid };
    expect(await w.caps().authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: false, refusal: 'not_confirmed' });
    const cold = restoreCard(held, offered, w.ctx);
    expect(await w.caps(cold).authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, mutated: false, applied: true, already_applied: true });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
  });
  it.each(['missing', 'earlier', 'assistant', 'chip'])("%s request authority cannot prepare or write", async kind => {
    const w = await bakeryWorld();
    const { ctx: routed } = routeRebuildContext(w, kind === 'earlier' ? 'Please explain the current model.' : rebuildRequest,
      17, kind === 'assistant' ? 'coaching' : 'composer', kind === 'earlier' ? rebuildRequest : undefined);
    const ctx = { ...routed, ...(kind === 'chip' ? { typed_approval_of: 'another-card' } : {}) };
    if (kind === 'earlier') { expect(ctx.verified_user_messages.at(-1)).toBe(ctx.user_turn_text); expect(ctx.verified_user_messages).toContain(rebuildRequest); }
    if (kind === 'assistant') expect(ctx.user_turn_text).toBe('');
    const out = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing,
      ...(kind === 'missing' ? {} : { explicit_rebuild_request: rebuildRequest }) }), ctx, w.caps());
    expect(out).toMatchObject({ ok: false, mutated: false });
    expect(w.calls).toHaveLength(0); expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });
  it.each([
    ["Don't create a new model.", 'create a new model.'],
    ['Olumi suggested: create a new model.', 'create a new model.'],
    ['Alice said: create a new model.', 'create a new model.'],
    ['Do not create a new model; retain this one.', 'Create a new model'],
  ])('a request fragment cannot strip the current negation or speaker: %s', async (message, excerpt) => {
    const w = await bakeryWorld();
    const ctx = { ...w.ctx, user_turn_text: message, user_text: message, verified_user_messages: [message] };
    const out = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: excerpt }), ctx, w.caps());
    expect(out).toMatchObject({ ok: false, mutated: false, refusal: 'current_request_required' });
    expect(w.calls).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });

  it.each(['options', 'goal'])('withholds a replacement that loses saved %s', async lost => {
    const bad = structuredClone(bakery.draft);
    if (lost === 'options') bad.options.pop(); else bad.goal.metric = 'Other governing outcome';
    const w = await bakeryWorld({ provider: async () => ({ text: JSON.stringify(bad), status: 'completed' }) }, g => {
      if (lost === 'options') g.nodes.find((n: Rec) => n.kind === 'option').label = 'A renamed saved option';
    });
    const out = await w.offer();
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false, mutated: false, refusal: 'replacement_work_not_held' });
    expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });
  it('an omitted option is carried through the complete card, cold own press and exact readback', async () => {
    const draft = structuredClone(bakery.draft); draft.options.pop();
    const w = await bakeryWorld({ provider: async () => ({ text: JSON.stringify(draft), status: 'completed' }) });
    const out = await w.offer(); expect(out, JSON.stringify(out)).toMatchObject({ ok: true, mutated: false });
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    const pid = String(out.proposal_id), held = w.proposals.get(pid)!, candidate = (held.operations[0]!.value as Rec).candidate;
    expect(candidate.nodes.filter((n: Rec) => n.kind === 'option')).toEqual(w.original.nodes.filter((n: Rec) => n.kind === 'option'));
    const cold = restoreCard(held, out, w.ctx);
    expect(await w.caps(cold).authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(candidate, w.graph())).toBe(true);
    expect(w.graph().nodes.filter((n: Rec) => n.kind === 'option')).toEqual(w.original.nodes.filter((n: Rec) => n.kind === 'option'));
  });
  it.each(['omitted', 'relabelled'])('B1: a %s saved factor preserves readiness through complete carry or safe refusal', async change => {
    const draft = structuredClone(bakery.draft) as Rec;
    if (change === 'omitted') {
      draft.factors = draft.factors.filter((f: Rec) => f.label !== 'Loyalty card running');
      draft.links = draft.links.filter((l: Rec) => l.from !== 'Loyalty card running');
      draft.options = draft.options.map((o: Rec) => o.label === 'Loyalty card' ? { ...o, interventions: [] } : o);
    }
    const proposed = change === 'relabelled'
      ? JSON.parse(JSON.stringify(draft).split('Loyalty card running').join('Loyalty card active')) : draft;
    const w = await bakeryWorld({ provider: async () => ({ text: JSON.stringify(proposed), status: 'completed' }) });
    const savedLink = w.original.edges.find((e: Rec) => e.from === 'loyalty_card_running' && e.to === 'weekly_loaves_sold');
    expect(savedLink).toBeDefined(); expect(savedLink.provenance).toMatchObject({ source: 'cee_hypothesis' });
    expect(assessCanonicalAnalysisReadiness(w.original).safeToAnalyse).toBe(true);
    const offered = await w.offer();
    if (change === 'relabelled') {
      expect(offered, JSON.stringify(offered)).toMatchObject({ ok: false, mutated: false, refusal: 'replacement_work_not_held' });
      expect(offered.follow_up).toContain('unidentified different quantity');
      expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0);
      expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
      expect(assessCanonicalAnalysisReadiness(w.graph()).safeToAnalyse).toBe(true);
      return;
    }
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!, candidate = (held.operations[0]!.value as Rec).candidate;
    const cold = restoreCard(held, offered, w.ctx), caps = w.caps(cold);
    expect(await caps.authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    const press = { ...w.ctx, turn_id: randomUUID(), user_turn_text: '', typed_approval_of: pid };
    expect(await caps.authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1);
    expect(assessCanonicalAnalysisReadiness(w.graph()).safeToAnalyse).toBe(true);
    expect(validateGraphStructure(GraphV3.parse(w.graph()), { leaveOutInertRisks: true }).violations.filter(v => v.code === 'NO_PATH_TO_GOAL')).toEqual([]);
    expect(candidate.edges.find((e: Rec) => e.from === savedLink.from && e.to === savedLink.to)).toEqual(savedLink);
    const saved = w.graph().edges.find((e: Rec) => e.from === savedLink.from && e.to === savedLink.to);
    expect(saved).toMatchObject(savedLink); expect(saved.provenance).toEqual(savedLink.provenance);
    expect(approvedGraphHeld(candidate, w.graph())).toBe(true);
    expect(offered.public_label).toContain('the saved relationship “Loyalty card running” → “weekly loaves sold” (Olumi’s estimate; adoption not recorded)');
    expect(offered.public_label).toContain('Construction report (before saved work was restored):');
    expect(await caps.authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });
  it.each(['unchanged', 'relabelled', 'additional'])('B2: an intermediate quantity is %s without silently duplicating its causal path', async change => {
    const seedDraft = structuredClone(bakery.draft) as Rec;
    seedDraft.factors.push({ label: 'Shop footfall', role: 'observable', baseline_known: false, baseline_value: null,
      unit: null, provenance: 'ai_proposed', plausible_max: 100 });
    seedDraft.links = seedDraft.links.filter((l: Rec) => l.from !== 'Loyalty card running');
    const link = { direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null,
      effect_provenance: null, definitional: null, basis: null, source_quote: null };
    seedDraft.links.push({ ...link, from: 'Loyalty card running', to: 'Shop footfall' },
      { ...link, from: 'Shop footfall', to: 'weekly loaves sold' });
    const seed = await runPreparingDraftReplacement('b2-seed', () => buildModelFromBrief('b2-seed', bakery.brief,
      async () => { throw new Error('Preparation must not dispatch'); },
      (async () => ({ text: JSON.stringify(seedDraft), status: 'completed' })) as never));
    expect(seed.ok).toBe(true);
    const proposed = change === 'relabelled'
      ? JSON.parse(JSON.stringify(seedDraft).split('Shop footfall').join('Customer footfall')) : structuredClone(seedDraft);
    if (change === 'additional') {
      proposed.factors.push({ label: 'Repeat purchase frequency', role: 'observable', baseline_known: false, baseline_value: null,
        unit: null, provenance: 'ai_proposed', plausible_max: 100 });
      proposed.links.push({ ...link, from: 'Loyalty card running', to: 'Repeat purchase frequency' },
        { ...link, from: 'Repeat purchase frequency', to: 'weekly loaves sold' });
    }
    const w = await world({ graph: seed.prepared_graph as Rec, brief: bakery.brief, message: rebuildRequest },
      { provider: async () => ({ text: JSON.stringify(proposed), status: 'completed' }) });
    const saved = w.original.nodes.find((n: Rec) => n.label === 'Shop footfall');
    expect(saved).toBeDefined();
    expect(w.original.nodes.filter((n: Rec) => n.kind === 'option').every((n: Rec) => !n.interventions?.[saved.id])).toBe(true);
    expect(assessCanonicalAnalysisReadiness(w.original).safeToAnalyse).toBe(true);
    const offered = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: rebuildRequest }), w.ctx, w.caps());
    if (change === 'relabelled') {
      expect(offered).toMatchObject({ ok: false, mutated: false, refusal: 'replacement_work_not_held' });
      expect(offered.follow_up).toContain('Shop footfall'); expect(offered.follow_up).toContain('Customer footfall');
      expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0);
      expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
      return;
    }
    expect(offered).toMatchObject({ ok: true, mutated: false });
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!, candidate = (held.operations[0]!.value as Rec).candidate;
    const cold = restoreCard(held, offered, w.ctx), caps = w.caps(cold);
    expect(await caps.authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
    const press = { ...w.ctx, user_turn_text: '', typed_approval_of: pid };
    expect(await caps.authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.sent).toHaveLength(1); expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(candidate, w.graph())).toBe(true);
    expect(w.graph().nodes.filter((n: Rec) => n.label === 'Shop footfall')).toHaveLength(1);
    expect(w.graph().nodes.some((n: Rec) => n.label === 'Customer footfall')).toBe(false);
    expect(w.graph().nodes.some((n: Rec) => n.label === 'Repeat purchase frequency')).toBe(change === 'additional');
    const incident = (graph: Rec) => graph.edges.filter((e: Rec) => e.from === saved.id || e.to === saved.id);
    expect(incident(w.graph())).toEqual(incident(w.original));
    expect(assessCanonicalAnalysisReadiness(w.graph()).safeToAnalyse).toBe(true);
    expect(await caps.authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });
  it.each(['factor', 'outcome', 'risk'].flatMap(savedKind =>
    ['factor', 'outcome', 'risk'].map(proposedKind => ({ savedKind, proposedKind }))))(
    'B2 quantity family: $savedKind → $proposedKind relabel beside the same saved neighbour refuses without a write', async ({ savedKind, proposedKind }) => {
      const draftWith = (kind: string, label: string): Rec => {
        const draft = structuredClone(bakery.draft) as Rec;
        const quantity = { label, provenance: 'ai_proposed', unit: null, plausible_max: 100 };
        if (kind === 'factor') draft.factors.push({ ...quantity, role: 'observable', baseline_known: false, baseline_value: null });
        else if (kind === 'outcome') draft.outcomes.push(quantity);
        else draft.risks.push({ ...quantity, already_true_evidence: null });
        draft.links = draft.links.filter((l: Rec) => l.from !== 'Loyalty card running');
        const link = { direction: 'positive', provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null,
          effect_provenance: null, definitional: null, basis: null, source_quote: null };
        draft.links.push({ ...link, from: 'Loyalty card running', to: label },
          { ...link, from: label, to: 'weekly loaves sold' });
        return draft;
      };
      const seed = await runPreparingDraftReplacement('b2-family-seed', () => buildModelFromBrief('b2-family-seed', bakery.brief,
        async () => { throw new Error('Preparation must not dispatch'); },
        (async () => ({ text: JSON.stringify(draftWith(savedKind, 'Shop footfall')), status: 'completed' })) as never));
      expect(seed.ok, JSON.stringify(seed)).toBe(true);
      const proposed = draftWith(proposedKind, 'Customer footfall');
      const w = await world({ graph: seed.prepared_graph as Rec, brief: bakery.brief, message: rebuildRequest },
        { provider: async () => ({ text: JSON.stringify(proposed), status: 'completed' }) });
      const saved = w.original.nodes.find((n: Rec) => n.label === 'Shop footfall');
      expect(saved).toMatchObject({ kind: savedKind });
      expect(w.original.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: 'loyalty_card_running', to: saved.id }),
        expect.objectContaining({ from: saved.id, to: 'weekly_loaves_sold' }),
      ]));
      const offered = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: rebuildRequest }), w.ctx, w.caps());
      expect(offered, JSON.stringify(offered)).toMatchObject({ ok: false, mutated: false, refusal: 'replacement_work_not_held' });
      expect(offered.follow_up).toContain('Shop footfall'); expect(offered.follow_up).toContain('Customer footfall');
      expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0);
      expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    });
  it('B3: a saved brief-span decision question cannot become two decisions through a fallback relabel', async () => {
    const seedDraft = structuredClone(bakery.draft) as Rec;
    seedDraft.decision_question = 'We need to sell at least 520 loaves a week by the end of June';
    const proposed = structuredClone(bakery.draft) as Rec; proposed.decision_question = null;
    const seed = await runPreparingDraftReplacement('b3-decision-seed', () => buildModelFromBrief('b3-decision-seed', bakery.brief,
      async () => { throw new Error('Preparation must not dispatch'); },
      (async () => ({ text: JSON.stringify(seedDraft), status: 'completed' })) as never));
    expect(seed.ok).toBe(true);
    const draft = await runPreparingDraftReplacement('b3-decision-draft', () => buildModelFromBrief('b3-decision-draft', bakery.brief,
      async () => { throw new Error('Preparation must not dispatch'); },
      (async () => ({ text: JSON.stringify(proposed), status: 'completed' })) as never));
    expect(draft.ok).toBe(true);
    const decisions = (g: Rec) => g.nodes.filter((n: Rec) => n.kind === 'decision');
    expect(decisions(seed.prepared_graph as Rec)).toHaveLength(1); expect(decisions(draft.prepared_graph as Rec)).toHaveLength(1);
    const savedDecision = decisions(seed.prepared_graph as Rec)[0], draftDecision = decisions(draft.prepared_graph as Rec)[0];
    expect(savedDecision.label).not.toBe(draftDecision.label);
    const w = await world({ graph: seed.prepared_graph as Rec, brief: bakery.brief, message: rebuildRequest },
      { provider: async () => ({ text: JSON.stringify(proposed), status: 'completed' }) });
    const offered = await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: rebuildRequest }), w.ctx, w.caps());
    expect(offered).toMatchObject({ ok: false, mutated: false, refusal: 'replacement_work_not_held' });
    expect(offered.follow_up).toContain(savedDecision.label); expect(offered.follow_up).toContain(draftDecision.label);
    expect(w.proposals.outstanding(w.ctx.scenario_id, null)).toHaveLength(0);
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(w.original);
    expect(decisions(w.graph())).toEqual([savedDecision]);
  });
  it('N6: a corrected source has current retained words and labelled history on the complete card, cold save and read', async () => {
    const old = 'For weekly loaves sold, we count loaves sold, including wasted loaves.';
    const quote = 'For weekly loaves sold, withdraw “including wasted loaves” and keep “loaves sold”.';
    const subject = { kind: 'goal' as const, id: 'weekly_loaves_sold', field: 'measure' as const };
    const w = await bakeryWorld({}, graph => {
      const statement = userStatementOf({ speaker: 'user', quote: old, source: old, reading: 'olumi', form: 'describes',
        subject: { quantity: subjectKey(subject), node_id: subject.id } });
      expect(statement).toBeDefined();
      const held = withUserStatement(graph as Rec & { nodes: unknown[] }, userStatementRecord(subject, [statement!],
        '2026-10-17T12:00:00Z', { recorded_by: 'construction' }), subject)!;
      const corrected = prepareStatementCorrection(held, { quote, edits: [{ subject,
        retirement: { quote: 'including wasted loaves', scope: 'part', disposition: 'retracted' }, retained: ['loaves sold'],
        reading_words: 'The wasted-loaves phrase is withdrawn; retain the sold-loaves measure.' }] }, { now: quote }, '2026-10-17T13:00:00Z');
      if ('refused' in corrected) throw new Error(corrected.refused);
      Object.assign(graph, corrected.candidate);
    });
    const beforeRecord = w.original.nodes.find((n: Rec) => n.id === subject.id).user_statements.find((r: Rec) => r.field === 'measure');
    const offered = await w.offer(); expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain('measure, current retained account: “loaves sold” (recorded user source)');
    expect(offered.public_label).toContain('Complete source record (correction request and earlier history; only the retained parts above remain current):');
    expect(offered.public_label).toContain(old);
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!, candidate = (held.operations[0]!.value as Rec).candidate;
    const cold = restoreCard(held, offered, w.ctx), caps = w.caps(cold);
    expect(await caps.authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
    const press = { ...w.ctx, turn_id: randomUUID(), user_turn_text: '', typed_approval_of: pid };
    expect(await caps.authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(candidate, w.graph())).toBe(true);
    const read = await w.caps(new ProposalStore()).getCanonicalState(w.ctx) as Rec;
    const material = read.recorded_reasoning.find((n: Rec) => n.id === subject.id);
    expect(material.current_retained.find((r: Rec) => r.field === 'measure')).toEqual({ field: 'measure',
      spans: [{ text: 'loaves sold', origin: 'held_user_statement' }], complete: true });
    expect(material.user_statements.find((r: Rec) => r.field === 'measure')).toEqual(beforeRecord);
    expect(await caps.authoriseChange(press, { proposal_id: pid })).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });
  it.each([{ complete: false }, { first_user_message: 'A different original statement.' }])('refuses unreadable or mismatched source history before the constructor: %j', async ledger => {
    const w = await bakeryWorld({ ledger });
    // DL04:00 ACK: the former 'partial' row lives at the actual durable source gate, not a sticky authorship flag.
    const { ctx } = routeRebuildContext(w, rebuildRequest);
    expect(await dispatchTool('build_model_from_brief', JSON.stringify({ brief: framing, explicit_rebuild_request: rebuildRequest }), ctx, w.caps()))
      .toMatchObject({ ok: false, mutated: false, refusal: 'history_unreadable' });
    expect(w.calls).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });
  it('a valid card has no authority without its own press; a race writes nothing', async () => {
    const w = await bakeryWorld({ race: true }); const out = await w.offer();
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    const pid = String(out.proposal_id);
    expect(await w.caps().authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(w.writes).toHaveLength(0);
  });
  it('rechecks a changed conversation and an incomplete candidate before registration', async () => {
    const ledger: Rec = { complete: true }; const w = await bakeryWorld({ ledger });
    const out = await w.offer(); expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    const pid = String(out.proposal_id);
    ledger.user_message_turn_ids = ['first', 'later']; ledger.later_user_messages = [{ turn_id: 'later', text: 'Keep the disagreement.' }];
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0);
    delete ledger.user_message_turn_ids; delete ledger.later_user_messages;
    const held = w.proposals.get(pid)!; const value = structuredClone(held.operations[0]!.value) as Rec;
    value.candidate.nodes = value.candidate.nodes.filter((n: Rec) => n.kind !== 'option');
    const forged = createProposal({ ...held, operations: [{ ...held.operations[0]!, value }] }); w.proposals.put(forged);
    expect(await w.caps().authoriseChange({ ...w.ctx, typed_approval_of: forged.proposal_id }, { proposal_id: forged.proposal_id })).toMatchObject({ ok: false, mutated: false, refusal: 'incomplete_replacement' });
    expect(w.sent).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });
});


const founder78ca = fixture('founder-78ca-current-request.json');
describe('78ca founder: complete current source through the existing correction card', () => {
  it('offers £250k with the later aim on another outcome, flags the unresolved binding and saves exactly the displayed candidate', async () => {
    const source = founder78ca.typed_turns['10'];
    const quote = 'I urgently need to secure funding: both fast-paced angel and, eventually, a larger fund of at least 1.3 million.';
    const w = await world({ graph: founder78ca.graph, brief: founder78ca.brief_text, message: source });
    w.ctx.verified_user_messages = [founder78ca.brief_text, source];
    // These test arguments are explicit evidence, not a reconstruction of the uncaptured live arguments.
    const args = { constraint_type: 'at_least', value: 250000, unit: '£', measures: 'Funding secured', rationale: source, later_ambition_quote: quote };
    const offered = await dispatchTool('propose_goal_target', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(offered.public_label).toContain(source); expect(offered.public_label).toContain(quote);
    expect(offered.public_label).toContain('Your source stays yours');
    expect(offered.public_label).toContain('later role and its binding remain Olumi’s reading');
    expect(offered.public_label).not.toContain('Check its source');
    expect(offered.public_label).toContain('Other saved aims and bounds stay on their existing nodes');
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!, candidate = (held.operations[0]!.value as Rec).candidate;
    expect(w.writes).toHaveLength(0);
    const other = (g: Rec) => g.nodes.filter((n: Rec) => n.id !== 'funding_secured');
    expect(other(candidate)).toEqual(other(w.original));
    expect(candidate.goal_constraints.find((r: Rec) => r.node_id === 'larger_fund_capital_secured')).toEqual(w.original.goal_constraints[0]);
    const originalSaid = founder78ca.graph.nodes.find((n: Rec) => n.id === 'funding_secured').user_statements.flatMap((r: Rec) => r.statements);
    const proposedGoal = candidate.nodes.find((n: Rec) => n.id === 'funding_secured');
    expect(proposedGoal.description).toContain('Your source stays yours');
    expect(proposedGoal.description).not.toContain('or verified its source');
    expect(proposedGoal.user_statements.flatMap((r: Rec) => r.statements)).toEqual(expect.arrayContaining(originalSaid));
    expect(await w.caps().authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    const cold = restoreCard(held, offered, w.ctx);
    const saved = await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid });
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(candidate, w.graph())).toBe(true);
    expect(w.graph().nodes.find((n: Rec) => n.id === 'funding_secured').goal_threshold_raw).toBe(250000);
    expect(other(w.graph())).toEqual(other(w.original));
    const read = await w.caps(new ProposalStore()).getCanonicalState(w.ctx) as Rec;
    const savedGoal = w.graph().nodes.find((n: Rec) => n.id === 'funding_secured');
    expect(savedGoal.user_statements.flatMap((r: Rec) => r.statements)).toEqual(expect.arrayContaining(originalSaid));
    expect(savedGoal.user_statements.flatMap((r: Rec) => r.statements)).toEqual(expect.arrayContaining([expect.objectContaining({ speaker: 'user', quote: source, source })]));
    expect(read.entities.find((n: Rec) => n.id === 'funding_secured').full_label).toContain('Your source stays yours');
    expect(savedGoal.user_statements.find((r: Rec) => r.field === 'target').statements.map((s: Rec) => s.quote)).toEqual(expect.arrayContaining([quote, source]));
    expect(read.recorded_reasoning.find((n: Rec) => n.id === savedGoal.id).user_statements).toEqual(savedGoal.user_statements);
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, already_applied: true });
    expect(w.writes).toHaveLength(1);
  });

  it.each([
    ['14', 'create a new model'], ['15', 'Generate a new model based on this brief.'],
  ])('the complete captured typed turn %s authorises preparation while another card waits', async (turn, excerpt) => {
    const w = await bakeryWorld();
    const message = founder78ca.typed_turns[turn];
    w.ctx.user_turn_text = message; w.ctx.user_text = message; w.ctx.verified_user_messages = [message];
    const pending = createProposal({ scenario_id: w.ctx.scenario_id, user_id: null,
      base_graph_identity_hash: computeAnalysisAffectingGraphHash(w.original as never)!,
      operations: [{ op: 'set_factor_value', path: 'unrelated', value: { value: 60, authored_by: 'model_proposed' } }],
      provenance: { authored_by: 'model_proposed', basis: 'Olumi’s unrelated starting figure' },
      validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Use these starting figures' });
    w.proposals.put(pending);
    // The source turn is unchanged. Quote its whole statement; bare verb fragments can omit negation or speaker.
    const args = { brief: framing, explicit_rebuild_request: message.replace(/'/g, '’').toLocaleLowerCase('en-GB') };
    expect(message.toLowerCase()).toContain(excerpt.toLowerCase());
    const offered = await dispatchTool('build_model_from_brief', JSON.stringify(args), w.ctx, w.caps());
    expect(offered, JSON.stringify(offered)).toMatchObject({ ok: true, mutated: false });
    expect(w.proposals.get(pending.proposal_id)).toEqual(pending); expect(w.writes).toHaveLength(0);
    const pid = String(offered.proposal_id), held = w.proposals.get(pid)!, value = held.operations[0]!.value as Rec;
    expect(value.explicit_rebuild_request).toBe(message); expect(held.provenance.basis).toBe(message);
    expect(offered.public_label).toContain(message);
    expect(JSON.stringify(w.calls)).toContain(message);
    expect(value.candidate.nodes.filter((n: Rec) => n.kind === 'option')).toEqual(w.original.nodes.filter((n: Rec) => n.kind === 'option'));
    expect(value.candidate.nodes.find((n: Rec) => n.kind === 'goal')).toEqual(w.original.nodes.find((n: Rec) => n.kind === 'goal'));
    const cold = restoreCard(held, offered, w.ctx);
    expect(await w.caps(cold).authoriseChange(w.ctx, { proposal_id: pid })).toMatchObject({ ok: false, mutated: false });
    expect(await w.caps(cold).authoriseChange({ ...w.ctx, typed_approval_of: pid }, { proposal_id: pid })).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1); expect(approvedGraphHeld(value.candidate, w.graph())).toBe(true);
  });
});
