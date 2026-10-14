/** S4 loss-threshold admission must never loosen a held, tighter ceiling.
 * The ruled rows use the real tools, proposal store and graph hash;
 * SessionStore transport alone is replaced. No card silently writes a limit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';

const port = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../../session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../session/index.js')>(), getSessionStore: () => port.store!,
}));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: vi.fn() }));
vi.mock('../../../utils/telemetry.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../utils/telemetry.js')>(),
  emit: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../../agent-lane/runtime/agent-tools.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../agent-lane/approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { commitLimitAddInProcess, commitLimitEditInProcess } from '../../system-events/dispatch.js';
import { runFencedInProcessWrite } from '../../../orchestrator/turn-fence-prehandler.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, any>;
type LimitTool = 'propose_new_limit' | 'propose_limit_change';
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHURN = 'monthly-churn-rate';
const LIMIT = 'held-monthly-churn-limit';
const LABEL = 'Monthly churn rate';
const PAUL = 'Our current churn is 4%, and price rises would at least increase it 1%; above 6% we lose money';
const TIGHTER_REPLY = "Your limit already keeps ‘Monthly churn rate’ under 4%, which is tighter than the 6% where you'd lose money, so I've left it as is.";
const EQUAL_REPLY = "Your limit already keeps ‘Monthly churn rate’ at or below 6%, the line where you'd lose money, so I've left it as is.";
const ctx = () => ({ scenario_id: SCENARIO, authenticated_user_id: null,
  request_id: 's4-tighter-held', user_text: PAUL, user_turn_text: PAUL });

function model(held?: { value: number; strict?: boolean }): Rec {
  return { version: '1', nodes: [
    { id: 'g', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 10000, cap: 20000, unit: '£/month' } },
    { id: 'd', kind: 'decision', label: 'Plan' },
    { id: CHURN, kind: 'factor', label: LABEL, category: 'controllable', quantity_frame: 'level',
      observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%', source: 'user_override' } },
    { id: 'a', kind: 'option', label: 'Hold at £49', interventions: {} },
    { id: 'b', kind: 'option', label: 'Raise to £59', interventions: {} },
    { id: 'c', kind: 'option', label: 'Lower to £39', interventions: {} },
    { id: 'pro-plan-price', kind: 'factor', label: 'Pro plan price', category: 'controllable', quantity_frame: 'level',
      observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£/month', source: 'user_override' } },
  ], edges: [], goal_constraints: held === undefined ? [] : [{ constraint_id: LIMIT, node_id: CHURN,
    operator: '<=', ...(held.strict ? { operator_as_stated: '<' } : {}), value: held.value,
    unit: '%', value_frame: 'level', provenance: 'explicit', label: LABEL,
    source_quote: `Keep monthly churn ${held.strict ? 'under' : 'at or below'} ${held.value}%` }] };
}

function world(initial: Rec) {
  let bytes = JSON.stringify(assignEntityRefs(projectGraphForPersistence(initial), { nodes: [], edges: [] }).graph);
  const graph = (): Rec => JSON.parse(bytes);
  const hash = () => computeAnalysisAffectingGraphHash(graph() as never);
  const writes: SessionTurnWrite[] = [];
  const proposals = new ProposalStore();
  port.store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    getScenarioOwner: async () => null,
    append: async write => {
      const saved = structuredClone(write); writes.push(saved);
      if (saved.graph !== undefined) bytes = JSON.stringify(saved.graph);
      return { id: `s4-tighter-held-row-${writes.length}` };
    },
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({ id: `s4-tighter-held-row-${i + 1}`, scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
  });
  const dispatch: InternalDispatch = async path => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    return { status: 200, json: { graph: graph(), graph_hash: hash() } };
  };
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitLimitAdd: input => runFencedInProcessWrite(input.scenario_id, input.turn_id,
      () => commitLimitAddInProcess(input, 's4-tighter-held'), () => ({ status: 'stale' as const }),
      () => ({ status: 'refused' as const, reason: 'turn_fence_refused' })),
    commitLimitEdit: input => runFencedInProcessWrite(input.scenario_id, input.turn_id,
      () => commitLimitEditInProcess(input, 's4-tighter-held'), () => ({ status: 'stale' as const }),
      () => ({ status: 'refused' as const, reason: 'turn_fence_refused' })),
  });
  const propose = (tool: LimitTool = 'propose_new_limit') => dispatchTool(tool, JSON.stringify(tool === 'propose_new_limit'
    ? { quantity_label: LABEL, value: 6, rationale: PAUL }
    : { limit_label: LABEL, operator: '<=', new_value: 6, unit: '%', rationale: PAUL }), ctx(), caps);
  const chips = (r: ToolResult, tool: LimitTool = 'propose_new_limit') => approvalChipsFor([{ name: tool,
    ok: r.ok, mutated: r.mutated, proposal_id: typeof r.proposal_id === 'string' ? r.proposal_id : undefined }],
  id => ({ proposal: proposals.get(id), result: r }));
  return { graph, hash, writes, proposals, propose, chips };
}

async function expectHeldLimitPreserved(initial: Rec, reply: string) {
  for (const tool of ['propose_new_limit', 'propose_limit_change'] as const) {
    const w = world(structuredClone(initial)); const before = w.graph(); const beforeHash = w.hash();
    expect(before.goal_constraints).toEqual([expect.objectContaining({ constraint_id: LIMIT, node_id: CHURN,
      operator: '<=', value: initial.goal_constraints[0].value, label: initial.goal_constraints[0].label,
      ...(initial.goal_constraints[0].operator_as_stated === '<' ? { operator_as_stated: '<' } : {}) })]);
    const r = await w.propose(tool);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'limit_already_tighter', reply,
      detail: `Say exactly this one line, once, with no chip: ${reply}` });
    expect(r).not.toHaveProperty('proposal_id'); expect(w.chips(r, tool)).toEqual([]);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(before); expect(w.hash()).toBe(beforeHash);
  }
}

afterEach(() => { port.store = undefined; });

describe('S4 loss threshold preserves an already tighter or equal held limit', () => {
  it("Paul's exact sentence keeps held <4% with no proposal, card or write through either tool door", async () => {
    await expectHeldLimitPreserved(model({ value: 4, strict: true }), TIGHTER_REPLY);
  });

  it('held ≤8% keeps the existing change card and binds the proposal to its node and constraint', async () => {
    const w = world(model({ value: 8 })); const before = w.graph(); const beforeHash = w.hash();
    const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false,
      public_label: 'Change the limit on "Monthly churn rate" from at most 8% to at most 6%' });
    expect(w.chips(r).map(c => c.label)).toEqual(['Change this limit', 'Change something first']);
    expect(w.chips(r)[0]?.detail).toBe(r.public_label);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(1);
    expect(w.proposals.get(r.proposal_id as string)?.operations).toEqual([{ op: 'set_limit', path: CHURN,
      value: expect.objectContaining({ constraint_id: LIMIT, node_id: CHURN, before: 8, operator: '<=', raw_value: 6,
        unit: '%', value_frame: 'level', source_quote: PAUL }) }]);
    expect(w.writes).toHaveLength(0); expect(w.graph()).toEqual(before); expect(w.hash()).toBe(beforeHash);
  });

  it('no held limit keeps the existing keep card and binds one add proposal to the churn node', async () => {
    const w = world(model()); const before = w.graph(); const beforeHash = w.hash();
    const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false, public_label: 'Keep monthly churn rate at most 6%?' });
    expect(w.chips(r).map(c => c.label)).toEqual(['Yes', 'Change']);
    expect(w.chips(r)[0]?.detail).toBe(r.public_label);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(1);
    expect(w.proposals.get(r.proposal_id as string)?.operations).toEqual([{ op: 'add_limit', path: CHURN,
      value: expect.objectContaining({ node_id: CHURN, operator: '<=', raw_value: 6, unit: '%',
        value_frame: 'level', source_quote: PAUL }) }]);
    expect(w.writes).toHaveLength(0); expect(w.graph().goal_constraints).toEqual([]);
    expect(w.graph()).toEqual(before); expect(w.hash()).toBe(beforeHash);
  });

  it('held ≤6% is already the line, with no proposal, card or write and its inclusive words', async () => {
    await expectHeldLimitPreserved(model({ value: 6 }), EQUAL_REPLY);
  });

  it.each([
    [4, false, 'at or below 4%'],
    [6, true, 'under 6%'],
  ] as const)('held %i%% (strict %s) preserves its stated operator through both tool doors', async (value, strict, words) => {
    const reply = `Your limit already keeps ‘Monthly churn rate’ ${words}, which is tighter than the 6% where you'd lose money, so I've left it as is.`;
    await expectHeldLimitPreserved(model({ value, strict }), reply);
  });

  it('the held row label supplies the reply when it differs from its node label', async () => {
    const g = model({ value: 4, strict: true });
    g.goal_constraints[0].label = 'Churn guardrail';
    expect(g.nodes.find((n: Rec) => n.id === CHURN)?.label).toBe(LABEL);
    const reply = "Your limit already keeps ‘Churn guardrail’ under 4%, which is tighter than the 6% where you'd lose money, so I've left it as is.";
    await expectHeldLimitPreserved(g, reply);
  });
});
