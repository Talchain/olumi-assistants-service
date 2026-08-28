/**
 * DECISION-FREE MODEL — the exploratory-map class.
 *
 * A user who writes "I want to map out what is going on rather than jump to an
 * answer" must be able to leave with a model. Before this suite, they could not:
 * `MISSING_DECISION` + `INSUFFICIENT_OPTIONS` fired at
 * `post_enforcement`, `applyDeterministicEnforcement` set `ctx.earlyReturn`, and
 * the turn came back 422 `CEE_GRAPH_INVALID`.
 *
 * ── THE PREDICATE GUARDS TWO OPPOSITE HARMS ────────────────────────────────
 * Suppressing a REAL missing decision is a LIE (the product accepts a graph
 * whose decision the user did want). Blocking a legitimate open model is a GAP
 * (the harm above). One window cannot serve both, so the predicate is exact —
 * `decisions === 0 && options === 0` — and this suite enumerates the WHOLE
 * shape space to prove exactly one cell moves.
 *
 * ── WHY THE PREDICATE NEEDS NO NEW FIELD ───────────────────────────────────
 * On the live draft path the model emits RECORDS, not a graph
 * (`adapters/llm/anthropic.ts:517` pushes `DRAFT_RECORDS_INSTRUCTION`; a
 * graph-shaped response is the typed failure `graph_shaped_response`,
 * `records/seam.ts:138`). The records grammar has NO `decision` kind — the
 * DECISION IS MINTED BY THE PROJECTOR, and only when options exist
 * (`records/projector.ts:3207 if (optionNodes.length > 0)`). So on that path
 * `options.length === 0` and `decisions.length === 0` are the same fact, and
 * the shape alone identifies the class.
 */

import { describe, it, expect } from 'vitest';
import { validateGraph } from '../../src/validators/graph-validator.js';
import { validateGraphStructure } from '../../src/orchestrator/graph-structure-validator.js';
import type { GraphT, NodeT } from '../../src/schemas/graph.js';
import { detectBiases } from '../../src/cee/bias/index.js';
import { computeQuality } from '../../src/cee/quality/index.js';
import { generateOptions } from '../../src/cee/options/index.js';
import { resolveRunAdmission } from '../../src/orchestrator-v5/tools/handlers/analysis-ready-core.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../src/orchestrator-v5/routing/validation-registry.js';

// =============================================================================
// Corpus construction — enumerated, not hand-picked
// =============================================================================

type Cell = {
  decisions: 0 | 1 | 2;
  options: 0 | 1 | 2 | 3;
  goal: boolean;
  outcome: boolean;
};

const DECISION_COUNTS = [0, 1, 2] as const;
const OPTION_COUNTS = [0, 1, 2, 3] as const;
const GOAL_PRESENT = [true, false] as const;
const OUTCOME_PRESENT = [true, false] as const;

/** Every cell of {decisions} x {options} x {goal} x {outcome}. */
function enumerateCells(): Cell[] {
  const cells: Cell[] = [];
  for (const decisions of DECISION_COUNTS) {
    for (const options of OPTION_COUNTS) {
      for (const goal of GOAL_PRESENT) {
        for (const outcome of OUTCOME_PRESENT) {
          cells.push({ decisions, options, goal, outcome });
        }
      }
    }
  }
  return cells;
}

const CELLS = enumerateCells();

function cellName(c: Cell): string {
  return `d=${c.decisions} o=${c.options} goal=${c.goal ? 'y' : 'n'} outcome=${c.outcome ? 'y' : 'n'}`;
}

/**
 * Nodes only. The four codes under test are Tier-1/Tier-2 CARDINALITY codes —
 * they count nodes by kind and never read an edge. Other tiers will emit other
 * codes on this shape; every assertion below filters BY CODE IDENTITY, so those
 * are irrelevant by construction rather than by luck.
 */
