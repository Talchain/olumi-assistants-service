/**
 * ⭐⭐⭐ THE FACTOR THE USER SEES IS AT THE LEVEL THE USER SAID IT IS AT.
 *
 * ── THE MEASURED DEFECT ────────────────────────────────────────────────────
 * Paul's brief says *"increase the Pro plan price FROM £49 TO £59"*. Driving
 * `enrichGraphWithFactorsAsync` on staging `c6c16885` emits, by execution:
 *
 *   { value: 0.59, raw_value: 59, baseline: 49, cap: 100,
 *     unit: "£", display_value: "£59" }
 *
 * The canvas renders £59. **The user is shown their TARGET as the present
 * state of their business.** They said the price is £49 today and that £59 is
 * the move under consideration; the product asserts the move has happened.
 *
 * ── WHY THE WRITER, AND NOT THE DISPLAY ────────────────────────────────────
 * CEE has TWO writers of the `{value, raw_value}` current-level pair, and they
 * disagree about which level the pair holds:
 *
 *   · `draft/records/projector.ts:3503` writes the CURRENT level
 *     (`value: baseline/frame, raw_value: baseline`), and its own header says
 *     this is *"what keeps '£50,000' true on screen"*.
 *   · `factor-extraction/enricher.ts` writes the TARGET.
 *
 * Every reader — `synthesiseDisplayValue` (whose docstring is *"a factor's
 * current value"*), the edit path's delta operators, and the analysis — reads
 * that pair as the current level. The display is not wrong; it renders
 * faithfully what it is given, and what it is given is wrong. So the enricher
 * is brought into line with the projector, at the producer.
 *
 * ── WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE (trap 13d) ──────────────
 * The property is not "a `from £49 to £59` price brief". It is:
 *
 *   where an extracted factor states a current level DISTINCT from the value
 *   beside it, the node's current-level fields carry that stated level, on the
 *   frame the node's own cap defines.
 *
 * ── THE SCALE HAZARD, WHICH IS WORSE THAN THE DEFECT ───────────────────────
 * `baseline` is in the units of the `value` written beside it: RAW for a
 * currency from-to (49 beside 59), ALREADY-FRACTIONAL for a percent one (0.85
 * beside 0.95). Dividing where no cap exists renders every percent factor 100×
 * wrong. Every case below that pins a DIVISION has a twin pinning a
 * NON-division.
 *
 * ── AND THE CAP MUST COVER WHAT THE USER WROTE ─────────────────────────────
 * Measured at pristine, *"cut the unit cost from £150 to £90"* yields
 * `{raw_value: 90, baseline: 150, cap: 100}` — so the stated current level is
 * ABOVE its own cap, the defect `factor-extraction/index.ts:1075` already
 * names on the goal path. Storing 150 against a cap of 100 would normalise to
 * 1.5 and put the factor off the top of its own scale. `computeExtractedFactorCap`
 * already declares the rule — *"The scale has to cover what the user wrote,
 * not the point this service picked out of it"* — and its ceiling was simply
 * missing this member.
 */

import { describe, it, expect } from "vitest";
import { enrichGraphWithFactors, enrichGraphWithFactorsAsync } from "../enricher.js";
import { extractFactors } from "../index.js";
import { readFactorBaselineLevel, validateGraph } from "../../../validators/graph-validator.js";
import { resolveScaleFrame } from "../../../orchestrator-v5/tools/handlers/d1-shared/scale-frame.js";
import type { GraphT, NodeT } from "../../../schemas/graph.js";

/** Paul's brief, verbatim in the half that matters. */
const PAUL_BRIEF = "Should we increase the Pro plan price from £49 to £59?";

function goalOnlyGraph(): GraphT {
  return {
    nodes: [{ id: "goal-1", kind: "outcome", label: "Grow annual revenue", data: {} }],
    edges: [],
  } as unknown as GraphT;
}

function withDraftedFactor(label: string): GraphT {
  return {
    nodes: [
      { id: "goal-1", kind: "outcome", label: "Grow annual revenue", data: {} },
      { id: "fac-pro-price", kind: "factor", label, data: {} },
    ],
    edges: [],
  } as unknown as GraphT;
}

/**
 * ⭐ BOUND BY IDENTITY, NEVER BY A VALUE PREDICATE (trap 19). A brief yields
 * several candidate factors; `find(n => n.data.value === 0.49)` would pass on
 * whichever one happened to satisfy it, including the `inferred` contextual
 * £49 this fix does not touch. The node is fetched BY ID.
 */
