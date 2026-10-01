/**
 * ⭐ F1 T5 `set_goal` — THE AGENT'S `propose_goal_target` CARRIES THE GOAL'S PERIOD, HORIZON AND THE FIGURE AS STATED, ON
 * ONE CARD, INTO THE SAME `goal_target_edit` THE CANVAS CONTROL SENDS (MG; spec `output/mg-0ebb952a/SEMANTIC-MODEL-SPEC.md`
 * §1 G1, §7 P4).
 *
 * Paul (1 Oct): "£100k a quarter" against a monthly goal was dropped "because the units differ". The capability converts
 * it explicitly (÷3) with the ONE module the writer re-checks with (`goal-target/goal-period.ts`), keeps his words in
 * `stated_as`, and the read-back confirms every field the card wrote, byte-exact. A week / day figure is never converted.
 *
 * The writer below is a MODEL of the product's contract, with one switch: `keepsF1` (whether it stores the 0.69.0 fields).
 * The REAL writer is driven in `agent-sets-the-goal-target-real-writer.test.ts`. Every event sent is parsed by the REAL
 * boundary schema.
 */
import { describe, it, expect } from 'vitest';
import { SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, projectModelContext, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440452';
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });

type Node = { id: string; kind: string; label: string; [k: string]: unknown };
type Graph = { nodes: Node[]; edges: Record<string, unknown>[]; goal_constraints?: Record<string, unknown>[] };
const graphWith = (goal: Partial<Node> = {}): Graph => ({
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Pricing decision' },
    { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.245, raw_value: 49, unit: '£', cap: 200 } },
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_unit: '£', ...goal },
  ],
  edges: [{ from: 'price', to: 'mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
});

/** The product's target writer, modelled from its contract; `keepsF1: false` stores the target but drops the 0.69.0 fields. */
function world(initial: Graph, keepsF1 = true) {
  let g = JSON.parse(JSON.stringify(initial)) as Graph;
  let rev = 1;
  const sent: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: g, graph_hash: `h${rev}` } };
    sent.push(body as Record<string, unknown>);
    const ev = (body as { event?: Record<string, unknown> }).event ?? {};
    if (ev['kind'] !== 'goal_target_edit') throw new Error(`unexpected dispatch ${path}`);
    if (ev['base_graph_hash'] !== `h${rev}`) return { status: 409, json: {} };
    const operator = ev['constraint_type'] === 'at_least' ? '>=' : '<=';
    const row = { constraint_id: 'gc-1', node_id: ev['goal_node_id'], operator, value: ev['raw_value'], unit: ev['unit'], provenance: 'explicit', value_frame: 'level' };
    const f1 = keepsF1 ? {
      ...(ev['goal_period'] !== undefined ? { goal_period: ev['goal_period'] } : {}),
      ...(ev['goal_horizon'] !== undefined ? { goal_horizon: ev['goal_horizon'] } : {}),
      ...(ev['stated_as'] !== undefined ? { goal_stated_as: ev['stated_as'] } : {}),
    } : {};
    g = {
      ...g,
      goal_constraints: [...(g.goal_constraints ?? []).filter((c) => !(c['node_id'] === ev['goal_node_id'] && c['operator'] === operator)), row],
      nodes: g.nodes.map((n) => (n.id !== ev['goal_node_id'] ? n
        : { ...n, ...f1, ...(operator === '>=' ? { goal_threshold_raw: ev['raw_value'], goal_threshold_unit: ev['unit'] } : {}) })),
    };
    rev += 1;
    return { status: 200, json: { assistant_text: 'Success target set.', graph_hash: `h${rev}` } };
  };
  return { d, sent, graph: () => g };
}
const parsesOnTheWire = (body: Record<string, unknown>) => {
  const r = SystemEventTurnPayloadSchema.safeParse(body);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
};

const PAUL = 'Our MRR goal is monthly. We need at least £100k MRR a quarter by the end of March.';
const QUARTER = { value: 100000, unit: '£', period: 'quarter', quote: '£100k MRR a quarter' };

