/**
 * ROADMAP 2.396(b) — "CEE writes observed_state WITHOUT `source` on chat-set
 * values → the 'User edited' pill can never earn on that lane."
 *
 * ── The measured defect (P4 transport lane, 2026-08-05) ─────────────────────
 * The UI's `isReviewedByUser` earns the "User edited" pill from
 * `observed_state.source` ∈ {user_confirmed, user_assumption, user_override,
 * user, user_edited} (witnessed pill-earning wire literal, runE2 of
 * journey-witness-final-2026-08-04: `observed_state.source:"user_override"`).
 * CEE's chat-edit lanes wrote NO source at all:
 *   · edit-graph normal path + held/confirm path (via canonicalise-value-ops):
 *     nothing stamped — neither `source` nor `provenance`;
 *   · set_factor_value: stamps `provenance:'user_set'` only, and the V3
 *     response transform CLOBBERS node provenance from extractionType
 *     (`schema-v3.ts` — `v3Node.provenance = nodeProvenanceDisplay(...)`), so
 *     the provenance rung is unreliable on the wire; `observed_state.source`
 *     is the carrier that demonstrably survives to the UI.
 * So every chat-set value rendered as "Olumi estimate — check first" forever.
 *
 * ── The fix pinned here ─────────────────────────────────────────────────────
 * `stampUserEditProvenance` (canonicalise-value-ops.ts) stamps, INTO THE OP
 * (pre-apply, so the stamp rides the applier → canonical parse →
 * `batchFullyLanded` unchanged — stamping the canonical graph after the fact
 * would trip `updateWritesSurvived`'s deepEqual):
 *   · `observed_state.source: 'user_override'` — the pill's primary rung;
 *   · node-level `provenance: 'user_set'` — the set_factor_value precedent.
 * Applied at BOTH edit seams (edit-graph.ts and gm-held-execute.ts — the held
 * half is pinned in gm-held-provenance-stamp.test.ts).
 *
 * Plus the schema half: `ObservedStateV3.source` was
 * z.enum(['brief_extraction','cee_inference']) — structurally incapable of
 * carrying ANY user stamp, and a UI-stamped persisted graph (the UI writes
 * user_override / user_confirmed / user into the shared store since #581)
 * would FAIL CEE's GraphV3 parse at every edit seam. Widened to the user-owned
 * literals the estate actually writes.
 */
/**
 * ROADMAP 2.396(b) — "CEE writes observed_state WITHOUT `source` on chat-set
 * values → the 'User edited' pill can never earn on that lane."
 *
 * ── The measured defect (P4 transport lane, 2026-08-05) ─────────────────────
 * The UI's `isReviewedByUser` earns the "User edited" pill from
 * `observed_state.source` ∈ {user_confirmed, user_assumption, user_override,
 * user, user_edited} (witnessed pill-earning wire literal, runE2 of
 * journey-witness-final-2026-08-04: `observed_state.source:"user_override"`).
 * CEE's chat-edit lanes wrote NO source at all:
 *   · edit-graph normal path + held/confirm path (via canonicalise-value-ops):
 *     nothing stamped — neither `source` nor `provenance`;
 *   · set_factor_value: stamps `provenance:'user_set'` only, and the V3
 *     response transform CLOBBERS node provenance from extractionType
 *     (`schema-v3.ts` — `v3Node.provenance = nodeProvenanceDisplay(...)`), so
 *     the provenance rung is unreliable on the wire; `observed_state.source`
 *     is the carrier that demonstrably survives to the UI.
 * So every chat-set value rendered as "Olumi estimate — check first" forever.
 *
 * ── The fix pinned here ─────────────────────────────────────────────────────
 * `stampUserEditProvenance` (canonicalise-value-ops.ts) stamps, INTO THE OP
 * (pre-apply, so the stamp rides the applier → canonical parse →
 * `batchFullyLanded` unchanged — stamping the canonical graph after the fact
 * would trip `updateWritesSurvived`'s deepEqual):
 *   · `observed_state.source: 'user_override'` — the pill's primary rung;
 *   · node-level `provenance: 'user_set'` — the set_factor_value precedent.
 * Applied at BOTH edit seams (edit-graph.ts and gm-held-execute.ts — the held
 * half is pinned in gm-held-provenance-stamp.test.ts).
 *
 * Plus the schema half: `ObservedStateV3.source` was
 * z.enum(['brief_extraction','cee_inference']) — structurally incapable of
 * carrying ANY user stamp, and a UI-stamped persisted graph (the UI writes
 * user_override / user_confirmed / user into the shared store since #581)
 * would FAIL CEE's GraphV3 parse at every edit seam. Widened to the user-owned
 * literals the estate actually writes.
 */
