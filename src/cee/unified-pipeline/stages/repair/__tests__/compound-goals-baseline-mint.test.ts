/**
 * ROADMAP 2.877 (link 2) — the DRAFT path twin of the chat baseline mint.
 *
 * When the BRIEF states a constraint target's current level ("Churn is
 * currently 12%. Keep churn under 5%."), the compound-goals repair stage mints
 * the V1 carrier (`node.data`) that `transformResponseToV3`'s factor-data
 * branch projects into `observed_state.{value, baseline}` on the wire — the
 * field ISL's level conversion reads (`missing_target_baseline` otherwise).
 *
 * THE MINT SITE IS THIS STAGE, NOT THE ENRICHER — a corrected premise from the
 * 2.877 brief, which listed `factor-extraction/enricher.ts` as the candidate
 * twin. Measured: the enricher writes no constraint rows (link 1's own
 * finding) and never sees the remapped constraint→node binding this mint is
 * gated on; `runCompoundGoals` is the single place that holds the brief, the
 * bound rows WITH their frames, and the graph nodes at once.
 *
 * THE DRAFT CELL: rows whose unit is 'fraction' with 0 ≤ value ≤ 1 — the
 * pre-divided percent convention `normaliseConstraintUnits` produces. A draft
 * '%'-unit row (value ≥ 1, i.e. ≥100%) is EXCLUDED: PLoT's unit_percent rung
 * normalises it as a raw percent (1.5 → 0.015) while the draft convention
 * means it as a fraction (150%) — a pre-existing cross-repo convention skew a
 * baseline must not convert into a confident wrong probability.
 *
 * The mint shape {value, baseline, unit: 'fraction', cap: 1} is the same
 * identity-scale declaration the chat path writes — see the doc block in
 * add-constraint-stated-baseline-mint.test.ts for the PLoT deriveRange
 * derivation (cap 1 forces the [0,1] identity range, so the row the mint
 * serves cannot be rescaled by its own baseline).
 */

import { describe, expect, it } from 'vitest';

import { runCompoundGoals } from '../compound-goals.js';

function makeCtx(brief: string, overrides?: Record<string, any>): any {
  return {
    requestId: 'test-2877-link2-draft',
    effectiveBrief: brief,
    graph: {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue growth' },
        { id: 'out_churn', kind: 'outcome', label: 'Churn rate' },
        { id: 'out_orphan', kind: 'outcome', label: 'Orphan rate' },
        { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', data: { value: 0.4 } },
        { id: 'opt_a', kind: 'option', label: 'Option A' },
      ],
      edges: [
        { from: 'fac_budget', to: 'goal_revenue' },
        { from: 'fac_budget', to: 'out_churn' },
        // fac_budget is NON-ROOT and fill-compatible, so the factor-exclusion
        // test is discriminating: only the kind gate refuses it.
        { from: 'opt_a', to: 'fac_budget' },
        // out_orphan has NO incoming edge — the ROOT control.
      ],
    },
    goalConstraints: undefined,
    ...overrides,
  };
}

function node(ctx: any, id: string) {
  return ctx.graph.nodes.find((n: any) => n.id === id);
}

