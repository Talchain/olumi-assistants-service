/**
 * Stage 4 Substep 10: Structural parse (Zod safety net)
 *
 * Uses DraftGraphOutput.parse() to validate the final graph state.
 * This catches any schema violations before Stage 5 (Package).
 */

import type { StageContext } from "../../types.js";
import { DraftGraphOutput } from "../../../../schemas/assist.js";
import { buildCeeErrorResponse } from "../../../validation/pipeline.js";
import { extractZodIssues } from "../../../../schemas/llmExtraction.js";
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
    const zodError = (error as any)?.issues ? (error as any) : undefined;
    const issueCount = zodError?.issues?.length ?? 0;
    const firstIssues = zodError ? extractZodIssues(zodError, 3) : [];
    log.warn({
      event: "cee.structural_parse.failed",
      error_count: issueCount,
      first_issues: firstIssues,
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
