import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import type { GraphT } from '../../../schemas/graph.js';
import { admitCandidateLinks } from '../../../orchestrator-v5/agent-lane/admit-candidate.js';
import { placeholderGoalPaths } from '../../../orchestrator-v5/agent-lane/goal-certainty.js';
import { isPlaceholderLink, linkSizing } from '../link-sizing.js';
import { frameDefaultedLinks } from '../frame-defaulted-links.js';
import { legacyLeaderGoalLinks, unsizedLeaderGoalPaths } from '../../../orchestrator-v5/agent-lane/goal-certainty.js';
import { hypothesisEdgeValue } from '../../../orchestrator-v5/routing/add-option-transaction.js';
import { diffRunInputs } from '../../../orchestrator-v5/coaching/run-input-changes.js';
import { buildAddRiskTransaction } from '../../../orchestrator-v5/routing/add-risk-transaction.js';
import { transformEdgeToV3 } from '../../transforms/schema-v3.js';
import { enrichGraphWithFactors, enrichGraphWithFactorsAsync } from '../../factor-extraction/enricher.js';
import { placeholderPartsFinding, PLACEHOLDER_PARTS_REASON } from '../../../orchestrator/context/placeholder-parts.js';

const parityBytes = readFileSync(new URL('./fixtures/placeholder-licence-parity.json', import.meta.url));
const parity = JSON.parse(parityBytes.toString('utf8')) as Array<{ name: string; edge: unknown; placeholder: boolean }>;

describe('Science 393023 LICENCE (a)/(b), 7 Oct: one pure placeholder reader', () => {
  it('pins the byte-identical DGAI parity fixture', () => {
    expect(parity.length).toBeGreaterThanOrEqual(14);
    expect(createHash('sha256').update(parityBytes).digest('hex'))
      .toBe('67fd0050970378c46acd843f7b00424b954d547fabbd8a17b5ee9e3ba08f2ec9');
  });

  it.each(parity)('$name → placeholder=$placeholder', ({ edge, placeholder }) => {
    const before = structuredClone(edge);
    expect(isPlaceholderLink(edge)).toBe(placeholder);
    expect(edge).toEqual(before);
  });

  const options = ['ai_reporting_module_sprint', 'integration_bug_fix_sprint', 'continue_current_plan'];
  const prospect = { from: 'enterprise_prospect_signing_likelihood', to: 'quarterly_revenue' };
  const abandonment = { from: 'trial_profile_abandonment_rate', to: 'revenue_lost_to_trial_abandonment' };
  const revenue = { from: 'revenue_lost_to_trial_abandonment', to: 'quarterly_revenue' };
  const served = () => JSON.parse(readFileSync(new URL('../../../orchestrator-v5/handlers/__tests__/fixtures/sci-deep-fa027cf5-graph.json', import.meta.url), 'utf8')) as {
    nodes: Record<string, unknown>[];
    edges: Array<{ from: string; to: string; defaulted?: boolean; strength: { mean: number; std: number }; provenance?: { magnitude?: string } }>;
  };

  it('fa027 door constants name exactly the unsized actual-move links, with no legacy disclosure or writes', () => {
    const graph = served();
    const before = structuredClone(graph);
    expect(unsizedLeaderGoalPaths(graph, options)).toEqual([
      { option_id: options[0], links: [prospect] },
      { option_id: options[1], links: [abandonment, revenue] },
    ]);
    expect(legacyLeaderGoalLinks(graph, options)).toEqual([]);
    expect(graph).toEqual(before);
  });

  it('CONTROL: fa027 std 0.1 sizes remain legacy and disclose exactly those three links, without writes', () => {
    const graph = served();
    for (const edge of graph.edges) {
      if ([prospect, abandonment, revenue].some(link => link.from === edge.from && link.to === edge.to)) edge.strength.std = 0.1;
    }
    const before = structuredClone(graph);
    expect(unsizedLeaderGoalPaths(graph, options)).toEqual([]);
    expect(legacyLeaderGoalLinks(graph, options)).toEqual([prospect, revenue, abandonment]);
    expect(graph).toEqual(before);
  });
});

