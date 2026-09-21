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
import type { ZodIssue } from "zod";

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
function unionBranchDetail(issues: ReadonlyArray<ZodIssue>, cap = 3): Array<{
  path: string;
  branch_messages: string[];
}> {
  const out: Array<{ path: string; branch_messages: string[] }> = [];
  for (const issue of issues) {
    if (out.length >= cap) break;
    if (issue?.code !== "invalid_union") continue;
    const unionErrors = (issue as { unionErrors?: ReadonlyArray<{ issues?: ReadonlyArray<ZodIssue> }> })
      .unionErrors;
    if (!Array.isArray(unionErrors)) continue;
    const branchMessages: string[] = [];
    for (const branch of unionErrors) {
      for (const bIssue of branch?.issues ?? []) {
        const bPath = Array.isArray(bIssue?.path) ? bIssue.path.join(".") : "";
        branchMessages.push(`${bIssue?.code ?? "?"}@${bPath || "<root>"}: ${bIssue?.message ?? ""}`);
      }
    }
    out.push({
      path: Array.isArray(issue.path) ? issue.path.join(".") : "",
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

  // ⚠ `.parse()` in a try/catch, NOT `.safeParse()`. 33 suites mock
  // `DraftGraphOutput` with an object exposing only `.parse`, so calling
  // `.safeParse` here throws `TypeError: DraftGraphOutput.safeParse is not a
  // function` and takes them all down. The thrown ZodError carries the same
  // `issues`, so nothing is lost by reading it from the catch.
  let zodError: { issues?: ZodIssue[] } | undefined;
  try {
    DraftGraphOutput.parse(input);
    return;
  } catch (error) {
    zodError = (error as { issues?: ZodIssue[] })?.issues ? (error as { issues?: ZodIssue[] }) : undefined;
  }

  const issues = zodError?.issues ?? [];
  const issueCount = issues.length;
  const firstIssues = zodError ? extractZodIssues(zodError as never, 3) : [];
  const unionDetail = unionBranchDetail(issues);

  // Only reached on a path whose current outcome is a guaranteed 500, and only
  // acts when EVERY issue is an optional `observed_state`. Declines otherwise,
  // leaving the emission below byte-identical to before this existed.
  const salvage = salvageObservedState(input, issues);
  // ⚠ THE EVENT NAME IS DELIBERATELY UNCHANGED ON BOTH PATHS. An earlier draft
  // emitted a NEW event name when the salvage succeeded, which would have made
  // any counter keyed on `cee.structural_parse.failed` fall — a metric that
  // improves because the telemetry moved, not because the product did (trap 23,
  // and the in-repo consumer search cannot see dashboards or alerts). The parse
  // DID fail in both cases; what differs is the consequence to the user. So the
  // event stays, the failure keeps being counted honestly, and `salvaged`
  // carries the new fact.
  log.warn({
    event: "cee.structural_parse.failed",
    salvaged: salvage.salvaged,
    error_count: issueCount,
    first_issues: firstIssues,
    union_branch_detail: unionDetail,
    ...(salvage.salvaged
      ? {
          stripped: salvage.stripped,
          stripped_constraint_nodes: salvage.stripped.filter((n) => n.node_kind === "constraint").length,
        }
      : { salvage_declined: salvage.declined_reason }),
    request_id: ctx.requestId,
  }, salvage.salvaged
    ? "Structural parse failed on optional observed_state only — field shed, model preserved"
    : "Structural parse failed — graph does not conform to DraftGraphOutput schema");

  if (salvage.salvaged) return;

  ctx.earlyReturn = {
    statusCode: 400,
    body: buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed structural validation", {
      requestId: ctx.requestId,
    }),
  };
}
