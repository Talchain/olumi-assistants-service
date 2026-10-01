import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import served from './fixtures/m1-s1-served-graphs.json';
import { linkTargetOf, selectStrengthenPlaceholder } from '../guidance/select-strengthen-placeholder.js';
import { edgeBandFromMagnitude } from '../../format/edge-strength-bands.js';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';

type Edge = { from: string; to: string; strength?: { mean?: unknown }; provenance?: Record<string, unknown> };
type Node = { id: string; kind: string; label?: string; [k: string]: unknown };
type Graph = { nodes: Node[]; edges: Edge[] };
const caseOf = (id: string) => served.cases.find((c) => c.id === id)!;
const D1 = caseOf('D1-sprint-run');
const d1 = (): Graph => structuredClone(D1.graph) as unknown as Graph;
const AI = { from: 'sprint_capacity_for_ai_reporting', to: 'ai_reporting_module_availability' };
const INTEGRATION = { from: 'sprint_capacity_for_integration_fix', to: 'integration_step_bug_resolution' };
const edgeOf = (g: Graph, l: { from: string; to: string }) => g.edges.find((e) => e.from === l.from && e.to === l.to)!;
const pick = (g: Graph, options: readonly string[] = D1.current_run_option_ids, identity?: unknown[]) => {
  const t = selectStrengthenPlaceholder(g, options, identity);
  return t === null ? null : { from_id: t.from_id, to_id: t.to_id };
};
/** The approval writes: one-click Accept = Olumi's size, now chosen (`olumi_accepted`); Edit = the user's own. */
const accept = (g: Graph, l: { from: string; to: string }) => { edgeOf(g, l).provenance = { ...edgeOf(g, l).provenance, magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } }; return g; };
const estimate = (g: Graph, l: { from: string; to: string }) => { edgeOf(g, l).provenance = { ...edgeOf(g, l).provenance, magnitude: 'olumi_estimate' }; return g; };
const userSized = (g: Graph, l: { from: string; to: string }) => { edgeOf(g, l).provenance = { ...edgeOf(g, l).provenance, magnitude: 'user_stated' }; return g; };
const placeholder = (g: Graph, l: { from: string; to: string }) => { edgeOf(g, l).provenance = { ...edgeOf(g, l).provenance, magnitude: 'olumi_placeholder' }; return g; };

