/**
 * Trust-spine board #1 (CEE half) — GREEN tests for the constraint-infeasible
 * winner flag + recommendation suppression. Companion to the RED
 * `trust-spine-red-constraint-winner-surface.test.ts` (kept `it.fails` — the
 * DEFAULT/flag-off path is unchanged; enablement is Paul-gated). These prove the
 * criterion when the flag is ON.
 *
 * POSITIVE CONTROL, BOTH WAYS (CLAUDE.md trap #13): the helper is exercised on
 *   (a) the LIVE doctrine-B wire shape — `option_comparison[]` with an OBJECT
 *       `constraint_probabilities` `{ c_budget: 0 }` + `probability_of_joint_goal`
 *       (captured at the bytes: acceptance-evidence/step0-trust-spine-2026-07-17/
 *       fact_T1_constraint_gate.json, build 139150c) — the shape the pre-existing
 *       `deriveConstraintTensions` is silently DEAD on; and
 *   (b) the legacy/red ARRAY shape `constraint_probabilities: [{constraint_id,
 *       probability}]` distinguished by joint-goal tension.
 * It must flag the infeasible winner on BOTH, and must NOT flag a feasible one.
 */
import { describe, it, expect } from 'vitest';

import { deriveWinnerConstraintInfeasibility } from '../constraint-feasibility.js';
import { compactAnalysis } from '../analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../types.js';

// (a) LIVE doctrine-B wire shape — object constraint_probabilities, joint 0.
// Mirrors the real staging capture (opt_premium £80k over a £65k budget cap).
const LIVE_WIRE_INFEASIBLE_LEADER = {
  analysis_status: 'ok',
  constraints_status: 'computed',
  option_comparison: [
    {
      option_id: 'opt_premium',
      option_label: 'Premium Vendor (over budget)',
      id: 'opt_premium',
      label: 'Premium Vendor (over budget)',
      win_probability: 1,
      probability_of_joint_goal: 0,
      constraint_probabilities: { c_budget: 0 },
      status: 'computed',
    },
    {
      option_id: 'opt_budget',
      option_label: 'Budget Vendor (within budget)',
      win_probability: 0,
      probability_of_joint_goal: 1,
      constraint_probabilities: { c_budget: 1 },
      status: 'computed',
    },
  ],
} as unknown as V2RunResponseEnvelope;

// (b) Legacy/red ARRAY shape — the exact envelope the RED gate test builds.
const ARRAY_SHAPE_INFEASIBLE_LEADER = {
  meta: { seed_used: 1, n_samples: 1000, response_hash: 'h' },
  analysis_status: 'ok',
  results: [
    {
      option_id: 'A',
      option_label: 'Option A (over budget)',
      win_probability: 0.6,
      outcome_mean: 100,
      probability_of_joint_goal: 0.02,
      constraint_probabilities: [{ constraint_id: 'budget', probability: 0.9 }],
    },
    {
      option_id: 'B',
      option_label: 'Option B (within budget)',
      win_probability: 0.4,
      outcome_mean: 80,
      probability_of_joint_goal: 0.85,
      constraint_probabilities: [{ constraint_id: 'budget', probability: 0.9 }],
    },
  ],
} as unknown as V2RunResponseEnvelope;

describe('deriveWinnerConstraintInfeasibility — single-source detection (both wire shapes)', () => {
  it('LIVE object shape: flags the over-budget winner (constraint prob 0) as a HARD violation', () => {
    const r = deriveWinnerConstraintInfeasibility(
      LIVE_WIRE_INFEASIBLE_LEADER as unknown as Record<string, unknown>,
      'opt_premium',
    );
    expect(r.infeasible).toBe(true);
    expect(r.constraintId).toBe('c_budget');
    expect(r.kind).toBe('hard_violation');
  });

  it('LIVE object shape: does NOT flag the feasible option (constraint prob 1)', () => {
    const r = deriveWinnerConstraintInfeasibility(
      LIVE_WIRE_INFEASIBLE_LEADER as unknown as Record<string, unknown>,
      'opt_budget',
    );
    expect(r.infeasible).toBe(false);
  });

  it('ARRAY shape: flags the winner via joint-goal tension (joint 0.02 « 0.9×0.7)', () => {
    const r = deriveWinnerConstraintInfeasibility(
      ARRAY_SHAPE_INFEASIBLE_LEADER as unknown as Record<string, unknown>,
      'A',
    );
    expect(r.infeasible).toBe(true);
    expect(r.constraintId).toBe('budget');
    expect(r.kind).toBe('joint_tension');
  });

  it('ARRAY shape: does NOT flag the feasible option (joint 0.85 ≥ 0.9×0.7)', () => {
    const r = deriveWinnerConstraintInfeasibility(
      ARRAY_SHAPE_INFEASIBLE_LEADER as unknown as Record<string, unknown>,
      'B',
    );
    expect(r.infeasible).toBe(false);
  });

  it('fails open: no winner id, no matching entry, or no constraint data ⇒ not flagged', () => {
    expect(deriveWinnerConstraintInfeasibility(LIVE_WIRE_INFEASIBLE_LEADER as unknown as Record<string, unknown>, '').infeasible).toBe(false);
    expect(deriveWinnerConstraintInfeasibility(LIVE_WIRE_INFEASIBLE_LEADER as unknown as Record<string, unknown>, 'nope').infeasible).toBe(false);
    expect(deriveWinnerConstraintInfeasibility({ option_comparison: [{ option_id: 'x', win_probability: 1 }] }, 'x').infeasible).toBe(false);
  });
});

