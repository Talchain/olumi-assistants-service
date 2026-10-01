/**
 * ⭐ F1 T5 `set_goal` — THE AGENT'S `propose_goal_target` CARRIES THE FIGURE AS THE USER STATED IT, ON ONE CARD, INTO THE
 * SAME `goal_target_edit` THE CANVAS CONTROL SENDS (MG; spec `output/mg-0ebb952a/SEMANTIC-MODEL-SPEC.md` §1 G1, §7 P4).
 *
 * ⛔ SCOPE CUT (DL 380e54 on #2454, CODEX overflow 5935202003; MG owner decision B). In THIS PR the Agent's card:
 *   · NEVER sets the goal's period or horizon (P1-4: the period-word attestation and the model-supplied horizon were
 *     banned doors). An omitted field = unchanged; a passed one is refused with nothing prepared. The typed period /
 *     horizon chip is the next PR.
 *   · NEVER converts a figure between periods (B: the quote's period is a word read, so "£60k by the end of the month"
 *     could pass as a monthly rate and be scaled). A figure stated per another period is refused with the ask. The
 *     Canvas event door keeps conversion: its period is typed (`system-events/__tests__/set-goal-period-horizon.test.ts`).
 *   · PINS the typed period it read (P1-1): `goal_period` + `expected_goal_period`, so a concurrent period change is
 *     refused by the writer and the read-back binds it.
 *   · never drops a stated figure to make room (P2): the 21st distinct one is refused.
 *
 * The writer below is a MODEL of the product's contract (including its hash-blind `expected_*` refusal, as
 * `goal-target-edit.ts` enforces it), with one switch: `keepsF1` (whether it stores the 0.69.0 fields). The REAL writer is
 * driven in `agent-sets-the-goal-target-real-writer.test.ts`. Every event sent is parsed by the REAL boundary schema.
 */