describe('M1 S1 target on served Run turns (RC contract a00cb9c8; expect = reference selector S1)', () => {
  it.each(served.cases)('$id → $expect', (c) => {
    const graph = structuredClone(c.graph);
    const before = JSON.stringify(graph);
    const target = selectStrengthenPlaceholder(graph, c.current_run_option_ids);
    expect(target === null ? null : { from_id: target.from_id, to_id: target.to_id }).toEqual(c.expect);
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('D1: the whole target — labels from the graph, band = the writer’s own band of |mean|', () => {
    const g = d1();
    const nodeLabel = (id: string) => g.nodes.find((n) => n.id === id)!.label;
    expect(selectStrengthenPlaceholder(g, D1.current_run_option_ids)).toEqual({
      variant: 'S1', from_id: AI.from, to_id: AI.to, from_label: nodeLabel(AI.from), to_label: nodeLabel(AI.to),
      band: edgeBandFromMagnitude(Math.abs(edgeOf(g, AI).strength!.mean as number)),
    });
    expect(selectStrengthenPlaceholder(g, D1.current_run_option_ids)!.band).toBe('moderate');
  });
  it('the band follows the stored |mean| on the writer’s cuts, sign ignored', () => {
    for (const [mean, band] of [[0.55, 'strong'], [-0.8, 'very strong'], [0.1, 'weak']] as const) {
      const g = d1();
      edgeOf(g, AI).strength = { mean };
      expect(selectStrengthenPlaceholder(g, D1.current_run_option_ids)!.band).toBe(band);
    }
  });
});

describe('strengthen ×2 (the investor script): each Accept moves the press to the next unsized link, then none', () => {
  it('Accept the first → the second; Accept both → null (the press keeps today’s answer)', () => {
    expect(pick(accept(d1(), AI))).toEqual({ from_id: INTEGRATION.from, to_id: INTEGRATION.to });
    expect(pick(accept(accept(d1(), AI), INTEGRATION))).toBeNull();
  });
  it('never S1: an ordinary Olumi estimate, an accepted one, or a user-sized link', () => {
    for (const write of [estimate, accept, userSized]) expect(pick(write(d1(), AI))).toEqual({ from_id: INTEGRATION.from, to_id: INTEGRATION.to });
  });
  it('an identity operand this Run evaluated is exempt (F1b’s rule, via identityEvaluations)', () => {
    const g = d1();
    Object.assign(g.nodes.find((n) => n.id === AI.to)!, { nonlinear_identity: { operation: 'product', factor_ids: [AI.from] } });
    expect(pick(g)).toEqual({ from_id: AI.from, to_id: AI.to });
    expect(pick(g, D1.current_run_option_ids, [{ node_id: AI.to, evaluated: true }])).toEqual({ from_id: INTEGRATION.from, to_id: INTEGRATION.to });
  });
  it('a link with no readable strength is skipped (the writer would refuse it)', () => {
    const g = d1();
    edgeOf(g, AI).strength = {};
    expect(pick(g)).toEqual({ from_id: INTEGRATION.from, to_id: INTEGRATION.to });
  });
});

describe('the current Run’s options only, nearest the goal first, then id', () => {
  it('a placeholder only on an option this Run did not analyse is never offered, even nearer the goal', () => {
    const g = d1();
    const template = g.nodes.find((n) => n.id === D1.current_run_option_ids[0])!;
    g.nodes.push({ ...structuredClone(template), id: 'excluded_option', label: 'Excluded option', interventions: { excluded_lever: 1 } } as Node,
      { id: 'excluded_lever', kind: 'factor', label: 'Excluded lever' });
    const goal = g.nodes.find((n) => n.kind === 'goal')!.id;
    g.edges.push({ from: 'excluded_option', to: 'excluded_lever', strength: { mean: 1 } },
      { from: 'excluded_lever', to: goal, strength: { mean: 0.25 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    expect(pick(g)).toEqual({ from_id: AI.from, to_id: AI.to });
    expect(pick(g, ['excluded_option'])).toEqual({ from_id: 'excluded_lever', to_id: goal });
    expect(pick(g, [])).toBeNull();
  });
  it('nearer wins over a smaller id; at equal distance the smaller id wins', () => {
    // `trial_profile_abandonment_rate → revenue_lost…` sits 1 link from the goal; its id sorts after `sprint_…` (2 away).
    const near = { from: 'trial_profile_abandonment_rate', to: 'revenue_lost_to_trial_abandonment' };
    expect(pick(placeholder(d1(), near))).toEqual({ from_id: near.from, to_id: near.to });
    const g = d1();
    const twin = { from: 'enterprise_prospect_signing_likelihood', to: 'quarterly_revenue' };
    const twin2 = { from: 'revenue_lost_to_trial_abandonment', to: 'quarterly_revenue' };
    expect(pick(placeholder(placeholder(g, twin2), twin))).toEqual({ from_id: twin.from, to_id: twin.to });
  });
  it('reads no leader, analysis or withheld field: it answers the same while leader naming is withheld', () => {
    const source = readFileSync(new URL('../guidance/select-strengthen-placeholder.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '');
    expect(source).not.toMatch(/leader|withheld|analysis|licen[cs]e|option_status/iu);
    expect(selectStrengthenPlaceholder.length).toBe(4);
  });
});

describe('linkTargetOf: ONE read of any link (T3’s method-turn card reads links through it too)', () => {
  it('an Olumi-estimated link the S1 picker never walks still gets its labels and the writer’s band', () => {
    const g = d1();
    const est = { from: 'ai_reporting_module_availability', to: 'enterprise_prospect_signing_likelihood' };
    expect(edgeOf(g, est).provenance?.magnitude).toBe('olumi_estimate');
    const label = (id: string) => g.nodes.find((n) => n.id === id)!.label;
    expect(linkTargetOf(g, est.from, est.to)).toEqual({ from_id: est.from, to_id: est.to, from_label: label(est.from), to_label: label(est.to), band: 'strong' });
    // A negative link: the band is of |mean| (−0.15 → weak).
    expect(linkTargetOf(g, 'integration_step_bug_resolution', 'trial_profile_abandonment_rate')!.band).toBe('weak');
  });
  it('no link, no readable mean, or a missing label → null; the S1 pick equals linkTargetOf on its link', () => {
    const g = d1();
    expect(linkTargetOf(g, AI.to, AI.from)).toBeNull();
    expect(linkTargetOf(null, AI.from, AI.to)).toBeNull();
    const noMean = d1(); edgeOf(noMean, AI).strength = {};
    expect(linkTargetOf(noMean, AI.from, AI.to)).toBeNull();
    const noLabel = d1(); delete noLabel.nodes.find((n) => n.id === AI.to)!.label;
    expect(linkTargetOf(noLabel, AI.from, AI.to)).toBeNull();
    expect(selectStrengthenPlaceholder(g, D1.current_run_option_ids)).toEqual({ variant: 'S1', ...linkTargetOf(g, AI.from, AI.to)! });
  });
});

describe('handoff: the target is exactly ONE propose_link_strengths call (HARNESS makes it; the helper writes nothing)', () => {
  it('one link, a band the tool accepts, labels as the state names them, no from_words', () => {
    const g = d1();
    const t = selectStrengthenPlaceholder(g, D1.current_run_option_ids)!;
    const tool = AGENT_TOOLS.find((x) => x.name === 'propose_link_strengths')!;
    const params = tool.parameters as { required: string[]; properties: { links: { maxItems: number; items: { required: string[]; properties: { strength: { enum: string[] } } } } } };
    const call = { links: [{ from_label: t.from_label, to_label: t.to_label, strength: t.band }] };
    expect(call.links).toHaveLength(1);
    for (const key of params.properties.links.items.required) expect(call.links[0]).toHaveProperty(key);
    expect(params.properties.links.items.properties.strength.enum).toContain(t.band);
    expect(call.links[0]).not.toHaveProperty('from_words');
    expect(g.nodes.map((n) => n.label)).toEqual(expect.arrayContaining([t.from_label, t.to_label]));
  });
});
