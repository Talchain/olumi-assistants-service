/**
 * ⭐⭐ GOAL IDENTITY — the two goal-shaped defects that cost the frozen governed
 * corpus 29 of its 91 pre-sweep blocking findings, and 3 of the 67 that survive
 * the deterministic sweep.
 *
 * ── HOW THEY WERE MEASURED ─────────────────────────────────────────────────
 * `tools/graph-evaluator/scripts/rederive-canonical-readiness.ts`, run on the
 * frozen 14-brief governed baseline
 * (`governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json`) at this
 * tip. Its pre-sweep arm reproduces the frozen artefact's verdict and blocking
 * multiset for all 14 briefs exactly — that agreement is its positive control.
 *
 * ── DEFECT 1: A MISSING GOAL IS NEVER ASKED ABOUT ──────────────────────────
 * Three briefs (05-product-feature, 07-cloud-migration, 10-many-observables)
 * produced graphs with ZERO `kind: "goal"` nodes. In every one of the three the
 * model KNEW what the goal was: it emitted causal links whose own labels read
 * *"… reaches goal"* / *"… harms goal"* and pointed them at a single stated item
 * — which projected to `option` (07, 10) or `factor` (05), never `goal`. Every
 * one of those links was then refused as `unrescuable_shape`, so nothing reached
 * a goal and no goal node existed.
 *
 * ⭐ AND A MISSING GOAL SILENTLY DISABLES THREE PROTECTIVE MECHANISMS AT ONCE,
 * all keyed on the same predicate:
 *   · `projector.ts:1899`  — `if (goalNodes.length > 0)` gates the entire
 *                            unconnected-derived-node prune;
 *   · `completion.ts:717`  — `no_chain_reaches_goal` is gated on `goalIds.length > 0`;
 *   · `completion.ts:734`  — `no_outcome_or_risk` / `MISSING_BRIDGE`, same gate.
 * So the graph is worst exactly where every guard is off. On the product path the
 * deterministic sweep repairs the orphan half (measured: `ORPHAN_NODE` 26 → 3),
 * which is why THIS test does not add a fourth orphan authority — the sweep
 * already owns that. What nothing owns is the ROOT CAUSE: `enumerateCompletionAsk`
 * has seven ask kinds and NONE of them says "there is no goal".
 *
 * `MISSING_GOAL` is in `BUCKET_C_CODES` — the sweep's own authority for "cannot
 * be repaired deterministically" — so the completion turn is precisely the right
 * place to raise it, and `isBlockingAskItem` classifies it without being told.
 *
 * ⚠ WHY AN ASK AND NOT A MINT. Which of brief 10's three `outcome` nodes is the
 * objective (one is literally labelled *"Business Health Goal"*) is a fact about
 * what the user MEANT. Picking one would assert an objective the user never
 * stated, and an inverted objective is the estate's ratified never-do
 * (trap 22f: where it cannot be determined, make the AMBIGUITY the product and
 * ask). The completion grammar carries no `stated_items` at all, so the second
 * turn structurally cannot fabricate a user quote in answer.
 *
 * ── DEFECT 2: ONE GOAL, STATED TWICE, BECOMES TWO NODES AND ORPHANS ONE ────
 * 12-similar-options emitted the goal quote twice. `mintUnique` suffixed the
 * second (`c100a827` / `c100a827-2`), every edge attached to the SUFFIXED node,
 * and the original was left with zero edges — `ORPHAN_NODE`, plus
 * `NO_PATH_TO_GOAL`. `mintUnique`'s reasoning ("a model may repeat itself; both
 * must get distinct ids or the graph silently loses one") is right for a repeated
 * `figure` and wrong for a `goal`: a decision has ONE objective, and a second
 * copy of the same words is not a second objective.
 *
 * ⭐ THE DISCRIMINATING PAIR IS IN THE CORPUS ITSELF (trap 19 — bind by
 * identity, and prove the fix discriminates rather than merely bites):
 * 04-conflicting-constraints ALSO carries two goal nodes — *"cutting our burn
 * rate by 30%"* and *"achieve 3x user growth this year"* — with DIFFERENT labels
 * and BOTH connected. Two genuine objectives. A collapse that keyed on "kind is
 * goal" rather than on "kind is goal AND the quote is identical" would destroy
 * one of the user's two stated objectives, so both halves are pinned below.
 */