import { describe, it, expect } from 'vitest';
import { SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';
import { createAgentCapabilities, projectModelContext, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import { askForGoalPeriodFigure } from '../../goal-target/goal-period.js';

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
    // The writer's hash-blind guard (`goal-target-edit.ts`, schemas 0.69.0 `expected_*`): each field SENT carries the value
    // it was read with (null = none); a stored value that moved since refuses with nothing written (422).
    const held = (g.nodes.find((n) => n.id === ev['goal_node_id']) ?? {}) as Record<string, unknown>;
    for (const [field, expected, stored] of [['goal_period', 'expected_goal_period', 'goal_period'], ['goal_horizon', 'expected_goal_horizon', 'goal_horizon'], ['stated_as', 'expected_stated_as', 'goal_stated_as']] as const) {
      if (ev[field] !== undefined && JSON.stringify(ev[expected] ?? null) !== JSON.stringify(held[stored] ?? null)) return { status: 422, json: {} };
    }
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

/** Paul's figure in the goal's OWN period: what the card carries. */
const MONTH_SAID = 'Our MRR goal is monthly. We need at least £40k MRR a month.';
const MONTH = { value: 40000, unit: '£', period: 'month', quote: '£40k MRR a month' };
/** Paul's figure in ANOTHER period: never converted on the card (B). */
const PAUL = 'Our MRR goal is monthly. We need at least £100k MRR a quarter by the end of March.';
const QUARTER = { value: 100000, unit: '£', period: 'quarter', quote: '£100k MRR a quarter' };

describe('F1 T5: propose_goal_target → ONE card → ONE goal_target_edit carrying the figure as the user stated it', () => {
  it('RED (P1-4): the declaration carries NO period and NO horizon — only the figure as stated; the required set is as it was', () => {
    const t = AGENT_TOOLS.find((x) => x.name === 'propose_goal_target')!;
    const props = (t.parameters as { properties: Record<string, { enum?: unknown; properties?: Record<string, { enum?: unknown }>; required?: unknown }> }).properties;
    expect(props).not.toHaveProperty('period');
    expect(props).not.toHaveProperty('horizon');
    expect(props.as_stated?.required).toEqual(['value', 'unit', 'period', 'quote']);
    expect(props.as_stated?.properties?.period?.enum).toEqual(['none', 'day', 'week', 'month', 'quarter', 'year']);
    expect((t.parameters as { required?: unknown }).required).toEqual(['constraint_type', 'value', 'unit', 'rationale']);
  });

  it('CONTROL: a figure stated in the goal\'s own period → ONE card, his words kept, the figure unchanged; the approval sends it and the read-back confirms', async () => {
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(MONTH_SAID), {
      constraint_type: 'at_least', value: 40000, unit: '£', rationale: 'Paul said so.', as_stated: MONTH,
    });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(p.public_label).toBe('Set the goal "MRR" to at least £40,000 a month');
    expect(w.sent, 'a proposal writes nothing').toEqual([]);
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [MONTH_SAID]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true }));
    expect(w.sent).toHaveLength(1);
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ raw_value: 40000, unit: '£', stated_as: [MONTH], expected_stated_as: null }));
    expect(r.follow_up).toBe('The goal "MRR" now has the target at least £40,000 a month, as you stated it.');
  });

  it('RED (read-back): a writer that stores the target but DROPS the stated figure → "could not be confirmed", never "set"', async () => {
    const w = world(graphWith({ goal_period: 'month' }), false);
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(MONTH_SAID), { constraint_type: 'at_least', value: 40000, unit: '£', rationale: 'x', as_stated: MONTH });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [MONTH_SAID]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
    expect((w.graph().nodes.find((n) => n.id === 'mrr') as Node).goal_threshold_raw, 'PRECONDITION: the target itself did land').toBe(40000);
  });

  it('CONTROL: no F1 arguments on a goal with no typed period → the event and card are exactly as before (no new keys, no period words)', async () => {
    const said = 'We need at least £60k MRR by the end of the year.';
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(p.public_label).toBe('Set the goal "MRR" to at least £60,000');
    await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
    expect(Object.keys(w.sent[0]!['event'] as object)).toEqual(['kind', 'goal_node_id', 'constraint_type', 'raw_value', 'unit', 'base_graph_hash']);
  });

  it('nothing rides as the user\'s that the user did not say: an invented quote, a period the quote does not name, another figure', async () => {
    const w = world(graphWith({ goal_period: 'month' }));
    const caps = createAgentCapabilities(w.d, new ProposalStore());
    const base = { constraint_type: 'at_least' as const, value: 40000, unit: '£', rationale: 'x' };
    const refusalOf = async (extra: Record<string, unknown>) => (await caps.proposeGoalTarget!(ctxOf(MONTH_SAID), { ...base, ...extra } as never)).refusal;
    expect(await refusalOf({ as_stated: { ...MONTH, quote: '£40k every month' } })).toBe('quote_not_users');
    expect(await refusalOf({ as_stated: { ...MONTH, period: 'year' } })).toBe('stated_period_not_in_words');
    expect(await refusalOf({ as_stated: { ...MONTH, value: 30000 } })).toBe('as_stated_not_the_target');
    // CONTROL: the same card with his real quote is prepared.
    expect(await refusalOf({ as_stated: MONTH })).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('a stated figure appends to the goal\'s record, last — earlier figures are never dropped, an identical one is not repeated', async () => {
    const earlier = { value: 35000, unit: '£', period: 'month', quote: '£35k a month' };
    const w = world(graphWith({ goal_period: 'month', goal_stated_as: [earlier, MONTH] }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(MONTH_SAID), { constraint_type: 'at_least', value: 40000, unit: '£', rationale: 'x', as_stated: MONTH });
    await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [MONTH_SAID]), { proposal_id: String(p.proposal_id) });
    expect((w.sent[0]!['event'] as { stated_as?: unknown }).stated_as).toEqual([earlier, MONTH]);
  });
});

