/**
 * ⭐⭐ PAUL'S LIVE CASE, 16 Sep 2026 — A £200,000 LIMIT BOUND TO A NODE THAT
 * MEASURES NOTHING. PINNED AS AN EXPLICIT KNOWN GAP, NOT FIXED.
 *
 * From the exported debug bundle of a real manual test:
 *
 *   goal_constraints[0] = { node_id: "dac3fdc3", operator: "<=", value: 200000,
 *                           unit: "£", provenance: "explicit",
 *                           value_frame: "level" }
 *
 * `dac3fdc3` is `kind: "risk"`, label "Budget Overrun Risk", `observed_state:
 * null` — no value, NO DECLARED UNIT. The service then told the user four times
 * in one session that the limit "could not be checked", and logged
 * `v5.run_analysis.constraint_unevaluated` with
 * `codes: ["CONSTRAINT_OUT_OF_DOMAIN","CONSTRAINT_TARGET_UNRELIABLE"]`.
 * The correct target was present throughout: `7809def4` "Hiring and Onboarding
 * Cost", a factor carrying the option-level amounts £155,000 and £0.
 *
 * ⛔⛔ THE FIX I FIRST WROTE WAS WRONG, AND EXECUTION IS WHAT SAID SO. I filtered
 * every binder branch through `MINTABLE_TARGET_KINDS` ({outcome, factor}), the
 * rule the draft-records projector already enforces. All six cases below went
 * green — and SEVEN tests in this directory went red, four of them in
 * `compound-goals-frame-precedence`, which binds limits to `risk_cost`
 * ("marketing cost") DELIBERATELY. Two more were known-gap pins whose sets my
 * filter SHRANK. Independent review had also already ruled: "do not force a
 * risk-to-factor reclassification merely to satisfy the binder — metric
 * semantics and a causal role are different questions".
 *
 * ⭐ WHAT THE REFUTATION REVEALED, and it is sharper than the fix it killed.
 * Measured on the fixtures that bind to a risk on purpose: they bind FRACTIONS
 * (0.05, -0.15, 0.85) and small currency values (£1, £30). Paul's row bound
 * `200000` with unit `"£"` to a node declaring NO UNIT. And the projector's own
 * SAFETY 2 cannot see it:
 *
 *   if (limitFamily !== "unknown" && targetFamily !== "unknown" && limitFamily !== targetFamily)
 *
 * — it refuses only when BOTH families are known, so an UNDECLARED target unit
 * is permissive by construction. **The discriminator is scale and unit, not
 * kind.** `CONSTRAINT_OUT_OF_DOMAIN` is the downstream saying exactly that.
 *
 * ⚠ SO THIS FILE PINS THE GAP RATHER THAN CLOSING IT, which is this estate's
 * ratified way to hold a known defect honestly: the suite stays green for the
 * right reason and REDs if the set GROWS (a new leak) or SHRINKS (a stale note).
 * Closing it needs a unit/scale rule owned by whoever owns the binder, not a
 * kind filter bolted on here.
 */
import { describe, it, expect } from 'vitest';

import { runCompoundGoals } from '../compound-goals.js';

/** The real node set from Paul's bundle, ids included — sha8, no prefixes. */
const NODES = [
  { id: 'c3636f2d', kind: 'goal', label: 'Increase Productivity, While Maintaining Code Quality' },
  { id: 'dac3fdc3', kind: 'risk', label: 'Budget Overrun Risk' },
  { id: '7809def4', kind: 'factor', label: 'Hiring and Onboarding Cost' },
  { id: '2243759d', kind: 'outcome', label: 'Code Quality Level' },
];
const kindOf = (id: string) => NODES.find((n) => n.id === id)?.kind;
const BRIEF =
  'I need to decide whether to hire a tech lead or two developers. Total hiring spend this year must not exceed £200,000.';

function run(llm?: unknown[]) {
  const ctx: any = {
    requestId: 'test-draft-constraint-target-kind',
    effectiveBrief: BRIEF,
    graph: { nodes: NODES.map((n) => ({ ...n })), edges: [] },
    llmGoalConstraints: llm,
    goalConstraints: undefined,
    directionUnresolved: undefined,
  };
  runCompoundGoals(ctx);
  return (ctx.goalConstraints ?? []) as Array<{ node_id: string; operator: string; value: number; unit?: string }>;
}
const llmRow = (node_id: string, value: number, unit: string) => ({
  constraint_id: `llm_${node_id}_max`,
  node_id,
  operator: '<=',
  value,
  unit,
  label: `At or below ${value}`,
  source_quote: 'Total hiring spend this year must not exceed £200,000',
  provenance: 'explicit',
});

/**
 * THE KNOWN GAP, AS AN EXACT SET. Each entry is a target kind this binder admits
 * today for a raw currency magnitude against a node declaring no unit. Adding to
 * this set is a new leak; removing from it without a deliberate fix is a stale
 * note. Both must RED.
 */
const KNOWN_ADMITS_A_UNITLESS_TARGET = ['risk', 'goal'] as const;

describe('K1 — Paul’s live £200,000 row, pinned as a known gap', () => {
  it('K1a the exact set of non-measuring kinds this binder still admits', () => {
    const admitted: string[] = [];
    for (const n of NODES) {
      if (n.kind === 'factor' || n.kind === 'outcome') continue;
      if (run([llmRow(n.id, 200000, '£')]).some((r) => r.node_id === n.id)) admitted.push(n.kind!);
    }
    expect(
      admitted.sort(),
      'known gap: a raw currency magnitude binds to a node that declares no unit',
    ).toEqual([...KNOWN_ADMITS_A_UNITLESS_TARGET].sort());
  });

  it('K1b THE HARM, stated as the live row: £200,000 lands on `Budget Overrun Risk`', () => {
    const onRisk = run([llmRow('dac3fdc3', 200000, '£')]).filter((r) => kindOf(r.node_id) === 'risk');
    expect(onRisk.length, 'reproduces the bundle exactly; closing this is a unit/scale rule, not a kind filter').toBe(1);
    expect(onRisk[0]?.value).toBe(200000);
  });

  it('K1c CONTROL: the correct £ factor target binds, so the gap is a MISDIRECTION not an outage', () => {
    const mine = run([llmRow('7809def4', 200000, '£')]).filter((r) => r.node_id === '7809def4');
    expect(mine.length, 'the right target was available the whole time').toBe(1);
    expect(mine[0]?.value, "the user's own number, unrescaled").toBe(200000);
  });

  it('K1d CONTROL: a node that is not on the graph is still refused', () => {
    expect(run([llmRow('ffffffff', 200000, '£')]).filter((r) => r.node_id === 'ffffffff')).toEqual([]);
  });
});
