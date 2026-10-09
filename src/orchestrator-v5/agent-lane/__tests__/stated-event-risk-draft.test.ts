/** event_risk.v1 slice 2c — DRAFT door. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { scalingRatio, timingGated } from '../../../../tests/helpers/scaling-ratio.js';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { holdStatedEventRisks } from '../stated-event-risk-draft.js';
import { readStatedEventRisk } from '../../routing/stated-event-risk.js';
import { slugId } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Json = Record<string, any>;
type Node = Json & { id: string };
type Edge = Json & { from: string; to: string; id?: string };
type Graph = { nodes: Node[]; edges: Edge[] };
type ReviewDraftRow = {
  id: string; input: string; riskLabels: string[];
  expected: { riskLabel: string; pLow: number; pHigh: number; months: number } | null;
};
const fix3Review = JSON.parse(readFileSync(new URL('../../../../acceptance-evidence/impact-pct/review-rows-fix3.json', import.meta.url), 'utf8')) as { draftRows: ReviewDraftRow[] };
const PREFIX = "We're deciding between hiring contractors and training in-house. ";
const STATED = 'Our key developer might leave, chance is 10–30% in the next 6 months.';
const BRIEF = PREFIX + STATED;
const CONTROL = PREFIX + 'Our key developer might leave in the next 6 months.';
const BLOCK = {
  version: 1,
  occurrence: { p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' },
  horizon: { months: 6 },
};
const HELD_LINE = 'Held your stated likelihood for Key developer leaves: it may happen (about 10–30% within 6 months), as you wrote.';
const REFUSED_LINE = "Key developer leaves has a stated likelihood, but it has a cause in the model, so it's kept as an ordinary risk for now.";

function graph(): Graph {
  return {
    // Deliberately place the supplier first: assertions bind by id/label throughout.
    nodes: [
      { id: 'risk_supplier', kind: 'risk', label: 'Supplier fails', provenance: { source: 'brief' } },
      { id: 'outcome_delivery', kind: 'outcome', label: 'Delivery outcome' },
      { id: 'risk_dev', kind: 'risk', label: 'Key developer leaves' },
    ],
    edges: [
      { id: 'impact_dev', from: 'risk_dev', to: 'outcome_delivery', exists_probability: 0.7,
        defaulted: true, strength: { mean: -0.3, std: 0.15 }, provenance: { magnitude: 'olumi_placeholder' } },
      { id: 'impact_supplier', from: 'risk_supplier', to: 'outcome_delivery', exists_probability: 0.7, defaulted: true },
    ],
  };
}
const dev = (g: { nodes: readonly Json[] }) => g.nodes.find((n) => n.id === 'risk_dev')!;

// Same registration harness as construction-keeps-drafted-risks.test.ts, with a fixture drafter.
async function build(brief: string, cause = false): Promise<{ graph: Graph; out: Json }> {
  const link = (from: string, to: string, direction: 'positive' | 'negative') => ({
    from, to, direction, provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null,
  });
  // The drafter's raw JSON (nulls as a drafter writes them); the builder parses it, so it is not typed here.
  const candidate = {
    goal: { metric: 'Delivery', operator: '>=', target_stated: false, value: null, unit: null,
      horizon_months: null, provenance: 'inferred', baseline_known: false, baseline_value: null,
      baseline_provenance: null, scope: null },
    constraints: [],
    options: [
      { label: 'Hiring contractors', provenance: 'explicit', is_status_quo: false, changes: ['Delivery capacity'],
        interventions: [{ factor_label: 'Delivery capacity', value: 0.8, value_kind: 'absolute', unit: null, provenance: 'inferred' }] },
      { label: 'Training in-house', provenance: 'explicit', is_status_quo: false, changes: ['Delivery capacity'],
        interventions: [{ factor_label: 'Delivery capacity', value: 0.6, value_kind: 'absolute', unit: null, provenance: 'inferred' }] },
    ],
    factors: [{ label: 'Delivery capacity', role: 'controllable', baseline_known: false, baseline_value: null,
      unit: null, provenance: 'inferred', plausible_max: null }],
    risks: [{ label: 'Key developer leaves', provenance: 'explicit' }],
    outcomes: [{ label: 'Delivery outcome', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Delivery', 'positive'), link('Key developer leaves', 'Delivery outcome', 'negative'),
      link('Delivery outcome', 'Delivery', 'positive'), ...(cause ? [link('Delivery capacity', 'Key developer leaves', 'positive')] : [])],
    identities: [], unknowns: [],
  };
  let registered: unknown;
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('2c000000-0000-4000-8000-000000000001', brief, dispatch, call) as Json;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Graph, out };
}

describe('event_risk.v1 slice 2c', () => {
  it('fix3-late-failure-fragment: a long scaffold prefix never binds the preceding supplier to release slips', () => {
    const input = graph();
    input.nodes = input.nodes.filter((node) => node.id !== 'risk_dev');
    input.edges = input.edges.filter((edge) => edge.from !== 'risk_dev');
    const before = structuredClone(input);
    const brief = `Supplier fails, ${'maybe '.repeat(23)}30% within 6 months release slips.`;
    const result = holdStatedEventRisks(input.nodes, input.edges, brief);
    expect(result.held).toEqual([]);
    expect(result.refused).toEqual([]);
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(before);
    expect(result.nodes).toBe(input.nodes);
    expect(result.edges).toBe(input.edges);
    expect(input).toEqual(before);
  });

  it('fix3-late-failure-fragments-scaling: 2k to 20k, ratio < 20 for the drafter', () => {
    const input = graph();
    input.nodes = input.nodes.filter((node) => node.id !== 'risk_dev');
    input.edges = input.edges.filter((edge) => edge.from !== 'risk_dev');
    const fragment = `Supplier fails, ${'maybe '.repeat(23)}30% within 6 months release slips. `;
    const make = (n: number) => fragment.repeat(Math.ceil(n / fragment.length)).slice(0, n);
    const [small, large] = [make(2000), make(20000)];
    for (const brief of [small, large]) {
      const result = holdStatedEventRisks(input.nodes, input.edges, brief);
      expect(result.held).toEqual([]);
      expect(result.refused).toEqual([]);
      expect(result.nodes).toBe(input.nodes);
      expect(result.edges).toBe(input.edges);
    }
    const m = scalingRatio(() => holdStatedEventRisks(input.nodes, input.edges, small),
      () => holdStatedEventRisks(input.nodes, input.edges, large));
    if (timingGated) { expect(m.ratio, m.detail).toBeLessThan(20); }
  });

  it.each(fix3Review.draftRows)('fix3-draft-$id: $input', (row) => {
    const input: Graph = {
      nodes: [
        ...row.riskLabels.map((label, i) => ({ id: `risk_${i}`, kind: 'risk', label,
          provenance: { source: 'brief' } })),
        { id: 'outcome_mrr', kind: 'outcome', label: 'MRR' },
      ],
      edges: row.riskLabels.map((_label, i) => ({ id: `impact_${i}`, from: `risk_${i}`, to: 'outcome_mrr',
        exists_probability: 0.7, defaulted: true, strength: { mean: -0.3, std: 0.15 },
        provenance: { magnitude: 'olumi_placeholder' } })),
    };
    const before = structuredClone(input);
    const result = holdStatedEventRisks(input.nodes, input.edges, row.input);
    expect(input).toEqual(before);
    expect(result.refused).toEqual([]);
    if (row.expected === null) {
      expect(result.held).toEqual([]);
      expect({ nodes: result.nodes, edges: result.edges }).toEqual(before);
      expect(result.nodes).toBe(input.nodes);
      expect(result.edges).toBe(input.edges);
      for (const node of result.nodes) expect(node.event_risk).toBeUndefined();
    } else {
      const expected = row.expected;
      const risk = result.nodes.find((node) => node.label === expected.riskLabel)!;
      expect(risk.event_risk).toEqual({ version: 1, occurrence: {
        p_low: expected.pLow, p_high: expected.pHigh, basis: 'user',
        meaning: 'at_least_once_within_horizon',
      }, horizon: { months: expected.months } });
      expect(result.held).toHaveLength(1);
      expect(result.held[0].risk_id).toBe(risk.id);
      expect(row.input).toContain(result.held[0].quote);
      for (const node of result.nodes) {
        if (node.id !== risk.id) expect(node).toBe(input.nodes.find((original) => original.id === node.id));
      }
      for (const edge of result.edges) {
        const original = input.edges.find((candidate) => candidate.id === edge.id)!;
        if (edge.from === risk.id) expect(edge).toEqual({ ...original, exists_probability: 1 });
        else expect(edge).toBe(original);
      }
    }
  });

  it('2c-POSITIVE: stated range and horizon held; impact keeps its placeholder', () => {
    const input = graph();
    input.nodes = input.nodes.filter((n) => n.id !== 'risk_supplier');
    const before = structuredClone(input);
    const result = holdStatedEventRisks(input.nodes, input.edges, BRIEF);
    expect(dev(result).event_risk).toEqual(BLOCK);
    expect(dev(result).event_risk).toEqual(readStatedEventRisk(STATED)!.event_risk);
    expect(result.held).toEqual([{ risk_id: 'risk_dev', quote: '10–30% in the next 6 months' }]);
    expect(result.refused).toEqual([]);
    expect(result.edges.find((e) => e.id === 'impact_dev')).toEqual({ ...before.edges.find((e) => e.id === 'impact_dev'), exists_probability: 1 });
    expect(input).toEqual(before);
  });

  it('2c-CONTROL-no-number: input bytes and references unchanged', () => {
    const input = graph();
    const result = holdStatedEventRisks(input.nodes, input.edges, CONTROL);
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(input);
    expect(JSON.stringify({ nodes: result.nodes, edges: result.edges })).toBe(JSON.stringify(input));
    expect(result.nodes).toBe(input.nodes);
    expect(result.edges).toBe(input.edges);
    expect(result.held).toEqual([]);
    expect(result.refused).toEqual([]);
  });

  it('2c-CONTROL-two-risks: only the named developer is held', () => {
    const input = graph();
    const result = holdStatedEventRisks(input.nodes, input.edges, BRIEF);
    expect(dev(result).event_risk).toEqual(BLOCK);
    const supplier = input.nodes.find((n) => n.id === 'risk_supplier')!;
    expect(result.nodes.find((n) => n.id === supplier.id)).toBe(supplier);
    expect(JSON.stringify(result.nodes.find((n) => n.id === supplier.id))).toBe(JSON.stringify(supplier));
    expect(result.edges.find((e) => e.id === 'impact_supplier')).toBe(input.edges.find((e) => e.id === 'impact_supplier'));
  });

  it.each([
    ['ambiguous', 'Our key developer might leave or our supplier fails, maybe 10–30% in the next 6 months.'],
    ['unnamed', 'Something might happen, maybe 10–30% in the next 6 months.'],
    ['partial-name', 'Our developer might leave, maybe 10–30% in the next 6 months.'],
    ['no-horizon', 'Our key developer might leave, maybe 10–30%.'],
    ['two-sentences', 'Our key developer might leave, maybe 10–30% in the next 6 months. Our key developer might leave, maybe 40% within a year.'],
  ])('2c-REFUSAL-%s: nothing bound', (_id, brief) => {
    const input = graph();
    const result = holdStatedEventRisks(input.nodes, input.edges, brief);
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(input);
    expect(result.held).toEqual([]);
    expect(result.refused).toEqual([]);
  });

  it('2c-REFUSAL-cause-link: incoming factor prevents stamping; edges unchanged', () => {
    const input = graph();
    input.nodes.push({ id: 'factor_workload', kind: 'factor', label: 'Workload' });
    input.edges.push({ id: 'cause', from: 'factor_workload', to: 'risk_dev', exists_probability: 0.6 });
    const result = holdStatedEventRisks(input.nodes, input.edges, BRIEF);
    expect(dev(result).event_risk).toBeUndefined();
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(input);
    expect(result.edges).toBe(input.edges);
    expect(result.held).toEqual([]);
    expect(result.refused).toEqual([{ risk_id: 'risk_dev', reason: 'has_cause_link' }]);
  });

  it('2c-LLM-figure: likelihood on the drafter node is never read', () => {
    const input = graph();
    dev(input).likelihood = 0.5;
    dev(input).probability = 0.5;
    const result = holdStatedEventRisks(input.nodes, input.edges, CONTROL);
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(input);
    expect(result.nodes.every((n) => n.event_risk === undefined)).toBe(true);
    expect(result.held).toEqual([]);
  });

  it('2c-decimal-sentence: hedge-only decimal figure holds no likelihood', () => {
    const input = graph();
    // DL ruling 8 Oct: explicit likelihood words only
    const result = holdStatedEventRisks(input.nodes, input.edges, 'Our key developer leaves: maybe 12.5% within 6 months.');
    expect(dev(result).event_risk).toBeUndefined();
    expect(result.held).toEqual([]);
    expect(result.refused).toEqual([]);
    expect(result.nodes).toBe(input.nodes);
    expect(result.edges).toBe(input.edges);
  });

  it('2c-bare-percent-refused: an uncued "<event>: N% within M months" holds no likelihood (impact-% lease: fail closed)', () => {
    const input = graph();
    const result = holdStatedEventRisks(input.nodes, input.edges, 'Our key developer leaves: 12.5% within 6 months.');
    expect(dev(result).event_risk).toBeUndefined();
  });

  it.each([
    ['impact-window', "Release slips would cut MRR by 10% within 6 months; there's a 30% chance the supplier fails."],
    ['supplier-window', "Release slips would cut MRR by 10%; there's a 30% chance the supplier fails within 6 months."],
  ])('FIX-1-wrong-risk-%s: supplier likelihood never stamps Release slips or changes its impact edge', (_id, brief) => {
    const input = {
      nodes: [
        { id: 'risk_release', kind: 'risk', label: 'Release slips' },
        { id: 'outcome_mrr', kind: 'outcome', label: 'MRR' },
      ],
      edges: [{ id: 'impact_release', from: 'risk_release', to: 'outcome_mrr', exists_probability: 0.7,
        defaulted: true, strength: { mean: -0.3, std: 0.15 }, provenance: { magnitude: 'olumi_placeholder' } }],
    };
    const before = structuredClone(input);
    const result = holdStatedEventRisks(input.nodes, input.edges, brief);
    expect(result.nodes.find((node) => node.id === 'risk_release')!.event_risk).toBeUndefined();
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(before);
    expect(result.nodes).toBe(input.nodes);
    expect(result.edges).toBe(input.edges);
    expect(result.held).toEqual([]);
    expect(result.refused).toEqual([]);
    expect(input).toEqual(before);
  });

  it('r2-comma-two-names: a clause naming two risks stamps neither (Codex #2828 r2 P1-1)', () => {
    const input = {
      nodes: [
        { id: 'risk_supplier', kind: 'risk', label: 'Supplier fails' },
        { id: 'risk_release', kind: 'risk', label: 'Release slips' },
        { id: 'outcome_mrr', kind: 'outcome', label: 'MRR' },
      ],
      edges: [
        { id: 'impact_supplier', from: 'risk_supplier', to: 'outcome_mrr', exists_probability: 0.7 },
        { id: 'impact_release', from: 'risk_release', to: 'outcome_mrr', exists_probability: 0.7 },
      ],
    };
    const before = structuredClone(input);
    const result = holdStatedEventRisks(input.nodes, input.edges, 'Supplier fails, unlike Release slips, has a 30% chance within 6 months.');
    expect(result.held).toEqual([]);
    expect({ nodes: result.nodes, edges: result.edges }).toEqual(before);
  });

  it('FIX-1-supplier-own-clause: supplier likelihood holds only its named risk', () => {
    const input = graph();
    input.nodes.push({ id: 'risk_release', kind: 'risk', label: 'Release slips' });
    input.edges.push({ id: 'impact_release', from: 'risk_release', to: 'outcome_delivery', exists_probability: 0.7 });
    const brief = "Release slips would cut MRR by 10%; there's a 30% chance the supplier fails within 6 months.";
    const result = holdStatedEventRisks(input.nodes, input.edges, brief);
    expect(result.nodes.find((node) => node.id === 'risk_supplier')!.event_risk).toEqual({
      ...BLOCK, occurrence: { ...BLOCK.occurrence, p_low: 0.3, p_high: 0.3 },
    });
    expect(result.held).toEqual([{ risk_id: 'risk_supplier', quote: '30% chance the supplier fails within 6 months' }]);
    expect(result.refused).toEqual([]);
    expect(result.nodes.find((node) => node.id === 'risk_release')).toBe(input.nodes.find((node) => node.id === 'risk_release'));
    expect(result.edges.find((edge) => edge.id === 'impact_release')).toBe(input.edges.find((edge) => edge.id === 'impact_release'));
    expect(result.edges.find((edge) => edge.id === 'impact_supplier')).toEqual({ ...input.edges.find((edge) => edge.id === 'impact_supplier'), exists_probability: 1 });
    expect(dev(result)).toBe(dev(input));
  });

  it('2c-REACHABILITY-positive: buildModelFromBrief holds the block and discloses the loss sentence', async () => {
    const result = await build(BRIEF);
    const risk = result.graph.nodes.find((n) => n.kind === 'risk' && n.label === 'Key developer leaves')!;
    expect(risk.id).toBe(slugId('Key developer leaves'));
    expect(risk.event_risk).toEqual(BLOCK);
    const impact = result.graph.edges.find((e) => e.from === risk.id)!;
    expect(impact.exists_probability).toBe(1);
    expect(impact.defaulted).toBe(true);
    expect(result.out.not_represented).toContain(HELD_LINE);
    const control = await build(CONTROL);
    expect(result.out.projected_field_count).toBe(control.out.projected_field_count + 1);
  });

  it('2c-REACHABILITY-control: no-number brief yields no event_risk anywhere', async () => {
    const result = await build(CONTROL);
    expect(result.graph.nodes.every((n) => n.event_risk === undefined)).toBe(true);
    expect(result.out.not_represented).not.toContain(HELD_LINE);
  });

  it('2c-REACHABILITY-cause: cause stays ordinary and its loss sentence is disclosed', async () => {
    const result = await build(BRIEF, true);
    const risk = result.graph.nodes.find((n) => n.kind === 'risk' && n.label === 'Key developer leaves')!;
    expect(result.graph.edges.some((e) => e.to === risk.id)).toBe(true);
    expect(risk.event_risk).toBeUndefined();
    expect(result.out.not_represented).toContain(REFUSED_LINE);
  });

  it.each([
    ['digits', (n: number) => `${'9'.repeat(n)} ${STATED}`],
    ['spaces', (n: number) => `Our key developer ${' '.repeat(n)}might leave, chance is 10–30% in the next 6 months.`],
    ['sentence-near-matches', (n: number) => `${'10- within. Key developer leaves! '.repeat(Math.ceil(n / 32)).slice(0, n)}. ${STATED}`],
  ])('2c-LINEAR TIME-%s: 5k to 40k, min of 7 calibrated batches, ratio < 22', (_id, make) => {
    const input = graph();
    const [small, large] = [make(5000), make(40000)];
    // A valid final statement ensures every shape reaches the new word matcher too.
    for (const text of [small, large]) expect(dev(holdStatedEventRisks(input.nodes, input.edges, text)).event_risk).toEqual(BLOCK);
    const m = scalingRatio(() => holdStatedEventRisks(input.nodes, input.edges, small), () => holdStatedEventRisks(input.nodes, input.edges, large));
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
    if (timingGated) { expect(m.ratio, m.detail).toBeLessThan(22); }
  });
});
