/**
 * ⭐⭐ RULING A4 — staleness ≠ editability, at the DISPATCH + CONFIRM seams.
 *
 * Companion to `graph-management/__tests__/staleness-editability-a4.test.ts`
 * (which pins the referee/frame-gate layer). This file pins the layers a user
 * actually meets:
 *
 *  - R1  flagship: the 03b dead-end shape (add_node + add_edge naming it) on a
 *        stale, hash-MATCHING frame reaches the CONFIRM CHIP instead of a
 *        refusal — with the pending's embedded batch deep-equal to the exact
 *        operations submitted (identity binding, trap 19).
 *  - R2  the confirm-time decline (design §2.3): a hold the user has ALREADY
 *        consented to is silently declined today when the resume turn's
 *        freshness is stale. `executeGmHeldResume` must execute it.
 *  - R4  the typed add-option chip on a stale frame holds instead of skipping
 *        to `not_held` (and thence to a lane that also staled).
 *  - R5  the carve-out at this layer: `'unknown'` freshness HOLDS with a real
 *        confirm chip and a real pending, the held_proposal CARD is null (the
 *        code is outside the ratified wire enum, so the builder fails closed),
 *        and consent is COMPLETE without the card.
 *  - R6  the honesty invariant (design §2.4(a)): no decision may ever ship
 *        "the model has moved" copy while `publicReason.base_hash_match` is
 *        true. Derived over the whole freshness × hash-match matrix.
 *  - §7.1 the option-identity guard interaction, pinned deliberately rather
 *        than discovered: `stale` via `analysed_options_diverged` executes at
 *        confirm; `unknown` holds rather than declining.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  evaluateEditGraphMutations,
  GM_HELD_HANDLER_ID,
  GM_STALE_ASSISTANT_TEXT,
} from '../edit-graph-referee-gate.js';
import { executeGmHeldResume } from '../gm-held-execute.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parsePendingAction } from '../../session/pending-action.js';
import type { FrameFreshness } from '../../graph-management/types.js';
import * as telemetry from '../../../utils/telemetry.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const GRAPH = {
  goal_node_id: 'g-profit',
  schema_version: 'v3',
  nodes: [
    { id: 'g-profit', kind: 'goal', label: 'Profit' },
    { id: 'd-choice', kind: 'decision', label: 'Which plan' },
    { id: 'f-spend', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    { id: 'f-reach', kind: 'factor', label: 'Audience reach', observed_state: { value: 0.5 } },
    { id: 'o-a', kind: 'option', label: 'Plan A', interventions: { 'f-spend': { value: 0.6 } } },
    { id: 'o-b', kind: 'option', label: 'Plan B', interventions: { 'f-reach': { value: 0.3 } } },
  ],
  edges: [
    { from: 'd-choice', to: 'o-a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'd-choice', to: 'o-b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-a', to: 'f-spend', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'o-b', to: 'f-reach', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-spend', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'f-reach', to: 'g-profit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as never);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

/** THE 03b DEAD-END SHAPE — a restructure step: a new node plus the edge that names it. */
const ADD_NODE_OP = {
  op: 'add_node',
  path: 'fac_risk',
  value: { id: 'fac_risk', kind: 'factor', label: 'Delivery risk' },
};
const ADD_EDGE_OP = {
  op: 'add_edge',
  path: 'fac_risk->g-profit',
  value: {
    from: 'fac_risk',
    to: 'g-profit',
    strength: { mean: 0.4, std: 0.1 },
    exists_probability: 0.8,
    effect_direction: 'negative',
  },
};
const RESTRUCTURE_BATCH = [ADD_NODE_OP, ADD_EDGE_OP];
const TUNABLE_OP = { op: 'update_node', path: 'f-spend', value: { description: 'Quarterly budget' } };

function baseInput(overrides: Partial<Parameters<typeof evaluateEditGraphMutations>[0]> = {}) {
  const hash = hashOf(GRAPH);
  return {
    mode: 'live' as const,
    operations: RESTRUCTURE_BATCH,
    currentGraph: GRAPH,
    currentGraphHash: hash,
    baseGraphHash: hash,
    freshness: 'none' as const,
    scenarioId: 'scn-a4',
    turnId: 'turn-a4',
    requestId: 'req-a4',
    ...overrides,
  };
}

