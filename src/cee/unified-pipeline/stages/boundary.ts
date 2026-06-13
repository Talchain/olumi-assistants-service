/**
 * Stage 6: Boundary — V3/V2/V1 transform + analysis_ready + model_adjustments
 *
 * Source: Route handler lines 453-524
 * This is the final stage — it produces the HTTP response body.
 * The route handler MUST NOT post-process the response.
 */

import type { StageContext } from "../types.js";
import { transformResponseToV3, validateStrictModeV3 } from "../../transforms/schema-v3.js";
import { transformResponseToV2 } from "../../transforms/schema-v2.js";
import { mapMutationsToAdjustments, extractConstraintDropBlockers } from "../../transforms/analysis-ready.js";
import { CEEGraphResponseV3, warnOnUnknownV3Fields } from "../../../schemas/cee-v3.js";
import { extractZodIssues } from "../../../schemas/llmExtraction.js";
import { log, emit, TelemetryEvents } from "../../../utils/telemetry.js";
import { config } from "../../../config/index.js";
import { getRuntimeEnv } from "../../../config/env-resolver.js";
import { runGraphDataIntegrityChecks } from "../../transforms/graph-data-integrity.js";
import { computeDiagnosticChecks } from "../../observability/diagnostic-checks.js";
import { buildCeeErrorResponse } from "../../validation/pipeline.js";