describe('F1 T5: propose_goal_target → ONE card → ONE goal_target_edit carrying period, horizon and the figure as stated', () => {
  it('declares the three optional parameters, the contract\'s periods, and leaves the required set as it was', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'propose_goal_target')!;
    const props = (t.parameters as { properties: Record<string, { enum?: unknown; properties?: Record<string, { enum?: unknown }>; required?: unknown }> }).properties;
    expect(props.period?.enum).toEqual(['none', 'day', 'week', 'month', 'quarter', 'year']);
    expect(Object.keys(props.horizon?.properties ?? {})).toEqual(['deadline', 'months']);
    expect(props.as_stated?.required).toEqual(['value', 'unit', 'period', 'quote']);
    expect((t.parameters as { required?: unknown }).required).toEqual(['constraint_type', 'value', 'unit', 'rationale']);
  });

  it('RED (c) Paul\'s case: a monthly goal, "£100k a quarter" → the card converts ÷3 and keeps his words; the approval sends them in the event; the read-back confirms each', async () => {
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(PAUL), {
      constraint_type: 'at_least', value: 100000, unit: '£', rationale: 'Paul said so.', as_stated: QUARTER, horizon: { deadline: '2027-03-31' },
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(p.public_label).toBe('Set the goal "MRR" to at least £33,333.3333 a month (£100,000 a quarter, as you stated it) by 2027-03-31');
    expect(w.sent, 'a proposal writes nothing').toEqual([]);
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [PAUL]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    parsesOnTheWire(w.sent[0]!);
    expect(JSON.stringify(w.sent[0]!['event'])).toBe(JSON.stringify({
      kind: 'goal_target_edit', goal_node_id: 'mrr', constraint_type: 'at_least', raw_value: 100000 / 3, unit: '£', base_graph_hash: 'h1',
      goal_horizon: { deadline: '2027-03-31' }, expected_goal_horizon: null, stated_as: [QUARTER], expected_stated_as: null,
    }));
    expect(r.follow_up).toBe('The goal "MRR" now has the target at least £33,333.3333 a month (£100,000 a quarter, as you stated it) by 2027-03-31.');
  });

  it('RED (read-back): a writer that stores the target but DROPS the stated figure → "could not be confirmed", never "set"', async () => {
    const w = world(graphWith({ goal_period: 'month' }), false);
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(PAUL), { constraint_type: 'at_least', value: 100000, unit: '£', rationale: 'x', as_stated: QUARTER });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [PAUL]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
    expect((w.graph().nodes.find((n) => n.id === 'mrr') as Node).goal_threshold_raw, 'PRECONDITION: the target itself did land').toBe(100000 / 3);
  });

  it('CONTROL: no F1 arguments → the event and card are exactly as before (no new keys, no period words)', async () => {
    const said = 'We need at least £60k MRR by the end of the year.';
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(p.public_label).toBe('Set the goal "MRR" to at least £60,000');
    await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
    expect(Object.keys(w.sent[0]!['event'] as object)).toEqual(['kind', 'goal_node_id', 'constraint_type', 'raw_value', 'unit', 'base_graph_hash']);
  });

  it('the goal\'s period the user states rides the event; a period the words and the goal do not say is refused with an ask', async () => {
    const said = 'We need at least £60k MRR a month.';
    const w = world(graphWith());
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x', period: 'month' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, public_label: 'Set the goal "MRR" to at least £60,000 a month' }));
    const q = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf('We need at least £60k MRR.'), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x', period: 'month' });
    expect(q).toEqual(expect.objectContaining({ ok: false, refusal: 'goal_period_not_stated' }));
    // `none` has no words to attest it: it never silently replaces a period the goal holds.
    const held = world(graphWith({ goal_period: 'month' }));
    const n = await createAgentCapabilities(held.d, new ProposalStore()).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x', period: 'none' });
    expect(n).toEqual(expect.objectContaining({ ok: false, refusal: 'goal_period_not_stated' }));
    expect(w.sent).toEqual([]);
  });

  it('RED (e): "£25k a week" against a monthly goal is never converted → refused with the ask, nothing prepared', async () => {
    const said = 'We need at least £25k MRR a week.';
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), {
      constraint_type: 'at_least', value: 25000, unit: '£', rationale: 'x', as_stated: { value: 25000, unit: '£', period: 'week', quote: '£25k MRR a week' },
    });
    expect(p).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'period_not_convertible' }));
    expect(String(p.detail)).toContain('Ask the user for the figure per month.');
    expect(String(p.detail)).toContain('Nothing was changed.');
    expect(p.proposal_id).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('nothing rides as the user\'s that the user did not say: an invented quote, a period the quote does not name, another figure, an impossible date', async () => {
    const w = world(graphWith({ goal_period: 'month' }));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const base = { constraint_type: 'at_least' as const, value: 100000, unit: '£', rationale: 'x' };
    const refusalOf = async (extra: Record<string, unknown>) => (await caps.proposeGoalTarget!(ctxOf(PAUL), { ...base, ...extra } as never)).refusal;
    expect(await refusalOf({ as_stated: { ...QUARTER, quote: '£100k every three months' } })).toBe('quote_not_users');
    expect(await refusalOf({ as_stated: { ...QUARTER, period: 'year' } })).toBe('stated_period_not_in_words');
    expect(await refusalOf({ as_stated: { ...QUARTER, value: 90000 } })).toBe('as_stated_not_the_target');
    expect(await refusalOf({ horizon: { deadline: '2027-02-31' } })).toBe('unreadable_horizon');
    expect(await refusalOf({ horizon: { deadline: '2027-03-31', months: 6 } })).toBe('unreadable_horizon');
    // CONTROL: the same card with his real quote is prepared.
    expect(await refusalOf({ as_stated: QUARTER })).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('⛔ G1: today\'s level beside a CONVERTED target is left out (its period is unknown), and the card says so — never written in a period nobody stated', async () => {
    const said = 'We have £20k MRR today and need at least £100k MRR a quarter.';
    const w = world(graphWith({ goal_period: 'month' }));
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf(said), {
      constraint_type: 'at_least', value: 100000, unit: '£', rationale: 'x', as_stated: QUARTER, current_level: { value: 20000, unit: '£' },
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, current_level_left_out: expect.objectContaining({ refusal: 'current_level_period_unknown' }) }));
    expect(String(p.public_label)).not.toContain('Today:');
  });

  it('a stated figure appends to the goal\'s record, last — earlier figures are never dropped, an identical one is not repeated', async () => {
    const earlier = { value: 80000, unit: '£', period: 'quarter', quote: '£80k a quarter' };
    const w = world(graphWith({ goal_period: 'month', goal_stated_as: [earlier, QUARTER] }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(PAUL), { constraint_type: 'at_least', value: 100000, unit: '£', rationale: 'x', as_stated: QUARTER });
    await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [PAUL]), { proposal_id: String(p.proposal_id) });
    expect((w.sent[0]!['event'] as { stated_as?: unknown }).stated_as).toEqual([earlier, QUARTER]);
  });
});