import { describe, it, expect } from 'vitest';

import {
  canonicaliseValueOps,
  stampUserEditProvenance,
  reconcileObservedValuePair,
} from '../canonicalise-value-ops.js';
import { GraphV3, ObservedStateV3 } from '../../schemas/cee-v3.js';
import type { PatchOperation } from '../types.js';

// ── schema half: the enum can now carry the user's stamp ────────────────────

describe('ObservedStateV3.source — the user-owned members exist', () => {
  it('accepts every source literal the estate actually writes', () => {
    // Producers (CEE): brief_extraction, cee_inference. User-owned (UI writers
    // + this lane's stamp): the five literals the UI's REVIEWED_SOURCES
    // recognises. A UI-stamped stored graph must not fail CEE's edit-seam
    // parse.
    for (const source of [
      'brief_extraction',
      'cee_inference',
      'user_override',
      'user_confirmed',
      'user_assumption',
      'user',
      'user_edited',
    ]) {
      const r = ObservedStateV3.safeParse({ value: 0.5, source });
      expect(r.success, `source '${source}' must parse`).toBe(true);
    }
  });

  it('still REJECTS an arbitrary string — the vocabulary stays closed', () => {
    expect(ObservedStateV3.safeParse({ value: 0.5, source: 'llm_generated' }).success).toBe(false);
    expect(ObservedStateV3.safeParse({ value: 0.5, source: '' }).success).toBe(false);
  });

  it('a graph whose factor carries a UI stamp parses (the pre-fix parse failure)', () => {
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        {
          id: 'f',
          kind: 'factor',
          label: 'Factor',
          observed_state: { value: 0.7, source: 'user_override' },
        },
      ],
      edges: [
        {
          from: 'f',
          to: 'g',
          strength: { mean: 0.4, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'positive',
        },
      ],
    };
    expect(GraphV3.safeParse(graph).success).toBe(true);
  });
});

// ── the stamp function ──────────────────────────────────────────────────────

const CURRENT_GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    {
      id: 'fac_target',
      kind: 'factor',
      label: 'Target factor',
      observed_state: { value: 0.2, unit: '£', raw_value: 20000, cap: 100000 },
    },
    { id: 'fac_other', kind: 'factor', label: 'Untouched factor' },
  ],
  edges: [],
};

function valueOp(overrides: Partial<PatchOperation> = {}): PatchOperation {
  return {
    op: 'update_node',
    path: 'fac_target',
    value: { 'data/value': 0.5 },
    ...overrides,
  } as PatchOperation;
}

/**
 * Canonicalise, stamp, then reconcile the value pair — the exact composition
 * both seams run.
 *
 * ⚠ 2.1033: this helper is a MIRROR of the seams' chain, and it silently
 * stopped being one. It ran only canonicalise+stamp while both seams gained a
 * third step, so it asserted a `raw_value` the product no longer persists.
 * Kept in sync deliberately — if you add a step to either seam, add it here,
 * or this file's comment becomes the most convincing stale claim in the repo.
 */
function canonicaliseAndStamp(ops: PatchOperation[]): PatchOperation[] {
  return reconcileObservedValuePair(
    stampUserEditProvenance(canonicaliseValueOps(ops, CURRENT_GRAPH).operations, ops),
    CURRENT_GRAPH,
  );
}

