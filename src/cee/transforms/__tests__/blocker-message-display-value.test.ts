/**
 * THE BLOCKER MESSAGE QUOTES THE FACTOR'S DISPLAY VALUE, NOT ITS INTERNAL LEVEL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (deployed CEE, 2026-08-26, two independent golden-journey
 * runs, clean envelopes 20/20 — `olumi-docs/PHASE0-EVIDENCE-2026-07-28/
 * golden-journey-runs/20260826T212322Z-fresh-extended-507050-raw/step-T1_DRAFT.json`)
 *
 *   body.analysis_ready.blockers[1].message
 *     'Factor "CRM Annual Licence Cost" is currently 0.5. What should option … set it to?'
 *   body.draft_graph.nodes[9]                                    ← THE SAME PAYLOAD
 *     { observed_state: { value: 0.5, raw_value: 50000 },
 *       scale_frame: 100000, display_value: "50,000" }
 *
 * The message quotes `0.5` — the internal normalised level — while the node's own
 * human-readable form sits in the same response body. The first instance is at
 * `T1_DRAFT` with NO edit involved, so this is not an edit-path artefact.
 *
 * ⭐ The sentence whose entire job is to tell the user what to fix was showing them
 * a number they never typed and cannot recognise. That is this estate's dominant
 * defect class — the product's record diverging from what actually happened.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE SYMPTOM (CLAUDE.md trap 13d)
 *
 * **A blocker message renders the factor's CURRENT LEVEL in the factor's own
 * display authority.** Not "must not contain 0.5" — that is the failure mode, and
 * a factor genuinely displayed as `0.5` is a correct rendering. The spec form
 * catches the whole class, including the mirror defect where a synthesised string
 * is preferred over an explicit `display_value` the enricher supplied.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT THE F3 BORROWING DEFECT (`intervention-receipt-own-option.test.ts`)
 *
 * F3 banned an OPTION's receipt from borrowing the FACTOR's display string, because
 * the factor's status quo is not that option's proposal. This sentence is different
 * in kind: `is currently …` describes THE FACTOR'S OWN OBSERVED STATE by
 * construction, so the factor-scoped display string is the truthful one here. The
 * binding below is what keeps the two apart — the display is derived only when the
 * quoted level genuinely came from `observed_state`, never from the V1 `data.value`
 * passthrough, whose scale `observed_state.raw_value` does not describe.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE factor id whose
 * message it reads. `fac_untested` carries a full display record and is
 * deliberately NEVER asserted, so a mutation scoped to it must leave this suite
 * GREEN — the discriminating half of the mutant pair.
 */

import { describe, it, expect } from "vitest";

import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import type { OptionV3T, GraphV3T, NodeV3T } from "../../../schemas/cee-v3.js";

const OPTION_ID = "opt_hubspot";
const OPTION_LABEL = "replace our current CRM with HubSpot next quarter";

/**
 * An option connected to every factor by a genuine option→factor edge and
 * carrying NO interventions — the shape that emits `missing_value` blockers.
 */
function payloadFor(factors: NodeV3T[]) {
  const graph = {
    nodes: [
      { id: "goal_1", kind: "goal", label: "Improve CRM outcomes" },
      { id: OPTION_ID, kind: "option", label: OPTION_LABEL },
      ...factors,
    ],
    edges: factors.map((f) => ({ from: OPTION_ID, to: f.id })),
  } as unknown as GraphV3T;

  const option = {
    id: OPTION_ID,
    label: OPTION_LABEL,
    status: "needs_user_input",
    interventions: {},
  } as unknown as OptionV3T;

  return buildAnalysisReadyPayload([option], "goal_1", graph);
}

function factor(id: string, label: string, extra: Record<string, unknown>): NodeV3T {
  return { id, kind: "factor", label, category: "controllable", ...extra } as unknown as NodeV3T;
}

/** Read the blocker for a NAMED factor. Throws rather than returning undefined, so a
 *  fixture that stopped emitting the blocker fails loudly instead of passing vacuously. */
function messageFor(
  payload: ReturnType<typeof buildAnalysisReadyPayload>,
  factorId: string,
): string {
  const blocker = (payload.blockers ?? []).find(
    (b) => b.factor_id === factorId && b.option_id === OPTION_ID,
  );
  if (!blocker) {
    throw new Error(`fixture precondition failed: no blocker ${OPTION_ID}→${factorId}`);
  }
  return blocker.message;
}

