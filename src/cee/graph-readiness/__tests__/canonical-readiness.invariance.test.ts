/**
 * ⭐ THE SYNTHESIS-INVARIANCE PIN.
 *
 * `canonical-readiness.ts` normalises the route's flat edge wire format into
 * `EdgeV3`, which requires `strength.std`, `exists_probability` and
 * `effect_direction`. The route's format does not carry them, so the adapter
 * SYNTHESISES them. That is only honest if those values cannot move the
 * admission answer — otherwise the adapter is inventing evidence and then
 * grading the model on it.
 *
 * The adapter's header comment has cited THIS FILE as the standing proof of
 * that since the module was written. It did not exist: the invariance was
 * demonstrated once by a build-time mutant and never pinned, so the citation
 * was guarantee theatre — a sentence that reads as a guarantee with nothing
 * executing behind it. This file makes the citation true.
 *
 * ⭐ THE PROPERTY, IN THE INPUT SPACE (deliberately, and it is the stronger
 * form): rather than reaching into the module to swap its two constants, each
 * corpus graph is assessed TWICE-OVER —
 *
 *   BASELINE  edges carry NONE of the canonical fields, so the adapter
 *             synthesises all three (this is the real wire shape);
 *   VARIANT   edges carry EXPLICIT values at a sweep point, so the adapter
 *             synthesises nothing and the assessor sees that exact value.
 *
 * Asserting baseline ≡ variant at every sweep point says something strictly
 * stronger than "the current constants are inert": it says NO choice the
 * synthesis could make — including the two constants, including values a user
 * could genuinely send — can change admission. A refactor that swaps the
 * constants is covered without this file knowing the constants exist.
 *
 * SWEEP: std ∈ {0.01, 0.1, 0.5} × exists_probability ∈ {0, 0.5, 1} ×
 * effect_direction ∈ {positive, negative} = 18 points, over a 5-graph corpus.
 * `exists_probability` 0 vs 1 is in the grid on purpose: "this edge certainly
 * does not exist" vs "this edge certainly does" is exactly the choice that
 * COULD plausibly move a verdict, so the invariance is doing work rather than
 * holding vacuously.
 *
 * ⚠ WHAT KEEPS THIS FROM BEING A COMPARATOR AGREEING WITH ITSELF (trap 13):
 *   · every corpus entry PINS ITS OWN BASELINE by identity before any sweep
 *     runs, so a fixture that silently stopped reaching the behaviour REDs
 *     instead of making the invariance trivially true;
 *   · the corpus is asserted to admit BOTH WAYS and to contain no
 *     SCHEMA_INVALID — a corpus that uniformly fails to parse would satisfy
 *     every invariance assertion here while proving nothing (that uniform
 *     answer is the exact tell the adapter's own header records);
 *   · a NEGATIVE CONTROL changes a REAL, non-synthesised input and asserts the
 *     comparator SEES it. An invariance probe that cannot observe a difference
 *     is not evidence of invariance.
 *
 * If this file REDs, the adapter is fabricating. It is a hard stop, not a
 * flake.
 */

import { describe, it, expect } from "vitest";
import {
  assessRouteAdmission,
  type RouteAdmissionVerdict,
} from "../canonical-readiness.js";

// ============================================================================
// The sweep grid — the values the synthesis could conceivably choose.
// ============================================================================

const STD_SWEEP = [0.01, 0.1, 0.5] as const;
const EXISTS_PROBABILITY_SWEEP = [0, 0.5, 1] as const;
const EFFECT_DIRECTION_SWEEP = ["positive", "negative"] as const;

interface SweepPoint {
  readonly std: number;
  readonly existsProbability: number;
  readonly effectDirection: "positive" | "negative";
}

const SWEEP_POINTS: SweepPoint[] = STD_SWEEP.flatMap((std) =>
  EXISTS_PROBABILITY_SWEEP.flatMap((existsProbability) =>
    EFFECT_DIRECTION_SWEEP.map((effectDirection) => ({
      std,
      existsProbability,
      effectDirection,
    })),
  ),
);

