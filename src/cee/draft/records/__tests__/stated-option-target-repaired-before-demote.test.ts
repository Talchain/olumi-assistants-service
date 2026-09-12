/**
 * THE USER'S OWN OPTION CARRIES THE TARGET ITS OWN SENTENCE STATES — AND THE
 * MODEL'S DUPLICATE OF IT IS WITHDRAWN, NOT COLLIDED WITH.
 *
 * ## THE MEASURED DEFECT (Paul's session, 11 Sep 2026, `olumi-debug-5b41f0eb`)
 *
 * He asked *"should we increase the Pro plan price from £49 to £59 per month
 * with the next Pro feature release?"*. That question became an option node
 * whose intervention was written as **0.49 — the FROM value — against a 0.49
 * baseline**, so his own question changed nothing and was excluded from the
 * comparison. Two model-INVENTED siblings (£59, £54) carried correct numbers,
 * and the analysis recommended **£54, a price he never mentioned**.
 *
 * ## ⭐⭐ WHY THIS SPEC IS AT THE PROJECTOR AND NOT AT THE ENFORCEMENT STAGE
 *
 * `no-op-target-repair.ts` already computes the right number, and it is
 * UNCHANGED here — this spec adds no arithmetic and no language predicate. What
 * it pins is WHERE that computation runs, which is a different question and the
 * one that decides whether Paul's own case is rescued.
 *
 * Derived at the call sites, `staging` @ `7aa49ec8`:
 *
 *   Stage 1 Parse   `unified-pipeline/index.ts:946`
 *                     -> `stages/parse.ts:460`  draftAdapter.draftGraph(...)
 *                     -> `adapters/llm/anthropic.ts:1982` projectDraftRecords(...)
 *                     -> `records/seam.ts:277`  projectRecordsToGraph(...)
 *                     -> `records/projector.ts:4014` findUndevelopedDuplicates  <-- GATE
 *   Stage 4 Repair  `unified-pipeline/index.ts:1056`
 *                     -> `stages/repair/index.ts:170` applyDeterministicEnforcement
 *                     -> `stages/repair/graph-enforcement.ts:765` repairNoOpOptionTargets
 *
 * **The reconciliation runs THREE STAGES BEFORE the repair.** So on the
 * enforcement stage's timeline the model's £59 sibling is still standing when
 * the repair looks, the repaired signature collides with it, and the repair
 * DECLINES — correctly, because at that point nothing downstream would resolve
 * the collision and `OPTIONS_IDENTICAL` (severity `error`) would kill the draft.
 * The user keeps today's outcome. That decline is pinned as a deliberate
 * limitation in `tests/unit/cee.no-op-target-repair.test.ts`.
 *
 * Run the SAME repair before the gate and the collision is not a hazard but the
 * gate's own input: `findUndevelopedDuplicates` groups the two options on the
 * validator's own `buildInterventionSignature`, and its existing ruling —
 * *"A USER-STATED OPTION IS NEVER DEMOTED. Every model duplicate goes"*
 * (`projector.ts:3915`) — withdraws the model's copy and DISCLOSES it. No new
 * adjudication is invented here: the projector has per-option provenance and
 * already owns this question, which is exactly the reasoning
 * `option-demote-with-disclosure.test.ts:6-26` gives for the gate living here.
 *
 * ## ⚠ THE PRECONDITION IS PINNED IN-TEST, NOT ASSUMED (trap 13b/21)
 *
 * A repair that creates a collision nothing resolves would be strictly worse
 * than today. `findUndevelopedDuplicates` opens by returning `[]` on a
 * goal-less graph (`projector.ts:3832`), so the goal-less case is covered
 * below and must keep today's behaviour.
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY — a minted node id located by the user's
 * EXACT quote, or a `dropped` entry located by its claim index — never by a
 * value predicate another option could satisfy (trap 19).
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph } from "../projector.js";
import { buildInterventionSignature, validateGraph } from "../../../../validators/graph-validator.js";
import type { DraftRecordSet } from "../grammar.js";

/** Paul's own sentence, verbatim — the label his option node wears. */
const USER_QUOTE =
  "increase the Pro plan price from £49 to £59 per month with the next Pro feature release";
