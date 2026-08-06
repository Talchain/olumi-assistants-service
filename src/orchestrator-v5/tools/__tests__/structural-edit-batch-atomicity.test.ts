/**
 * ROADMAP 2.474 / AMENDMENT A2 — THE BATCH-GOVERNING INVARIANT, PINNED.
 *
 * This is an invariant to PIN, not to build around. The live gate returns ONE
 * governing verdict per batch, with conservative severity precedence
 * (`rejected > stale > held > clarify_required > proceed`). Consequences the
 * design depends on absolutely:
 *
 *   · a batch containing ANY hold-class op is held WHOLE — its value ops do
 *     NOT pre-apply;
 *   · one confirm applies all of it, one reject applies none of it;
 *   · DISCLOSED-PARTIAL CANNOT OCCUR.
 *
 * That last line is the one worth defending. The brief's own routing paragraph
 * ("structural ops HELD, value ops auto-apply") reads naturally as per-op
 * splitting, and a builder improving the gate in that direction would ship the
 * composite-batch nightmare: the user declines the hold, and half the batch is
 * already in their model. The tests below are what stops that being a tidy-up
 * someone does on a quiet afternoon.
 *
 * Every assertion binds to a NAMED op by id (trap 19). The batches here are
 * deliberately MIXED — a tunable update that would auto-apply on its own,
 * plus a structural add that must hold — because a same-class batch could
 * satisfy every assertion below while per-op splitting was live.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import {
  buildStructuralEditGrounding,
  validateProposedStructuralEdit,
} from '../propose-structural-edit.js';
import { buildReadyGraph, hashOf } from '../../graph-management/__tests__/fixtures.js';
import * as telemetry from '../../../utils/telemetry.js';

const GRAPH = buildReadyGraph();
const HASH = hashOf(GRAPH);
const OPTS = { maxPatchOperations: 15 } as const;

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

/** Validate a tool payload and return the canonical batch, or fail loudly. */
function composed(payload: unknown) {
  const result = validateProposedStructuralEdit(payload, grounding(), OPTS);
  if (!result.ok) throw new Error(`grounding validator rejected the fixture: ${result.code}`);
  return result.operations;
}

function gateFor(operations: readonly { op: string; path: string; value?: unknown }[]) {
  return evaluateEditGraphMutations({
    mode: 'live',
    operations,
    currentGraph: GRAPH,
    currentGraphHash: HASH,
    baseGraphHash: HASH,
    freshness: 'fresh',
    scenarioId: 'scn-2474',
    turnId: 'turn-2474',
    requestId: 'req-2474',
  });
}

/**
 * THE MIXED BATCH. `f-spend`'s observed value is a TUNABLE (would_apply on its
 * own); `f-referrals` + its link are STRUCTURAL (held). If the gate ever split
 * per op, the tunable would land while the structure waited.
 */
const MIXED_TOOL_PAYLOAD = {
  operations: [
    {
      op: 'update_node',
      path: 'f-spend',
      target_label: 'Marketing spend',
      value: { observed_state: { value: 0.77 } },
    },
    {
      op: 'add_node',
      path: 'f-referrals',
      value: { id: 'f-referrals', kind: 'factor', label: 'Referral rate' },
    },
    {
      op: 'add_edge',
      path: 'f-referrals::g-profit',
      value: { from: 'f-referrals', to: 'g-profit' },
    },
  ],
};

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

