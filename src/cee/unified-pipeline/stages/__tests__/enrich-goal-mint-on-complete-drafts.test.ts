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
import { runStageThresholdSweep } from '../threshold-sweep.js';
import { extractFactors } from '../../../factor-extraction/index.js';
import { CEE_MINTED_GOAL_FIELDS } from '../../../../adapters/llm/normalisation.js';
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

  it('SURVIVES THE V3 TRANSFORM — the quad is not stripped by NodeV3.parse', async () => {
    // ⚠ RENAMED (adversarial review). This was called "REACHES THE WIRE", which
    // claimed more than it proves. It proves exactly one hop: that the V3
    // transform and `NodeV3.parse` do not strip the quad. It does NOT prove the
    // quad reaches PLoT or ISL, because at least two later stages can remove it:
    //   * Stage 4b (threshold-sweep) — covered by the STAGE 4b tests below;
    //   * Stage 4 repair, which can replace the graph wholesale with an LLM's
    //     or PLoT's own output while preserving only `category` + 6 edge fields
    //     (rowed separately — not addressed in this PR).
    // A test named for a destination it never visits is how a gap hides in a
    // green suite.
    //
    // `NodeV3` is a strip-mode schema, so an undeclared field is silently
    // dropped at any re-parse; this parse is what proves the transform hop.
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

  it('COLLISION PATH PARITY — both paths mint the user’s Target through the collision (2.299)', async () => {
    // ⚠ THIS TEST REPLACES A WITHDRAWN CLAIM. An earlier version of this file
    // argued that a mutant swapping the skip path's `qualifyExtractedFactors`
    // for the RAW extraction was an EQUIVALENT mutant, on the reasoning that
    // the goal-target factor is always pushed first at confidence 0.95 and so
    // qualification could never change the selection.
    //
    // THAT DERIVATION WAS FALSE, and adversarial review broke it with the brief
    // below. Two things were wrong with it:
    //
    //   1. `extractFactors` has MORE THAN ONE producer of a target-labelled
    //      factor. The 0.95 one (`extractGoalTargetWithBaseline`) only fires
    //      when the brief states a target AND a current level. When it does
    //      not fire, `contextualNumber` can still emit a "Target" at
    //      confidence 0.90 — from a LATER position in the push order.
    //   2. Confidence was never the deciding factor. ORDER was. `genericRange`
    //      pushes at confidence 0.80 but pushes EARLIER, and dedupe kept the
    //      earlier factor and discarded the later one regardless of
    //      confidence.
    //
    // In this brief the range midpoint (5.5M + 6.5M) / 2 = 6,000,000 collides
    // exactly with the user's stated target of 6,000,000, both carry no unit —
    // so on the pre-2.299 tip dedupe dropped the user's Target and the goal
    // target was never minted on EITHER path. This test then pinned the
    // both-paths-no-mint as CURRENT-not-desirable, with the instruction to
    // flip the expectation when the dedupe repair landed.
    //
    // ROADMAP 2.299 LANDED — flipped per that instruction: dedupe now prefers
    // role/confidence at equal value, the user's Target survives the
    // collision, and BOTH call sites mint the identical contract. The parity
    // half is unchanged and still bites the raw-extraction mutant (under it
    // the two paths would select different factors and diverge).
    const COLLISION_BRIEF =
      'Output ranges between 5500000 and 6500000 most years; our target is 6000000.';

    // Positive control on the PREMISE: the raw extraction still pushes the
    // colliding generic factor FIRST, so the survival below is the preference
    // logic working, not the collision having quietly disappeared.
    const raw = extractFactors(COLLISION_BRIEF);
    expect(raw.some((f) => /target/i.test(f.label)), 'premise broken: no Target in raw extraction').toBe(true);
    expect(raw[0].label, 'premise broken: the colliding factor no longer pushes first').not.toMatch(/target/i);

    const skipped = await runEnrich(draftShapedGraph(), COLLISION_BRIEF);

    const g = draftShapedGraph();
    ((g.nodes as any[]).find((n) => n.id === 'o2') as any).data = { interventions: {} };
    const notSkipped = await runEnrich(g, COLLISION_BRIEF);

    // Positive control: the two runs really did take different code paths —
    // and the skip path, having minted, must say so (2.281 trace honesty).
    expect(skipped.ctx.enrichmentTrace.extraction_mode).toBe('v4_factor_skip_goal_minted');
    expect(notSkipped.ctx.enrichmentTrace.extraction_mode).toBe('regex-only');

    // THE PARITY ASSERTION — the one that bites the raw-extraction mutant.
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

    // THE MINT — the user's stated target, at the shared cap doctrine:
    // 6,000,000 → cap 7,500,000 → threshold 0.8, frame 'level'. A range
    // statement is not a stated current level, so no baseline is invented.
    expect(skipped.goal.goal_threshold).toBe(0.8);
    expect(skipped.goal.goal_threshold_raw).toBe(6_000_000);
    expect(skipped.goal.goal_threshold_cap).toBe(7_500_000);
    expect(skipped.goal.goal_threshold_frame).toBe('level');
    expect(skipped.goal.goal_baseline).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 4b — the mint must SURVIVE the sweep that runs after it
  //
  // Found by external review of this PR, confirmed at the bytes. Stage 4b runs
  // UNGATED on every draft (pipeline index.ts :745 enrich → :792 repair →
  // :951 sweep). Its "possibly model-inferred" heuristic strips when the raw
  // target is round AND the goal label contains no digit — and
  // `Number.isInteger(6_000_000)` is true, so the ONLY thing standing between a
  // user's stated target and deletion was whether the MODEL happened to put a
  // digit in the label it wrote.
  //
  // The three re-witness runs all had digits in the goal label
  // ("Grow Annual Revenue to £6,000,000"), which is why the live walk never
  // showed this. It is not a corner case: "Grow annual revenue" is an entirely
  // ordinary label.
  // ═══════════════════════════════════════════════════════════════════════

  it('STAGE 4b — a DIGIT-FREE goal label no longer deletes the user’s stated target', async () => {
    const g = draftShapedGraph();
    (g.nodes as any[])[0].label = 'Grow annual revenue'; // no digits, deliberately

    const ctx = makeCtx(g, WORKED_EXAMPLE_BRIEF);
    await runStageEnrich(ctx);
    await runStageThresholdSweep(ctx);

    const goal = (ctx.graph as any).nodes.find((n: any) => n.kind === 'goal');

    // Premise control: the label really is digit-free, so the heuristic's
    // trigger condition genuinely held and the keep is what spared it.
    expect(/\d/.test(goal.label)).toBe(false);

    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_baseline).toBe(0.5333333333333333);
    expect(goal.goal_baseline_raw).toBe(4_000_000);

    const codes = (ctx.deterministicRepairs ?? []).map((r: any) => r.code);
    expect(codes).not.toContain('GOAL_THRESHOLD_STRIPPED_NO_DIGITS');
    expect(codes).not.toContain('GOAL_THRESHOLD_POSSIBLY_INFERRED');
  });

  it('STAGE 4b — an UNATTESTED threshold is still swept, and leaves NO orphaned baseline', async () => {
    // The other half, and the one that keeps the keep honest. A threshold this
    // run did not mint is still judged by the heuristic exactly as before — the
    // fabrication guard is narrowed to its real target, not disabled.
    //
    // It also pins the atomicity repair: `goal_baseline`/`goal_baseline_raw`
    // were added to the node contract BESIDE the deletion group instead of
    // INTO it, so a strip used to remove the threshold and leave the baseline —
    // an `observed_state` describing a number that no longer existed.
    const g = draftShapedGraph();
    const goalNode = (g.nodes as any[])[0];
    goalNode.label = 'Grow annual revenue';
    // Pre-set, as if it arrived from somewhere this run cannot vouch for.
    goalNode.goal_threshold = 0.8;
    goalNode.goal_threshold_raw = 6_000_000;
    goalNode.goal_threshold_unit = 'count';
    goalNode.goal_threshold_cap = 7_500_000;
    goalNode.goal_threshold_frame = 'level';
    goalNode.goal_baseline = 0.5333333333333333;
    goalNode.goal_baseline_raw = 4_000_000;

    const ctx = makeCtx(g, 'Should I hire a personal assistant?'); // brief mints nothing
    await runStageEnrich(ctx);
    await runStageThresholdSweep(ctx);

    const goal = (ctx.graph as any).nodes.find((n: any) => n.kind === 'goal');

    // Positive control: this run attested nothing, so the heuristic was live.
    expect(ctx.enricherMintedGoalIds?.size ?? 0).toBe(0);
    expect((ctx.deterministicRepairs ?? []).map((r: any) => r.code))
      .toContain('GOAL_THRESHOLD_STRIPPED_NO_DIGITS');

    // THE ATOMICITY ASSERTION — the whole contract goes, or none of it does.
    for (const f of [
      'goal_threshold',
      'goal_threshold_raw',
      'goal_threshold_unit',
      'goal_threshold_cap',
      'goal_threshold_frame',
      'goal_baseline',
      'goal_baseline_raw',
    ]) {
      expect(goal[f], `${f} survived a strip — orphaned goal contract`).toBeUndefined();
    }
  });

  it('STAGE 4b — the attestation survives a GOAL MERGE renaming the minted node', async () => {
    // Stage 4 (Repair) runs BETWEEN the mint and the sweep and can merge goals,
    // recording `mergedGoalId → primaryGoalId` in ctx.nodeRenames. A bare id
    // match would silently lose the attestation exactly then — and the failure
    // would be invisible, because the sweep would simply go back to deleting
    // the user's target with no error anywhere.
    //
    // Added because the rename-resolution branch was written on reasoning alone
    // and a mutant deleting it SURVIVED the rest of this file. Defensive code
    // nothing exercises is indistinguishable from defensive code that does not
    // work.
    const g = draftShapedGraph();
    const goalNode = (g.nodes as any[])[0];
    goalNode.id = 'goal_primary';
    goalNode.label = 'Grow annual revenue'; // digit-free ⇒ heuristic would strip
    goalNode.goal_threshold = 0.8;
    goalNode.goal_threshold_raw = 6_000_000;
    goalNode.goal_threshold_unit = 'count';
    goalNode.goal_threshold_cap = 7_500_000;
    goalNode.goal_threshold_frame = 'level';

    const ctx = makeCtx(g, 'Should I hire a personal assistant?');
    // The mint happened on a goal that Stage 4 then merged AWAY into the primary.
    ctx.enricherMintedGoalIds = new Set(['goal_merged_away']);
    ctx.nodeRenames = new Map([['goal_merged_away', 'goal_primary']]);

    await runStageThresholdSweep(ctx);

    const goal = (ctx.graph as any).nodes.find((n: any) => n.kind === 'goal');
    expect(goal.goal_threshold, 'the merged-away mint lost its attestation').toBe(0.8);
    expect((ctx.deterministicRepairs ?? []).map((r: any) => r.code))
      .not.toContain('GOAL_THRESHOLD_STRIPPED_NO_DIGITS');
  });

  it('STAGE 4b — the deletion group covers EVERY CEE-minted goal field (derived, not mirrored)', () => {
    // The group is no longer hand-maintained here: the sweep now deletes
    // exactly `CEE_MINTED_GOAL_FIELDS`, the same constant #789's ingress strip
    // uses, which already carries a derived set-equality test against every
    // `goal_*` field `schemas/graph.ts` declares.
    //
    // This assertion is the join: it pins that the sweep really does use that
    // constant, so a future `goal_*` field joins the atomic deletion group
    // automatically instead of being added beside it — which is precisely how
    // `goal_baseline*` came to be orphaned in the first place.
    expect([...CEE_MINTED_GOAL_FIELDS].sort()).toEqual([
      'goal_baseline',
      'goal_baseline_raw',
      'goal_threshold',
      'goal_threshold_cap',
      'goal_threshold_frame',
      'goal_threshold_raw',
      'goal_threshold_unit',
    ]);
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

// ═══════════════════════════════════════════════════════════════════════════
// ROADMAP 2.294 — the goal limb must not be SHADOWED by model-authored `data`
//
// Proven live by the THIRD 2.258 witness (witness-2258-goal-probability-THIRD.md
// §3.2, quartet CEE 33c10e52): on a real draft the model gave the GOAL node
// `data.value = 0.667` (≈ 4M/6M, model-authored), so `transformNodeToV3`'s
// FIRST branch — `isFactorData(node.data) && node.data.value !== undefined` —
// won, emitted `observed_state = {value: 0.667}` with NO baseline key, and the
// enricher-minted `goal_baseline = 0.5333…` died at the projection. The 2.273
// goal limb — the ONLY place `goal_baseline` becomes `observed_state.baseline`
// and reaches the wire — sat unreachable behind it as an `else if`, its comment
// still claiming "`data`, which a goal node never carries". ISL then refused
// with `missing_goal_baseline` phrasing; every upstream link (mint, quintet,
// Stage-4b keep, store) had already been proven working.
//
// The tests in this file above never caught it because `draftShapedGraph()`'s
// goal carries no `data` — the shape production actually produces is precisely
// the shape the suite never fed the transform. The shape IS the assertion,
// again.
//
// The fix branches on NODE KIND FIRST: a goal node carrying `goal_baseline`
// takes the goal limb regardless of model-authored `data`. Per #787's
// value-required design the limb writes `value = baseline = goal_baseline`.
// ═══════════════════════════════════════════════════════════════════════════

describe('ROADMAP 2.294 — model-authored data on a goal node must not shadow the goal limb', () => {
  /**
   * The EXACT witnessed shape — third witness Run 1, `draft_graph.nodes[5]`
   * (goal `goal_revenue`) at CEE `33c10e52`: full threshold quintet + the
   * minted baseline pair + the model-authored `data` that made the data
   * branch win on the live wire.
   */
  function witnessedGoalNode(): V1Node {
    return {
      id: 'goal_revenue',
      kind: 'goal',
      label: 'Grow Annual Revenue to £6 Million',
      goal_threshold: 0.8,
      goal_threshold_raw: 6_000_000,
      goal_threshold_unit: 'count',
      goal_threshold_cap: 7_500_000,
      goal_threshold_frame: 'level',
      goal_baseline: 0.5333333333333333,
      goal_baseline_raw: 4_000_000,
      data: { value: 0.667, factor_type: 'revenue', extractionType: 'explicit' },
    };
  }

  it('THE WITNESSED SHAPE — a baseline-bearing goal WITH model-authored data takes the goal limb', () => {
    // Pristine signature (the live defect): observed_state = {value: 0.667,
    // source, extractionType, factor_type} with NO baseline key — the data
    // branch won. Post-fix: the goal limb's designed shape, value = baseline =
    // goal_baseline (#787: ISL requires `value`; nothing is invented to fill it).
    const parsed = NodeV3.parse(transformNodeToV3(witnessedGoalNode()));

    expect(parsed.observed_state).toEqual({
      value: 0.5333333333333333,
      baseline: 0.5333333333333333,
      unit: 'count',
      source: 'brief_extraction',
      raw_value: 4_000_000,
      cap: 7_500_000,
    });
    // Named separately so a mutant that keeps the limb but drops only the
    // baseline key cannot hide inside a single object-equality diff:
    expect(parsed.observed_state?.baseline).toBe(0.5333333333333333);
    expect(parsed.observed_state?.value).toBe(0.5333333333333333);
  });

  it('END-TO-END — real enrich stage on the witnessed draft shape, then the real transform', async () => {
    // The composition the live wire actually runs: the enricher mints the
    // baseline pair onto a goal that ALREADY carries model-authored data
    // (exactly Run 1's draft), then the V3 transform projects it. On pristine
    // 33c10e52 the projection emits {value: 0.667, no baseline} and the mint
    // dies here — this is the last broken link in the goal-probability train.
    const g = draftShapedGraph();
    const goalNode = (g.nodes as any[])[0];
    goalNode.data = { value: 0.667, factor_type: 'revenue', extractionType: 'explicit' };

    const ctx = makeCtx(g, WORKED_EXAMPLE_BRIEF);
    await runStageEnrich(ctx);
    await runStageThresholdSweep(ctx);
    const goal = (ctx.graph as any).nodes.find((n: any) => n.kind === 'goal');

    // POSITIVE CONTROLS on the shadowing premise — the goal genuinely carries
    // BOTH the model-authored data AND the minted baseline after enrich+sweep.
    // If a future stage strips goal data upstream (the rowed 2.286 attestation
    // object), these controls fail and say the test has gone vacuous, rather
    // than letting it pass by no longer testing the collision at all.
    expect(goal.data?.value).toBe(0.667);
    expect(goal.goal_baseline).toBe(0.5333333333333333);

    const parsed = NodeV3.parse(transformNodeToV3(goal as unknown as V1Node));
    expect(parsed.observed_state?.value).toBe(0.5333333333333333);
    expect(parsed.observed_state?.baseline).toBe(0.5333333333333333);
  });

  it('ZERO BASELINE — goal_baseline: 0 is a real level and must still take the goal limb', () => {
    // #792 fast-follow (reviewer should-fix): a truthiness mutant on the limb's
    // guard — `&& node.goal_baseline` instead of `&& node.goal_baseline != null`
    // — SURVIVED all 18 tests in this file, because every fixture used a
    // nonzero baseline. And 0 is REACHABLE, not hypothetical: a stated current
    // level of 0 mints goal_baseline = 0 ÷ cap = 0 (the enricher guards
    // `!== undefined`, enricher.ts:689), and ISL's refusal check is `is None`,
    // so a 0 survives every downstream hop and converts fine. Under the mutant
    // the witnessed-shape variant below silently falls back to the data branch
    // and the baseline dies at the projection again — the exact 2.294 defect,
    // resurrected for the one honest value JavaScript calls false.
    const node = witnessedGoalNode();
    node.goal_baseline = 0;
    node.goal_baseline_raw = 0;

    const parsed = NodeV3.parse(transformNodeToV3(node));

    expect(parsed.observed_state).toEqual({
      value: 0,
      baseline: 0,
      unit: 'count',
      source: 'brief_extraction',
      raw_value: 0,
      cap: 7_500_000,
    });
  });

  it('PRESERVED (a) — a NON-GOAL factor node with identical data is byte-unchanged', () => {
    // The generic factor-data path must not move. Same data payload as the
    // witnessed goal, on a factor node: the data branch still owns it.
    const factor: V1Node = {
      id: 'f_revenue',
      kind: 'factor',
      label: 'Annual Revenue',
      category: 'observable',
      data: {
        value: 0.667,
        baseline: 0.5,
        unit: 'count',
        raw_value: 4_000_000,
        cap: 6_000_000,
        factor_type: 'revenue',
        extractionType: 'explicit',
        uncertainty_drivers: ['market volatility'],
      },
    };

    const parsed = NodeV3.parse(transformNodeToV3(factor));

    expect(parsed.observed_state).toEqual({
      value: 0.667,
      baseline: 0.5,
      unit: 'count',
      source: 'brief_extraction',
      raw_value: 4_000_000,
      cap: 6_000_000,
      factor_type: 'revenue',
      extractionType: 'explicit',
      uncertainty_drivers: ['market volatility'],
    });
  });

  it('PRESERVED (b) — a goal WITHOUT goal_baseline but WITH factor-shaped data keeps the data branch', () => {
    // No baseline was minted, so the goal limb has nothing to deliver and the
    // node keeps today's behaviour — the data branch, no new refusal invented.
    const node = witnessedGoalNode();
    delete node.goal_baseline;
    delete node.goal_baseline_raw;

    const parsed = NodeV3.parse(transformNodeToV3(node));

    expect(parsed.observed_state).toEqual({
      value: 0.667,
      source: 'brief_extraction',
      extractionType: 'explicit',
      factor_type: 'revenue',
    });
    expect(parsed.observed_state?.baseline).toBeUndefined();
  });

  it('PRESERVED (c) — a goal with goal_baseline and NO data still takes the goal limb', () => {
    // Today's only-working case (the shape the SURVIVES-THE-V3-TRANSFORM test
    // above feeds) must stay working, asserted here at the full designed shape.
    const node = witnessedGoalNode();
    delete node.data;

    const parsed = NodeV3.parse(transformNodeToV3(node));

    expect(parsed.observed_state).toEqual({
      value: 0.5333333333333333,
      baseline: 0.5333333333333333,
      unit: 'count',
      source: 'brief_extraction',
      raw_value: 4_000_000,
      cap: 7_500_000,
    });
  });
});
