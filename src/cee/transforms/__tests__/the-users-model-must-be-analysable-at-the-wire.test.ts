/**
 * ⭐⭐ THE ACCEPTANCE IS `may_run`, NOT THE OBJECT THE FIX EDITS.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE BEHAVIOUR SUITE. Three defective
 * changes in one day shared one shape: a claim about what the user sees, taken
 * from the intermediate object being edited rather than from the payload that
 * reaches them. `buildAnalysisReadyPayload` reporting `status: "ready"` is NOT
 * the same statement as "the user can run the analysis" — `structurally_analysable`
 * is resolved a level up, by `resolveRunAdmission`, and a change can move the
 * first without moving the second. So this suite executes the TOP of the chain
 * and asserts the field the product actually gates on.
 *
 * ⭐ IT IS A FAITHFUL OFFLINE REPRODUCTION, and that is checkable rather than
 * claimed. At the tip WITHOUT the fix, this fixture reproduces the served
 * payload of Paul's 21 Sep manual test (`olumi-debug-65fdde46-20260921.json`,
 * CEE `01f282d`) in every consequential field — `structurally_analysable: false`,
 * `permitted_analysis_mode: "none"`, two `OPTION_NEEDS_MAPPING` inputs stamped
 * `obligation: "offered"` against the same two option labels, and verbatim:
 *
 *   "Review all 2 readiness issues together before analysis."
 *   "Olumi filled in the gaps here itself; you can review them, and nothing is
 *    required of you."
 *   "This model cannot be analysed yet."
 *
 * ⛔ THE CONTRADICTION THAT MAKES THIS A DEFECT AND NOT A PREFERENCE: the second
 * and third sentences are in the SAME payload. The product told the user nothing
 * was required of them and simultaneously refused to run. The last test here
 * pins that pair so it cannot return under another branch.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { analysisAdmissionFrom } from "../../../orchestrator-v5/admission/analysis-admission.js";
import { resolveRunAdmission } from "../../../orchestrator-v5/tools/handlers/analysis-ready-core.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";

const WITNESS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/paul-hiring-session-20260921.json", import.meta.url)),
    "utf-8",
  ),
) as { observed_wire: { may_run: boolean; status: string }; graph: GraphV3T };

function admissionAtTheWire() {
  const admission = resolveRunAdmission(WITNESS.graph);
  return { admission, published: analysisAdmissionFrom(admission, WITNESS.graph) };
}

describe("the user's model must be analysable at the wire", () => {
  it("the fixture is a graph the run path accepts — not one it rejects for a schema reason", () => {
    const { published } = admissionAtTheWire();
    // A `SCHEMA_INVALID` here means the fixture never reached the readiness
    // logic, and every other assertion in this file would be vacuous.
    expect(
      (published.missing_important_inputs ?? []).map((m) => m.code),
      "the fixture must be judged on its readiness, never rejected at the schema",
    ).not.toContain("SCHEMA_INVALID");
  });

  it("REGRESSION — the witnessed model is analysable", () => {
    const { admission, published } = admissionAtTheWire();
    expect(admission.willProceed, "the run admission must proceed").toBe(true);
    expect(
      published.structurally_analysable,
      "this is the field the Run affordance gates on",
    ).toBe(true);
    expect(published.permitted_analysis_mode).not.toBe("none");
    expect(
      (published.missing_important_inputs ?? []).map((m) => m.option_label),
      "nothing may be demanded of the user for a relationship the product drew",
    ).toEqual([]);
  });

  it("THE HONEST CAVEAT IS UNTOUCHED — no option may be called the leader", () => {
    const { published } = admissionAtTheWire();
    // Removing the blocker must not quietly upgrade the CLAIM the product may
    // make. Authorship is a separate axis and this change does not touch it:
    // every figure here is still Olumi's, so the comparison stays provisional.
    expect(published.semantic_quality_sufficient).toBe(false);
    expect(
      (published.reasons ?? []).some(
        (r) => r.code === "CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED",
      ),
      "the machine-authorship caveat must survive",
    ).toBe(true);
  });

  it("THE CONTRADICTION CANNOT RETURN — never refuse while saying nothing is required", () => {
    const { published } = admissionAtTheWire();
    const saysNothingRequired = (published.reasons ?? []).some((r) =>
      String(r.message).includes("nothing is required of you"),
    );
    const refuses = published.structurally_analysable !== true;
    expect(
      saysNothingRequired && refuses,
      "a payload may not both refuse to run and say nothing is required",
    ).toBe(false);
  });
});
