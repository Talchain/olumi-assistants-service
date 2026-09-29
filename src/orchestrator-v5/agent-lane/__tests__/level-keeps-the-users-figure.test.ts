/**
 * ⛔ THE LEVEL KEEPS THE USER'S FIGURE (AI Conversation #70 5848429576; DL 5848470464; the door, CEE #2024). Served on
 * 5f941f2: "it sets Paid AI add-on price to £10 per month" was approved and stored as a bare `{value: 0.1}` — no raw
 * value, no unit, no range — on a NEW factor with none. The proposal held £10 and the range it was read against; the
 * port was handed only the model-scale value. Each level now hands the writer its figure (`raw_value`, `unit`, `cap`)
 * when they reproduce the level exactly, and the user's stated unit reaches a factor that declares none.
 *
 * Bound to what the WRITER is handed (the port input), on the served shape and labels.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { approvalChipsFor } from '../approval-chips.js';
import { ProposalStore } from '../proposal.js';

const ctx = {
  scenario_id: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', authenticated_user_id: 'user-a', request_id: 'r',
  user_text: 'For "Test £54 versus £59 by customer cohort before rollout": use £54 per month as its Pro plan price, and it lowers Monthly churn rate to 6%. For "Keep £49 and add a paid AI add-on": it sets Paid AI add-on price to £10 per month.',
};
const COHORT = 'Test £54 versus £59 by customer cohort before rollout';
const ADD_ON = 'Keep £49 and add a paid AI add-on';
type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });

function product(opts: { addOnLinked: boolean }) {
  let nodes: Node[] = [
    { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
    { id: 'fac_price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 0.245, raw_value: 49, cap: 200, unit: 'GBP per month' } },
    { id: 'fac_churn', kind: 'factor', label: 'Monthly churn rate', observed_state: { value: 0.05, unit: 'share per month' } },
    // The served shape: NEW, no value, no range, no unit.
    { id: 'fac_add_on_price', kind: 'factor', label: 'Paid AI add-on price' },
    { id: 'opt_cohort', kind: 'option', label: COHORT },
    { id: 'opt_add_on', kind: 'option', label: ADD_ON },
  ];
  let edges = [edge('opt_cohort', 'fac_price'), edge('fac_price', 'goal_mrr'), ...(opts.addOnLinked ? [edge('opt_add_on', 'fac_add_on_price')] : [])];
  let rev = 0;
  const calls: CommitOptionLevelsInput[] = [];
  const d: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } });
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    calls.push(input);
    if (input.base_graph_hash !== `h${rev}`) return { status: 'stale' };
    edges = [...edges, ...input.links.map((k) => edge(k.option_id, k.factor_id))];
    nodes = nodes.map((n) => {
      const mine = input.levels.filter((l) => l.option_id === n.id);
      return mine.length === 0 ? n : { ...n, interventions: { ...(n.interventions ?? {}), ...Object.fromEntries(mine.map((l) => [l.factor_id, { value: l.value }])) } };
    });
    rev += 1;
    return { status: 'committed', graph_hash: `h${rev}`, receipt: null, already_applied: false,
      committed_levels: input.levels.map((l) => ({ option_id: l.option_id, factor_id: l.factor_id, value: l.value })) };
  };
  return { d, commitOptionLevels, calls };
}

const SERVED_ASK = { interventions: [
  { option_label: COHORT, factor_label: 'Pro plan monthly price', value: 54, unit: '£ per month', basis: 'the user: £54 per month', user_stated: true },
  { option_label: ADD_ON, factor_label: 'Paid AI add-on price', value: 10, unit: '£ per month', basis: 'the user: £10 per month', user_stated: true },
] };

async function approve(addOnLinked: boolean, ask: typeof SERVED_ASK | { interventions: Record<string, unknown>[] } = SERVED_ASK) {
  const p = product({ addOnLinked });
  const store = new ProposalStore();
  const caps = createAgentCapabilities(p.d, store, undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
  const r = await caps.proposeOptionInterventions(ctx, ask as never);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const label = approvalChipsFor([{ name: 'propose_option_interventions', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
    (id) => ({ proposal: store.get(id), result: r }))[0]!.label;
  const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
  expect(out.ok, JSON.stringify(out)).toBe(true);
  expect(p.calls).toHaveLength(1);
  const level = (optionId: string) => p.calls[0]!.levels.find((l) => l.option_id === optionId)!;
  return { label, level };
}

describe('the writer is handed the user\'s figure with each level, in the ONE commit', () => {
  for (const addOnLinked of [false, true]) {
    it(`RED (served, ${addOnLinked ? 'levels only' : 'a level that needs its link'}): £10 per month on the NEW factor reaches the writer as the user's 10, in £ per month, on the range it was read against`, async () => {
      const { level } = await approve(addOnLinked);
      const addOn = level('opt_add_on') as { value: number; author: string; raw_value?: number; unit?: string; cap?: number };
      expect(addOn).toMatchObject({ author: 'user_specified', raw_value: 10, unit: '£ per month' });
      // Bound by identity: the level IS raw ÷ range (the door refuses anything else).
      expect(addOn.value).toBe(10 / addOn.cap!);
      // The contrast the served run already had: the existing factor keeps its OWN declared unit and range.
      expect(level('opt_cohort')).toMatchObject({ author: 'user_specified', raw_value: 54, unit: 'GBP per month', cap: 200, value: 54 / 200 });
    });
  }

  it('RED (AI Conversation 5848452740): the one approve control says it RECORDS the user\'s levels, not "Use as starting option levels"', async () => {
    const { label } = await approve(false);
    expect(label).toBe('Record these 2 levels');
  });

  it('RED (U8, served 24df058): Olumi\'s estimate beside the user\'s level — the writer is told whose each is, and the control names both', async () => {
    const { label, level } = await approve(true, { interventions: [
      { option_label: ADD_ON, factor_label: 'Paid AI add-on price', value: 12, unit: '£ per month', basis: 'a typical add-on price' },
      { option_label: COHORT, factor_label: 'Pro plan monthly price', value: 54, basis: 'the user: £54 per month', user_stated: true },
    ] });
    expect(level('opt_add_on')).toMatchObject({ author: 'model_proposed', raw_value: 12 });
    // U8 (AI Conversation 5850225237): a mixed batch names both — never "starting" for the user's own figure, never
    // "Record these 2 levels" as if both were theirs.
    expect(label).toBe('Record 2 levels (1 Olumi estimate)');
  });

  it('CONTRAST: a batch of ONLY Olumi\'s estimates keeps its starting-estimate label (nothing in it is the user\'s)', async () => {
    const { label } = await approve(true, { interventions: [
      { option_label: ADD_ON, factor_label: 'Paid AI add-on price', value: 12, unit: '£ per month', basis: 'a typical add-on price' },
      { option_label: COHORT, factor_label: 'Pro plan monthly price', value: 57, basis: 'the middle of the tested range' },
    ] });
    // Unchanged from staging: Olumi's figures, offered as a starting point.
    expect(label).toBe('Use these 2 starting figures');
  });

  it('RED (Canonical #2025 B1): a unit the MODEL supplies never grounds a figure the user wrote about another entity', async () => {
    // "6%" is churn's; the Agent claims it as the add-on price's, with a unit that names churn. Grounding reads the
    // factor's DECLARED unit only (none here), so the claim is withdrawn and the level is Olumi's.
    const p = product({ addOnLinked: true });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store, undefined, 'full', undefined, { commitOptionLevels: p.commitOptionLevels });
    const r = await caps.proposeOptionInterventions({ ...ctx, user_text: 'For "Keep £49 and add a paid AI add-on": it lowers Monthly churn rate to 6%.' }, { interventions: [
      { option_label: ADD_ON, factor_label: 'Paid AI add-on price', value: 6, unit: '% monthly churn rate', basis: 'the user: 6%', user_stated: true },
    ] } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const op = store.get(String(r.proposal_id))!.operations.find((o) => o.op === 'set_option_intervention')!;
    expect((op.value as { authored_by?: string }).authored_by).toBe('model_proposed');
  });

  it('CONTROL: a level already on the model\'s 0–1 scale, with no range, hands the writer no figure (nothing for the door to refuse)', async () => {
    const { level } = await approve(true, { interventions: [
      { option_label: ADD_ON, factor_label: 'Paid AI add-on price', value: 0.4, basis: 'the user: 0.4', user_stated: true },
    ] });
    const l = level('opt_add_on') as Record<string, unknown>;
    expect(l.value).toBe(0.4);
    expect('raw_value' in l || 'cap' in l).toBe(false);
  });
});
