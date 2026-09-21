/**
 * Stage 4 Substep 10: Structural parse (Zod safety net)
 *
 * Uses DraftGraphOutput.parse() to validate the final graph state.
 * This catches any schema violations before Stage 5 (Package).
 *
 * Note: DraftGraphOutput and its nested Graph/Node/Edge schemas all use
 * .passthrough(), so additive fields survive Zod validation here.
 * The parse is validation-only — ctx.graph is not replaced with the
 * parsed result, so no fields are actually stripped, EXCEPT by the
 * observed_state salvage below, which deletes only that one optional field
 * and only when doing so turns a guaranteed 500 into a usable model.
 */

import type { StageContext } from "../../types.js";
import { DraftGraphOutput } from "../../../../schemas/assist.js";
import { buildCeeErrorResponse } from "../../../validation/pipeline.js";
import { extractZodIssues } from "../../../../schemas/llmExtraction.js";
import { log } from "../../../../utils/telemetry.js";
import { salvageObservedState } from "./observed-state-salvage.js";

/**
 * `extractZodIssues` keeps `path`/`message`/`code` and DISCARDS `unionErrors`.
 * For `invalid_union` — 20 of 20 issues in the 2026-09-21 census — the reason
 * each branch refused the value lives ONLY in `unionErrors`, so the shipped
 * diagnostic was blind exactly where the answer was. This adds that detail for
 * this emitter alone; the shared extractor is left untouched so the other three
 * call sites' log volume is unchanged.
 */
function unionBranchDetail(issues: ReadonlyArray<Record<string, unknown>>, cap = 3): Array<{
  path: string;
  branch_messages: string[];
}> {
  const out: Array<{ path: string; branch_messages: string[] }> = [];
  for (const issue of issues) {
    if (out.length >= cap) break;
    if (issue?.code !== "invalid_union") continue;
    const unionErrors = (issue as any).unionErrors;
    if (!Array.isArray(unionErrors)) continue;
    const branchMessages: string[] = [];
    for (const branch of unionErrors) {
      for (const bIssue of branch?.issues ?? []) {
        const bPath = Array.isArray(bIssue?.path) ? bIssue.path.join(".") : "";
        branchMessages.push(`${bIssue?.code ?? "?"}@${bPath || "<root>"}: ${bIssue?.message ?? ""}`);
      }
    }
    out.push({
      path: Array.isArray(issue.path) ? (issue.path as unknown[]).join(".") : "",
      branch_messages: branchMessages.slice(0, 6),
    });
  }
  return out;
}

export function runStructuralParse(ctx: StageContext): void {
  if (!ctx.graph) return;

  const input = {
    graph: ctx.graph,
    rationales: ctx.rationales,
    confidence: ctx.confidence,
    goal_constraints: ctx.goalConstraints,
  };

  const parsed = DraftGraphOutput.safeParse(input);
  if (parsed.success) return;

  const zodError = parsed.error;
  const issues = zodError.issues ?? [];
  const issueCount = issues.length;
  const firstIssues = extractZodIssues(zodError, 3);
  const unionDetail = unionBranchDetail(issues as unknown as Array<Record<string, unknown>>);

  // Only reached on a path whose current outcome is a guaranteed 500, and only
  // acts when EVERY issue is an optional `observed_state`. Declines otherwise,
  // leaving the emission below byte-identical to before this existed.
  const salvage = salvageObservedState(input, issues as unknown as Array<{ path?: unknown; code?: unknown }>);
  if (salvage.salvaged) {
    log.warn({
      event: "cee.structural_parse.observed_state_salvaged",
      error_count: issueCount,
      first_issues: firstIssues,
      union_branch_detail: unionDetail,
      stripped: salvage.stripped,
      stripped_constraint_nodes: salvage.stripped.filter((s) => s.node_kind === "constraint").length,
      request_id: ctx.requestId,
    }, "Structural parse failed on optional observed_state only — field shed, model preserved");
    return;
  }

  log.warn({
    event: "cee.structural_parse.failed",
    error_count: issueCount,
    first_issues: firstIssues,
    union_branch_detail: unionDetail,
    salvage_declined: salvage.declined_reason,
    request_id: ctx.requestId,
  }, "Structural parse failed — graph does not conform to DraftGraphOutput schema");

  ctx.earlyReturn = {
    statusCode: 400,
    body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed structural validation", {
      requestId: ctx.requestId,
    }),
  };
}
