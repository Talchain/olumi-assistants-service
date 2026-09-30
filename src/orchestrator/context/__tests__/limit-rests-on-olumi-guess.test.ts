/**
 * ⛔ B6 — A LIMIT VERDICT NEVER RESTS ON OLUMI'S GUESS (DL #75 5915507578 item 1; AIQ 5915438520; R3 5915571955).
 *
 * Served RED (R3 `adopt-f074916` r1, guest cloud brief): "downtime ≤ 2 weeks" was scored 0.9339 (Switch to GCP) and
 * 0.9995 (Phased). The limited node's level is Olumi's `cee_inference` "0 weeks"; neither option sets it or states a
 * range; the path `gcp_migration_share → migration_duration → migration_downtime` is Olumi-sized. So the P restates
 * Olumi's guess: false certainty. The rule, in the ONE per-option limit predicate (`placeholderPartsFinding`, read by
 * the run's strip and the Agent's words alike): an option's limit P stands only when the limited quantity's value on
 * that option is the user's. Either the option sets it with the user's figure or a stated range, or it moves it only
 * through links nobody but the user sized, from a level that is the user's. The status quo (no change) keeps its P.
 *
 * Rung: TESTED (in-process) on the served graph and Run rows; not a wire witness.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OLUMI_GUESS_LIMIT_REASON,
  PLACEHOLDER_PARTS_REASON,
  placeholderMovedOptions,
} from '../placeholder-parts.js';
import { collectLimitLevelOwners, readRatifiedConstraints, withholdOptionLimitScores } from '../constraint-feasibility.js';
import { limitChecksForAgent } from '../../../orchestrator-v5/agent-lane/limit-checks.js';

type Json = Record<string, any>;
const FIX = JSON.parse(readFileSync(new URL('./fixtures/b6-cloud-r1-20260930.json', import.meta.url), 'utf8')) as {
  served: { graph: Json; option_comparison: Json[]; analysis_limit_verdicts: Json };
  user_limit: { graph: Json; option_comparison: Json[] };
};
const LIMIT = 'agent-lane:migration_downtime:<=';
const TARGET = 'migration_downtime';
const clone = <T>(x: T): T => structuredClone(x);

/** The options as the run sends them to PLoT: projected bare numbers, no owner (`finalWireOptions`). */
const wireOptions = (g: Json): Json[] => g.nodes.filter((n: Json) => n.kind === 'option').map((n: Json) => ({
  option_id: n.id,
  interventions: Object.fromEntries(Object.entries(n.interventions ?? {}).map(([k, v]) => [k, (v as Json).value])),
}));
const moved = (g: Json): Map<string, string> => placeholderMovedOptions(TARGET, g.nodes, g.edges, wireOptions(g));
const stripped = (g: Json, rows: Json[]): Json[] => {
  const byLimit = collectLimitLevelOwners(g, readRatifiedConstraints(g), wireOptions(g)).placeholderMovedOptionIds;
  return (withholdOptionLimitScores({ option_comparison: clone(rows) }, byLimit) as { option_comparison: Json[] }).option_comparison;
};
const pOf = (rows: Json[], id: string): unknown => rows.find((o) => o.option_id === id)?.constraint_probabilities?.[LIMIT];
const edgeTo = (g: Json, from: string, to: string): Json => g.edges.find((e: Json) => e.from === from && e.to === to);

