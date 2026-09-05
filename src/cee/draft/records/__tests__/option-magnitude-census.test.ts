/**
 * Unit pins for `option-magnitude-census.ts` — the counting rule itself.
 * The WIRING (that each of the four points calls it on the right artefact) is
 * pinned separately: `option-magnitude-four-point-census.test.ts` and
 * `src/orchestrator-v5/__tests__/commit-option-magnitude-census.test.ts`.
 *
 * ⭐⭐ THE LOAD-BEARING BLOCK IS THE LAST ONE — the derived-agreement
 * cross-product against `mergeInterventionSources`. The census carries a
 * DELIBERATE COPY of `extractNumericIntervention`'s acceptance rule (the
 * production import would close a package cycle on the draft adapter's boot
 * path), and a copy nobody checks is the hand-maintained mirror this estate
 * keeps paying for. Deriving a guard FROM the copy would only prove the copy
 * agrees with itself, so the guard is sourced from the other side: the read
 * path's own merge, over the cross-product of every carrier × every value
 * shape. A drift in either acceptance rule REDs there.
 */
import { describe, expect, it } from 'vitest';

import {
  censusOptionFactorMagnitudes,
  interventionFactorIdsWithFiniteMagnitude,
  OPTION_MAGNITUDE_CENSUS_POINTS,
} from '../option-magnitude-census.js';
import { mergeInterventionSources } from '../../../../orchestrator/tools/analysis-ready-helper.js';

const OPT = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'option', label: id, ...extra });
const FAC = (id: string) => ({ id, kind: 'factor', label: id });

describe('censusOptionFactorMagnitudes — the population', () => {
  it('counts ONLY option→factor edges; every other pairing is out of the denominator', () => {
    const graph = {
      nodes: [
        { id: 'goal', kind: 'goal' },
        { id: 'dec', kind: 'decision' },
        OPT('opt_a'),
        FAC('fac_x'),
        FAC('fac_y'),
        { id: 'risk', kind: 'risk' },
      ],
      edges: [
        { from: 'opt_a', to: 'fac_x' }, // counted
        { from: 'opt_a', to: 'fac_y' }, // counted
        { from: 'dec', to: 'opt_a' }, // decision→option
        { from: 'fac_x', to: 'goal' }, // factor→goal
        { from: 'fac_x', to: 'fac_y' }, // factor→factor
        { from: 'opt_a', to: 'risk' }, // option→risk
        { from: 'fac_x', to: 'opt_a' }, // factor→option (the reverse pairing)
      ],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 2, missing_magnitude: 2 });
  });

  it('counts PARALLEL option→factor edges once each — two surviving claims are two claims', () => {
    const graph = {
      nodes: [OPT('opt_a'), FAC('fac_x')],
      edges: [
        { id: 'e1', from: 'opt_a', to: 'fac_x' },
        { id: 'e2', from: 'opt_a', to: 'fac_x' },
      ],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 2, missing_magnitude: 2 });
  });

  it('a magnitude for the pair marks BOTH parallel edges present — presence is a property of the pair', () => {
    const graph = {
      nodes: [OPT('opt_a', { data: { interventions: { fac_x: 0.4 } } }), FAC('fac_x')],
      edges: [
        { id: 'e1', from: 'opt_a', to: 'fac_x' },
        { id: 'e2', from: 'opt_a', to: 'fac_x' },
      ],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 2, missing_magnitude: 0 });
  });

  it('a magnitude for a DIFFERENT factor does not rescue this edge', () => {
    const graph = {
      nodes: [OPT('opt_a', { data: { interventions: { fac_other: 0.9 } } }), FAC('fac_x'), FAC('fac_other')],
      edges: [{ from: 'opt_a', to: 'fac_x' }],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 1, missing_magnitude: 1 });
  });

  it('reads source/target as well as from/to — EdgeInput accepts both and only normalises on parse', () => {
    const graph = {
      nodes: [OPT('opt_a'), FAC('fac_x')],
      edges: [{ source: 'opt_a', target: 'fac_x' }],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 1, missing_magnitude: 1 });
  });

  it('a zero magnitude is a MAGNITUDE — "set this factor to 0" is a stated level, not a gap', () => {
    const graph = {
      nodes: [OPT('opt_a', { data: { interventions: { fac_x: 0 } } }), FAC('fac_x')],
      edges: [{ from: 'opt_a', to: 'fac_x' }],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 1, missing_magnitude: 0 });
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '0.5'],
    ['null', null],
    ['an empty object', {}],
    ['an object whose value is a string', { value: '0.5' }],
  ])('a non-finite carrier value (%s) counts as MISSING', (_label, value) => {
    const graph = {
      nodes: [OPT('opt_a', { data: { interventions: { fac_x: value } } }), FAC('fac_x')],
      edges: [{ from: 'opt_a', to: 'fac_x' }],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 1, missing_magnitude: 1 });
  });

  it.each([
    ['no graph', undefined],
    ['null', null],
    ['a scalar', 7],
    ['no nodes/edges arrays', { version: '1' }],
    ['nodes but no edges', { nodes: [OPT('opt_a')] }],
  ])('an unreadable shape (%s) reports a ZERO DENOMINATOR, not zero misses', (_label, graph) => {
    // The denominator is how this instrument reports its own blindness: 0 edges
    // reads as "nothing was measured here", where 0 misses would read as "every
    // magnitude is present" — a confident claim produced by not looking.
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 0, missing_magnitude: 0 });
  });

  it('a node with no kind is not an option and not a factor', () => {
    const graph = {
      nodes: [{ id: 'opt_a' }, FAC('fac_x')],
      edges: [{ from: 'opt_a', to: 'fac_x' }],
    };
    expect(censusOptionFactorMagnitudes(graph)).toEqual({ option_factor_edges: 0, missing_magnitude: 0 });
  });

  it('names exactly the four points, in chain order', () => {
    expect([...OPTION_MAGNITUDE_CENSUS_POINTS]).toEqual([
      'before_completion',
      'after_completion',
      'after_projection',
      'at_commit',
    ]);
  });
});

