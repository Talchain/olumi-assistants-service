/**
 * ROADMAP 2.932 (CEE limb) — A DETERMINISTIC FRAME OUTRANKS AN UNFRAMED MODEL
 * DUPLICATE. Found by Codex external review R4 (MF2), reproduced by execution
 * at `ed8aad89` before a line was changed.
 *
 * THE DEFECT. Two producers write `goal_constraints[]` and the merge below them
 * dedupes on `node_id::operator` with the LLM unconditionally last-in-wins. The
 * key does not mention the frame, so an LLM duplicate that carries NO
 * `value_frame` silently DESTROYS the one the regex extractor deterministically
 * minted (#862). Measured at pristine: brief "Keep churn under 5%" + an LLM row
 * on the same node/operator ⇒ the surviving row is the model's, `value_frame`
 * ABSENT. ISL then refuses the whole `constraint_analysis` block with
 * `CONSTRAINT_FRAME_UNSPECIFIED` — so #862 delivered a frame that a neighbouring
 * code path could erase at any time, on any brief the model also commented on.
 *
 * WHY NOT SIMPLY FLIP THE PRECEDENCE. The LLM row is preferred for a real
 * reason, stated at the merge: it carries richer metadata (source_quote,
 * confidence, provenance, a better label). Reverting that would trade one loss
 * for another. The rule this file pins is narrower and is the one the review
 * asked for: THE FRAME IS PROTECTED PAYLOAD — model prose may still enrich every
 * other field.
 *
 * ⚠ AND THE BREADTH GATE, WHICH IS THE HALF THAT COULD HAVE MADE THIS WORSE THAN
 * THE DEFECT (trap 22 — the defect lives in the predicate's DOMAIN, not in the
 * invariant). Two rows sharing `node_id::operator` DO NOT necessarily describe
 * the same quantity: the regex row may hold `-0.15` from "reduce cost by 15%"
 * (a DELTA) while the model's row holds `0.85` (a LEVEL) under the identical
 * key. Carrying the deterministic frame across THAT pair would attest the
 * model's level number as a delta and hand ISL a confident wrong probability —
 * strictly worse than today's honest gap. So preservation is gated on the two
 * rows describing the SAME NUMBER IN THE SAME UNIT, and fails CLOSED otherwise.
 * Those cases are pinned here as first-class tests, not as an afterthought.
 *
 * Nothing is mocked: the real extractor, remap, unit normalisation and merge all
 * run, so the regex side of every fixture is the PRODUCER's own emission rather
 * than a shape this file imagined (trap 16-inverse).
 *
 * Assertions bind by node-id + operator IDENTITY (trap 19).
 */
import { describe, it, expect } from 'vitest';

import { runCompoundGoals } from '../compound-goals.js';

const NODES = [
  { id: 'out_churn', kind: 'outcome', label: 'churn' },
  { id: 'risk_cost', kind: 'risk', label: 'marketing cost' },
  { id: 'goal_arr', kind: 'goal', label: 'Annual recurring revenue' },
  // Unit-less target: 'Keep headcount under 30.' mints `30` with NO unit, which
  // is what makes a SAME-NUMBER / DIFFERENT-UNIT pair constructible below.
  { id: 'out_headcount', kind: 'outcome', label: 'headcount' },
];

function merge(brief: string, llmGoalConstraints?: unknown[]): any[] {
  const ctx: any = {
    requestId: 'test-2932-frame-precedence',
    effectiveBrief: brief,
    graph: { nodes: NODES, edges: [] },
    llmGoalConstraints,
    goalConstraints: undefined,
  };
  runCompoundGoals(ctx);
  return ctx.goalConstraints ?? [];
}

/** Bind by IDENTITY, and prove uniqueness so `[0]` cannot pick either of two. */
function pick(rows: any[], nodeId: string, operator: '>=' | '<=') {
  const hits = rows.filter((r) => r.node_id === nodeId && r.operator === operator);
  expect(
    hits,
    `expected exactly one ${operator} row on '${nodeId}'; got ${JSON.stringify(rows)}`,
  ).toHaveLength(1);
  return hits[0];
}

