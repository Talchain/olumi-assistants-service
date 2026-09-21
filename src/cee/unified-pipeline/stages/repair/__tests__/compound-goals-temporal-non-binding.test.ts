/**
 * ROADMAP 2.349 (ROOT HALF) — a deadline never enters `goal_constraints[]`.
 *
 * NOTHING IS MOCKED HERE. The point of this file is that the REAL extractor,
 * on the tester's REAL brief, must stop producing a hard constraint — so the
 * sibling substep test's mock-the-extractor pattern would measure nothing.
 * `extractCompoundGoals`, `remapConstraintTargets`, `normaliseConstraintUnits`
 * and `toGoalConstraints` all run for real.
 *
 * THE BRIEF IS VERBATIM from the walk that produced the defect
 * (`journey-witness-2026-08-04b-raw/p3b/brief.txt`), and at CEE `1ba181e` it
 * yields EXACTLY the entry captured on that walk's draft wire:
 *
 *   {"constraint_id":"constraint_goal_arr_max","node_id":"goal_arr",
 *    "operator":"<=","value":18,"label":"Delivery deadline","unit":"months",
 *    "source_quote":"within 18 months","confidence":0.95,
 *    "provenance":"inferred","deadline_metadata":{…}}
 *
 * — a MONTHS-unit ceiling welded onto a £-measured goal node, invented by CEE
 * from a goal qualifier the user wrote, with no ratification bit anywhere. PLoT
 * deletes it on every run because time is not a modelled dimension; CEE then
 * read that guaranteed deletion as "the engine did not check your condition"
 * and withheld the leading option. Forever, on every rerun.
 *
 * THE POSITIVE CONTROL IS THE LOAD-BEARING HALF (trap 13): the same brief also
 * carries an ordinary budget/churn phrasing, and an ordinary constraint must
 * still be emitted. "goal_constraints is empty" would pass just as well if the
 * fix had disabled constraint extraction altogether.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { runCompoundGoals, partitionTemporalNonBinding } from '../compound-goals.js';

/** The tester's brief, byte-for-byte from the walk capture. */
const WALK_BRIEF =
  'Our team runs a 12-person B2B SaaS business. Revenue is currently £400,000 ARR and our target is £1,000,000 ARR within 18 months. We can\'t decide whether to hire two more sales reps, spend on content marketing, or build a self-serve tier. We only have about £150,000 to spend, and churn has been creeping up. What should we do?';

/** The same brief with ONLY the time phrase removed — the diagnosis's control. */
const WALK_BRIEF_NO_TIME_PHRASE = WALK_BRIEF.replace(' within 18 months', '');

function makeCtx(overrides?: Record<string, any>): any {
  return {
    requestId: 'test-2349-temporal',
    effectiveBrief: WALK_BRIEF,
    graph: {
      nodes: [
        { id: 'goal_arr', kind: 'goal', label: 'Annual recurring revenue' },
        { id: 'opt_sales', kind: 'option', label: 'Hire Two Sales Reps' },
        { id: 'opt_content', kind: 'option', label: 'Content Marketing' },
        { id: 'fac_churn', kind: 'factor', label: 'Churn rate' },
        { id: 'out_spend', kind: 'outcome', label: 'Spend' },
      ],
      edges: [],
    },
    goalConstraints: undefined,
    ...overrides,
  };
}

const hasDeadline = (c: any) =>
  c?.deadline_metadata !== undefined && c?.deadline_metadata !== null;