describe('A2 — a mixed batch from the tool is held WHOLE; no value op pre-applies', () => {
  it('returns ONE governing verdict of `held` for the whole batch', () => {
    const decision = gateFor(composed(MIXED_TOOL_PAYLOAD));
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
  });

  it('the tunable op is INSIDE the hold — it is not applied and not split out', () => {
    const decision = gateFor(composed(MIXED_TOOL_PAYLOAD));
    const pending = decision.pendingActions?.[0];
    expect(pending).toBeDefined();
    const action = pending!.action as {
      kind: string;
      inline_patch: { operations?: { op: string; path: string }[] };
    };
    expect(action.kind).toBe('apply_proposed_change');
    const heldPaths = (action.inline_patch.operations ?? []).map((o) => `${o.op}:${o.path}`);
    // Bound by IDENTITY — these three ops, by op+path, not "three operations".
    expect(heldPaths).toEqual([
      'update_node:f-spend',
      'add_node:f-referrals',
      'add_edge:f-referrals::g-profit',
    ]);
  });

  it('the verdict tally shows the tunable WOULD have applied alone — so the hold is doing work', () => {
    // Without this, the test above could pass on a batch where nothing was
    // ever auto-appliable: a guard agreeing with itself (trap 13b).
    const soloTunable = composed({
      operations: [MIXED_TOOL_PAYLOAD.operations[0]],
    });
    const solo = gateFor(soloTunable);
    expect(solo.governing).toBe('proceed');
    expect(solo.blockApply).toBe(false);

    const mixed = gateFor(composed(MIXED_TOOL_PAYLOAD));
    expect(mixed.verdictCounts.would_apply).toBe(1);
    expect(mixed.verdictCounts.held).toBe(2);
    expect(mixed.governing).toBe('held');
  });

  it('exactly ONE pending is minted for the whole batch — never one per op', () => {
    const decision = gateFor(composed(MIXED_TOOL_PAYLOAD));
    expect(decision.pendingActions).toHaveLength(1);
    expect(decision.suggestedActions).toHaveLength(1);
  });
});

describe('A2 — a reject applies NOTHING, and holds nothing either', () => {
  it('one bad id among four good ops ⇒ whole batch rejected, zero pendings, no chip to confirm', () => {
    // The grounding validator stops this batch before the gate ever sees it
    // (proved in propose-structural-edit-grounding.test.ts). This asserts the
    // gate's own posture on the same shape, because the invariant must hold at
    // BOTH rungs — the tool is not the only producer that reaches this gate.
    const decision = gateFor([
      { op: 'update_node', path: 'f-spend', value: { observed_state: { value: 0.6 } } },
      { op: 'update_node', path: 'f-reach', value: { observed_state: { value: 0.6 } } },
      { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New' } },
      { op: 'update_node', path: 'f-imagined', value: { observed_state: { value: 0.6 } } },
    ]);
    expect(decision.governing).toBe('rejected');
    expect(decision.blockApply).toBe(true);
    expect(decision.pendingActions).toBeNull();
    expect(decision.suggestedActions).toEqual([]);
  });

  it('rejection outranks a hold in the SAME batch — precedence is conservative, not positional', () => {
    // The hold-class op comes FIRST here. A precedence implemented as
    // "first verdict wins" would answer `held` and mint a pending the user
    // could confirm — applying a batch containing an impossible op.
    const decision = gateFor([
      { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New' } },
      { op: 'update_node', path: 'f-imagined', value: { observed_state: { value: 0.6 } } },
    ]);
    expect(decision.governing).toBe('rejected');
    expect(decision.pendingActions).toBeNull();
  });
});

describe('A2 — precedence order, pinned end to end (rejected > stale > held > clarify > proceed)', () => {
  it('stale outranks held: a diverged base stales the whole batch, no hold offered', () => {
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: composed(MIXED_TOOL_PAYLOAD),
      currentGraph: GRAPH,
      currentGraphHash: HASH,
      baseGraphHash: 'a-different-hash-entirely',
      freshness: 'fresh',
      scenarioId: 'scn-2474',
      turnId: 'turn-2474',
      requestId: 'req-2474',
    });
    expect(decision.governing).toBe('stale');
    expect(decision.pendingActions).toBeNull();
  });

  it('an all-tunable batch proceeds — the invariant is a floor on partiality, not a ban on applying', () => {
    const decision = gateFor(
      composed({
        operations: [
          {
            op: 'update_node',
            path: 'f-spend',
            target_label: 'Marketing spend',
            value: { observed_state: { value: 0.55 } },
          },
          {
            op: 'update_node',
            path: 'f-reach',
            target_label: 'Audience reach',
            value: { observed_state: { value: 0.45 } },
          },
        ],
      }),
    );
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
    expect(decision.pendingActions).toBeNull();
  });
});

/**
 * ⭐⭐ ROADMAP 2.474 / A3 — SPLITTING IS NOT DISCLOSED-PARTIAL, AND THE TWO
 * MUST STAY TELLABLE APART.
 *
 * A3 makes an over-cap request become SEVERAL proposals instead of a dead
 * turn. The obvious way to get that wrong is to let it become disclosed-partial
 * by the back door: submit the whole batch, apply what fits, disclose the rest.
 * That is the composite-batch nightmare this file exists to prevent, wearing a
 * friendlier sentence.
 *
 * The distinction is structural, and this is where it is pinned:
 *
 *   DISCLOSED-PARTIAL — one batch reaches the gate; the verdict governs only
 *     some of what it was given.
 *   SPLITTING         — part 1 reaches the gate and the verdict governs ALL of
 *     part 1. The remainder reaches NOTHING: no verdict, no pending, no chip.
 *
 * So the assertions below are about what the gate was GIVEN and what it HELD,
 * bound by op+path identity — never about how the outcome was described.
 */