const MODEL_59 = "Raise Price to £59 at Feature Launch";
const MODEL_54 = "Raise Price to £54 (Soft Increase)";

/** The factor sits at £49, so an option that also says 49 changes nothing. */
const BASELINE_RAW = 49;
/** What his sentence actually asks for. On a frame of 100 this is 0.59. */
const STATED_TARGET_LEVEL = 0.59;
const BASELINE_LEVEL = 0.49;

type G = {
  nodes: Array<{ id: string; kind: string; label: string; data?: Record<string, unknown> }>;
};

/**
 * Paul's measured shape. `withGoal` exists only to exercise the gate's OWN
 * precondition — it is not a product variant.
 */
function paulShape(opts: { withGoal: boolean }): DraftRecordSet {
  const stated: DraftRecordSet["stated_items"] = opts.withGoal
    ? [
        { kind: "goal", source_quote: "grow Pro plan revenue this year" },
        { kind: "option", source_quote: USER_QUOTE },
      ]
    : [{ kind: "option", source_quote: USER_QUOTE }];
  // With no goal the user's option is stated index 0, not 1.
  const userOptionIndex = opts.withGoal ? 1 : 0;
  const claims: DraftRecordSet["claims"] = [
    { claim_kind: "factor", label: "Pro plan price", value: BASELINE_RAW },
    { claim_kind: "option_refinement", label: MODEL_59 },
    { claim_kind: "option_refinement", label: MODEL_54 },
    // ⭐ THE DEFECT ITSELF: the user's own option is given the FROM value.
    {
      claim_kind: "causal_link",
      label: "user option sets price",
      from_stated: userOptionIndex,
      to_claim: 0,
      effect: "positive",
      sets_to: BASELINE_RAW,
    },
    {
      claim_kind: "causal_link",
      label: "model 59 sets price",
      from_claim: 1,
      to_claim: 0,
      effect: "positive",
      sets_to: 59,
    },
    {
      claim_kind: "causal_link",
      label: "model 54 sets price",
      from_claim: 2,
      to_claim: 0,
      effect: "positive",
      sets_to: 54,
    },
  ];
  if (opts.withGoal) {
    claims.push({
      claim_kind: "causal_link",
      label: "price bears on the goal",
      from_claim: 0,
      to_stated: 0,
      effect: "positive",
    });
  }
  return { stated_items: stated, claims };
}

/** The minted id of the single node carrying this EXACT label. Loud if 0 or 2+. */
function idOf(graph: G, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}
const optionLabels = (graph: G): string[] =>
  graph.nodes
    .filter((n) => n.kind === "option")
    .map((n) => n.label)
    .sort();
const interventionsOf = (graph: G, id: string): Record<string, number> | undefined =>
  graph.nodes.find((n) => n.id === id)?.data?.interventions as Record<string, number> | undefined;
/** The signature the VALIDATOR would compute, via its own exported function. */
const signatureOf = (graph: G, id: string): string | undefined => {
  const i = interventionsOf(graph, id);
  return i === undefined ? undefined : buildInterventionSignature(i);
};