describe('compactAnalysis — constraint-infeasible winner flag (gate ON via opts)', () => {
  it('flag ON: marks the ARRAY-shape winner infeasible + suppressed + TENSION copy (P2: a joint-goal tension is not a proven violation)', () => {
    const s = compactAnalysis(ARRAY_SHAPE_INFEASIBLE_LEADER, undefined, {
      constraintInfeasibleGate: true,
    })!;
    expect(s.winner.option_id).toBe('A');
    expect(s.winner.constraint_infeasible).toBe(true);
    expect(s.winner.recommendation_suppressed).toBe(true);
    expect(s.constraint_infeasible_note).toBeDefined();
    // C2 fired (constraint prob 0.9 is above the hard floor; joint 0.02 «
    // 0.63) → tension-accurate copy, NEVER the violation copy.
    expect(s.constraint_infeasible_note).toContain('may not satisfy a hard constraint');
    expect(s.constraint_infeasible_note).not.toContain('does not satisfy');
    // No banned recommendation vocabulary leaks into the coach note.
    expect(s.constraint_infeasible_note!.toLowerCase()).not.toMatch(/recommend|winner|best/);
  });

  it('flag ON on the LIVE object wire shape: hard-violation copy for the over-budget winner', () => {
    const s = compactAnalysis(LIVE_WIRE_INFEASIBLE_LEADER, undefined, {
      constraintInfeasibleGate: true,
    })!;
    expect(s.winner.option_id).toBe('opt_premium');
    expect(s.winner.constraint_infeasible).toBe(true);
    expect(s.winner.recommendation_suppressed).toBe(true);
    // C1 fired (constraint prob 0) → the violation claim is supported.
    expect(s.constraint_infeasible_note).toContain('does not satisfy a hard constraint');
    // P2 corollary: the note claims nothing about OTHER options' feasibility
    // (the runner-up DOES satisfy the constraint on the live capture).
    expect(s.constraint_infeasible_note!.toLowerCase()).not.toContain('no eligible option');
    expect(s.constraint_infeasible_note!.toLowerCase()).not.toMatch(/recommend|winner|best/);
  });

  it('flag OFF (no opts): byte-identical — winner unflagged, no note', () => {
    const s = compactAnalysis(ARRAY_SHAPE_INFEASIBLE_LEADER)!;
    expect(s.winner.option_id).toBe('A');
    expect(s.winner.constraint_infeasible).toBeUndefined();
    expect(s.winner.recommendation_suppressed).toBeUndefined();
    expect(s.constraint_infeasible_note).toBeUndefined();
  });

  it('flag ON but feasible winner: not flagged (no false positive)', () => {
    // Single feasible option — constraint prob 1, joint 1.
    const feasible = {
      analysis_status: 'ok',
      option_comparison: [
        {
          option_id: 'opt_ok',
          option_label: 'Feasible',
          win_probability: 0.9,
          probability_of_joint_goal: 1,
          constraint_probabilities: { c_budget: 1 },
        },
      ],
    } as unknown as V2RunResponseEnvelope;
    const s = compactAnalysis(feasible, undefined, { constraintInfeasibleGate: true })!;
    expect(s.winner.constraint_infeasible).toBeUndefined();
    expect(s.constraint_infeasible_note).toBeUndefined();
  });
});
