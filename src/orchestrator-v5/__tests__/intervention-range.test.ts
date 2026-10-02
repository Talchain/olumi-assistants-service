/**
 * TEMPORAL CEE hop — an option's stated range for a value it sets (schemas 0.66.0 S1/S2, #75 `8b47d0d6`).
 *
 * DL 5914755517: the range enters the analysis hash IN THE SAME PR that writes it, with a RED row that editing
 * "5–20 days" to "5–30 days" moves the hash — otherwise the old chance reads as CURRENT. R3 5914230653 (2): the writer
 * refuses a range that does not contain the option's value. AIQ 5914222384: the range carries its own author.
 */
import { describe, expect, it } from 'vitest';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { admitInterventionRange, wireInterventionRanges } from '../intervention-range.js';

type Rec = Record<string, unknown>;
const hashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as GraphV3T);

const USER = { source: 'user_specified', source_quote: 'somewhere between 5 and 20 days' };

/** Paul's cut-costs shape: a downtime limit, two migration options, the status quo. */
const downtime = (range?: Rec): Rec & { nodes: Rec[]; options: Rec[] } => {
  const liftIv = (): Rec => ({
    value: 10,
    raw_value: 10,
    unit: 'days',
    source: 'user_specified',
    target_match: { node_id: 'downtime', match_type: 'exact_id', confidence: 'high' },
    ...(range !== undefined ? { range } : {}),
  });
  return {
    goal_node_id: 'cost',
    nodes: [
      { id: 'cost', kind: 'goal', label: 'Annual cost' },
      { id: 'downtime', kind: 'factor', label: 'Migration downtime', observed_state: { value: 0, raw_value: 0, unit: 'days', source: 'user_override' } },
      { id: 'lift', kind: 'option', label: 'Lift-and-shift', interventions: { downtime: liftIv() } },
      { id: 'stay', kind: 'option', label: 'Stay on-prem', interventions: {} },
    ],
    edges: [{ from: 'downtime', to: 'cost', strength: { mean: 0.3, std: 0.1 }, effect_direction: 'positive' }],
    options: [
      { id: 'lift', label: 'Lift-and-shift', status: 'ready', interventions: { downtime: liftIv() } },
      { id: 'stay', label: 'Stay on-prem', status: 'ready', interventions: {}, is_baseline: true },
    ],
  };
};

/** `downtime()` hashed by staging `68c9789` before this change (projection with no `range`). No mass stale. */
const NO_RANGE_HASH_AT_STAGING = '0a1f6d582a551043';

describe('S2 — editing a stated range moves the analysis revision', () => {
  it('RED: "5–20 days" → "5–30 days" moves the hash', () => {
    const a = hashOf(downtime({ low: 5, high: 20, meaning: 'likely_range', ...USER }));
    const b = hashOf(downtime({ low: 5, high: 30, meaning: 'likely_range', ...USER }));
    expect(a).not.toBe(b);
  });

  it('RED: stating a range at all moves the hash (the chance it changes is not current)', () => {
    expect(hashOf(downtime({ low: 5, high: 20, meaning: 'likely_range', ...USER }))).not.toBe(hashOf(downtime()));
  });

  it('RED: who stated it moves the hash (Olumi\'s reading vs the user\'s words, AIQ 5914439702)', () => {
    const user = hashOf(downtime({ low: 5, high: 20, meaning: 'likely_range', ...USER }));
    const olumi = hashOf(downtime({ low: 5, high: 20, meaning: 'likely_range', source: 'cee_inference' }));
    expect(user).not.toBe(olumi);
  });

  it('CONTROL (no mass stale): a graph with no range hashes exactly as it did before this change', () => {
    expect(hashOf(downtime())).toBe(NO_RANGE_HASH_AT_STAGING);
  });
});