/** The regex row this brief mints on its own — the PRECONDITION every test needs. */
function regexOnly(brief: string, nodeId: string, operator: '>=' | '<=') {
  return pick(merge(brief), nodeId, operator);
}

const CHURN_BRIEF = 'Keep churn under 5%.';
const REDUCTION_BRIEF = 'Reduce marketing cost by 15%.';
/** Mints a UNIT-LESS `30`, so a same-number/different-unit pair is buildable. */
const HEADCOUNT_BRIEF = 'Keep headcount under 30.';

describe('2.932 — a deterministic frame survives an unframed model duplicate', () => {
  it('PRECONDITION: the brief alone really does mint a FRAMED row', () => {
    // Pin the precondition in-test (trap 13b). Every assertion below is about
    // a frame SURVIVING a merge; if the extractor stopped minting one, they
    // would all pass while proving nothing.
    const row = regexOnly(CHURN_BRIEF, 'out_churn', '<=');
    expect(row.value_frame).toBe('level');
    expect(row.value).toBe(0.05);
  });

  it('the unframed LLM duplicate no longer erases the frame', () => {
    const rows = merge(CHURN_BRIEF, [
      {
        constraint_id: 'gc-llm-dup',
        node_id: 'out_churn',
        operator: '<=',
        value: 0.05,
        unit: 'fraction',
        label: 'Churn ceiling (model wording)',
        source_quote: 'Keep churn under 5%.',
        confidence: 0.9,
        provenance: 'explicit',
      },
    ]);

    const row = pick(rows, 'out_churn', '<=');
    expect(
      row.value_frame,
      'the model duplicate destroyed the deterministic frame — ISL will refuse ' +
        'the entire constraint_analysis block with CONSTRAINT_FRAME_UNSPECIFIED',
    ).toBe('level');
  });

  it("the model's ENRICHMENT still wins — only the frame is protected", () => {
    // The merge exists to prefer the model's richer metadata. A fix that
    // reverted precedence wholesale would pass the test above and silently
    // undo the reason the merge is written this way.
    const rows = merge(CHURN_BRIEF, [
      {
        constraint_id: 'gc-llm-dup',
        node_id: 'out_churn',
        operator: '<=',
        value: 0.05,
        unit: 'fraction',
        label: 'Churn ceiling (model wording)',
        source_quote: 'Keep churn under 5%.',
        confidence: 0.9,
        provenance: 'explicit',
      },
    ]);

    const row = pick(rows, 'out_churn', '<=');
    expect(row.constraint_id).toBe('gc-llm-dup');
    expect(row.label).toBe('Churn ceiling (model wording)');
    expect(row.source_quote).toBe('Keep churn under 5%.');
    expect(row.confidence).toBe(0.9);
    expect(row.value_frame).toBe('level');
  });

  it("the DELTA frame is protected too, not just 'level'", () => {
    // The delta branch is the one the cross-service chain trusts hardest — ISL
    // applies a delta attestation with no domain guard — so losing it is the
    // more expensive half.
    expect(regexOnly(REDUCTION_BRIEF, 'risk_cost', '<=').value_frame).toBe('delta');

    const rows = merge(REDUCTION_BRIEF, [
      {
        constraint_id: 'gc-llm-red',
        node_id: 'risk_cost',
        operator: '<=',
        value: -0.15,
        unit: 'fraction',
        label: 'Marketing cost reduction (model wording)',
        source_quote: 'Reduce marketing cost by 15%.',
      },
    ]);

    expect(pick(rows, 'risk_cost', '<=').value_frame).toBe('delta');
  });
});

