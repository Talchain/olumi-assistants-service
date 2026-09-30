/**
 * ⭐ ONE "RESTS ON OLUMI'S GUESS" TEST FOR THE GOAL AND FOR A LIMIT (AIQ #2384 condition 5917939324; P0 PARTNER seam
 * 5918016361 + row table 5918060026). DECISION-REPRESENTATION row 4
 * (`target-testability.ts`) and B6 (`placeholderPartsFinding`) read `olumiGuessedLink` over `asAnalysed`'s graph, so the
 * same link can never be "Olumi's guess" for one gate and not the other.
 *
 * Rung: TESTED (in-process, 0 LLM). The B6 path rows are constructed twins of the served cloud Run's graph (R3 r1).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OLUMI_GUESS_LIMIT_REASON,
  PLACEHOLDER_PARTS_REASON,
  asAnalysed,
  nodeUnitOf,
  olumiGuessedLink,
  placeholderMovedOptions,
} from '../placeholder-parts.js';

type Json = Record<string, any>;
const clone = <T>(x: T): T => structuredClone(x);

describe('P0 PARTNER\'s row table (5918060026): one cell each, on the shared predicate', () => {
  const nodes: Json[] = [
    { id: 'lost', kind: 'factor', unit: '£' },
    { id: 'goal', kind: 'goal', goal_threshold_unit: '£' },
    { id: 'kept_out', kind: 'factor', unit: '£', analysis_participation: 'retained_excluded' },
  ];
  const unitOf = nodeUnitOf(nodes);
  const edge = (provenance: Json, extra: Json = {}): Json => ({ from: 'lost', to: 'goal', strength: { mean: -0.5 }, provenance, ...extra });
  const olumi = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
  const oneForOne = { amount: -1, amount_unit: '£', per_source_change: 1, per_source_change_unit: '£', strength_mean: -0.5 };

  it('1 · an endpoint kept out of the calculation → the edge is absent from the graph the predicate reads', () => {
    const g = { nodes, edges: [edge(olumi), { ...edge(olumi), from: 'kept_out' }] };
    expect(asAnalysed(g).edges).toEqual([edge(olumi)]);
    expect(asAnalysed(g).nodes.map((n) => (n as Json).id)).toEqual(['lost', 'goal']);
  });

  it('1b · the goal, and the node whose own limit is read (`keep`), are never dropped', () => {
    const g = { nodes: [...nodes, { id: 'g2', kind: 'goal', analysis_participation: 'retained_excluded' }], edges: [] };
    expect(asAnalysed(g, 'kept_out').nodes.map((n) => (n as Json).id)).toEqual(['lost', 'goal', 'kept_out', 'g2']);
  });

  it('2 · `source: user_specified` → no guess', () => {
    expect(olumiGuessedLink(edge({ source: 'user_specified', magnitude: 'olumi_estimate' }), unitOf)).toBe(false);
  });

  it('3 · PINNED: `magnitude: user_stated` + `defaulted` → still a guess until #2389 scopes the brief check to the link', () => {
    // MG 5918011036 / AIQ 5918035214 / P0 PARTNER 5918144110: this flips to `false` in the change that scopes `sizeWritten`.
    expect(olumiGuessedLink(edge({ source: 'brief_extraction', magnitude: 'user_stated' }, { defaulted: true }), unitOf)).toBe(true);
    expect(olumiGuessedLink(edge({ source: 'brief_extraction', magnitude: 'user_stated' }), unitOf)).toBe(false);
  });

  it('4 · `olumi_estimate` / `olumi_placeholder` → a guess', () => {
    expect(olumiGuessedLink(edge(olumi), unitOf)).toBe(true);
    expect(olumiGuessedLink(edge({ ...olumi, magnitude: 'olumi_placeholder' }), unitOf)).toBe(true);
  });

  it('5 · as 4, `definitional` + ±1 in one unit + written for the β it holds → no guess', () => {
    expect(olumiGuessedLink(edge({ ...olumi, definitional: true, natural_effect: oneForOne }), unitOf)).toBe(false);
  });

  it('6 · as 5, β moved (a stale `strength_mean`) → a guess', () => {
    expect(olumiGuessedLink(edge({ ...olumi, definitional: true, natural_effect: oneForOne }, { strength: { mean: -0.2 } }), unitOf)).toBe(true);
  });

  it('7 · no magnitude, `defaulted: true` → a guess', () => {
    expect(olumiGuessedLink(edge({ source: 'cee_hypothesis' }, { defaulted: true }), unitOf)).toBe(true);
  });

  it('8 · no magnitude, not defaulted (structural) → no guess', () => {
    expect(olumiGuessedLink(edge({ source: 'cee_hypothesis' }), unitOf)).toBe(false);
  });
});

describe('B6 reads the same test on a limit\'s path (the cloud Run, downtime ≤ 2 weeks)', () => {
  const FIX = JSON.parse(readFileSync(new URL('./fixtures/b6-cloud-r1-20260930.json', import.meta.url), 'utf8')) as { user_limit: { graph: Json } };
  const TARGET = 'migration_downtime';
  const wireOptions = (g: Json): Json[] => g.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => ({
    option_id: n.id,
    interventions: Object.fromEntries(Object.entries(n.interventions ?? {}).map(([k, v]) => [k, (v as Json).value])),
  }));
  const moved = (g: Json): Map<string, string> => placeholderMovedOptions(TARGET, g.nodes, g.edges, wireOptions(g));
  const DURATION_DOWNTIME = (e: Json) => e.from === 'migration_duration' && e.to === TARGET;
  /** The user's level and links, except duration → downtime: Olumi's size, sized in weeks for the β it holds. */
  const olumiOnDuration = (natural: Json = {}, provenance: Json = {}): Json => {
    const g = clone(FIX.user_limit.graph);
    const e = g.edges.find(DURATION_DOWNTIME);
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', ...provenance,
      natural_effect: { amount: 1, amount_unit: 'weeks', per_source_change: 1, per_source_change_unit: 'weeks',
        strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength', ...natural } };
    return g;
  };

  it('PRECONDITION: the user\'s level and links → every limit P stands', () => {
    expect(moved(FIX.user_limit.graph).size).toBe(0);
  });

  it('RED: Olumi sized duration → downtime (1 week per week, not typed definitional) → arm (i) for both GCP options', () => {
    const m = moved(olumiOnDuration());
    expect([...m.keys()].sort()).toEqual(['phased_gcp_migration', 'switch_to_gcp']);
    expect([...new Set(m.values())]).toEqual([OLUMI_GUESS_LIMIT_REASON]);
  });

  it('GREEN (AIQ + P0 PARTNER\'s row): the same link typed definitional and proven → not an arm (i) reason; every P stands', () => {
    expect(moved(olumiOnDuration({}, { definitional: true })).size).toBe(0);
  });

  it('RED (the stale-β twin): typed definitional, then β re-estimated → withheld again (the size no longer describes the link)', () => {
    const g = olumiOnDuration({}, { definitional: true });
    g.edges.find(DURATION_DOWNTIME).strength.mean = 0.3;
    const m = moved(g);
    expect([...m.keys()].sort()).toEqual(['phased_gcp_migration', 'switch_to_gcp']);
    // A size written for another β is not a size at all: the placeholder reading, which outranks a guess.
    expect([...new Set(m.values())]).toEqual([PLACEHOLDER_PARTS_REASON]);
  });

  it('RED: typed definitional, but 0.5 week per week → still Olumi\'s guess (a definition moves the target one for one)', () => {
    expect([...new Set(moved(olumiOnDuration({ amount: 0.5 }, { definitional: true })).values())]).toEqual([OLUMI_GUESS_LIMIT_REASON]);
  });

  /** A risk the user kept out of the calculation, on the way from the share to downtime, sized by Olumi. */
  const keptOutRisk = (participation: string | undefined): Json => {
    const g = clone(FIX.user_limit.graph);
    g.nodes.push({ id: 'vendor_delay', kind: 'factor', label: 'Vendor delay',
      ...(participation !== undefined ? { analysis_participation: participation } : {}),
      observed_state: { unit: 'weeks', raw_value: 0, value: 0, source: 'user' } });
    const sized = (from: string, to: string, per: string): Json => ({ from, to, strength: { mean: 0.3 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
        natural_effect: { amount: 0.5, amount_unit: 'weeks', per_source_change: 1, per_source_change_unit: per, strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } });
    g.edges.push(sized('gcp_migration_share', 'vendor_delay', '%'), sized('vendor_delay', TARGET, 'weeks'));
    return g;
  };

  it('CONTRAST: the same risk IN the calculation → its Olumi-sized links withhold both GCP options (arm (i))', () => {
    expect([...moved(keptOutRisk(undefined)).keys()].sort()).toEqual(['phased_gcp_migration', 'switch_to_gcp']);
  });

  it('GREEN (AIQ\'s row): the risk kept out (`retained_excluded`) → the same verdict as without it: every P stands', () => {
    expect(moved(keptOutRisk('retained_excluded')).size).toBe(0);
  });
});