const sweepLabel = (p: SweepPoint) =>
  `std=${p.std} exists_probability=${p.existsProbability} ${p.effectDirection}`;

// ============================================================================
// Edge projections.
// ============================================================================

type EdgeFactory = (id: string, from: string, to: string) => Record<string, unknown>;

/**
 * The BASELINE projection: none of the canonical fields present, so the
 * adapter must synthesise every one of them. This is the shape the route
 * actually has to cope with.
 */
const synthesisedEdge: EdgeFactory = (id, from, to) => ({ id, from, to });

/**
 * A sweep point supplied EXPLICITLY on the wire. `strength_mean` is
 * deliberately omitted from BOTH projections so that the magnitude is held
 * constant at its default across the whole grid and the only thing varying is
 * the swept dimension.
 */
const explicitEdge =
  (point: SweepPoint): EdgeFactory =>
  (id, from, to) => ({
    id,
    from,
    to,
    strength_std: point.std,
    exists_probability: point.existsProbability,
    effect_direction: point.effectDirection,
  });

/** A never-swept, already-canonical edge, for the mixed-format corpus entry. */
const fixedCanonicalEdge: EdgeFactory = (id, from, to) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.2 },
  exists_probability: 0.9,
  effect_direction: "positive" as const,
});

// ============================================================================
// The corpus.
// ============================================================================

function baseNodes() {
  return [
    { id: "goal", kind: "goal", label: "Increase revenue" },
    { id: "decision", kind: "decision", label: "Pricing" },
    {
      id: "fac_price",
      kind: "factor",
      label: "Price",
      category: "controllable",
      prior: { distribution: "uniform", range_min: 10, range_max: 30 },
    },
  ];
}

/** Healthy: both options carry their effect values. Admits. */
function configuredGraph(edge: EdgeFactory) {
  return {
    version: "1",
    nodes: [
      ...baseNodes(),
      { id: "opt_a", kind: "option", label: "Premium", interventions: { fac_price: 0.9 } },
      { id: "opt_c", kind: "option", label: "Value", interventions: { fac_price: 0.4 } },
    ],
    edges: [
      edge("e1", "decision", "opt_a"),
      edge("e5", "decision", "opt_c"),
      edge("e3", "opt_a", "fac_price"),
      edge("e6", "opt_c", "fac_price"),
      edge("e7", "fac_price", "goal"),
    ],
  };
}

/** One option left unconfigured. Blocked, and the blocker names it. */
function oneUnconfiguredGraph(edge: EdgeFactory) {
  const g = configuredGraph(edge);
  return {
    ...g,
    nodes: [...g.nodes, { id: "opt_b", kind: "option", label: "Unconfigured" }],
    edges: [...g.edges, edge("e2", "decision", "opt_b"), edge("e4", "opt_b", "fac_price")],
  };
}

/** No goal node at all. Blocked on structure rather than on option values. */
function goallessGraph(edge: EdgeFactory) {
  const g = configuredGraph(edge);
  return {
    ...g,
    nodes: g.nodes.filter((n) => (n as { kind?: string }).kind !== "goal"),
    edges: g.edges.filter((e) => (e as { to?: string }).to !== "goal"),
  };
}

/**
 * Multi-edge, MIXED formats: two edges arrive already canonical and are never
 * swept; the other three arrive bare and are. This is the case the adapter was
 * actually written for — a graph where synthesis applies to SOME edges only.
 */
function mixedEdgeFieldsGraph(edge: EdgeFactory) {
  const g = configuredGraph(edge);
  return {
    ...g,
    edges: [
      fixedCanonicalEdge("e1", "decision", "opt_a"),
      fixedCanonicalEdge("e5", "decision", "opt_c"),
      edge("e3", "opt_a", "fac_price"),
      edge("e6", "opt_c", "fac_price"),
      edge("e7", "fac_price", "goal"),
    ],
  };
}