describe('2.932 — preservation FAILS CLOSED when the two rows are different quantities', () => {
  it('a model duplicate with a DIFFERENT VALUE does NOT inherit the frame', () => {
    // Same `node_id::operator` key, different number: "reduce cost by 15%"
    // (delta, -0.15) versus the model's 0.85 (a level). Inheriting 'delta' here
    // would attest a level number as a change-from-origin and hand ISL a
    // confident WRONG probability — worse than the honest gap.
    expect(regexOnly(REDUCTION_BRIEF, 'risk_cost', '<=').value_frame).toBe('delta');

    const rows = merge(REDUCTION_BRIEF, [
      {
        constraint_id: 'gc-llm-other-number',
        node_id: 'risk_cost',
        operator: '<=',
        value: 0.85,
        unit: 'fraction',
        label: 'Marketing cost ceiling (model wording)',
        source_quote: 'Reduce marketing cost by 15%.',
      },
    ]);

    const row = pick(rows, 'risk_cost', '<=');
    expect(row.value).toBe(0.85);
    expect(
      row.value_frame,
      "the deterministic frame was welded onto a DIFFERENT number the model " +
        'supplied under the same dedupe key — a manufactured attestation',
    ).toBeUndefined();
  });

  it('a model duplicate with the SAME NUMBER but a DIFFERENT UNIT does NOT inherit the frame', () => {
    // ⚠ THIS FIXTURE IS DELIBERATELY SAME-NUMBER, AND THE FIRST VERSION OF IT
    // WAS NOT. It originally paired `0.05 fraction` with `5 %` — two rows that
    // differ in BOTH value and unit, so the value gate alone satisfied it and
    // the unit gate was left completely unguarded. The mutant caught it:
    // forcing `sameUnit = true` left the whole suite GREEN. That is trap 13b in
    // miniature — a test that names one guard and exercises another — and it is
    // why a surviving mutant is a finding, not a footnote.
    //
    // `30` (unit-less headcount) against the model's `30 £` is the same number
    // under two different scales. They may or may not be the same quantity;
    // deciding that requires a unit reconciliation this merge does not do, so it
    // refuses. The cost of refusing is one unframed constraint; the cost of
    // guessing is a wrong number.
    const deterministic = regexOnly(HEADCOUNT_BRIEF, 'out_headcount', '<=');
    expect(deterministic.value).toBe(30);
    expect(deterministic.unit).toBeUndefined();
    expect(deterministic.value_frame).toBe('level');

    const rows = merge(HEADCOUNT_BRIEF, [
      {
        constraint_id: 'gc-llm-currency',
        node_id: 'out_headcount',
        operator: '<=',
        value: 30,
        unit: '£',
        label: 'Headcount ceiling (model wording)',
        source_quote: 'Keep headcount under 30.',
      },
    ]);

    const row = pick(rows, 'out_headcount', '<=');
    expect(row.value).toBe(30);
    expect(row.unit).toBe('£');
    expect(
      row.value_frame,
      'the frame crossed a unit boundary on a bare numeric coincidence',
    ).toBeUndefined();
  });

  it('an LLM row with NO regex counterpart stays unframed', () => {
    // PRECONDITION PAIR: the same merge demonstrably DOES frame a row when a
    // deterministic counterpart exists, so the absence here is the input's
    // doing rather than a merge that stopped carrying the field at all.
    const framed = merge(CHURN_BRIEF, [
      { constraint_id: 'gc-a', node_id: 'out_churn', operator: '<=', value: 0.05, unit: 'fraction', source_quote: 'Keep churn under 5%.' },
    ]);
    expect(
      pick(framed, 'out_churn', '<=').value_frame,
      'the merge is not carrying value_frame at all — the absence below is vacuous',
    ).toBe('level');

    const rows = merge('We want to grow.', [
      { constraint_id: 'gc-lonely', node_id: 'goal_arr', operator: '>=', value: 1_000_000, unit: '£', source_quote: 'We want to grow.' },
    ]);
    expect(pick(rows, 'goal_arr', '>=').value_frame).toBeUndefined();
  });

  it("a model-SUPPLIED frame does not outrank the deterministic one on the same number", () => {
    // The draft LLM's `goal_constraints[]` is prompt-only and unenforced — a
    // frame appearing there is model prose, not an attestation. Where CEE holds
    // its own deterministic parse of the SAME number, that parse wins.
    const rows = merge(REDUCTION_BRIEF, [
      {
        constraint_id: 'gc-llm-claims-level',
        node_id: 'risk_cost',
        operator: '<=',
        value: -0.15,
        unit: 'fraction',
        value_frame: 'level',
        label: 'Marketing cost (model wording)',
        source_quote: 'Reduce marketing cost by 15%.',
      },
    ]);

    const row = pick(rows, 'risk_cost', '<=');
    expect(row.value).toBe(-0.15);
    expect(row.value_frame).toBe('delta');
  });
});
