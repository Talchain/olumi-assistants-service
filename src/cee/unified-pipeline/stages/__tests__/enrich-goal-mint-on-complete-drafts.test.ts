/**
 * ROADMAP 2.281 (REOPENED) — the goal mint must be reachable on a WELL-FORMED
 * draft.
 *
 * WHAT SHIPPED BROKEN, and why every existing test was green.
 * ---------------------------------------------------------------------------
 * `enrichGraphWithFactorsAsync` opens with an early exit: when every option
 * node carries interventions that all resolve to factors with numeric values,
 * it logs `cee.factor_enrichment.v4_complete_skip` and returns the graph
 * UNENRICHED. That is a sound thing to do for FACTORS — the model already
 * supplied them. It was never sound for the GOAL TARGET, which is a number the
 * USER stated and which no amount of model-supplied intervention data can
 * substitute for.
 *
 * Because a well-formed draft is exactly a draft where the model filled in the
 * interventions, the early exit fired on essentially every real request, and
 * the goal-threshold mint further down the same function was UNREACHABLE IN
 * PRODUCTION.
 *
 * MEASURED, not inferred (witness-2258-goal-probability-REWITNESS.md, CEE
 * staging `2e54a20`): across three scenario classes — currency+baseline,
 * currency without baseline, and percentage+baseline — the wire carried
 * `goal_threshold` ×0, `goal_threshold_frame` ×0, and no goal `observed_state`.
 * ISL emitted not one of its nine goal-refusal reasons and not one of its goal
 * warning codes: **ISL did not refuse, ISL was never asked.** The user stated a
 * target in all three runs; the Model tab rendered `Target: Not set` directly
 * beneath a goal title containing that very number.
 *
 * WHY #786/#787's TESTS DID NOT CATCH IT — and why this file lives HERE.
 * ---------------------------------------------------------------------------
 * Those families call `enrichGraphWithFactorsAsync` directly with hand-built
 * graphs that have NO option nodes at all (`freshGraph()` in
 * `goal-baseline-extraction.test.ts` is a goal + a decision). With no options,
 * `optionNodes.length > 0` is false, the early exit cannot fire, and the mint
 * is reached every time. The tests proved the ARITHMETIC and never touched the
 * REACHABILITY.
 *
 * So this file deliberately does two things they did not:
 *   1. it drives `runStageEnrich` — the REAL pipeline stage, and the ONLY call
 *      site of `enrichGraphWithFactorsAsync` — rather than the enricher alone;
 *   2. its fixture is DRAFT-SHAPED: every option carries valued interventions,
 *      i.e. precisely the shape that trips the skip.
 *
 * A test that feeds the enricher an input production never produces is a test
 * that can only prove the code does what it does. The shape IS the assertion.
 */
import { describe, expect, it } from 'vitest';

import { runStageEnrich } from '../enrich.js';
import { extractFactors } from '../../../factor-extraction/index.js';
import { transformNodeToV3 } from '../../../transforms/schema-v3.js';
import { NodeV3 } from '../../../../schemas/cee-v3.js';
import type { V1Node } from '../../../transforms/schema-v2.js';

/** The brief from the re-witness's Run 1, byte-identical. */
const WORKED_EXAMPLE_BRIEF = 'Grow revenue from 4000000 to a target of 6000000 this year.';

/**
 * A draft-shaped graph: every option carries interventions, and every
 * intervention target is a factor with a numeric `data.value`. This is the
 * exact predicate `allOptionsHaveInterventions` tests, so this fixture TRIPS
 * THE SKIP. If a future edit makes the skip stop firing on this shape, the
 * `factor-side` assertions below go red and say so.
 */
function draftShapedGraph(): Record<string, unknown> {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow Annual Revenue to £6,000,000' },
      { id: 'd1', kind: 'decision', label: 'How to grow revenue' },
      {
        id: 'f_price',
        kind: 'factor',
        label: 'Average Selling Price',
        category: 'controllable',
        data: { value: 0.5, unit: 'count' },
      },
      {
        id: 'f_demand',
        kind: 'factor',
        label: 'Market Demand Conditions',
        category: 'external',
        data: { value: 0.5, unit: 'count' },
      },
      {
        id: 'o1',
        kind: 'option',
        label: 'Raise prices',
        data: { interventions: { f_price: 0.7, f_demand: 0.5 } },
      },
      {
        id: 'o2',
        kind: 'option',
        label: 'Expand the sales team',
        data: { interventions: { f_price: 0.5, f_demand: 0.6 } },
      },
    ],
    edges: [
      { from: 'd1', to: 'o1' },
      { from: 'd1', to: 'o2' },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
  };
}

