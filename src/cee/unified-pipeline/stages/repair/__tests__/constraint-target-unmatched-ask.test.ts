/**
 * ROADMAP — A STATED LIMIT THAT CANNOT BE BOUND TO A NODE MUST BE ASKED ABOUT,
 * NEVER DROPPED IN SILENCE.
 *
 * ⚠⚠ THE DEFECT THIS FILE PINS, WIRE-WITNESSED ACROSS 10 RUNS OF ONE BRIEF ON
 * TWO DEPLOYED STAGING BUILDS (a0b3c06 and 91d3911, 2026-08-30). The brief says:
 *
 *     "…our support budget for the year is £240,000 … The goal is to bring
 *      first-response time back under four hours without going over budget."
 *
 * The regex extractor produces the constraint DETERMINISTICALLY on every single
 * run — identical bytes, `{targetName:"budget", operator:"<=", value:240000,
 * unit:"£", valueFrame:"level", confidence:0.75}`. The LLM plays no part in it.
 *
 * It is then DROPPED AT THE NODE-BINDING JOIN in 8 of those 10 runs, because
 * `fuzzyMatchNodeId`'s label fallback (`structural-reconciliation.ts:441`)
 * returns a match ONLY when `labelMatches.length === 1`, and two or more drafted
 * node labels contain the word "budget". `#labels containing "budget"` predicts
 * bind-vs-drop 10 out of 10.
 *
 * BEFORE THIS FIX, `remapResult.rejected_no_match` had EXACTLY ONE READER in the
 * whole service — a `log.info` field at `compound-goals.ts:342`. The user's
 * stated ceiling left no trace anywhere they could see it. The £240,000 reached
 * NO numeric field of the graph in all 8 absent runs.
 *
 * ⭐ THE SANCTIONED EXIT IS TO ASK (CLAUDE.md trap 22f). The ambiguity is real —
 * "Annual Support Budget Consumed" and "Budget Overrun Risk" are BOTH plausible
 * targets and the product cannot tell which the user meant. Widening the label
 * predicate is the four-round oscillation trap this estate has already paid for,
 * and narrowing the candidate set to {outcome,factor} was MEASURED IN ADVANCE by
 * the diagnosis lane: it removes both bad bindings but buys four bindings to a
 * factor whose values are MARGINAL in those very runs and one to a factor named
 * "Remaining Annual Budget" — the opposite direction. That trades a silent gap
 * for a confident wrong number, which is strictly worse.
 *
 * ⭐ FIXTURES ARE CAPTURED, NOT AUTHORED. Every node set below is transcribed
 * verbatim from the `draft_graph` of a real deployed run (see the fixture's
 * provenance note). A self-authored node set encodes the author's model of the
 * producer rather than the producer (trap 16-inverse) — and the whole defect
 * lives in what labels the producer happens to emit, so an authored set could
 * not see it at all.
 *
 * Assertions bind by node-id / reason IDENTITY, never by a value predicate
 * another row could satisfy (trap 19).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCompoundGoals } from '../compound-goals.js';
import { renderDirectionClarifications } from '../../../../compound-goal/direction-gate.js';
import {
  extractCompoundGoals,
  remapConstraintTargets,
} from '../../../../compound-goal/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface CapturedNode {
  readonly id: string;
  readonly kind?: string;
  readonly label?: string;
  readonly scale_frame?: number;
  readonly observed_state?: { readonly value?: number };
  readonly display_value?: string;
}

const NODE_SETS = JSON.parse(
  readFileSync(resolve(HERE, 'fixtures/staging-budget-brief-node-sets-2026-08-30.json'), 'utf-8'),
) as Record<string, CapturedNode[]>;

/**
 * THE REAL BRIEF, byte-identical to the one every one of the 10 captured runs
 * was driven with. Not a synthetic reduction of it: the ambiguity that drops the
 * constraint is partly created by the goal sentence restating the limit
 * ("without going over budget"), which a trimmed fixture would lose.
 */
const BRIEF =
  'Should we hire three more support engineers next quarter, or hold the headcount we have? ' +
  'Our support budget for the year is £240,000 and each engineer costs about £65,000 fully loaded. ' +
  'Ticket backlog has roughly doubled since January. ' +
  'The goal is to bring first-response time back under four hours without going over budget.';

