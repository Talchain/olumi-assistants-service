/**
 * ⛔ A STARTING POINT MUST COVER EVERY FACTOR EACH OPTION ACTS ON — as an
 * ADMISSION rule, not a note.
 *
 * MEASURED on served 63cf4dcf (journey witness, direct transport): the starting
 * point gave "Stage Hiring After Review" ONE level while the option is wired to
 * three factors; readiness blocked the comparison (`missing_value`) and the user
 * needed a second approval.
 *
 * Independent review of #1719 at d00727aa: reporting the gap AFTER storing an
 * approvable proposal let a model that ignored the note ask for approval of an
 * incomplete set. So now an incomplete starting point leaves NOTHING approvable;
 * only a complete one is stored, and only a complete one replaces an earlier one.
 * The fake product enforces the served link rule and the conditional writes.
 */

import { describe, it, expect } from 'vitest';
import { type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createAgentCapabilitiesWithLevelsPort as createAgentCapabilities } from './fixtures/levels-port.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> };
const NODES: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'staged', kind: 'option', label: 'Stage Hiring After Review' },
];
// `staged` acts on BOTH factors; `hire_two` on Team size only.
const EDGES = [edge('hire_two', 'team_size'), edge('staged', 'team_size'), edge('staged', 'coordination_load'),
  edge('team_size', 'velocity'), edge('coordination_load', 'velocity')];

function fakeProduct() {
  const posted: string[] = [];
  let nodes: Node[] = NODES.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      posted.push('register');
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'option_intervention_edit') {
        const o = String(ev.option_id); const f = String(ev.factor_id);
        posted.push(`level ${o}::${f}`);
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        if (!EDGES.some((e) => e.from === o && e.to === f)) return { status: 422, json: { refusal_reason: 'unresolved_effect_relationship' } };
        nodes = nodes.map((n) => (n.id === o ? { ...n, interventions: { ...(n.interventions ?? {}), [f]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges: EDGES }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes };
}

const VALUES = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'five people, one lead' }];
const PARTIAL_LEVELS = [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
  { option_label: 'Stage Hiring After Review', factor_label: 'Team size', value: 5, basis: 'no hires in stage one' },
];
const FULL_LEVELS = [...PARTIAL_LEVELS,
  { option_label: 'Stage Hiring After Review', factor_label: 'Coordination load', value: 35, basis: 'review lowers load' }];

describe('an incomplete starting point leaves NOTHING approvable', () => {
  it('RED: refuses, names the missing pair, stores no proposal — and a "yes" can write nothing', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: PARTIAL_LEVELS });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('incomplete_starting_point');
    expect(r.options_missing_levels).toEqual([{ option: 'Stage Hiring After Review', factor: 'Coordination load' }]);
    expect(r).not.toHaveProperty('proposal_id');
    // Nothing is awaiting approval, so the normal "yes" path has nothing to apply.
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
    expect(store.size()).toBe(0);
    expect(p.posted).toEqual([]);
  });

  it('RED: after the omitted level is supplied, EXACTLY ONE proposal is approvable and one approval lands every level', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: PARTIAL_LEVELS });
    const r = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: FULL_LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.outstanding(SCENARIO, USER).map((o) => o.proposal_id)).toEqual([r.proposal_id]);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.applied).toBe(true);
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(Object.keys(byId.hire_two.interventions ?? {}).sort()).toEqual(['team_size']);
    expect(Object.keys(byId.staged.interventions ?? {}).sort()).toEqual(['coordination_load', 'team_size']);
  });

  it('a COMPLETE successor replaces an earlier complete one — the old id can no longer be approved', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const first = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: FULL_LEVELS });
    const second = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: FULL_LEVELS.map((l) => ({ ...l, value: l.value + 1 })) });
    expect(first.ok && second.ok).toBe(true);
    expect(store.outstanding(SCENARIO, USER).map((o) => o.proposal_id)).toEqual([second.proposal_id]);
    const stale = await caps.authoriseChange(ctx, { proposal_id: String(first.proposal_id) });
    expect(stale.ok).toBe(false);
    expect(stale.refusal).toBe('unknown_proposal');
    expect(p.posted).toEqual([]);
  });

  it('CONTRAST: an incomplete attempt never replaces a complete proposal already awaiting approval', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const complete = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: FULL_LEVELS });
    const partial = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: PARTIAL_LEVELS });
    expect(partial.refusal).toBe('incomplete_starting_point');
    expect(store.outstanding(SCENARIO, USER).map((o) => o.proposal_id)).toEqual([complete.proposal_id]);
  });

  /**
   * ⛔ MEASURED on served d1829c5 (journey J1, proxy): propose_starting_point was
   * refused `incomplete_starting_point` THREE times in one turn, naming the same
   * observable, range-framed factor under two options each time, and the user
   * was never shown a proposal. A level the Agent DID supply was dropped by the
   * level proposer (outside the stored range, or a label that resolves to
   * nothing), but the refusal carried only the missing pairs, not why the
   * supplied level was not accepted, so the Agent re-sent the same value.
   */
  it('RED: a supplied level that was NOT accepted is named, with its option and why, beside the missing pair', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: VALUES,
      option_levels: [...PARTIAL_LEVELS,
        // Coordination load's stored range is 0-100: 150 cannot be recorded on it.
        { option_label: 'Stage Hiring After Review', factor_label: 'Coordination load', value: 150, basis: 'review lowers load' }],
    });
    expect(r.refusal).toBe('incomplete_starting_point');
    expect(r.options_missing_levels).toEqual([{ option: 'Stage Hiring After Review', factor: 'Coordination load' }]);
    expect(r.levels_not_accepted).toEqual([
      expect.objectContaining({ option: 'Stage Hiring After Review', factor: 'Coordination load', value: 150, reason: expect.stringContaining('0 to 100') }),
    ]);
    expect(String(r.detail)).toMatch(/levels_not_accepted/);
    expect(store.size()).toBe(0);
    expect(p.posted).toEqual([]);
  });

  it('RED: a level whose factor label resolves to nothing is named too', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: VALUES,
      option_levels: [...PARTIAL_LEVELS,
        { option_label: 'Stage Hiring After Review', factor_label: 'Co-ordination burden', value: 35, basis: 'review lowers load' }],
    });
    expect(r.refusal).toBe('incomplete_starting_point');
    expect(r.levels_not_accepted).toEqual([
      expect.objectContaining({ option: 'Stage Hiring After Review', factor: 'Co-ordination burden', reason: expect.stringMatching(/no factor/i) }),
    ]);
  });

  it('CONTRAST: correcting the rejected level into the range admits ONE approvable proposal', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: VALUES,
      option_levels: [...PARTIAL_LEVELS,
        { option_label: 'Stage Hiring After Review', factor_label: 'Coordination load', value: 35, basis: 'review lowers load' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('levels_not_accepted');
    expect(store.outstanding(SCENARIO, USER)).toHaveLength(1);
  });

  it('CONTROL: a complete FIRST call is admitted as one approvable proposal', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: FULL_LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('options_missing_levels');
    expect(store.outstanding(SCENARIO, USER)).toHaveLength(1);
  });
});