describe('new default-link producers and re-sizing receipts', () => {
  it.each(['positive', 'negative'] as const)('hypothesisEdgeValue tags a new %s default', direction => {
    expect(hypothesisEdgeValue('x', 'g', direction).provenance).toMatchObject({ magnitude: 'olumi_placeholder' });
  });

  it('buddy A RED: an authored spread retains frameless eligibility; only the whole door default is tagged', () => {
    const result = admitCandidateLinks([{ from: 'x', to: 'g', direction: 'positive', strength_std: 0.2, provenance: 'hypothesis' }]);
    expect(result.edges[0].provenance).toMatchObject({ mean_projected: true });
    expect(result.edges[0].provenance).not.toHaveProperty('magnitude');
    const graph = { nodes: [{ id: 'x', kind: 'factor', label: 'Capacity' }, { id: 'g', kind: 'goal', label: 'Revenue' }], edges: result.edges };
    const framed = frameDefaultedLinks(graph, 'x');
    expect(framed.sized).toEqual([]);
    expect(framed.graph.edges[0].strength.std).toBe(0.2);
    expect(admitCandidateLinks([{ from: 'x', to: 'g', direction: 'positive', provenance: 'hypothesis' }]).edges[0].provenance)
      .toMatchObject({ mean_projected: true, magnitude: 'olumi_placeholder' });
  });

  const taggedGraph = () => ({
    nodes: [{ id: 'x', kind: 'factor', label: 'Capacity' }, { id: 'g', kind: 'goal', label: 'Revenue' }],
    edges: [{
      from: 'x', to: 'g', strength: { mean: 0.5, std: 0.125 }, defaulted: true,
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' },
    }],
  });

  it('a tagged door link with no level frame returns the same edge and no false re-sizing receipt', () => {
    const graph = taggedGraph();
    const before = structuredClone(graph);
    const result = frameDefaultedLinks(graph, 'x');
    expect(result.sized).toEqual([]);
    expect(result.graph).toBe(graph);
    expect(result.graph.edges[0]).toBe(graph.edges[0]);
    expect(graph).toEqual(before);
  });

  it('CONTROL: a tagged scaled natural effect still falls back and writes its projected default', () => {
    const graph = taggedGraph();
    const naturalEffect = { amount: 2, amount_unit: 'GBP', per_source_change: 1, per_source_change_unit: 'people', strength_mean: 0.2, strength_mean_frame: 'edge_strength' };
    const edge = { ...graph.edges[0], strength: { mean: 0.2, std: 0.05 },
      provenance: { ...graph.edges[0].provenance, natural_effect: naturalEffect } };
    const input = { ...graph, edges: [edge] };
    const before = structuredClone(input);
    const result = frameDefaultedLinks(input, 'x');
    expect(result.sized).toEqual(['x::g']);
    expect(result.graph.edges[0]).not.toBe(edge);
    expect(result.graph.edges[0]).toEqual({ ...edge, strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', mean_projected: true } });
    expect(input).toEqual(before);
  });
});

describe('stored Run inputs across the reader change', () => {
  // Same recorded shape as sc24-run-input-delta.test.ts, including residual and goal-level coverage.
  const snapshot = (sizing: 'unmarked' | 'placeholder', authorshipDigest?: string): RunInputSnapshot => ({
    snapshot_version: 1, sent_digest: 'a'.repeat(64), residual_digest: 'c'.repeat(64),
    goal: { node_id: 'goal_mrr', label: 'Pro MRR', target_raw: 55000, unit: 'GBP per month', operator: '>=' },
    options: [
      { option_id: 'opt-a', label: 'Raise price', settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 59, unit: 'GBP', encoded: 59 }] },
      { option_id: 'opt-b', label: 'Hold', is_baseline: true, settings: [{ factor_id: 'fac_price', label: 'Pro price', raw: 49, unit: 'GBP', encoded: 49, held: true }] },
    ],
    options_not_sent: [], constraints: [],
    factors: [{ factor_id: 'fac_churn', label: 'Monthly churn', raw: 3.7, unit: '%', encoded: 0.037, source: 'user_override' }, { factor_id: 'goal_mrr' }],
    links: [{ from: 'fac_price', to: 'fac_churn', mean: 0.5, std: 0.125, sizing,
      ...(authorshipDigest !== undefined ? { authorship_digest: authorshipDigest } : {}) }],
  });

  it.each([['unmarked', 'placeholder'], ['placeholder', 'unmarked']] as const)(
    '%s → %s with identical defined authorship is a reader change, complete with no sizing row', (prior, current) => {
      const result = diffRunInputs(snapshot(prior, 'd'.repeat(64)), snapshot(current, 'd'.repeat(64)));
      expect(result.rows.some(row => row.field === 'sizing')).toBe(false);
      expect(result).toEqual({ rows: [], complete: true });
    },
  );

  it('buddy B RED: the same authorship digest cannot hide a sizing class change when size moves', () => {
    const current = snapshot('unmarked', 'd'.repeat(64));
    current.links[0].mean = 0.4;
    current.links[0].std = 0.1;
    const result = diffRunInputs(snapshot('placeholder', 'd'.repeat(64)), current);
    expect(result.rows).toContainEqual({ entity_kind: 'link', entity_id: 'fac_price->fac_churn',
      link: { from: 'fac_price', to: 'fac_churn' }, field: 'sizing', before: { raw: 'placeholder' }, after: { raw: 'unmarked' }, change: 'changed' });
  });

  it('CONTROL: different authorship digests keep the sizing row and existing partial coverage', () => {
    const result = diffRunInputs(snapshot('unmarked', 'd'.repeat(64)), snapshot('placeholder', 'e'.repeat(64)));
    expect(result.rows).toContainEqual({ entity_kind: 'link', entity_id: 'fac_price->fac_churn',
      link: { from: 'fac_price', to: 'fac_churn' }, field: 'sizing', before: { raw: 'unmarked' }, after: { raw: 'placeholder' }, change: 'changed' });
    expect(result.complete).toBe(false);
  });

  it('CONTROL: absent authorship digests cannot suppress the sizing row', () => {
    expect(diffRunInputs(snapshot('unmarked'), snapshot('placeholder')).rows.some(row => row.field === 'sizing')).toBe(true);
  });
});

