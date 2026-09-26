/**
 * ⭐ A STARTING POINT SAYS, BEFORE THE APPROVAL, WHETHER THE ANALYSIS WILL BE ABLE TO RUN AFTER IT.
 *
 * Served (F) on CEE ef99a97 / cb1778b (Paul's brief, about 1 in 5 first passes; DL #70 5842400604): the drafter made
 * "£59 with AI release" and "Test £59 with AI release" (differing only in rollout). The Agent's starting point filled
 * every missing level — and made the two identical, so after the user's ONE approval the verdict said
 * `NOTHING_TO_COMPARE` and nothing could run: a dead start the user walked into.
 *
 * The proposal now carries `readiness_if_approved`: the ONE readiness verdict (`readinessViewOf`) over the stored
 * graph with this proposal's levels applied — so the Agent can say before approval what would still block.
 *
 * FIXTURE: that run's own served first-turn `draft_graph`, verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-pre-starting-point-ef99a97.json', import.meta.url), 'utf8')) as unknown;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-446655440088', authenticated_user_id: null, request_id: 'r' };
const capsOver = (graph: unknown) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
};
const levels = (testPrice: number) => [
  { option_label: '£59 with AI release', factor_label: 'AI feature availability', value: 100, basis: 'the release makes it available' },
  { option_label: 'Test £59 with AI release', factor_label: 'Pro plan price', value: testPrice, basis: 'the test price' },
  { option_label: 'Test £59 with AI release', factor_label: 'AI feature availability', value: 100, basis: 'the release makes it available' },
];
type View = { checked: boolean; may_run?: boolean; needs_from_user: { message: string }[] };

describe('propose_starting_point says whether one approval will make the analysis runnable', () => {
  it('RED: levels that leave two options identical → readiness_if_approved says it still cannot run, and why', async () => {
    const r = await capsOver(served).proposeStartingPoint(ctx, { assumptions: [], option_levels: levels(59) });
    expect(r, JSON.stringify(r).slice(0, 600)).toEqual(expect.objectContaining({ ok: true }));
    const v = r.readiness_if_approved as View | undefined;
    expect(v?.checked).toBe(true);
    expect(v?.may_run).toBe(false);
    expect(JSON.stringify(v?.needs_from_user)).toMatch(/identical/i);
    expect(String(r.note)).toMatch(/could still not run/i);
  });

  it('CONTRAST: the same starting point with a different test price → it says the analysis can run after approval', async () => {
    const r = await capsOver(served).proposeStartingPoint(ctx, { assumptions: [], option_levels: levels(54) });
    const v = r.readiness_if_approved as View | undefined;
    expect(v?.may_run, JSON.stringify(v)).toBe(true);
    expect(String(r.note)).not.toMatch(/could still not run/i);
  });
});
