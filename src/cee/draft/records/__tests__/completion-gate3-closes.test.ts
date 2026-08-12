/**
 * ROUND 9 — THE THREE GATE-3 MECHANISMS, AND THE OPTIONS_IDENTICAL ALIGNMENT.
 *
 * Round 8 proved the fixed keep/discard comparator does not rescue gate 3 and
 * named three residual mechanisms, none of them the comparator. This spec binds
 * each one.
 *
 * ── WHAT EVERY ASSERTION HERE IS BOUND TO ──────────────────────────────────
 * Every expectation is derived from the PRODUCER at its own bytes — the
 * validator's `ALLOWED_EDGES`, the projector's `UNRESCUABLE_EDGE_SHAPES`, the
 * sweep's `fixFactorGoalEdges` — never from this file's reading of what a rule
 * ought to be (trap 13c: a mutant kit measures whether a test can DETECT a
 * change, never whether the expectation is RIGHT).
 *
 * And every guard PINS ITS OWN PRECONDITION in-test (trap 13b): before asserting
 * that an ask item is present or absent, the spec asserts the projected graph
 * really is in the state that is supposed to produce it. A discriminator whose
 * fixture silently stops reproducing the condition stays green forever
 * otherwise.
 */
import { describe, expect, it } from "vitest";
import {
  enumerateCompletionAsk,
  buildRecordsCompletionPrompt,
  renderLegalEdgeVocabulary,
} from "../completion.js";
import { projectRecordsToGraph, UNRESCUABLE_EDGE_SHAPES } from "../projector.js";
import { ALLOWED_EDGES } from "../../../../validators/graph-validator.types.js";
import type { DraftRecordSet } from "../grammar.js";

/**
 * A record set whose options reach the goal THROUGH A FACTOR — the healthy
 * shape. `stated_items[1]` is the goal, deliberately NOT index 0, so a test that
 * passes by hardcoding "the goal is 0" fails.
 */
function recordsWithFactorGoalChain(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "option", source_quote: "enter Germany directly" },
      { kind: "goal", source_quote: "reach £10m ARR by 2027" },
      { kind: "option", source_quote: "partner with a local player" },
    ],
    claims: [
      { claim_kind: "factor", label: "new-logo pipeline" },
      { claim_kind: "causal_link", label: "direct entry builds pipeline", from_stated: 0, to_claim: 0, effect: "positive", sets_to: 1 },
      { claim_kind: "causal_link", label: "partnering builds pipeline", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0.4 },
      { claim_kind: "causal_link", label: "pipeline drives ARR", from_claim: 0, to_stated: 1, effect: "positive" },
    ],
  };
}

/** The same brief with the goal-terminating link removed — nothing reaches the goal. */
function recordsWithNoGoalTermination(): DraftRecordSet {
  const base = recordsWithFactorGoalChain();
  return { stated_items: base.stated_items, claims: base.claims.slice(0, 3) };
}

describe("mechanism 1 — the ask NAMES the goal's stated index and the field that reaches it", () => {
  it("names the goal by index, quote and `to_stated` when nothing terminates at it", () => {
    const records = recordsWithNoGoalTermination();
    const projection = projectRecordsToGraph(records);

    // PRECONDITION, pinned in-test: the goal node exists and NOTHING reaches it.
    // Without this the assertion below could pass on a projection that simply
    // has no goal at all.
    const goalNodes = projection.graph.nodes.filter((n) => n.kind === "goal");
    expect(goalNodes).toHaveLength(1);
    expect(projection.graph.edges.some((e) => e.to === goalNodes[0]!.id)).toBe(false);

    const ask = enumerateCompletionAsk(records, projection);
    const item = ask.items.find((i) => i.kind === "no_chain_reaches_goal");
    expect(item).toBeDefined();
    // BOUND BY IDENTITY: the goal is stated_items[1], not [0], and the detail
    // must carry that exact index, that exact quote, and the exact field.
    expect(item!.detail).toContain("`to_stated: 1`");
    expect(item!.detail).toContain("reach £10m ARR by 2027");
    expect(item!.detail).toContain("never with `to_claim`");
    expect(item!.validatorCode).toBe("NO_PATH_TO_GOAL");
  });

  it("puts the goal's index and field in the built prompt, not only in the ask", () => {
    const records = recordsWithNoGoalTermination();
    const projection = projectRecordsToGraph(records);
    const prompt = buildRecordsCompletionPrompt({
      brief: "we want to reach £10m ARR by 2027",
      records,
      ask: enumerateCompletionAsk(records, projection),
    });
    expect(prompt).toContain("the goal is `stated_items[1]`");
    expect(prompt).toContain("reach it with `to_stated: 1`");
    // The v4 prompt's ONLY reference instruction named the claim namespace, and
    // that is the sentence run 8 followed. It must no longer stand alone.
    expect(prompt).toContain("`to_claim` can never reach the goal");
  });

  it("does not raise the goal item at all once a chain terminates at the goal", () => {
    const records = recordsWithFactorGoalChain();
    const projection = projectRecordsToGraph(records);
    // PRECONDITION: this fixture really does reach the goal.
    const goalId = projection.graph.nodes.find((n) => n.kind === "goal")!.id;
    expect(projection.graph.edges.some((e) => e.to === goalId)).toBe(true);

    const ask = enumerateCompletionAsk(records, projection);
    expect(ask.items.find((i) => i.kind === "no_chain_reaches_goal")).toBeUndefined();
  });
});