function executeInput(
  overrides: Partial<Parameters<typeof executeGmHeldResume>[0]> = {},
): Parameters<typeof executeGmHeldResume>[0] {
  return {
    operations: RESTRUCTURE_BATCH as never,
    currentGraph: GRAPH,
    currentGraphHash: hashOf(GRAPH),
    freshness: 'none',
    hasExistingAnalysis: false,
    scenarioId: 'scn-a4',
    turnId: 'turn-a4',
    requestId: 'req-a4',
    ...overrides,
  };
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

// ===========================================================================
// R1 — the flagship: the restructure reaches the confirm chip
// ===========================================================================

describe('⭐⭐ R1 — a multi-step restructure on a STALE frame reaches the confirm chip, not a dead end', () => {
  it('governing is held, the assistant asks for consent, and the STALE copy is nowhere near it', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'stale' }));
    expect(d.governing).toBe('held');
    // A hold still blocks the AUTO-apply — that is consent, not a lock.
    expect(d.blockApply).toBe(true);
    expect(d.assistantText).not.toBe(GM_STALE_ASSISTANT_TEXT);
    expect(d.publicReason).toMatchObject({
      verdict: 'held',
      blocker_code: 'STRUCTURAL_APPLY_HELD',
      base_hash_match: true,
    });
  });

  it('a REAL pending is minted, on the GM held handler, carrying the EXACT submitted batch', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'stale' }));
    expect(d.pendingActions).not.toBeNull();
    expect(d.pendingActions).toHaveLength(1);
    const parsed = parsePendingAction(d.pendingActions![0]);
    expect(parsed).not.toBeNull();
    const action = parsed!.action as {
      kind: string;
      inline_patch?: { handler_id?: string; operations?: unknown };
    };
    expect(action.kind).toBe('apply_proposed_change');
    // IDENTITY binding: the handler id and the operations themselves, never a count.
    expect(action.inline_patch?.handler_id).toBe(GM_HELD_HANDLER_ID);
    expect(action.inline_patch?.operations).toEqual(RESTRUCTURE_BATCH);
  });

  it('a real confirm chip is offered, and it is the pending’s own handle (not the rerun chip)', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'stale' }));
    expect(d.suggestedActions).toHaveLength(1);
    const chip = d.suggestedActions![0]!;
    expect(chip.id).toMatch(/^gmh_/);
    expect((chip as { action_type?: string }).action_type).toBeUndefined();
  });

  it('the typed held_proposal CARD is minted for the structural hold (edit_graph dispatch path)', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'stale', dispatchPath: 'edit_graph' }));
    expect(d.heldProposalBlock).not.toBeNull();
    expect(d.heldProposalBlock!.reason_code).toBe('STRUCTURAL_APPLY_HELD');
  });
});

// ===========================================================================
// R2 — the confirm-time decline the ruling did not anticipate (design §2.3)
// ===========================================================================

describe('⭐⭐ R2 — a hold the user already consented to EXECUTES on a stale resume turn', () => {
  it('executeGmHeldResume + freshness=stale on a STRUCTURAL batch executes (today: referee_blocked/stale)', () => {
    const outcome = executeGmHeldResume(executeInput({ freshness: 'stale' }));
    expect(outcome.status).toBe('executed');
  });

  it('the applied graph carries the SPECIFIC ids the batch adds (identity, not a node count)', () => {
    const outcome = executeGmHeldResume(executeInput({ freshness: 'stale' }));
    if (outcome.status !== 'executed') throw new Error(`expected executed, got ${outcome.status}`);
    const nodeIds = (outcome.appliedGraph.nodes as Array<{ id: string }>).map((n) => n.id);
    expect(nodeIds).toContain('fac_risk');
    const edges = outcome.appliedGraph.edges as Array<{ from: string; to: string }>;
    expect(edges.some((e) => e.from === 'fac_risk' && e.to === 'g-profit')).toBe(true);
  });

  it('a "yes" STILL never overrides integrity: a malformed op declines (the consent gate is not weakened)', () => {
    const outcome = executeGmHeldResume(
      executeInput({ operations: [{ op: 'exotic_future_op', path: 'x' }] as never, freshness: 'stale' }),
    );
    expect(outcome).toEqual({ status: 'referee_blocked', governing: 'rejected' });
  });

  it('§7.1: freshness=stale reached via the option-identity guard (analysed_options_diverged) also executes', () => {
    // The frame carries only the VERDICT, so both stale reasons present
    // identically here — pinned deliberately (design §7.1) rather than
    // discovered by a reviewer.
    const outcome = executeGmHeldResume(executeInput({ freshness: 'stale' }));
    expect(outcome.status).toBe('executed');
  });

  it("§7.1: freshness='unknown' at confirm HOLDS (governing held ⇒ the consented batch executes), never declines", () => {
    const outcome = executeGmHeldResume(executeInput({ freshness: 'unknown' }));
    expect(outcome.status).toBe('executed');
  });
});