/** Options that cannot be told apart. Admits, but carries a critique. */
function identicalOptionsGraph(edge: EdgeFactory) {
  const g = configuredGraph(edge);
  return {
    ...g,
    nodes: g.nodes.map((n) =>
      (n as { kind?: string }).kind === "option"
        ? { ...n, interventions: { fac_price: 0.5 } }
        : n,
    ),
  };
}

/**
 * A corpus entry pins its OWN baseline. These expectations were derived by
 * execution at `2988eacf`, not assumed — and they are what stops this file
 * from comparing two identical nothings.
 */
interface CorpusEntry {
  readonly name: string;
  readonly build: (edge: EdgeFactory) => unknown;
  readonly expectedCanRun: boolean;
  /** FULL set, by identity: `code|option_id|factor_id`. Not a count. */
  readonly expectedBlockerIdentities: readonly string[];
}

const CORPUS: readonly CorpusEntry[] = [
  {
    name: "fully-configured model (admits)",
    build: configuredGraph,
    expectedCanRun: true,
    expectedBlockerIdentities: [],
  },
  {
    name: "one unconfigured option (blocked, blocker named by identity)",
    build: oneUnconfiguredGraph,
    expectedCanRun: false,
    expectedBlockerIdentities: ["MISSING_OPTION_VALUE|opt_b|fac_price"],
  },
  {
    name: "goal-less model (blocked on structure)",
    build: goallessGraph,
    expectedCanRun: false,
    expectedBlockerIdentities: ["NO_GOAL||"],
  },
  {
    name: "multi-edge model mixing explicit and absent edge fields (admits)",
    build: mixedEdgeFieldsGraph,
    expectedCanRun: true,
    expectedBlockerIdentities: [],
  },
  {
    name: "options with identical interventions (admits, critiqued)",
    build: identicalOptionsGraph,
    expectedCanRun: true,
    expectedBlockerIdentities: [],
  },
];

// ============================================================================
// Identity projection — blockers compared BY IDENTITY, never by count.
// ============================================================================

/**
 * `code · option_id · factor_id` — the triple the UI's draft-missing-values
 * affordance acts on. A count ("1 blocker") would let a verdict blaming a
 * DIFFERENT option pass this file, which is the whole failure mode trap 19
 * names.
 */
function blockerIdentities(verdict: RouteAdmissionVerdict): string[] {
  return verdict.readiness_issues.map(
    (issue) => `${issue.code}|${issue.option_id ?? ""}|${issue.factor_id ?? ""}`,
  );
}

// ============================================================================
// THE PIN.
// ============================================================================