describe('B6 on the served cloud Run (R3 r1)', () => {
  it('PRECONDITION: the served Run scored both GCP options on Olumi\'s guess, and the status quo at 1', () => {
    const rows = FIX.served.option_comparison;
    expect(pOf(rows, 'switch_to_gcp')).toBe(0.9339);
    expect(pOf(rows, 'phased_gcp_migration')).toBe(0.9995);
    expect(pOf(rows, 'remain_on_aws')).toBe(1);
    expect(FIX.served.graph.nodes.find((n: Json) => n.id === TARGET).observed_state.source).toBe('cee_inference');
    expect(edgeTo(FIX.served.graph, 'migration_duration', TARGET).provenance.magnitude).toBe('olumi_estimate');
  });

  it('RED: both GCP options are withheld for resting on Olumi\'s guess; the status quo (no change) is not', () => {
    const m = moved(FIX.served.graph);
    expect([...m.keys()].sort()).toEqual(['phased_gcp_migration', 'switch_to_gcp']);
    expect([...new Set(m.values())]).toEqual([OLUMI_GUESS_LIMIT_REASON]);
  });

  it('RED (the run\'s strip, the same predicate): 0.9339 and 0.9995 are gone; the status quo keeps its earned 1', () => {
    const rows = stripped(FIX.served.graph, FIX.served.option_comparison);
    expect(pOf(rows, 'switch_to_gcp')).toBeUndefined();
    expect(pOf(rows, 'phased_gcp_migration')).toBeUndefined();
    expect(pOf(rows, 'remain_on_aws')).toBe(1);
  });

  it('RED (the Agent\'s words, the same predicate): names both options, says why, and asks the one link question', () => {
    const [row] = limitChecksForAgent(FIX.served.graph, FIX.served.analysis_limit_verdicts as never) ?? [];
    expect(row?.withheld_for).toEqual(['Switch to GCP', 'Phased GCP migration']);
    expect(row?.say).toContain('those options’ figures for it rest on Olumi’s guesses, not figures you gave.');
    expect(row?.ask).toContain('How much does ‘GCP migration share’ change ‘Migration downtime’?');
  });

  it('CONTROL (R3\'s synthetic): the user\'s own level + user-sized links → every P stands', () => {
    expect(moved(FIX.user_limit.graph).size).toBe(0);
    const rows = stripped(FIX.user_limit.graph, FIX.user_limit.option_comparison);
    expect(pOf(rows, 'switch_to_gcp')).toBe(0.9339);
    expect(pOf(rows, 'phased_gcp_migration')).toBe(0.9995);
  });

  it('RED (each arm alone): user-sized links but Olumi\'s level → still withheld; the row\'s own level question is the ask', () => {
    const g = clone(FIX.user_limit.graph);
    g.nodes.find((n: Json) => n.id === TARGET).observed_state.source = 'cee_inference';
    expect([...moved(g).keys()].sort()).toEqual(['phased_gcp_migration', 'switch_to_gcp']);
    const [row] = limitChecksForAgent(g, FIX.served.analysis_limit_verdicts as never) ?? [];
    expect(row?.ask).toMatch(/^What is "Migration downtime" today\?/);
    expect(row?.ask).not.toContain('likely range');
  });

  it('RED (each arm alone): the user\'s level, ONE link on the way Olumi\'s → still withheld', () => {
    const g = clone(FIX.user_limit.graph);
    const e = edgeTo(g, 'gcp_migration_share', 'migration_duration');
    e.provenance = { ...e.provenance, source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    expect([...moved(g).keys()].sort()).toEqual(['phased_gcp_migration', 'switch_to_gcp']);
  });

  it('CONTROL (precedence): a placeholder on the way still says it is a placeholder, not a guess', () => {
    const g = clone(FIX.served.graph);
    const e = edgeTo(g, 'migration_duration', TARGET);
    e.provenance = { ...e.provenance, magnitude: 'olumi_placeholder' };
    expect([...new Set(moved(g).values())]).toEqual([PLACEHOLDER_PARTS_REASON]);
  });
});

describe('B6: an option that SETS the limited quantity to one point (AIQ 5915438520: a guessed duration scores 100%/0%)', () => {
  const setting = (source: string | undefined, extra: Json = {}): Json => {
    const g = clone(FIX.user_limit.graph);
    const o = g.nodes.find((n: Json) => n.id === 'switch_to_gcp');
    o.interventions = { [TARGET]: { value: 0.25, raw_value: 3, unit: 'weeks', ...(source !== undefined ? { source } : {}) } };
    Object.assign(o, extra);
    return g;
  };

  it('RED: Olumi\'s point (`cee_hypothesis`) → withheld, and the one question is its range', () => {
    const g = setting('cee_hypothesis');
    expect(moved(g).get('switch_to_gcp')).toBe(OLUMI_GUESS_LIMIT_REASON);
    const [row] = limitChecksForAgent(g, { per_limit: [{ constraint_id: LIMIT, state: 'scored' }], joint: { state: 'scored' } } as never) ?? [];
    expect(row?.withheld_for).toEqual(['Switch to GCP']);
    expect(row?.ask).toBe('What’s each option’s likely range for ‘Migration downtime’?');
  });

  it('RED: no owner at all → withheld (fails closed)', () => {
    expect(moved(setting(undefined)).get('switch_to_gcp')).toBe(OLUMI_GUESS_LIMIT_REASON);
  });

  it('CONTROL: the user\'s point → kept (arithmetic on their figure, not a guess)', () => {
    expect(moved(setting('user')).has('switch_to_gcp')).toBe(false);
  });

  it('CONTROL: Olumi\'s point with a STATED range for it → kept', () => {
    const g = setting('cee_hypothesis', { intervention_ranges: { [TARGET]: { low: 2, high: 5, meaning: 'likely_range' } } });
    expect(moved(g).has('switch_to_gcp')).toBe(false);
  });

  it('CONTROL: holding today\'s level (the status quo\'s zero change) → kept', () => {
    const g = clone(FIX.user_limit.graph);
    g.nodes.find((n: Json) => n.id === TARGET).observed_state.source = 'cee_inference';
    const o = g.nodes.find((n: Json) => n.id === 'remain_on_aws');
    o.interventions = { [TARGET]: { value: 0, raw_value: 0, unit: 'weeks', source: 'cee_hypothesis' } };
    expect(moved(g).has('remain_on_aws')).toBe(false);
  });
});