// ⛔ P1-4 (CODEX overflow 5935202003 :1745 / :1758; DL 380e54: DELETE, don't defer). The period-word attestation granted
// period authority ("£60k … by the end of the month" read as a monthly rate) and a target-only message accepted a
// model-supplied horizon. The card never sets either: a passed value is refused with nothing prepared.
describe('P1-4: the Agent\'s card NEVER sets the goal\'s period or horizon — an omitted field is unchanged, a passed one is refused', () => {
  it.each([
    ['the CODEX period case: "by the end of the month" + period month', 'We need at least £60k MRR by the end of the month.', { period: 'month' }],
    ['period none on a goal with no rate', 'We need at least £60k MRR.', { period: 'none' }],
    ['the CODEX horizon case: a target-only message + a six-month horizon', 'We need at least £60k MRR.', { horizon: { months: 6 } }],
    ['a deadline the user did give', 'We need at least £60k MRR by 2027-03-31.', { horizon: { deadline: '2027-03-31' } }],
  ])('RED: %s → refused goal_period_or_horizon_not_settable, nothing prepared, nothing sent', async (_n, said, extra) => {
    const w = world(graphWith());
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x', ...extra } as never);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'goal_period_or_horizon_not_settable' }));
    expect(String(p.detail)).toContain('Nothing was prepared');
    expect(String(p.detail)).toContain('without');
    expect(p.proposal_id).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('CONTROL: the same call without them (or with them null) → the card, and its event carries neither', async () => {
    for (const extra of [{}, { period: null, horizon: null }]) {
      const said = 'We need at least £60k MRR by the end of the month.';
      const w = world(graphWith());
      const store = new ProposalStore();
      const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x', ...extra } as never);
      expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, public_label: 'Set the goal "MRR" to at least £60,000' }));
      await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
      expect(w.sent[0]!['event']).not.toHaveProperty('goal_period');
      expect(w.sent[0]!['event']).not.toHaveProperty('goal_horizon');
    }
  });

  it('RED (the legacy carrier): the Agent\'s unit naming another period than a "£ per quarter" goal\'s → refused, never a re-period by unit', async () => {
    const w = world(graphWith({ goal_threshold_unit: '£ per quarter' }));
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf('We need at least £70k a month.'),
      { constraint_type: 'at_least', value: 70000, unit: '£ per month', rationale: 'x' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'goal_period_conflicts_with_unit' }));
    expect(w.sent).toEqual([]);
  });
});

// ⛔ B (MG owner decision): the quote's period is a word read, so the card never converts. A figure stated per another
// period than the goal's is refused with the ask; the Canvas event door, whose period is typed, keeps conversion.
describe('B: the Agent\'s card never converts a figure between periods', () => {
  it('RED: a monthly goal + "£100k a quarter" → refused stated_period_differs with the ask; nothing prepared, nothing sent', async () => {
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(PAUL), { constraint_type: 'at_least', value: 100000, unit: '£', rationale: 'x', as_stated: QUARTER });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'stated_period_differs' }));
    expect(p.detail).toBe(askForGoalPeriodFigure('quarter', 'month'));
    expect(p.proposal_id).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('RED: "£25k a week" against a monthly goal → refused stated_period_differs, the ask names the period wanted', async () => {
    const said = 'We need at least £25k MRR a week.';
    const w = world(graphWith({ goal_period: 'month' }));
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf(said), {
      constraint_type: 'at_least', value: 25000, unit: '£', rationale: 'x', as_stated: { value: 25000, unit: '£', period: 'week', quote: '£25k MRR a week' },
    });
    expect(p).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'stated_period_differs' }));
    expect(String(p.detail)).toContain('Ask the user for the figure per month.');
    expect(String(p.detail)).toContain('Nothing was changed.');
    expect(w.sent).toEqual([]);
  });

  it('RED: the LEGACY period counts too — "£70k a month" on a "£ per quarter" goal → refused, never ×3', async () => {
    const w = world(graphWith({ goal_threshold_unit: '£ per quarter' }));
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf('We need at least £70k a month.'),
      { constraint_type: 'at_least', value: 70000, unit: '£', rationale: 'x', as_stated: { value: 70000, unit: '£', period: 'month', quote: '£70k a month' } });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, refusal: 'stated_period_differs' }));
    expect(p.detail).toBe(askForGoalPeriodFigure('month', 'quarter'));
    expect(w.sent).toEqual([]);
  });

  it('CONTROL: the same period ("£200,000 a quarter" on a "£ per quarter" goal) → the card, at the figure stated', async () => {
    const said = 'We need at least £200,000 a quarter.';
    const w = world(graphWith({ goal_threshold_unit: '£ per quarter' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said),
      { constraint_type: 'at_least', value: 200000, unit: '£', rationale: 'x', as_stated: { value: 200000, unit: '£', period: 'quarter', quote: '£200,000 a quarter' } });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    expect(store.get(String(p.proposal_id))?.operations[0]?.value).toEqual(expect.objectContaining({ unit: '£ per quarter', raw_value: 200000 }));
  });
});