function buildCell(c: Cell): GraphT {
  const nodes: NodeT[] = [];
  for (let i = 0; i < c.decisions; i++) {
    nodes.push({ id: `dec_${i}`, kind: 'decision', label: `Decision ${i}` } as NodeT);
  }
  for (let i = 0; i < c.options; i++) {
    nodes.push({ id: `opt_${i}`, kind: 'option', label: `Option ${i}` } as NodeT);
  }
  if (c.goal) nodes.push({ id: 'goal_1', kind: 'goal', label: 'Goal' } as NodeT);
  if (c.outcome) nodes.push({ id: 'out_1', kind: 'outcome', label: 'Outcome' } as NodeT);
  // A factor so no cell is degenerate-empty.
  nodes.push({ id: 'fac_1', kind: 'factor', label: 'Factor' } as NodeT);
  return { version: '1', default_seed: 42, nodes, edges: [] } as unknown as GraphT;
}

function codesFor(graph: GraphT): Set<string> {
  const result = validateGraph({ graph, requestId: 'test', phase: 'post_enforcement' as never });
  return new Set(result.errors.map((e) => e.code));
}

function structuralCodesFor(graph: GraphT): Set<string> {
  const result = validateGraphStructure(graph as never);
  return new Set(result.violations.map((v) => v.code));
}

// =============================================================================
// THE EXPECTED TABLE — derived from the producer's semantics, not from the fix
// =============================================================================

/** The class this change exists to admit, and the ONLY cell that may move. */
function isDecisionFree(c: Cell): boolean {
  return c.decisions === 0 && c.options === 0;
}

/**
 * Derived from `graph-validator.ts` MISSING_DECISION: fires when
 * `decisions === 0` OR `decisions > 1`. The zero arm is suppressed for the
 * decision-free class; the PLURAL arm is untouched.
 */
function expectMissingDecision(c: Cell): boolean {
  if (c.decisions > 1) return true;
  if (c.decisions === 0) return !isDecisionFree(c);
  return false;
}

/**
 * Derived from `graph-validator.ts` INSUFFICIENT_OPTIONS: fires when
 * `options < MIN_OPTIONS (2)` OR `options > MAX_OPTIONS (6)`. The below-min arm
 * is suppressed for the decision-free class only. No cell here exceeds the max.
 */
function expectInsufficientOptions(c: Cell): boolean {
  if (c.options < 2) return !isDecisionFree(c);
  return false;
}

describe('decision-free model — exhaustive shape corpus', () => {
  it('enumerates the whole shape space (guards against a silently shrunk corpus)', () => {
    expect(CELLS).toHaveLength(3 * 4 * 2 * 2);
    expect(CELLS).toHaveLength(48);
    // Exactly one cell is the decision-free class, at each goal/outcome combination.
    expect(CELLS.filter(isDecisionFree)).toHaveLength(4);
  });

  describe('MISSING_DECISION / INSUFFICIENT_OPTIONS across all 48 cells', () => {
    for (const c of CELLS) {
      it(`${cellName(c)}`, () => {
        const codes = codesFor(buildCell(c));
        expect(codes.has('MISSING_DECISION')).toBe(expectMissingDecision(c));
        expect(codes.has('INSUFFICIENT_OPTIONS')).toBe(expectInsufficientOptions(c));
      });
    }
  });

  describe('the twin validator — NO_DECISION / FEWER_THAN_TWO_OPTIONS across all 48 cells', () => {
    for (const c of CELLS) {
      it(`${cellName(c)}`, () => {
        const codes = structuralCodesFor(buildCell(c));
        // The twin has no ">1 decision" arm — it checks presence only.
        const expectNoDecision = c.decisions === 0 ? !isDecisionFree(c) : false;
        expect(codes.has('NO_DECISION')).toBe(expectNoDecision);
        expect(codes.has('FEWER_THAN_TWO_OPTIONS')).toBe(expectInsufficientOptions(c));
      });
    }
  });

  describe('goal and bridge cardinality are UNAFFECTED by the suppression', () => {
    for (const c of CELLS) {
      it(`${cellName(c)}`, () => {
        const codes = codesFor(buildCell(c));
        // MISSING_GOAL fires iff goals !== 1 — independent of decisions/options.
        expect(codes.has('MISSING_GOAL')).toBe(!c.goal);
        // MISSING_BRIDGE fires iff no outcome AND no risk — this corpus has no risks.
        expect(codes.has('MISSING_BRIDGE')).toBe(!c.outcome);
      });
    }
  });

  it('MISSING_GOAL and MISSING_BRIDGE remain severity "error" on a decision-free graph', () => {
    const graph = buildCell({ decisions: 0, options: 0, goal: false, outcome: false });
    const result = validateGraph({ graph, requestId: 'test', phase: 'post_enforcement' as never });
    const goalIssue = result.errors.find((e) => e.code === 'MISSING_GOAL');
    const bridgeIssue = result.errors.find((e) => e.code === 'MISSING_BRIDGE');
    expect(goalIssue).toBeDefined();
    expect(goalIssue?.severity).toBe('error');
    expect(bridgeIssue).toBeDefined();
    expect(bridgeIssue?.severity).toBe('error');
  });
});

