/**
 * ROADMAP 2.1033 — the SERVER half of "screen = commit".
 *
 * ── The defect, reproduced by EXECUTION at pristine 1ff2469d ───────────────
 * `canonicaliseValueOps` merges the node's existing `observed_state` under a
 * value write so `unit`/`cap` siblings survive. That merge also carried
 * `raw_value` forward — and `raw_value` is the field
 * `synthesiseDisplayValue` reads FIRST (display-value.ts: priorities 1–4 are
 * unreachable-past only when `raw_value` is absent). Editing a 20% factor to
 * 40% therefore committed:
 *
 *   applied observed_state = { value: 0.4, raw_value: 20, unit: '%' }
 *   synthesiseDisplayValue(...)             → "20%"   ← the OLD number
 *   reconcileDisplayAnchors(...) repaired[] → []      ← it AGREED with it
 *
 * The second line is the one that matters. #884's display-anchor
 * reconciliation is not bypassed here — it runs, recomputes the anchor from
 * the same stale `raw_value`, gets "20%" back, and concludes nothing needs
 * repair. A correct fix, fed a lie, reports success.
 *
 * `edit-graph-mutation-correctness-wiring.test.ts` (added by #884 itself)
 * records this defect in a fixture comment as a measured, out-of-scope
 * neighbour: "the value applier updates `observed_state.value` and leaves
 * `raw_value` STALE … That is an APPLIER defect, not a display-anchor
 * defect." This file is that applier defect, closed.
 *
 * ── The authority ruling this file pins ───────────────────────────────────
 * `observed_state.value` is AUTHORITATIVE on the edit path; `raw_value` is a
 * derived artefact that may never outlive it. Not a matter of taste — three
 * independent derivations:
 *   1. `ALLOWED_OBSERVED_SUBKEYS` omits `raw_value`, so an edit op
 *      STRUCTURALLY CANNOT author one (it is `invariant_coupled` in the
 *      editable-field table). A field the writer may not write cannot win.
 *   2. `graph-hash.ts` whitelists `observed_state.{value,baseline,cap}` as
 *      analysis-affecting and excludes `raw_value` as "cosmetic".
 *   3. `analysis-ready.ts` ships `observed_state.value` as the intervention
 *      number the compute path consumes.
 *
 * ── Why the assertions are POSITIVE ───────────────────────────────────────
 * The UI half of this defect was caught by a test asserting
 * `not.toBe('20%')`, which cannot tell "renders 40%" from "renders nothing".
 * Every assertion below names the number it expects.
 *
 * Every assertion binds to its node by ID (`fac_spend`), never by a value
 * predicate a sibling factor could satisfy — `fac_other` exists in the
 * fixture precisely so a value-predicate assertion would be ambiguous.
 */
