/**
 * Stage 4 Substep 10: Structural parse (Zod safety net)
 *
 * Uses DraftGraphOutput.parse() to validate the final graph state.
 * This catches any schema violations before Stage 5 (Package).
 */

import type { StageContext } from "../../types.js";
import { DraftGraphOutput } from "../../../../schemas/assist.js";
import { buildCeeErrorResponse } from "../../../validation/pipeline.js";
import { log } from "../../../../utils/telemetry.js";

export function runStructuralParse(ctx: StageContext): void {
  if (!ctx.graph) return;

  const input = {
    graph: ctx.graph,
    rationales: ctx.rationales,
    confidence: ctx.confidence,
    goal_constraints: ctx.goalConstraints,
  };

  try {
    DraftGraphOutput.parse(input);
  } catch (error) {
    const zodErrors = (error as any)?.errors ?? (error as any)?.issues;
    const firstIssue = Array.isArray(zodErrors) ? zodErrors[0] : undefined;
    log.warn({
      event: "cee.structural_parse.failed",
      error_count: zodErrors?.length ?? 0,
      first_issue_path: firstIssue?.path?.join("."),
      first_issue_message: firstIssue?.message,
      first_issue_code: firstIssue?.code,
      first_issue_expected: (firstIssue as any)?.expected,
      first_issue_received: (firstIssue as any)?.received,
      request_id: ctx.requestId,
    }, "Structural parse failed — graph does not conform to DraftGraphOutput schema");

    ctx.earlyReturn = {
      statusCode: 400,
      body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed structural validation", {
        requestId: ctx.requestId,
      }),
    };
  }
}