// ────────────────────────────────────────────────────────────────────────────
// THE ACCEPTANCE CONDITION — all three clauses, on Paul's own case, by name.
// ────────────────────────────────────────────────────────────────────────────
describe("Paul's own option is rescued: it carries his stated target and the duplicate is reconciled", () => {
  it("(1) the USER'S OWN option carries 0.59 — his target, not the 0.49 he was starting from", () => {
    const { graph } = projectRecordsToGraph(paulShape({ withGoal: true }));
    const userOption = idOf(graph as G, USER_QUOTE);
    const factor = idOf(graph as G, "Pro plan price");

    expect(interventionsOf(graph as G, userOption)?.[factor]).toBeCloseTo(STATED_TARGET_LEVEL, 10);
    // OPPOSITE-DIRECTION TWIN: it is specifically NOT left on the baseline.
    expect(interventionsOf(graph as G, userOption)?.[factor]).not.toBeCloseTo(BASELINE_LEVEL, 10);
  });

  it("(2) the model's DUPLICATE is reconciled — withdrawn and disclosed against his option", () => {
    const { graph, dropped } = projectRecordsToGraph(paulShape({ withGoal: true }));
    const userOption = idOf(graph as G, USER_QUOTE);

    // The model's copy is gone from the OPTION SET...
    expect(optionLabels(graph as G)).not.toContain(MODEL_59);
    // ...and the genuinely different alternative is untouched.
    expect(optionLabels(graph as G)).toContain(MODEL_54);
    // ...and his own option is the one still standing.
    expect(optionLabels(graph as G)).toContain(USER_QUOTE);

    // DISCLOSED, bound to the claim by INDEX, naming what it duplicated.
    const demote = dropped.find((d) => d.claim_index === 1);
    expect(demote?.reason).toBe("undeveloped_duplicate_of_stated");
    expect(demote?.label).toBe(MODEL_59);
    expect(demote?.duplicate_of).toBe(userOption);
    expect(demote?.duplicate_of_label).toBe(USER_QUOTE);
  });

  it("(3) NO 422 — no two options share a signature, so OPTIONS_IDENTICAL cannot fire", () => {
    const { graph } = projectRecordsToGraph(paulShape({ withGoal: true }));
    const sigs = (graph as G).nodes
      .filter((n) => n.kind === "option")
      .map((n) => signatureOf(graph as G, n.id))
      .filter((s): s is string => s !== undefined);

    // POSITIVE CONTROL: the check can SEE signatures at all, so "no duplicates"
    // is not an absence proved by an instrument that read nothing (trap 13).
    expect(sigs.length).toBeGreaterThan(1);
    expect(new Set(sigs).size).toBe(sigs.length);

    // And the consumer's OWN predicate agrees — read from the validator, never
    // restated here.
    const result = validateGraph({ graph: graph as never });
    const identical = [...result.errors, ...result.warnings].filter(
      (i) => i.code === "OPTIONS_IDENTICAL",
    );
    expect(identical).toHaveLength(0);
  });

  it("the £54 alternative he never mentioned keeps its own distinct number", () => {
    const { graph } = projectRecordsToGraph(paulShape({ withGoal: true }));
    const factor = idOf(graph as G, "Pro plan price");
    expect(interventionsOf(graph as G, idOf(graph as G, MODEL_54))?.[factor]).toBeCloseTo(0.54, 10);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE GATE'S OWN PRECONDITION — pinned, so the repair cannot create a collision
// that nothing resolves.
// ────────────────────────────────────────────────────────────────────────────
describe("where the reconciliation cannot run, the repair declines and today's behaviour stands", () => {
  it("a GOAL-LESS graph is left exactly as it is — no repair, therefore no unresolved collision", () => {
    const { graph } = projectRecordsToGraph(paulShape({ withGoal: false }));
    // Precondition PINNED IN-TEST: this fixture really does reach the gate's
    // early return, so the assertion below is the code's doing and not the
    // fixture failing to produce options at all (trap 13b).
    expect(graph.nodes.some((n) => n.kind === "goal")).toBe(false);
    expect(optionLabels(graph as G).length).toBeGreaterThan(1);

    const userOption = idOf(graph as G, USER_QUOTE);
    const factor = idOf(graph as G, "Pro plan price");
    // Today's outcome: his option is still the no-op it was.
    expect(interventionsOf(graph as G, userOption)?.[factor]).toBeCloseTo(BASELINE_LEVEL, 10);
  });
});
