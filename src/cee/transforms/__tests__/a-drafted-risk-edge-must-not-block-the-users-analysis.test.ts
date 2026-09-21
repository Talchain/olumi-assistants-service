/**
 * ⭐ A QUALITATIVE HYPOTHESIS THE PRODUCT DREW ITSELF MUST NOT REFUSE THE
 * USER'S ANALYSIS. Disclose it as an open question; never enforce it as a
 * blocker.
 *
 * THE WITNESS, captured not invented. Paul's manual test of 21 Sep 2026
 * (`olumi-debug-65fdde46-20260921.json`, served CEE `01f282d`) returned
 * `may_run: false` on a three-option hiring model in which EVERY option
 * carried two fully resolved interventions. The product's own reason set said,
 * in one payload, both *"Olumi filled in the gaps here itself; you can review
 * them, and nothing is required of you"* and *"This model cannot be analysed
 * yet."*
 *
 * THE DISCRIMINATING PAIR THE PRODUCT HANDED US. `Hire One Senior Developer`
 * and `Hire a Tech Lead` are structurally identical — same two target factors,
 * same units (£ and %), same field population, both fully valued. The first is
 * `ready`; the second is `needs_user_mapping`. The ONLY difference is a third
 * out-edge to the `risk` node `Coordination Overhead Risk`, which
 * `buildAnalysisReadyPayload` demotes on unconditionally.
 *
 * ⚠⚠ WHY THE DEMOTION HAS NO CORRECT BRANCH, MEASURED RATHER THAN ARGUED:
 *   1. NO non-test producer in the tree writes `origin: "user"` on an edge
 *      (contrast control: `origin: "repair"` has exactly one producer,
 *      `fixStatusQuoConnectivity`). Edges default to `"ai"`
 *      (`schema-v3.ts:1225`), so EVERY option→risk edge reaching readiness is
 *      machine-authored. An authorship guard here would never fire — the
 *      `repair-authored-edge.ts` docblock's own trap-22 warning.
 *   2. The only case the demotion could legitimately catch — an option we know
 *      nothing about — is ALREADY demoted upstream by `computeOptionStatus`
 *      (Priority 1, no interventions). The third test below pins that, so this
 *      change is proven to lose no coverage rather than assumed to.
 *   3. PLoT strips every edge incident to an `option` node before the engine
 *      (`plot-lite-service` `src/normalisation/option-filter.ts:93-97`), so the
 *      edge is a no-op at the compute. This is a STATIC READ of that repo, and
 *      it is why the change is correct, not why it is safe.
 *
 * ⛔ WHAT MUST NOT BE LOST, AND WHY IT IS TESTED SEPARATELY. Removing the
 * blocker while also dropping the explanation would be a net harm: the user
 * would gain a Run affordance and lose the only sentence telling them the
 * relationship is unquantified. `payload.user_questions` was gated on
 * `payload.status === "needs_user_mapping"`, so lifting the block DELETED the
 * disclosure as a side effect. The disclosure is now emitted on its own terms.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { computeOptionStatus } from "../option-status.js";
import type {
  GraphV3T,
  NodeV3T,
  OptionV3T,
  InterventionV3T,
} from "../../../schemas/cee-v3.js";

const WITNESS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/paul-hiring-session-20260921.json", import.meta.url)),
    "utf-8",
  ),
) as {
  observed_wire: { may_run: boolean; status: string; option_status: Record<string, string> };
  graph: GraphV3T;
  goal_node_id: string;
};

const RISK_LABEL = "Coordination Overhead Risk";

/** Options as the pipeline hands them to the payload builder — status from the one authority. */
function optionsFromGraph(graph: GraphV3T): OptionV3T[] {
  return (graph.nodes as NodeV3T[])
    .filter((node) => node.kind === "option")
    .map((node) => {
      const raw = node as unknown as {
        id: string;
        label: string;
        interventions?: Record<string, InterventionV3T>;
      };
      const interventions = raw.interventions ?? {};
      return {
        id: raw.id,
        label: raw.label,
        status: computeOptionStatus({ interventions }).status,
        interventions,
      } as unknown as OptionV3T;
    });
}

function build(graph: GraphV3T) {
  return buildAnalysisReadyPayload(optionsFromGraph(graph), WITNESS.goal_node_id, graph);
}

describe("a drafted risk edge must not block the user's analysis", () => {
  it("the fixture really is the witnessed shape — every option fully valued, two carrying a drafted risk edge", () => {
    const options = optionsFromGraph(WITNESS.graph);
    expect(options.length, "three options were witnessed").toBe(3);
    for (const option of options) {
      expect(
        Object.keys((option as unknown as { interventions: object }).interventions).length,
        `${option.label} carried two resolved interventions at the wire`,
      ).toBe(2);
    }
    const riskId = (WITNESS.graph.nodes as NodeV3T[]).find((n) => n.label === RISK_LABEL)!.id;
    const optionIds = new Set(options.map((o) => o.id));
    const drafted = WITNESS.graph.edges.filter((e) => optionIds.has(e.from) && e.to === riskId);
    expect(drafted.length, "two options carried the drafted risk edge").toBe(2);
    expect(
      drafted.every((e) => (e as unknown as { origin?: string }).origin !== "user"),
      "no producer writes origin:'user' — every such edge is machine-authored",
    ).toBe(true);
  });

  it("REGRESSION — a fully valued option is not demoted by an edge the drafter drew", () => {
    const payload = build(WITNESS.graph);
    const blocked = payload.options.filter((o) => o.status === "needs_user_mapping");
    expect(
      blocked.map((o) => o.label ?? o.option_id),
      "no fully valued option may be blocked by the product's own hypothesis",
    ).toEqual([]);
    expect(payload.status, "the payload must not inherit a blocked status").not.toBe(
      "needs_user_mapping",
    );
  });

  it("THE DISCLOSURE SURVIVES — the unquantified relationship is still named on the payload", () => {
    const payload = build(WITNESS.graph);
    const questions = payload.user_questions ?? [];
    expect(
      questions.some((q) => q.includes(RISK_LABEL)),
      "removing the blocker must not remove the explanation",
    ).toBe(true);
  });

  it("COVERAGE IS NOT LOST — an option we know nothing about is still blocked", () => {
    // Same graph, but the option's interventions are stripped. This is the only
    // case the removed demotion could legitimately have caught; `computeOptionStatus`
    // already catches it, and this pins that rather than assuming it.
    const graph = JSON.parse(JSON.stringify(WITNESS.graph)) as GraphV3T;
    const target = (graph.nodes as NodeV3T[]).find(
      (n) => n.kind === "option" && n.label === "Hire a Tech Lead",
    ) as unknown as { interventions: Record<string, unknown> };
    target.interventions = {};
    const payload = build(graph);
    const stripped = payload.options.find((o) => o.label === "Hire a Tech Lead");
    // MEASURED, not assumed: `computeOptionStatus` reports this class as
    // `needs_encoding` (connected, no numeric value), not `needs_user_mapping`.
    // The claim under test is that it is still REFUSED, so the assertion is on
    // the refusal and not on which of the two blocked statuses names it —
    // binding to one spelling would pin an implementation detail and read as
    // coverage it does not have.
    expect(stripped?.status, "an option with nothing specified is still blocked").not.toBe("ready");
    expect(payload.status, "and the payload still refuses").not.toBe("ready");
  });
});
