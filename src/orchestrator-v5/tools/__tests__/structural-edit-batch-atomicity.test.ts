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
import { buildReadyGraph, hashOf } from '../../graph-management/__tests__/fixtures.js';
import * as telemetry from '../../../utils/telemetry.js';

/**
 * ⚠ 21 Oct 2026 — the structural-edit composer that once produced these batches
 * (`propose-structural-edit.ts`) was retired; the gate it fed is LIVE (add-factor,
 * add-option, add-risk and the held-execute path all referee through it). Every
 * gate row is kept, fed the canonical operations the composer used to emit
 * (`target_label` stripped, `value.id` restating `path` on a create, a causal
 * link carrying its stated belief). The A3 split rows went with the splitter;
 * the one gate negative among them is kept with literal input.
 */
const CAUSAL_BELIEF = {
  strength: { mean: 0.4, std: 0.15 },
  exists_probability: 0.8,
  effect_direction: 'positive',
} as const;


const GRAPH = buildReadyGraph();
const HASH = hashOf(GRAPH);

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
const MIXED_BATCH = [
  {
    op: 'update_node',
    path: 'f-spend',
    value: { observed_state: { value: 0.77 } },
  },
  {
    op: 'add_node',
    path: 'f-referrals',
    value: { kind: 'factor', label: 'Referral rate', id: 'f-referrals' },
  },
  {
    op: 'add_edge',
    path: 'f-referrals::g-profit',
    value: { from: 'f-referrals', to: 'g-profit', ...CAUSAL_BELIEF },
  },
];

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

describe('A2 — a mixed batch from the tool is held WHOLE; no value op pre-applies', () => {
  it('returns ONE governing verdict of `held` for the whole batch', () => {
    const decision = gateFor(MIXED_BATCH);
    expect(decision.governing).toBe('held');
    expect(decision.blockApply).toBe(true);
  });

  it('the tunable op is INSIDE the hold — it is not applied and not split out', () => {
    const decision = gateFor(MIXED_BATCH);
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
    const solo = gateFor([MIXED_BATCH[0]!]);
    expect(solo.governing).toBe('proceed');
    expect(solo.blockApply).toBe(false);

    const mixed = gateFor(MIXED_BATCH);
    expect(mixed.verdictCounts.would_apply).toBe(1);
    expect(mixed.verdictCounts.held).toBe(2);
    // The tally counts exactly what was submitted: no op lands in another bucket or twice.
    expect(Object.values(mixed.verdictCounts).reduce((a, b) => a + (b ?? 0), 0)).toBe(MIXED_BATCH.length);
    expect(mixed.governing).toBe('held');
  });

  it('exactly ONE pending is minted for the whole batch — never one per op', () => {
    const decision = gateFor(MIXED_BATCH);
    expect(decision.pendingActions).toHaveLength(1);
    expect(decision.suggestedActions).toHaveLength(1);
  });
});

describe('A2 — a reject applies NOTHING, and holds nothing either', () => {
  it('one bad id among four good ops ⇒ whole batch rejected, zero pendings, no chip to confirm', () => {
    // The gate's own posture: every producer that reaches it relies on this.
    const decision = gateFor([
      { op: 'update_node', path: 'f-spend', value: { observed_state: { value: 0.6 } } },
      { op: 'update_node', path: 'f-reach', value: { observed_state: { value: 0.6 } } },
      { op: 'add_node', path: 'f-new', value: { kind: 'factor', label: 'New' } },
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
      { op: 'add_node', path: 'f-new', value: { kind: 'factor', label: 'New' } },
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
      operations: MIXED_BATCH,
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
    const decision = gateFor([
      { op: 'update_node', path: 'f-spend', value: { observed_state: { value: 0.55 } } },
      { op: 'update_node', path: 'f-reach', value: { observed_state: { value: 0.45 } } },
    ]);
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
    expect(decision.pendingActions).toBeNull();
  });
});

describe('A2 — a create removed again in the SAME batch is never proceeded', () => {
  it('a held-class batch plus a remove of its own new node still applies nothing', () => {
    // Kept from the retired A3 split block ("a REJECT of the proposed part
    // still applies nothing"), with the part written out literally.
    const decision = gateFor([
      {
        op: 'add_node',
        path: 'f-driver-a',
        value: { kind: 'factor', label: 'Plan A cost driver', id: 'f-driver-a' },
      },
      ...(['g-profit', 'f-spend', 'f-reach', 'd-choice'] as const).map((t) => ({
        op: 'add_edge',
        path: `f-driver-a::${t}`,
        value: { from: 'f-driver-a', to: t, ...CAUSAL_BELIEF },
      })),
      { op: 'remove_node', path: 'f-driver-a' },
    ]);
    expect(decision.blockApply).toBe(true);
    expect(decision.governing).not.toBe('proceed');
  });
});
