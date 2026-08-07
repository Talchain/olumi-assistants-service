/**
 * ROADMAP 2.714 (INV-HONOUR) REVERTED — free-brief text must never become a
 * factor value stamped as the USER'S OWN.
 *
 * WHY THIS SUITE EXISTS. #853 shipped a rule that read a number out of the
 * brief, wrote it into `observed_state`, and stamped it
 * `source: "user_override"` + `provenance: "from_brief"` — i.e. it presented
 * its own reading back to the user as their own stated number, with an EMPTY
 * skip list, silently. The post-merge adversarial review
 * (`PHASE0-EVIDENCE-2026-07-28/review-cee-853-postmerge-2026-08-08.md`, F1–F4)
 * MEASURED the rule fabricating values that were wrong by up to 10^6x, values
 * the user had explicitly NEGATED, values they had RETRACTED, and values they
 * never stated at all.
 *
 * ⚠ EVERY ROW IN `MEASURED_CORPUS` IS A MEASURED BEHAVIOUR OF THE DEPLOYED
 * BUILD, NOT A HYPOTHESIS. The failed PR shipped a 25/25 mutant kit that could
 * not see any of it, because its corpus was drawn from the author's own model
 * of what a brief looks like (CLAUDE.md trap 13c: a mutant kit validates
 * SENSITIVITY, never CORRECTNESS). So this corpus is taken from the reviewer's
 * executed probes against the real module, and every row is proven to RED
 * against the pre-revert tree before the removal lands.
 *
 * WHAT THIS SUITE BINDS TO. `runGraphDataIntegrityChecks` — the PRODUCTION
 * seam (`unified-pipeline/stages/boundary.ts:51`, its only call site), not the
 * removed module. That is deliberate: the suite must keep meaning something
 * after the module is gone, and it must fail loud if any FUTURE rule
 * re-introduces a brief-text-derived value write on this path. It is the
 * corpus half of CLAUDE.md trap 12d; the derived half — the complete
 * enumeration of every `user_override` writer in `src/` — is the sibling
 * suite `no-brief-derived-user-override.writers.test.ts`.
 *
 * FIXTURE HONESTY. Every `v3Body` is a deep clone of a CAPTURED staging
 * response (`tests/fixtures/cross-service/draft-graph.success.no-coaching.json`,
 * recorded verbatim from cee-staging), never a hand-written
 * `{ nodes: [{ observed_state: {...} }] }` — that shape is exactly how a
 * fixture comes to disagree with the wire.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runGraphDataIntegrityChecks } from "../graph-data-integrity.js";

const CAPTURED_V3_PATH = resolve(
  process.cwd(),
  "tests/fixtures/cross-service/draft-graph.success.no-coaching.json",
);

/** A fresh deep clone of the captured staging body for every case. */
function capturedBody(): any {
  return JSON.parse(readFileSync(CAPTURED_V3_PATH, "utf8"));
}

function nodeById(body: any, id: string): any {
  const found = body.nodes.find((n: any) => n.id === id);
  if (!found) {
    throw new Error(`fixture precondition failed: node ${id} absent from the capture`);
  }
  return found;
}

/** The captured node every currency row below binds to, BY ID. */
const BOUND_NODE_ID = "fac_hiring_cost";
/** Its captured label, verbatim — the string the removed rule bound on. */
const BOUND_NODE_LABEL = "hiring and staffing cost";

/**
 * Assert the whole body is free of the fabrication stamp. This is the
 * invariant, and it is asserted over EVERY node rather than the bound one, so
 * a rule that mis-binds to a different node (review finding F3) is caught too.
 */
function expectNoUserOverrideAnywhere(body: any): void {
  const offenders = (body.nodes as any[])
    .filter((n) => n?.observed_state?.source === "user_override")
    .map((n) => `${n.id} → raw_value ${n.observed_state.raw_value}, value ${n.observed_state.value}`);
  expect(
    offenders,
    `A value derived from free-brief text was stamped as the user's own on:\n` +
      offenders.map((o) => `  - ${o}`).join("\n"),
  ).toEqual([]);
}

