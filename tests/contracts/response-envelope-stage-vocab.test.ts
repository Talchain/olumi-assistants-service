/**
 * Stage-vocabulary derivation guard for the V2 response envelope validator.
 *
 * `@talchain/schemas` 0.19.0 (UI-SEM-020) declares the CANONICAL
 * `stage_indicator` vocabulary — frame | analyse | decide | review — and
 * states explicitly that consumers MUST derive their stage type from the
 * `Stage` export; a hand-maintained mirror of the list is the known drift
 * defect. This suite pins `OrchestratorResponseEnvelopeV2Schema` to that
 * rule:
 *
 *   1. every canonical member is ACCEPTED (iterated from `Stage.options`,
 *      never hand-listed, so a future canonical addition is covered
 *      automatically);
 *   2. every RETIRED 5-stage member (ideate / evaluate / optimise) is
 *      REJECTED — on `stage` and on `transition.from` / `transition.to`;
 *   3. the schema's accepted vocabulary EQUALS `Stage.options` exactly
 *      (introspected, so re-hardcoding a copy that later drifts fails).
 *
 * Written RED-first: at staging 73c303d9 the envelope validator carried
 * `z.enum(['frame','ideate','evaluate','decide','optimise'])` at three
 * sites and this suite failed — proving the retired vocabulary was
 * accepted on the contract surface shared with the UI repo.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Stage } from "@talchain/schemas/boundary";

import { OrchestratorResponseEnvelopeV2Schema } from "../../src/orchestrator/validation/response-envelope-schema.js";

/** Retired members of the pre-0.19.0 5-stage vocabulary (canonical members excluded). */
const RETIRED_STAGE_MEMBERS = ["ideate", "evaluate", "optimise"] as const;

function envelopeWithStage(stage: string, transition?: { from: string; to: string }): unknown {
  return {
    turn_id: "t-stage-vocab",
    assistant_text: "vocabulary probe",
    blocks: [],
    suggested_actions: [],
    lineage: { context_hash: "abc123", dsk_version_hash: null },
    stage_indicator: {
      stage,
      confidence: "high",
      source: "inferred",
      ...(transition ? { transition: { ...transition, trigger: "probe" } } : {}),
    },
    science_ledger: {
      claims_used: [],
      techniques_used: [],
      scope_violations: [],
      phrasing_violations: [],
      rewrite_applied: false,
    },
    progress_marker: { kind: "none" },
    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: "explain",
      specialist_contributions: [],
      specialist_disagreement: null,
    },
    turn_plan: { selected_tool: null, routing: "deterministic", long_running: false },
    guidance_items: [],
  };
}

/** Introspect the enum at stage_indicator.stage. */
function stageEnum(): z.ZodEnum<[string, ...string[]]> {
  const stageIndicator = OrchestratorResponseEnvelopeV2Schema.shape.stage_indicator as z.ZodObject<z.ZodRawShape>;
  return stageIndicator.shape.stage as z.ZodEnum<[string, ...string[]]>;
}

/** Introspect the from/to enums inside the optional transition object. */
function transitionEnums(): { from: z.ZodEnum<[string, ...string[]]>; to: z.ZodEnum<[string, ...string[]]> } {
  const stageIndicator = OrchestratorResponseEnvelopeV2Schema.shape.stage_indicator as z.ZodObject<z.ZodRawShape>;
  const transition = (stageIndicator.shape.transition as z.ZodOptional<z.ZodObject<z.ZodRawShape>>).unwrap();
  return {
    from: transition.shape.from as z.ZodEnum<[string, ...string[]]>,
    to: transition.shape.to as z.ZodEnum<[string, ...string[]]>,
  };
}

describe("OrchestratorResponseEnvelopeV2Schema stage vocabulary", () => {
  describe("accepts every canonical Stage member (derived from @talchain/schemas)", () => {
    for (const member of Stage.options) {
      it(`accepts stage '${member}'`, () => {
        const result = OrchestratorResponseEnvelopeV2Schema.safeParse(envelopeWithStage(member));
        expect(result.success).toBe(true);
      });

      it(`accepts transition '${member}' -> '${member}'`, () => {
        const result = OrchestratorResponseEnvelopeV2Schema.safeParse(
          envelopeWithStage(member, { from: member, to: member }),
        );
        expect(result.success).toBe(true);
      });
    }
  });

  describe("rejects every retired 5-stage member", () => {
    for (const retired of RETIRED_STAGE_MEMBERS) {
      it(`rejects stage '${retired}'`, () => {
        const result = OrchestratorResponseEnvelopeV2Schema.safeParse(envelopeWithStage(retired));
        expect(result.success).toBe(false);
      });

      it(`rejects transition carrying '${retired}'`, () => {
        const result = OrchestratorResponseEnvelopeV2Schema.safeParse(
          envelopeWithStage(Stage.options[0], { from: retired, to: retired }),
        );
        expect(result.success).toBe(false);
      });
    }
  });

  describe("vocabulary is derived, not mirrored", () => {
    it("stage enum options equal Stage.options exactly", () => {
      expect(stageEnum().options).toEqual(Stage.options);
    });

    it("transition.from / transition.to options equal Stage.options exactly", () => {
      const { from, to } = transitionEnums();
      expect(from.options).toEqual(Stage.options);
      expect(to.options).toEqual(Stage.options);
    });
  });
});