// =============================================================================
// EDIT-2 PROOF OBLIGATION — reachability must NOT go silent
// =============================================================================

/**
 * Zero decisions used to make the ENTIRE reachability tier return empty, so
 * admitting the decision-free class without splitting that early return would
 * have handed those users a model with NO connectivity enforcement at all —
 * trading a 422 for a silently broken graph.
 *
 * `UNREACHABLE_FROM_DECISION` legitimately needs a decision root and stays
 * skipped. `NO_PATH_TO_GOAL` is a REVERSE BFS from the goal and needs no
 * decision, so it must still fire.
 */
function decisionFreeConnectedGraph(): GraphT {
  return {
    version: '1',
    default_seed: 42,
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Understand what is going on' },
      { id: 'out_1', kind: 'outcome', label: 'Team throughput' },
      {
        id: 'fac_a',
        kind: 'factor',
        label: 'Handover load',
        category: 'observable' as never,
        data: { value: 0.5, extractionType: 'explicit' },
      },
    ],
    edges: [
      { from: 'fac_a', to: 'out_1', strength_mean: 0.6, belief_exists: 0.9 },
      { from: 'out_1', to: 'goal_1', strength_mean: 0.8, belief_exists: 0.9 },
    ],
  } as unknown as GraphT;
}

/** The same model with one genuine dead end bolted on. */
function decisionFreeDeadEndGraph(): GraphT {
  const g = decisionFreeConnectedGraph() as unknown as {
    nodes: unknown[];
    edges: unknown[];
  };
  g.nodes.push({
    id: 'fac_dead',
    kind: 'factor',
    label: 'Leads nowhere',
    category: 'observable',
    data: { value: 0.5, extractionType: 'explicit' },
  });
  g.edges.push({ from: 'fac_a', to: 'fac_dead', strength_mean: 0.4, belief_exists: 0.9 });
  return g as unknown as GraphT;
}

