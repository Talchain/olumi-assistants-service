/**
 * ⭐⭐ THE PRODUCT ALREADY KNOWS WHAT TO ASK. THE WIRE THROWS IT AWAY.
 *
 * #1670 taught the canonical builder to name what a blocked option still needs —
 * including the option→risk hypothesis, by label. Measured on the user's own
 * draw, that builder produces, verbatim:
 *
 *   "How does Two Developers change Coordination & Management Overhead? The
 *    proposed relationship is retained, but its mechanism and value still need
 *    clarification."
 *
 * ⛔ AND THE USER NEVER SEES IT. `extractAnalysisReady` — the re-projection the
 * DRAFT turn actually ships, and the one turn where a fresh user first meets the
 * Analyse control — builds each wire option from a HAND-MAINTAINED field list
 * (`draft-graph.ts`). That list names `status_reason`, so the user gets the
 * generic "A proposed effect still needs a supported mapping", which names
 * nothing. It does NOT name `user_questions` or `unresolved_targets`, so the
 * question and the edge it refers to are dropped on the floor.
 *
 * ⚠ WHY #1670's OWN SUITE DID NOT CATCH THIS, stated so the gap is not reopened:
 * `cee/transforms/__tests__/mapping-need-survives-to-the-wire.test.ts` is named
 * for the wire but calls `buildAnalysisReadyPayload` and asserts on ITS return
 * value. That is the CANONICAL record, one stage above the wire. This file
 * closes the remaining hop by calling `extractAnalysisReady` itself.
 *
 * ⛔ THIS DOES NOT ARGUE THE REFUSAL. `tests/unit/causal-repair-preservation.test.ts`
 * pins, three times and each with a discriminating control, that an option→risk
 * gap REFUSES the run — and PLoT strips option-incident edges, so proceeding
 * would silently drop a risk the drafter drew. That ruling stands untouched here.
 * The defect is that the refusal arrives UNACTIONABLE, beside the admission's own
 * "nothing is required of you".
 *
 * The fixture is the user's own capture at deployed `5104b24`, not a fixture of
 * my own design.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { buildAnalysisReadyPayload } from "../../../cee/transforms/analysis-ready.js";
import { projectGraphAndOptionsToV3 } from "../../../cee/transforms/schema-v3.js";
import { GraphV3 } from "../../../schemas/cee-v3.js";
import { extractAnalysisReady } from "../draft-graph.js";

const CAPTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/hiring-draw-5104b244.json", import.meta.url)), "utf-8"),
) as { graph: unknown };

const RISK_LABEL = "Coordination & Management Overhead";

function wireFromCapture() {
  const projection = projectGraphAndOptionsToV3(CAPTURE.graph as never);
  const graph = GraphV3.parse(projection.graph);
  const goalId = graph.nodes.find((n) => n.kind === "goal")!.id;
  const canonical = buildAnalysisReadyPayload(projection.options, goalId, graph);
  const wire = extractAnalysisReady({ analysis_ready: canonical } as Record<string, unknown>);
  return { canonical, wire };
}

describe("the question the product already wrote must reach the user", () => {
  it("POSITIVE CONTROL — the canonical record really does name the risk", () => {
    // Without this, every assertion below could pass by the question never
    // existing at all, and the file would be measuring nothing.
    const { canonical } = wireFromCapture();
    const asked = canonical.options.flatMap(
      (o) => (o as { user_questions?: string[] }).user_questions ?? [],
    );
    expect(asked.some((q) => q.includes(RISK_LABEL)), "#1670's ask must exist upstream").toBe(true);
  });

  it("the blocked option carries its questions ON THE WIRE, naming the risk", () => {
    const { wire } = wireFromCapture();
    const blocked = (wire?.options ?? []).filter((o) => o.status === "needs_user_mapping");
    expect(blocked.length, "the capture blocks options; if not, the fixture drifted").toBeGreaterThan(0);
    for (const option of blocked) {
      const asked = (option as { user_questions?: string[] }).user_questions ?? [];
      expect(asked.length, `${option.label} refuses while asking the user nothing`).toBeGreaterThan(0);
    }
    const all = blocked.flatMap((o) => (o as { user_questions?: string[] }).user_questions ?? []);
    expect(
      all.some((q) => q.includes(RISK_LABEL)),
      "the risk must be named on the wire, not only in the canonical record",
    ).toBe(true);
  });

  it("the blocked option carries the targets its question refers to", () => {
    // The question names the risk in prose; `unresolved_targets` is the only
    // machine-readable handle on WHICH edge it means. Carrying the sentence
    // without the handle leaves a consumer unable to act on it.
    const { wire } = wireFromCapture();
    const blocked = (wire?.options ?? []).filter((o) => o.status === "needs_user_mapping");
    for (const option of blocked) {
      const targets = (option as { unresolved_targets?: string[] }).unresolved_targets ?? [];
      expect(targets.length, `${option.label} names no target for its own question`).toBeGreaterThan(0);
    }
  });

  it("CONTRAST — a ready option is not given questions it does not need", () => {
    // Proves the carry is driven by the option's own record, not a blanket copy.
    const { wire } = wireFromCapture();
    const ready = (wire?.options ?? []).filter((o) => o.status === "ready");
    expect(ready.length, "the capture must contain a ready option for this control").toBeGreaterThan(0);
    for (const option of ready) {
      expect(
        (option as { unresolved_targets?: string[] }).unresolved_targets ?? [],
        `${option.label} is ready and must carry no unresolved targets`,
      ).toHaveLength(0);
    }
  });
});
