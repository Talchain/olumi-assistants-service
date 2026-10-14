/**
 * SCI-DEEP v1 — which links "Test without this link" may remove (graph facts only), on the REAL bank-2 model A graph
 * (decision + options + factors + a product identity MRR = price x subscribers), plus the noise verdicts it relies on.
 * Rule evidence: programme-docs output/sci-deep-20261003 (P-b root semantics; live p4 0.87 -> 0.55 constraint jump).
 */
import { describe, expect, it } from 'vitest';

import { graphWithoutLink, readStructuralChallengeEdge, reachableFrom, structuralChallengeEligibility } from '../structural-challenge-eligibility.js';
import { leadNoise, meanChangeNoise, proportionChangeNoise, wilsonInterval } from '../structural-challenge-noise.js';
import A_GRAPH from './fixtures/sci-deep-bank2/A-graph.json';

const G = A_GRAPH.graph;
const link = (from_id: string, to_id: string) => ({ from_id, to_id });

describe('SCI-DEEP eligibility (graph facts only)', () => {
  it.each([
    [{ from: 'a', to: 'b' }, link('a', 'b')],
    [{ from_id: 'a', to_id: 'b' }, link('a', 'b')],
    [{ from: 'a', to_id: 'b' }, link('a', 'b')],
    [{ from: null, from_id: 'a', to: 'b' }, link('a', 'b')],
    [{ from: 'a', from_id: 'other', to: 'b' }, link('a', 'b')],
    [{ from: '', from_id: 'a', to: 'b' }, null],
    [{ from: 7, from_id: 'a', to: 'b' }, null],
    [null, null],
    [[], null],
  ])('the shared route and eligibility edge reader honours endpoint precedence: %j', (edge, expected) => {
    expect(readStructuralChallengeEdge(edge)).toEqual(expected);
  });

  it('recorded endpoint shapes retain eligibility, reachability and bidirected refusal', () => {
    const graph = { ...G, edges: G.edges.map(({ from, to, ...edge }) => ({ ...edge, from_id: from, to_id: to })) };
    const selected = link('monthly_churn', 'paying_subscribers');
    const recorded = structuralChallengeEligibility(graph, selected);
    expect(recorded).toEqual(structuralChallengeEligibility(G, selected));
    expect(recorded.eligible).toBe(true);
    if (recorded.eligible) expect([...recorded.reachable].sort()).toEqual(['mrr', 'paying_subscribers']);
    const bi = { ...graph, edges: [{ from_id: 'a', to_id: 'b', edge_type: 'bidirected' }] };
    expect(structuralChallengeEligibility(bi, link('a', 'b'))).toEqual({ eligible: false, reason: 'bidirected_link' });
  });

  it('admits a causal link whose target keeps another parent, and returns what it can reach', () => {
    const e = structuralChallengeEligibility(G, link('monthly_churn', 'paying_subscribers'));
    expect(e.eligible).toBe(true);
    if (e.eligible) expect([...e.reachable].sort()).toEqual(['mrr', 'paying_subscribers']);
  });

  it.each([
    ['link_not_found', link('mrr', 'monthly_churn')],
    ['option_wiring_link', link('raise_pro_price_to_59', 'pro_plan_price')],
    ['option_wiring_link', link('should_we_raise_our_pro_plan_price_from_49_to_59_a_month', 'status_quo')],
    ['identity_participant_link', link('paying_subscribers', 'mrr')],
    ['identity_participant_link', link('pro_plan_price', 'mrr')],
    ['target_becomes_root', link('pro_plan_price', 'monthly_churn')], // churn's only causal parent: P-b / live p4
  ])('refuses %s', (reason, l) => {
    expect(structuralChallengeEligibility(G, l)).toEqual({ eligible: false, reason });
  });

  it('refuses a bidirected annotation, and an extra (non-participant) edge into an identity', () => {
    const withBi = { ...G, edges: [...G.edges, { from: 'monthly_churn', to: 'new_paying_subscribers_per_month', edge_type: 'bidirected' }] };
    expect(structuralChallengeEligibility(withBi, link('new_paying_subscribers_per_month', 'monthly_churn'))).toEqual({ eligible: false, reason: 'bidirected_link' });
    const extra = { ...G, edges: [...G.edges, { from: 'monthly_churn', to: 'mrr' }] };
    expect(structuralChallengeEligibility(extra, link('monthly_churn', 'mrr'))).toEqual({ eligible: false, reason: 'anchored_identity_target' });
  });

  it('removes exactly that link and nothing else', () => {
    const out = graphWithoutLink(G, link('monthly_churn', 'paying_subscribers'));
    expect(out.edges.length).toBe(G.edges.length - 1);
    expect(out.edges.some((e: { from: string; to: string }) => e.from === 'monthly_churn' && e.to === 'paying_subscribers')).toBe(false);
    expect(out.nodes).toBe(G.nodes);
    expect(reachableFrom(out, 'monthly_churn').has('mrr')).toBe(false);
  });
});

describe('SCI-DEEP noise (independent-run form)', () => {
  it('uses the ONE proportion band away from certainty', () => {
    expect(proportionChangeNoise(0.62, 0.45, 10_000, 10_000)).toBe('signal');
    expect(proportionChangeNoise(0.5291, 0.5298, 10_000, 10_000)).toBe('within_noise'); // live p4 B minus new_paying
  });

  it('at an exact 0 or 1 falls back to Wilson disjointness, valid where the normal approximation is not', () => {
    expect(proportionChangeNoise(1, 0.5291, 10_000, 10_000)).toBe('signal');
    expect(proportionChangeNoise(1, 1, 10_000, 10_000)).toBe('within_noise');
    expect(proportionChangeNoise(0, 0.0003, 10_000, 10_000)).toBe('within_noise');
    expect(wilsonInterval(1, 10_000).low).toBeGreaterThan(0.999);
  });

  it('a near-tie lead is within noise; a clear lead is signal', () => {
    expect(leadNoise(0.8416, 0.1584, 10_000)).toBe('signal');
    expect(leadNoise(0.505, 0.495, 10_000)).toBe('within_noise');
  });

  it('means: 2 SE of the difference; float jitter on a deterministic outcome is not a difference', () => {
    expect(meanChangeNoise({ mean: 89733.4, sd: 685.9, n: 10_000 }, { mean: 83433.9, sd: 8230.7, n: 10_000 })).toBe('signal');
    expect(meanChangeNoise({ mean: 75000, sd: 2.4e-11, n: 10_000 }, { mean: 74999.99999999999, sd: 2.4e-11, n: 10_000 })).toBe('within_noise');
    expect(meanChangeNoise({ mean: 1, sd: 0, n: 10 }, { mean: 2, sd: 0, n: 10 })).toBe('signal');
  });
});
