/**
 * PR1 / Component 6 — A STATED QUANTITY MUST SURVIVE RECLASSIFICATION.
 *
 * ── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
 * The frontier comparison of 2026-08-10
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/frontier-comparison-2026-08-10/`)
 * scored context retention (D2) at 2.0 against a frontier arm's 4.5 — the
 * largest gap of nine dimensions. Its named witnesses:
 *
 *   NRR 112%   → "Net Revenue Retention — Range: 0 to 1"   (unrepresentable)
 *   £11.2m ARR → "Current ARR — Range: 0.28 to 0.84"
 *   £3.1m cash → "Available Cash — Range 0.31 to 0.93"
 *
 * All three are produced HERE. A factor the user merely STATED has no inbound
 * option→factor edge, so `handleUnreachableFactors` reclassifies it `external`,
 * deletes `data.value`, deletes `data` entirely, and synthesises a uniform
 * prior in its place. The unit, the raw magnitude and the cap go with `data`.
 *
 * ── THE ORACLE IS NOT MINE ─────────────────────────────────────────────────
 * CLAUDE.md trap 22: a corpus drawn from the author's head cannot see the class
 * the author did not imagine — the defect that killed ROADMAP 2.714. Every
 * fixture below is a REAL CAPTURE from the deployed system, committed by a
 * different lane at `src/cee/context-integrity/__tests__/fixtures/*.cold-read.json`,
 * and every expectation is derived from the PRODUCER's declared semantics at
 * the bytes (`synthesisePriorFromBaseline`'s own docstring, the live draft
 * prompt's MODEL UNIT TYPES table, `DECLARED_SCALE_BOUNDS` in the vendored
 * contract) — never from my reading of what a field ought to mean.
 *
 * ── WHAT THIS SUITE DOES NOT CLAIM ─────────────────────────────────────────
 * It says nothing about what the UI renders. `display-value.ts` is frozen for
 * this lane and its `'%'` formatter carries a magnitude sniff
 * (`n <= 1 ? n * 100 : n`) that would render a ratio-scale prior as
 * "56% to 1.68%". That is why the unit promotion below is WITHHELD on the
 * ratio-scale case rather than rendered wrong — see the third block.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleUnreachableFactors } from "../unreachable-factors.js";
import type { GraphT } from "../../../../../schemas/graph.js";

const FIXTURE_DIR = resolve(
  process.cwd(),
  "src/cee/context-integrity/__tests__/fixtures",
);

/** A real deployed capture, not a hand-authored graph. */
function capturedGraph(name: string): any {
  const raw = JSON.parse(
    readFileSync(resolve(FIXTURE_DIR, `${name}.cold-read.json`), "utf8"),
  );
  return raw.graph ?? raw;
}

/**
 * Minimal graph builder for the arithmetic blocks. Values only ever come from
 * the corpus or from the producer's own docstring; the SHAPE is scaffolding.
 */
function statedFactor(opts: {
  id: string;
  value: number;
  unit?: string;
  raw_value?: number;
  cap?: number;
}): GraphT {
  return {
    nodes: [
      { id: "goal_x", kind: "goal", label: "Goal" },
      { id: "dec_x", kind: "decision", label: "Decision" },
      { id: "opt_x", kind: "option", label: "Option" },
      {
        id: opts.id,
        kind: "factor",
        label: "Stated Factor",
        data: {
          value: opts.value,
          ...(opts.unit !== undefined && { unit: opts.unit }),
          ...(opts.raw_value !== undefined && { raw_value: opts.raw_value }),
          ...(opts.cap !== undefined && { cap: opts.cap }),
          extractionType: "explicit",
        },
      },
    ],
    edges: [
      { from: "dec_x", to: "opt_x", edge_type: "structural" },
      { from: "opt_x", to: "goal_x", edge_type: "causal" },
    ],
  } as unknown as GraphT;
}

