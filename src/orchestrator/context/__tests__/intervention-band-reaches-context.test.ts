/**
 * A bare model value in the AI-facing context is read as on/off.
 *
 * SERVED EVIDENCE, not a hypothesis. Capture
 * `served-coaching-8077853a-2ffc-4979-95fe-412eee6799c7` (16 Sep 2026, stable
 * CEE `bdf74f6`, owned bookshop scenario, graph `40c8e0e93ad1df33` unchanged)
 * asked what each option actually changes. The options carry bare `1` and `0`,
 * so the context said `Friday Extended Hours=1` and `=0`, and the served answer
 * came back:
 *
 *   "Extending Friday opening by two hours sets Friday extended hours ACTIVE"
 *   "Keeping the current schedule sets Friday extended hours to its INACTIVE
 *    baseline"
 *
 * The model was not fabricating. A bare 1/0 admits no other reading. But the
 * product's OWN `intervention_details` renders those same two values as
 * "Very high (1)" and "Low (0)" — a position on an ordinal scale, not a switch.
 * The user's screen and the model's context disagreed about what the user's own
 * option means, and the answer followed the context.
 *
 * WHAT THIS PINS: the band travels with the value, using the shared
 * `qualitativeBand` rule that already exists for this purpose. The numeral is
 * kept beside it, because the band alone cannot separate two options that
 * differ within one band.
 *
 * WHAT IT DOES NOT CLAIM: that the served answer is now correct. This changes
 * one field of the AI-facing context. Whether the next answer stops saying
 * "active" is an acceptance, and it is not asserted here.
 */

import { describe, expect, it } from 'vitest';

import { compactGraphForContextPack } from '../../../orchestrator-v5/context/compact-graph-for-contextpack.js';
import { qualitativeBand } from '../../../cee/factor-extraction/display-value.js';

function summariesFor(interventions: Record<string, unknown>[]): string[] {
  const graph = {
    nodes: [
      { id: 'f_friday', kind: 'factor', label: 'Friday Extended Hours' },
      { id: 'goal_rev', kind: 'goal', label: 'Monthly revenue goal' },
      ...interventions.map((iv, i) => ({
        id: `opt_${i}`,
        kind: 'option',
        label: `Option ${i}`,
        data: { interventions: iv },
      })),
    ],
    edges: [
      {
        from: 'f_friday',
        to: 'goal_rev',
        strength: { mean: 0.55, std: 0.07 },
        exists_probability: 0.9,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  } as never;
  const out = compactGraphForContextPack(graph, { requestId: 'req-band-test' });
  expect(out.kind, 'fixture did not compact — the assertions below would prove nothing').toBe(
    'compacted',
  );
  if (out.kind !== 'compacted') throw new Error('not compacted');
  return out.compact.nodes
    .map((n) => (n as { intervention_summary?: string }).intervention_summary)
    .filter((s): s is string => typeof s === 'string');
}

describe('an option setting carries its band into the AI-facing context', () => {
  it('the two captured bookshop values read as a scale, not a switch', () => {
    const [high, low] = summariesFor([{ f_friday: 1 }, { f_friday: 0 }]);
    // Exact strings, because the defect was in the exact string the model read.
    expect(high).toBe('sets Friday Extended Hours=Very high (1)');
    expect(low).toBe('sets Friday Extended Hours=Low (0)');
    // The words match what the product already shows the user for these very
    // values — `intervention_details.display_value` in the served capture.
    expect(high).toContain('Very high');
    expect(low).toContain('Low');
  });

  it('the numeral survives, so two options inside one band stay distinguishable', () => {
    // The band alone would render 0.8 and 0.95 identically and erase a real
    // difference between two saved options. This is why the numeral is kept.
    const [a, b] = summariesFor([{ f_friday: 0.8 }, { f_friday: 0.95 }]);
    expect(qualitativeBand(0.8)).toBe(qualitativeBand(0.95));
    expect(a).not.toBe(b);
    expect(a).toBe('sets Friday Extended Hours=Very high (0.8)');
    expect(b).toBe('sets Friday Extended Hours=Very high (0.95)');
  });

  it('a value off the banded scale keeps its bare form rather than being mislabelled', () => {
    // `qualitativeBand` is documented for normalised 0–1 values. Handing it a
    // value outside that range would attach a label the rule does not warrant,
    // so the range gate returns the established representation instead.
    const [over, under] = summariesFor([{ f_friday: 42 }, { f_friday: -3 }]);
    expect(over).toBe('sets Friday Extended Hours=42');
    expect(under).toBe('sets Friday Extended Hours=-3');
  });

  it('a canonical intervention with a native unit is untouched', () => {
    // PR #1517 established this shape. A banded label must not be attached to a
    // value that already carries its own real-world quantity.
    const [native] = summariesFor([
      { f_friday: { value: 0.69, raw_value: 69, unit: '£/month' } },
    ]);
    expect(native).toBe('sets Friday Extended Hours=69 £/month (model value 0.69)');
    expect(native).not.toContain('Very high');
    expect(native).not.toContain('High');
  });
});