import { describe, expect, it } from "vitest";

import {
  buildRecordsCompletionPrompt,
  buildRecordsCompletionSchema,
  enumerateCompletionAsk,
  isBlockingAskItem,
  isModelAnswerableAskItem,
} from "../completion.js";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

/** The brief text, supplied so stated items can bind rather than under-claim. */
const BRIEF =
  "We must increase MRR from £215k to £250k within 6 months. " +
  "We could hold all prices, or raise Enterprise by 30%.";

/**
 * A record set shaped like the three NO_GOAL cases: the model reasons to an
 * outcome and a risk and links them onward, but files NO stated item of kind
 * `goal`, so no goal node is ever minted.
 */
function recordsWithoutAStatedGoal(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "option", source_quote: "hold all prices" },
      { kind: "option", source_quote: "raise Enterprise by 30%" },
    ],
    claims: [
      { claim_kind: "factor", label: "Enterprise Price Point", basis: [1] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [1] },
      {
        claim_kind: "causal_link",
        label: "holding prices leaves price point unchanged",
        from_stated: 0,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "raising Enterprise lifts the price point",
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "price point lifts MRR",
        from_claim: 0,
        to_claim: 1,
        effect: "positive",
      },
    ],
  };
}

/** The same set, with the goal the user actually stated present as a stated item. */
function recordsWithAStatedGoal(): DraftRecordSet {
  const base = recordsWithoutAStatedGoal();
  return {
    stated_items: [
      { kind: "goal", source_quote: "increase MRR from £215k to £250k within 6 months" },
      ...base.stated_items,
    ],
    // Every `from_stated`/`to_stated` index shifts by one, and the outcome now
    // terminates at the goal so the set is one the pipeline would accept.
    claims: [
      { claim_kind: "factor", label: "Enterprise Price Point", basis: [2] },
      { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [2] },
      {
        claim_kind: "causal_link",
        label: "holding prices leaves price point unchanged",
        from_stated: 1,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "raising Enterprise lifts the price point",
        from_stated: 2,
        to_claim: 0,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "price point lifts MRR",
        from_claim: 0,
        to_claim: 1,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "MRR reaches the goal",
        from_claim: 1,
        to_stated: 0,
        effect: "positive",
      },
    ],
  };
}

function askFor(records: DraftRecordSet) {
  const projection = projectRecordsToGraph(records, BRIEF);
  return { projection, ask: enumerateCompletionAsk(records, projection) };
}

describe("a graph with no goal node is asked about", () => {
  it("raises a `no_goal` ask item, named by identity and routed as blocking", () => {
    const { projection, ask } = askFor(recordsWithoutAStatedGoal());

    // Precondition PINNED IN-TEST (trap 21): this record set really does produce
    // a goal-less graph. Without this the assertion below could pass because the
    // fixture stopped reproducing the condition rather than because the code works.
    expect(projection.graph.nodes.filter((n) => n.kind === "goal")).toHaveLength(0);

    const items = ask.items.filter((i) => i.kind === "no_goal");
    expect(items).toHaveLength(1);
    // `MISSING_GOAL` is the sweep's vocabulary and is in `BUCKET_C_CODES`, so the
    // item must be classified blocking WITHOUT this test restating that routing.
    expect(items[0]!.validatorCode).toBe("MISSING_GOAL");
    expect(isBlockingAskItem(items[0]!)).toBe(true);
  });

  it("does NOT raise it when the user's goal is present — the discriminating half", () => {
    const { projection, ask } = askFor(recordsWithAStatedGoal());

    // Precondition pinned the other way round.
    expect(projection.graph.nodes.filter((n) => n.kind === "goal")).toHaveLength(1);

    expect(ask.items.filter((i) => i.kind === "no_goal")).toHaveLength(0);
  });

  it("asks for the objective without proposing one — no fabricated goal in the ask", () => {
    const { ask } = askFor(recordsWithoutAStatedGoal());
    const item = ask.items.find((i) => i.kind === "no_goal");
    expect(item).toBeDefined();

    // ⭐ THE FABRICATION GUARD. The ask may describe the GAP; it may not name a
    // candidate objective, because every label available to it
    // ("Monthly Recurring Revenue") is the model's own inference, and offering it
    // back as the user's objective is how an invented goal acquires a badge it
    // never earned. A mutant that helpfully suggests the outcome label REDs here.
    expect(item!.detail).not.toContain("Monthly Recurring Revenue");
    // Nor may it smuggle in a number: nothing in this record set states a target.
    expect(item!.detail).not.toMatch(/\d/);
  });
});