export async function runStageBoundary(ctx: StageContext): Promise<void> {
  log.info({ requestId: ctx.requestId, stage: "boundary" }, "Unified pipeline: Stage 6 (Boundary) started");

  if (!ctx.ceeResponse) {
    // Stage 5 didn't produce a response (early return already handled)
    return;
  }

  const schemaVersion = ctx.opts.schemaVersion;

  if (schemaVersion === "v3") {
    // V3 transform
    const v3Body = transformResponseToV3(ctx.ceeResponse as any, {
      brief: ctx.input.brief,
      requestId: ctx.requestId,
      strictMode: ctx.opts.strictMode,
      includeDebug: ctx.opts.includeDebug,
    });

    // ── Graph data integrity checks (post-V3-transform, pre-validation) ─────
    // Runs three deterministic corrections:
    // 1. Factor scale consistency: assert value ≈ raw_value/cap (or raw_value/100 for "%").
    //    Corrects observed_state.value and matching analysis_ready.options interventions.
    // 2. Edge field defaults: ensure exists_probability and effect_direction are present.
    //    Structural edges default to 1.0/"positive"; causal to 0.8/sign-inferred.
    // 3. Observed-root intercept doctrine: remove duplicate `intercept = observed_state.value`
    //    from observed root nodes (ISL evaluates non-intervened roots as value + intercept,
    //    so the duplicate doubles the baseline). Never assigns intercepts.
    // Mutations are logged in trace.pipeline.repair_summary.graph_data_integrity.
    const integrityRepairs = runGraphDataIntegrityChecks(v3Body, ctx.requestId);
    if (
      integrityRepairs.scale_consistency_repairs.length > 0 ||
      integrityRepairs.edge_field_repairs.length > 0 ||
      integrityRepairs.intercept_population_repairs.length > 0
    ) {
      // Attach to pipeline trace so debug bundles capture the corrections.
      const pipelineTrace = (v3Body as any)?.trace?.pipeline;
      if (pipelineTrace && typeof pipelineTrace === "object") {
        const repairSummary = (pipelineTrace as any).repair_summary;
        if (repairSummary && typeof repairSummary === "object") {
          (repairSummary as any).graph_data_integrity = integrityRepairs;
        } else {
          (pipelineTrace as any).repair_summary = { graph_data_integrity: integrityRepairs };
        }
      }
    }

    // Surface STRP/repair mutations as model_adjustments (match route handler lines 500-519)
    const v1Trace = (ctx.ceeResponse as any).trace;
    const strpMutations = v1Trace?.strp?.mutations;
    const graphCorrections = v1Trace?.corrections;
    if (v3Body.analysis_ready && (strpMutations?.length || graphCorrections?.length)) {
      // Build nodeLabels from v3Body.nodes (ROOT level, not v3Body.graph)
      const nodeLabels = new Map<string, string>();
      const graphNodes = (v3Body as any)?.nodes;
      if (Array.isArray(graphNodes)) {
        for (const node of graphNodes) {
          if (node?.id && node?.label) {
            nodeLabels.set(node.id, node.label);
          }
        }
      }
      const adjustments = mapMutationsToAdjustments(strpMutations, graphCorrections, nodeLabels);
      if (adjustments.length > 0) {
        v3Body.analysis_ready.model_adjustments = adjustments;
      }
    }

    // Append deterministic sweep reclassifications as model_adjustments.
    // Only UNREACHABLE_FACTOR_RECLASSIFIED repairs are user-visible — other codes
    // (NAN_VALUE, SIGN_MISMATCH, etc.) are mechanical fixes the user doesn't need to review.
    // Expand REPAIR_CODE_TO_ADJUSTMENT intentionally when new user-visible repairs are added.
    if (v3Body.analysis_ready) {
      const REPAIR_CODE_TO_ADJUSTMENT: Record<string, "category_reclassified"> = {
        UNREACHABLE_FACTOR_RECLASSIFIED: "category_reclassified",
      };

      const repairAdjustments = (ctx.deterministicRepairs ?? [])
        .filter((r) => r.code in REPAIR_CODE_TO_ADJUSTMENT)
        .map((r) => {
          // Extract node_id from path format "nodes[fac_x].category"
          const nodeIdMatch = r.path.match(/^nodes\[([^\]]+)\]/);
          return {
            code: REPAIR_CODE_TO_ADJUSTMENT[r.code],
            node_id: nodeIdMatch?.[1],
            field: r.path,
            reason: r.action,
            source: "deterministic_sweep" as const,
          };
        });

      if (!v3Body.analysis_ready.model_adjustments) {
        v3Body.analysis_ready.model_adjustments = [];
      }
      v3Body.analysis_ready.model_adjustments.push(...repairAdjustments);
    }

    // Attach bias_findings to analysis_ready (from V1 payload → analysis_ready block)
    if (v3Body.analysis_ready) {
      const v1BiasFindings = (ctx.ceeResponse as any)?.bias_findings;
      (v3Body.analysis_ready as any).bias_findings = Array.isArray(v1BiasFindings)
        ? v1BiasFindings
        : [];
    }

    // Surface STRP constraint drops as blockers
    if (v3Body.analysis_ready && strpMutations?.length) {
      const constraintBlockers = extractConstraintDropBlockers(strpMutations);
      if (constraintBlockers.length > 0) {
        if (!v3Body.analysis_ready.blockers) v3Body.analysis_ready.blockers = [];
        v3Body.analysis_ready.blockers.push(...constraintBlockers);
      }
    }

    // Strict mode validation (fail-closed per boundary contract v1.1 §4.2).
    // Previously a soft-gate log-and-continue; now sets ctx.earlyReturn with
    // HTTP 502 and a CEE_EGRESS_CONTRACT_VIOLATION envelope carrying
    // reason='egress_contract_violation' plus the validator tag.
    if (ctx.opts.strictMode) {
      try {
        validateStrictModeV3(v3Body);
      } catch (err) {
        const errMsg = (err as Error).message;
        log.warn({
          event: "pipeline.boundary_fail_closed",
          stage: "boundary_strict_mode",
          error: errMsg,
          request_id: ctx.requestId,
        }, "V3 strict mode validation failed — fail-closed per boundary contract");

        // Emit telemetry event with the new consolidated error code.
        emit(TelemetryEvents.CeeBoundaryBlocked, {
          request_id: ctx.requestId,
          error_code: "CEE_EGRESS_CONTRACT_VIOLATION",
          error_message: errMsg,
          validation_issues: [],
          graph_hash: (v3Body as any)?.meta?.graph_hash,
        });

        ctx.pipelineOutcome.warnings.push({
          stage: 'boundary_strict_mode',
          error: errMsg,
          degraded: false,
          blocked: true,
        });

        ctx.earlyReturn = {
          statusCode: 502,
          body: buildCeeErrorResponse(
            "CEE_EGRESS_CONTRACT_VIOLATION",
            `Egress contract violation (strict_mode_v3): ${errMsg}`,
            {
              requestId: ctx.requestId,
              retryable: false,
              reason: "egress_contract_violation",
              details: { validator: "strict_mode_v3", boundary: "B1", direction: "response" },
              stage: "boundary",
            },
          ),
        };
        return;
      }
    }

    // ── Diagnostic checks — debug bundle integrity verification ────────────
    // Compute after all transforms and integrity checks so the checks reflect
    // the actual final data state. Attached to trace.pipeline for debug bundles.
    // Runs BEFORE Zod parse so diagnostics are included in the validated output.
    const diagnosticTrace = (v3Body as any)?.trace?.pipeline;
    if (diagnosticTrace && typeof diagnosticTrace === 'object') {
      (diagnosticTrace as Record<string, unknown>).diagnostic_checks =
        computeDiagnosticChecks(v3Body as unknown as Record<string, unknown>, diagnosticTrace as Record<string, unknown>);
    }

    // CIL Phase 1: log unknown fields BEFORE parse so drift is observable.
    // Aggregates unknown keys across response root, all nodes, and all edges
    // into a single structured log entry per parse call (not per element) to
    // keep log volume bounded.
    {
      const unknownByLevel: {
        response: string[]
        nodes: Array<{ nodeId?: string; keys: string[] }>
        edges: Array<{ from?: string; to?: string; keys: string[] }>
      } = { response: [], nodes: [], edges: [] }

      warnOnUnknownV3Fields(
        v3Body as unknown as Record<string, unknown>,
        "CEEGraphResponseV3",
        (payload) => { unknownByLevel.response = payload.unknownKeys },
      )

      const v3Nodes = (v3Body as any)?.nodes
      if (Array.isArray(v3Nodes)) {
        for (const node of v3Nodes) {
          if (node && typeof node === "object") {
            warnOnUnknownV3Fields(
              node as Record<string, unknown>,
              "NodeV3",
              (payload) => unknownByLevel.nodes.push({
                nodeId: payload.nodeId,
                keys: payload.unknownKeys,
              }),
            )
          }
        }
      }

      const v3Edges = (v3Body as any)?.edges
      if (Array.isArray(v3Edges)) {
        for (const edge of v3Edges) {
          if (edge && typeof edge === "object") {
            warnOnUnknownV3Fields(
              edge as Record<string, unknown>,
              "EdgeV3",
              (payload) => unknownByLevel.edges.push({
                from: typeof (edge as any).from === "string" ? (edge as any).from : undefined,
                to: typeof (edge as any).to === "string" ? (edge as any).to : undefined,
                keys: payload.unknownKeys,
              }),
            )
          }
        }
      }

      const totalUnknown =
        unknownByLevel.response.length +
        unknownByLevel.nodes.length +
        unknownByLevel.edges.length
      if (totalUnknown > 0) {
        log.warn({
          event: "cee.v3_schema.unknown_fields_stripped",
          request_id: ctx.requestId,
          response_unknown_keys: unknownByLevel.response,
          node_unknowns: unknownByLevel.nodes,
          edge_unknowns: unknownByLevel.edges,
          total_unknown_levels: totalUnknown,
        }, "V3 egress schema dropped undeclared fields — investigate schema drift")
      }
    }

    // Belt-and-suspenders: validate V3 output before returning.
    // CIL Phase 1: when parse succeeds, use parseResult.data — Zod strips
    // undeclared fields (e.g. _retry_suggestion) so internal metadata doesn't
    // leak to API clients. On failure, fail closed per boundary contract v1.1 §4.2
    // (a dev escape hatch remains via CEE_BOUNDARY_ALLOW_INVALID for local work).
    const parseResult = CEEGraphResponseV3.safeParse(v3Body);
    if (parseResult.success) {
      ctx.finalResponse = parseResult.data;
      return;
    }

    // Validation failed: emit telemetry and set a typed earlyReturn (502).
    // The dev escape hatch (config.cee.boundaryAllowInvalid) still permits
    // passthrough in local/test; staging and production cannot enable it.
    const runtimeEnv = getRuntimeEnv();
    const allowInvalid = config.cee.boundaryAllowInvalid;

    const validationIssues = extractZodIssues(parseResult.error, 5);
    const errMsg = `V3 schema validation failed: ${parseResult.error.issues.length} issues`;

    // Dev escape hatch: allow invalid graphs in local/test if explicitly enabled
    // (Config-level enforcement already prevents this flag from being true in staging/prod)
    if (allowInvalid) {
      log.warn({
        event: "cee.boundary.output_validation_failed",
        error_count: parseResult.error.issues.length,
        first_issues: extractZodIssues(parseResult.error, 3),
        request_id: ctx.requestId,
        dev_override_active: true,
        runtime_env: runtimeEnv,
      }, "V3 output failed schema validation (bypassed via CEE_BOUNDARY_ALLOW_INVALID)");
      ctx.finalResponse = v3Body;
      return;
    }

    // Fail-closed per boundary contract v1.1 §4.2 (was: Track 1 soft gate).
    log.warn({
      event: "pipeline.boundary_fail_closed",
      stage: "boundary_v3_validation",
      error_count: parseResult.error.issues.length,
      first_issues: extractZodIssues(parseResult.error, 3),
      request_id: ctx.requestId,
      runtime_env: runtimeEnv,
    }, "V3 output failed schema validation — fail-closed per boundary contract");

    // Emit telemetry event with the new consolidated error code.
    emit(TelemetryEvents.CeeBoundaryBlocked, {
      request_id: ctx.requestId,
      error_code: "CEE_EGRESS_CONTRACT_VIOLATION",
      error_message: errMsg,
      validation_issues: validationIssues,
      graph_hash: (v3Body as any)?.meta?.graph_hash,
    });

    ctx.pipelineOutcome.warnings.push({
      stage: 'boundary_v3_validation',
      error: errMsg,
      degraded: false,
      blocked: true,
    });

    ctx.earlyReturn = {
      statusCode: 502,
      body: buildCeeErrorResponse(
        "CEE_EGRESS_CONTRACT_VIOLATION",
        `Egress contract violation (zod_v3): ${errMsg}`,
        {
          requestId: ctx.requestId,
          retryable: false,
          reason: "egress_contract_violation",
          details: {
            validator: "zod_v3",
            boundary: "B1",
            direction: "response",
            issue_count: parseResult.error.issues.length,
            validation_issues: validationIssues,
          },
          stage: "boundary",
        },
      ),
    };
    return;
  } else if (schemaVersion === "v2") {
    ctx.finalResponse = transformResponseToV2(ctx.ceeResponse as any);
  } else {
    // V1 pass through
    ctx.finalResponse = ctx.ceeResponse;
  }
}
