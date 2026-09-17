/**
 * A bare model value carries no established meaning, and the context says so.
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
 * ⚠ THE FIRST VERSION OF THIS FILE ARGUED THE VALUE WAS ORDINAL, because the
 * UI renders it "Very high (1)". Review CX-20260916-90 corrected that and the
 * correction is the substance here: a bare 1/0 establishes NEITHER a binary
 * NOR an ordinal reading, and a display band is a formatter fallback, not
 * semantic evidence. Asserting "Very high" in the model's context would have
 * moved the model's unwarranted reading one layer upstream and given it our
 * authority — worse, because the model can hedge a raw number and cannot hedge
 * a label we asserted.
 *
 * WHAT THIS PINS: the three things are stated separately — the model value
 * (fact), the display band (how the UI renders it), and that the real-world
 * meaning is NOT established. The numeral is kept because a band alone cannot
 * separate two options differing within one band.
 *
 * WHAT IT DOES NOT CLAIM: that the served answer is now correct. This changes
 * one field of the AI-facing context. Whether the next answer stops saying
 * "active" is an acceptance, and it is not asserted here.
 */

import { describe, expect, it } from 'vitest';

import { compactGraphForContextPack } from '../../../orchestrator-v5/context/compact-graph-for-contextpack.js';
import { qualitativeBand } from '../../../cee/factor-extraction/display-value.js';
import { assembleContextPack } from '../../../orchestrator-v5/context/context-pack-assembler.js';
import { buildUserMessage } from '../../../orchestrator-v5/routing/route-with-tool-use.js';
import { makeMessagePayload } from '../../../orchestrator-v5/__tests__/fixtures.js';
import { observeSerialisedPack } from '../../../orchestrator-v5/context/__tests__/observe-serialised-pack.js';

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

describe('an option setting reaches the model with its meaning qualified', () => {
  it('the two captured bookshop values arrive qualified, asserting no scale at all', () => {
    const [high, low] = summariesFor([{ f_friday: 1 }, { f_friday: 0 }]);
    // Exact strings, because the defect was in the exact string the model read.
    expect(high).toBe(
      'sets Friday Extended Hours=model value 1 (display band Very high; real-world meaning not established)',
    );
    expect(low).toBe(
      'sets Friday Extended Hours=model value 0 (display band Low; real-world meaning not established)',
    );
    // THE DISCLAIMER IS LOAD-BEARING, NOT DECORATION. Without it this string
    // asserts an ordinal scale the stored value does not establish — the same
    // unwarranted reading the model made, moved one layer upstream and given
    // our authority. Pinned so a future tidy-up cannot quietly drop it.
    for (const s of [high, low]) {
      expect(s).toContain('model value');
      expect(s).toContain('display band');
      expect(s).toContain('real-world meaning not established');
    }
  });

  it('the numeral survives, so two options inside one band stay distinguishable', () => {
    // The band alone would render 0.8 and 0.95 identically and erase a real
    // difference between two saved options. This is why the numeral is kept.
    const [a, b] = summariesFor([{ f_friday: 0.8 }, { f_friday: 0.95 }]);
    expect(qualitativeBand(0.8)).toBe(qualitativeBand(0.95));
    expect(a).not.toBe(b);
    expect(a).toContain('model value 0.8');
    expect(b).toContain('model value 0.95');
  });

  it('a value off the banded scale keeps its bare form rather than being mislabelled', () => {
    // `qualitativeBand` is documented for normalised 0–1 values. Handing it a
    // value outside that range would attach a label the rule does not warrant,
    // so the range gate returns the established representation instead.
    const [over, under] = summariesFor([{ f_friday: 42 }, { f_friday: -3 }]);
    expect(over).toBe(
      'sets Friday Extended Hours=model value 42 (real-world meaning not established)',
    );
    expect(under).toBe(
      'sets Friday Extended Hours=model value -3 (real-world meaning not established)',
    );
    // No band is claimed off the normalised domain — asserting one there would
    // be exactly the unwarranted promotion this change exists to stop.
    for (const s of [over, under]) expect(s).not.toContain('display band');
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

/**
 * ⭐ DOES IT ACTUALLY REACH THE MODEL? The compactor is not the wire.
 *
 * Everything above asserts what `compactGraphForContextPack` returns. Between
 * that and the provider sit the context-pack assembler, the budget pass that
 * drops `intervention_summary` wholesale under pressure, and
 * `buildUserMessage`. A field that is correct in the compactor and dropped
 * before serialisation is this estate's oldest failure — built, and not
 * plugged in.
 *
 * So this block runs the real assembler and the real serialiser and reads the
 * string out of the message the model would actually receive. The technique is
 * the reviewer's, from the CX-20260916-90 witness; reused rather than
 * reinvented.
 */
describe('the qualification survives into the serialised model-facing request', () => {
  function serialisedSummaryFor(entry: unknown): string | undefined {
    const graph = {
      nodes: [
        { id: 'factor', kind: 'factor', label: 'Friday Extended Hours' },
        { id: 'goal', kind: 'goal', label: 'Staff burnout' },
        { id: 'option', kind: 'option', label: 'Extend hours', data: { interventions: { factor: entry } } },
      ],
      edges: [
        {
          from: 'factor',
          to: 'goal',
          strength: { mean: 0.55, std: 0.07 },
          exists_probability: 0.9,
          effect_direction: 'positive',
          provenance: { source: 'brief_extraction' },
        },
      ],
    } as never;
    const out = compactGraphForContextPack(graph, { requestId: 'req-serialised-band' });
    expect(out.kind, 'fixture did not compact').toBe('compacted');
    if (out.kind !== 'compacted') throw new Error('not compacted');
    const question = 'What does each option actually change?';
    const pack = assembleContextPack({
      payload: makeMessagePayload({ message: question }),
      priorTurns: [],
      priorFacts: [],
      compactedGraph: out.compact,
      graphContext: { status: 'canonical' },
    });
    const sent = observeSerialisedPack(buildUserMessage(pack, question)) as {
      graph?: { nodes?: Array<{ id: string; intervention_summary?: string }> };
    };
    return sent.graph?.nodes?.find((n) => n.id === 'option')?.intervention_summary;
  }

  it('the model receives the model value, the band and the disclaimer', () => {
    const summary = serialisedSummaryFor(1);
    // Asserted on the SERIALISED message, not on the compactor's return value.
    expect(summary).toBe(
      'sets Friday Extended Hours=model value 1 (display band Very high; real-world meaning not established)',
    );
  });

  it('a native carrier still reaches the model with its real quantity', () => {
    // Positive control in the other direction: the serialiser is demonstrably
    // capable of carrying a DIFFERENT summary through, so the assertion above
    // is a measurement of this change and not of a constant.
    const summary = serialisedSummaryFor({ value: 0.69, raw_value: 69, unit: '£/month' });
    expect(summary).toBe('sets Friday Extended Hours=69 £/month (model value 0.69)');
    expect(summary).not.toContain('display band');
  });
});