describe("one objective stated twice is one goal node", () => {
  /** The 12-similar-options shape: the same goal quote filed twice. */
  const DUPLICATE_QUOTE = "increase MRR from £215k to £250k within 6 months";

  function recordsWithTheGoalStatedTwice(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: DUPLICATE_QUOTE },
        { kind: "goal", source_quote: DUPLICATE_QUOTE },
        { kind: "option", source_quote: "hold all prices" },
        { kind: "option", source_quote: "raise Enterprise by 30%" },
      ],
      claims: [
        { claim_kind: "factor", label: "Enterprise Price Point", basis: [3] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [3] },
        {
          claim_kind: "causal_link",
          label: "holding prices leaves price point unchanged",
          from_stated: 2,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "raising Enterprise lifts the price point",
          from_stated: 3,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "price point lifts MRR",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        // The model attaches the goal-bound link to the SECOND copy — exactly what
        // orphaned the first one in the corpus.
        {
          claim_kind: "causal_link",
          label: "MRR reaches the goal",
          from_claim: 1,
          to_stated: 1,
          effect: "positive",
        },
      ],
    };
  }

  it("collapses byte-identical stated goals to a single, connected node", () => {
    const { graph } = projectRecordsToGraph(recordsWithTheGoalStatedTwice(), BRIEF);
    const goals = graph.nodes.filter((n) => n.kind === "goal");

    expect(goals).toHaveLength(1);
    // The user's own words survive the collapse, byte for byte.
    expect(goals[0]!.label).toBe(DUPLICATE_QUOTE);

    // ⭐ AND IT MUST NOT BE AN ORPHAN — the defect was never "two nodes", it was
    // "the surviving edges attach to one of them". Bind to the goal BY ID.
    const goalId = goals[0]!.id;
    const incident = graph.edges.filter((e) => e.from === goalId || e.to === goalId);
    expect(incident.length).toBeGreaterThan(0);
  });

  it("keeps TWO goal nodes when the user stated two DIFFERENT objectives", () => {
    // The 04-conflicting-constraints shape. This is the contrast control: a
    // collapse keyed on kind alone would delete one of the user's objectives.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "cutting our burn rate by 30%" },
        { kind: "goal", source_quote: "achieve 3x user growth this year" },
        { kind: "option", source_quote: "hold all prices" },
        { kind: "option", source_quote: "raise Enterprise by 30%" },
      ],
      claims: [
        { claim_kind: "factor", label: "Enterprise Price Point", basis: [3] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [3] },
        {
          claim_kind: "causal_link",
          label: "holding prices leaves price point unchanged",
          from_stated: 2,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "raising Enterprise lifts the price point",
          from_stated: 3,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "price point lifts MRR",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "MRR reaches burn rate goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "MRR reaches growth goal",
          from_claim: 1,
          to_stated: 1,
          effect: "positive",
        },
      ],
    };

    const { graph } = projectRecordsToGraph(records, BRIEF);
    const goals = graph.nodes.filter((n) => n.kind === "goal");

    expect(goals).toHaveLength(2);
    expect(goals.map((g) => g.label).sort()).toEqual(
      ["achieve 3x user growth this year", "cutting our burn rate by 30%"].sort(),
    );
  });

  it("loses no stated content: a ref to EITHER copy resolves to the surviving goal", () => {
    // ⭐ THE DROPPED-STATED-VALUE GUARD the collapse must not trip. A mutant that
    // collapsed by discarding the second stated item outright would break the
    // `to_stated: 1` link — the very link that carries the graph to its goal —
    // and the graph would lose its path. Asserting the EDGE survives is what
    // makes this a content test rather than a node-count test.
    const { graph, dropped } = projectRecordsToGraph(recordsWithTheGoalStatedTwice(), BRIEF);
    const goalId = graph.nodes.find((n) => n.kind === "goal")!.id;

    const reachesGoal = graph.edges.filter((e) => e.to === goalId);
    expect(reachesGoal.length).toBeGreaterThan(0);

    // And nothing the user stated may be reported as lost for this reason.
    expect(
      dropped.filter((d) => d.label === DUPLICATE_QUOTE && d.reason === "unconnected_to_goal"),
    ).toHaveLength(0);
  });
});