describe('DL 19:0xZ: the "+" Risk / Option door is a producer in this class', () => {
  // SERVED, stored at 19:03:56Z on staging (guest scenario 5e2c6de9, UI edaa174c, "+" → Risk → Add → Approve), copied
  // byte-for-byte from the stored graph: the add-risk door's two links, written before this change with no tag.
  const served = [
    { from: 'risk_starter_uptake_arrives_too_late', to: 'starter_plan_mrr', strength: { std: 0.125, mean: -0.5 }, defaulted: true, provenance: { source: 'cee_hypothesis' } },
    { from: 'starter_plan_paying_subscribers', to: 'risk_starter_uptake_arrives_too_late', strength: { std: 0.125, mean: -0.5 }, defaulted: true, provenance: { source: 'cee_hypothesis' } },
  ];
  it.each(served)('SERVED 5e2c6de9 $from → $to (untagged door constant) reads as a placeholder', (edge) => {
    expect(isPlaceholderLink(edge)).toBe(true);
  });
  it('CONTROL: the same scenario\'s sized Olumi estimate into the risk stays an estimate', () => {
    expect(isPlaceholderLink({ from: 'starter_plan_paying_subscribers', to: 'mrr_lost_to_starter_plan_cannibalisation', strength: { std: 0.1, mean: 0.2 }, defaulted: true,
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 20, amount_unit: 'currency/month', strength_mean: 0.2, per_source_change: 1, strength_mean_frame: 'edge_strength', per_source_change_unit: 'subscribers' } } })).toBe(false);
  });
  it('the add-risk door (buildAddRiskTransaction) now writes every new link tagged olumi_placeholder', () => {
    const view = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue' }, { id: 'share', kind: 'outcome', label: 'Market share' },
        { id: 'price', kind: 'factor', label: 'Price' },
      ],
      edges: [{ from: 'price', to: 'share' }, { from: 'share', to: 'goal' }],
    };
    const r = buildAddRiskTransaction({ risk: { label: 'Competitive response' }, links: [{ from_id: 'price', effect_direction: 'positive' }, { to_id: 'goal', effect_direction: 'negative' }] }, view);
    if (!r.matched) throw new Error(`add-risk refused: ${r.reason}`);
    const links = r.proposal.operations.filter(o => o.op === 'add_edge').map(o => o.value as Record<string, any>);
    expect(links.map(l => `${l.from}->${l.to}`)).toEqual(['price->risk_competitive_response', 'risk_competitive_response->goal']);
    for (const l of links) {
      expect(l.provenance).toEqual({ source: 'cee_hypothesis', magnitude: 'olumi_placeholder' });
      expect(isPlaceholderLink(l)).toBe(true);
    }
  });
});