describe('F1 T5: the Agent\'s model context shows the goal\'s period, horizon and stated figures when stored', () => {
  const read = (goal: Partial<Node>) => {
    const g = graphWith(goal);
    return projectModelContext({ nodes: g.nodes as never, edges: g.edges as never, raw: g as never, analysis_state: undefined, analysis_ready: undefined }).goal as Record<string, unknown>;
  };
  it('RED: each stored field is passed through verbatim, beside the target', () => {
    const goal = read({ goal_threshold_raw: 100000 / 3, goal_period: 'month', goal_horizon: { deadline: '2027-03-31' }, goal_stated_as: [QUARTER] });
    expect(goal).toEqual(expect.objectContaining({ goal_period: 'month', goal_horizon: { deadline: '2027-03-31' }, goal_stated_as: [QUARTER] }));
    expect(goal.target).toEqual(expect.objectContaining({ value: 100000 / 3 }));
  });
  it('CONTROL: none stored, or malformed → none shown (never guessed)', () => {
    for (const goal of [read({}), read({ goal_period: 'fortnight', goal_horizon: { months: 0 }, goal_stated_as: [] })]) {
      expect(goal).not.toHaveProperty('goal_period');
      expect(goal).not.toHaveProperty('goal_horizon');
      expect(goal).not.toHaveProperty('goal_stated_as');
    }
  });
});
