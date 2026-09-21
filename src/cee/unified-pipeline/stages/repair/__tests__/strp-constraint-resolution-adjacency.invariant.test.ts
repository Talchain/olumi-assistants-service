/**
 * THE ADJACENCY THAT KEEPS ADVISORY BLOCKERS UNREACHABLE — PINNED.
 *
 * ── THE PROPERTY, AND WHY IT MATTERS OUTSIDE THIS FILE ──────────────────────
 * A `constraint_dropped` blocker is the ONLY advisory member of
 * `AnalysisBlockerType` (`src/schemas/analysis-ready.ts:140`) — the set
 * difference against `ACTIONABLE_BLOCKER_TYPES`
 * (`orchestrator-v5/context/canonical-analysis-state.ts:130`). It is minted by
 * `extractConstraintDropBlockers` (`cee/transforms/analysis-ready.ts:1474`)
 * from an STRP mutation coded `CONSTRAINT_DROPPED`, then injected onto an
 * ALREADY-`ready` payload WITHOUT recomputing status
 * (`cee/unified-pipeline/stages/boundary.ts:198`) and carried to the wire
 * unfiltered (`orchestrator-v5/compose/analysis-state-v1.ts:322`).
 *
 * Consumers gate on that list. So whether a `CONSTRAINT_DROPPED` can fire is a
 * USER-FACING question, not an internal one.
 *
 * Today it cannot fire on an ordinary draft — but only because of an
 * ACCIDENT OF ADJACENCY in `../index.ts`:
 *
 *     runCompoundGoals(ctx);   // substep 5 — writes ctx.goalConstraints
 *     runLateStrp(ctx);        // substep 6 — Rule 3 resolves them
 *
 * Every constraint row `runCompoundGoals` writes has ALREADY been filtered to
 * an EXACT existing node id (`compound-goals.ts`, `existingNodeIds.has(...)`;
 * a hallucinated id is dropped there and logged `cee.compound_goal.llm_dropped`,
 * never surfaced as a blocker). Because NOTHING RUNS BETWEEN THE TWO CALLS,
 * the node set cannot change underneath those rows, so late STRP's exact-match
 * step always hits and `dropped` stays 0.
 *
 * ⚠ NOTHING ASSERTED THAT. The file carried a prose "ORDERING INVARIANT — do
 * not reorder substeps" header and no executable guard. Insert a node-mutating
 * substep between them, reorder them, or seed `ctx.goalConstraints` upstream
 * from request input, and the path RE-ARMS SILENTLY: no test REDs, no gate
 * fires, and the next person to touch the file has no way to know they
 * disarmed a safety property. That is what this file exists to stop.
 *
 * ── HOW IT IS PINNED (behaviourally, NOT by reading source text) ────────────
 * Every substep is replaced by a recorder (`importOriginal` SPREAD, never a
 * hand-listed allowlist — a bare factory REPLACES the module and goes silently
 * short when a module gains an export). The real `runStageRepair` is then run,
 * and three independent facts are asserted:
 *
 *   I1 ADJACENCY   — the substep entered immediately after `runCompoundGoals`
 *                    is `runLateStrp`. REDs on a reorder, and on any inserted
 *                    step that is itself one of the recorded substeps.
 *   I2 NO MUTATION — the graph's node-id set at `runCompoundGoals` EXIT equals
 *                    the set at `runLateStrp` ENTRY. This is the strong form,
 *                    and it is INSERTION-PROOF: a newly-introduced substep from
 *                    a module this file does not mock is NOT recorded, so I1
 *                    cannot see it — but if it touches nodes, I2 does.
 *   I3 UNSEEDED    — `ctx.goalConstraints` is empty when `runCompoundGoals` is
 *                    ENTERED, so the rows late STRP resolves can only be the
 *                    exact-match-filtered ones that substep just wrote. REDs if
 *                    anything upstream starts seeding it from request input.
 *
 * Each carries its own PRECONDITION PIN, because an invariant whose fixture
 * silently stops reproducing the situation is a guard agreeing with itself: the
 * node set is asserted NON-EMPTY (otherwise I2 compares two empty arrays and
 * holds vacuously), and both substeps are asserted to have run exactly once
 * (otherwise all three hold by never happening).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { StageContext } from '../../../types.js';

// ───────────────────────────────────────────────────────────────────────────
// The recorder. Hoisted because `vi.mock` factories are hoisted above imports.
// ───────────────────────────────────────────────────────────────────────────

const rec = vi.hoisted(() => {
  interface Entry {
    readonly substep: string;
    readonly phase: 'enter' | 'exit';
    readonly nodeIds: readonly string[];
    readonly goalConstraintCount: number;
  }
  const entries: Entry[] = [];

  const snapshot = (ctx: any): Omit<Entry, 'substep' | 'phase'> => ({
    nodeIds: (ctx?.graph?.nodes ?? []).map((n: any) => String(n?.id)),
    goalConstraintCount: Array.isArray(ctx?.goalConstraints) ? ctx.goalConstraints.length : 0,
  });

  /**
   * Replace a substep with a no-op that records the ctx at ENTRY and EXIT.
   * The substeps do nothing, so the stage runs without network or an LLM —
   * and, crucially, a substep introduced LATER that this file does not mock
   * runs FOR REAL, which is exactly what makes I2 insertion-proof.
   */
  const recorder = (substep: string) =>
    vi.fn((ctx: any) => {
      entries.push({ substep, phase: 'enter', ...snapshot(ctx) });
      entries.push({ substep, phase: 'exit', ...snapshot(ctx) });
      return undefined;
    });

  return { entries, recorder };
});