describe('2.877 link 2 — draft path mints the brief-stated current level', () => {
  it('the exemplar brief mints on the bound target, by identity', () => {
    const ctx = makeCtx('Churn is currently 12%. Keep churn under 5%.');
    runCompoundGoals(ctx);

    // Producer-derived precondition (probed at pristine `129fa7b8`): this brief
    // yields exactly one row {out_churn, '<=', 0.05, 'fraction', level}. The
    // mint's own gate reads these fields, so pin them first — if the extractor
    // moves, this failure names the producer rather than the mint.
    const rows: any[] = ctx.goalConstraints ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].node_id).toBe('out_churn');
    expect(rows[0].value).toBe(0.05);
    expect(rows[0].unit).toBe('fraction');
    expect(rows[0].value_frame).toBe('level');

    // THE MINT — V1 carrier on the named node.
    const churn = node(ctx, 'out_churn');
    expect(churn.data).toBeDefined();
    expect(churn.data.baseline).toBe(0.12);
    expect(churn.data.value).toBe(0.12);
    expect(churn.data.unit).toBe('fraction');
    expect(churn.data.cap).toBe(1);
    expect(churn.data.extractionType).toBe('explicit');

    // Identity: no other node gained data/baseline.
    expect(node(ctx, 'out_orphan').data).toBeUndefined();
    expect(node(ctx, 'goal_revenue').data).toBeUndefined();
    expect(node(ctx, 'fac_budget').data.baseline).toBeUndefined();
  });

  it('the minted carrier survives the V3 transform into observed_state (the wire hop)', async () => {
    const ctx = makeCtx('Churn is currently 12%. Keep churn under 5%.');
    runCompoundGoals(ctx);

    const { transformResponseToV3 } = await import('../../../../transforms/schema-v3.js');
    // The V3 response is FLAT (nodes/edges at top level) — producer-verified by
    // direct execution at this tip, not assumed from the V1 shape.
    const v3 = transformResponseToV3({ graph: ctx.graph, rationales: [] } as any) as any;
    const churn = v3.nodes.find((n: any) => n.id === 'out_churn');
    expect(churn.observed_state).toBeDefined();
    expect(churn.observed_state.baseline).toBe(0.12);
    expect(churn.observed_state.value).toBe(0.12);
    expect(churn.observed_state.unit).toBe('fraction');
    expect(churn.observed_state.cap).toBe(1);
    // extractionType 'explicit' → source 'brief_extraction' (the transform's
    // own mapping — nothing user-owned is claimed).
    expect(churn.observed_state.source).toBe('brief_extraction');
  });

  it('NO stated level in the brief → no mint (the no-invention rule, paired control)', () => {
    const ctx = makeCtx('Keep churn under 5%.');
    runCompoundGoals(ctx);

    // Same row forms (probed) — only the mint is absent.
    const rows: any[] = ctx.goalConstraints ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].node_id).toBe('out_churn');
    expect(node(ctx, 'out_churn').data).toBeUndefined();
  });

  it('FACTOR target → no mint (PLoT mints a ParameterUncertainty; the baseline would be inert)', () => {
    const ctx = makeCtx('Marketing budget is 40% today. Keep marketing budget under 30%.');
    runCompoundGoals(ctx);

    const rows: any[] = ctx.goalConstraints ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].node_id).toBe('fac_budget');
    // The factor's pre-existing data is untouched, byte-for-byte.
    expect(node(ctx, 'fac_budget').data).toEqual({ value: 0.4 });
  });

  it('ROOT target → no mint (ISL refuses root conversion; a root value shifts the sample base)', () => {
    const ctx = makeCtx('Orphan rate is currently 12%. Keep orphan rate under 5%.');
    runCompoundGoals(ctx);

    const rows: any[] = ctx.goalConstraints ?? [];
    // Precondition: the row must actually bind to the root outcome, or the
    // absence below is about a dropped constraint rather than the root gate.
    expect(rows.some((r) => r.node_id === 'out_orphan')).toBe(true);
    expect(node(ctx, 'out_orphan').data).toBeUndefined();
  });

  it("a draft '%'-unit row (≥100% convention) never mints — direct helper probe", async () => {
    // The '%' cell is excluded because PLoT's unit_percent rung reads a draft
    // '%' value as a RAW percent (1.5 → 0.015) while the draft convention
    // means a fraction (150%) — a pre-existing cross-repo convention skew a
    // baseline must not convert into a confident wrong probability. The row is
    // synthetic because `remapConstraintTargets` needs a matching node for the
    // metric and the '%'-cell shape cannot be produced through the standard
    // fixture without one; the helper is exported for exactly this probe.
    const { mintStatedTargetBaselines } = await import('../compound-goals.js');
    const graph = {
      nodes: [{ id: 'out_churn', kind: 'outcome', label: 'Churn rate' }],
      edges: [{ from: 'x', to: 'out_churn' }],
    };
    const minted = mintStatedTargetBaselines(
      'Churn is 12% today. Keep churn under 150%.',
      [
        {
          constraint_id: 'c1',
          node_id: 'out_churn',
          operator: '<=',
          value: 1.5,
          unit: '%',
          value_frame: 'level',
        },
      ],
      graph,
    );
    expect(minted).toBe(0);
    expect((graph.nodes[0] as any).data).toBeUndefined();

    // A '%' row whose value sits in [0,1] isolates the UNIT gate from the
    // value gate (1.5 above is refused by both): standard draft flows relabel
    // sub-1 '%' to 'fraction' (normaliseConstraintUnits), so a surviving '%'
    // unit means an unrelabelled producer (e.g. an LLM row) whose scale
    // convention is unattested — refused, not guessed.
    const graph3 = {
      nodes: [{ id: 'out_churn', kind: 'outcome', label: 'Churn rate' }],
      edges: [{ from: 'x', to: 'out_churn' }],
    };
    const minted3 = mintStatedTargetBaselines(
      'Churn is 12% today. Keep churn under 150%.',
      [
        {
          constraint_id: 'c1',
          node_id: 'out_churn',
          operator: '<=',
          value: 0.5,
          unit: '%',
          value_frame: 'level',
        },
      ],
      graph3,
    );
    expect(minted3).toBe(0);
    expect((graph3.nodes[0] as any).data).toBeUndefined();

    // PRECONDITION PAIR (trap 13b): the identical call with the row in the
    // 'fraction' cell DOES mint — so the absence above is the unit gate's
    // doing, not a helper that stopped minting.
    const graph2 = {
      nodes: [{ id: 'out_churn', kind: 'outcome', label: 'Churn rate' }],
      edges: [{ from: 'x', to: 'out_churn' }],
    };
    const minted2 = mintStatedTargetBaselines(
      'Churn is 12% today. Keep churn under 150%.',
      [
        {
          constraint_id: 'c1',
          node_id: 'out_churn',
          operator: '<=',
          value: 0.1,
          unit: 'fraction',
          value_frame: 'level',
        },
      ],
      graph2,
    );
    expect(minted2).toBe(1);
    expect((graph2.nodes[0] as any).data.baseline).toBe(0.12);
  });

  it('B2: one generic statement binding TWO candidate targets mints on NEITHER', async () => {
    // Adversarial review of #868, B2 (reviewer fixture, demonstrated by
    // execution pre-fix): "The rate is 12%" satisfies subject ⊆ label for BOTH
    // 'Churn rate' and 'Win rate', and the pass minted 0.12 onto both nodes
    // from one statement about ONE unnamed metric — at most one of those
    // baselines can be true, and CEE cannot say which. Ambiguity refuses.
    const { mintStatedTargetBaselines } = await import('../compound-goals.js');
    const graph = {
      nodes: [
        { id: 'out_churn', kind: 'outcome', label: 'Churn rate' },
        { id: 'out_win', kind: 'outcome', label: 'Win rate' },
      ],
      edges: [
        { from: 'x', to: 'out_churn' },
        { from: 'x', to: 'out_win' },
      ],
    };
    const minted = mintStatedTargetBaselines(
      'The rate is 12% today. Keep churn under 10%. Keep win rate above 40%.',
      [
        {
          constraint_id: 'c1',
          node_id: 'out_churn',
          operator: '<=',
          value: 0.1,
          unit: 'fraction',
          value_frame: 'level',
        },
        {
          constraint_id: 'c2',
          node_id: 'out_win',
          operator: '>=',
          value: 0.4,
          unit: 'fraction',
          value_frame: 'level',
        },
      ],
      graph,
    );
    expect(minted).toBe(0);
    expect((graph.nodes[0] as any).data).toBeUndefined();
    expect((graph.nodes[1] as any).data).toBeUndefined();

    // PRECONDITION PAIR (trap 13b): a SPECIFIC subject in the same two-node
    // pass still mints, on the one node it names — the refusal above is the
    // ambiguity's doing, not a helper that stopped minting.
    const graph2 = {
      nodes: [
        { id: 'out_churn', kind: 'outcome', label: 'Churn rate' },
        { id: 'out_win', kind: 'outcome', label: 'Win rate' },
      ],
      edges: [
        { from: 'x', to: 'out_churn' },
        { from: 'x', to: 'out_win' },
      ],
    };
    const minted2 = mintStatedTargetBaselines(
      'Churn is 12% today. Keep churn under 10%. Keep win rate above 40%.',
      [
        {
          constraint_id: 'c1',
          node_id: 'out_churn',
          operator: '<=',
          value: 0.1,
          unit: 'fraction',
          value_frame: 'level',
        },
        {
          constraint_id: 'c2',
          node_id: 'out_win',
          operator: '>=',
          value: 0.4,
          unit: 'fraction',
          value_frame: 'level',
        },
      ],
      graph2,
    );
    expect(minted2).toBe(1);
    expect((graph2.nodes[0] as any).data.baseline).toBe(0.12);
    expect((graph2.nodes[1] as any).data).toBeUndefined();
  });

  it('an existing data.baseline is never overwritten (fill-only)', () => {
    const ctx = makeCtx('Churn is currently 12%. Keep churn under 5%.');
    node(ctx, 'out_churn').data = { value: 0.3, baseline: 0.3, unit: 'fraction', cap: 1 };
    runCompoundGoals(ctx);

    expect(node(ctx, 'out_churn').data.baseline).toBe(0.3);
    expect(node(ctx, 'out_churn').data.value).toBe(0.3);
  });
});
