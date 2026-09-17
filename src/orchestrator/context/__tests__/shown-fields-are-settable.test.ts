/**
 * ⭐⭐⭐ WE SHOWED THE MODEL FIELDS IT WAS NOT ALLOWED TO SET, AND THE PROMPT TOLD
 * IT TO MIRROR THEM. This file is the measurement and the guard; the fix is the
 * unconditional strip in `budget.ts`.
 *
 * Three facts, each verified at the bytes, which only bite together:
 *   1. The served `edit_graph` prompt says "Mirror the nearest comparable
 *      existing node shape" and names `provenance` / `raw_value`
 *      (served hash `40b79180ad739011`, verified by Core, 17 Sep 2026).
 *   2. `CompactNode` — what the model is SHOWN — emits `raw_value`, `source`
 *      AND `provenance` (`graph-compact.ts:92-122`).
 *   3. `PIPELINE_OWNED_ROOTS` refuses all three at EVERY path segment
 *      (`field-safety.ts:253`).
 * ⇒ The user saw "I couldn't take that change forward, so the model is
 * unchanged." Self-inflicted, and indistinguishable from the model simply being
 * bad at editing — which is the expensive part.
 *
 * ⭐ THE FIX IS A REMOVED CONDITIONAL, NOT NEW BEHAVIOUR. `budget.ts` already
 * deleted `source` — from pass 3, reached only when the graph was STILL over
 * budget. The contradiction was the ordinary path and the relief the exceptional
 * one. So the product has already been running in production, under load, with
 * this absent from the model's view.
 *
 * ⚠ AND A GREEN SUITE AFTER THAT REMOVAL PROVES LESS THAN IT LOOKS: pass 3 had
 * ZERO test coverage. Nothing moved when it went because nothing watched it.
 * That is precisely why these assertions exist now.
 */
import { describe, expect, it } from 'vitest';

import { PIPELINE_OWNED_ROOTS } from '../../../orchestrator-v5/graph-management/field-safety.js';
import { compactGraphForContextPack } from '../../../orchestrator-v5/context/compact-graph-for-contextpack.js';

function sampleGraph() {
  return {
    nodes: [
      {
        id: 'n1',
        kind: 'factor',
        label: 'Tech Lead Hiring Cost',
        category: 'observable',
        observed_state: { value: 0.8, raw_value: 80000, unit: '£', source: 'cee_inference' },
      },
      {
        id: 'n2',
        kind: 'option',
        label: 'Hire a Tech Lead',
        category: 'controllable',
        interventions: { n1: 0.8 },
      },
      { id: 'n3', kind: 'goal', label: 'Increase Productivity', category: 'observable' },
    ],
    edges: [{ from: 'n1', to: 'n3', effect_direction: 'negative' }],
  } as unknown as Record<string, unknown>;
}

/** Keys that actually reach the model, derived — never hand-listed. */
function keysShownToTheModel(): Set<string> {
  // ⭐ Bound to the MODEL-FACING seam, not to `budget.ts`. Asserting against the
  // budget layer was my first attempt and four of its own tests refused it: that
  // layer contracts byte-identity for an under-budget context and detects
  // trimming by reference inequality. "Trimmed under pressure" and "not part of
  // the model's view" are different questions; this file asks the second.
  const outcome = compactGraphForContextPack(sampleGraph() as never, { requestId: 'test' } as never);
  if (outcome.kind !== 'compacted') throw new Error(`expected compacted, got ${outcome.kind}`);
  const keys = new Set<string>();
  for (const node of outcome.compact.nodes as unknown as ReadonlyArray<Record<string, unknown>>) {
    for (const k of Object.keys(node)) keys.add(k.toLowerCase());
  }
  return keys;
}

describe('the model is not shown provenance it is forbidden to set', () => {
  it('PRECONDITION: both sources are non-empty, so an intersection means something', () => {
    // An intersection with an empty set is empty and proves nothing. This estate
    // has shipped that vacuity, so the guard asserts its own inputs first.
    expect(PIPELINE_OWNED_ROOTS.size, 'refused segments').toBeGreaterThan(5);
    expect(keysShownToTheModel().size, 'keys reaching the model').toBeGreaterThan(5);
  });

  it('RED-first: `source` and `provenance` are gone on the ORDINARY path', () => {
    // Before the fix these survived unless the graph was over budget — this
    // sample is nowhere near the budget, which is the point.
    const shown = keysShownToTheModel();
    expect(shown.has('source'), 'provenance enum must not reach the model').toBe(false);
    expect(shown.has('provenance'), 'display provenance must not reach the model').toBe(false);
  });

  it('⛔ but `raw_value` SURVIVES — this is the line to argue with, not an oversight', () => {
    // `raw_value` is refused by the referee too, so by symmetry it "should" go.
    // It is not metadata: it is the NATIVE magnitude, what lets the model see
    // £80,000 instead of 0.8. Stripping it would degrade the model's view in
    // exactly the dimension this programme is trying to repair. Where a field is
    // load-bearing context AND unsettable, the defect is the REFUSAL, not the
    // showing — and that half belongs to the referee lane, not this one.
    expect(keysShownToTheModel().has('raw_value')).toBe(true);
  });

  it('THE REMAINING OVERLAP — derived, and REDs if it grows OR shrinks', () => {
    const shown = keysShownToTheModel();
    const overlap = [...shown].filter((k) => PIPELINE_OWNED_ROOTS.has(k)).sort();
    // ⚠ This began at THREE — I hand-pinned two from reading `CompactNode`'s
    // declaration and the derivation returned `provenance` as well, before the
    // file ever shipped. That is the case for computing the set rather than
    // restating it, and it is why the remaining entry is one I can defend
    // individually rather than a list I copied.
    expect(
      overlap,
      'every field still shown to the model that its referee will refuse',
    ).toEqual(['raw_value']);
  });

  it('⛔ EDGE provenance still reaches the model — the scope boundary, stated', () => {
    // The strip is NODE-scoped because that is where the prompt points:
    // "mirror the nearest comparable existing NODE shape". Edge `provenance` is
    // refused by the same rule and has its own consumers, so widening to it is a
    // separate change with its own evidence — not a tidy-up to fold in here.
    // Pinned so the boundary is a decision on the record rather than something a
    // later reader discovers and assumes was an oversight.
    const outcome = compactGraphForContextPack(sampleGraph() as never, { requestId: 'test' } as never);
    if (outcome.kind !== 'compacted') throw new Error('expected compacted');
    const edgeKeys = new Set(
      (outcome.compact.edges as unknown as ReadonlyArray<Record<string, unknown>>).flatMap((e) =>
        Object.keys(e).map((k) => k.toLowerCase()),
      ),
    );
    expect(edgeKeys.has('provenance'), 'edges are out of scope for this change').toBe(true);
  });
});