/** Minimal StageContext — only the fields Stage 3 (Enrich) reads. */
function makeCtx(graph: unknown, brief: string): any {
  return {
    input: {},
    rawBody: {},
    request: {},
    requestId: 'test-2281',
    opts: { schemaVersion: 'v1' as const },
    start: Date.now(),
    graph,
    effectiveBrief: brief,
    rationales: [],
    draftCost: 0,
    draftAdapter: undefined,
    llmMeta: undefined,
    confidence: undefined,
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 0,
    draftDurationMs: 0,
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: undefined,
    hadCycles: false,
    nodeRenames: new Map<string, string>(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    repairCost: 0,
    repairFallbackReason: undefined,
    structuralMeta: undefined,
    validationSummary: undefined,
  };
}

async function runEnrich(graph: unknown, brief: string) {
  const ctx = makeCtx(graph, brief);
  await runStageEnrich(ctx);
  const goal = (ctx.graph as any).nodes.find((n: any) => n.kind === 'goal');
  return { ctx, goal };
}

describe('ROADMAP 2.281 — a complete-interventions draft still mints the goal target', () => {
  it('THE RE-WITNESS SCENARIO — worked-example brief on a draft-shaped graph yields 0.8 / level / 0.5333…', async () => {
    // This is the assertion that was FALSE on staging `2e54a20`. Every number
    // below is hand-derived, not captured:
    //
    //   extraction   target = 6_000_000            baseline = 4_000_000
    //   cap doctrine no '%', no existing cap → 25% headroom
    //                cap = 6_000_000 * 1.25      = 7_500_000
    //   threshold    6_000_000 / 7_500_000       = 0.8
    //   baseline     4_000_000 / 7_500_000       = 0.5333333333333333
    //   ISL          delta = 0.8 - 0.53333…      = 4/15
    const { goal } = await runEnrich(draftShapedGraph(), WORKED_EXAMPLE_BRIEF);

    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_threshold_raw).toBe(6_000_000);
    expect(goal.goal_threshold_cap).toBe(7_500_000);
    expect(goal.goal_baseline).toBe(0.5333333333333333);
    expect(goal.goal_baseline_raw).toBe(4_000_000);
  });

  it('REACHES THE WIRE — the quad survives the V3 transform and NodeV3.parse', async () => {
    // Presence on the V1 node is not proof it reaches ISL: `NodeV3` is a
    // strip-mode schema, so an undeclared field is silently dropped at any
    // re-parse between here and PLoT. This parse is the proof.
    const { goal } = await runEnrich(draftShapedGraph(), WORKED_EXAMPLE_BRIEF);

    const parsed = NodeV3.parse(transformNodeToV3(goal as unknown as V1Node));

    expect(parsed.goal_threshold).toBe(0.8);
    expect(parsed.goal_threshold_frame).toBe('level');
    // ISL's converter reads `observed_state.baseline` (NOT `.value`).
    expect(parsed.observed_state?.baseline).toBe(0.5333333333333333);
  });

  it('ABSENCE CONTROL — a target with NO stated level mints threshold + frame and NO baseline', async () => {
    // The honest-absence case. A baseline must never be inferred, defaulted, or
    // derived from the target; ISL then refuses with `missing_goal_baseline`,
    // which is the correct outcome, not a bug.
    //
    // This control is what stops the test above passing in a world where the
    // mint stamps a baseline unconditionally.
    const { goal } = await runEnrich(draftShapedGraph(), 'Our target is 800 customers.');

    expect(goal.goal_threshold).toBeDefined();
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_baseline).toBeUndefined();
    expect(goal.goal_baseline_raw).toBeUndefined();

    const parsed = NodeV3.parse(transformNodeToV3(goal as unknown as V1Node));
    expect(parsed.observed_state).toBeUndefined();
  });

  it('ABSENCE CONTROL — a brief stating NO target mints nothing at all', async () => {
    // Proves the mint is not firing on everything that reaches it. Without
    // this, "the threshold is present" could pass by stamping a number on any
    // draft, which is the fabrication failure the whole goal train exists to
    // avoid.
    const { ctx, goal } = await runEnrich(
      draftShapedGraph(),
      'Should I hire a personal assistant to improve productivity?',
    );

    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_frame).toBeUndefined();
    // Nothing was written, so the mode may honestly claim a COMPLETE skip.
    expect(ctx.enrichmentTrace.extraction_mode).toBe('v4_complete_skip');
  });

  it('FACTOR-SIDE PRESERVED — the skip still suppresses factor injection', async () => {
    // The repair splits the early exit; it does not remove it. If a future edit
    // "fixes" the goal mint by deleting the skip outright, synthetic factor
    // nodes reappear on complete drafts and this goes red.
    const { ctx } = await runEnrich(draftShapedGraph(), WORKED_EXAMPLE_BRIEF);

    expect(ctx.enrichmentResult.factorsAdded).toBe(0);
    expect(ctx.enrichmentResult.factorsEnhanced).toBe(0);

    const factorIds = (ctx.graph as any).nodes
      .filter((n: any) => n.kind === 'factor')
      .map((n: any) => n.id)
      .sort();
    expect(factorIds).toEqual(['f_demand', 'f_price']);
  });

  it('TRACE HONESTY — a run that minted must NOT report itself as a complete skip', async () => {
    // The defect had a second face: the trace said `v4_complete_skip`, which was
    // true about factors and silent about the goal. A mode label that is honest
    // only about the half you happen to be looking at is how this shipped green.
    const { ctx } = await runEnrich(draftShapedGraph(), WORKED_EXAMPLE_BRIEF);

    expect(ctx.enrichmentTrace.extraction_mode).toBe('v4_factor_skip_goal_minted');
    expect(ctx.enrichmentTrace.extraction_mode).not.toBe('v4_complete_skip');
  });

  it('PATH PARITY — the skip path and the non-skip path mint an IDENTICAL quad', async () => {
    // Two call sites, one mint implementation. This is the assertion that keeps
    // them from becoming twins that agree today and drift tomorrow — the
    // `generateGraphHash` defect class. If someone re-implements the redirect
    // on either side, the quads diverge and this goes red.
    const skipped = await runEnrich(draftShapedGraph(), WORKED_EXAMPLE_BRIEF);

    // Same graph with ONE option's interventions emptied → the skip cannot fire,
    // so the goal target is minted by the in-loop call site instead.
    const g = draftShapedGraph();
    ((g.nodes as any[]).find((n) => n.id === 'o2') as any).data = { interventions: {} };
    const notSkipped = await runEnrich(g, WORKED_EXAMPLE_BRIEF);

    // Positive control: the two runs really did take different paths.
    expect(skipped.ctx.enrichmentTrace.extraction_mode).toBe('v4_factor_skip_goal_minted');
    expect(notSkipped.ctx.enrichmentTrace.extraction_mode).toBe('regex-only');

    const quad = (n: any) => ({
      goal_threshold: n.goal_threshold,
      goal_threshold_raw: n.goal_threshold_raw,
      goal_threshold_unit: n.goal_threshold_unit,
      goal_threshold_cap: n.goal_threshold_cap,
      goal_threshold_frame: n.goal_threshold_frame,
      goal_baseline: n.goal_baseline,
      goal_baseline_raw: n.goal_baseline_raw,
    });
    expect(quad(skipped.goal)).toEqual(quad(notSkipped.goal));
  });

  it('SELECTION INVARIANT — the goal-target factor is emitted FIRST and above minConfidence', () => {
    // WHY THIS PIN EXISTS, stated honestly.
    //
    // The two call sites select their target factor from the SAME qualified
    // list (`qualifyExtractedFactors`). A mutant that makes the skip path read
    // the RAW extraction instead SURVIVES the whole suite above — and it
    // survives because it is currently an EQUIVALENT mutant, not because the
    // tests are weak:
    //
    //   * `extractFactors` pushes the goal-target factor FIRST among the
    //     explicit extractors, deliberately (index.ts, "runs FIRST …
    //     deliberately"), so dedupe cannot drop it — dedupe only discards a
    //     factor that duplicates an EARLIER-KEPT one, and nothing is earlier.
    //   * its confidence is the code constant 0.95, comfortably above the 0.6
    //     default `minConfidence` (which the pipeline stage never overrides).
    //
    // Under those two properties, qualification provably cannot change WHICH
    // factor `isTargetGoalLabel` selects. That equivalence is what this test
    // pins — so if either property drifts, this goes red and the survivorship
    // argument above stops being true silently.
    //
    // SCOPE, precisely: this pins the equivalence for briefs where the
    // goal-pair extractor fires. It does NOT prove the two selections agree for
    // every possible brief, and no claim of universal equivalence is made here.
    const extracted = extractFactors(WORKED_EXAMPLE_BRIEF);

    expect(extracted.length).toBeGreaterThan(0);
    expect(extracted[0].label).toBe('Target');
    expect(extracted[0].confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('PERCENTAGE VARIANT — the re-witness Run 3 shape also mints on a complete draft', async () => {
    //   extraction  target 0.95 / baseline 0.85 (fractions)
    //   enricher    reconstructs raw percent 95 / 85; '%' → cap 100
    //   threshold   0.95            baseline 0.85         ISL delta 0.10
    const { goal } = await runEnrich(
      draftShapedGraph(),
      'Improve retention from 85% to a target of 95%.',
    );

    expect(goal.goal_threshold).toBe(0.95);
    expect(goal.goal_threshold_cap).toBe(100);
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_baseline).toBe(0.85);
  });
});
