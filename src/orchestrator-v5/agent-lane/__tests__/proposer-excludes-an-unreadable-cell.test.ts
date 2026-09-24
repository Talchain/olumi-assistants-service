/**
 * ⛔ ONE UNREADABLE CELL COST THE USER EVERY LEVEL THEY APPROVED.
 *
 * MEASURED on served `a693ba6`, acceptance run A2, scenario `2a5c229f`. The Render
 * log is unambiguous: `refusal_reason: "invalid_existing_intervention"` for
 * `hire_one_developer → developer_headcount`. Construction had written that cell as
 * a bare `{ value: 0.1 }` with no `source`, and the writer reads an existing cell
 * through `ExistingInterventionRead`, where `source` is a NON-OPTIONAL enum. Because
 * a compound's level chain stops at its first refusal, the entire option-level half
 * of the approval was discarded — the product said so honestly: "no option levels
 * from that bundle as recorded".
 *
 * `de9db856` stops new cells being written that way. It does NOT repair the 268
 * persisted models that already hold one, and on those the amplification is live.
 *
 * The fix is the same shape as the `notLinked` guard already in this file: do not
 * bundle a level whose write will refuse. Exclude the pair, name it, let the rest land.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = Record<string, unknown>;

/** Mirrors the A2 model: two options on one factor, one cell readable, one not. */
const NODES: Node[] = [
  { id: 'goal', kind: 'goal', label: 'Increase velocity' },
  { id: 'developer_headcount', kind: 'factor', label: 'Developer headcount', scale_frame: 10 },
  // ⛔ the A2 shape, verbatim from the persisted graph: `value` and nothing else.
  { id: 'hire_one_developer', kind: 'option', label: 'Hire One Developer',
    interventions: { developer_headcount: { value: 0.1 } } },
  // CONTROL: the canonical shape `freshInterventionV3` writes — readable.
  { id: 'hire_two_developers', kind: 'option', label: 'Hire Two Developers',
    interventions: { developer_headcount: { value: 0.2, source: 'brief_extraction' } } },
];

const EDGES = [
  { from: 'hire_one_developer', to: 'developer_headcount', effect_direction: 'positive' },
  { from: 'hire_two_developers', to: 'developer_headcount', effect_direction: 'positive' },
  { from: 'developer_headcount', to: 'goal', effect_direction: 'positive' },
];

function fakeProduct() {
  const posted: unknown[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') { posted.push(b.event); return { status: 200, json: {} }; }
    return { status: 200, json: { graph: { nodes: NODES, edges: EDGES }, graph_hash: 'h0' } };
  };
  return { d, posted };
}

const BOTH = {
  interventions: [
    { option_label: 'Hire One Developer', factor_label: 'Developer headcount', value: 6, basis: 'one more on a team of five' },
    { option_label: 'Hire Two Developers', factor_label: 'Developer headcount', value: 7, basis: 'two more' },
  ],
};

describe('the proposer will not bundle a level whose write must refuse', () => {
  it('⭐ the READABLE option still gets its level — the bundle is not lost', async () => {
    const p = fakeProduct();
    const r = await createAgentCapabilities(p.d, new ProposalStore()).proposeOptionInterventions(ctx, BOTH);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const got = (r.interventions as { option: string }[]).map((i) => i.option);
    // THE WHOLE POINT: before this fix both were bundled, the write refused on the
    // first, and NEITHER landed. Bind by identity — the exact option label.
    expect(got).toEqual(['Hire Two Developers']);
  });

  it('⭐ and the unreadable one is NAMED, so the user is told rather than silently dropped', async () => {
    const p = fakeProduct();
    const r = await createAgentCapabilities(p.d, new ProposalStore()).proposeOptionInterventions(ctx, BOTH);
    expect(r.unreadable_existing_cell).toEqual([
      { option: 'Hire One Developer', factor: 'Developer headcount' },
    ]);
  });

  it('⛔ CONTROL: a cell WITH a source is untouched — this does not exclude everything', async () => {
    const p = fakeProduct();
    const r = await createAgentCapabilities(p.d, new ProposalStore()).proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Hire Two Developers', factor_label: 'Developer headcount', value: 7, basis: 'b' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.unreadable_existing_cell).toBeUndefined();
    expect((r.interventions as { option: string }[]).map((i) => i.option)).toEqual(['Hire Two Developers']);
  });

  it('⛔ PROPOSES ONLY — nothing is written either way', async () => {
    const p = fakeProduct();
    await createAgentCapabilities(p.d, new ProposalStore()).proposeOptionInterventions(ctx, BOTH);
    expect(p.posted).toHaveLength(0);
  });
});
