/** S-E S4 widening: DL's independently supplied loss-threshold corpus.
 * Real extraction, proposal/card, approval, add_constraint and persisted read-back.
 * Only SessionStore transport is replaced; proposals never silently write.
 */
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';
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
import { readNewLimit } from '../../agent-lane/stated-limit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { commitLimitAddInProcess, commitLimitEditInProcess } from '../../system-events/dispatch.js';
import { runFencedInProcessWrite } from '../../../orchestrator/turn-fence-prehandler.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, any>;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHURN = 'monthly-churn-rate';
const PAUL = 'Our current churn is 4%, and price rises would at least increase it 1%; above 6% we lose money';
const MODEL_ONLY = 'if it goes above 6%, we start to lose money';
const ctx = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null,
  request_id: 's4-loss', user_text: text, user_turn_text: text });

function model(label = 'Churn'): Rec {
  return { version: '1', nodes: [
    { id: 'g', kind: 'goal', label: 'MRR', observed_state: { value: 0.5, raw_value: 10000, cap: 20000, unit: '£/month' } },
    { id: 'd', kind: 'decision', label: 'Pricing' },
    { id: CHURN, kind: 'factor', label, category: 'controllable', quantity_frame: 'level',
      observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%', source: 'user_override' } },
    { id: 'a', kind: 'option', label: 'Hold price', interventions: {} },
    { id: 'b', kind: 'option', label: 'Raise price', interventions: {} },
  ], edges: [], goal_constraints: [] };
}
function withGrowth(g = model()): Rec {
  g.nodes.push({ id: 'growth', kind: 'outcome', label: 'Growth', quantity_frame: 'level',
    observed_state: { value: 0.05, raw_value: 5, cap: 100, unit: '%' } });
  return g;
}
function world(initial = model()) {
  let bytes = JSON.stringify(assignEntityRefs(projectGraphForPersistence(initial), { nodes: [], edges: [] }).graph);
  const graph = (): Rec => JSON.parse(bytes);
  const writes: SessionTurnWrite[] = [];
  const proposals = new ProposalStore();
  port.store = createMockSessionStore({
    loadGraph: async () => graph(), loadGraphAndBriefText: async () => ({ graph: graph(), briefText: null }),
    readExistingScenario: async () => ({ userId: null, graph: graph(), briefText: null, analysisInvalidatedAt: null }),
    getScenarioOwner: async () => null,
    append: async write => {
      const saved = structuredClone(write); writes.push(saved);
      if (saved.graph !== undefined) bytes = JSON.stringify(saved.graph);
      return { id: `s4-loss-row-${writes.length}` };
    },
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({ id: `s4-loss-row-${i + 1}`, scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => writes.flatMap((w, i) => ids.includes(`s4-loss-row-${i + 1}`)
      ? w.handler_facts.map(fact => ({ turn_id: `s4-loss-row-${i + 1}`, fact_created_at: '2026-10-08T16:30:00Z', fact })) : []),
  });
  const dispatch: InternalDispatch = async path => {
    if (!path.endsWith('/graph')) throw new Error(`Unexpected dispatch: ${path}`);
    const g = graph(); return { status: 200, json: { graph: g, graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
  };
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitLimitAdd: input => runFencedInProcessWrite(input.scenario_id, input.turn_id,
      () => commitLimitAddInProcess(input, 's4-loss'), () => ({ status: 'stale' as const }),
      () => ({ status: 'refused' as const, reason: 'turn_fence_refused' })),
    commitLimitEdit: input => runFencedInProcessWrite(input.scenario_id, input.turn_id,
      () => commitLimitEditInProcess(input, 's4-loss'), () => ({ status: 'stale' as const }),
      () => ({ status: 'refused' as const, reason: 'turn_fence_refused' })),
  });
  const propose = (text = PAUL, value = 6, quantity_label = 'Churn') => dispatchTool('propose_new_limit',
    JSON.stringify({ quantity_label, value, rationale: text }), ctx(text), caps);
  const chips = (r: ToolResult) => approvalChipsFor([{ name: 'propose_new_limit', ok: r.ok, mutated: false,
    proposal_id: typeof r.proposal_id === 'string' ? r.proposal_id : undefined }],
  id => ({ proposal: proposals.get(id), result: r }));
  const approve = (r: ToolResult, message = 'Yes, record that limit.') => caps.authoriseChange({ ...ctx(message),
    typed_approval_of: r.proposal_id, typed_approval_words: message }, { proposal_id: r.proposal_id as string });
  return { graph, writes, proposals, caps, propose, chips, approve };
}
afterEach(() => { port.store = undefined; });

describe('S4 loss threshold: inclusive ceiling from this message, subject to approval', () => {
  // Verbatim DL corpus: these rows originate outside the implementation author.
  it.each([
    ['named earlier in this message', 'Our current churn is 4%. if it goes above 6%, we start to lose money', model()],
    ['only percentage quantity in the model', MODEL_ONLY, model()],
    ['anything over', "anything over 6% and we're losing money", model()],
    ['past', 'past 6% churn we lose money', model()],
    ['tops', 'we lose money once churn tops 6%', model()],
    ['Paul full message', PAUL, model()],
    ['churn names Monthly churn rate', PAUL, withGrowth(model('Monthly churn rate'))],
    ['named churn selects amongst two percentages', 'Our current churn is 4%. if it goes above 6%, we start to lose money', withGrowth()],
  ])('must fire (%s): %s', (_family, text, g) => {
    const value = readNewLimit(g, text, 6);
    expect(value).toMatchObject({ node_id: CHURN, operator: '<=', raw_value: 6, unit: '%',
      value_frame: 'level', source_quote: text });
    expect(value).not.toHaveProperty('operator_as_stated');
    expect(value).not.toHaveProperty('stated_operator');
  });

  it.each(['we lose money', "we're losing money", 'we start to lose money', "we're unprofitable", "we're in the red", "we're loss-making"])('closed consequence list: %s', consequence => {
    const text = `above 6% ${consequence}`;
    expect(readNewLimit(model(), text, 6)).toMatchObject({ node_id: CHURN, operator: '<=', raw_value: 6, source_quote: text });
  });
  it.each(['above', 'over', 'more than', 'past', 'tops', 'exceeds', 'goes above', 'anything over'])('bounded crossing cue: %s', cue => {
    const text = `churn ${cue} 6% and we lose money`;
    expect(readNewLimit(model(), text, 6)).toMatchObject({ node_id: CHURN, operator: '<=', raw_value: 6 });
  });

  it.each([
    ["if it goes above 6% we'll celebrate", model()],
    ['above 6% growth would be great', withGrowth()],
    [MODEL_ONLY, withGrowth()],
    ['Churn and growth matter; above 6% we lose money', withGrowth()],
    ['do we lose money above 6%?', model()],
    ['their churn above 6% loses them money', model()],
    ['last year above 6% we lost money', model()],
    ['above 6% we lose revenue', model()],
    ['above 6% we are insolvent', model()],
    ['above 6%. We lose money.', model()],
    ['churn above the threshold we lose money', model()],
    ['Our current churn is 6%. above the threshold we lose money', model()],
    ['churn above 6% increase we lose money', model()],
    // HIGH reviewer corpus: an owner or a different named quantity cannot be inferred away.
    ['Acme churn above 6% we lose money', model()],
    ['Acme churn above 6% is unprofitable', model()],
    ['Our churn is 4%; growth above 6% we lose money', model()],
  ])('must not fire: %s', async (text, g) => {
    expect(readNewLimit(g, text, 6)).toBeNull();
    const w = world(g); const r = await w.propose(text);
    expect(r.ok).toBe(false); expect(w.chips(r)).toEqual([]);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0); expect(w.writes).toHaveLength(0);
  });

  it.each(['change_abs', 'change_rel', 'change'])('a % quantity in %s frame is not a level ceiling', frame => {
    const g = model(); g.nodes[2].quantity_frame = frame;
    expect(readNewLimit(g, MODEL_ONLY, 6)).toBeNull();
  });
  it.each(['change_abs', 'change_rel', 'relative unit'])('a named % quantity in %s cannot fall back to a different level quantity', frame => {
    const g = withGrowth();
    if (frame === 'relative unit') g.nodes[5].observed_state.unit = '% increase';
    else g.nodes[5].quantity_frame = frame;
    expect(readNewLimit(g, `Our current growth is 4%. ${MODEL_ONLY}`, 6)).toBeNull();
    expect(readNewLimit(g, MODEL_ONLY, 6)).toMatchObject({ node_id: CHURN, raw_value: 6 });
  });
  it('the full held Monthly churn rate label names the quantity without inventing a period unit', () => {
    expect(readNewLimit(model('Monthly churn rate'), 'Monthly churn rate goes above 6%, we start to lose money', 6))
      .toMatchObject({ node_id: CHURN, operator: '<=', raw_value: 6, unit: '%' });
  });
  it.each(['fraction', '£', 'count', '% increase'])('a quantity in %s does not own a percent level', unit => {
    const g = model(); g.nodes[2].observed_state.unit = unit;
    expect(readNewLimit(g, MODEL_ONLY, 6)).toBeNull();
  });
  it.each([-1, 101])('percent level outside 0..100 is refused: %i', value => {
    expect(readNewLimit(model(), `churn above ${value}% we lose money`, value)).toBeNull();
  });
  it.each([0, 100])('percent level endpoints are inclusive own-frame values: %i', value => {
    expect(readNewLimit(model(), `churn above ${value}% we lose money`, value)).toMatchObject({ operator: '<=', raw_value: value });
  });
  it('the named percentage outcome is eligible too', () => {
    const g = model(); g.nodes[2].kind = 'outcome';
    expect(readNewLimit(g, 'churn above 6% we lose money', 6)).toMatchObject({ node_id: CHURN, operator: '<=', raw_value: 6 });
  });
  it('a % per period must stay in its own period', () => {
    const g = model(); g.nodes[2].observed_state.unit = '%/month';
    expect(readNewLimit(g, 'churn above 6% a month we lose money', 6)).toMatchObject({ node_id: CHURN, operator: '<=', raw_value: 6, unit: '%/month' });
    expect(readNewLimit(g, 'churn above 6% a year we lose money', 6)).toBeNull();
  });
  it.each(['annual churn above 6% we lose money', 'churn a year above 6% we lose money'])('a period before the percent stays in its own frame: %s', text => {
    const g = model(); g.nodes[2].observed_state.unit = '%/month';
    expect(readNewLimit(g, text, 6)).toBeNull();
    expect(readNewLimit(g, 'monthly churn above 6% we lose money', 6)).toMatchObject({ node_id: CHURN,
      operator: '<=', raw_value: 6, unit: '%/month' });
  });
  it('an invented figure, wrong named quantity, or figure carried only in older context is refused', async () => {
    expect(readNewLimit(model(), MODEL_ONLY, 7)).toBeNull();
    expect(readNewLimit(model(), PAUL, 6, 'Growth')).toBeNull();
    const w = world();
    const r = await w.caps.proposeNewLimit!({ ...ctx('above the threshold we lose money'), user_text: PAUL },
      { quantity_label: 'Churn', value: 6, rationale: PAUL });
    expect(r.ok).toBe(false); expect(w.writes).toHaveLength(0);
  });

  it('confirmation card holds one inclusive proposal; approval writes and reads back one row, retry writes none', async () => {
    const w = world(); const before = w.graph(); const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false, public_label: 'Keep churn at most 6%?' });
    expect(r.note).toContain('Nothing has changed yet');
    expect(r.note).toContain('only after approval');
    expect(w.chips(r).map(c => c.label)).toEqual(['Yes', 'Change']);
    expect(w.chips(r)[0]?.detail).toBe('Keep churn at most 6%?');
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(1);
    expect(w.proposals.get(r.proposal_id as string)?.operations).toEqual([{ op: 'add_limit', path: CHURN,
      value: expect.objectContaining({ node_id: CHURN, operator: '<=', raw_value: 6, unit: '%', value_frame: 'level', source_quote: PAUL }) }]);
    expect(w.writes).toHaveLength(0); expect(w.graph().goal_constraints).toEqual([]);
    expect(await w.approve(r, 'No, change the reading.')).toMatchObject({ ok: false, mutated: false, refusal: 'approval_words_mismatch' });
    expect(w.writes).toHaveLength(0);
    expect(await w.approve(r)).toMatchObject({ ok: true, applied: true, mutated: true });
    expect(w.writes).toHaveLength(1); expect(w.writes[0]?.handler_id).toBe('add_constraint');
    const readBack = await port.store!.loadGraph(SCENARIO);
    expect(readBack).toMatchObject({ goal_constraints: [expect.objectContaining({ node_id: CHURN, operator: '<=', value: 6,
      unit: '%', source_quote: PAUL, value_frame: 'level', provenance: 'explicit' })] });
    expect(w.graph().goal_constraints[0]).not.toHaveProperty('operator_as_stated');
    expect(w.graph().nodes).toEqual(before.nodes);
    const saved = JSON.stringify(w.graph());
    expect(await w.approve(r)).toMatchObject({ already_applied: true, mutated: false });
    expect(w.writes).toHaveLength(1); expect(JSON.stringify(w.graph())).toBe(saved);
  });

  it.each([undefined, '<'])('existing ceiling (strict stamp %s) uses change door, held/new card, one inclusive row and quote', async strict => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'held-churn', node_id: CHURN, operator: '<=', value: 5,
      unit: '%', value_frame: 'level', provenance: 'explicit', label: 'Churn', source_quote: 'Keep churn below 5%',
      ...(strict === undefined ? {} : { operator_as_stated: strict }) }];
    const w = world(g); const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false,
      public_label: `Change the limit on "Churn" from ${strict === '<' ? 'less than' : 'at most'} 5% to at most 6%` });
    expect(w.proposals.get(r.proposal_id as string)?.operations[0]).toMatchObject({ op: 'set_limit', path: CHURN });
    expect(w.chips(r)[0]?.label).toBe('Change this limit'); expect(w.writes).toHaveLength(0);
    expect(await w.approve(r, 'Yes, change that limit.')).toMatchObject({ ok: true, applied: true });
    expect(w.writes).toHaveLength(1);
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'held-churn', node_id: CHURN,
      operator: '<=', value: 6, unit: '%', source_quote: PAUL, value_frame: 'level' })]);
    expect(w.graph().goal_constraints[0]).not.toHaveProperty('operator_as_stated');
    expect(await w.approve(r, 'Yes, change that limit.')).toMatchObject({ already_applied: true, mutated: false });
    expect(w.writes).toHaveLength(1);
  });

  it('a monthly quantity cannot change an existing yearly limit through a monthly loss threshold', async () => {
    const g = model(); g.nodes[2].observed_state.unit = '%/month';
    g.goal_constraints = [{ constraint_id: 'held-churn', node_id: CHURN, operator: '<=', value: 5,
      unit: '%/year', value_frame: 'level', provenance: 'explicit', label: 'Churn' }];
    const w = world(g); const r = await w.propose('monthly churn above 6% we lose money');
    expect(r.ok).toBe(false); expect(w.chips(r)).toEqual([]); expect(w.writes).toHaveLength(0);
    expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
  });
  it.each([['percent', '%'], ['%', 'percent']])('percent aliases are compatible: node %s, existing row %s', async (nodeUnit, rowUnit) => {
    const g = model(); g.nodes[2].observed_state.unit = nodeUnit;
    g.goal_constraints = [{ constraint_id: 'held-churn', node_id: CHURN, operator: '<=', value: 5,
      unit: rowUnit, value_frame: 'level', provenance: 'explicit', label: 'Churn' }];
    const w = world(g); const r = await w.propose();
    expect(r).toMatchObject({ ok: true, mutated: false }); expect(w.writes).toHaveLength(0);
    expect(w.proposals.get(r.proposal_id as string)?.operations[0]).toMatchObject({ op: 'set_limit', path: CHURN });
    expect(await w.approve(r, 'Yes, change that limit.')).toMatchObject({ ok: true, applied: true });
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'held-churn', node_id: CHURN,
      operator: '<=', value: 6, unit: rowUnit, source_quote: PAUL, value_frame: 'level' })]);
    expect(w.writes).toHaveLength(1);
  });

  it.each([
    ["if churn goes above 6% we'll celebrate", model(), 'Churn', CHURN],
    ['above 6% growth would be great', withGrowth(), 'Growth', 'growth'],
    ['do we lose money above 6%?', model(), 'Churn', CHURN],
    [MODEL_ONLY, withGrowth(), 'Churn', CHURN],
  ])('direct change door cannot bypass loss-threshold admission: %s', async (text, g, label, nodeId) => {
    g.goal_constraints = [{ constraint_id: 'held-direct', node_id: nodeId, operator: '<=', value: 5,
      unit: '%', value_frame: 'level', provenance: 'explicit', label }];
    const w = world(g);
    const r = await dispatchTool('propose_limit_change', JSON.stringify({ limit_label: label, operator: '<=',
      new_value: 6, unit: '%', rationale: text }), ctx(text), w.caps);
    expect(r.ok).toBe(false); expect(w.proposals.outstanding(SCENARIO, null)).toHaveLength(0);
    expect(w.writes).toHaveLength(0);
  });
  it('direct change door admits the unique percentage loss threshold, keeping the quote and inclusive reading', async () => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'held-direct', node_id: CHURN, operator: '<=', value: 5,
      unit: '%', value_frame: 'level', provenance: 'explicit', label: 'Churn' }];
    const w = world(g);
    const r = await dispatchTool('propose_limit_change', JSON.stringify({ limit_label: 'Churn', operator: '<=',
      new_value: 6, unit: '%', rationale: MODEL_ONLY }), ctx(MODEL_ONLY), w.caps);
    expect(r).toMatchObject({ ok: true, mutated: false,
      public_label: 'Change the limit on "Churn" from at most 5% to at most 6%' });
    expect(w.proposals.get(r.proposal_id as string)?.operations[0]).toMatchObject({ op: 'set_limit', path: CHURN,
      value: { operator: '<=', raw_value: 6, source_quote: MODEL_ONLY } });
    expect(w.writes).toHaveLength(0);
    expect(await w.approve(r, 'Yes, change that limit.')).toMatchObject({ ok: true, applied: true });
    expect(w.graph().goal_constraints).toEqual([expect.objectContaining({ constraint_id: 'held-direct', node_id: CHURN,
      operator: '<=', value: 6, unit: '%', source_quote: MODEL_ONLY, value_frame: 'level' })]);
    expect(w.graph().goal_constraints[0]).not.toHaveProperty('operator_as_stated'); expect(w.writes).toHaveLength(1);
  });
  it('an ordinary direct ceiling change remains allowed beside an unrelated money crossing cue', async () => {
    const g = model(); g.goal_constraints = [{ constraint_id: 'held-direct', node_id: CHURN, operator: '<=', value: 5,
      unit: '%', value_frame: 'level', provenance: 'explicit', label: 'Churn' }];
    const text = 'Keep churn at most 6%. The costs are above £300.';
    const w = world(g);
    const r = await dispatchTool('propose_limit_change', JSON.stringify({ limit_label: 'Churn', operator: '<=',
      new_value: 6, unit: '%', rationale: text }), ctx(text), w.caps);
    expect(r).toMatchObject({ ok: true, mutated: false });
    const op = w.proposals.get(r.proposal_id as string)?.operations[0];
    expect(op).toMatchObject({ op: 'set_limit', path: CHURN, value: { operator: '<=', raw_value: 6 } });
    expect(op?.value).not.toHaveProperty('source_quote'); expect(w.writes).toHaveLength(0);
  });

  it('linear timing: 20k → 160k whitespace and long near-miss crossing cues, shared helper, <22x', () => {
    const g = model();
    const cases = (n: number) => [`if it${' '.repeat(n)}goes above 6%, we start to lose money`,
      `churn ${'goes aboveish 6% we start to lose money; '.repeat(Math.floor(n / 39))}`,
      `churn ${'goes aboveish 6% we start to lose money, '.repeat(Math.floor(n / 39))}`];
    const small = cases(20_000); const large = cases(160_000);
    expect(readNewLimit(g, large[1]!, 6)).toBeNull();
    expect(readNewLimit(g, large[2]!, 6)).toBeNull();
    const run = (texts: string[]) => { for (const text of texts) readNewLimit(g, text, 6); };
    const timing = scalingRatio(() => run(small), () => run(large));
    writeFileSync('/tmp/s4-loss-timing.json', JSON.stringify(timing));
    console.log(`S4 loss-threshold timing (20k -> 160k, whitespace + near-miss): ${timing.detail}`);
    expect(timing.ratio).toBeLessThan(22);
  });
});
