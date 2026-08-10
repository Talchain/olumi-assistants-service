/**
 * Review-fix pins (17 Jul code review, FIX-B cluster) for the D-ask-1
 * scaffold — direct unit pins on scaffoldUnconfiguredOptions.
 *
 * B3 — net-OFF prior-midpoint scale guard: a raw-magnitude prior (outside
 *      the [0,1] sibling convention) must NOT produce a scaffold value on
 *      the scale-net-OFF wire; an in-convention prior still does.
 * B4 — comparison-basis doctrine scope: the ratified fallback covers ONLY
 *      options with NO edges; an option WITH edges whose targets lack
 *      neutrals stays unscaffolded (honest configure path).
 * B5 — the totality catch must not be SILENT: a crash inside the scaffold
 *      logs (error class, no graph content) and returns the input untouched.
 *
 * RED evidence: each pin fails with the fix reverted (see PR body).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { scaffoldUnconfiguredOptions } from '../scaffold-unconfigured-options.js';

function graphWith(nodes: unknown[], edges: unknown[] = []): unknown {
  return { nodes, edges };
}

const CONFIGURED = { option_id: 'opt_cfg', interventions: { fac_a: 0.4 } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B3 — net-OFF prior-midpoint scale guard', () => {
  const edges = [{ from: 'opt_new', to: 'fac_money' }];

  it('raw-magnitude prior (100000..500000) yields NO scaffold value on net-OFF', () => {
    const graph = graphWith(
      [
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        { id: 'fac_money', kind: 'factor', prior: { range_min: 100000, range_max: 500000 } },
        { id: 'opt_new', kind: 'option' },
      ],
      edges,
    );
    const out = scaffoldUnconfiguredOptions({
      options: [CONFIGURED, { option_id: 'opt_new', interventions: {} }],
      graph,
      scaleNetEnabled: false,
    });
    // Pre-fix: midpoint 300000 was forwarded verbatim as a "neutral"
    // placeholder next to [0,1]-convention siblings. Post-fix: the factor has
    // no safe neutral; with no other basis the option stays unscaffolded.
    const scaffoldedIds = out.scaffolded.map((s) => s.option_id);
    expect(scaffoldedIds).not.toContain('opt_new');
    const optNew = out.options.find(
      (o) => (o as { option_id?: string }).option_id === 'opt_new',
    ) as { interventions?: Record<string, number> };
    expect(Object.keys(optNew.interventions ?? {})).toHaveLength(0);
  });

  it('in-convention prior (0.2..0.6) still scaffolds the midpoint 0.4 on net-OFF (no over-reach)', () => {
    const graph = graphWith(
      [
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        { id: 'fac_money', kind: 'factor', prior: { range_min: 0.2, range_max: 0.6 } },
        { id: 'opt_new', kind: 'option' },
      ],
      edges,
    );
    const out = scaffoldUnconfiguredOptions({
      options: [CONFIGURED, { option_id: 'opt_new', interventions: {} }],
      graph,
      scaleNetEnabled: false,
    });
    expect(out.scaffolded.map((s) => s.option_id)).toContain('opt_new');
    const optNew = out.options.find(
      (o) => (o as { option_id?: string }).option_id === 'opt_new',
    ) as { interventions?: Record<string, number> };
    // Round 4: the scaffold emits the CANDIDATE OBJECT (the single request-level
    // projection downstream owns the wire number) — the selected midpoint is
    // unchanged, carried as the candidate's `value`.
    expect(optNew.interventions).toEqual({ fac_money: { value: 0.4 } });
  });
});

describe('B4 — comparison-basis fallback fires ONLY for edge-less options', () => {
  it('an option WITH edges whose targets lack neutrals is NOT switched to the sibling basis', () => {
    const graph = graphWith(
      [
        // fac_a: the configured sibling's factor, has a neutral (observed value).
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        // fac_dark: opt_new's own target — NO observed value, NO prior → no neutral.
        { id: 'fac_dark', kind: 'factor' },
        { id: 'opt_new', kind: 'option' },
      ],
      [{ from: 'opt_new', to: 'fac_dark' }],
    );
    const out = scaffoldUnconfiguredOptions({
      options: [CONFIGURED, { option_id: 'opt_new', interventions: {} }],
      graph,
      scaleNetEnabled: false,
    });
    // Pre-fix: fell back to comparisonBasis (fac_a) although the option HAS
    // edges — outside the ratified scope, and the disclosure would
    // misdescribe what ran. Post-fix: unscaffolded → honest configure path.
    expect(out.scaffolded.map((s) => s.option_id)).not.toContain('opt_new');
  });

  it('an option with NO edges still gets the ratified comparison-basis fallback', () => {
    const graph = graphWith(
      [
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        { id: 'opt_new', kind: 'option' },
      ],
      [],
    );
    const out = scaffoldUnconfiguredOptions({
      options: [CONFIGURED, { option_id: 'opt_new', interventions: {} }],
      graph,
      scaleNetEnabled: false,
    });
    expect(out.scaffolded.map((s) => s.option_id)).toContain('opt_new');
  });
});

describe('B5 — the totality catch is no longer silent', () => {
  it('a crash inside the scaffold logs the error class and returns the input untouched', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const poisoned: Record<string, unknown> = { option_id: 'opt_cfg' };
    Object.defineProperty(poisoned, 'interventions', {
      enumerable: true,
      get() {
        throw new Error('injected-scaffold-crash');
      },
    });
    const options = [poisoned, { option_id: 'opt_new', interventions: {} }];
    const out = scaffoldUnconfiguredOptions({
      options,
      graph: graphWith([]),
      scaleNetEnabled: false,
    });
    expect(out.options).toBe(options); // untouched, by reference
    expect(out.scaffolded).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = String(spy.mock.calls[0][0]);
    expect(msg).toContain('scaffold crashed');
    expect(msg).toContain('injected-scaffold-crash');
  });
});