describe('S1 writer — the persisted form refuses a range that contradicts its value', () => {
  const liftNodeRange = (g: Rec) =>
    (((g.nodes as Rec[]).find((n) => n.id === 'lift') as Rec).interventions as Rec & { downtime: Rec }).downtime.range;
  const liftOptionRange = (g: Rec) =>
    (((g.options as Rec[]).find((o) => o.id === 'lift') as Rec).interventions as Rec & { downtime: Rec }).downtime.range;

  it('CONTROL: an admissible range is stored verbatim, and the graph is its own fixed point (same reference)', () => {
    const g = downtime({ low: 5, high: 20, meaning: 'likely_range', ...USER });
    const projected = projectGraphForPersistence(g);
    expect(projected).toBe(g);
    expect(liftNodeRange(projected)).toEqual({ low: 5, high: 20, meaning: 'likely_range', ...USER });
  });

  it.each([
    ['the value lies above it (10 d vs 12–30 d)', { low: 12, high: 30, meaning: 'likely_range', ...USER }],
    ['the value lies below it (10 d vs 2–8 d)', { low: 2, high: 8, meaning: 'likely_range', ...USER }],
    ['no author (AIQ 5914222384)', { low: 5, high: 20, meaning: 'likely_range' }],
    ['a meaning outside the enumerated set', { low: 5, high: 20, meaning: 'roughly', ...USER }],
    ['low ≥ high', { low: 20, high: 5, meaning: 'likely_range', ...USER }],
    ['an undeclared key', { low: 5, high: 20, meaning: 'likely_range', ...USER, unit: 'days' }],
  ])('RED: REFUSED at write when %s — removed from node AND option, value untouched', (_n, bad) => {
    const projected = projectGraphForPersistence(downtime(bad)) as Rec;
    expect(liftNodeRange(projected)).toBeUndefined();
    expect(liftOptionRange(projected)).toBeUndefined();
    const nodeIv = ((((projected.nodes as Rec[]).find((n) => n.id === 'lift') as Rec).interventions) as Rec).downtime as Rec;
    expect(nodeIv.raw_value).toBe(10);
  });

  it('a categorical value has no point for a range to bracket → refused', () => {
    expect(admitInterventionRange({ value: 1, raw_value: 'UK', value_type: 'categorical', range: { low: 5, high: 20, meaning: 'likely_range', ...USER } }))
      .toEqual({ refused: 'no_point' });
  });
});

describe('S1 wire — what PLoT receives', () => {
  const iv = (range: Rec, extra: Rec = {}) => ({ value: 10, raw_value: 10, range, ...extra });

  it('forwards {low, high, meaning} only (no author, no quote) when the wire number IS the raw point', () => {
    expect(wireInterventionRanges({ downtime: iv({ low: 5, high: 20, meaning: 'likely_range', ...USER }) }, { downtime: 10 }))
      .toEqual({ downtime: { low: 5, high: 20, meaning: 'likely_range' } });
  });

  it('withholds when CEE rescaled the value onto the model scale (units would disagree)', () => {
    expect(wireInterventionRanges({ downtime: iv({ low: 5, high: 20, meaning: 'likely_range', ...USER }) }, { downtime: 0.25 }))
      .toBeUndefined();
  });

  it('withholds a refused range and a factor not on the wire', () => {
    expect(wireInterventionRanges({ downtime: iv({ low: 12, high: 30, meaning: 'likely_range', ...USER }) }, { downtime: 10 })).toBeUndefined();
    expect(wireInterventionRanges({ downtime: iv({ low: 5, high: 20, meaning: 'likely_range', ...USER }) }, {})).toBeUndefined();
  });

  it('CONTROL: no range stated → no key (byte-identical wire)', () => {
    expect(wireInterventionRanges({ downtime: { value: 10, raw_value: 10 } }, { downtime: 10 })).toBeUndefined();
  });

  it('carries a hard-bound meaning so the engine refuses it BY NAME (never misread as quartiles)', () => {
    expect(wireInterventionRanges({ downtime: iv({ low: 5, high: 20, meaning: 'min_max', ...USER }) }, { downtime: 10 }))
      .toEqual({ downtime: { low: 5, high: 20, meaning: 'min_max' } });
  });
});