/**
 * ⭐⭐ THE ASK IS RAISED, AND IT IS NOT PUT TO THE MODEL — because no legal
 * response to it exists.
 *
 * ── THE DEFECT THIS PINS, PROVEN OVER THE COMPLETE CLAIM AXIS ──────────────
 * `no_goal`'s repair is *"file the objective as a `stated_items` entry of kind
 * `goal`"*, and the completion turn cannot do that, three times over:
 *
 *   · `buildRecordsCompletionSchema()` exposes ONLY `claims`, with
 *     `additionalProperties: false` — a `stated_items` key is structurally
 *     rejected before the model's answer is ever read.
 *   · `goal` is not in `DRAFT_RECORD_CLAIM_KINDS` (contrast control below:
 *     `outcome` IS), so it cannot arrive on the claim axis either.
 *   · `mergeCompletionClaims` returns `{ok: false, reason:
 *     "stated_items_disturbed"}` if `stated_items` is present AT ALL — so literal
 *     compliance DISCARDS THE WHOLE COMPLETION, including the claims that would
 *     have repaired the OTHER ask items on the same draft. All three goal-less
 *     corpus briefs carry 6-12 other items, so that is a reachable regression,
 *     not a hypothetical one.
 *
 * ⚠ AND THE PROMPT CANNOT EVEN NAME A TARGET: `buildRecordsCompletionPrompt`'s
 * `goalLines` block is conditional on a goal EXISTING, so on precisely this case
 * no `to_stated: N` is offered — while the same message says *"Emit ONLY new
 * claims"*. An ask that contradicts its own prompt inside one message.
 *
 * ⭐ THE FABRICATION ARGUMENT AND THE UNANSWERABILITY ARE THE SAME SENTENCE.
 * *"The completion grammar carries no `stated_items`, so the second turn cannot
 * fabricate a user quote"* is exactly why the ask is safe AND exactly why it
 * cannot be answered. The first version of this change drew one consequence from
 * that fact and not the other.
 *
 * So the item stays VISIBLE and BLOCKING — `MISSING_GOAL` is Bucket C, meaning
 * *"not deterministically repairable"*, which is true and worth recording — and
 * is withheld from the model prompt and from the turn gate. Nothing unanswerable
 * reaches the model, and no futile provider call is bought.
 */
describe("an unanswerable ask is recorded, not put to the model", () => {
  it("the completion grammar admits no `stated_items` — the fact the exclusion is derived from", () => {
    const schema = buildRecordsCompletionSchema();
    const properties = schema.properties as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(properties, "stated_items")).toBe(false);
    // Contrast control in the same assertion block: the probe can see a presence,
    // so the absence above is a real absence and not a blind read (trap 13e).
    expect(Object.prototype.hasOwnProperty.call(properties, "claims")).toBe(true);
    expect(schema.additionalProperties).toBe(false);
  });

  it("classifies `no_goal` as not model-answerable, and a repairable item as answerable", () => {
    const { ask } = askFor(recordsWithoutAStatedGoal());
    const noGoal = ask.items.find((i) => i.kind === "no_goal");
    expect(noGoal).toBeDefined();
    expect(isModelAnswerableAskItem(noGoal!)).toBe(false);

    // The discriminating half: this fixture also raises `option_without_chain`,
    // which the completion CAN repair with a causal_link claim. A filter that
    // blanked everything would pass the assertion above and fail this one.
    const answerable = ask.items.filter((i) => i.kind !== "no_goal");
    expect(answerable.length).toBeGreaterThan(0);
    for (const item of answerable) expect(isModelAnswerableAskItem(item)).toBe(true);
  });

  it("keeps it blocking — Bucket C is a true statement about repairability", () => {
    const { ask } = askFor(recordsWithoutAStatedGoal());
    const noGoal = ask.items.find((i) => i.kind === "no_goal")!;
    // Withheld from the model is NOT downgraded: `shouldKeepCompletion` and
    // telemetry must still see it, or a goal-less draft would silently read as
    // unblocked.
    expect(isBlockingAskItem(noGoal)).toBe(true);
  });

  it("omits it from the prompt the model is shown, while keeping the answerable items", () => {
    const records = recordsWithoutAStatedGoal();
    const { ask } = askFor(records);
    const noGoal = ask.items.find((i) => i.kind === "no_goal")!;
    const answerable = ask.items.filter((i) => i.kind !== "no_goal");
    expect(answerable.length).toBeGreaterThan(0);

    const prompt = buildRecordsCompletionPrompt({ brief: BRIEF, records, ask });

    // ⭐ THE LOAD-BEARING ASSERTION: the unanswerable detail is not in the message.
    expect(prompt).not.toContain(noGoal.detail);
    // …and the answerable ones still are. Bind by the item's own text, so a
    // filter that dropped everything REDs here (trap 19 — the pair, not one half).
    for (const item of answerable) expect(prompt).toContain(item.detail);
  });
});