function factorNode(graph: GraphT, id: string): any {
  return (graph as any).nodes.find((n: any) => n.id === id);
}

// ───────────────────────────────────────────────────────────────────────────
// B — the containment invariant
// ───────────────────────────────────────────────────────────────────────────

describe("B — a synthesised prior must contain the value it was synthesised from", () => {
  /**
   * The invariant, stated once. `synthesisePriorFromBaseline`'s own docstring
   * says it synthesises "from a known baseline value"; a distribution whose
   * support EXCLUDES that value is incoherent by construction, whatever the
   * margin doctrine. This is a checkable property, not a corpus judgement —
   * which is the whole lesson of the 2.714 revert.
   */
  const CASES: ReadonlyArray<{ id: string; value: number; why: string }> = [
    // The measured B1 witness. The live draft prompt (defaults-v187.ts:299)
    // MANDATES this encoding: "Ratio that can exceed 100% | raw ratio |
    // NRR 110% → 1.10". The repair stage then calls that compliant value
    // "out-of-domain" and discards it.
    { id: "fac_nrr", value: 1.12, why: "NRR 112% — the B1-A22 SEVERE loss" },
    { id: "fac_ratio_high", value: 2.5, why: "a 250% ratio" },
    { id: "fac_exact_one", value: 1, why: "the boundary the short-circuit uses" },
  ];

  for (const c of CASES) {
    it(`${c.id}: prior contains ${c.value} (${c.why})`, () => {
      const graph = statedFactor({ id: c.id, value: c.value, unit: "%" });
      handleUnreachableFactors(graph, "edge_type" as any);
      const prior = factorNode(graph, c.id).prior;

      expect(prior, "no prior was synthesised at all").toBeDefined();
      expect(
        prior.range_min,
        `range_min ${prior.range_min} is above the value ${c.value} it was synthesised from`,
      ).toBeLessThanOrEqual(c.value);
      expect(
        prior.range_max,
        `range_max ${prior.range_max} is below the value ${c.value} it was synthesised from ` +
          `— the distribution excludes the very number it claims to be uncertain about`,
      ).toBeGreaterThanOrEqual(c.value);
    });
  }

  /**
   * DISCRIMINATING PAIR (CLAUDE.md trap 19). The containment fix must NOT
   * disturb the legitimate binary case, where [0,1] genuinely contains the
   * value. `fac_legal_clearance` in the B3 capture is exactly this: a binary
   * clearance whose [0,1] prior is correct. A fix that "corrected" it too
   * would be widening the blast radius onto ISL inputs with no defect to show.
   */
  it("leaves a legitimate binary prior at [0,1] untouched (the negative half of the pair)", () => {
    for (const value of [0, 0.5]) {
      const graph = statedFactor({ id: "fac_binary", value });
      handleUnreachableFactors(graph, "edge_type" as any);
      const prior = factorNode(graph, "fac_binary").prior;
      expect(prior.range_min).toBeLessThanOrEqual(value);
      expect(prior.range_max).toBeGreaterThanOrEqual(value);
      expect(prior.range_min).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The margin doctrine itself is UNCHANGED for every in-domain value. Pinned
   * from the producer's docstring: "margin = max(0.1, value * 0.5)", clamped
   * to [0,1]. If this moves, computed numbers move, and that is a separate
   * decision with its own justification — not a side effect of this fix.
   */
  it("does not change the margin doctrine for in-domain values", () => {
    const graph = statedFactor({ id: "fac_mid", value: 0.6 });
    handleUnreachableFactors(graph, "edge_type" as any);
    const prior = factorNode(graph, "fac_mid").prior;
    expect(prior.range_min).toBeCloseTo(0.3, 10);
    expect(prior.range_max).toBeCloseTo(0.9, 10);
  });

  /**
   * NON-INVERSION, over every branch. This is the property the pre-existing
   * pin in `tests/unit/cee.unified-pipeline.deterministic-sweep.test.ts`
   * actually existed to protect — its `[0,1]` expectation was a workaround for
   * the clamp that produced `range_min=55, range_max=1` on a value of 110.
   * The workaround is gone, so the property is asserted directly instead of
   * being implied by a constant.
   *
   * The sweep is deliberately wider than the corpus: an inverted range is a
   * structural fault, and structural faults are the class a hand-picked corpus
   * is worst at finding (trap 22).
   */
  it("never emits an inverted range, across the whole value sweep", () => {
    const values = [
      -5, -0.1, 0, 0.0001, 0.05, 0.1, 0.5, 0.9, 0.9999, 1, 1.0001, 1.12, 2.5,
      10, 96, 110, 1_000, 11_200_000,
    ];
    for (const value of values) {
      const graph = statedFactor({ id: "fac_sweep", value });
      handleUnreachableFactors(graph, "edge_type" as any);
      const prior = factorNode(graph, "fac_sweep").prior;
      expect(prior, `no prior synthesised for value ${value}`).toBeDefined();
      expect(
        prior.range_min,
        `inverted range [${prior.range_min}, ${prior.range_max}] at value ${value}`,
      ).toBeLessThanOrEqual(prior.range_max);
      expect(
        prior.range_min,
        `negative support [${prior.range_min}, ...] at value ${value}`,
      ).toBeGreaterThanOrEqual(0);
      // Containment holds for every positive value. A non-positive baseline is
      // an upstream fault the [0,1] retention deliberately does not model.
      if (value > 0) {
        expect(prior.range_min, `containment lower bound at ${value}`).toBeLessThanOrEqual(value);
        expect(prior.range_max, `containment upper bound at ${value}`).toBeGreaterThanOrEqual(value);
      }
    }
  });

  /**
   * THE REGRESSION THE CAPTURES PROVE. `fac_nrr` shipped [0,1] on the real
   * deployed B1 graph. Bind by node IDENTITY, never by a value predicate
   * another node could satisfy (trap 19).
   */
  it("the deployed B1 capture still carries the defect this suite fixes", () => {
    const nrr = capturedGraph("b1-growth").nodes.find(
      (n: any) => n.id === "fac_nrr",
    );
    expect(nrr, "fac_nrr is absent from the B1 capture").toBeDefined();
    expect(nrr.label).toBe("Net Revenue Retention");
    expect(nrr.prior).toEqual({
      distribution: "uniform",
      range_min: 0,
      range_max: 1,
    });
    // and the unit/magnitude are gone with `data`
    expect(nrr.data).toBeUndefined();
    expect(nrr.unit).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A — the stated magnitude survives
// ───────────────────────────────────────────────────────────────────────────

describe("A — the stated magnitude and its unit survive reclassification", () => {
  /**
   * Assert the POSITIVE outcome with the exact magnitude, never
   * `not.toBe(undefined)`. £11.2m is the B1-A03 atom; the enricher stores it
   * normalised with `raw_value` carrying the magnitude and `cap` the
   * denominator, so the pair (raw_value, cap) is what a user's own figure
   * actually looks like at this seam.
   */
  it("preserves raw_value and cap for a currency factor (£11.2m ARR)", () => {
    const graph = statedFactor({
      id: "fac_arr",
      value: 0.56,
      unit: "£",
      raw_value: 11_200_000,
      cap: 20_000_000,
    });
    handleUnreachableFactors(graph, "edge_type" as any);
    const node = factorNode(graph, "fac_arr");

    expect(node.raw_value).toBe(11_200_000);
    expect(node.cap).toBe(20_000_000);
    expect(node.unit).toBe("£");
  });

  /**
   * `unit` at node level is the field `schema-v3.ts:411` already reads
   * (`anyNode.unit ?? node.data.unit`) when synthesising an external factor's
   * display string. It is read there TODAY and has never been written here —
   * which is why the deployed cards render a bare "0.31 to 0.93".
   */
  it("promotes unit for a currency factor so the display layer can find it (£3.1m cash)", () => {
    const graph = statedFactor({
      id: "fac_cash_runway",
      value: 0.62,
      unit: "£",
      raw_value: 3_100_000,
    });
    handleUnreachableFactors(graph, "edge_type" as any);
    expect(factorNode(graph, "fac_cash_runway").unit).toBe("£");
  });

  /**
   * ⚠ THE WITHHELD CASE, AND IT IS DELIBERATE.
   *
   * `display-value.ts` is frozen for this lane. Its `formatBound` resolves a
   * '%' bound by MAGNITUDE SNIFF — `n >= 0 && n <= 1 ? n * 100 : n` — so a
   * ratio-scale prior of [0.56, 1.68] would render "56% to 1.68%". Promoting
   * the unit there would replace a silent omission with a confidently wrong
   * number, which is the worse defect of the two.
   *
   * So the unit is WITHHELD on ratio scale and the withholding is RECORDED as
   * a repair — visible as an open modelling issue, never silently dropped.
   * This is the producer-side disambiguation ruling: the fix belongs in the
   * formatter, and until it lands the honest output is no number.
   */
  it("WITHHOLDS the '%' unit on a ratio-scale factor and records why", () => {
    const graph = statedFactor({ id: "fac_nrr", value: 1.12, unit: "%" });
    const result = handleUnreachableFactors(graph, "edge_type" as any);
    const node = factorNode(graph, "fac_nrr");

    expect(
      node.unit,
      "promoting '%' here would render '56% to 1.68%' through the frozen formatter",
    ).toBeUndefined();

    const withheld = result.repairs.find(
      (r) => r.code === "STATED_UNIT_WITHHELD_RATIO_SCALE",
    );
    expect(
      withheld,
      "the withheld unit must surface as an open modelling issue, not vanish",
    ).toBeDefined();
    expect(withheld!.path).toBe("nodes[fac_nrr].unit");

    // the magnitude itself is still preserved — only the RENDERING is withheld
    expect(node.declared_scale).toBe("ratio");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C — declared_scale is stamped by the producer that knows it
// ───────────────────────────────────────────────────────────────────────────

describe("C — declared_scale is stamped, never inferred by a consumer", () => {
  /**
   * Expectations derived from the vendored contract's own docstring
   * (`@talchain/schemas` 0.31.0 additive, ROADMAP 2.193): "the scale must be
   * DECLARED by the producer that knows it, never inferred by a consumer that
   * does not", with DECLARED_SCALE_BOUNDS = unit_interval {0,1} ·
   * ratio {0,null} · raw_count {0,null}.
   */
  it.each([
    { id: "f_ratio", value: 1.12, unit: "%", expected: "ratio" },
    { id: "f_unit_interval", value: 0.34, unit: "%", expected: "unit_interval" },
    { id: "f_normalised", value: 0.56, unit: "£", raw_value: 11_200_000, expected: "unit_interval" },
  ])("$id → declared_scale $expected", ({ id, value, unit, raw_value, expected }) => {
    const graph = statedFactor({ id, value, unit, raw_value });
    handleUnreachableFactors(graph, "edge_type" as any);
    expect(factorNode(graph, id).declared_scale).toBe(expected);
  });

  /**
   * FAIL OPEN, and only here. The contract is explicit that absence means
   * UNDECLARED and a consumer must not read it as `unit_interval`. Where this
   * producer does not know the scale it must stamp NOTHING rather than guess —
   * a defaulted declaration is a manufactured attestation.
   */
  it("stamps nothing when the scale is not known", () => {
    const graph = statedFactor({ id: "f_unknown", value: 0.4 });
    handleUnreachableFactors(graph, "edge_type" as any);
    expect(factorNode(graph, "f_unknown").declared_scale).toBeUndefined();
  });
});