it('buddy C RED: both stored MC walks agree: d2 empty and d1/d3 door paths retained', () => {
  for (const d of [1, 2, 3]) {
    const graph = JSON.parse(readFileSync(new URL(`../../../orchestrator-v5/admission/__tests__/fixtures/mc-p0/draw${d}.json`, import.meta.url), 'utf8'));
    const ids = graph.nodes.filter((n: { kind: string }) => n.kind === 'option').map((n: { id: string }) => n.id);
    const expectedLinks = d === 1 ? [{ from: 'starter_support_cost', to: 'mrr_lost_to_starter_support_burden' }]
      : [{ from: 'starter_monthly_price', to: 'starter_tier_monthly_recurring_revenue' }, { from: 'starter_subscribers', to: 'starter_tier_monthly_recurring_revenue' }];
    const ordered = (paths: ReturnType<typeof placeholderGoalPaths>) => paths.map(p => ({ ...p, links: [...p.links].sort((a, b) => a.from.localeCompare(b.from)) }));
    expect(ordered(placeholderGoalPaths(graph, ids))).toEqual(d === 2 ? [] : [{ option_id: 'launch_starter_tier', links: expectedLinks }]);
    expect(ordered(unsizedLeaderGoalPaths(graph, ids))).toEqual(ordered(placeholderGoalPaths(graph, ids)));
  }
});

describe('Science 393023 LICENCE r4: V1 transform door', () => {
  it('V1 with no strength_mean or weight writes defaulted and the placeholder tag', () => {
    const { edge } = transformEdgeToV3({ from: 'x', to: 'g' }, 0, []);
    expect(edge.defaulted).toBe(true);
    expect(edge.provenance).toEqual({ source: 'cee_hypothesis', magnitude: 'olumi_placeholder' });
    expect(isPlaceholderLink(edge)).toBe(true);
  });

  it('CONTROL: V1 authored strength_mean 0.5 has no defaulted or tag and is not a placeholder', () => {
    const { edge } = transformEdgeToV3({ from: 'x', to: 'g', strength_mean: 0.5 }, 0, []);
    expect(edge).not.toHaveProperty('defaulted');
    expect(edge.provenance?.magnitude).toBeUndefined();
    expect(isPlaceholderLink(edge)).toBe(false);
    expect(linkSizing(edge)).toBe('unmarked');
  });

  it('CONTROL: V1 authored strength_mean 0.5 with user_specified remains user sized', () => {
    const { edge } = transformEdgeToV3({ from: 'x', to: 'g', strength_mean: 0.5,
      provenance: { source: 'user_specified' } }, 0, []);
    expect(linkSizing(edge)).toBe('user');
  });
});