describe("collapsing a duplicate goal never loses the stated target", () => {
  const QUOTE = "increase MRR from £215k to £250k within 6 months";

  /** The corpus shape, with the TARGET VALUE on the second copy only. */
  function goalStatedTwiceValueOnSecond(): DraftRecordSet {
    return {
      stated_items: [
        { kind: "goal", source_quote: QUOTE },
        { kind: "goal", source_quote: QUOTE, value: 250000, unit: "GBP", role: "target" },
        { kind: "option", source_quote: "hold all prices" },
        { kind: "option", source_quote: "raise Enterprise by 30%" },
      ],
      claims: [
        { claim_kind: "factor", label: "Enterprise Price Point", basis: [3] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [3] },
        { claim_kind: "causal_link", label: "holding leaves price unchanged", from_stated: 2, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "raising lifts price", from_stated: 3, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "price lifts MRR", from_claim: 0, to_claim: 1, effect: "positive" },
        // The model attaches the goal-bound link to the SECOND copy — as it did
        // in 12-similar-options.
        { claim_kind: "causal_link", label: "MRR reaches the goal", from_claim: 1, to_stated: 1, effect: "positive" },
      ],
    };
  }

  it("carries the target onto the survivor when only the duplicate stated it", () => {
    const { graph } = projectRecordsToGraph(goalStatedTwiceValueOnSecond(), BRIEF);
    const goals = graph.nodes.filter((n) => n.kind === "goal");

    // Precondition pinned in-test: the collapse really did happen here, so the
    // assertion below is about the survivor and not about two separate nodes.
    expect(goals).toHaveLength(1);

    // ⭐⭐ THE SPEC, NOT THE FAILURE MODE IN HAND (trap 13d). The first version of
    // this suite asserted only that refs RESOLVE — which they did, while the
    // user's own success criterion was silently reduced to prose inside the
    // label. That is precisely the harm the goal-value branch's ROOT 3 comment
    // exists to prevent, reintroduced by the collapse returning before it.
    expect(goals[0]!.goal_threshold_raw).toBe(250000);
    expect(goals[0]!.goal_threshold_unit).toBe("GBP");
  });

  it("refuses to collapse when the two copies state DIFFERENT targets", () => {
    const records = goalStatedTwiceValueOnSecond();
    const stated = [...records.stated_items];
    stated[0] = { kind: "goal", source_quote: QUOTE, value: 300000, unit: "GBP", role: "target" };
    const { graph } = projectRecordsToGraph({ ...records, stated_items: stated }, BRIEF);

    // Two success criteria under one sentence is not one objective. Collapsing
    // would silently pick a winner, so the projector declines and both survive
    // — visibly — rather than one being chosen for the user.
    const goals = graph.nodes.filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(2);
    expect(goals.map((g) => g.goal_threshold_raw).sort()).toEqual([250000, 300000]);
  });

  it("control: a single stated goal keeps its target, collapse or no collapse", () => {
    const records = goalStatedTwiceValueOnSecond();
    const { graph } = projectRecordsToGraph(
      { ...records, stated_items: records.stated_items.slice(1) },
      BRIEF,
    );
    // Reindexed by one: with the duplicate removed the goal is stated_items[0].
    const goals = graph.nodes.filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(1);
    expect(goals[0]!.goal_threshold_raw).toBe(250000);
  });
});