/** The two factors exactly as the 26 Aug capture carried them, plus an unasserted control. */
const WITNESSED_FACTORS: NodeV3T[] = [
  factor("fac_licence_cost", "CRM Annual Licence Cost", {
    observed_state: { value: 0.5, raw_value: 50000, source: "cee_inference", factor_type: "other" },
    scale_frame: 100000,
    display_value: "50,000",
  }),
  factor("fac_adoption", "CRM Adoption and Usability", {
    observed_state: { value: 0.5, source: "cee_inference", factor_type: "other" },
    display_value: "Moderate (0.5)",
  }),
  // ⛔ NEVER ASSERTED. The discriminating half of the mutant pair.
  factor("fac_untested", "Support Response Time", {
    observed_state: { value: 0.5, raw_value: 12, unit: "hours", factor_type: "other" },
    display_value: "12 hours",
  }),
];

describe("a blocker message renders the factor's current level in its own display authority", () => {
  it("quotes the node's display_value, never the internal normalised level (the witnessed defect)", () => {
    const payload = payloadFor(WITNESSED_FACTORS);

    // PRECONDITION PINNED IN-TEST (trap 13b): both factors really do sit at the
    // normalised level 0.5, so a green result cannot come from a fixture whose
    // level and display had quietly converged.
    const licence = WITNESSED_FACTORS[0] as unknown as { observed_state: { value: number } };
    const adoption = WITNESSED_FACTORS[1] as unknown as { observed_state: { value: number } };
    expect(licence.observed_state.value).toBe(0.5);
    expect(adoption.observed_state.value).toBe(0.5);

    // THE SPEC: the factor's own display authority is what the user reads.
    expect(messageFor(payload, "fac_licence_cost")).toBe(
      `Factor "CRM Annual Licence Cost" is currently 50,000. What should option "${OPTION_LABEL}" set it to?`,
    );
    expect(messageFor(payload, "fac_adoption")).toBe(
      `Factor "CRM Adoption and Usability" is currently Moderate (0.5). What should option "${OPTION_LABEL}" set it to?`,
    );

    // …and the internal level is unreachable from the sentence where it is not
    // the display. This is what shipped on 26 Aug.
    expect(messageFor(payload, "fac_licence_cost")).not.toContain("is currently 0.5");
  });

  it("synthesises from the factor's own observed state when no display_value was supplied", () => {
    // Rung 2 of the ladder: the enricher gave no display string, so the canonical
    // `synthesiseDisplayValue` authority renders the SAME record the level came from.
    const payload = payloadFor([
      factor("fac_licence_cost", "CRM Annual Licence Cost", {
        observed_state: { value: 0.78, raw_value: 78000, unit: "£", factor_type: "other" },
        scale_frame: 100000,
      }),
    ]);

    expect(messageFor(payload, "fac_licence_cost")).toContain("is currently £78k");
    expect(messageFor(payload, "fac_licence_cost")).not.toContain("is currently 0.78");
  });

  it("says the bare level when that is genuinely all the record settles — honest, never absent", () => {
    // Rung 3, the terminal rung. `factor_type` is absent too, so no qualitative band
    // is available. The number is SAID rather than encoded as an absence.
    const payload = payloadFor([
      factor("fac_bare", "Unscaled factor", { observed_state: { value: 0.42 } }),
    ]);

    expect(messageFor(payload, "fac_bare")).toBe(
      `Factor "Unscaled factor" is currently 0.42. What should option "${OPTION_LABEL}" set it to?`,
    );
  });

  it("does NOT borrow observed_state's scale when the level came from the V1 data.value passthrough", () => {
    // The F3 boundary. `observed_state` carries no numeric value, so the quoted level
    // comes from `data.value` — a different record. Rendering it through
    // observed_state's raw_value/unit would describe a number the level is not.
    const payload = payloadFor([
      factor("fac_passthrough", "Passthrough factor", {
        observed_state: { raw_value: 50000, unit: "£", factor_type: "other" },
        data: { value: 0.31 },
        display_value: "50,000",
      }),
    ]);

    const message = messageFor(payload, "fac_passthrough");
    expect(message).toContain("is currently 0.31");
    expect(message).not.toContain("50,000");
    expect(message).not.toContain("£50k");
  });

  it("strips an echo of the factor label rather than repeating the label as its value", () => {
    const payload = payloadFor([
      factor("fac_echo", "Marketing Expertise", {
        observed_state: { value: 0.6 },
        display_value: "Marketing Expertise",
      }),
    ]);

    expect(messageFor(payload, "fac_echo")).toBe(
      `Factor "Marketing Expertise" is currently 0.6. What should option "${OPTION_LABEL}" set it to?`,
    );
  });

  it("leaves the no-current-level message untouched (no level, nothing to display)", () => {
    const payload = payloadFor([factor("fac_novalue", "Unknown factor", {})]);

    expect(messageFor(payload, "fac_novalue")).toBe(
      `Factor "Unknown factor" needs a numeric value for option "${OPTION_LABEL}"`,
    );
  });
});
