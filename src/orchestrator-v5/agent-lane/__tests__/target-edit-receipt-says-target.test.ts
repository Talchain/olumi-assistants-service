/**
 * ⭐ B (3) — WHAT A TARGET ROW'S EDIT SAYS, AND WHEN IT MAY SAY IT (DL lease, 12 Oct; CUT ruling).
 *
 * `authorise_change` on a `set_limit` card for one of the goal's targets (`role: 'goal_target'`), over a fake limit door
 * (`commitLimitEdit`) and a fake model read. The words are the approved one-target card's; "set" only when the row read
 * back holds the figure AND is still one of the goal's targets (a dropped role would withhold the joint for a false
 * reason). A real limit's words are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import type { CommitLimitEditInput, CommitLimitEditResult } from '../../system-events/dispatch.js';
import { ADD_CONSTRAINT_USER_GUIDANCE } from '../../tools/handlers/d1-shared/user-guidance.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c8';
type Rec = Record<string, unknown>;
const seed = (): Rec => ({
  nodes: [
    { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.6, goal_threshold_raw: 60000, goal_threshold_unit: 'GBP', goal_threshold_cap: 100000, goal_threshold_frame: 'level' },
    { id: 'fac_conv', kind: 'factor', label: 'Conversion rate', observed_state: { value: 0.12, raw_value: 12, unit: '%', cap: 100 } },
    { id: 'fac_spend', kind: 'factor', label: 'Decision spend', observed_state: { value: 0.375, raw_value: 15000, unit: 'GBP', cap: 40000 } },
  ],
  edges: [{ from: 'fac_conv', to: 'goal_x', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  goal_constraints: [
    { constraint_id: 'gc-goal', node_id: 'goal_x', operator: '>=', value: 60000, unit: 'GBP', value_frame: 'level', label: 'Revenue', provenance: 'explicit', role: 'goal_target' },
    { constraint_id: 'gc-conv', node_id: 'fac_conv', operator: '>=', operator_as_stated: '>', value: 15, unit: '%', value_frame: 'level', label: 'Conversion rate', provenance: 'explicit', role: 'goal_target' },
    { constraint_id: 'gc-spend', node_id: 'fac_spend', operator: '<=', value: 20000, unit: 'GBP', value_frame: 'level', label: 'Decision spend', provenance: 'inferred' },
  ],
});
/** The model once the door has written `id` at `value`; `dropRole` loses its target marker. */
const written = (id: string, value: number, dropRole = false): Rec => {
  const g = seed();
  g.goal_constraints = (g.goal_constraints as Rec[]).map((c) => (c.constraint_id === id ? { ...c, value, ...(dropRole ? { role: undefined } : {}) } : c));
  return g;
};

/** `after` is what the model holds once the door has run, read back with hash `afterHash` (the door commits 'h1'). */
function harness(door: (input: CommitLimitEditInput) => CommitLimitEditResult, after?: Rec, afterHash = 'h1') {
  let graph = seed();
  let hash = 'h0';
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: JSON.parse(JSON.stringify(graph)), graph_hash: hash, graph_identity_hash: { value: `id-${hash}` } } } : { status: 404, json: {} });
  const caps = createAgentCapabilities(d, new ProposalStore(), undefined, 'full', undefined, {
    commitLimitEdit: async (input: CommitLimitEditInput) => { const r = door(input); if (after !== undefined) { graph = after; hash = afterHash; } return r; },
  });
  const run = async (said: string, args: Rec) => {
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: said, user_turn_text: said };
    const card = (await dispatchTool('propose_limit_change', JSON.stringify(args), ctx as never, caps)) as Rec;
    expect(card, JSON.stringify(card)).toEqual(expect.objectContaining({ ok: true }));
    return (await dispatchTool('authorise_change', JSON.stringify({ proposal_id: card.proposal_id }), { ...ctx, typed_approval_of: card.proposal_id } as never, caps)) as Rec;
  };
  return { run };
}
const TARGET = ['Make the conversion rate target above 20%.', { limit_label: 'Conversion rate', operator: '>=', new_value: 20, stated_operator: '>', unit: '%', rationale: 'x' }] as const;
const committed = (row: Rec): CommitLimitEditResult => ({ status: 'committed', graph_hash: 'h1', model_version_receipt: undefined,
  row: { constraint_id: String(row.constraint_id), value: Number(row.value) } });

describe('what a target row\'s edit says, and when', () => {
  it('committed and the row is still one of the goal\'s targets → the target\'s receipt', async () => {
    const r = await harness(() => committed({ constraint_id: 'gc-conv', value: 20 }), written('gc-conv', 20)).run(...TARGET);
    expect(r).toEqual(expect.objectContaining({ ok: true, mutated: true, applied: true,
      follow_up: 'The target for ‘Conversion rate’ is now above 20%, using your figure.' }));
  });

  it('RED: committed and the row held, but the read-back is not this approval\'s committed postimage (another write after it) → not confirmed', async () => {
    const r = await harness(() => committed({ constraint_id: 'gc-conv', value: 20 }), written('gc-conv', 20), 'h2').run(...TARGET);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
  });

  it('RED: committed and the figure held, but the row\'s label moved → not confirmed', async () => {
    const g = written('gc-conv', 20);
    (g.goal_constraints as Rec[]).find((c) => c.constraint_id === 'gc-conv')!.label = 'Signup rate';
    const r = await harness(() => committed({ constraint_id: 'gc-conv', value: 20 }), g).run(...TARGET);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed' }));
  });

  it('RED: committed, the figure held, but the row is no longer one of the goal\'s targets → not confirmed, never "set"', async () => {
    const r = await harness(() => committed({ constraint_id: 'gc-conv', value: 20 }), written('gc-conv', 20, true)).run(...TARGET);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: true, applied: false, refusal: 'not_confirmed',
      detail: 'The target was sent, but what the model now holds could not be confirmed. Tell the user plainly that it could not be confirmed, '
        + 'offer to check the model again, and never say it was set or that it was not.' }));
    expect(r['follow_up']).toBeUndefined();
  });

  it('stale → the approved one-target words: nothing was changed', async () => {
    const r = await harness(() => ({ status: 'stale' })).run(...TARGET);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'superseded',
      detail: 'The model changed just before this target was written, so nothing was changed. Offer to prepare it again.' }));
  });

  it('refused → the approved one-target words, never "limit"', async () => {
    const r = await harness(() => ({ status: 'refused', reason: 'limit_is_a_change' })).run(...TARGET);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, refusal: 'not_applied',
      follow_up: `${ADD_CONSTRAINT_USER_GUIDANCE} Nothing on your model changed.` }));
    expect(JSON.stringify(r)).not.toMatch(/limit/i);
  });

  it('CONTROL: a real limit\'s receipt is unchanged', async () => {
    const r = await harness(() => committed({ constraint_id: 'gc-spend', value: 30000 }), written('gc-spend', 30000))
      .run('Change the spend limit to £30,000.', { limit_label: 'Decision spend', operator: '<=', new_value: 30000, unit: 'GBP', rationale: 'x' });
    expect(r).toEqual(expect.objectContaining({ ok: true, applied: true,
      follow_up: 'The limit on "Decision spend" is now at most £30,000 (it was £20,000), as you stated it.' }));
  });
});