// ───────────────────────────────────────────────────────────────────────────
// Substep mocks — `importOriginal` SPREAD, so a module that gains an export
// keeps it (trap 12: a bare factory replaces the module and drifts silently).
// ───────────────────────────────────────────────────────────────────────────

vi.mock('../auto-baseline-dedup.js', async (io) => ({
  ...(await io<object>()),
  runAutoBaselineDedup: rec.recorder('runAutoBaselineDedup'),
}));
vi.mock('../deterministic-sweep.js', async (io) => ({
  ...(await io<object>()),
  runDeterministicSweep: rec.recorder('runDeterministicSweep'),
}));
vi.mock('../options-identical-bypass.js', async (io) => ({
  ...(await io<object>()),
  // MUST stay falsy: a truthy return early-returns the stage before substep 5.
  runOptionsIdenticalBypass: vi.fn(() => false),
}));
vi.mock('../orchestrator-validation.js', async (io) => ({
  ...(await io<object>()),
  runOrchestratorValidation: rec.recorder('runOrchestratorValidation'),
}));
vi.mock('../plot-validation.js', async (io) => ({
  ...(await io<object>()),
  runPlotValidation: rec.recorder('runPlotValidation'),
}));
vi.mock('../edge-stabilisation.js', async (io) => ({
  ...(await io<object>()),
  runEdgeStabilisation: rec.recorder('runEdgeStabilisation'),
}));
vi.mock('../goal-merge.js', async (io) => ({
  ...(await io<object>()),
  runGoalMerge: rec.recorder('runGoalMerge'),
}));
vi.mock('../compound-goals.js', async (io) => ({
  ...(await io<object>()),
  runCompoundGoals: rec.recorder('runCompoundGoals'),
}));
vi.mock('../late-strp.js', async (io) => ({
  ...(await io<object>()),
  runLateStrp: rec.recorder('runLateStrp'),
}));
vi.mock('../edge-restoration.js', async (io) => ({
  ...(await io<object>()),
  runEdgeRestoration: rec.recorder('runEdgeRestoration'),
}));
vi.mock('../connectivity.js', async (io) => ({
  ...(await io<object>()),
  runConnectivity: rec.recorder('runConnectivity'),
}));
vi.mock('../graph-enforcement.js', async (io) => ({
  ...(await io<object>()),
  applyDeterministicEnforcement: rec.recorder('applyDeterministicEnforcement'),
}));
vi.mock('../structural-parse.js', async (io) => ({
  ...(await io<object>()),
  runStructuralParse: rec.recorder('runStructuralParse'),
}));

import { runStageRepair } from '../index.js';