// ⛔ P1-1 (CODEX overflow 5935202003 :1663): the period the card read is outside the analysis hash, so a concurrent period
// change moved no `base_graph_hash`. The card now sends the typed period it read with its `expected_goal_period`.
describe('P1-1: the card pins the TYPED period it read — the writer refuses a concurrent change, the read-back binds it', () => {
  it('RED (wire): a goal typed month → the event sends goal_period month + expected_goal_period month, and parses', async () => {
    const said = 'We need at least £60k MRR.';
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(p.public_label).toBe('Set the goal "MRR" to at least £60,000 a month');
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    parsesOnTheWire(w.sent[0]!);
    expect(w.sent[0]!['event']).toEqual(expect.objectContaining({ goal_period: 'month', expected_goal_period: 'month' }));
  });

  it('RED: the stored period moves month → quarter between the card\'s read and the write → NOT applied, nothing written', async () => {
    const said = 'We need at least £60k MRR.';
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    expect(p.ok).toBe(true);
    // Another client re-periods the goal: outside the analysis hash, so the base hash does not move.
    const racing: InternalDispatch = async (path, body) => {
      if (!path.endsWith('/graph')) for (const n of w.graph().nodes) if (n.id === 'mrr') n['goal_period'] = 'quarter';
      return w.d(path, body);
    };
    const r = await createAgentCapabilities(racing, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'not_applied' }));
    const goal = w.graph().nodes.find((n) => n.id === 'mrr')!;
    expect(goal.goal_threshold_raw, 'nothing written').toBeUndefined();
    expect(w.graph().goal_constraints, 'no row written').toBeUndefined();
    expect(goal.goal_period, 'the concurrent change stands').toBe('quarter');
  });

  it('CONTROL: no concurrent change → applied, the period held as read', async () => {
    const said = 'We need at least £60k MRR.';
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    const r = await createAgentCapabilities(w.d, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: true, applied: true }));
    expect(w.graph().nodes.find((n) => n.id === 'mrr')).toEqual(expect.objectContaining({ goal_period: 'month', goal_threshold_raw: 60000 }));
  });

  it('RED (read-back): a writer that answers 200 but leaves another period → "could not be confirmed"', async () => {
    const said = 'We need at least £60k MRR.';
    const w = world(graphWith({ goal_period: 'month' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(said), { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'x' });
    const lossy: InternalDispatch = async (path, body) => {
      const r = await w.d(path, body);
      if (!path.endsWith('/graph')) for (const n of w.graph().nodes) if (n.id === 'mrr') n['goal_period'] = 'quarter';
      return r;
    };
    const r = await createAgentCapabilities(lossy, store).authoriseChange(ctxOf('Yes.', [said]), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, refusal: 'not_confirmed' }));
  });
});