describe("canonical-readiness — admission is INVARIANT under the synthesised edge parameters", () => {
  describe.each(CORPUS)("$name", (entry) => {
    // ------------------------------------------------------------------
    // PRECONDITION PIN (trap 13b). Run before any sweep comparison: it
    // proves this fixture still reaches the behaviour the sweep is about.
    // Without it, a fixture that drifted into SCHEMA_INVALID would make
    // every comparison below pass while asserting nothing.
    // ------------------------------------------------------------------
    it("baseline (all edge parameters synthesised) reaches its pinned verdict", () => {
      const baseline = assessRouteAdmission(entry.build(synthesisedEdge));

      expect(baseline.can_run_analysis).toBe(entry.expectedCanRun);
      expect(blockerIdentities(baseline)).toEqual([...entry.expectedBlockerIdentities]);
      // The uniform-failure tell the adapter's own header records: if the
      // normalisation ever stops working, EVERY graph returns this one code
      // and the invariance below becomes trivially true.
      expect(blockerIdentities(baseline).some((id) => id.startsWith("SCHEMA_INVALID"))).toBe(
        false,
      );
    });

    it.each(SWEEP_POINTS.map((p) => ({ p, label: sweepLabel(p) })))(
      "same verdict and same blocker set when the wire carries $label",
      ({ p }) => {
        const baseline = assessRouteAdmission(entry.build(synthesisedEdge));
        const variant = assessRouteAdmission(entry.build(explicitEdge(p)));

        // The property Paul specified: the verdict, and every blocker entry
        // by identity as a FULL SET.
        expect(variant.can_run_analysis).toBe(baseline.can_run_analysis);
        expect(blockerIdentities(variant)).toEqual(blockerIdentities(baseline));

        // Superset guard: nothing else on the admission surface moves either
        // (options_ready/total, goal_node_valid, critiques, scaffold_plan,
        // blocker_reason, messages).
        expect(variant).toEqual(baseline);
      },
    );
  });

  // ==========================================================================
  // ANTI-VACUITY. An invariance suite over a corpus that answers the same way
  // everywhere proves nothing about the assessor's sensitivity.
  // ==========================================================================
  it("sweeps the declared grid: 3 std × 3 exists_probability × 2 directions = 18 points", () => {
    expect(SWEEP_POINTS).toHaveLength(18);
    expect(new Set(SWEEP_POINTS.map(sweepLabel)).size).toBe(18);
  });

  it("the corpus admits BOTH ways, so invariance is not agreement with a constant", () => {
    const verdicts = CORPUS.map((e) => assessRouteAdmission(e.build(synthesisedEdge)));

    expect(verdicts.some((v) => v.can_run_analysis)).toBe(true);
    expect(verdicts.some((v) => !v.can_run_analysis)).toBe(true);
    // Every refusal is actionable — a corpus of empty refusals would let the
    // blocker-identity comparison above compare two empty arrays.
    for (const v of verdicts.filter((x) => !x.can_run_analysis)) {
      expect(blockerIdentities(v).length).toBeGreaterThan(0);
    }
  });

  // ==========================================================================
  // NEGATIVE CONTROL — the comparator must be able to SEE a difference.
  //
  // Removing an option's interventions is a change to a REAL, user-authored
  // input, not a synthesised one. If this does not move the verdict, the
  // invariance assertions above are measuring a comparator that cannot
  // discriminate, and every one of them is worthless.
  // ==========================================================================
  describe("negative control — a REAL input change flips the verdict", () => {
    /** The healthy model with `opt_c`'s effect values removed. */
    function strippedOptionGraph(edge: EdgeFactory) {
      const g = configuredGraph(edge);
      return {
        ...g,
        nodes: g.nodes.map((n) => {
          if ((n as { id?: string }).id !== "opt_c") return n;
          const { interventions: _dropped, ...rest } = n as Record<string, unknown>;
          return rest;
        }),
      };
    }

    it("flips can_run_analysis and names the option the change was made to", () => {
      const healthy = assessRouteAdmission(configuredGraph(synthesisedEdge));
      const stripped = assessRouteAdmission(strippedOptionGraph(synthesisedEdge));

      expect(healthy.can_run_analysis).toBe(true);
      expect(stripped.can_run_analysis).toBe(false);

      // Bound by identity: it must blame opt_c, the option actually changed —
      // and must NOT blame opt_a, which was not touched.
      expect(blockerIdentities(stripped)).toEqual(["MISSING_OPTION_VALUE|opt_c|fac_price"]);
      expect(stripped.readiness_issues.some((i) => i.option_id === "opt_a")).toBe(false);
    });

    it("the comparator used by the sweep reports that difference", () => {
      const healthy = assessRouteAdmission(configuredGraph(synthesisedEdge));
      const stripped = assessRouteAdmission(strippedOptionGraph(synthesisedEdge));

      // Exactly the two comparisons every sweep case makes. Both must FAIL to
      // match here, or those comparisons prove nothing when they do match.
      expect(blockerIdentities(stripped)).not.toEqual(blockerIdentities(healthy));
      expect(stripped).not.toEqual(healthy);
    });

    it("stays sensitive to that real change at every sweep point", () => {
      for (const point of SWEEP_POINTS) {
        const healthy = assessRouteAdmission(configuredGraph(explicitEdge(point)));
        const stripped = assessRouteAdmission(strippedOptionGraph(explicitEdge(point)));

        expect(healthy.can_run_analysis, sweepLabel(point)).toBe(true);
        expect(stripped.can_run_analysis, sweepLabel(point)).toBe(false);
      }
    });
  });
});