describe('2.349 R3 — the walk brief no longer mints a hard deadline constraint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('goal_constraints[] carries NO deadline_metadata entry', () => {
    const ctx = makeCtx();
    runCompoundGoals(ctx);
    const emitted: any[] = ctx.goalConstraints ?? [];
    expect(emitted.filter(hasDeadline)).toEqual([]);
  });

  it('and specifically not the walk’s own “Delivery deadline” / constraint_goal_arr_max', () => {
    const ctx = makeCtx();
    runCompoundGoals(ctx);
    const emitted: any[] = ctx.goalConstraints ?? [];
    expect(emitted.map((c) => c.constraint_id)).not.toContain('constraint_goal_arr_max');
    expect(emitted.map((c) => c.label)).not.toContain('Delivery deadline');
  });

  it('POSITIVE CONTROL: the extractor still SEES the deadline — it is the EMISSION that stopped', async () => {
    // Trap 13 in its sharpest form for this half. If `extractCompoundGoals` had
    // simply stopped detecting time phrases, every absence assertion above
    // would pass while the fix was somewhere else entirely — and the deadline
    // metadata other consumers read (`generateConstraintNodes`) would be gone
    // too. This proves the extraction survives and only the write is gated.
    const { extractCompoundGoals } = await import('../../../../compound-goal/index.js');
    const extracted = extractCompoundGoals(WALK_BRIEF, { includeProxies: false });
    const temporal = extracted.constraints.filter((c: any) => c.deadlineMetadata);
    expect(temporal.length).toBeGreaterThan(0);
    expect(temporal[0]!.label).toBe('Delivery deadline');
    expect(temporal[0]!.unit).toBe('months');
  });

  it('POSITIVE CONTROL: an ORDINARY constraint is still emitted from the same run', () => {
    // Without this, "no deadline in goal_constraints" would be satisfied by a
    // fix that emitted nothing at all.
    const ctx = makeCtx({
      llmGoalConstraints: [
        {
          constraint_id: 'constraint_fac_churn_max',
          node_id: 'fac_churn',
          operator: '<=',
          value: 0.05,
          label: 'Churn ceiling',
          // ROADMAP 2.1051: the direction gate is fail-closed on unverifiable
          // evidence, so the ordinary sibling carries a quote from the brief.
          // Without one it is withheld for lack of evidence and this positive
          // control would silently stop controlling for anything.
          source_quote: 'churn has been creeping up',
        },
      ],
    });
    runCompoundGoals(ctx);
    const emitted: any[] = ctx.goalConstraints ?? [];
    expect(emitted.map((c) => c.constraint_id)).toContain('constraint_fac_churn_max');
    expect(emitted.filter(hasDeadline)).toEqual([]);
  });

  it('the LLM path is gated too — the same rule, whoever produced the entry', () => {
    // `src/schemas/assist.ts` declares `deadline_metadata` on the LLM's own
    // `goal_constraints[]`, so fixing only the regex extractor would leave the
    // identical unevaluable constraint reachable through the model. This is
    // why the gate sits at the single merge point rather than in either
    // producer.
    const ctx = makeCtx({
      effectiveBrief: WALK_BRIEF_NO_TIME_PHRASE,
      llmGoalConstraints: [
        {
          constraint_id: 'constraint_goal_arr_max',
          node_id: 'goal_arr',
          operator: '<=',
          value: 18,
          label: 'Delivery deadline',
          unit: 'months',
          deadline_metadata: {
            deadline_date: '2028-02-03',
            reference_date: '2026-08-03',
            assumed_reference_date: true,
          },
        },
        {
          constraint_id: 'constraint_fac_churn_max',
          node_id: 'fac_churn',
          operator: '<=',
          value: 0.05,
          label: 'Churn ceiling',
          // ROADMAP 2.1051: the direction gate is fail-closed on unverifiable
          // evidence, so the ordinary sibling carries a quote from the brief.
          // Without one it is withheld for lack of evidence and this positive
          // control would silently stop controlling for anything.
          source_quote: 'churn has been creeping up',
        },
      ],
    });
    runCompoundGoals(ctx);
    const emitted: any[] = ctx.goalConstraints ?? [];
    expect(emitted.filter(hasDeadline)).toEqual([]);
    // …and the ordinary sibling on the SAME LLM payload survived, so the gate
    // is per-entry and not per-payload.
    expect(emitted.map((c) => c.constraint_id)).toEqual(['constraint_fac_churn_max']);
  });
});

describe('2.349 — partitionTemporalNonBinding, directly', () => {
  it('splits on deadline_metadata PRESENCE — the same signal PLoT’s DROP RULE 1 uses', () => {
    const a = { constraint_id: 'a' };
    const b = { constraint_id: 'b', deadline_metadata: { deadline_date: '2028-02-03' } };
    const c = { constraint_id: 'c', deadline_metadata: null };
    const d = { constraint_id: 'd', deadline_metadata: undefined };
    const { binding, temporal } = partitionTemporalNonBinding([a, b, c, d]);
    // `null` and `undefined` are ABSENCE, matching PLoT's own predicate
    // (`deadline_metadata !== undefined && deadline_metadata !== null`).
    expect(binding).toEqual([a, c, d]);
    expect(temporal).toEqual([b]);
  });

  it('preserves order and is a no-op on an all-binding list', () => {
    const list = [{ constraint_id: 'x' }, { constraint_id: 'y' }, { constraint_id: 'z' }];
    const { binding, temporal } = partitionTemporalNonBinding(list);
    expect(binding).toEqual(list);
    expect(temporal).toEqual([]);
  });
});