describe('⭐⭐ A3 — a SPLIT proposes one part WHOLE and submits nothing else', () => {
  const DRIVERS = [
    { id: 'f-driver-a', label: 'Plan A cost driver' },
    { id: 'f-driver-b', label: 'Plan B cost driver' },
    { id: 'f-driver-c', label: 'Shared overhead driver' },
  ] as const;
  const TARGETS = ['g-profit', 'f-spend', 'f-reach', 'd-choice'] as const;

  /** Probe C's measured composition: 3 node ops + 12 edge ops. */
  const PROBE_C_PAYLOAD = {
    operations: DRIVERS.flatMap((d) => [
      { op: 'add_node', path: d.id, value: { id: d.id, kind: 'factor', label: d.label } },
      ...TARGETS.map((t) => ({
        op: 'add_edge',
        path: `${d.id}::${t}`,
        value: { from: d.id, to: t },
      })),
    ]),
  };

  function partsOf() {
    const result = validateProposedStructuralEdit(PROBE_C_PAYLOAD, grounding(), OPTS);
    if (!result.ok) throw new Error(`validator rejected probe C: ${result.code}`);
    return result;
  }

  it('the batch really is over-cap — otherwise this whole block tests nothing', () => {
    expect(PROBE_C_PAYLOAD.operations).toHaveLength(15);
    expect(partsOf().parts.length).toBeGreaterThan(1);
  });

  it('the gate is given ONE part, and its single verdict governs EVERY operation in it', () => {
    const { parts } = partsOf();
    const decision = gateFor(parts[0]!.operations as { op: string; path: string; value?: unknown }[]);
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
    // One verdict for the batch, one pending for the batch — never one per op.
    expect(decision.pendingActions).toHaveLength(1);
    expect(decision.suggestedActions).toHaveLength(1);
    // Every op in part 0 is inside that hold, bound by op+path IDENTITY.
    const action = decision.pendingActions![0]!.action as {
      inline_patch: { operations?: { op: string; path: string }[] };
    };
    const heldPaths = (action.inline_patch.operations ?? []).map((o) => `${o.op}:${o.path}`);
    expect(heldPaths).toEqual(
      parts[0]!.operations.map((o) => `${o.op}:${o.path}`),
    );
  });

  it('NOT ONE operation from a later part is held, applied, or judged', () => {
    const { parts } = partsOf();
    const decision = gateFor(parts[0]!.operations as { op: string; path: string; value?: unknown }[]);
    const action = decision.pendingActions![0]!.action as {
      inline_patch: { operations?: { op: string; path: string }[] };
    };
    const heldKeys = new Set(
      (action.inline_patch.operations ?? []).map((o) => `${o.op}:${o.path}`),
    );
    const remainderKeys = parts
      .slice(1)
      .flatMap((p) => p.operations.map((o) => `${o.op}:${o.path}`));
    expect(remainderKeys.length).toBeGreaterThan(0);
    for (const key of remainderKeys) {
      expect(heldKeys.has(key), `${key} must not be in the submitted batch`).toBe(false);
    }
    // And the tally counts only what was submitted — a gate that had seen the
    // remainder would show it here even if the pending hid it.
    const tallied = Object.values(decision.verdictCounts).reduce((a, b) => a + (b ?? 0), 0);
    expect(tallied).toBe(parts[0]!.envelopeCount);
  });

  it('a REJECT of the proposed part still applies nothing — splitting does not soften A2', () => {
    // Same shape, but the first part carries an op the referee rejects. The
    // batch-governing rule must still be all-or-nothing WITHIN the part.
    const { parts } = partsOf();
    const poisoned = [
      ...parts[0]!.operations,
      { op: 'remove_node', path: 'f-driver-a' },
    ] as { op: string; path: string; value?: unknown }[];
    const decision = gateFor(poisoned);
    expect(decision.blockApply).toBe(true);
    expect(decision.governing).not.toBe('proceed');
  });
});