describe('interventionFactorIdsWithFiniteMagnitude — all three carriers', () => {
  it('reads data.interventions (what the draft projector writes)', () => {
    expect([...interventionFactorIdsWithFiniteMagnitude({ data: { interventions: { fac_x: 0.4 } } })]).toEqual(['fac_x']);
  });

  it('reads slash-keyed flat entries', () => {
    expect([...interventionFactorIdsWithFiniteMagnitude({ 'data/interventions/fac_x': 0.4 })]).toEqual(['fac_x']);
  });

  it('reads top-level interventions with InterventionV3 objects (the canonical persisted carrier)', () => {
    expect([...interventionFactorIdsWithFiniteMagnitude({ interventions: { fac_x: { value: 0.4, source: 'user_specified' } } })]).toEqual(['fac_x']);
  });

  it('unions across carriers rather than letting one shadow another', () => {
    const ids = interventionFactorIdsWithFiniteMagnitude({
      data: { interventions: { fac_a: 0.1 } },
      'data/interventions/fac_b': 0.2,
      interventions: { fac_c: { value: 0.3 } },
    });
    expect([...ids].sort()).toEqual(['fac_a', 'fac_b', 'fac_c']);
  });
});

/**
 * ⭐⭐ THE DERIVED-AGREEMENT GUARD.
 *
 * The corpus is a CROSS-PRODUCT, not a hand-picked list: every carrier the read
 * path knows × every value shape the carrier can hold, plus the container
 * shapes. A hand-picked list would only contain the cases the author already
 * imagined — the exact blind spot that makes a copy dangerous in the first
 * place (trap 22).
 *
 * PRESENCE IS PRECEDENCE-INVARIANT, which is why equality of the KEY SETS is
 * the right assertion and equality of the values is not: `mergeInterventionSources`
 * decides WHICH carrier's value wins per factor; the census asks only whether
 * ANY carrier holds a finite one.
 */
describe('derived agreement with the read path (mergeInterventionSources)', () => {
  const CARRIERS: ReadonlyArray<readonly [string, (v: unknown) => Record<string, unknown>]> = [
    ['data.interventions', (v) => ({ data: { interventions: { fac_x: v } } })],
    ['slash-keyed', (v) => ({ 'data/interventions/fac_x': v })],
    ['top-level interventions', (v) => ({ interventions: { fac_x: v } })],
  ];

  const VALUES: ReadonlyArray<readonly [string, unknown]> = [
    ['finite number', 0.5],
    ['zero', 0],
    ['negative', -2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['InterventionV3 object', { value: 0.5, source: 'user_specified' }],
    ['object with zero value', { value: 0 }],
    ['object with NaN value', { value: Number.NaN }],
    ['object with string value', { value: '0.5' }],
    ['empty object', {}],
    ['numeric string', '0.5'],
    ['null', null],
    ['true', true],
    ['array', [1, 2]],
  ];

  for (const [carrierName, build] of CARRIERS) {
    for (const [valueName, value] of VALUES) {
      it(`agrees on ${carrierName} carrying ${valueName}`, () => {
        const node = build(value);
        const mine = [...interventionFactorIdsWithFiniteMagnitude(node)].sort();
        const theirs = Object.keys(mergeInterventionSources(node) ?? {}).sort();
        expect(mine).toEqual(theirs);
      });
    }
  }

  it.each([
    ['data.interventions is an ARRAY container', { data: { interventions: [5] } }],
    ['top-level interventions is an ARRAY container', { interventions: [5] }],
    ['data.interventions is null', { data: { interventions: null } }],
    ['top-level interventions is null', { interventions: null }],
    ['data is a scalar', { data: 7 }],
    ['no carriers at all', { id: 'opt', kind: 'option' }],
  ])('agrees on the container shape: %s', (_label, node) => {
    const mine = [...interventionFactorIdsWithFiniteMagnitude(node)].sort();
    const theirs = Object.keys(mergeInterventionSources(node as Record<string, unknown>) ?? {}).sort();
    expect(mine).toEqual(theirs);
  });

  it('POSITIVE CONTROL — the comparison can DISAGREE, so an agreement above is a real measurement', () => {
    // Without this, every arm in this block could be passing because both sides
    // returned an empty set on every input (trap 13: an absence probe with no
    // positive control). Here the two sides are handed DIFFERENT nodes and the
    // key sets must differ — proving the assertion discriminates at all.
    const valued = interventionFactorIdsWithFiniteMagnitude({ data: { interventions: { fac_x: 0.5 } } });
    const empty = Object.keys(mergeInterventionSources({ data: { interventions: { fac_x: 'nope' } } }) ?? {});
    expect([...valued]).toEqual(['fac_x']);
    expect(empty).toEqual([]);
    expect([...valued]).not.toEqual(empty);
  });
});
