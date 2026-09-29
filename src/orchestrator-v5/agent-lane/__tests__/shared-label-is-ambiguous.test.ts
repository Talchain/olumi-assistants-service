/**
 * ⛔ D2 — A LABEL SHARED BY TWO WRITABLE FACTORS NAMES NEITHER.
 *
 * At 8428207 `proposeAssumptions` resolved a label with `pool.find(writable) ??
 * pool[0]`, so when two factors share a label the one that happens to come FIRST in
 * the stored node list received the user's number — and the approval they were shown
 * named only the label. The level and link proposers had the same first match.
 *
 * Now: more than one acceptable match → the item is returned as AMBIGUOUS with every
 * candidate (id, label and what tells it apart), ZERO writes, no proposal operation
 * for it. The tool schemas carry labels only, but `get_canonical_state` shows each
 * entity's id, so a string that IS a node id resolves to exactly that node.
 *
 * Bound by identity throughout: which node id is in the proposal, which was written.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { committedValueWrite } from './fixtures/served-value-write.js';

const SCENARIO = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; description?: string; observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> };

const NODES: Node[] = [
  { id: 'goal_rev', kind: 'goal', label: 'Revenue' },
  // Two WRITABLE factors that read alike — the first in the list is the trap.
  { id: 'churn_pricing', kind: 'factor', label: 'Churn', description: 'Churn caused by the price change' },
  { id: 'churn_support', kind: 'factor', label: 'Churn', description: 'Churn caused by slower support', observed_state: { value: 0.05 } },
  { id: 'price', kind: 'factor', label: 'Price' },
  { id: 'raise', kind: 'option', label: 'Raise price' },
  // A risk sharing a factor's label: only ONE of the two is writable, so nothing is guessed.
  { id: 'risk_price', kind: 'risk', label: 'Price' },
];
const EDGES = [
  { from: 'churn_pricing', to: 'goal_rev' },
  { from: 'churn_support', to: 'goal_rev' },
  { from: 'price', to: 'churn_pricing' },
  { from: 'raise', to: 'churn_pricing' },
  { from: 'raise', to: 'churn_support' },
  { from: 'raise', to: 'price' },
];

function product() {
  let nodes = NODES.map((n) => ({ ...n }));
  let rev = 0;
  const writes: { kind: string; target: string }[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      writes.push({ kind: 'register', target: 'graph' });
      return { status: 200, json: { graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { kind: string; target_id?: string; option_id?: string; factor_id?: string; value: number };
      if (ev.kind === 'factor_value_edit') {
        writes.push({ kind: ev.kind, target: String(ev.target_id) });
        nodes = nodes.map((n) => (n.id === ev.target_id ? { ...n, observed_state: { ...n.observed_state, value: ev.value } } : n));
        rev += 1;
        return { status: 200, json: committedValueWrite(String(ev.target_id)) };
      }
      writes.push({ kind: ev.kind, target: `${ev.option_id}::${ev.factor_id}` });
      rev += 1;
      return { status: 200, json: { graph_hash: `h${rev}` } };
    }
    return { status: 200, json: { graph: { nodes, edges: EDGES }, graph_hash: `h${rev}` } };
  };
  return { d, writes };
}

const candidateIds = (r: Record<string, unknown>) =>
  ((r.ambiguous_targets ?? []) as { requested: string; candidates: { id: string }[] }[])
    .map((a) => [a.requested, a.candidates.map((c) => c.id)]);

describe('(iv) a label shared by two writable factors is AMBIGUOUS, and nothing is written', () => {
  it('⛔ names BOTH candidates, proposes nothing for it, and writes nothing', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Churn', value: 0.08, unit: '', basis: 'the user said 8%' }] });

    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(candidateIds(r)).toEqual([['Churn', ['churn_pricing', 'churn_support']]]);
    // What tells them apart travels: the full label and what each is connected to.
    const cands = (r.ambiguous_targets as { candidates: Record<string, unknown>[] }[])[0].candidates;
    expect(cands.map((c) => c.full_label)).toEqual(['Churn caused by the price change', 'Churn caused by slower support']);
    expect(cands.map((c) => c.connected_to)).toEqual([['Price', 'Raise price', 'Revenue'], ['Raise price', 'Revenue']]);
    expect(String(r.ambiguous_note)).toMatch(/Ask the user which one they mean/);
    expect(store.outstanding(SCENARIO, 'user-a')).toEqual([]);
    expect(p.writes).toEqual([]);
  });

  it('⛔ in a mixed set, the ambiguous item gets NO op; the rest is proposed, and the approval says what was left out', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Churn', value: 0.08, unit: '', basis: 'the user said 8%' },
        { factor_label: 'Price', value: 0.6, unit: '', basis: 'the user said 0.6' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual(['price']);
    expect(candidateIds(r)).toEqual([['Churn', ['churn_pricing', 'churn_support']]]);
    expect(String(r.public_label)).toContain('more than one entity is called this');
    expect(String(r.public_label)).toContain('"Churn"');

    const applied = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.writes).toEqual([{ kind: 'factor_value_edit', target: 'price' }]);
  });

  it('⭐ CONTROL: a label shared by a factor and a RISK still resolves to the one writable factor', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Price', value: 0.6, unit: '', basis: 'b' }] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.ambiguous_targets).toBeUndefined();
    expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual(['price']);
  });
});

describe('(v) a node id disambiguates, and the write goes to exactly that node', () => {
  it('⭐ the id of the SECOND "Churn" writes the second, never the first', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, {
      // `revise` is a tool argument the capability type does not declare yet (see agent-tools.ts).
      assumptions: [{ factor_label: 'churn_support', value: 0.07, unit: '', basis: 'the user chose support churn', revise: true }],
    } as never);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual(['churn_support']);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(p.writes).toEqual([{ kind: 'factor_value_edit', target: 'churn_support' }]);
  });
});

describe('the same rule on the level and link proposers', () => {
  it('⛔ a level on a shared factor label is left out as ambiguous, with both candidates', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Raise price', factor_label: 'Churn', value: 0.2, basis: 'b' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(candidateIds(r)).toEqual([['Churn', ['churn_pricing', 'churn_support']]]);
    expect((r.levels_not_accepted as { reason: string }[]).map((x) => x.reason)).toEqual([
      expect.stringMatching(/^More than one factor "Churn" is in the model, so this level was left out\./),
    ]);
    expect(p.writes).toEqual([]);
  });

  it('⭐ and the factor id resolves it to that node', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, {
      interventions: [{ option_label: 'Raise price', factor_label: 'churn_support', value: 0.2, basis: 'b' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(store.get(String(r.proposal_id))!.operations.map((o) => o.path)).toEqual(['raise::churn_support']);
  });

  it('⛔ a link to a shared label is refused as ambiguous, with nothing proposed', async () => {
    const p = product();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeModelChange(ctx, { from_label: 'Price', to_label: 'Churn', direction: 'positive', rationale: 'r' });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('ambiguous_entity');
    // 'Price' is a factor AND a risk: both are valid link ends, so it is ambiguous too.
    expect(candidateIds(r)).toEqual([['Price', ['price', 'risk_price']], ['Churn', ['churn_pricing', 'churn_support']]]);
    expect(store.outstanding(SCENARIO, 'user-a')).toEqual([]);
  });

  it('⛔ a starting point carries the ambiguity to the joined result', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Churn', value: 0.08, unit: '', basis: 'b' }, { factor_label: 'Price', value: 0.6, unit: '', basis: 'b' }],
      option_levels: [],
    });
    expect(candidateIds(r as Record<string, unknown>)).toEqual([['Churn', ['churn_pricing', 'churn_support']]]);
    expect(p.writes).toEqual([]);
  });
});
