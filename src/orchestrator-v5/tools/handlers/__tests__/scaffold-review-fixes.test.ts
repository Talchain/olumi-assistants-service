/**
 * Review-fix pins (17 Jul code review, FIX-B cluster) — direct unit pins on
 * `gateAnalysableOptions`.
 *
 * ⚠ RE-POINTED BY THE NO-RANK RULING (Paul, 2026-08-14). Two of the three
 * clusters changed meaning, and the change is the point:
 *
 * B3 — **the prior-range midpoint rung is DELETED.** It used to be the second
 *      provenance rung, guarded on net-OFF so a raw-magnitude prior could not
 *      inject a wrong-scale "neutral". The rung's only surviving caller is now
 *      the STATUS-QUO HOLD, and a centre-of-range guess cannot support the
 *      hold's claim: the midpoint answers *"where might this factor sit?"*,
 *      while the status quo is a claim about *where it does sit*. So the rung
 *      is gone, and this block is now a DELETION TWIN covering BOTH SIDES of
 *      the old guard's threshold — including the in-convention prior that used
 *      to scaffold, which is the case a partial deletion would leave alive.
 * B4 — comparison-basis doctrine scope, UNCHANGED as a rule and re-pointed to a
 *      BASELINE fixture, because the hold is now the only path that receives
 *      CEE-supplied values at all.
 * B5 — the totality catch must not be SILENT: a crash logs (error class only,
 *      no graph content) and returns the input untouched.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { gateAnalysableOptions } from '../analysable-option-gate.js';

function graphWith(nodes: unknown[], edges: unknown[] = []): unknown {
  return { nodes, edges };
}

const CONFIGURED = { option_id: 'opt_cfg', interventions: { fac_a: 0.4 } };

/** The unconfigured option under test, flagged as the status quo. */
const BASELINE_NEW = { option_id: 'opt_new', interventions: {}, is_baseline: true };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B3 — the prior-range midpoint rung is DELETED (deletion twin)', () => {
  const edges = [{ from: 'opt_new', to: 'fac_money' }];

  // BOTH SIDES of the old net-OFF guard's threshold. The raw-magnitude case
  // was already rejected before the ruling, so on its own it cannot show the
  // rung is gone — it would pass against a tree where only the guard survived.
  // The in-convention case is the discriminating one: it USED to scaffold
  // `{fac_money: {value: 0.4}}`, and must now hold nothing.
  it.each([
    ['raw-magnitude prior (was rejected by the B3 guard)', { range_min: 100000, range_max: 500000 }],
    ['in-convention prior (USED to scaffold the midpoint 0.4)', { range_min: 0.2, range_max: 0.6 }],
  ])('%s yields NO held value — the rung no longer exists', (_name, prior) => {
    const graph = graphWith(
      [
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        { id: 'fac_money', kind: 'factor', prior },
        { id: 'opt_new', kind: 'option' },
      ],
      edges,
    );
    const out = gateAnalysableOptions({
      options: [CONFIGURED, BASELINE_NEW],
      graph,
      scaleNetEnabled: false,
    });

    // Its only target factor has observed provenance NOWHERE, so even the
    // status quo cannot be held from it: we never invent "no change" either.
    expect(out.held.map((s) => s.option_id)).not.toContain('opt_new');
    // And it is not silently dropped — it is EXCLUDED, which is a disclosed,
    // named outcome the user is told about.
    expect(out.excluded.map((s) => s.option_id)).toContain('opt_new');
    expect(out.options.map((o) => (o as { option_id?: string }).option_id)).not.toContain(
      'opt_new',
    );
  });
});

describe('B4 — comparison-basis fallback fires ONLY for edge-less options', () => {
  it('an option WITH edges whose targets lack holdable values is NOT switched to the sibling basis', () => {
    const graph = graphWith(
      [
        // fac_a: the configured sibling's factor, IS holdable (observed value).
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        // fac_dark: opt_new's own target — NO observed value → not holdable.
        { id: 'fac_dark', kind: 'factor' },
        { id: 'opt_new', kind: 'option' },
      ],
      [{ from: 'opt_new', to: 'fac_dark' }],
    );
    const out = gateAnalysableOptions({
      options: [CONFIGURED, BASELINE_NEW],
      graph,
      scaleNetEnabled: false,
    });
    // Pre-fix: fell back to comparisonBasis (fac_a) although the option HAS
    // edges — outside the ratified scope, and the disclosure would misdescribe
    // what ran. The rule is unchanged by the ruling; only the outcome's NAME
    // changed, from "unscaffolded" to "excluded".
    expect(out.held.map((s) => s.option_id)).not.toContain('opt_new');
    expect(out.excluded.map((s) => s.option_id)).toContain('opt_new');
  });

  it('an option with NO edges still gets the ratified comparison-basis fallback', () => {
    const graph = graphWith(
      [
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        { id: 'opt_new', kind: 'option' },
      ],
      [],
    );
    const out = gateAnalysableOptions({
      options: [CONFIGURED, BASELINE_NEW],
      graph,
      scaleNetEnabled: false,
    });
    expect(out.held.map((s) => s.option_id)).toContain('opt_new');
    expect(out.excluded).toEqual([]);
  });

  it('CONTRAST CONTROL — the SAME edge-less option WITHOUT the baseline flag is excluded, not held', () => {
    // Without this, the pin above is equally consistent with a gate that holds
    // every edge-less option regardless of the flag. The pair discriminates.
    const graph = graphWith(
      [
        { id: 'fac_a', kind: 'factor', observed_state: { value: 0.4 } },
        { id: 'opt_new', kind: 'option' },
      ],
      [],
    );
    const out = gateAnalysableOptions({
      options: [CONFIGURED, { option_id: 'opt_new', interventions: {} }],
      graph,
      scaleNetEnabled: false,
    });
    expect(out.held).toEqual([]);
    expect(out.excluded.map((s) => s.option_id)).toEqual(['opt_new']);
  });
});

describe('B5 — the totality catch is no longer silent', () => {
  it('a crash inside the gate logs the error class and returns the input untouched', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const poisoned: Record<string, unknown> = { option_id: 'opt_cfg' };
    Object.defineProperty(poisoned, 'interventions', {
      enumerable: true,
      get() {
        throw new Error('injected-gate-crash');
      },
    });
    const options = [poisoned, { option_id: 'opt_new', interventions: {} }];
    const out = gateAnalysableOptions({
      options,
      graph: graphWith([]),
      scaleNetEnabled: false,
    });
    expect(out.options).toBe(options); // untouched, by reference
    expect(out.held).toHaveLength(0);
    expect(out.excluded).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = String(spy.mock.calls[0][0]);
    expect(msg).toContain('gate crashed');
    expect(msg).toContain('injected-gate-crash');
  });
});
