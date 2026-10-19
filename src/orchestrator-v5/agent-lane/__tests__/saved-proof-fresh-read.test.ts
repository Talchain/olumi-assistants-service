/**
 * ⛔ "SAVED" IS EARNED ONLY FROM THE STORED MODEL NOW (Codex delta check of #3456 @1c01e0fe, its probes adopted as rows:
 * `reviews/CODEX-3456-1c01e0fe-probes/r1/correction-probes.test.ts`). A re-press of an applied prepared correction says
 * "saved" (`saved_state_confirmed`) only on its own registration in the ledger PLUS its whole postimage in a FRESH read of
 * the model. The turn's kept read (`turnReadCache`) is not moved by another writer's Undo, so it is never that proof.
 * Real register and read routes over a JSON-rehydrated store double; no provider, database or remote service.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { injectAsCeeWriter } from '../../../../tests/utils/inject-as-cee-writer.js';

vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as object | null } }));
vi.mock('../../session/index.js', async original => ({ ...await original<Record<string, unknown>>(), getSessionStore: () => storeRef.value }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import graphRoute from '../../../routes/assist.v1.scenario-graph.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { dispatchTool, type AgentToolContext } from '../runtime/agent-tools.js';
import { ProposalStore, type StructuredProposal } from '../proposal.js';
import { proposalPendingAction, rehydrateProposals } from '../durable-proposal.js';
import { parsePendingAction } from '../../session/pending-action.js';
import { approvalChipsFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { userStatementRecord } from '../../statement-door/statements.js';
import { turnReadCache } from '../turn-read-cache.js';

type Rec = Record<string, any>;
const close: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (close.length) await close.pop()!(); });

/** Real register/read routes over a JSON-rehydrated store double; no provider, database or remote service. */
async function correctionWorld(original: Rec, message: string, options: {
  brief?: string; provider?: (...args: any[]) => Promise<any>; readTurnHistory?: () => readonly unknown[];
} = {}) {
  const scenario = randomUUID();
  let graph: Rec = structuredClone(original), revision = 2;
  const writes: Rec[] = [], registers: Rec[] = [], responses: Rec[] = [];
  const installStore = () => { storeRef.value = {
    append: async (write: Rec) => { graph = structuredClone(write.graph); writes.push(structuredClone(write)); revision += 1; return { id: `turn-${revision}` }; },
    loadGraph: async () => structuredClone(graph),
    loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: options.brief ?? null, revision }),
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true, readCommittedTurn: async () => null, readMostRecentPendingActions: async () => [], readRecent: async () => [],
  }; };
  installStore();
  const appOf = async () => { const app = Fastify(); await registerRoute(app); await graphRoute(app); await app.ready(); return app; };
  let app = await appOf(); close.push(() => app.close());
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(graph),
      brief_text: options.brief,
      graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: computeGraphIdentityHash(graph as never) } };
    if (!path.endsWith('/graph/register')) throw new Error(`No provider or other writer is allowed: ${path}`);
    registers.push(structuredClone(body as Rec));
    const response = await injectAsCeeWriter(app, { method: 'POST', url: path, payload: body as Rec });
    responses.push({ status: response.statusCode, body: response.json() });
    return { status: response.statusCode, json: response.json() };
  };
  const proposals = new ProposalStore();
  const caps = (store = proposals) => createAgentCapabilities(dispatch, store, options.provider, 'full', undefined, { turnAuthority: true,
    readTurnHistory: options.readTurnHistory, readStatedObjections: async () => [],
    readCommittedTurnLedger: async () => ({ first_user_message: options.brief ?? message, messages: [], complete: true, user_message_turn_ids: ['first'],
      write_turn_ids: writes.map(w => w.turn_id) }) as never });
  const ctx: AgentToolContext = { scenario_id: scenario, authenticated_user_id: null, request_id: 'native-correction', turn_id: randomUUID(),
    user_turn_text: message, user_text: message, verified_user_messages: [message], user_text_complete: true };
  return { dispatch, ctx, proposals, caps, graph: () => graph, writes, registers, responses,
    change: (fn: (g: Rec) => void) => fn(graph),
    offer: (tool: string, args: unknown) => dispatchTool(tool, JSON.stringify(args), ctx, caps()),
    press: (pid: string, store = proposals, own = true) => caps(store).authoriseChange({ ...ctx, turn_id: randomUUID(), user_turn_text: '',
      ...(own ? { typed_approval_of: pid } : {}) }, { proposal_id: pid }),
    chips: (tool: string, result: ToolResult) => approvalChipsFor([{ name: tool, ok: true, mutated: false,
      proposal_id: typeof result.proposal_id === 'string' ? result.proposal_id : undefined }],
      pid => ({ proposal: proposals.get(pid)!, result, args: {} })),
    restoreCard: (proposal: StructuredProposal, result: ToolResult, tool = 'propose_statement') => {
      const chip = approvalChipsFor([{ name: tool, ok: true, mutated: false, proposal_id: proposal.proposal_id }],
        () => ({ proposal, result, args: {} }))[0]!;
      const pending = proposalPendingAction(proposal, chip, { scenario_id: scenario, emitted_at_iso: new Date().toISOString() });
      const parsed = parsePendingAction(JSON.parse(JSON.stringify(pending)));
      const store = new ProposalStore();
      rehydrateProposals([parsed!], store, { scenario_id: scenario, user_id: null });
      return store;
    },
    cold: async () => {
      await app.close();
      graph = JSON.parse(JSON.stringify(graph)); installStore(); app = await appOf();
      // A new capabilities/store has no earlier proposal, cached source or readback.
      const fresh = caps(new ProposalStore());
      const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${scenario}/graph`, payload: {} });
      return { status: response.statusCode, body: response.json() as Rec, fresh };
    },
  };
}


const cases = [
  { name: 'warehousing', goal: 'Average dispatch delay', value: 6, unit: 'days', comparator: '<=',
    aim: 'Understand delivery priorities', message: 'Change Average dispatch delay to understanding competing delivery priorities before testing process changes.' },
  { name: 'procurement', goal: 'Supplier resilience', value: 80, unit: 'score', comparator: '>=',
    aim: 'Understand disputed partner assumptions', message: 'Change Supplier resilience to understanding which assumptions our partners dispute before setting a threshold.' },
];
function fixture(row: typeof cases[number]) {
  const oldSource = `${row.goal} must be ${row.comparator} ${row.value} ${row.unit}.`;
  const source = userStatementRecord({ kind: 'goal', id: 'old_goal', field: 'target' }, [{ quote: oldSource, source: oldSource,
    speaker: 'user', reading: 'olumi', subject: { quantity: row.goal, node_id: 'old_goal' }, form: row.comparator === '<=' ? 'upper_bound' : 'lower_bound',
    ...(row.comparator === '<=' ? { high: row.value } : { low: row.value }), unit: row.unit }], '2026-08-01T00:00:00Z', { recorded_by: 'construction' });
  const graph: Rec = { goal_node_id: 'old_goal', nodes: [
    { id: 'old_goal', kind: 'goal', label: row.goal, provenance: 'from_brief', user_statements: [source],
      goal_direction: row.comparator, goal_threshold_raw: row.value, goal_threshold_unit: row.unit, goal_threshold_frame: 'level',
      goal_horizon: { deadline: '2027-01-01' }, goal_deadline_as_stated: 'before the annual review' },
    { id: 'factor', kind: 'factor', label: 'Process coverage', observed_state: { value: 0.5, raw_value: 50, unit: '%', source: 'cee_inference' } },
    { id: 'option_a', kind: 'option', label: 'Explore workflow changes', provenance: 'from_brief', interventions: { factor: { value: 0.8, raw_value: 80, unit: '%' } } },
    { id: 'option_b', kind: 'option', label: 'Keep current workflow', provenance: 'from_brief', interventions: { factor: { value: 0.5, raw_value: 50, unit: '%' } } },
    { id: 'dissent', kind: 'risk', label: 'Team reservation', provenance: 'unverified_brief', already_true_quote: 'The evening team disputes the mechanism.' },
  ], edges: [ { from: 'factor', to: 'old_goal', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.7, effect_direction: 'positive' },
    ...['option_a', 'option_b'].map(from => ({ from, to: 'factor', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' })) ],
    goal_constraints: [{ constraint_id: 'old_target', role: 'goal_target', node_id: 'old_goal', operator: row.comparator,
      value: row.value, unit: row.unit, value_frame: 'level', provenance: 'explicit', source_quote: oldSource }] };
  return { graph, request: { goal_id: 'old_goal', quote: row.message, label: row.aim } };
}

describe.each(cases)('R1 prepared correction $name',row=>{
 it('registration plus whole postimage confirms; Undo with ledger surviving never confirms',async()=>{
  const f=fixture(row),w=await correctionWorld(f.graph,row.message),original=structuredClone(w.graph());
  const offered=await w.offer('propose_goal_target',{reframe:f.request}),pid=String(offered.proposal_id);
  const first=await w.press(pid);expect(first).toMatchObject({ok:true,applied:true,mutated:true});
  const replay=await w.press(pid);expect(replay).toMatchObject({mutated:false,saved_state_confirmed:true});
  expect(replay.receipts).toEqual(first.receipts);expect(w.writes).toHaveLength(1);
  const fresh=w.restoreCard(w.proposals.get(pid)!,offered,'propose_goal_target');
  const recovered=await w.press(pid,fresh);expect(recovered).toMatchObject({mutated:false,saved_state_confirmed:true});
  w.change(g=>{for(const k of Object.keys(g))delete g[k];Object.assign(g,structuredClone(original));});
  const undone=await w.press(pid);
  expect(undone).toMatchObject({ok:false,mutated:false,refusal:'not_confirmed'});expect(undone.saved_state_confirmed).not.toBe(true);
  expect(w.graph()).toEqual(original);expect(w.writes).toHaveLength(1);expect(w.registers).toHaveLength(1);
 });
 it('an identical postimage without this registration ledger is not proof',async()=>{
  const f=fixture(row),w=await correctionWorld(f.graph,row.message);
  const offered=await w.offer('propose_goal_target',{reframe:f.request}),pid=String(offered.proposal_id);
  await w.press(pid);w.writes.splice(0); const out=await w.press(pid);
  expect(out).toMatchObject({ok:false,mutated:false,refusal:'not_confirmed'});expect(out.saved_state_confirmed).not.toBe(true);expect(w.registers).toHaveLength(1);
 });
});


describe.each(cases)('R1 cached proof $name',row=>{
 it('RED: approval prefetch must not confirm a pre-Undo postimage after another writer restores original',async()=>{
  const f=fixture(row),w=await correctionWorld(f.graph,row.message),original=structuredClone(w.graph());
  const offered=await w.offer('propose_goal_target',{reframe:f.request}),pid=String(offered.proposal_id);
  expect(await w.press(pid)).toMatchObject({ok:true,mutated:true});
  const cache=turnReadCache(w.dispatch,`/assist/v1/scenarios/${w.ctx.scenario_id}/graph`);
  cache.prefetch();await cache.turnStartRead();
  // Exactly the real route's prefetch/capability wiring. An external Undo never advances this turn's write epoch.
  const caps=createAgentCapabilities(cache.dispatch,w.proposals,undefined,'full',undefined,{
    readCommittedTurnLedger:async()=>({first_user_message:row.message,messages:[],complete:true,user_message_turn_ids:[],write_turn_ids:w.writes.map(x=>x.turn_id)}) as never
  });
  w.change(g=>{for(const k of Object.keys(g))delete g[k];Object.assign(g,structuredClone(original));});
  const out=await caps.authoriseChange({...w.ctx,typed_approval_of:pid},{proposal_id:pid});
  expect(w.graph()).toEqual(original);expect(w.writes).toHaveLength(1);expect(w.registers).toHaveLength(1);
  // Reuse the production cache's existing fresh-read mechanism; this contrast is probe-only.
  const freshCaps=createAgentCapabilities((path,body)=>cache.dispatch(path,path.endsWith('/graph')?{...(body as Record<string,unknown>),fresh:true}:body),w.proposals,undefined,'full',undefined,{
    readCommittedTurnLedger:async()=>({first_user_message:row.message,messages:[],complete:true,user_message_turn_ids:[],write_turn_ids:w.writes.map(x=>x.turn_id)}) as never
  });
  const corrected=await freshCaps.authoriseChange({...w.ctx,typed_approval_of:pid},{proposal_id:pid});
  expect(corrected).toMatchObject({ok:false,mutated:false,refusal:'not_confirmed'});expect(corrected.saved_state_confirmed).not.toBe(true);
  expect(w.graph()).toEqual(original);expect(w.writes).toHaveLength(1);expect(w.registers).toHaveLength(1);
  expect(out.saved_state_confirmed).not.toBe(true);
 });
});
