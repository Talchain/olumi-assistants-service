/**
 * ⭐ A FIGURE IN THE FACTOR'S OWN UNIT IS A QUANTITY, NOT A LABEL ECHO (CEE-ECHO-F1; DL 0df0e1, Science: "raw, not level").
 *
 * Paul's staging test (5 Oct): the option card and chat read "Developers 4 developers → 0.2". The option's level
 * 0.2 on a frame of 30 is 6 developers, and `buildInterventionDetail` synthesised exactly "6 developers". The CEE-6
 * echo rule (`isLabelEcho`: the candidate CONTAINS the label) then saw "developers" inside it and replaced the reading
 * with the bare normalised level "0.2". The factor's own current level fared the same in the blocker sentence
 * ("is currently 0.13" for 4 developers).
 *
 * THE SPEC: the echo rule exists for a label handed back as its own value ("CRM Annual Licence Cost" is CRM Annual
 * Licence Cost). A display synthesised from the record's OWN raw figure states a quantity; its unit can be the
 * factor's noun. So the echo fallback applies only when no raw figure stands behind the synthesised display.
 *
 * FIXTURES are the WRITER's shapes (CEE `admit-model.ts`): an Olumi-estimate factor baseline
 * `observed_state = { value: raw / frame, raw_value, unit }` with the frame on the node's `scale_frame`, and an option
 * level `{ value: figure / frame, source, target_match }` with its raw anchor (B1, `raw_interventions`) or without (B2).
 * Driven through the real `buildAnalysisReadyPayload`; bound by factor id, option id and exact text.
 */
import { describe, expect, it } from "vitest";
import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { GraphV3, OptionV3, type NodeV3T, type OptionV3T, type GraphV3T } from "../../../schemas/cee-v3.js";

const FACTOR = "fac_dev";
const GOAL = "goal_1";
const FRAME = 30;

/** The Olumi-estimate factor as admit-model writes it: 4 developers on a frame of 30. */
const developers = (label = "Developers", extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: FACTOR,
  kind: "factor",
  label,
  observed_state: { value: 4 / FRAME, raw_value: 4, unit: "developers", source: "cee_inference" },
  scale_frame: FRAME,
  ...extra,
});

function option(id: string, level: number): OptionV3T {
  return OptionV3.parse({
    id,
    label: id,
    status: "ready",
    interventions: {
      [FACTOR]: {
        value: level,
        source: "cee_hypothesis",
        value_confidence: "low",
        reasoning: "Olumi estimate for this option",
        target_match: { node_id: FACTOR, match_type: "exact_id", confidence: "high" },
      },
    },
  });
}

function payload(options: OptionV3T[], factor: Record<string, unknown> = developers()) {
  const graph = GraphV3.parse({ nodes: [{ id: GOAL, kind: "goal", label: "Ship the platform" }, factor], edges: [] });
  return buildAnalysisReadyPayload(options, GOAL, graph);
}
function displayOf(p: ReturnType<typeof payload>, optionId: string): string | undefined {
  const d = p.options.find((o) => o.id === optionId)?.intervention_details?.[FACTOR];
  expect(d, `intervention_details for ${optionId}→${FACTOR}`).toBeDefined();
  return d!.display_value;
}

describe("⭐ an option's own figure in the factor's unit is kept (Paul's 'Developers' case)", () => {
  it("⭐ B1 — the level carries its raw anchor (raw_interventions 6): '6 developers', not '0.2'", () => {
    const p = payload([{ ...option("opt_hire", 0.2), raw_interventions: { [FACTOR]: 6 } }]);
    expect(displayOf(p, "opt_hire")).toBe("6 developers");
  });

  it("⭐ B2 — a bare level, the frame only on the node: '6 developers', not '0.2'", () => {
    const p = payload([option("opt_hire", 0.2)]);
    expect(displayOf(p, "opt_hire")).toBe("6 developers");
  });

  it("the option sitting at the factor's own level reads its own figure too: '4 developers'", () => {
    const p = payload([option("opt_status_quo", 4 / FRAME)]);
    expect(displayOf(p, "opt_status_quo")).toBe("4 developers");
  });

  it("control: a label NOT inside the reading was never affected ('Team size' → '6 developers')", () => {
    const p = payload([option("opt_hire", 0.2)], developers("Team size"));
    expect(displayOf(p, "opt_hire")).toBe("6 developers");
  });
})

describe("the CEE-6 echo rule still holds where it was meant to: a label handed back with no figure behind it", () => {
  it("control: no raw figure, the synthesised reading is the label itself → the bare level, as before", () => {
    // A qualitative factor with no raw anchor and no frame: the synthesis falls to its band ladder ("Moderate (0.5)",
    // display-value.ts priority 6), and the band word IS the label. That is the echo the rule exists for: unchanged.
    const bare: Record<string, unknown> = {
      id: FACTOR, kind: "factor", label: "Moderate", factor_type: "other",
      observed_state: { value: 0.5, source: "cee_inference", factor_type: "other" },
    }
    const p = payload([option("opt_mid", 0.5)], bare);
    expect(displayOf(p, "opt_mid")).toBe("0.5")
  });
});

describe("⭐ the factor's current level in the blocker sentence reads its own figure", () => {
  function blockerFor(factor: Record<string, unknown>): string {
    const graph = {
      nodes: [{ id: GOAL, kind: "goal", label: "Ship the platform" }, { id: "opt_x", kind: "option", label: "Hire" }, factor],
      edges: [{ from: "opt_x", to: FACTOR }],
    } as unknown as GraphV3T;
    const opt = { id: "opt_x", label: "Hire", status: "needs_user_input", interventions: {} } as unknown as OptionV3T;
    const p = buildAnalysisReadyPayload([opt], GOAL, graph);
    const b = (p.blockers ?? []).find((x) => x.factor_id === FACTOR && x.option_id === "opt_x");
    if (!b) throw new Error("fixture precondition failed: no missing_value blocker for opt_x→fac_dev");
    return b.message;
  }

  it("⭐ 'is currently 4 developers', not 'is currently 0.13'", () => {
    const message = blockerFor(developers() as unknown as NodeV3T as unknown as Record<string, unknown>);
    expect(message).toContain('Factor "Developers" is currently 4 developers');
    expect(message).not.toContain("0.13");
  });

  it("control: no raw figure, the reading is the label itself → the bare level, as before (the CEE-6 echo)", () => {
    const bare: Record<string, unknown> = {
      id: FACTOR, kind: "factor", label: "Moderate", factor_type: "other",
      observed_state: { value: 0.5, source: "user", factor_type: "other" },
    }
    const message = blockerFor(bare)
    expect(message).toContain('Factor "Moderate" is currently 0.5.')
    expect(message).not.toContain("Moderate (0.5)")
  });

  it("control: a label not inside the reading reads the same figure ('Team size' is currently 4 developers)", () => {
    expect(blockerFor(developers("Team size"))).toContain('Factor "Team size" is currently 4 developers');
  });
});