describe('decision-free model — reachability is re-rooted, not disabled', () => {
  it('NO_PATH_TO_GOAL FIRES on a decision-free graph with a dead end', () => {
    const codes = codesFor(decisionFreeDeadEndGraph());
    expect(codes.has('NO_PATH_TO_GOAL')).toBe(true);
  });

  it('OPPOSITE-DIRECTION TWIN: NO_PATH_TO_GOAL stays silent when every node reaches the goal', () => {
    const codes = codesFor(decisionFreeConnectedGraph());
    expect(codes.has('NO_PATH_TO_GOAL')).toBe(false);
  });

  it('the dead-end node is named by IDENTITY, not merely counted', () => {
    const result = validateGraph({
      graph: decisionFreeDeadEndGraph(),
      requestId: 'test',
      phase: 'post_enforcement' as never,
    });
    const issue = result.errors.find(
      (e) => e.code === 'NO_PATH_TO_GOAL' && e.context?.kind === 'factor' && String(e.message).includes('fac_dead'),
    );
    expect(issue).toBeDefined();
    // And the healthy factor is NOT flagged.
    const falsePositive = result.errors.find(
      (e) => e.code === 'NO_PATH_TO_GOAL' && String(e.message).includes('fac_a'),
    );
    expect(falsePositive).toBeUndefined();
  });

  it('UNREACHABLE_FROM_DECISION stays skipped when there is no decision to root it', () => {
    const codes = codesFor(decisionFreeDeadEndGraph());
    expect(codes.has('UNREACHABLE_FROM_DECISION')).toBe(false);
  });

  it('the twin validator also re-roots: NO_PATH_TO_GOAL fires on the decision-free dead end', () => {
    const codes = structuralCodesFor(decisionFreeDeadEndGraph());
    expect(codes.has('NO_PATH_TO_GOAL')).toBe(true);
  });

  it('OPPOSITE-DIRECTION TWIN (structural): silent when everything reaches the goal', () => {
    const codes = structuralCodesFor(decisionFreeConnectedGraph());
    expect(codes.has('NO_PATH_TO_GOAL')).toBe(false);
  });

  it('a decision-free connected graph produces NO blocking errors at all', () => {
    const result = validateGraph({
      graph: decisionFreeConnectedGraph(),
      requestId: 'test',
      phase: 'post_enforcement' as never,
    });
    // This is the whole point: enforcement gates on `errors.length > 0`.
    expect(result.errors.map((e) => e.code)).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// MUST-NOT-BREAK — the lie direction
// =============================================================================

describe('decision-free suppression does NOT cover the adjacent shapes', () => {
  it('options>0 with no decision still errors MISSING_DECISION (the graph lost its decision)', () => {
    const graph = buildCell({ decisions: 0, options: 2, goal: true, outcome: true });
    const codes = codesFor(graph);
    expect(codes.has('MISSING_DECISION')).toBe(true);
  });

  it('options>0 with no decision still errors NO_DECISION in the twin', () => {
    const graph = buildCell({ decisions: 0, options: 2, goal: true, outcome: true });
    expect(structuralCodesFor(graph).has('NO_DECISION')).toBe(true);
  });

  it('a decision with fewer than two options still errors INSUFFICIENT_OPTIONS', () => {
    const graph = buildCell({ decisions: 1, options: 1, goal: true, outcome: true });
    expect(codesFor(graph).has('INSUFFICIENT_OPTIONS')).toBe(true);
  });

  it('a decision with fewer than two options still errors FEWER_THAN_TWO_OPTIONS in the twin', () => {
    const graph = buildCell({ decisions: 1, options: 1, goal: true, outcome: true });
    expect(structuralCodesFor(graph).has('FEWER_THAN_TWO_OPTIONS')).toBe(true);
  });

  it('a decision with ZERO options still errors — the decision is real, the options are missing', () => {
    const graph = buildCell({ decisions: 1, options: 0, goal: true, outcome: true });
    expect(codesFor(graph).has('INSUFFICIENT_OPTIONS')).toBe(true);
    expect(structuralCodesFor(graph).has('FEWER_THAN_TWO_OPTIONS')).toBe(true);
  });
});

// =============================================================================
// EDIT 4 — THE HONESTY LAYER (the very next link after the validator)
// =============================================================================

/**
 * Admitting the model and then shipping the old copy would have MOVED the
 * dishonesty rather than removed it. At zero options the bias detector asserted
 * *"Graph defines no decision options; this may hide alternative choices"* at
 * HIGH severity, evidenceStrength 1.0 — a false premise at maximum confidence,
 * aimed at a user who had explicitly asked not to jump to an answer.
 *
 * Every assertion below has its OPPOSITE-DIRECTION TWIN in the same block: the
 * suppression must not reach a graph where the finding is true.
 */
describe('decision-free model — the honesty layer', () => {
  const decisionFreeV1 = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Understand what is going on' },
      { id: 'out_1', kind: 'outcome', label: 'Throughput' },
      { id: 'fac_a', kind: 'factor', label: 'Handover load' },
    ],
    edges: [
      { from: 'fac_a', to: 'out_1' },
      { from: 'out_1', to: 'goal_1' },
    ],
  };
  /** A REAL missing-options defect: the decision exists, the options do not. */
  const decisionWithNoOptions = {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Which way?' },
      { id: 'goal_1', kind: 'goal', label: 'Grow' },
      { id: 'out_1', kind: 'outcome', label: 'Revenue' },
      { id: 'fac_a', kind: 'factor', label: 'Spend' },
    ],
    edges: [
      { from: 'fac_a', to: 'out_1' },
      { from: 'out_1', to: 'goal_1' },
    ],
  };
  /** One option and a decision — the medium-severity arm, untouched. */
  const decisionWithOneOption = {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Which way?' },
      { id: 'opt_1', kind: 'option', label: 'Only choice' },
      { id: 'goal_1', kind: 'goal', label: 'Grow' },
      { id: 'out_1', kind: 'outcome', label: 'Revenue' },
    ],
    edges: [{ from: 'out_1', to: 'goal_1' }],
  };

  const selectionFinding = (g: unknown) =>
    detectBiases(g as never).find((f) => f.id === 'selection_low_option_count');

  it('BIAS: no "hides alternative choices" scolding for a deliberate map', () => {
    expect(selectionFinding(decisionFreeV1)).toBeUndefined();
  });

  it('BIAS TWIN: a decision with NO options still gets the HIGH-severity finding', () => {
    const f = selectionFinding(decisionWithNoOptions);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('high');
    expect(f?.explanation).toContain('no decision options');
  });

  it('BIAS TWIN: a decision with ONE option still gets the medium-severity finding', () => {
    const f = selectionFinding(decisionWithOneOption);
    expect(f).toBeDefined();
    expect(f?.severity).toBe('medium');
  });

  it('OPTIONS: no "add options" / "explore paths" nudge for a deliberate map', () => {
    const ids = generateOptions(decisionFreeV1 as never).map((o) => o.id);
    expect(ids).not.toContain('expand_scope_add_options');
    expect(ids).not.toContain('change_channel_explore_paths');
  });

  it('OPTIONS TWIN: a decision with no options still gets both nudges', () => {
    const ids = generateOptions(decisionWithNoOptions as never).map((o) => o.id);
    expect(ids).toContain('expand_scope_add_options');
    expect(ids).toContain('change_channel_explore_paths');
  });

  /**
   * `coverage` is optional on CEEQualityMeta, so read it through a helper that
   * PINS ITS OWN PRECONDITION: a comparison against `undefined` would be a
   * guard agreeing with itself.
   */
  const coverageOf = (q: { coverage?: number }): number => {
    expect(q.coverage).toBeDefined();
    expect(typeof q.coverage).toBe('number');
    return q.coverage as number;
  };

  it('QUALITY: the zero-option coverage penalty does not apply to a deliberate map', () => {
    const base = { confidence: 0.8, engineIssueCount: 0, ceeIssues: [] };
    const free = computeQuality({ ...base, graph: decisionFreeV1 as never });
    const real = computeQuality({ ...base, graph: decisionWithNoOptions as never });
    // Same outcome/risk profile on both, so coverage differs ONLY by the penalty.
    expect(coverageOf(free)).toBeGreaterThan(coverageOf(real));
  });

  it('QUALITY TWIN: the penalty still bites a decision that genuinely lost its options', () => {
    const base = { confidence: 0.8, engineIssueCount: 0, ceeIssues: [] };
    const withOptions = computeQuality({
      ...base,
      graph: {
        nodes: [
          { id: 'dec_1', kind: 'decision' },
          { id: 'opt_1', kind: 'option' },
          { id: 'opt_2', kind: 'option' },
          { id: 'goal_1', kind: 'goal' },
          { id: 'out_1', kind: 'outcome' },
        ],
        edges: [{ from: 'out_1', to: 'goal_1' }],
      } as never,
    });
    const real = computeQuality({ ...base, graph: decisionWithNoOptions as never });
    expect(coverageOf(real)).toBeLessThan(coverageOf(withOptions));
  });
});