const COMPOUND = 'runCompoundGoals';
const LATE_STRP = 'runLateStrp';

/**
 * A graph with a named goal and two factors — enough that the node-id set is
 * NON-EMPTY and a mutation between the two substeps would be observable.
 */
function makeCtx(): StageContext {
  return {
    requestId: 'test-adjacency',
    graph: {
      nodes: [
        { id: 'goal_growth', kind: 'goal', label: 'Grow users 3x' },
        { id: 'fac_burn_rate', kind: 'factor', label: 'Burn rate' },
        { id: 'fac_headcount', kind: 'factor', label: 'Headcount' },
      ],
      edges: [],
    },
    goalConstraints: undefined,
    earlyReturn: undefined,
    opts: {},
    input: {},
  } as unknown as StageContext;
}

function enterOf(substep: string) {
  return rec.entries.filter((e) => e.substep === substep && e.phase === 'enter');
}
function exitOf(substep: string) {
  return rec.entries.filter((e) => e.substep === substep && e.phase === 'exit');
}

describe('STRP constraint resolution: the adjacency that keeps advisory blockers unreachable', () => {
  beforeEach(async () => {
    rec.entries.length = 0;
    await runStageRepair(makeCtx());
  });

  it('PRECONDITION — the stage ran, both substeps executed exactly once, on a NON-EMPTY node set', () => {
    // Without this, all three invariants below hold by never happening — and a
    // fixture that silently stops reproducing the situation is a guard
    // agreeing with itself.
    expect(enterOf(COMPOUND)).toHaveLength(1);
    expect(enterOf(LATE_STRP)).toHaveLength(1);
    expect(exitOf(COMPOUND)).toHaveLength(1);
    // I2 compares node-id SETS; two empty arrays are equal for the wrong reason.
    expect(exitOf(COMPOUND)[0].nodeIds.length).toBeGreaterThan(0);
    // And the stage really walked its substeps, rather than early-returning.
    expect(rec.entries.filter((e) => e.phase === 'enter').length).toBeGreaterThan(5);
  });

  it('I1 ADJACENCY — late STRP is entered IMMEDIATELY after compound goals', () => {
    // Bound by substep IDENTITY (the recorded name), never by index arithmetic
    // over a list another substep could satisfy.
    const order = rec.entries.filter((e) => e.phase === 'enter').map((e) => e.substep);
    const at = order.indexOf(COMPOUND);
    expect(at, 'compound goals never ran').toBeGreaterThanOrEqual(0);
    expect(
      order[at + 1],
      'a substep was inserted between compound goals and late STRP, or the two were reordered — ' +
        'the constraint rows compound goals filtered to exact node ids are no longer guaranteed ' +
        'to still match at late STRP, which re-arms CONSTRAINT_DROPPED',
    ).toBe(LATE_STRP);
  });

  it('I2 NO MUTATION — the node set at compound-goals EXIT is the set at late-STRP ENTRY', () => {
    // THE STRONG FORM, and the insertion-proof one: a substep introduced from a
    // module this file does not mock is invisible to I1, but if it touches
    // nodes it is caught here.
    const before = exitOf(COMPOUND)[0].nodeIds;
    const after = enterOf(LATE_STRP)[0].nodeIds;
    expect(
      [...after].sort(),
      'the graph node set changed between compound goals and late STRP — a constraint row ' +
        'validated against the old set may no longer resolve, and STRP Rule 3 will emit ' +
        'CONSTRAINT_DROPPED, which reaches the wire as an advisory blocker',
    ).toEqual([...before].sort());
  });

  it('I3 UNSEEDED — nothing upstream seeds ctx.goalConstraints before compound goals', () => {
    // The other re-arming vector. If request input (or any earlier substep)
    // could seed constraint rows, late STRP would resolve rows that NEVER went
    // through the exact-match filter — and a hallucinated or stale node id
    // would drop.
    expect(
      enterOf(COMPOUND)[0].goalConstraintCount,
      'ctx.goalConstraints was already populated when compound goals was entered — ' +
        'late STRP would resolve rows that never passed the exact-node-id filter',
    ).toBe(0);
  });
});