describe("mechanism 3 — MISSING_BRIDGE is predicted, and it is predicted for the derived reason", () => {
  /**
   * The derivation: `fixFactorGoalEdges` runs unconditionally and MINTS an
   * `outcome` node for every `factor → goal` edge, and `MISSING_BRIDGE` is
   * `outcomes.length === 0 && risks.length === 0`. So one surviving
   * `factor → goal` edge makes the code structurally unable to fire.
   *
   * This is a DISCRIMINATING PAIR: the same brief with and without that edge.
   * Neither case alone shows the binding.
   */
  it("raises no_outcome_or_risk when there is no bridge node AND no factor→goal edge", () => {
    const records = recordsWithNoGoalTermination();
    const projection = projectRecordsToGraph(records);
    const kindById = new Map(projection.graph.nodes.map((n) => [n.id, n.kind]));

    // PRECONDITION, both limbs of the derived predicate, pinned in-test.
    expect(projection.graph.nodes.some((n) => n.kind === "constraint" || n.kind === "outcome")).toBe(false);
    expect(
      projection.graph.edges.some((e) => kindById.get(e.from) === "factor" && kindById.get(e.to) === "goal"),
    ).toBe(false);

    const item = enumerateCompletionAsk(records, projection).items.find(
      (i) => i.kind === "no_outcome_or_risk",
    );
    expect(item).toBeDefined();
    expect(item!.validatorCode).toBe("MISSING_BRIDGE");
    // The ask is for an OUTCOME the options produce, stated as the model's own
    // claim — never as a restatement of the user.
    expect(item!.detail).toContain("your own `factor` claim");
    expect(item!.detail).toContain("`to_stated: 1`");
  });

  it("does NOT raise it once a factor→goal edge exists, because the sweep mints the outcome", () => {
    const records = recordsWithFactorGoalChain();
    const projection = projectRecordsToGraph(records);
    const kindById = new Map(projection.graph.nodes.map((n) => [n.id, n.kind]));

    // PRECONDITION: the edge that makes the difference is really present, and no
    // bridge NODE is present — so the pass can only be due to the edge.
    expect(projection.graph.nodes.some((n) => n.kind === "constraint" || n.kind === "outcome")).toBe(false);
    expect(
      projection.graph.edges.some((e) => kindById.get(e.from) === "factor" && kindById.get(e.to) === "goal"),
    ).toBe(true);

    expect(
      enumerateCompletionAsk(records, projection).items.find((i) => i.kind === "no_outcome_or_risk"),
    ).toBeUndefined();
  });

  it("does NOT raise it when a stated constraint supplies the bridge node instead", () => {
    // The OTHER limb: a `constraint` becomes a `risk` post-normalisation, which
    // satisfies MISSING_BRIDGE on inventory. Tested separately so a fix that only
    // ever looks at edges cannot pass.
    //
    // ⚠ THE CONSTRAINT MUST BE CONNECTED TO THE GOAL, and the first version of
    // this fixture was not. The projector WITHHOLDS any record that cannot reach
    // the goal, so an unconnected constraint never enters the graph and supplies
    // no bridge node at all — the precondition assertion below caught it, which
    // is the entire reason a discriminator pins its own precondition (trap 13b).
    // `constraint → goal` is legal: it is `risk → goal` post-normalisation
    // (ALLOWED_EDGES rule :301).
    const base = recordsWithNoGoalTermination();
    const records: DraftRecordSet = {
      stated_items: [...base.stated_items, { kind: "constraint", source_quote: "we cannot spend more than £2m", direction: "ceiling", value: 2 }],
      claims: [
        ...base.claims,
        { claim_kind: "causal_link", label: "the spend ceiling bears on the ARR goal", from_stated: 3, to_stated: 1, effect: "negative" },
      ],
    };
    const projection = projectRecordsToGraph(records);
    const kindById = new Map(projection.graph.nodes.map((n) => [n.id, n.kind]));

    // PRECONDITION: bridge NODE present, bridge EDGE absent — the mirror of the
    // previous case, so the two cannot both pass for the same reason.
    expect(projection.graph.nodes.some((n) => n.kind === "constraint")).toBe(true);
    expect(
      projection.graph.edges.some((e) => kindById.get(e.from) === "factor" && kindById.get(e.to) === "goal"),
    ).toBe(false);

    expect(
      enumerateCompletionAsk(records, projection).items.find((i) => i.kind === "no_outcome_or_risk"),
    ).toBeUndefined();
  });
});