describe('Science 393023 LICENCE r4: both factor-enricher doors', () => {
  // Real CREATE fixture and brief from factor-extraction/__tests__/range-scale-derivation.test.ts.
  const input = (): GraphT => ({
    nodes: [{ id: 'goal-1', kind: 'outcome', label: 'Reach £30k MRR', data: {} }], edges: [],
  } as unknown as GraphT);
  const brief = "We're budgeting £80-120k for the first hire.";
  const toV3 = (edge: Parameters<typeof transformEdgeToV3>[0]) => transformEdgeToV3(
    edge, 0, input().nodes.map(({ id, kind, label }) => ({ id, kind, label })),
  ).edge;

  async function newDoorEdge(writer: 'sync' | 'async') {
    const graph = input();
    // Exercise the async writer deterministically through its regex path, with no LLM request.
    vi.stubEnv('CEE_LLM_FIRST_EXTRACTION_ENABLED', 'false');
    try {
      const result = writer === 'sync' ? enrichGraphWithFactors(graph, brief)
        : await enrichGraphWithFactorsAsync(graph, brief);
      expect(result.factorsAdded).toBe(1);
      expect(graph.edges).toEqual([]);
      expect(result.graph.nodes.find(n => n.id === 'factor_budget_0')).toMatchObject({ kind: 'factor', label: 'Budget' });
      const edge = result.graph.edges.find(e => e.from === 'factor_budget_0' && e.to === 'goal-1');
      expect(edge, 'new factor_budget_0 → goal-1 connecting edge').toBeDefined();
      return edge!;
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it.each(['sync', 'async'] as const)('%s enricher tags the new 0.5/0.2 default and V3 preserves the tag', async writer => {
    const edge = await newDoorEdge(writer);
    expect(edge.defaulted).toBe(true);
    expect(edge.strength_mean).toBe(0.5);
    expect(edge.strength_std).toBe(0.2);
    expect(edge.provenance).toMatchObject({ magnitude: 'olumi_placeholder' });
    const transformed = toV3(edge);
    expect(transformed.defaulted).toBe(true);
    expect(transformed.strength).toEqual({ mean: 0.5, std: 0.2 });
    expect(transformed.provenance).toMatchObject({ magnitude: 'olumi_placeholder' });
    expect(isPlaceholderLink(transformed)).toBe(true);
  });

  it.each(['sync', 'async'] as const)('CONTROL: %s enricher edge without the tag is still a 0.5/0.2 door placeholder', async writer => {
    const transformed = toV3(await newDoorEdge(writer));
    delete transformed.provenance!.magnitude;
    expect(transformed.defaulted).toBe(true);
    expect(linkSizing(transformed)).toBe('placeholder');
    expect(isPlaceholderLink(transformed)).toBe(true);
  });

  it.each(['sync', 'async'] as const)('CONTROL: %s enricher edge without the tag or defaulted is unmarked', async writer => {
    const transformed = toV3(await newDoorEdge(writer));
    delete transformed.provenance!.magnitude;
    delete transformed.defaulted;
    expect(linkSizing(transformed)).toBe('unmarked');
    expect(isPlaceholderLink(transformed)).toBe(false);
  });
});

describe('Science 393023 LICENCE r4: ruling 1 precedence and placeholder-parts agreement', () => {
  it('mean_projected with olumi_estimate and natural_effect fails closed as placeholder', () => {
    const edge = { from: 'x', to: 'g', strength: { mean: 0.2, std: 0.05 },
      provenance: { mean_projected: true, magnitude: 'olumi_estimate', natural_effect: {
        amount: 2, amount_unit: 'GBP', per_source_change: 1, per_source_change_unit: 'people',
        strength_mean: 0.2, strength_mean_frame: 'edge_strength',
      } } };
    expect(linkSizing(edge)).toBe('placeholder');
  });

  it('user_specified with mean_projected is placeholder', () => {
    expect(linkSizing({ from: 'x', to: 'g', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'user_specified', mean_projected: true } })).toBe('placeholder');
  });

  it('CONTROL: user_stated with mean_projected remains user sized', () => {
    expect(linkSizing({ from: 'x', to: 'g', strength: { mean: 0.5, std: 0.125 },
      provenance: { magnitude: 'user_stated', mean_projected: true } })).toBe('user');
  });

  it('the same user_specified + mean_projected edge is not the user\'s in placeholder-parts and is placeholder in licence', () => {
    const edge = { from: 'price', to: 'churn', strength: { mean: 0.5, std: 0.125 }, defaulted: true,
      provenance: { source: 'user_specified', mean_projected: true } };
    const nodes = [{ id: 'price', kind: 'factor', label: 'Price' }, { id: 'churn', kind: 'factor', label: 'Churn' }];
    const before = structuredClone(edge);
    expect(placeholderPartsFinding('churn', nodes, [edge], [{ interventions: { price: 59 } }]))
      .toEqual({ reason: PLACEHOLDER_PARTS_REASON, partId: 'price' });
    expect(linkSizing(edge)).toBe('placeholder');
    expect(edge).toEqual(before);
  });
});

describe('Science 393023 LICENCE (b), buddy r2 P1: the V1 door tags only a size nobody stated', () => {
  it('no mean but a STATED spread → no tag, no defaulted, not a placeholder (the spread is never re-sized); CONTROL: no spread → tagged', () => {
    const stated = transformEdgeToV3({ from: 'x', to: 'g', strength_std: 0.3, provenance: { source: 'cee_hypothesis' } } as never, 0, []).edge as Record<string, any>;
    expect(stated.strength.std).toBe(0.3);
    expect(stated.defaulted).toBeUndefined();
    expect(stated.provenance?.magnitude).toBeUndefined();
    expect(isPlaceholderLink(stated)).toBe(false);
    const bare = transformEdgeToV3({ from: 'x', to: 'g', provenance: { source: 'cee_hypothesis' } } as never, 0, []).edge as Record<string, any>;
    expect(bare.defaulted).toBe(true);
    expect(bare.provenance.magnitude).toBe('olumi_placeholder');
  });
});