// =============================================================================
// EDIT 6 — THE 500 TRAP: which error does a decision-free graph actually hit?
// =============================================================================

/**
 * `build-turn-context.ts` (`loadScenarioSnapshotForRunAnalysis`) throws a BARE
 * `Error` — an infra 500 — if `readiness.goal_node_id` is falsy. It is
 * unreachable today ONLY because the typed `AnalysisNotReadyError` throws 44
 * lines earlier on `willProceed: false`. Softening the structural set without
 * checking that ordering would have turned a 422 into a 500.
 *
 * MEASURED at this tip, both directions, rather than reasoned: run admission
 * refuses the decision-free graph, so the typed error owns the failure and the
 * bare `Error` stays unreachable. These assertions are what make that ordering
 * fail loudly if it ever inverts.
 */
describe('decision-free model — the analysis gates stay closed, and closed TYPED', () => {
  const decisionFreeV3 = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Understand what is going on' },
      { id: 'out_1', kind: 'outcome', label: 'Throughput' },
      {
        id: 'fac_a',
        kind: 'factor',
        label: 'Handover load',
        category: 'observable',
        data: { value: 0.5, extractionType: 'explicit' },
      },
    ],
    edges: [
      { from: 'fac_a', to: 'out_1', strength_mean: 0.6, belief_exists: 0.9 },
      { from: 'out_1', to: 'goal_1', strength_mean: 0.8, belief_exists: 0.9 },
    ],
  };
  /** No options AND no controllable factors — the thinnest decision-free shape. */
  const thinnestDecisionFree = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Understand' },
      { id: 'out_1', kind: 'outcome', label: 'Throughput' },
    ],
    edges: [{ from: 'out_1', to: 'goal_1', strength_mean: 0.8, belief_exists: 0.9 }],
  };

  it('run admission REFUSES a decision-free graph — so the typed error throws, not the bare one', () => {
    const admission = resolveRunAdmission(decisionFreeV3 as never);
    expect(admission.willProceed).toBe(false);
  });

  it('the thinnest decision-free shape is refused too (no controllable factor to lean on)', () => {
    const admission = resolveRunAdmission(thinnestDecisionFree as never);
    expect(admission.willProceed).toBe(false);
  });

  it('the run_analysis PRECONDITION refuses first, by identity, with no_options_defined', () => {
    const decl = (HANDLER_VALIDATION_REGISTRY as Record<string, { preconditions?: (a: unknown) => { ok: boolean; reason?: string } }>)['run_analysis'];
    expect(decl).toBeDefined();
    const graphStub = {
      listEntitiesByKind: (kind: string) => decisionFreeV3.nodes.filter((n) => n.kind === kind),
    };
    const result = decl?.preconditions?.({ graph: graphStub });
    expect(result?.ok).toBe(false);
    expect(result?.reason).toBe('no_options_defined');
  });

  it('TWIN: the precondition ADMITS a graph that has options — the gate still discriminates', () => {
    const decl = (HANDLER_VALIDATION_REGISTRY as Record<string, { preconditions?: (a: unknown) => { ok: boolean; reason?: string } }>)['run_analysis'];
    const withOptions = [
      { id: 'opt_1', kind: 'option' },
      { id: 'opt_2', kind: 'option' },
    ];
    const graphStub = {
      listEntitiesByKind: (kind: string) => withOptions.filter((n) => n.kind === kind),
    };
    const result = decl?.preconditions?.({ graph: graphStub });
    expect(result?.ok).toBe(true);
  });
});
