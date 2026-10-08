/** S-E S4, D-07 served words. Real proposer/card/approval/add_constraint/CAS
 * commit/read-back; serialised SessionStore and captured PLoT only. No services.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
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
import { AGENT_TOOLS, MUTATION_TOOLS, dispatchTool, type ToolResult } from '../../agent-lane/runtime/agent-tools.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { approvalChipsFor, typedApprovalOf } from '../../agent-lane/approval-chips.js';
import { readNewLimit, NO_LIMIT_QUANTITY } from '../../agent-lane/stated-limit.js';
import { FIELD_CLASS_BY_OP } from '../../agent-lane/proposal-object/record.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { commitLimitAddInProcess, commitLimitEditInProcess } from '../../system-events/dispatch.js';
import { TurnFenceRejectedError, currentTurnFenceSlot } from '../../session/turn-fence.js';
import { applyLimitAdd } from '../../system-events/limit-add.js';
import { runFencedInProcessWrite } from '../../../orchestrator/turn-fence-prehandler.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';

type Rec = Record<string, any>;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COST = 'total-cost';
const SERVED = 'we only have a budget for £200,000, with a £20,000 surplus that is held back for recruitment fees';
const ctx = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 's4', user_text: text, user_turn_text: text });
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
function model(): Rec {
  return { version: '1', nodes: [
    { id: 'g', kind: 'goal', label: 'Launch', observed_state: { value: 0.5, raw_value: 50, cap: 100, unit: '%' } },
    { id: 'd', kind: 'decision', label: 'Staffing' },
    { id: COST, kind: 'factor', label: 'Total cost', category: 'controllable', quantity_frame: 'level',
      observed_state: { value: 0.6, raw_value: 150000, cap: 250000, unit: '£', source: 'user_override' } },
    { id: 'a', kind: 'option', label: 'Hire a lead', interventions: { [COST]: { value: 0.4, raw_value: 100000, unit: '£', source: 'user_specified' } } },
    { id: 'b', kind: 'option', label: 'Hire developers', interventions: { [COST]: { value: 0.8, raw_value: 200000, unit: '£', source: 'user_specified' } } },
  ], edges: [edge('d', 'a'), edge('d', 'b'), edge('a', COST), edge('b', COST), edge(COST, 'g')], goal_constraints: [] };
}
function world(initial: Rec = model(), overrides: Partial<SessionStore> = {}) {
  let bytes = JSON.stringify(assignEntityRefs(projectGraphForPersistence(initial), { nodes: [], edges: [] }).graph);
  const graph = (): Rec => JSON.parse(bytes);
  const writes: SessionTurnWrite[] = [];
  const proposals = new ProposalStore();
  port.store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    getScenarioOwner: async () => null,
    append: async write => {
      const saved = structuredClone(write);
      writes.push(saved);
      if (saved.graph !== undefined) bytes = JSON.stringify(saved.graph);
      return { id: `s4-row-${writes.length}` };
    },
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({ id: `s4-row-${i + 1}`, scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => writes.flatMap((w, i) => ids.includes(`s4-row-${i + 1}`)
      ? w.handler_facts.map(fact => ({ turn_id: `s4-row-${i + 1}`, fact_created_at: '2026-10-07T16:30:00Z', fact })) : []),
    ...overrides,
  });
  const dispatch: InternalDispatch = async path => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const g = graph(); return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
  };
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitLimitAdd: input => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitLimitAddInProcess(input, 's4'),
      () => ({ status: 'stale' as const }), () => ({ status: 'refused' as const, reason: 'turn_fence_refused' })),
    commitLimitEdit: input => runFencedInProcessWrite(input.scenario_id, input.turn_id, () => commitLimitEditInProcess(input, 's4'),
      () => ({ status: 'stale' as const }), () => ({ status: 'refused' as const, reason: 'turn_fence_refused' })),
  });
  const propose = (text = SERVED, value = 200000, quantity_label = 'Total cost') => dispatchTool('propose_new_limit',
    JSON.stringify({ quantity_label, value, rationale: text }), ctx(text), caps);
  const chips = (r: ToolResult) => approvalChipsFor([{ name: 'propose_new_limit', ok: r.ok, mutated: false, proposal_id: typeof r.proposal_id === 'string' ? r.proposal_id : undefined }],
    id => ({ proposal: proposals.get(id), result: r }));
  const approve = (r: Rec, message = 'Yes, record that limit.') => caps.authoriseChange({ ...ctx(message),
    typed_approval_of: r.proposal_id, typed_approval_words: message }, { proposal_id: r.proposal_id });
  return { caps, proposals, writes, graph, propose, chips, approve, setGraph: (g: Rec) => { bytes = JSON.stringify(g); } };
}
afterEach(() => { port.store = undefined; });

describe('D-07: one approved limit on the quantity the user names', () => {
  it('all S1 registration sites include the new door', () => {
    expect(AGENT_TOOLS.some(t => t.name === 'propose_new_limit')).toBe(true);
    expect(MUTATION_TOOLS).toContain('propose_new_limit');
    expect(FIELD_CLASS_BY_OP.add_limit).toBe('slice_3');
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('commitLimitAddInProcess(input, String(req.id))');
    expect(route).toContain('propose_new_limit for a budget ceiling');
  });
  it.each([
    ['our budget is £200k', '£/month', 200000, false],
    ['our budget is £20k a month', '£/month', 20000, true],
    ['our budget is £20k a year', '£/month', 20000, false],
    ['our budget is £20k a month', '£', 20000, false],
  ])('P1-1 period identity: %s → %s', async (text, unit, value, admitted) => {
    const g = model(); g.nodes[2].observed_state.unit = unit;
    const w = world(g); const r = await w.propose(text, value);
    expect(r.ok).toBe(admitted);
    if (admitted) expect(r.public_label).toBe('Keep total cost within £20,000 a month?');
    else expect(w.chips(r)).toEqual([]);
  });
  it.each(['goal', 'risk', 'factor', 'outcome'])('P1-2 rival money %s owns revenue, never cost', async kind => {
    const g = model(); g.nodes.push({ id: 'revenue', kind, label: 'Revenue', observed_state: { value: 0.5, raw_value: 200000, cap: 400000, unit: '£' } });
    const w = world(g);
    for (const text of ['we only have £200k revenue', 'our budget is £200k revenue', 'our revenue budget is £200k']) {
      const r = await w.propose(text); expect(r.ok).toBe(false); expect(w.chips(r)).toEqual([]);
    }
    expect((await w.propose('our budget is £200k')).ok).toBe(true);
  });
  it.each(['Our budget is £200k if funding closes', "Our rival's budget is £200k", 'Our budget is £200k for our rival',
    'Their budget is £200k', "Acme's budget is £200k", 'Our budget is £200k, if funding closes', 'Our budget was £200k', 'Our budget is £200k last year'])('P1-3 whole-clause ownership: %s', async text => {
    const w = world(); const r = await w.propose(text);
    expect(r.ok).toBe(false); expect(w.chips(r)).toEqual([]);
    expect((await w.propose(SERVED)).ok).toBe(true);
  });
  it.each([
    'Our budget is £200k. Do not keep back £20k',
    'Our budget is £200k \nKeep back £20k',
    'Our budget is £200k, do not keep back £20k',
    "Our budget is £200k, our rival will keep back £20k",
    "Our budget is £200k, with Acme's £20k held back",
    'Our budget is £200k, with £20k held back and £250k set aside',
    'Our budget is £200k, with £250k held back',
    'Our budget is £200k, with £20k held back and £30k set aside',
    'Our budget is £200k. Their budget is £100k with £20k held back',
  ])('P1-4 reserve locality and candidate count: %s', async text => {
    const w = world(); const r = await w.propose(text); expect(r.ok).toBe(true);
    expect(w.chips(r).map(c => c.label)).toEqual(['Yes', 'Change']);
  });
  it.each([
    ['chip', 'Use £180,000 instead.', true, 180000],
    ['typed punctuation', 'Use £180,000 instead.', false, 180000],
    ['typed', 'Use £180,000 instead', false, 180000],
    ['typed spacing/case', '  use   £180,000   INSTEAD!  ', false, 180000],
    ['Yes', 'Yes', false, 200000],
    ['forged typed', 'Use £190,000', false, null],
    ['forged chip', 'Use £190,000', true, null],
  ])('P1-5 %s approval binds stored alternative', async (_, message, chip, value) => {
    const w = world(); const r = await w.propose();
    const result = chip ? await w.approve(r, message) : await w.caps.authoriseChange(ctx(message), { proposal_id: r.proposal_id as string });
    if (value === null) {
      expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'approval_words_mismatch' });
      expect(w.writes).toHaveLength(0);
    } else {
      expect(result).toMatchObject({ ok: true, applied: true });
      expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ node_id: COST, value })]);
    }
  });
  // ── buddy r2 (824a98b8) findings: each refused row has an admitted control in the same block ──
  it.each([
    ['Our monthly budget is £200k', '£', 200000, false],
    ['Our annual budget is £20k', '£/month', 20000, false],
    ['Our monthly budget is £20k a year', '£/year', 20000, false],
    ['Our monthly or yearly budget is £20k', '£/month', 20000, false],
    ['Our monthly budget is £20k', '£/month', 20000, true],
  ])('r2 P1-1 a period word before the figure is the stated period: %s on %s', async (text, unit, value, admitted) => {
    const g = model(); g.nodes[2].observed_state.unit = unit;
    const w = world(g); const r = await w.propose(text, value);
    expect(r.ok).toBe(admitted);
    if (admitted) expect(r.public_label).toBe('Keep total cost within £20,000 a month?');
    else expect(w.chips(r)).toEqual([]);
  });
  it.each([
    ['Our budget is £200k, but that was last year', false],
    ['Our budget is £200k, not counting last year', false],
    ['Our budget is £200k, all in', true],
  ])('r2 P1-3a a trailing clause of the same sentence qualifies the figure: %s', async (text, admitted) => {
    const w = world(); const r = await w.propose(text);
    expect(r.ok).toBe(admitted);
    if (!admitted) expect(w.chips(r)).toEqual([]);
  });
  it.each([
    ['Acme has a budget of £200k for our project', false],
    ['The supplier has a budget of £200k for us', false],
    ['We have a budget of £200k for our project.', true],
    ['Budget: £200k', true],
    ['The budget is £200k', true],
    ['We can spend up to £200k in total.', true],
  ])('r2 P1-3b/admission the budget is first-party or unowned: %s', async (text, admitted) => {
    const w = world(); const r = await w.propose(text);
    expect(r.ok).toBe(admitted);
    if (admitted) expect(r.public_label).toBe('Keep total cost within £200,000?');
    else expect(w.chips(r)).toEqual([]);
  });
  it.each([
    ['Our budget is £200k, keep back £20k — actually no', ['Yes', 'Change']],
    ['Our budget is £200k, keep back £20k, no, forget that', ['Yes', 'Change']],
    ['Our budget is £200k, keep back £20k', ['Yes', 'Change', 'Use £180,000']],
  ])('r2 P1-4 a rejected reserve offers no alternative: %s', async (text, labels) => {
    const w = world(); const r = await w.propose(text);
    expect(r.ok).toBe(true); expect(w.chips(r).map(c => c.label)).toEqual(labels);
  });
  it.each([['Use £180,000', 180000], ['use £180,000', 180000], ['Use £190,000', null]])('r2 P1-5 typed chip label %s', async (message, value) => {
    const w = world(); const r = await w.propose();
    const result = await w.caps.authoriseChange(ctx(message), { proposal_id: r.proposal_id as string });
    if (value === null) { expect(result).toMatchObject({ ok: false, refusal: 'approval_words_mismatch' }); expect(w.writes).toHaveLength(0); }
    else expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ node_id: COST, value })]);
  });
  it.each([[201, false], [150, true]])('r2 P2 a figure spread over %i blanks cannot be quoted whole', async (n, admitted) => {
    const w = world(); const r = await w.propose(`Our budget is £${' '.repeat(n)}200k`);
    expect(r.ok).toBe(admitted);
  });
  it('P2-6 verbatim quote surrounds bound figures after a 200-character preamble', async () => {
    const text = `${'Context only. '.repeat(20)}Our budget is £200k, with a £20k reserve held back for recruitment fees.`;
    const w = world(); const r = await w.propose(text);
    expect(r.ok).toBe(true);
    const value = w.proposals.get(r.proposal_id as string)!.operations[0]!.value as { source_quote: string };
    expect(value.source_quote.length).toBeLessThanOrEqual(200);
    expect(text).toContain(value.source_quote);
    expect(value.source_quote).toContain('£200k'); expect(value.source_quote).toContain('£20k');
  });
  it.each(['our budget is €200k', 'our budget is £200k if funding closes'])('P2-7 existing cost refused statement does not request adding it: %s', async text => {
    const w = world(); const r = await w.propose(text);
    expect(r.ok).toBe(false); expect(r.reply).not.toBe(NO_LIMIT_QUANTITY);
    expect(r.detail ?? '').not.toContain('add “Total cost”'); expect(w.chips(r)).toEqual([]);
  });
  it('P2-8 route counts the in-process limit write before dispatch', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const writer = route.slice(route.indexOf('commitLimitAdd: async (input) => {'), route.indexOf('commitLimitEdit: async (input) => {'));
    expect(writer).toContain('writesDispatched += 1;');
    expect(writer.indexOf('writesDispatched += 1;')).toBeLessThan(writer.indexOf('return readCache.around'));
  });
  it('Paul’s exact served sentence → one add_limit by id, exact card and reserve alternative', async () => {
    const w = world(); const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false, public_label: 'Keep total cost within £200,000?' });
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(1);
    expect(w.proposals.get(r.proposal_id as string)?.operations).toEqual([{ op: 'add_limit', path: COST,
      value: expect.objectContaining({ node_id: COST, operator: '<=', raw_value: 200000, unit: '£', source_quote: SERVED, value_frame: 'level' }) }]);
    const chips = w.chips(r);
    expect(chips.map(c => c.label)).toEqual(['Yes', 'Change', 'Use £180,000']);
    expect(chips[0]?.detail).toBe('Keep total cost within £200,000?');
    expect(chips[2]?.detail).toBe("You said you'd keep £20,000 back. Use £180,000 instead?");
    expect(typedApprovalOf({ chip: chips[2] })).toBe(r.proposal_id);
    expect(w.writes).toHaveLength(0);
  });
  it.each([['Yes', 'Yes, record that limit.', 200000], ['reserve', 'Use £180,000 instead.', 180000]])('%s approval → one real persisted row, retry unchanged', async (_, message, value) => {
    const w = world(); const before = w.graph(); const r = await w.propose();
    const result = await w.approve(r, message as string);
    expect(result).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ node_id: COST, operator: '<=', value, unit: '£',
      source_quote: SERVED, value_frame: 'level', provenance: 'explicit' })]);
    expect(w.graph().nodes).toEqual(before.nodes); // no today’s level or option cost changed
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]?.handler_id).toBe('add_constraint');
    expect(w.writes[0]?.expectedGraphAnalysisHash).toBeDefined();
    const bytes = JSON.stringify(w.graph());
    expect(await w.approve(r, message as string)).toMatchObject({ already_applied: true, mutated: false });
    expect(w.writes).toHaveLength(1); expect(JSON.stringify(w.graph())).toBe(bytes);
  });
  it('no cost quantity → one line, no proposal or chip; Widen has no typed quantity door', async () => {
    const g = model(); g.nodes = g.nodes.filter((n: Rec) => n.id !== COST); g.edges = g.edges.filter((e: Rec) => e.from !== COST && e.to !== COST);
    const w = world(g); const r = await w.propose();
    expect(r).toMatchObject({ ok: false, reply: NO_LIMIT_QUANTITY });
    expect(w.chips(r)).toEqual([]); expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
  });
  it.each(['our budget is £200k', "we can't spend more than £200,000", '£200,000 is all we have', 'Keep total cost within £200,000.',
    'Total cost at most £200,000', 'Total cost no more than £200,000'])('must fire: %s', async text => {
    const w = world(); const r = await w.propose(text);
    expect(r).toMatchObject({ ok: true, public_label: 'Keep total cost within £200,000?' });
    expect(w.proposals.get(r.proposal_id as string)?.operations[0]).toMatchObject({ op: 'add_limit', path: COST });
    expect(w.chips(r).map(c => c.label)).toEqual(['Yes', 'Change']);
  });
  it.each(['the competitor spent £200,000', 'is £200,000 enough?', 'last year we spent £200,000', 'if we had £200,000…',
    'if our budget is £200,000', 'the competitor budget is £200,000', 'we have £200,000 in total cost today', 'our budget is not £200,000', 'we do not only have £200,000'])('must not fire: %s', async text => {
    const w = world(); const r = await w.propose(text); expect(r.ok).toBe(false); expect(w.chips(r)).toEqual([]);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
  });
  it('a figure from another message or invented by the Agent is refused', async () => {
    const w = world(); expect((await w.propose(SERVED, 250000)).ok).toBe(false);
    const r = await w.caps.proposeNewLimit!({ ...ctx('we have no new budget'), user_text: SERVED }, { quantity_label: 'Total cost', value: 200000, rationale: '' });
    expect(r.ok).toBe(false); expect(w.writes).toHaveLength(0);
  });
  it.each(['we only have £200,000', 'we only have £200,000, with €20,000 held back for fees'])('no reserve in the same currency → no alternative: %s', async text => {
    const w = world(); const r = await w.propose(text); expect(r.ok).toBe(true); expect(w.chips(r).map(c => c.label)).toEqual(['Yes', 'Change']);
  });
  it('two cost quantities, a duplicate id, wrong label or currency → no card', async () => {
    for (const extra of [{ id: 'other-cost', kind: 'factor', label: 'Total cost', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£' } },
      { id: COST, kind: 'factor', label: 'Total cost', observed_state: { value: 0.5, raw_value: 100000, cap: 200000, unit: '£' } }]) {
      const g = model(); g.nodes.push(extra); const w = world(g); const r = await w.propose(); expect(r.ok).toBe(false); expect(w.chips(r)).toEqual([]);
    }
    const w = world(); expect((await w.propose(SERVED, 200000, 'Salary')).ok).toBe(false);
    expect((await w.propose('our budget is €200,000')).ok).toBe(false);
    expect((await w.propose(SERVED, 20000)).ok).toBe(false);
  });
  it('an existing limit routes to propose_limit_change, never adds a duplicate', async () => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'existing-cost', node_id: COST, operator: '<=', value: 150000, unit: '£', value_frame: 'level', provenance: 'explicit', label: 'Total cost' }];
    const w = world(g); const r = await w.propose('our budget is £200k'); expect(r.ok).toBe(true);
    expect(w.proposals.get(r.proposal_id as string)?.operations[0]).toMatchObject({ op: 'set_limit', path: COST });
    expect(w.chips(r)[0]?.label).toBe('Change this limit');
    expect(await w.approve(r, 'Yes, change that limit.')).toMatchObject({ applied: true });
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'existing-cost', value: 200000 })]);
  });
  it.each([
    [undefined, 'Yes, change that limit.', 200000],
    ['an earlier budget quote', 'Yes, change that limit.', 200000],
    [undefined, 'Use £180,000 instead.', 180000],
    ['an earlier budget quote', 'Use £180,000 instead.', 180000],
  ] as const)('r1 P1-4 existing budget keeps both readings and replaces quote %s → %s', async (source_quote, message, value) => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'existing-cost', node_id: COST, operator: '<=',
      value: 150000, unit: '£', value_frame: 'level', provenance: 'explicit', label: 'Total cost',
      ...(source_quote === undefined ? {} : { source_quote }) }];
    const w = world(g); const before = w.graph(); const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false,
      public_label: 'Change the limit on "Total cost" from at most £150,000 to at most £200,000' });
    expect(r.note).toContain("You said you'd keep £20,000 back. Use £180,000 instead?");
    expect(w.proposals.get(r.proposal_id as string)?.operations[0]).toMatchObject({ op: 'set_limit', path: COST,
      value: { raw_value: 200000, source_quote: SERVED, reserve: { amount: 20000, alternative: 180000 } } });
    const chips = w.chips(r);
    expect(chips.map(c => c.label)).toEqual(['Change this limit', 'Change something first', 'Use £180,000']);
    expect(chips[2]?.detail).toBe("You said you'd keep £20,000 back. Use £180,000 instead?");
    expect(typedApprovalOf({ chip: chips[2] })).toBe(r.proposal_id);
    expect(w.graph()).toEqual(before); expect(w.writes).toHaveLength(0);
    expect(await w.approve(r, message)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'existing-cost',
      node_id: COST, value, unit: '£', source_quote: SERVED, value_frame: 'level' })]);
    expect(w.graph().nodes).toEqual(before.nodes); expect(w.writes).toHaveLength(1);
    expect(await w.approve(r, message)).toMatchObject({ already_applied: true, mutated: false });
    expect(w.writes).toHaveLength(1);
  });
  it.each([['Yes, change that limit.', 200000], ['Use £180,000', 180000]] as const)('r1 P1-4 direct change door carries the same budget reading: %s', async (message, value) => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'existing-cost', node_id: COST, operator: '<=',
      value: 150000, unit: '£', value_frame: 'level', provenance: 'explicit', label: 'Total cost', source_quote: 'old quote' }];
    const w = world(g);
    const r = await dispatchTool('propose_limit_change', JSON.stringify({ limit_label: 'Total cost', operator: '<=',
      new_value: 200000, unit: '£', rationale: SERVED }), ctx(SERVED), w.caps);
    const chips = approvalChipsFor([{ name: 'propose_limit_change', ok: r.ok, mutated: false,
      proposal_id: r.proposal_id as string }], id => ({ proposal: w.proposals.get(id), result: r }));
    expect(chips.map(c => c.label)).toEqual(['Change this limit', 'Change something first', 'Use £180,000']);
    expect(await w.approve(r, message)).toMatchObject({ applied: true });
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'existing-cost', value, source_quote: SERVED })]);
  });
  it.each([true, false])('r1 P1-4 changed-budget alternative cannot be forged (chip=%s)', async chip => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'existing-cost', node_id: COST, operator: '<=',
      value: 150000, unit: '£', value_frame: 'level', provenance: 'explicit', label: 'Total cost' }];
    const w = world(g); const before = w.graph(); const r = await w.propose();
    const result = chip ? await w.approve(r, 'Use £190,000')
      : await w.caps.authoriseChange(ctx('Use £190,000'), { proposal_id: r.proposal_id as string });
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'approval_words_mismatch' });
    expect(w.graph()).toEqual(before); expect(w.writes).toHaveLength(0);
  });
  it.each(['if churn goes above 6%, we lose money', 'keep churn at most 6%',
    'Our price is £6. If churn goes above 6%, we lose money'])('r1 P2 missing percent quantity adds no money recovery sentence: %s', async text => {
    const g = model(); g.nodes = g.nodes.filter((n: Rec) => n.id !== COST);
    g.edges = g.edges.filter((e: Rec) => e.from !== COST && e.to !== COST);
    const w = world(g); const r = await w.propose(text, 6, 'Churn');
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'limit_not_bound' });
    expect(r).not.toHaveProperty('reply'); expect(r).not.toHaveProperty('detail');
    expect(w.chips(r)).toEqual([]); expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
  });
  it('stale approval, rejected fence and forged alternative all leave the model untouched', async () => {
    const w = world(); const r = await w.propose(); const changed = w.graph(); changed.nodes[2].observed_state.raw_value = 160000; w.setGraph(changed);
    expect(await w.approve(r)).toMatchObject({ refusal: 'superseded' }); expect(w.writes).toHaveLength(0);
    const f = world(model(), { append: async () => { expect(currentTurnFenceSlot()?.handle).toBeDefined(); throw new TurnFenceRejectedError('fence refused', { verdict: 'unclaimed', generation: null, maxGeneration: null }); } }); const rf = await f.propose();
    expect((await f.approve(rf)).ok).toBe(false); expect(f.writes).toHaveLength(0);
    const forged = world(); const rp = await forged.propose();
    expect(await forged.approve(rp, 'Use £170,000 instead.')).toMatchObject({ refusal: 'approval_words_mismatch' }); expect(forged.writes).toHaveLength(0);
  });
  it('writer rechecks analysis hash, frame and existing row before the append', async () => {
    const g = model(); const v = readNewLimit(g, SERVED, 200000)!;
    const apply = (graph: Rec, hash = computeAnalysisAffectingGraphHash(graph as never)!) => applyLimitAdd({ persistedGraph: graph,
      payload: { scenario_id: SCENARIO, turn_id: 'adapter', stage: 'frame' }, priorFacts: [], requestId: 'adapter', request: { ...v, base_graph_hash: hash } });
    expect(await apply(g, 'stale')).toMatchObject({ kind: 'base_hash_diverged' });
    const existing = model(); existing.goal_constraints = [{ constraint_id: 'held', node_id: COST, operator: '<=', value: 150000 }];
    expect(await apply(existing)).toMatchObject({ kind: 'refused', reason: 'existing_limit' });
    const change = model(); change.nodes[2].quantity_frame = 'change'; expect(await apply(change)).toMatchObject({ kind: 'refused', reason: 'quantity_frame_changed' });
  });
  it('whitespace 5k → 20k timing, existing scanners only; no new regex', () => {
    const timed = (n: number) => { const t = performance.now(); for (let i = 0; i < 80; i++) readNewLimit(model(), `we${' '.repeat(n)}only have £200,000`, 200000); return performance.now() - t; };
    timed(20000); const small = timed(5000); const large = timed(20000);
    writeFileSync('/tmp/s4-whitespace.json', JSON.stringify({ small, large, ratio: large / small }));
    console.log(`S4 whitespace timing: 5k=${small.toFixed(2)}ms 20k=${large.toFixed(2)}ms ratio=${(large / small).toFixed(2)}`);
    expect(large / small).toBeLessThan(8);
  });
});

it('the next real Run carries the approved row to PLoT and input_snapshot.constraints', async () => {
  const w = world(); const r = await w.propose(); expect(await w.approve(r)).toMatchObject({ applied: true });
  const persisted = w.graph();
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'run-s4', port.store!);
  const sent: Rec[] = [];
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: vi.fn(async (payload: Rec) => { sent.push(structuredClone(payload)); return {
      meta: { seed_used: 1, n_samples: 1000, response_hash: 's4-run' }, response_hash: 's4-run', analysis_status: 'computed',
      option_comparison: [{ option_id: 'a', option_label: 'Hire a lead', win_probability: 0.6, status: 'computed', constraint_probabilities: { [persisted.goal_constraints[0].constraint_id]: 0.9 } },
        { option_id: 'b', option_label: 'Hire developers', win_probability: 0.4, status: 'computed', constraint_probabilities: { [persisted.goal_constraints[0].constraint_id]: 0.6 } }], factor_sensitivity: [],
      constraints_status: 'computed', constraint_results: [{ constraint_id: persisted.goal_constraints[0].constraint_id,
        node_id: COST, operator: '<=', threshold: 200000, scale_provenance: { source: 'explicit_cap', range_unified: true, decision_grade: true } }],
    } as unknown as V2RunResponseEnvelope; }), validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient });
  const out = await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
    session_id: SCENARIO, request_id: 'run-s4', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [],
    scenarioBriefText: null, persistedGraph: persisted }, payload: { kind: 'message', scenario_id: SCENARIO, turn_id: 'run-s4', stage: 'analyse', message: 'Run the analysis.' },
    requestId: 'run-s4', signal: new AbortController().signal, orientationText: '', graphForTurn: persisted } as unknown as HandlerInvocation);
  expect(sent).toHaveLength(1);
  const stored = persisted.goal_constraints[0];
  expect(sent[0]?.goal_constraints).toContainEqual(expect.objectContaining({ constraint_id: stored.constraint_id, node_id: COST,
    operator: '<=', value: 200000, unit: '£', value_frame: 'level' }));
  const fact = out.handler_facts.find(f => f.fact_type === 'run_analysis') as Rec;
  expect(fact.result.constraint_verdict.per_limit).toEqual([{ constraint_id: stored.constraint_id, state: 'scored' }]);
  expect(fact.result.enrichment.option_comparison.map((o: Rec) => o.constraint_probabilities[stored.constraint_id])).toEqual([0.9, 0.6]);
  expect(fact.result.input_snapshot.constraints).toContainEqual(expect.objectContaining({ constraint_id: stored.constraint_id, node_id: COST,
    operator: '<=', raw: 200000, unit: '£', frame: 'level' }));
});