// R4 (the typed add-option chip) lives in `add-option-transaction-e2e.test.ts`,
// where the option fixtures already exist — a second fixture set here would be
// the hand-maintained twin this estate keeps paying for.

// ===========================================================================
// R5 — the carve-out at the dispatch layer
// ===========================================================================

describe("R5 — 'unknown' freshness holds with COMPLETE consent, and the card fails closed", () => {
  it('governing held with the FRESHNESS_UNRESOLVED code (today: stale / ANALYSIS_NOT_FRESH)', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'unknown' }));
    expect(d.governing).toBe('held');
    expect(d.publicReason).toMatchObject({
      verdict: 'held',
      blocker_code: 'FRESHNESS_UNRESOLVED',
      base_hash_match: true,
    });
  });

  it('consent is COMPLETE without the card: a real pending, a real confirm chip, and an ask', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'unknown', dispatchPath: 'edit_graph' }));
    expect(d.pendingActions).toHaveLength(1);
    expect(parsePendingAction(d.pendingActions![0])).not.toBeNull();
    expect(d.suggestedActions).toHaveLength(1);
    expect(d.suggestedActions![0]!.id).toMatch(/^gmh_/);
    expect((d.assistantText ?? '').length).toBeGreaterThan(0);
  });

  it('⭐ the held_proposal CARD is null — FRESHNESS_UNRESOLVED is outside the ratified wire enum, so the builder fails closed', () => {
    const d = evaluateEditGraphMutations(baseInput({ freshness: 'unknown', dispatchPath: 'edit_graph' }));
    expect(d.heldProposalBlock ?? null).toBeNull();
  });

  it('a tunable batch on an unknown frame also holds (the carve-out is class-independent)', () => {
    const d = evaluateEditGraphMutations(baseInput({ operations: [TUNABLE_OP], freshness: 'unknown' }));
    expect(d.governing).toBe('held');
    expect(d.publicReason).toMatchObject({ blocker_code: 'FRESHNESS_UNRESOLVED' });
  });
});

// ===========================================================================
// R6 — the honesty invariant, derived over the whole matrix
// ===========================================================================

describe('⭐ R6 — no decision ever says "the model has moved" while base_hash_match is true', () => {
  const FRESHNESS_VALUES: readonly FrameFreshness[] = ['fresh', 'stale', 'unknown', 'none'];
  const OP_SETS: ReadonlyArray<readonly [string, readonly unknown[]]> = [
    ['structural', RESTRUCTURE_BATCH],
    ['tunable', [TUNABLE_OP]],
  ];

  it('the invariant holds across every (operation class × freshness × hash-match) cell', () => {
    const violations: string[] = [];
    let checked = 0;
    let sawTheCopy = false;
    for (const [label, ops] of OP_SETS) {
      for (const freshness of FRESHNESS_VALUES) {
        for (const matching of [true, false]) {
          const d = evaluateEditGraphMutations(
            baseInput({
              operations: ops as never,
              freshness,
              ...(matching ? {} : { baseGraphHash: 'a-diverged-hash' }),
            }),
          );
          checked += 1;
          const saysMoved = d.assistantText === GM_STALE_ASSISTANT_TEXT;
          if (saysMoved) sawTheCopy = true;
          const claimsMatch =
            (d.publicReason as { base_hash_match?: boolean } | undefined)?.base_hash_match === true;
          if (saysMoved && claimsMatch) violations.push(`${label}/${freshness}/matching=${matching}`);
        }
      }
    }
    // Positive control (trap 13): the matrix must be able to SEE the copy at
    // all, or the absence assertion proves nothing.
    expect(checked).toBe(OP_SETS.length * FRESHNESS_VALUES.length * 2);
    expect(sawTheCopy).toBe(true);
    expect(violations).toEqual([]);
  });

  it('the divergence copy is reserved for a REAL divergence: base_hash_match is false wherever it ships', () => {
    const d = evaluateEditGraphMutations(baseInput({ baseGraphHash: 'a-diverged-hash', freshness: 'fresh' }));
    expect(d.assistantText).toBe(GM_STALE_ASSISTANT_TEXT);
    expect(d.publicReason).toMatchObject({ base_hash_match: false, blocker_code: 'BASE_HASH_DIVERGED' });
  });

  it('the divergence decision no longer offers a re-run — a rerun cannot resolve a base-hash divergence', () => {
    const d = evaluateEditGraphMutations(baseInput({ baseGraphHash: 'a-diverged-hash', freshness: 'fresh' }));
    const actionTypes = (d.suggestedActions ?? []).map((a) => (a as { action_type?: string }).action_type);
    expect(actionTypes).not.toContain('run_analysis');
  });
});