/** Runs that DROPPED the constraint on the wire (label count != 1). */
const DROP_RUNS = ['272c16', 'f887d4', 'f869d0', '75900a', '63d377', '150852', 'd2a1e8'] as const;
/** Runs that BOUND it — in both cases to a value-less `risk` node. */
const BIND_RUNS = ['54a08b', 'a2da4f'] as const;

interface RunResult {
  readonly wire: Array<{ node_id: string; value: number; operator: string }>;
  readonly asks: Array<{
    metric_text: string;
    amount_text: string;
    reason: string;
    question: string;
    value: number | null;
  }>;
}

function run(nodes: readonly CapturedNode[]): RunResult {
  const ctx: any = {
    requestId: 'test-constraint-target-unmatched',
    effectiveBrief: BRIEF,
    graph: { nodes: nodes.map((n) => ({ ...n })), edges: [] },
    llmGoalConstraints: undefined,
    goalConstraints: undefined,
    directionUnresolved: undefined,
  };
  runCompoundGoals(ctx);
  return {
    wire: (ctx.goalConstraints ?? []).map((c: any) => ({
      node_id: c.node_id,
      value: c.value,
      operator: c.operator,
    })),
    asks: (ctx.directionUnresolved ?? []).map((i: any) => ({
      metric_text: i.metric_text,
      amount_text: i.amount_text,
      reason: i.reason,
      question: i.question,
      value: i.value ?? null,
    })),
  };
}

describe('a stated limit that binds to nothing is asked about, not dropped', () => {
  /**
   * THE CONTROL THAT MAKES EVERY ASSERTION BELOW NON-VACUOUS. If the fixture or
   * the brief ever stopped reproducing the deployed bind/drop split, every
   * "an ask is present" assertion would pass or fail for a reason that has
   * nothing to do with this fix. Pinned by node-id identity.
   */
  it('CONTROL — the captured node sets still reproduce the deployed 2-bind / 8-drop split', () => {
    for (const id of BIND_RUNS) {
      const { wire } = run(NODE_SETS[id]!);
      expect(wire.filter((c) => c.value === 240000)).toHaveLength(1);
    }
    for (const id of DROP_RUNS) {
      const { wire } = run(NODE_SETS[id]!);
      expect(wire.filter((c) => c.value === 240000)).toHaveLength(0);
    }
    // The degenerate 4-node run carries no budget-family node at all.
    expect(run(NODE_SETS['4fd953']!).wire.filter((c) => c.value === 240000)).toHaveLength(0);
  });

  it.each(DROP_RUNS)(
    'ACCEPTANCE 1 — run %s: the unbindable £240,000 reaches the user as a question',
    (id) => {
      const { wire, asks } = run(NODE_SETS[id]!);
      // Precondition pinned IN-TEST (trap 13b): this run really does drop it.
      expect(wire.filter((c) => c.value === 240000)).toHaveLength(0);

      const ask = asks.find((a) => a.reason === 'target_unmatched');
      expect(ask, `run ${id} must ask about the unbindable limit`).toBeDefined();
      expect(ask!.value).toBe(240000);
      expect(ask!.amount_text).toContain('240,000');
    },
  );

  it('ACCEPTANCE 1 — the question asks WHICH PART OF THE MODEL, not floor-or-ceiling', () => {
    // The brief states the direction unambiguously ("without going over
    // budget"). Asking a floor-or-ceiling question here would be a confident
    // wrong question, and every OTHER reason asks exactly that — so this pins
    // the branch, not merely the record.
    const { asks } = run(NODE_SETS['272c16']!);
    const ask = asks.find((a) => a.reason === 'target_unmatched')!;
    expect(ask.question.toLowerCase()).not.toContain('at or above');
    expect(ask.question.toLowerCase()).toContain('part of');
  });

  it('ACCEPTANCE 1 — the rendered coaching card asks the binding question', () => {
    const ctx: any = {
      requestId: 'test-render',
      effectiveBrief: BRIEF,
      graph: { nodes: NODE_SETS['272c16']!.map((n) => ({ ...n })), edges: [] },
      goalConstraints: undefined,
      directionUnresolved: undefined,
    };
    runCompoundGoals(ctx);
    const cards = renderDirectionClarifications(ctx.directionUnresolved ?? []);
    const card = cards.find((c) => c.detail.includes('240,000'));
    expect(card, 'the unbindable limit must reach a coaching card').toBeDefined();
    expect(card!.detail.toLowerCase()).toContain('part of');
    // It must NOT ask the floor-or-ceiling question — the direction is stated.
    expect(card!.detail.toLowerCase()).not.toContain('at or above');
    expect(card!.action_type).toBe('add_constraint');
  });

  /**
   * THE OPPOSITE-DIRECTION TWIN (standing brief §3). A limit whose direction is
   * genuinely unproven must STILL get the floor-or-ceiling question. If the new
   * branch leaked into the existing reasons, this goes red — so the pair
   * together prove the branch discriminates rather than merely fires.
   */
  it('TWIN — a genuinely direction-unresolved limit still gets the floor-or-ceiling question', () => {
    const ctx: any = {
      requestId: 'test-twin',
      effectiveBrief:
        'We are weighing two plans. Do not, and this is firm, let gross margin drop below 78%.',
      graph: {
        nodes: [
          { id: 'goal_1', kind: 'goal', label: 'Pick a plan' },
          { id: 'out_margin', kind: 'outcome', label: 'Gross margin' },
        ],
        edges: [],
      },
      goalConstraints: undefined,
      directionUnresolved: undefined,
    };
    runCompoundGoals(ctx);
    const items = (ctx.directionUnresolved ?? []) as Array<{ reason: string; question: string }>;
    const nonBinding = items.filter((i) => i.reason !== 'target_unmatched');
    expect(nonBinding.length, 'the direction gate must still speak').toBeGreaterThan(0);
    for (const i of nonBinding) {
      expect(i.question.toLowerCase()).toContain('at or above');
    }
  });

  /**
   * ACCEPTANCE — NOTHING IS HIDDEN. The bound runs still ship the row. This fix
   * adds disclosure; it removes nothing from the wire (standing brief §RULING).
   */
  it.each(BIND_RUNS)('run %s still ships the constraint it managed to bind', (id) => {
    const { wire } = run(NODE_SETS[id]!);
    expect(wire.filter((c) => c.value === 240000 && c.operator === '<=')).toHaveLength(1);
  });
});