// ⛔ P2 (CODEX overflow 5935202003 :1791): `.slice(-20)` silently deleted the first stated figure at the 21st. Refused instead.
describe('P2: a goal records at most 20 figures the user stated — the 21st is refused, nothing dropped', () => {
  const twenty = (n: number) => Array.from({ length: n }, (_, i) => ({ value: 1000 * (i + 1), unit: '£', period: 'month', quote: `£${i + 1}k a month` }));
  const propose = async (held: unknown[]) => {
    const w = world(graphWith({ goal_period: 'month', goal_stated_as: held }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf(MONTH_SAID), { constraint_type: 'at_least', value: 40000, unit: '£', rationale: 'x', as_stated: MONTH });
    return { w, p, value: p.ok ? (store.get(String(p.proposal_id))?.operations[0]?.value as { stated_as?: unknown[] }) : undefined };
  };

  it('RED: 20 held + a new distinct figure → refused stated_figures_full; nothing prepared, nothing sent', async () => {
    const { w, p } = await propose(twenty(20));
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'stated_figures_full' }));
    expect(String(p.detail)).toContain('20');
    expect(p.proposal_id).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('CONTROL: 19 held → the 20th fits, every earlier figure kept, the new one last', async () => {
    const held = twenty(19);
    const { p, value } = await propose(held);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    expect(value?.stated_as).toEqual([...held, MONTH]);
  });

  it('CONTROL: 20 held, one of them identical to the new figure → no 21st, the card goes out with 20', async () => {
    const held = [...twenty(19), MONTH];
    const { p, value } = await propose(held);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true }));
    expect(value?.stated_as).toEqual(held);
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

describe('ONE PERIOD CARRIER on the Agent\'s card (CODEX #2454 5932596768; R3 I1.1): a "£ per quarter" goal never gets a second period', () => {
  it('CONTROL (I1.1): the card says "£" → the held "£ per quarter" is kept and no goal_period is written (none is typed)', async () => {
    const w = world(graphWith({ goal_threshold_unit: '£ per quarter' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf('We need at least £200,000.'), { constraint_type: 'at_least', value: 200000, unit: '£', rationale: 'x' });
    const value = store.get(String(p.proposal_id))?.operations[0]?.value as Record<string, unknown>;
    expect(value).toEqual(expect.objectContaining({ unit: '£ per quarter' }));
    expect(value).not.toHaveProperty('goal_period');
  });
});

describe('ONE PERIOD CARRIER on the card, the period in force AFTER the write (CODEX #2454 5933216093)', () => {
  it('RED: a goal typed per quarter + the Agent\'s unit "£ per month" with no period → refused, nothing prepared', async () => {
    const w = world(graphWith({ goal_threshold_unit: '£', goal_period: 'quarter' }));
    const p = await createAgentCapabilities(w.d, new ProposalStore()).proposeGoalTarget!(ctxOf('We need at least £70k a month.'),
      { constraint_type: 'at_least', value: 70000, unit: '£ per month', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'goal_period_conflicts_with_unit' }));
    expect(w.sent).toEqual([]);
  });
  it('RED (read-back): a writer that keeps quarter beside a stored "£ per month" is NOT confirmed', async () => {
    const w = world(graphWith({ goal_threshold_unit: '£', goal_period: 'quarter' }));
    const store = new ProposalStore();
    const p = await createAgentCapabilities(w.d, store).proposeGoalTarget!(ctxOf('We need at least £200,000 a quarter.'),
      { constraint_type: 'at_least', value: 200000, unit: '£', rationale: 'x' });
    expect(p.ok).toBe(true);
    const lossy: InternalDispatch = async (path, body) => {
      const r = await w.d(path, body);
      if (!path.endsWith('/graph')) for (const n of w.graph().nodes) if (n.id === 'mrr') n['goal_threshold_unit'] = '£ per month';
      return r;
    };
    const r = await createAgentCapabilities(lossy, store).authoriseChange(ctxOf('Yes.'), { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ ok: false, mutated: true, refusal: 'not_confirmed' }));
  });
});
