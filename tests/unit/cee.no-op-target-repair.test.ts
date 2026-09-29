/**
 * OPTION_NO_OP — REPAIR THE WRITER'S NUMBER, DO NOT WITHDRAW THE USER'S OPTION.
 *
 * ## The measured defect (Paul's session, 11 Sep 2026, `olumi-debug-5b41f0eb`)
 *
 * He asked *"should we increase the Pro plan price from £49 to £59 per month
 * with the next Pro feature release?"*. The draft promoted his question to an
 * option node and the model emitted its intervention as **0.49 — the FROM
 * value** against a 0.49 baseline. Two model-INVENTED siblings (£59, £54)
 * carried correct numbers, so the analysis recommended **£54, a price he never
 * mentioned**, and his own question was excluded from the comparison.
 *
 * `OPTION_NO_OP` already DETECTS this and de-configures the option. Detection is
 * correct and stays. But de-configuring still removes the user's own question
 * from their comparison — the harm is smaller than `#1446`'s outright refusal
 * and it is the same harm in kind.
 *
 * ## What this pins: the option carries ITS OWN STATED TARGET
 *
 * The repair runs IMMEDIATELY BEFORE neutralisation and shares its single
 * authority (`findNoOpOptions`), so nothing here is a second detector. An
 * option it repairs is no longer a no-op, so neutralisation skips it; an option
 * it cannot repair falls through to today's behaviour, unchanged.
 *
 * ## ⭐⭐ THE PREDICATE IS STRUCTURAL, NOT LINGUISTIC — and that is the whole
 * design. This estate oscillated FOUR ROUNDS on a hand-written predicate over
 * natural language (CLAUDE.md trap 22f) and the ruling was to stop writing
 * them. So no regex over the label is minted here. CQE — the estate's ratified
 * quantity extractor, whose P11 `from X to Y` rule is itself the product of
 * four documented reviewer rounds — is asked, and only its STRUCTURED output is
 * read: `source`, `operator`, `range_min`, `value`. Every hazard is refused by
 * CQE's own grammar rather than by a preposition list of mine:
 *
 *   · `"Cut costs by £10,000"`            → `operator: "decrement"`, no `range_min`
 *   · `"Move the launch from month 3 to month 6"` → no CQE from-to at all
 *   · `"Raise Price to £59"`              → `range_min: null`
 *
 * ## ⭐⭐ AND THE TARGET IS NEVER GUESSED — IT IS CORROBORATED
 *
 * The repair fires only when CQE's FROM value, put on the factor's frame,
 * equals the level the factor INDEPENDENTLY RECORDS as its current one. Two
 * records written by different producers must agree before either is believed.
 * That single conjunct is what makes the inverted twin safe: `"Cut the price
 * from £59 to £49"` against a factor at £49 has FROM = 59 ≠ 49, so it is
 * REFUSED rather than raised to £59 — the opposite-direction twin of the
 * acceptance case, and the reason no reading of intent is required.
 *
 * ## Binding
 *
 * Every assertion binds by OPTION ID and FACTOR ID, never by a value predicate
 * another option could satisfy (trap 19). The acceptance conditions run through
 * `applyDeterministicEnforcement` — the MOUNTED path — never through the repair
 * module in isolation, so a green result is a claim about the product (trap 3b).
 */

import { describe, it, expect, vi } from "vitest";
import type { EdgeT, GraphT, NodeT } from "../../src/schemas/graph.js";

vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/telemetry.js")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    emit: vi.fn(),
  };
});

vi.mock("../../src/config/index.js", () => ({
  config: { cee: { deterministicEnforcementEnabled: true }, features: {} },
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: vi.fn((code: string, msg: string) => ({ error: { code, message: msg } })),
  isAdminAuthorized: vi.fn(() => false),
}));

import { applyDeterministicEnforcement } from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { gateAnalysableOptions } from "../../src/orchestrator-v5/tools/handlers/analysable-option-gate.js";
import { extractQuantities } from "../../src/orchestrator-v5/context/cqe/extract-quantities.js";

/** The factor baseline in Paul's session, on the model's 0-1 scale. */
const BASELINE = 0.49;
/** The target his own sentence states. */
const STATED_TARGET = 0.59;

