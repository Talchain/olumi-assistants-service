/**
 * ⛔⛔⛔ THESE THREE BRIEFS MUST NOT CREDIT. THEY DID, ON STAGING, FOR ~4 HOURS.
 *
 * #1657 relaxed `labelIsNamedInFigureSentence` so members of
 * `UNIDENTIFIED_QUANTITY_LABELS` ({Rate, Value, Factor}) were no longer required
 * to appear in the figure's sentence. It merged as `033ea4b9` and was reverted.
 *
 * ── WHY IT WAS WRONG, MEASURED BY AN ADVERSARIAL REVIEW
 * For the very common model label shape `<Subject> Rate` / `<Subject> Value`,
 * the relaxation leaves exactly ONE required token. A shared subject word plus
 * a value/unit coincidence then became the whole binding. Measured end to end
 * (`creditUserTypedFigures` -> `transformGraphToV3` -> `censusConfidenceParameters`),
 * a false credit moved `material_parameters_user_stated` 0 -> 1,
 * `semantic_quality_sufficient` false -> true, and the permitted mode
 * `quantified_provisional` -> **`comparative_leader`** — the licence to name a
 * leading option, off a number nobody wrote.
 *
 * ⚠ THE AUTHOR'S OWN 215-BRIEF CORPUS WAS BLIND TO ALL OF IT, and #1657's spec
 * was 8/8 green at the defective tip. That is trap 22c exactly: for a predicate
 * over natural language the author's corpus is a development aid and the
 * reviewer's is the evidence.
 *
 * ── THE CASES ARE ORDINARY BUSINESS PROSE, NOT CONSTRUCTIONS
 * That is what makes them load-bearing. Each pins a DIFFERENT confusion:
 *   1. a TARGET someone else set, credited as the user's current level — while
 *      the user's real figure in the same sentence is refused;
 *   2. a monetary CAP credited as a level;
 *   3. a team-allocation percentage credited as the retention rate.
 *
 * This suite asserts the REFUSALS. It is the honest record of a known gap: the
 * user's own "Monthly Churn Rate" figure is still NOT credited (that is the gap
 * #1657 tried and failed to close), and closing it must leave every case below
 * refusing. A fix that turns any of these green has reopened the lie.
 */
import { describe, it, expect } from "vitest";
import { creditUserTypedFigures } from "../enricher.js";
import type { GraphT, NodeT } from "../../../schemas/graph.js";

function factor(label: string, value: number, unit: string): NodeT {
  return {
    id: "n1", kind: "factor", label, category: "observable",
    data: { value, unit, extractionType: "inferred" },
  } as unknown as NodeT;
}

function credits(brief: string, label: string, value: number, unit: string): number {
  const graph = { nodes: [factor(label, value, unit)], edges: [] } as unknown as GraphT;
  return creditUserTypedFigures(graph, brief);
}

describe("a figure the user never wrote must never be credited to them", () => {
  it("refuses someone else's TARGET as the user's current level", () => {
    const brief = "Our churn is 3.8% today and the board wants it under 2% by Q4.";
    expect(credits(brief, "Churn Rate", 0.02, "%")).toBe(0);
  });

  it("refuses a monetary CAP as a level", () => {
    const brief = "We cap churn-related credits at £50,000 a year.";
    expect(credits(brief, "Churn Value", 50_000, "£")).toBe(0);
  });

  it("refuses a team-allocation percentage as the retention rate", () => {
    const brief = "Retention is the priority, so we are moving 15% of the team onto it.";
    expect(credits(brief, "Retention Rate", 0.15, "%")).toBe(0);
  });

  it("refuses a currency amount credited to a churn node", () => {
    const brief = "Our tooling contract is £480,000 a year and churn is the reason we signed it.";
    expect(credits(brief, "Churn Value", 480_000, "£")).toBe(0);
  });

  /**
   * ⚠ THE KNOWN GAP, PINNED SO IT STAYS VISIBLE (trap 22f — record a gap in the
   * suite rather than leave it invisible). The user genuinely wrote 3.8%, and
   * it is genuinely NOT credited, because the model's own label carries a word
   * the user did not write. That is a gap, not a lie, and it is the direction
   * this module deliberately fails in. If a future fix closes it, this
   * expectation flips to 1 — and every refusal above must still hold.
   */
  it("records that the user's own figure is still uncredited when the model names it better", () => {
    const brief = "We run a small B2B SaaS. Our monthly churn is currently 3.8%.";
    expect(credits(brief, "Monthly Churn Rate", 0.038, "%")).toBe(0);
  });
});