/**
 * `RemapResult.unbindable` IS A STRICT SUBSET OF `rejected_no_match`.
 *
 * ⚠⚠ THIS BLOCK EXISTS BECAUSE THE CLAIM WAS MADE BEFORE IT WAS TRUE. The
 * field's own docstring said the relation "is asserted by spec rather than
 * intended" while NO SPEC ANYWHERE READ `.unbindable` — measured at review with
 * a positive control (`rejected_no_match` → 28 hits) and a fabricated contrast
 * (0 hits). The behaviour was correct; the sentence describing it was a
 * fabrication, and a sentence in the tree asserting a guard that does not exist
 * is exactly how a later session inherits false confidence (CLAUDE.md trap 14).
 * Written now so the docstring is a fact.
 *
 * ⭐ WHY THE GAP IS LOAD-BEARING AND NOT AN ACCOUNTING QUIRK. `noMatchCount` is
 * incremented at TWO sites: step 0 (a temporal constraint with no goal node to
 * bind to) and step 6 (a genuine no-match). Only step 6 fills `unbindable`.
 * ROADMAP 2.349 established that a deadline is NOT a hard constraint and must
 * not generate a limit question — so if the two ever became equal, every brief
 * containing a time phrase would start asking the user which part of their
 * model "18 months" applies to, which is precisely the defect 2.349 closed.
 * The strict-subset case below is therefore the one that matters, and it is
 * asserted with a positive control beside it so an always-empty array could not
 * satisfy it vacuously.
 *
 * Inputs derived by executing the real extractor at this tip, not invented.
 */