/**
 * ROADMAP 2.1033 — the SERVER half of "screen = commit".
 *
 * ── The defect, reproduced by EXECUTION at pristine 1ff2469d ───────────────
 * `canonicaliseValueOps` merges the node's existing `observed_state` under a
 * value write so `unit`/`cap` siblings survive. That merge also carried
 * `raw_value` forward — and `raw_value` is the field
 * `synthesiseDisplayValue` reads FIRST (display-value.ts: priorities 1–4 are
 * unreachable-past only when `raw_value` is absent). Editing a 20% factor to
 * 40% therefore committed:
 *
 *   applied observed_state = { value: 0.4, raw_value: 20, unit: '%' }
 *   synthesiseDisplayValue(...)             → "20%"   ← the OLD number
 *   reconcileDisplayAnchors(...) repaired[] → []      ← it AGREED with it
 *
 * The second line is the one that matters. #884's display-anchor
 * reconciliation is not bypassed here — it runs, recomputes the anchor from
 * the same stale `raw_value`, gets "20%" back, and concludes nothing needs
 * repair. A correct fix, fed a lie, reports success.
 *
 * `edit-graph-mutation-correctness-wiring.test.ts` (added by #884 itself)
 * records this defect in a fixture comment as a measured, out-of-scope
 * neighbour: "the value applier updates `observed_state.value` and leaves
 * `raw_value` STALE … That is an APPLIER defect, not a display-anchor
 * defect." This file is that applier defect, closed.
 *
 * ── The authority ruling this file pins ───────────────────────────────────
 * `observed_state.value` is AUTHORITATIVE on the edit path; `raw_value` is a
 * derived artefact that may never outlive it. Not a matter of taste — three
 * independent derivations:
 *   1. `ALLOWED_OBSERVED_SUBKEYS` omits `raw_value`, so an edit op
 *      STRUCTURALLY CANNOT author one (it is `invariant_coupled` in the
 *      editable-field table). A field the writer may not write cannot win.
 *   2. `graph-hash.ts` whitelists `observed_state.{value,baseline,cap}` as
 *      analysis-affecting and excludes `raw_value` as "cosmetic".
 *   3. `analysis-ready.ts` ships `observed_state.value` as the intervention
 *      number the compute path consumes.
 *
 * ── Why the assertions are POSITIVE ───────────────────────────────────────
 * The UI half of this defect was caught by a test asserting
 * `not.toBe('20%')`, which cannot tell "renders 40%" from "renders nothing".
 * Every assertion below names the number it expects.
 *
 * Every assertion binds to its node by ID (`fac_spend`), never by a value
 * predicate a sibling factor could satisfy — `fac_other` exists in the
 * fixture precisely so a value-predicate assertion would be ambiguous.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileObservedValuePair,
  canonicaliseValueOps,
  stampUserEditProvenance,
} from '../../canonicalise-value-ops.js';
import { synthesiseDisplayValue } from '../../../cee/factor-extraction/display-value.js';
import type { PatchOperation } from '../../types.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * TWO factors carrying the SAME observed value (0.2) and the SAME stale
 * raw_value shape. Identity binding is therefore load-bearing: an assertion
 * that found "the factor whose value is 0.4" could match either one after a
 * mutation, which is exactly the wrong-object trap (row 2.1003's neighbour).
 */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Budget' },
      { id: 'opt_a', kind: 'option', label: 'Increase spend' },
      {
        id: 'fac_spend',
        kind: 'factor',
        label: 'Marketing spend',
        display_value: '£20k',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      {
        id: 'fac_other',
        kind: 'factor',
        label: 'Support spend',
        display_value: '£20k',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      { id: 'goal_g', kind: 'goal', label: 'Total return' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_spend', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_other', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_spend', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_other', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

describe('2.1033 — reconcileObservedValuePair: scope and by-reference contract', () => {
  const graph = {
    nodes: [
      {
        id: 'fac_spend',
        kind: 'factor',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
    ],
  };

  function run(ops: PatchOperation[]) {
    return reconcileObservedValuePair(ops, graph);
  }

  it('re-derives the stale sibling from the authoritative value', () => {
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4, raw_value: 20000, unit: '£', cap: 100000 } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect((out[0]!.value as Record<string, Record<string, unknown>>).observed_state.raw_value).toBe(40000);
  });

  it('returns the op BY REFERENCE when the pair already agrees (byte-identical batches)', () => {
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]); // identity, not deep equality
  });

  it('THE BOUNDARY: a payload carrying no raw_value is returned BY REFERENCE', () => {
    // Nothing stale can survive a payload that never carried the field, so
    // this lane does not touch it. Recorded as a deliberate limit: a literal
    // nested `{observed_state:{value}}` op is never merged and the applier's
    // whole-object replace drops unit/cap/raw_value outright. That sibling
    // WIPE is a separate defect (see the module comment), not this one.
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4 } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('IGNORES an op that writes no value — a bare unit payload is returned by reference', () => {
    // ⚠ SCOPE OF THIS TEST, and why it is not enough on its own: it calls the
    // reconciler DIRECTLY, so the payload is exactly what is written here.
    // The composed chain never hands it a payload this bare — see the
    // "COMPOSED chain" describe below, which is the binding that matters.
    const ops = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { unit: '$' } } },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('IGNORES the intervention subtree, whose own raw_value IS authoritative', () => {
    // plot-intervention-scale.ts reads an intervention-level `raw_value` as
    // the absolute truth (`rule: 'raw_value_used'`). This lane must not touch it.
    const ops = [
      {
        op: 'update_node',
        path: 'fac_spend',
        value: { 'data/interventions/fac_spend': { value: 0.8, raw_value: 80000, unit: '£', cap: 100000 } },
      },
    ] as unknown as PatchOperation[];

    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('IGNORES a structural op entirely', () => {
    const ops = [{ op: 'add_node', path: 'fac_new', value: { id: 'fac_new', kind: 'factor', label: 'New' } }] as unknown as PatchOperation[];
    const out = run(ops);
    expect(out[0]).toBe(ops[0]);
  });

  it('POSITIVE CONTROL — the stale pair really IS renderable as the OLD number', () => {
    // Guards this whole file against going vacuous: if the formatter ever
    // stopped preferring raw_value, every assertion above would pass for the
    // wrong reason. This asserts the defect mechanism is still real.
    expect(synthesiseDisplayValue({ value: 0.4, raw_value: 20000, unit: '£', cap: 100000 })).toBe('£20k');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE COMPOSED CHAIN — the binding everything above this line is blind to.
//
// Every test above either drives the full handler on a VALUE edit, or calls
// `reconcileObservedValuePair` DIRECTLY. Neither can see the defect below,
// and CI was green on all of it: of 1,621 tracked `*.test.ts`, 59 call
// `handleEditGraph` and ZERO exercised a unit- or std-only op.
//
// ── The defect, reproduced by execution at pristine 77229a88 ───────────────
// The reconciler documents that it acts only on ops that MOVE
// `observed_state.value`, and the direct-call test above agrees with it. The
// CHAIN does not honour that scope. `canonicaliseValueOps` merges the node's
// existing `observed_state` under EVERY translatable-leaf write
// (`TRANSLATABLE_LEAVES` = value · unit · baseline · std), so a unit-only,
// std-only or baseline-only edit arrives carrying an UNCHANGED `value` AND
// the live `raw_value`. It then resolves `ambiguous` and DELETES `raw_value`
// on an edit that never moved the number. Measured, driving `handleEditGraph`
// with a unit-only op on the £20,000 fixture factor:
//
//   observed_state after edit = { value: 0.2, unit: '%', cap: 100000 }
//                                          ↑ raw_value: 20000 is GONE
//
// ── Why that is a REGRESSION, not a cosmetic gap ───────────────────────────
// `buildFactorScaleMap` grants `normalisedConvention` ONLY when `raw_value`
// is present and proves `value ≈ raw_value / cap`, and that flag is the SOLE
// evidence gate for rule 2 of the egress scale net
// (`plot-intervention-scale.ts`). Deleting `raw_value` therefore changes what
// PLoT/ISL computes on, by a factor of `cap`:
//
//                          normalisedConvention | rule                  | to PLoT
//   before the edit        true                 | cap_denormalised      | 20000
//   after it, at pristine  ABSENT               | ambiguous_no_evidence | 0.2
//
// The consumer is egress-bound and unconditional: `build-turn-context.ts`
// `projectOptionsToRawScale` → `buildFactorScaleMap` +
// `projectInterventionsToRawScale`. So this is the same scientific-truth harm
// row 2.1033 exists to close, arriving by DELETION instead of by staleness.
//
// Nothing can be stale if the value did not move — so an op that leaves
// `value` where it found it is returned untouched.
// ────────────────────────────────────────────────────────────────────────────

describe('2.1033 — the COMPOSED chain: an edit that never moved the value keeps its pair', () => {
  /** EXACTLY the composition both apply seams run (edit-graph.ts, gm-held-execute.ts). */
  function chain(ops: PatchOperation[], graph: unknown): PatchOperation[] {
    return reconcileObservedValuePair(
      stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations, ops),
      graph,
    );
  }

  /** The post-`normalisePath` op spelling the handler feeds the canonicaliser. */
  function leafPatch(nodeId: string, leaf: string, to: unknown): PatchOperation {
    return {
      op: 'update_node',
      path: nodeId,
      value: { [`data/${leaf}`]: to },
    } as unknown as PatchOperation;
  }

  function observedOfOp(op: PatchOperation): Record<string, unknown> {
    return (op.value as Record<string, Record<string, unknown>>).observed_state ?? {};
  }

  it('a unit-only edit keeps value 0.2 AND raw_value 20000 (the pair the chain merged in)', () => {
    const graph = buildGraph();
    const ops = [leafPatch('fac_spend', 'unit', '%')];

    // ── PIN THE PRECONDITION IN-TEST (trap 13b) ──────────────────────────
    // The assertion below is only about the reconciler if the canonicaliser
    // really did merge an unchanged `value` and a live `raw_value` under this
    // unit write. Prove that here, so a fixture that silently stopped
    // reproducing the setup fails LOUD instead of passing vacuously.
    const merged = observedOfOp(canonicaliseValueOps(ops, graph).operations[0]!);
    expect(merged.value).toBe(0.2); // unchanged — the user edited the UNIT
    expect(merged.raw_value).toBe(20000); // live, and about to be deleted
    expect(merged.unit).toBe('%'); // the edit the user DID make

    const observed = observedOfOp(chain(ops, graph)[0]!);

    expect(observed.value).toBe(0.2); // still where the user left it
    expect(observed.raw_value).toBe(20000); // pristine DELETES this
    expect(observed.unit).toBe('%');
    expect(observed.cap).toBe(100000);
  });

  it('the same class, not unit-specific: a std-only edit on a legacy % factor keeps raw_value 20', () => {
    // `{ value: 20, raw_value: 20, unit: '%' }` — the shape the acceptance
    // case above already pins. A std write merges the pair in, the value is
    // outside [0,1] on a `%` factor, so `resolveExistingRawValue` answers
    // `ambiguous` and pristine drops the 20.
    const graph = buildGraph();
    (graph.nodes[2] as Record<string, unknown>).observed_state = {
      value: 20,
      raw_value: 20,
      unit: '%',
    };

    const observed = observedOfOp(chain([leafPatch('fac_spend', 'std', 0.05)], graph)[0]!);

    expect(observed.value).toBe(20);
    expect(observed.raw_value).toBe(20); // pristine DELETES this
    expect(observed.std).toBe(0.05); // the edit the user DID make
  });

  it('a VALUE edit is still reconciled — this lane narrows nothing (control)', () => {
    // The early return must key on "the value did not move", never on "a
    // non-value leaf was written". A value edit that ALSO carries a unit
    // must still re-derive the sibling.
    const graph = buildGraph();
    const ops = [
      {
        op: 'update_node',
        path: 'fac_spend',
        value: { 'data/value': 0.4, 'data/unit': '£' },
      },
    ] as unknown as PatchOperation[];

    const observed = observedOfOp(chain(ops, graph)[0]!);
    expect(observed.value).toBe(0.4);
    expect(observed.raw_value).toBe(40000); // re-derived, not carried forward
  });
});
