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