describe('unbindable is a strict subset of rejected_no_match', () => {
  const GOAL_AND_FACTOR = [
    { id: 'goal_1', kind: 'goal', label: 'Ship it' },
    { id: 'fac_x', kind: 'factor', label: 'Something Else' },
  ];
  const FACTOR_ONLY = [{ id: 'fac_x', kind: 'factor', label: 'Something Else' }];

  function remap(brief: string, nodes: ReadonlyArray<{ id: string; kind?: string; label?: string }>) {
    const ex = extractCompoundGoals(brief, { includeProxies: false });
    const ids = nodes.map((n) => n.id);
    const labels = new Map(nodes.filter((n) => n.label).map((n) => [n.id, n.label!]));
    const goalNodeId = nodes.find((n) => n.kind === 'goal')?.id;
    return { ex, r: remapConstraintTargets(ex.constraints, ids, labels, 'test-subset', goalNodeId) };
  }

  /** A time phrase with no goal node: step 0 drops it and counts it. */
  const DEADLINE_BRIEF = 'Deliver the platform rebuild within 18 months.';
  /** A stated ceiling that matches no label: step 6 drops it and KEEPS it. */
  const CEILING_BRIEF = 'Our support budget for the year is £240,000.';

  it('POSITIVE CONTROL — a step-6 drop really does land in the array', () => {
    // Without this, every assertion below is satisfiable by an array that is
    // always empty (trap 13: an absence probe needs to prove it can see a
    // presence).
    const { r } = remap(CEILING_BRIEF, GOAL_AND_FACTOR);
    expect(r.rejected_no_match).toBe(1);
    expect(r.unbindable.map((c) => c.targetName)).toEqual(['budget']);
  });

  it('⭐ THE STRICT CASE — a temporal drop is COUNTED but never carried', () => {
    const { ex, r } = remap(DEADLINE_BRIEF, FACTOR_ONLY);
    // Precondition pinned IN-TEST: this brief really does produce a
    // deadline-bearing row, and there really is no goal node to bind it to.
    expect(ex.constraints.filter((c) => c.deadlineMetadata !== undefined)).toHaveLength(1);
    expect(FACTOR_ONLY.some((n) => n.kind === 'goal')).toBe(false);

    expect(r.rejected_no_match, 'step 0 must count the temporal drop').toBe(1);
    expect(r.unbindable, 'and must contribute NOTHING to the ask channel').toEqual([]);
    expect(r.unbindable.length).toBeLessThan(r.rejected_no_match);
  });

  it('a mixed brief keeps the relation, with the gap exactly the temporal row', () => {
    const brief = 'We must ship the migration within 18 months and keep churn under 5%.';
    const { r } = remap(brief, FACTOR_ONLY);
    expect(r.rejected_no_match).toBe(4);
    expect(r.unbindable).toHaveLength(3);
    expect(
      r.unbindable.every((c) => c.deadlineMetadata === undefined),
      'no deadline-bearing row may reach the ask channel',
    ).toBe(true);
  });

  it.each([
    ['deadline, goal present', DEADLINE_BRIEF, GOAL_AND_FACTOR],
    ['deadline, no goal', DEADLINE_BRIEF, FACTOR_ONLY],
    ['ceiling, goal present', CEILING_BRIEF, GOAL_AND_FACTOR],
    ['ceiling, no goal', CEILING_BRIEF, FACTOR_ONLY],
    ['mixed, no goal', 'We must ship the migration within 18 months and keep churn under 5%.', FACTOR_ONLY],
    ['nothing extractable', 'We are deciding between two suppliers.', GOAL_AND_FACTOR],
  ])('THE INVARIANT holds: %s', (_name, brief, nodes) => {
    const { r } = remap(brief, nodes);
    expect(r.unbindable.length).toBeLessThanOrEqual(r.rejected_no_match);
  });

  it('END TO END — a deadline brief produces NO ask, so ROADMAP 2.349 is intact', () => {
    // The consequence the invariant exists to protect, asserted at the stage
    // rather than at the helper: a time phrase must never reach the user as
    // "which part of your model does 18 months apply to?".
    const ctx: any = {
      requestId: 'test-2349-intact',
      effectiveBrief: DEADLINE_BRIEF,
      graph: { nodes: FACTOR_ONLY.map((n) => ({ ...n })), edges: [] },
      goalConstraints: undefined,
      directionUnresolved: undefined,
    };
    runCompoundGoals(ctx);
    const asks = (ctx.directionUnresolved ?? []) as Array<{ reason: string }>;
    expect(asks.filter((a) => a.reason === 'target_unmatched')).toEqual([]);
  });
});
