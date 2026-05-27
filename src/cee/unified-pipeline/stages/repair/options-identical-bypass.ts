/**
 * Substep 1.5: Pre-LLM-repair fail-fast gate for OPTIONS_IDENTICAL.
 *
 * RATIONALE
 *
 * `OPTIONS_IDENTICAL` is a Bucket C semantic violation (deterministic-sweep
 * line 68) — the deterministic sweep cannot fix it, so the pipeline previously
 * routed every OPTIONS_IDENTICAL case to `repair_graph` (GPT-4.1) via the
 * PLoT-validation substep. In staging traffic this LLM repair call has
 * repeatedly failed revalidation for this class: the model typically fixes
 * other structural issues but leaves intervention values unchanged, so the
 * post-repair validator re-emits OPTIONS_IDENTICAL, the pipeline falls back
 * to `simpleRepair()` (which has no intervention-synthesis logic either),
 * and the user sees a generic 400 CEE_GRAPH_INVALID after ~30s of wasted
 * repair latency — a user-hostile failure mode.
 *
 * This gate detects OPTIONS_IDENTICAL after the deterministic sweep and
 * bypasses the LLM repair call entirely, emitting a fail-fast
 * CEE_GRAPH_INVALID with a clarification-shaped recovery payload that
 * names the offending option IDs and asks the user for distinct values
 * per option. Other Bucket C codes (NO_PATH_TO_GOAL, NO_EFFECT_PATH, etc.)
 * continue to route through LLM repair — only OPTIONS_IDENTICAL is gated.
 *
 * The wire envelope is plumbed by route-v2.ts's typed-pipeline-error
 * mapping (PR #201): `details.reason = "draft_graph_cee_graph_invalid"`,
 * `details.recovery` populated with `suggestion` + `hints`,
 * `details.pipeline_error_code = "CEE_GRAPH_INVALID"`. HTTP 500 preserved.
 *
 * NO partial graph is persisted: setting `ctx.earlyReturn` with a 400
 * statusCode causes `runUnifiedPipeline` to return non-200, which causes
 * `handleDraftGraph` to throw, which causes `dispatchDraftGraph`'s outer
 * catch to re-throw BEFORE the commit step runs.
 */

import type { StageContext } from "../../types.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";
import { buildCeeErrorResponse } from "../../../validation/pipeline.js";

const VIOLATION_CODE = "OPTIONS_IDENTICAL";

interface OptionsIdenticalContext {
  readonly optionIds?: readonly string[];
  readonly signature?: string;
}

/**
 * Fail-fast gate for OPTIONS_IDENTICAL. Sets `ctx.earlyReturn` with a 400
 * CEE_GRAPH_INVALID envelope and returns true when the gate fires;
 * returns false otherwise (no side effects).
 */
export function runOptionsIdenticalBypass(ctx: StageContext): boolean {
  const violation = (ctx.remainingViolations ?? []).find(
    (v) => v.code === VIOLATION_CODE,
  );
  if (!violation) return false;

  // Extract diagnostic detail from the validator's context (preserved by
  // deterministic-sweep step 9 into ctx.remainingViolations[i].context).
  const violationContext = (violation.context ?? {}) as OptionsIdenticalContext;
  const identicalOptionIds: string[] = Array.isArray(violationContext.optionIds)
    ? violationContext.optionIds.filter((id): id is string => typeof id === "string")
    : [];
  const interventionSignature: string | null =
    typeof violationContext.signature === "string" ? violationContext.signature : null;

  // Build the user-facing recovery payload. Copy is intentionally
  // generic-but-specific: pricing is the most common trigger (per the
  // failing staging traffic) but the same wording covers any decision
  // where options need distinct numeric or qualitative differentiators.
  const recovery = {
    suggestion:
      "Your options need at least one distinct value to compare. " +
      "For a pricing decision, give a price for each option " +
      "(e.g. Low = £49/month, Mid = £99/month, High = £199/month).",
    hints: [
      "Give each option at least one unique value (price, headcount, timeline, scope).",
      "Use specific numbers rather than vague descriptions.",
      "Or describe how each option differs from the others in plain language.",
    ],
  };

  const errorBody = buildCeeErrorResponse(
    "CEE_GRAPH_INVALID",
    "Options need at least one distinct value to compare",
    {
      requestId: ctx.requestId,
      reason: "options_identical_unrepairable_by_llm",
      recovery,
    },
  );

  // Surface diagnostic data in details so dashboards can split this
  // failure mode from generic CEE_GRAPH_INVALID and operators can see
  // the offending option IDs without parsing free-text messages.
  // `details` is `.passthrough()` on CEEErrorResponseV1, so this is
  // additive and schema-safe.
  const details = ((errorBody as Record<string, unknown>).details ?? {}) as Record<string, unknown>;
  details.violation_code = VIOLATION_CODE;
  details.identical_option_ids = identicalOptionIds;
  if (interventionSignature !== null) {
    details.intervention_signature = interventionSignature;
  }
  details.repair_skip_reason = "options_identical_unrepairable_by_llm";
  (errorBody as Record<string, unknown>).details = details;

  // Record on pipelineOutcome.warnings so the diagnostics layer sees the
  // bypass. `degraded: false` indicates this is a hard fail (no graph
  // persisted), not a soft-degraded continue.
  ctx.pipelineOutcome.warnings.push({
    stage: "repair",
    error: `OPTIONS_IDENTICAL bypassed LLM repair (options: ${identicalOptionIds.join(", ") || "unknown"})`,
    degraded: false,
  });

  log.warn(
    {
      event: "cee.options_identical.pre_repair_bypass",
      request_id: ctx.requestId,
      identical_option_ids: identicalOptionIds,
      intervention_signature: interventionSignature,
    },
    "OPTIONS_IDENTICAL detected after deterministic sweep — bypassing LLM repair, returning fail-fast CEE_GRAPH_INVALID",
  );
  emit(TelemetryEvents.CeeOptionsIdenticalBypass, {
    request_id: ctx.requestId,
    identical_option_ids_count: identicalOptionIds.length,
    has_signature: interventionSignature !== null,
  });

  ctx.earlyReturn = {
    statusCode: 400,
    body: errorBody,
  };
  return true;
}
