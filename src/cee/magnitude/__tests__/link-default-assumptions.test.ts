import { describe, expect, it } from 'vitest';
import { linkDefaultAssumptionsOf, readLinkDefaultAssumptions } from '../link-default-assumptions.js';
import { d3Run, ILLUSTRATIVE } from '../../../orchestrator-v5/path-b/tools/__tests__/d3-defaults-fixture.js';
import { withGoalChanceLicence } from '../../../orchestrator-v5/goal-target/goal-chance-licence.js';
import { runFactsOf } from '../../../orchestrator-v5/agent-lane/run-facts.js';

type Json = Record<string, any>;
const licenceOf = (result: Json): Json => result.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');

describe('evaluated default ledger, independent of point authorship', () => {
  it('carries each original admission entry once, including its explicit field source', () => {
    const f = d3Run('orders');
    for (const edge of f.graph.edges.filter((e: Json) => e.provenance?.uncertainty_defaults)) {
      for (const row of edge.provenance.uncertainty_defaults) expect(f.loss.filter(l => l.field_path === row.field_path)).toEqual([row]);
      expect(linkDefaultAssumptionsOf(edge)).toEqual(edge.provenance.uncertainty_defaults);
    }
  });

  it('coincident defaults, a different entity, superseded values and malformed ledgers grant no attribution', () => {
    const f = d3Run('orders');
    const edge = f.graph.edges.find((e: Json) => e.provenance?.uncertainty_defaults)!;
    expect(edge, 'fixture must exercise an actual ledger').toBeDefined();
    expect(linkDefaultAssumptionsOf({ ...edge, provenance: { magnitude: 'user_stated' }, defaulted: true })).toEqual([]);
    expect(linkDefaultAssumptionsOf({ ...edge, from: 'unrelated_factor' })).toEqual([]);
    expect(linkDefaultAssumptionsOf(edge, { ...edge, to: 'another_goal' })).toEqual([]);
    expect(linkDefaultAssumptionsOf(edge, { ...edge, strength: { ...edge.strength, std: 0.2 } })).toEqual([edge.provenance.uncertainty_defaults[1]]);
    expect(linkDefaultAssumptionsOf(edge, { ...edge, exists_probability: 1 })).toEqual([edge.provenance.uncertainty_defaults[0]]);
    expect(linkDefaultAssumptionsOf({ ...edge, provenance: { uncertainty_defaults: [null, { reason: 'unverified' }] } })).toEqual([]);
    expect(readLinkDefaultAssumptions({ status: ILLUSTRATIVE, links: [] })).toBeUndefined();
  });

  it('only the evaluated goal path is disclosed; other links and the human source stay separate; numbers are byte-equal', () => {
    const f = d3Run('repairs'), g = structuredClone(f.graph);
    const edge = g.edges.find((e: Json) => e.provenance?.uncertainty_defaults)!;
    g.edges.push({ ...edge, from: 'not_in_this_run', to: 'another_goal' });
    const input = { ...f.result.enrichment, inference_warnings: [] };
    const goal = g.nodes.find((n: Json) => n.kind === 'goal').id;
    const result = withGoalChanceLicence(input, g, goal, undefined, undefined, g, { sentRun: f.sent });
    const licence = licenceOf(result);
    expect(licence.default_assumptions.links).toHaveLength(2);
    expect(licence.default_assumptions.coefficient_distribution).toBe('unbounded_normal');
    expect(licence.default_assumptions.stated_range_use).toBe('recorded_not_sampled_or_tail_bounds');
    expect(licence.default_assumptions.origin).toBe('olumi');
    const plain = structuredClone(g);
    for (const e of plain.edges) if (e.provenance) delete e.provenance.uncertainty_defaults;
    const unchanged = withGoalChanceLicence(input, plain, goal, undefined, undefined, plain, { sentRun: { ...f.sent, graph: plain } });
    const { default_assumptions: _assumptions, notes, ...data } = licence;
    expect({ ...data, notes: notes.filter((n: string) => n !== ILLUSTRATIVE) }).toEqual(licenceOf(unchanged));
    expect(result.option_comparison).toEqual(unchanged.option_comparison);
    expect(runFactsOf(f.result, g, false).chances).toEqual({});
    expect(readLinkDefaultAssumptions(licence.default_assumptions)).toEqual(licence.default_assumptions);
  });
});
