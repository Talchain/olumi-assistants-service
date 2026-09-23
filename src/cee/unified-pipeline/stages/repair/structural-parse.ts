/**
 * Stage 4 Substep 10: Structural parse (Zod safety net)
 *
 * Uses DraftGraphOutput.parse() to validate the final graph state.
 * This catches any schema violations before Stage 5 (Package).
 *
 * Note: DraftGraphOutput and its nested Graph/Node/Edge schemas all use
 * .passthrough(), so additive fields survive Zod validation here.
 * The parse is validation-only — ctx.graph is not replaced with the
 * parsed result, so no fields are actually stripped.
 */

import type { StageContext } from "../../types.js";
import { DraftGraphOutput } from "../../../../schemas/assist.js";
import { buildCeeErrorResponse } from "../../../validation/pipeline.js";
import { extractZodIssues } from "../../../../schemas/llmExtraction.js";
import { log } from "../../../../utils/telemetry.js";

/**
 * Describe the node an issue path points at, WITHOUT logging any user content.
 *
 * ⚠ THIS EXISTS BECAUSE THE LOG COULD NOT NAME THE DEFECT. `extractZodIssues`
 * keeps only {path, message, code} and drops zod's `unionErrors`, and
 * `invalid_union` carries no `expected`/`received`. A failing graph is never
 * persisted (`v5_conversation_turns`: 0 rows for failing scenarios, 2 for a
 * success control) and Langfuse held no traces, so across 9 captured staging
 * failures the offending VALUE was unobtainable from the server by any route.
 * The field was named; the reason never was.
 *
 * Emits identity and SHAPE only — node id, kind, the field's key set and the
 * types of its members. Never a value: a factor's observed_state carries the
 * user's own magnitudes, which do not belong in logs.
 */
function describeIssueNode(
  graph: unknown,
  path: string,
): Record<string, unknown> | undefined {
  const m = /^graph\.nodes\.(\d+)(?:\.(.+))?$/.exec(path);
  if (!m) return undefined;
  const nodes = (graph as { nodes?: unknown } | undefined)?.nodes;
  if (!Array.isArray(nodes)) return undefined;
  const node = nodes[Number(m[1])] as Record<string, unknown> | undefined;
  if (node === undefined || node === null) return undefined;

  const out: Record<string, unknown> = {
    path,
    node_id: typeof node.id === "string" ? node.id : null,
    node_kind: typeof node.kind === "string" ? node.kind : null,
  };

  const field = m[2];
  if (field === undefined) return out;
  const value = node[field.split(".")[0]];
  out.field = field;
  out.field_type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    out.field_keys = Object.keys(obj).slice(0, 12);
    out.member_types = Object.fromEntries(
      Object.keys(obj)
        .slice(0, 12)
        .map((k) => [
          k,
          obj[k] === null
            ? "null"
            : typeof obj[k] === "number" && !Number.isFinite(obj[k] as number)
              ? "non-finite-number"
              : typeof obj[k],
        ]),
    );
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

  try {
    DraftGraphOutput.parse(input);
  } catch (error) {
    const zodError = (error as any)?.issues ? (error as any) : undefined;
    const issueCount = zodError?.issues?.length ?? 0;
    const firstIssues = zodError ? extractZodIssues(zodError, 3) : [];
    const issueNodes = firstIssues
      .map((i) => describeIssueNode(ctx.graph, String((i as { path?: unknown }).path ?? "")))
      .filter((d): d is Record<string, unknown> => d !== undefined);
    log.warn({
      event: "cee.structural_parse.failed",
      error_count: issueCount,
      first_issues: firstIssues,
      issue_nodes: issueNodes,
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