describe("INV-HONOUR reverted — brief text never becomes a user_override value", () => {
  describe("fixture preconditions (pinned, so a capture change fails loud)", () => {
    it("the captured node this suite binds to carries the shape the corpus assumes", () => {
      const node = nodeById(capturedBody(), BOUND_NODE_ID);
      expect(node.label.toLowerCase()).toBe(BOUND_NODE_LABEL);
      expect(node.observed_state.unit).toBe("£");
      expect(node.observed_state.cap).toBe(400000);
      // The drafter's value. Every corpus row's fabricated number differs from
      // this, so no row can pass by the fabrication happening to agree.
      expect(node.observed_state.raw_value).toBe(0);
      expect(node.observed_state.source).toBe("brief_extraction");
    });

    it("no captured node is ALREADY stamped user_override — the guard starts clean", () => {
      expectNoUserOverrideAnywhere(capturedBody());
    });
  });

  /**
   * ⚠ MEASURED, NOT HYPOTHESISED. `fabricated` is the number the deployed rule
   * writes for that brief. It is recorded here so each row PINS ITS OWN
   * PRECONDITION (trap 13b): the row is only meaningful if `fabricated` differs
   * from the captured `raw_value` of 0, which the assertion below enforces.
   */
  const MEASURED_CORPUS: ReadonlyArray<{
    readonly finding: string;
    readonly why: string;
    readonly brief: string;
    readonly fabricated: number;
  }> = [
    // ── F1: the window is cut at the first `[.!?]`, which is ALSO the decimal
    // point — so the magnitude word is removed from the string before the
    // magnitude guard (the module's own "MOST IMPORTANT LINE") can inspect it.
    {
      finding: "F1",
      why: "decimal point truncates '£1.5 million' to '£1' before the magnitude guard",
      brief: "The hiring and staffing cost is £1.5 million per year.",
      fabricated: 1,
    },
    {
      finding: "F1",
      why: "'$2.4m' truncates to '$2'; the currency SYMBOL precedes the digits so the unit gate still passes",
      brief: "The hiring and staffing cost is $2.4m annually.",
      fabricated: 2,
    },
    {
      finding: "F1",
      why: "'£1.2 billion' truncates to '£1' — a 10^9x error stamped as the user's own",
      brief: "The annual budget is set. The hiring and staffing cost is £1.2 billion.",
      fabricated: 1,
    },
    // ── F2: the first parseable number in the window wins. No multi-candidate,
    // mood or polarity guard.
    {
      finding: "F2",
      why: "writes the price the user REJECTED",
      brief: "We negotiated the hiring and staffing cost down from £120,000 to £90,000",
      fabricated: 120000,
    },
    {
      finding: "F2",
      why: "writes the SUPERSEDED value, reverting a correct draft",
      brief: "The hiring and staffing cost was £100,000, now £75,000",
      fabricated: 100000,
    },
    {
      finding: "F2",
      why: "NEGATION — asserts as the user's own the number they explicitly denied",
      brief: "The hiring and staffing cost is not £200,000",
      fabricated: 200000,
    },
    {
      finding: "F2",
      why: "HYPOTHETICAL — the user never stated this value",
      brief: "If the hiring and staffing cost were £200,000 we would walk away",
      fabricated: 200000,
    },
    {
      finding: "F2",
      why: "per-unit amount read as the total",
      brief: "The hiring and staffing cost is £750 per seat across 120 seats",
      fabricated: 750,
    },
    {
      finding: "F2",
      why: "RANGE — commits an arbitrary endpoint",
      brief: "The hiring and staffing cost is £80,000-£100,000",
      fabricated: 80000,
    },
    // ── F4: the corpus is the ACCUMULATED brief, so a correction phrased
    // without repeating the label is overridden back to the retracted number.
    {
      finding: "F4",
      why: "RETRACTED value re-imposed over the user's later correction",
      brief:
        "The hiring and staffing cost is £90,000 per year. Actually, make it 120,000 instead.",
      fabricated: 90000,
    },
  ];

  describe("the measured corpus — every row fabricated on the deployed build", () => {
    /**
     * A corpus that silently SHRANK would keep passing while covering less —
     * the one failure mode the mutants cannot see, because deleting rows
     * removes the very assertions that would have gone red. Pin the shape.
     */
    it("the corpus is non-empty and still spans every measured finding", () => {
      expect(MEASURED_CORPUS.length).toBeGreaterThanOrEqual(10);
      const findings = new Set(MEASURED_CORPUS.map((c) => c.finding));
      expect([...findings].sort()).toEqual(["F1", "F2", "F4"]);
    });

    it.each(MEASURED_CORPUS)(
      "$finding: $why",
      ({ finding, brief, fabricated }) => {
        // Row precondition: a row whose fabricated value equalled the captured
        // value would pass vacuously. Pin it in-test.
        expect(
          fabricated,
          "vacuous row: the fabricated value equals the captured drafter value",
        ).not.toBe(0);

        const body = capturedBody();
        runGraphDataIntegrityChecks(body, `req-${finding}`, brief);
        const node = nodeById(body, BOUND_NODE_ID);

        // 1. The drafter's value survives — nothing rewrote it from brief text.
        expect(
          node.observed_state.raw_value,
          `brief text was written into ${BOUND_NODE_ID} as ${node.observed_state.raw_value}`,
        ).toBe(0);
        // 2. And it is not relabelled as the user's own.
        expect(node.observed_state.source).toBe("brief_extraction");
        // 3. Nor is any OTHER node (F3's mis-binding direction).
        expectNoUserOverrideAnywhere(body);
      },
    );
  });

  describe("F3 — a shorter label binding inside a longer one", () => {
    /**
     * The captured body carries no label-containment pair, so this case adds
     * one. Both nodes are built by CLONING the captured `fac_hiring_cost`
     * observed_state (unit `£`, cap 400,000, `brief_extraction`) and changing
     * only `id`/`label` — the shape stays exactly what the wire produces, and
     * the only thing under test is the label binding.
     *
     * Measured on the deployed build: `Cost` (the SHORT, generic label) was
     * repaired to 90,000 and stamped `user_override`, while `Licence Cost` —
     * the label the user actually wrote — refused ITSELF as ambiguous. The
     * user's number landed on the wrong node, and the direction is backwards.
     */
    function bodyWithNestedLabels(): any {
      const body = capturedBody();
      const template = nodeById(body, BOUND_NODE_ID);
      const clone = (id: string, label: string) => ({
        ...JSON.parse(JSON.stringify(template)),
        id,
        label,
      });
      body.nodes.push(clone("fac_cost_generic", "Cost"));
      body.nodes.push(clone("fac_cost_licence", "Licence Cost"));
      return body;
    }

    it("neither the containing nor the contained label takes the number", () => {
      const body = bodyWithNestedLabels();
      // Precondition: the containment relation this case is about actually holds.
      expect("licence cost".includes("cost")).toBe(true);

      runGraphDataIntegrityChecks(body, "req-F3", "The licence cost is £90,000 per year.");

      expect(nodeById(body, "fac_cost_generic").observed_state.raw_value).toBe(0);
      expect(nodeById(body, "fac_cost_licence").observed_state.raw_value).toBe(0);
      expectNoUserOverrideAnywhere(body);
    });
  });

  describe("the honour-rule case that DID work is gone too — the capability is removed, not narrowed", () => {
    /**
     * The one brief the removed rule handled correctly. Asserting it no longer
     * writes is what makes this a REMOVAL rather than a narrowed guard with a
     * different blind spot — the explicit instruction from the review.
     */
    it("an unambiguous, correctly-parsed stated value is ALSO no longer written", () => {
      const body = capturedBody();
      runGraphDataIntegrityChecks(
        body,
        "req-removed",
        "The hiring and staffing cost is £250,000 for the year.",
      );
      expect(nodeById(body, BOUND_NODE_ID).observed_state.raw_value).toBe(0);
      expect(nodeById(body, BOUND_NODE_ID).observed_state.source).toBe("brief_extraction");
      expectNoUserOverrideAnywhere(body);
    });
  });

  describe("the sibling repairs in the same function are UNTOUCHED by this removal", () => {
    /**
     * Positive control on the revert's blast radius. `runGraphDataIntegrityChecks`
     * also runs scale-consistency, edge-field and intercept repairs; this
     * removal must not disturb them. Without this, "nothing changed" could mean
     * "the whole function stopped running".
     */
    it("the function still runs and still returns its other repair arms", () => {
      const body = capturedBody();
      const summary = runGraphDataIntegrityChecks(body, "req-control", "Nothing here names any node.");
      expect(Array.isArray(summary.scale_consistency_repairs)).toBe(true);
      expect(Array.isArray(summary.edge_field_repairs)).toBe(true);
      expect(Array.isArray(summary.intercept_population_repairs)).toBe(true);
      expectNoUserOverrideAnywhere(body);
    });
  });
});