function nodeById(graph: GraphT, id: string): NodeT {
  const node = (graph.nodes as NodeT[]).find((n) => n.id === id);
  expect(node, `no node with id "${id}" — the fixture, not the code, has moved`).toBeDefined();
  return node!;
}

function factorData(node: NodeT): Record<string, unknown> {
  return (node.data ?? {}) as Record<string, unknown>;
}

/**
 * ⭐ PIN THE PRECONDITION IN-TEST (trap 13b). Every assertion below is about
 * what the enricher does WITH a stated baseline. If the extractor ever stops
 * producing one for these briefs, the expectations would hold vacuously — the
 * node would simply carry its single number. This asserts the defect's own
 * input exists, so a green case is provably the enricher's doing.
 */
function assertStatesADistinctBaseline(brief: string): void {
  const stated = extractFactors(brief).filter(
    (f) => typeof f.baseline === "number" && f.baseline !== f.value,
  );
  expect(
    stated.length,
    `"${brief}" produced no factor stating a baseline distinct from its value — the precondition these tests are about is absent`,
  ).toBeGreaterThan(0);
}

describe("a factor's displayed current level is the level the user stated", () => {
  it("Paul's brief: the INJECTED price factor displays £49, not the £59 target", async () => {
    assertStatesADistinctBaseline(PAUL_BRIEF);

    const { graph } = await enrichGraphWithFactorsAsync(goalOnlyGraph(), PAUL_BRIEF, {});
    const d = factorData(nodeById(graph, "factor_price_0"));

    expect(d.display_value).toBe("£49");
    expect(d.raw_value).toBe(49);
    expect(d.value).toBeCloseTo(0.49, 10);
    // The stated starting point is KEPT, unchanged and in its own raw units.
    expect(d.baseline).toBe(49);
  });

  it("Paul's brief: the ENHANCED drafted factor displays £49, not the £59 target", async () => {
    assertStatesADistinctBaseline(PAUL_BRIEF);

    const { graph } = await enrichGraphWithFactorsAsync(
      withDraftedFactor("Pro plan price"),
      PAUL_BRIEF,
      {},
    );
    const d = factorData(nodeById(graph, "fac-pro-price"));

    expect(d.display_value).toBe("£49");
    expect(d.raw_value).toBe(49);
    expect(d.value).toBeCloseTo(0.49, 10);
  });

  /**
   * ⭐ THE SYNCHRONOUS WRITER, AND WHY `minConfidence` IS LOAD-BEARING HERE.
   *
   * This deprecated writer has no production caller at `c6c16885` (a complete
   * sweep of `src/` finds only `unified-pipeline/stages/enrich.ts`, which calls
   * the ASYNC one), but it is a second writer of the same concept and was
   * carrying the same defect, so it is corrected rather than left to disagree.
   *
   * At the default confidence floor it cannot be driven into the defect at
   * all — measured at pristine, the injection branch keeps the FIRST candidate
   * (the `range` midpoint, baseline-less) and the enhance branch is overwritten
   * by the LAST (the `inferred` contextual £49, also baseline-less), so the
   * baseline-bearing `explicit` factor never reaches the write site. That
   * sequencing is pre-existing behaviour this fix does not touch. Raising the
   * floor to 0.9 admits only the `explicit` factor (0.95), which is what puts
   * the changed line under test: PRISTINE writes 59, this writes 49.
   */
  it("the synchronous writer stores the stated level, not the target", () => {
    assertStatesADistinctBaseline(PAUL_BRIEF);

    const { graph } = enrichGraphWithFactors(withDraftedFactor("Pro plan price"), PAUL_BRIEF, {
      minConfidence: 0.9,
    });
    const d = factorData(nodeById(graph, "fac-pro-price"));

    // Bound by identity: this is the `explicit` from-to extraction, the only
    // one above the floor — not whichever candidate happened to carry a 49.
    expect(d.extractionType).toBe("explicit");
    // The sync writer stores no cap, so the stated level stays in its own units.
    expect(d.value).toBe(49);
    expect(d.baseline).toBe(49);
  });

  /**
   * ⭐⭐ THE OPTION_NO_OP GUARANTEE, READ THROUGH #1453'S OWN OWNER.
   *
   * This does not re-derive a divisor. It asserts that the pair this fix
   * writes is one `resolveScaleFrame` — the estate's single owner of *"what
   * frame is this factor on?"* — recovers the SAME frame from, and therefore
   * that `readFactorBaselineLevel` (#1453) and `data.value` now give ONE
   * answer. Moving the number without this is exactly how the false no-op
   * would be reintroduced.
   */
  it("#1453's resolver and the node's own value agree after the move", async () => {
    const { graph } = await enrichGraphWithFactorsAsync(goalOnlyGraph(), PAUL_BRIEF, {});
    const node = nodeById(graph, "factor_price_0");
    const d = factorData(node);

    expect(resolveScaleFrame({ value: d.value, raw_value: d.raw_value })).toBe(100);
    expect(readFactorBaselineLevel(node)).toBeCloseTo(d.value as number, 10);
    expect(readFactorBaselineLevel(node)).toBeCloseTo(0.49, 10);
  });

  /**
   * ⭐⭐ THE NON-DIVISION TWIN. A percent from-to is extracted ALREADY
   * fractional (`{value: 0.95, baseline: 0.85}`) and the enricher computes no
   * cap for it. Dividing here by anything would ship 0.0085; reading the raw
   * percent would ship 85. Both are the 100× error this fix must not buy.
   */
  it("a percent from-to is NOT divided: 85%, never 0.85% and never 8500%", async () => {
    const brief = "Should we raise the conversion rate from 85% to 95% this year?";
    assertStatesADistinctBaseline(brief);

    const { graph } = await enrichGraphWithFactorsAsync(goalOnlyGraph(), brief, {});
    const d = factorData(nodeById(graph, "factor_conversion_rate_0"));

    expect(d.value).toBeCloseTo(0.85, 10);
    expect(d.display_value).toBe("85%");
    expect(d.raw_value).toBeUndefined();
    expect(d.cap).toBeUndefined();
  });

  /**
   * ⭐⭐ A DECREASE PUTS THE STATED LEVEL ABOVE THE TARGET, AND THE CAP HAS TO
   * COVER IT. At pristine this brief yields `{raw_value: 90, baseline: 150,
   * cap: 100}`: storing 150 against that cap normalises to 1.5 — off the top
   * of the factor's own scale.
   */
  it("a decrease across an order of magnitude stays on its own scale", async () => {
    const brief = "Should we cut the unit cost from £150 to £90?";
    assertStatesADistinctBaseline(brief);

    const { graph } = await enrichGraphWithFactorsAsync(goalOnlyGraph(), brief, {});
    const d = factorData(nodeById(graph, "factor_cost_0"));

    expect(d.raw_value).toBe(150);
    expect(d.display_value).toBe("£150");
    expect(d.value as number).toBeLessThanOrEqual(1);
    expect(d.value).toBeCloseTo(0.15, 10);
    expect(d.cap).toBe(1000);
  });

  /**
   * A SECOND MAGNITUDE, so the corpus is not only ever 49-beside-59 — the same
   * discipline #1453's own spec adopted.
   */
  it("holds at hundreds of thousands", async () => {
    const brief = "Should we increase the marketing budget from £200,000 to £300,000?";
    assertStatesADistinctBaseline(brief);

    const { graph } = await enrichGraphWithFactorsAsync(goalOnlyGraph(), brief, {});
    const d = factorData(nodeById(graph, "factor_budget_0"));

    expect(d.raw_value).toBe(200000);
    expect(d.display_value).toBe("£200k");
    expect(d.value).toBeCloseTo(0.2, 10);
    expect(d.cap).toBe(1000000);
  });

  /**
   * ⭐⭐⭐ THE WHOLE POINT, END TO END: THE FACTOR THIS PIPELINE REALLY
   * PRODUCES, IN A GRAPH SHAPED LIKE PAUL'S, DOES NOT REINTRODUCE THE FALSE
   * NO-OP — AND THE CHECK IS PROVED AWAKE ON THE SAME GRAPH.
   *
   * The factor is NOT hand-written: it is lifted from
   * `enrichGraphWithFactorsAsync`'s own output, because a fixture written here
   * would encode this file's model of the producer rather than the producer
   * (trap 16-inverse). Only the surrounding graph is scaffolding, and it is
   * shaped like `option-no-op-invariant.test.ts`'s, which the validator needs
   * in order to reach the check at all.
   *
   * The positive control is the load-bearing half: an absence assertion whose
   * instrument is asleep passes by testing nothing (trap 13). A first version
   * of this case reported "0 no-ops" on a graph where the check could not fire
   * AT ALL — a clean false negative.
   */
  it("the real enriched factor: an option at £59 is not a no-op, and the check is awake", async () => {
    const { graph: enriched } = await enrichGraphWithFactorsAsync(
      goalOnlyGraph(),
      PAUL_BRIEF,
      {},
    );
    const produced = nodeById(enriched, "factor_price_0");
    const level = (produced.data as { value: number }).value;
    expect(level).toBeCloseTo(0.49, 10);

    const graphWith = (optionLevel: number): GraphT =>
      ({
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "decision_1", kind: "decision", label: "Which option?" },
          {
            id: "opt_raise",
            kind: "option",
            label: "Increase the Pro plan price from £49 to £59",
            data: { interventions: { factor_price_0: optionLevel } },
          },
          // A sibling, because the validator refuses a one-option decision
          // before it ever reaches the no-op check.
          {
            id: "opt_soft",
            kind: "option",
            label: "Raise the price to £54 instead",
            data: { interventions: { factor_price_0: 0.54 } },
          },
          // ⭐ The factor exactly as the pipeline produced it — `data` is NOT
          // rewritten, because that object is what this file is about. Only
          // `category` and `observed_state` are scaffolding: the validator
          // requires a controllable target, and `schema-v3.ts` rebuilds
          // `observed_state` FROM `data` on the real path.
          {
            ...produced,
            category: "controllable",
            observed_state: {
              value: level,
              raw_value: (produced.data as { raw_value?: number }).raw_value,
            },
          },
          { id: "outcome_1", kind: "outcome", label: "MRR" },
          { id: "goal_1", kind: "goal", label: "£20k MRR" },
        ],
        edges: [
          { from: "decision_1", to: "opt_raise", strength_mean: 1, belief_exists: 1 },
          { from: "decision_1", to: "opt_soft", strength_mean: 1, belief_exists: 1 },
          {
            from: "opt_raise",
            to: "factor_price_0",
            strength_mean: 1,
            strength_std: 0.01,
            belief_exists: 1,
            effect_direction: "positive",
          },
          {
            from: "opt_soft",
            to: "factor_price_0",
            strength_mean: 1,
            strength_std: 0.01,
            belief_exists: 1,
            effect_direction: "positive",
          },
          {
            from: "factor_price_0",
            to: "outcome_1",
            strength_mean: 0.5,
            strength_std: 0.1,
            belief_exists: 1,
            effect_direction: "positive",
          },
          {
            from: "outcome_1",
            to: "goal_1",
            strength_mean: 1,
            strength_std: 0.01,
            belief_exists: 1,
            effect_direction: "positive",
          },
        ],
      }) as unknown as GraphT;

    const noOpIds = (g: GraphT): string[] =>
      validateGraph({ graph: g })
        .errors.filter((e) => e.code === "OPTION_NO_OP")
        .map((e) => String((e.context as { optionId?: unknown } | undefined)?.optionId));

    // ⭐ POSITIVE CONTROL FIRST. An option held at the factor's own level IS a
    // no-op and MUST be flagged — otherwise the assertion below is vacuous.
    expect(noOpIds(graphWith(level))).toEqual(["opt_raise"]);

    // And the real alternative — raising the price to £59 — is not.
    expect(noOpIds(graphWith(0.59))).toEqual([]);
  });

  /**
   * ⭐⭐⭐ THE MAJORITY PATH, AND BREAKING IT IS FAR WORSE THAN THE DEFECT.
   * A brief that states no starting level yields a factor with NO `baseline`,
   * and nothing about it may move. Asserted against the WHOLE data object, so
   * a stray field addition reds here rather than shipping.
   */
  it("a factor with no stated baseline is byte-for-byte unchanged", async () => {
    const brief = "The Pro plan price is £49 and we want to grow revenue.";
    // CONTRAST CONTROL: this brief must produce NO distinct stated baseline —
    // the inverse of the precondition every case above asserts.
    expect(
      extractFactors(brief).filter((f) => typeof f.baseline === "number" && f.baseline !== f.value),
    ).toHaveLength(0);

    const { graph } = await enrichGraphWithFactorsAsync(goalOnlyGraph(), brief, {});
    const d = factorData(nodeById(graph, "factor_price_0"));

    expect(d.value).toBeCloseTo(0.49, 10);
    expect(d.raw_value).toBe(49);
    expect(d.cap).toBe(100);
    expect(d.display_value).toBe("£49");
    expect(d.baseline).toBeUndefined();
  });
});