describe('stampUserEditProvenance — the op-level stamp', () => {
  it('stamps source + provenance onto a translated value op, BOUND BY PATH IDENTITY', () => {
    const [stamped] = canonicaliseAndStamp([valueOp()]);
    expect(stamped!.op).toBe('update_node');
    expect(stamped!.path).toBe('fac_target'); // identity, not a value predicate
    const v = stamped!.value as Record<string, unknown>;
    const observed = v.observed_state as Record<string, unknown>;
    expect(observed.source).toBe('user_override');
    expect(v.provenance).toBe('user_set');
    // The merge siblings the canonicaliser threaded are untouched.
    expect(observed.value).toBe(0.5);
    expect(observed.unit).toBe('£');
    // 2.1033 — was `20000`, which pinned the defect: the op moved `value` to
    // 0.5 of a 100000 cap (= £50k) while the denormalised sibling the
    // formatter reads FIRST still said £20k, so the canvas kept rendering the
    // number the user had just replaced. The sibling is now re-derived from
    // the authoritative `value` (0.5 x 100000).
    expect(observed.raw_value).toBe(50000);
    expect(observed.cap).toBe(100000);
  });

  it('stamps a CANONICALLY-spelled observed_state value write too (no translation needed)', () => {
    const [stamped] = stampUserEditProvenance([
      valueOp({ value: { observed_state: { value: 0.9, unit: '£' } } }),
    ]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.source).toBe('user_override');
    expect(observed.value).toBe(0.9);
    expect(observed.unit).toBe('£');
  });

  it('OVERRIDES an LLM-claimed producer source — the user confirmed this write', () => {
    const [stamped] = stampUserEditProvenance([
      valueOp({ value: { observed_state: { value: 0.9, source: 'cee_inference' } } }),
    ]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.source).toBe('user_override');
  });

  it('clears a prior panel citation from an ordinary canonical value write', () => {
    const [stamped] = stampUserEditProvenance([
      valueOp({
        value: {
          observed_state: {
            value: 0.9,
            source: 'panel_elicited',
            elicited_from: {
              round_id: 'round-prior',
              participant_id: 'participant-prior',
              evidence_event_id: 'evidence-prior',
            },
          },
        },
      }),
    ]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.source).toBe('user_override');
    expect(observed.elicited_from).toBeUndefined();
    expect('elicited_from' in observed).toBe(false);
  });

  // ⭐ The chat-edit twin of set_factor_value's fix (served witness 23 Sep:
  // CEE stored `{ source: 'user_override', extractionType: 'inferred' }` and the
  // UI card read the user's number as "est."). `canonicaliseValueOps` carries
  // stored observed-state siblings forward, so without an explicit removal the
  // producer's extraction marker rides the user's value into the store.
  it("withdraws the producer's extractionType when the user writes the value", () => {
    const currentGraph = {
      nodes: [
        {
          id: 'fac_target',
          observed_state: { value: 0.5, source: 'cee_inference', extractionType: 'inferred' },
        },
      ],
    };
    const original = valueOp({ value: { 'data/value': 0.3 } });
    const canonical = canonicaliseValueOps([original], currentGraph).operations;
    const [stamped] = stampUserEditProvenance(canonical, [original]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.value).toBe(0.3);
    expect(observed.source).toBe('user_override');
    expect('extractionType' in observed).toBe(false);
  });

  it('CONTROL: a unit-only edit is not the user authoring the value — the extraction marker stays', () => {
    const currentGraph = {
      nodes: [
        {
          id: 'fac_target',
          observed_state: { value: 0.5, unit: 'GBP', source: 'cee_inference', extractionType: 'inferred' },
        },
      ],
    };
    const original = valueOp({ value: { 'data/unit': 'USD' } });
    const canonical = canonicaliseValueOps([original], currentGraph).operations;
    const [stamped] = stampUserEditProvenance(canonical, [original]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    > | undefined;
    if (observed !== undefined) expect(observed.extractionType).toBe('inferred');
  });

  it('does NOT stamp a value-less observed_state write (unit-only edits are not the pill claim)', () => {
    const op = valueOp({ value: { observed_state: { unit: '%' } } });
    const [out] = stampUserEditProvenance([op]);
    expect(out).toBe(op); // by reference — untouched
  });

  it.each([
    ['unit', 'USD'],
    ['std', 0.2],
  ])('preserves panel attribution through a composed %s-only edit', (leaf, nextValue) => {
    const currentGraph = {
      nodes: [
        {
          id: 'fac_target',
          observed_state: {
            value: 0.5,
            unit: 'GBP',
            std: 0.1,
            source: 'panel_elicited',
            elicited_from: {
              round_id: 'round-prior',
              participant_id: 'participant-prior',
              evidence_event_id: 'evidence-prior',
            },
          },
        },
      ],
    };
    const original = valueOp({ value: { [`data/${leaf}`]: nextValue } });
    const canonical = canonicaliseValueOps([original], currentGraph).operations;
    const [stamped] = stampUserEditProvenance(canonical, [original]);
    const observed = (stamped!.value as Record<string, unknown>).observed_state as Record<
      string,
      unknown
    >;
    expect(observed.source).toBe('panel_elicited');
    expect(observed.elicited_from).toEqual({
      round_id: 'round-prior',
      participant_id: 'participant-prior',
      evidence_event_id: 'evidence-prior',
    });
  });

  it('does NOT stamp non-update_node ops or label-only updates, and returns them BY REFERENCE', () => {
    const addOp = {
      op: 'add_node',
      path: 'risk_x',
      value: { id: 'risk_x', kind: 'risk', label: 'Risk' },
    } as PatchOperation;
    const labelOp = valueOp({ value: { label: 'Renamed' } });
    const out = stampUserEditProvenance([addOp, labelOp]);
    expect(out[0]).toBe(addOp);
    expect(out[1]).toBe(labelOp);
  });

  it('never mutates its input ops', () => {
    const op = valueOp({ value: { observed_state: { value: 0.9 } } });
    const frozen = JSON.parse(JSON.stringify(op));
    stampUserEditProvenance([op]);
    expect(op).toEqual(frozen);
  });
});