describe("mechanism 2 — the completion prompt carries the LEGAL VOCABULARY, derived from its authorities", () => {
  /**
   * ⭐ THE UNION ASSERTION (trap 12d). A derived guard proves the copies agree;
   * it can never prove the list is RIGHT. So this asserts the rendered vocabulary
   * against the AUTHORITY rather than against itself: every `ALLOWED_EDGES` rule
   * whose endpoints a model-emitted reference can reach must be represented.
   *
   * The kind→phrase mapping is deliberately re-derived HERE, independently of
   * the module's own table, so the two have to agree.
   */
  const PHRASE: Record<string, string | null> = {
    option: "an option",
    factor: "a factor",
    risk: "a constraint you recorded",
    goal: "the goal",
    decision: null,
    outcome: null,
  };

  it("represents every model-reachable ALLOWED_EDGES rule", () => {
    const vocabulary = renderLegalEdgeVocabulary();
    const reachable = ALLOWED_EDGES.filter(
      (r) => PHRASE[r.fromKind] !== null && PHRASE[r.toKind] !== null,
    );
    // PRECONDITION: the filter actually kept something. A silently-empty
    // expectation list is a test that cannot fail.
    expect(reachable.length).toBeGreaterThan(0);
    for (const rule of reachable) {
      expect(vocabulary).toContain(`${PHRASE[rule.fromKind]} → ${PHRASE[rule.toKind]}`);
    }
  });

  it("names `a factor → the goal` even though ALLOWED_EDGES does not carry it", () => {
    // The one unconditional-repair extension. Asserted separately BECAUSE it is
    // the entry that is hand-written: if it were ever dropped, the union
    // assertion above would stay green while the model lost the shape that
    // clears both NO_PATH_TO_GOAL and MISSING_BRIDGE.
    expect(ALLOWED_EDGES.some((r) => r.fromKind === "factor" && r.toKind === "goal")).toBe(false);
    expect(renderLegalEdgeVocabulary()).toContain("a factor → the goal");
  });

  it("lists every model-reachable UNRESCUABLE shape as dropped outright", () => {
    const vocabulary = renderLegalEdgeVocabulary();
    const reachable = [...UNRESCUABLE_EDGE_SHAPES].filter((s) => {
      const [from, to] = s.split("->");
      return PHRASE[from ?? ""] != null && PHRASE[to ?? ""] != null;
    });
    expect(reachable.length).toBeGreaterThan(0);
    for (const shape of reachable) {
      const [from, to] = shape.split("->");
      // Grouped by source kind, so the assertion is that the source line exists
      // and carries this target.
      const line = vocabulary
        .split("\n")
        .find((l) => l.startsWith(`- ${PHRASE[from!]} → `) && l.includes(PHRASE[to!]!));
      expect(line, `unrescuable shape ${shape} is not disclosed to the model`).toBeDefined();
    }
  });

  it("states the one-edge rule — the shape 14 banked completion links died on", () => {
    // A HAND-WRITTEN corpus check alongside the derived ones (trap 12d): the
    // derivation cannot notice that the ONE rule the model actually broke is
    // missing, because that rule is a predicate rather than a table row.
    const vocabulary = renderLegalEdgeVocabulary();
    expect(vocabulary).toContain("nothing may point INTO a factor that an option acts on");
    expect(vocabulary).toContain("FURTHER ALONG the chain");
  });

  it("puts the derived vocabulary into the built prompt itself", () => {
    const records = recordsWithNoGoalTermination();
    const prompt = buildRecordsCompletionPrompt({
      brief: "b",
      records,
      ask: enumerateCompletionAsk(records, projectRecordsToGraph(records)),
    });
    expect(prompt).toContain(renderLegalEdgeVocabulary());
  });
});

describe("mechanism 4 — the prompt no longer permits leaving indistinguishable options alone", () => {
  it("drops the leave-them-alone permission and states the consequence", () => {
    const records = recordsWithFactorGoalChain();
    const prompt = buildRecordsCompletionPrompt({
      brief: "b",
      records,
      ask: enumerateCompletionAsk(records, projectRecordsToGraph(records)),
    });
    // The v4 sentence the pipeline punishes with a 500 (run 12).
    expect(prompt).not.toContain("leave them alone");
    expect(prompt).toContain("rejected outright");
    expect(prompt).toContain("leaving them as they are is not a safe");
  });

  it("keeps the do-not-invent-a-number guard that the removed sentence carried", () => {
    // ⭐ The removed permission also carried the anti-fabrication clause. Removing
    // one without keeping the other would trade a 500 for an invented number,
    // which is the worse failure. Bound by content, not by hash.
    const records = recordsWithFactorGoalChain();
    const prompt = buildRecordsCompletionPrompt({
      brief: "b",
      records,
      ask: enumerateCompletionAsk(records, projectRecordsToGraph(records)),
    });
    expect(prompt).toContain("Do not invent a number to tell them apart");
    expect(prompt).toContain("number the user will read as their own");
    expect(prompt).toContain("Use only levels the brief gives");
  });
});