interface FixtureOptions {
  readonly label?: string;
  readonly intervention?: number;
  readonly isBaselineNode?: boolean;
  readonly isBaselineData?: boolean;
  readonly observed?: Record<string, unknown>;
  readonly extraFactor?: boolean;
  /**
   * The unit the FACTOR records for itself, on `data` — the surface
   * `FactorData` (`schemas/graph.ts:160`) declares it on. Left absent by
   * default because Paul's measured graph records none, which is exactly why
   * the unit conjunct had to be bounded to "both sides state one".
   */
  readonly factorUnit?: string;
  /** The factor's own label, for cases where the quantity it names matters. */
  readonly factorLabel?: string;
}

/**
 * Paul's measured graph shape (`olumi-debug-5b41f0eb-20260911.json`), the same
 * fixture `cee.option-no-op-neutralisation.test.ts` pins the consequence on.
 * Every other validator tier is satisfied, so a failure here is about the
 * repair and never about a malformed fixture.
 */
function paulsGraph(opts: FixtureOptions = {}): GraphT {
  const label = opts.label ?? "increase the Pro plan price from £49 to £59 per month";
  const noop: Record<string, unknown> = {
    id: "opt_noop",
    kind: "option",
    data: { interventions: { fac_price: opts.intervention ?? BASELINE } },
  };
  if (label !== "") noop.label = label;
  if (opts.isBaselineNode !== undefined) noop.is_baseline = opts.isBaselineNode;
  if (opts.isBaselineData !== undefined) {
    (noop.data as Record<string, unknown>).is_baseline = opts.isBaselineData;
  }
  if (opts.extraFactor === true) {
    (noop.data as { interventions: Record<string, number> }).interventions.fac_twin = BASELINE;
  }

  const nodes: Record<string, unknown>[] = [
    { id: "decision_1", kind: "decision", label: "Which option?" },
    noop,
    // ⚠ DELIBERATELY £54, NOT £59. A sibling already carrying the repaired
    // target would collide on `buildInterventionSignature` and re-open
    // `OPTIONS_IDENTICAL` — measured below as its own pinned case.
    {
      id: "opt_54",
      kind: "option",
      label: "Raise Price to £54 (Soft Increase)",
      data: { interventions: { fac_price: 0.54 } },
    },
    {
      id: "fac_price",
      kind: "factor",
      label: opts.factorLabel ?? "Pro Plan Monthly Price",
      category: "controllable",
      observed_state: opts.observed ?? { value: BASELINE, raw_value: 49 },
      data: {
        ...(opts.observed ?? { value: BASELINE, raw_value: 49 }),
        ...(opts.factorUnit === undefined ? {} : { unit: opts.factorUnit }),
        extractionType: "explicit",
        factor_type: "price",
        uncertainty_drivers: ["churn response"],
      },
    },
    { id: "outcome_1", kind: "outcome", label: "MRR" },
    { id: "goal_1", kind: "goal", label: "£20k MRR" },
  ];

  const edges: Record<string, unknown>[] = [
    { from: "decision_1", to: "opt_noop", strength_mean: 1, belief_exists: 1 },
    { from: "decision_1", to: "opt_54", strength_mean: 1, belief_exists: 1 },
    { from: "opt_noop", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { from: "opt_54", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { from: "fac_price", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
    { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
  ];

  if (opts.extraFactor === true) {
    nodes.splice(4, 0, {
      id: "fac_twin",
      kind: "factor",
      label: "Legacy Plan Monthly Price",
      category: "controllable",
      observed_state: { value: BASELINE, raw_value: 49 },
      data: {
        value: BASELINE,
        raw_value: 49,
        extractionType: "explicit",
        factor_type: "price",
        uncertainty_drivers: ["churn response"],
      },
    });
    edges.push(
      { from: "opt_noop", to: "fac_twin", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_twin", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
    );
  }

  return {
    version: "1",
    default_seed: 17,
    nodes: nodes as NodeT[],
    edges: edges as EdgeT[],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  } as GraphT;
}

function makeCtx(graph: GraphT): Record<string, unknown> {
  return { graph, requestId: "req-noop-repair-test", detectedEdgeFormat: "V1_FLAT" };
}

function enforced(opts: FixtureOptions = {}): GraphT {
  const ctx = makeCtx(paulsGraph(opts));
  applyDeterministicEnforcement(ctx as never);
  return ctx.graph as GraphT;
}

function node(graph: GraphT, id: string): NodeT {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`fixture has no node ${id}`);
  return found as NodeT;
}

function interventionsOf(graph: GraphT, id: string): Record<string, number> | undefined {
  return (node(graph, id).data as { interventions?: Record<string, number> } | undefined)?.interventions;
}

// ───────────────────────────────────────────────────────────────────────────
// THE ACCEPTANCE CONDITION — Paul's own option carries his own stated target
// ───────────────────────────────────────────────────────────────────────────

describe("OPTION_NO_OP repair — the user's own option carries its own stated target", () => {
  it("writes the TO value (0.59), not the FROM value (0.49), on fac_price", () => {
    const graph = enforced();
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(STATED_TARGET, 10);
  });

  it("does NOT de-configure the repaired option — it keeps an intervention map", () => {
    const graph = enforced();
    expect(interventionsOf(graph, "opt_noop")).toBeDefined();
  });

  it("the repaired option is SUBMITTED to PLoT, so it can be compared and can win", () => {
    const graph = enforced();
    const options = (graph.nodes as NodeT[])
      .filter((n) => n.kind === "option")
      .map((n) => ({
        option_id: n.id,
        label: (n as { label?: string }).label ?? null,
        interventions: (n.data as { interventions?: unknown } | undefined)?.interventions ?? {},
      }));
    const gate = gateAnalysableOptions({ options, graph, rawPersistedGraph: graph, scaleNetEnabled: true } as never);
    expect(gate.excluded.map((e) => e.option_id)).not.toContain("opt_noop");
    expect(gate.options.map((o) => (o as { option_id: string }).option_id)).toContain("opt_noop");
  });

  it("does not set earlyReturn: the user ends the turn holding a graph", () => {
    const ctx = makeCtx(paulsGraph());
    applyDeterministicEnforcement(ctx as never);
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("leaves the already-correct sibling option untouched", () => {
    const graph = enforced();
    expect(interventionsOf(graph, "opt_54")?.fac_price).toBeCloseTo(0.54, 10);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE BASELINE EXEMPTION — bound by IDENTITY, never by a value predicate
// ───────────────────────────────────────────────────────────────────────────

describe("status-quo options are exempt, by identity", () => {
  it("node-level is_baseline: true is NOT repaired", () => {
    const graph = enforced({ isBaselineNode: true });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(BASELINE, 10);
  });

  it("data-level is_baseline: true is NOT repaired", () => {
    const graph = enforced({ isBaselineData: true });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(BASELINE, 10);
  });

  it("the SPLIT surface (node true, data false) is NOT repaired — explicit true wins", () => {
    const graph = enforced({ isBaselineNode: true, isBaselineData: false });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(BASELINE, 10);
  });

  it("OPPOSITE-DIRECTION TWIN: an explicit is_baseline:false IS repaired", () => {
    const graph = enforced({ isBaselineNode: false });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(STATED_TARGET, 10);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// SCALE CONVENTIONS — one shared frame authority, three producer conventions
// ───────────────────────────────────────────────────────────────────────────

describe("the stated target lands on the factor's own frame", () => {
  it("capped/framed currency: {value 0.49, raw_value 49} → 0.59", () => {
    const graph = enforced({ observed: { value: BASELINE, raw_value: 49 } });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.59, 10);
  });

  it("unframed fractional percent: {value 0.85} with 'from 85% to 95%' → 0.95", () => {
    const graph = enforced({
      label: "raise the margin from 85% to 95%",
      intervention: 0.85,
      observed: { value: 0.85 },
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.95, 10);
  });

  it("framed count: {value 0.4, raw_value 40} with 'from 40 to 80' → 0.8", () => {
    const graph = enforced({
      label: "grow the headcount from 40 to 80",
      intervention: 0.4,
      observed: { value: 0.4, raw_value: 40 },
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.8, 10);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ⭐⭐ WHAT MUST AGREE IS A QUANTITY, NOT A MAGNITUDE
// ───────────────────────────────────────────────────────────────────────────

/**
 * Corroborating the MAGNITUDE alone binds the write to a bare number, so a
 * label about an entirely DIFFERENT quantity that happens to share the factor's
 * digits was written through silently. Both cases below were measured on the
 * mounted path before the unit conjunct existed, and both wrote a number:
 *
 *   · `"move the deadline from 49 days to 59 days"` wrote **0.59** onto
 *     "Pro Plan Monthly Price" (`unit: "£"`), which sits at 49;
 *   · `"extend the free trial from 14 to 30 days"` wrote **0.30** onto
 *     "Trial-to-paid conversion rate" (`unit: "%"`), which sits at 14.
 *
 * De-configuring an option is a VISIBLE omission. These are SILENT wrongness —
 * the same harm class this module exists to end — so the corroboration is a
 * claim about a QUANTITY: a magnitude AND its unit.
 *
 * ⚠ THE TESTS BELOW ARE A DISCRIMINATING SET, NOT A LIST (trap 19). Each
 * refusal is paired with a case sharing its LABEL, its FACTOR and its
 * MAGNITUDES, differing only in the recorded units. Without the pair a refusal
 * proves only that something declined; with it, the decline is provably caused
 * by the unit disagreement and not by some other conjunct quietly refusing the
 * whole class.
 */
describe("the corroboration binds a QUANTITY, not a bare magnitude", () => {
  it("REFUSES 'from 49 days to 59 days' against a factor recording £", () => {
    const graph = enforced({
      label: "move the deadline from 49 days to 59 days",
      factorUnit: "£",
    });
    expect(interventionsOf(graph, "opt_noop")).toBeUndefined();
  });

  it("REFUSES 'from 14 to 30 days' against a rate recording %", () => {
    const graph = enforced({
      label: "extend the free trial from 14 to 30 days",
      factorLabel: "Trial-to-paid conversion rate",
      factorUnit: "%",
      intervention: 0.14,
      observed: { value: 0.14, raw_value: 14 },
    });
    expect(interventionsOf(graph, "opt_noop")).toBeUndefined();
  });

  /**
   * ⭐ THE DISCRIMINATOR. Same label, same factor, same magnitudes as the
   * first refusal — only the factor's recorded unit is removed. It IS repaired,
   * which proves the refusal above is the unit conjunct's doing and that the
   * conjunct has not swallowed the class.
   */
  it("ADMITS that same label and factor once the factor records NO unit", () => {
    const graph = enforced({ label: "move the deadline from 49 days to 59 days" });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.59, 10);
  });

  it("the SAME rate case is ADMITTED once the % is removed", () => {
    const graph = enforced({
      label: "extend the free trial from 14 to 30 days",
      factorLabel: "Trial-to-paid conversion rate",
      intervention: 0.14,
      observed: { value: 0.14, raw_value: 14 },
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.3, 10);
  });

  it("⭐ THE ACCEPTANCE CASE IS UNTOUCHED when both sides DO state a unit", () => {
    const graph = enforced({ factorUnit: "£" });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(STATED_TARGET, 10);
  });

  it("a factor unit with no CQE unit is silence, not disagreement — still repaired", () => {
    const graph = enforced({
      label: "grow the headcount from 40 to 80",
      intervention: 0.4,
      observed: { value: 0.4, raw_value: 40 },
      factorUnit: "users",
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.8, 10);
  });

  it("the unit bridge spans BOTH vocabularies: CQE 'percentage' vs factor '%'", () => {
    const graph = enforced({
      label: "raise the margin from 85% to 95%",
      intervention: 0.85,
      observed: { value: 0.85 },
      factorUnit: "%",
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.95, 10);
  });
});

/**
 * ⚠⚠ DECLARED KNOWN-ADMITTED SET — recorded so the next session inherits a
 * KNOWN gap rather than an unnoticed one (CLAUDE.md trap 22f).
 *
 * `unitsAreCompatible` (`factor-extraction/merge.ts:203`) is the estate's
 * single exported authority for "are these two units the same kind of
 * quantity", and it is LENIENT BY DESIGN: its `currency` group holds every
 * currency and its `time` group holds every duration. Both cases below
 * therefore still reach the write.
 *
 * They are NOT closed here, and that is a deliberate boundary rather than an
 * oversight: tightening either means minting a private unit map inside this
 * module — the exact duplication the conjunct was written to avoid (trap 12) —
 * and `unitsAreCompatible`'s grouping is depended on by its own callers, so
 * narrowing it is its owner's ruling, not this module's.
 *
 * Both remain strictly narrower than the class the conjunct closes: each still
 * requires the magnitudes to corroborate the factor's recorded level.
 */
describe("KNOWN-ADMITTED: the borrowed unit authority is lenient within a group", () => {
  it("cross-CURRENCY is admitted — CQE 'USD' against a factor recording £", () => {
    const graph = enforced({
      label: "increase the Pro plan price from $49 to $59 per month",
      factorUnit: "£",
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(STATED_TARGET, 10);
  });

  it("cross-DURATION is admitted — CQE 'day' against a factor recording month", () => {
    const graph = enforced({
      label: "move the deadline from 49 days to 59 days",
      factorUnit: "month",
    });
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(0.59, 10);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE DECLARED GAP, PINNED EXACTLY — RED if the set GROWS or SHRINKS
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every label is a no-op option on a factor sitting at £49 (level 0.49). The
 * partition below is the WHOLE claim this change makes about labels: the first
 * list is repaired, the second is left to today's neutralisation. A label that
 * moves between them — in either direction — REDs here.
 *
 * Written as an exact partition rather than two independent lists precisely so
 * the suite cannot stay green by silently widening (CLAUDE.md trap 22f's
 * known-dropped-set rule).
 */
const LABEL_CORPUS: readonly string[] = [
  // — admitted: an explicit from-to whose FROM corroborates the factor —
  "increase the Pro plan price from £49 to £59 per month",
  "should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?",
  "Increase the Pro plan price from £49 to £59",
  // — admitted: NEITHER record states a unit, so the unit conjunct is skipped —
  // CQE returns `unit: null` for bare numerals (probed; the `£` members above
  // return `"GBP"`), and this fixture's factor records no `unit` at all. The
  // conjunct fires only where BOTH sides state one, so this is the class it
  // deliberately ADMITS. Pinned here so that class cannot be tightened in
  // silence (trap 22b: a corpus that watches only one door).
  "increase the Pro plan price from 49 to 59",
  // — refused: CQE reports no from-to —
  "Raise Price to £59 at Feature Launch",          // bare `to`: range_min is null
  "Cut costs by £10,000",                          // delta: operator decrement
  "Maintain £49 Price",                            // a bare magnitude, no operator
  "Move the launch from month 3 to month 6",       // not a CQE from-to (compromise fallback)
  // — refused: the FROM does not corroborate the factor's current level —
  "Cut the price from £59 to £49",                 // INVERTED TWIN of the acceptance case
  "grow headcount from 40 to 80",                  // a from-to about a different quantity
  // — refused: ambiguous, two from-tos in one label —
  "increase price from £49 to £59 and headcount from 40 to 50",
  // — refused: a from-to plus a trailing alternative (CQE returns two) —
  "increase the Pro plan price from £49 to £59 or £64",
  // — refused: a RANGE, not a transition (CQE: comparator `between`, value null) —
  "hold the Pro plan price between £49 and £59",
  // — refused: an English from-to CQE does not merge (two loose quantities) —
  "take the Pro plan price from £49 up to £59",
  // — refused: word-numbers are not merged into a from-to (CQE returns none) —
  "increase the price from forty nine pounds to fifty nine pounds",
  // — refused: the stated target leaves the unit interval on this factor's frame —
  "increase the Pro plan price from £49 to £159",
  // — refused: no label to read —
  "",
];

const EXPECTED_REPAIRED: readonly string[] = [
  "Increase the Pro plan price from £49 to £59",
  "increase the Pro plan price from 49 to 59",
  "increase the Pro plan price from £49 to £59 per month",
  "should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?",
];

describe("the repairable set is EXACTLY this, and the rest keeps today's behaviour", () => {
  it("partitions the corpus exactly — RED if the set grows OR shrinks", () => {
    const repaired: string[] = [];
    const untouched: string[] = [];
    for (const label of LABEL_CORPUS) {
      const graph = enforced({ label });
      const value = interventionsOf(graph, "opt_noop")?.fac_price;
      if (value !== undefined && Math.abs(value - BASELINE) > 5e-5) repaired.push(label);
      else untouched.push(label);
    }
    expect(repaired.slice().sort()).toEqual(EXPECTED_REPAIRED.slice().sort());
    expect(untouched.slice().sort()).toEqual(
      LABEL_CORPUS.filter((l) => !EXPECTED_REPAIRED.includes(l)).slice().sort(),
    );
  });

  it("every label the repair declines is still NEUTRALISED — today's behaviour is intact", () => {
    for (const label of LABEL_CORPUS.filter((l) => !EXPECTED_REPAIRED.includes(l))) {
      const graph = enforced({ label });
      expect(
        interventionsOf(graph, "opt_noop"),
        `"${label}" must fall through to neutralisation`,
      ).toBeUndefined();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// AMBIGUOUS BINDING — two factors both corroborate, so neither is chosen
// ───────────────────────────────────────────────────────────────────────────

describe("an ambiguous factor binding refuses rather than guesses", () => {
  it("two factors both sitting at £49 leave the option unrepaired and neutralised", () => {
    const graph = enforced({ extraFactor: true });
    expect(interventionsOf(graph, "opt_noop")).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE DECLARED LIMITATION, PINNED — Paul's MEASURED graph is NOT rescued
// ───────────────────────────────────────────────────────────────────────────

/**
 * His session drafted THREE options against one factor: his own question at
 * 0.49, and two model inventions at 0.59 and 0.54. Repairing his option to its
 * stated 0.59 gives it the SAME `buildInterventionSignature` as the invented
 * £59 sibling, which re-opens `OPTIONS_IDENTICAL` — `severity: "error"`
 * (`graph-validator.ts:981`) — at the post-enforcement re-validation that runs
 * directly after this stage.
 *
 * ⚠ THIS IS MEASURED, NOT REASONED. With the collision guard disabled,
 * `applyDeterministicEnforcement` returns `earlyReturn: {statusCode: 422}` on
 * this exact fixture: the whole DRAFT dies. That is `#1446`'s harm and it is
 * strictly worse than the de-configuring it would replace, so the repair
 * DECLINES here and the option keeps today's outcome.
 *
 * The residual is real and is NOT closed by this change: where the model
 * invented a sibling already carrying the user's stated target, the user's own
 * question is still de-configured. Closing it requires a ruling on which of two
 * colliding options survives — `options-identical-graceful-dedup.ts`'s Guard 3b
 * deliberately DECLINES to drop a differently-labelled duplicate — and that is
 * a different owner's decision, not this module's.
 */
function paulsMeasuredGraph(): GraphT {
  const graph = paulsGraph();
  (graph.nodes as NodeT[]).push({
    id: "opt_59",
    kind: "option",
    label: "Raise Price to £59 at Feature Launch",
    data: { interventions: { fac_price: 0.59 } },
  } as NodeT);
  (graph.edges as Record<string, unknown>[]).push(
    { from: "decision_1", to: "opt_59", strength_mean: 1, belief_exists: 1 },
    { from: "opt_59", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
  );
  return graph;
}

describe("a repair that would re-open OPTIONS_IDENTICAL is declined", () => {
  it("⭐ THE DRAFT SURVIVES — no 422, which is the whole point of declining", () => {
    const ctx = makeCtx(paulsMeasuredGraph());
    applyDeterministicEnforcement(ctx as never);
    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("the user's option keeps TODAY's outcome (de-configured), never a worse one", () => {
    const ctx = makeCtx(paulsMeasuredGraph());
    applyDeterministicEnforcement(ctx as never);
    expect(interventionsOf(ctx.graph as GraphT, "opt_noop")).toBeUndefined();
  });

  it("the colliding sibling is untouched — nothing else is withdrawn to make room", () => {
    const ctx = makeCtx(paulsMeasuredGraph());
    applyDeterministicEnforcement(ctx as never);
    expect(interventionsOf(ctx.graph as GraphT, "opt_59")?.fac_price).toBeCloseTo(0.59, 10);
  });

  /**
   * ⭐ THE DISCRIMINATING PAIR (trap 19). One case alone proves nothing: the
   * first shows the guard DECLINES, the second shows the very same label,
   * factor and value ARE repaired once the collision is removed. Together they
   * prove the decline is caused by the COLLISION and not by some other conjunct
   * silently refusing the whole class.
   */
  it("the SAME option IS repaired once the colliding sibling is gone", () => {
    const graph = enforced();
    expect(interventionsOf(graph, "opt_noop")?.fac_price).toBeCloseTo(STATED_TARGET, 10);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE ASSUMPTION THE PREDICATE RESTS ON, PINNED AT ITS SOURCE
// ───────────────────────────────────────────────────────────────────────────

/**
 * `readStatedTransition` asks CQE four questions — `source`, `operator`, a
 * finite `range_min`, a finite `value` — and a mutation kit found THREE of
 * those conjuncts currently redundant: removing the `source` gate, the
 * `operator` gate, or the empty-label gate left all 19 tests GREEN.
 *
 * An equivalent mutant must be DEMONSTRATED, never asserted (trap 13c), so
 * each was settled by enumerating the producers at the bytes rather than by
 * noting that a corpus failed to find one:
 *
 *   · `range_min` is emitted finite at exactly THREE sites in `cqe/rules.ts`
 *     — P1 (`:338`) and P2 (`:389`), both `comparator: "between"` and both
 *     passing NO `value` (measured null), and P11 (`:1028`), which hardcodes
 *     `operator: 'set'`. So no result can carry a finite `range_min`, a finite
 *     `value` AND a non-`set` operator.
 *   · `compromise-backstop.ts:143,145` sets `operator: null` and
 *     `range_min: null` UNCONDITIONALLY, so a `source: "compromise"` result
 *     can never pass either of the other gates.
 *   · `extractQuantities` returns zero results for `""`, `"   "` and
 *     `"\t\n "` (measured), so the emptiness gate is subsumed by the
 *     single-result requirement.
 *
 * The redundant conjuncts STAY — they fail closed, they are free, and CQE is
 * a module this one does not own. What must not stay is an UNRECORDED
 * assumption: these tests pin the derivation itself, so a CQE change that
 * makes any conjunct load-bearing REDs here and tells the next session that
 * the redundancy moved, instead of silently widening what gets repaired.
 */
describe("the CQE invariants the repair's redundant conjuncts rest on", () => {
  it("a finite range_min always arrives with operator 'set' AND a finite value", () => {
    const probes = [
      "increase the price from £49 to £59",
      "grow headcount from 40 to 80",
      "raise margin from 85% to 95%",
      "from 200k to 150k",
      "hold the price between £49 and £59",
      "keep headcount between 40 and 80",
      "a price of 49-59",
      "Cut costs by £10,000",
      "Raise Price to £59",
      "double the price from £49",
    ];
    let corroboratedShapeSeen = 0;
    for (const text of probes) {
      for (const q of extractQuantities(text)) {
        if (typeof q.range_min === "number" && Number.isFinite(q.range_min)
          && typeof q.value === "number" && Number.isFinite(q.value)) {
          corroboratedShapeSeen += 1;
          expect(q.operator, `"${text}" carries a finite range_min and value`).toBe("set");
        }
      }
    }
    // ⚠⚠ POSITIVE CONTROL, AND THIS TEST IS THE ONE THAT MOST NEEDED ONE: it
    // pins the LOAD-BEARING conjunct of the three, and its only assertion sits
    // inside a conditional. Measured without this line, the test ran ZERO
    // assertions and still passed GREEN — a shape that survives CQE simply
    // ceasing to emit the finite-`range_min` + finite-`value` pair at all,
    // which is precisely the change it exists to catch (trap 13: an absence
    // assertion that never observed a presence).
    //
    // Pinned to the EXACT measured count, not merely to non-zero, matching this
    // file's partition discipline: exactly FOUR of the ten probes carry the
    // shape (the four from-tos), and a CQE change that adds or removes one REDs
    // here and tells the next session the redundancy moved.
    expect(corroboratedShapeSeen, "probes carrying a finite range_min AND value").toBe(4);
  });

  it("a `compromise` result never carries an operator or a range_min", () => {
    const probes = [
      "Move the launch from month 3 to month 6",
      "set the price 49 to 59",
      "we have 5 engineers and 3 designers",
    ];
    let compromiseSeen = 0;
    for (const text of probes) {
      for (const q of extractQuantities(text)) {
        if (q.source !== "compromise") continue;
        compromiseSeen += 1;
        expect(q.operator, `"${text}"`).toBeNull();
        expect(q.range_min, `"${text}"`).toBeNull();
      }
    }
    // ⚠ POSITIVE CONTROL. Without it this test passes by seeing no compromise
    // result at all — an absence assertion that never observed a presence
    // (trap 13). The probes above are chosen to produce them.
    expect(compromiseSeen).toBeGreaterThan(0);
  });

  it("an empty or whitespace label yields no quantities at all", () => {
    for (const text of ["", "   ", "\t\n "]) {
      expect(extractQuantities(text), JSON.stringify(text)).toHaveLength(0);
    }
    // POSITIVE CONTROL: the same call CAN return something, so the three zeros
    // above are about the inputs and not about a broken probe.
    expect(extractQuantities("from £49 to £59").length).toBe(1);
  });
});
