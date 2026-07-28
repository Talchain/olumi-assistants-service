import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assessGraphReadiness } from "../cee/graph-readiness/index.js";
import type { GraphReadinessAssessment } from "../cee/graph-readiness/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { Graph } from "../schemas/graph.js";
import { AnalysisReadyPayload, type AnalysisReadyPayloadT } from "../schemas/analysis-ready.js";
import {
  computeScaffoldPlan,
  type ScaffoldPlan,
} from "../orchestrator-v5/tools/handlers/scaffold-unconfigured-options.js";

import type { GraphV1 } from "../contracts/plot/engine.js";

interface CEETraceMeta {
  request_id?: string;
  correlation_id?: string;
  engine?: Record<string, unknown>;
}

interface CEEGraphReadinessResponseV1 {
  readiness_score: number;
  readiness_level: "ready" | "fair" | "needs_work";
  confidence_level: "high" | "medium" | "low";
  confidence_explanation: string;
  quality_factors: GraphReadinessAssessment["quality_factors"];
  can_run_analysis: boolean;
  blocker_reason?: string;
  evidence_quality?: {
    /** Count of edges with strong evidence */
    strong: number;
    /** Count of edges with moderate evidence */
    moderate: number;
    /** Count of edges with weak evidence (assumptions/hypotheses) */
    weak: number;
    /** Count of edges with no provenance */
    none: number;
    /** Human-readable summary */
    summary: string;
  };
  // DEPRECATED: use total_factor_count and user_question_count. Remove after next release.
  factor_count?: number;
  /** Count of nodes with kind === "factor" (all categories) */
  total_factor_count: number;
  /** Count of quality assessment dimensions (legacy quality_factors.length) */
  user_question_count: number;
  trace?: CEETraceMeta;
}

// Input validation schema - supports both V1/V2 (options in graph) and V3 (options in analysis_ready)
const GraphReadinessInput = z.object({
  graph: Graph,
  analysis_ready: AnalysisReadyPayload.optional(),
});

type GraphReadinessInputT = z.infer<typeof GraphReadinessInput>;

/**
 * F4 (readiness↔run gate) — build the `rawPersistedGraph` the SHARED scaffold
 * predicate reads for intervention INTENT on the stateless readiness route.
 *
 * The run path's intent authority is `snapshot.rawPersistedGraph` — the RAW
 * persisted graph, whose option nodes still carry `data.interventions`
 * (numeric OR not). `collectInterventionIntentOptionIds` treats ANY intervention
 * entry as user intent and never scaffolds over it. The `/graph-readiness`
 * route has no persisted graph and the request `graph` is Zod-parsed: the
 * `OptionData` schema is numeric-only, so a CONFIGURED-BUT-NON-NUMERIC option's
 * intent (a categorical value the user set, awaiting encoding) cannot ride the
 * parsed graph at all — it would 400. Passing the parsed graph as
 * `rawPersistedGraph` therefore makes that option read as UN-configured and
 * OVER-reports a scaffold the run path will NOT perform (it leaves the option on
 * the honest configure path) — reopening the readiness↔run drift in the
 * permissive direction.
 *
 * That intent DOES reach readiness, on the analysis_ready wire: a
 * configured-but-non-numeric option arrives as status `needs_encoding` with the
 * original value under `raw_interventions` (its `interventions` map carries no
 * numeric). This helper folds that exact provenance back into the option nodes'
 * `data.interventions` so the ONE existing predicate — no second, driftable
 * copy — sees the same intent the run path sees. Semantics are identical to
 * `collectInterventionIntentOptionIds`: an option has intent iff it carries any
 * intervention entry (here: any `interventions` key or any `raw_interventions`
 * key). Intent is read from VALUES ONLY — a bare `status` never manufactures it
 * (F4 #2; see the note on the intent-key loop below).
 *
 * Pure: returns a shallow-cloned graph; the request graph is never mutated. The
 * neutral-value / edge reads still use the untouched request `graph`.
 */
export function buildReadinessRawPersistedGraph(
  graph: unknown,
  options: ReadonlyArray<{
    id?: string;
    status?: string;
    interventions?: Record<string, unknown>;
    raw_interventions?: Record<string, unknown>;
  }>,
): unknown {
  if (
    graph === null ||
    typeof graph !== "object" ||
    Array.isArray(graph) ||
    !Array.isArray((graph as { nodes?: unknown }).nodes)
  ) {
    return graph;
  }

  // Per-option intent keys from analysis_ready — read ONLY from the VALUES the
  // option actually carries on the wire (`interventions` / `raw_interventions`),
  // never inferred from `status` alone.
  //
  // ⚠ F4 #2 (Paul, 28 Jul) — why a status must never manufacture intent here.
  // This block used to add a synthetic `__needs_encoding_intent__` key whenever
  // an option was `needs_encoding` with NO values at all, on the premise that
  // "`needs_encoding` implies raw (non-numeric) values by contract". That premise
  // is FALSE AT THE PRODUCER: `reconcile-top-level-options.ts` stamps
  // `needs_encoding` on ANY option lacking a NUMERIC value — including an option
  // added by chat that has no values whatsoever. The status is overloaded there;
  // only the CONSUMER-side doc comment (`schemas/analysis-ready.ts`) carries the
  // narrow "raw values awaiting encoding" meaning. CEE's own payload validator
  // agrees the fabricated case is not a real wire state: an option that is
  // `needs_encoding` with no `raw_interventions` is reported as
  // `OPTION_NEEDS_ENCODING_WITHOUT_RAW` (`cee/transforms/analysis-ready.ts`).
  //
  // The cost of the fiction was a FALSE NEGATIVE that blocked the product:
  // intent is never scaffolded over (`scaffold-unconfigured-options.ts`), so the
  // fabricated key suppressed the scaffold → `will_scaffold_options: false` →
  // the pre-run panel refused a run that `run_analysis` performs successfully
  // (it reads the REAL persisted graph, which carries no such key). F4 was
  // re-created inside the code written to close F4.
  //
  // The over-report #612 closed is UNAFFECTED, because a genuinely
  // configured-but-non-numeric option carries its value on the wire: the
  // categorical sits in `raw_interventions` (or a non-numeric entry sits in
  // `interventions`), and both loops below still register it as intent. Pinned
  // by the "F4 over-report" + "F4 #2" route tests, which move in opposite
  // directions on the same predicate.
  const intentKeysByOptionId = new Map<string, Record<string, number>>();
  for (const opt of options) {
    if (typeof opt?.id !== "string" || opt.id.length === 0) continue;
    const keys: Record<string, number> = {};
    for (const k of Object.keys(opt.interventions ?? {})) keys[k] = 1;
    for (const k of Object.keys(opt.raw_interventions ?? {})) keys[k] = 1;
    if (Object.keys(keys).length > 0) intentKeysByOptionId.set(opt.id, keys);
  }
  if (intentKeysByOptionId.size === 0) return graph;

  const nodes = (graph as { nodes: unknown[] }).nodes.map((node) => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return node;
    const n = node as Record<string, unknown>;
    if (n.kind !== "option" || typeof n.id !== "string") return node;
    const intentKeys = intentKeysByOptionId.get(n.id);
    if (intentKeys === undefined) return node;
    const existingData =
      n.data !== null && typeof n.data === "object" && !Array.isArray(n.data)
        ? (n.data as Record<string, unknown>)
        : {};
    const existingInterventions =
      existingData.interventions !== null &&
      typeof existingData.interventions === "object" &&
      !Array.isArray(existingData.interventions)
        ? (existingData.interventions as Record<string, unknown>)
        : {};
    return {
      ...n,
      data: {
        ...existingData,
        interventions: { ...existingInterventions, ...intentKeys },
      },
    };
  });

  return { ...(graph as Record<string, unknown>), nodes };
}

// ============================================================================
// V3 Analysis-Ready Assessment
// ============================================================================

interface ReadinessCritique {
  code: string;
  severity: "warn" | "error";
  message: string;
}

interface V3ReadinessResult {
  ready: boolean;
  readiness_score: number;
  readiness_level: "ready" | "fair" | "needs_work";
  confidence_level: "high" | "medium" | "low";
  confidence_explanation: string;
  options_ready: number;
  options_total: number;
  goal_node_valid: boolean;
  issues: string[];
  can_run_analysis: boolean;
  blocker_reason?: string;
  critiques?: ReadinessCritique[];
}

/**
 * Assess graph readiness for V3 payloads where options are in analysis_ready.
 * In V3, options are NOT graph nodes - they live in analysis_ready.options.
 *
 * Status handling (Raw+Encoded pattern):
 * - "ready": Option is fully ready for analysis
 * - "needs_encoding": Option has categorical/boolean values awaiting encoding
 *   (treated as soft issue - analysis CAN run with placeholder values)
 * - "needs_user_mapping": Option is missing factor matches or values
 *   (treated as hard blocker - analysis cannot run)
 */
export function assessV3Readiness(
  graph: GraphV1,
  analysisReady: AnalysisReadyPayloadT,
): V3ReadinessResult {
  const issues: string[] = [];
  const nodeIds = new Set(graph.nodes?.map((n) => n.id) ?? []);

  // Check goal node exists in graph
  const goalNodeId = analysisReady.goal_node_id;
  const goalNode = graph.nodes?.find((n) => n.id === goalNodeId);
  const goalNodeValid = !!goalNode;
  if (!goalNodeValid) {
    issues.push(`Goal node "${goalNodeId}" not found in graph`);
  }

  // Check options - track ready vs blocked.
  // After 2026-04-08: needs_encoding is a hard blocker (no soft tier).
  // The run path checks numeric interventions directly; this route must agree.
  const options = analysisReady.options ?? [];
  const readyOptions: string[] = [];
  const blockedOptions: string[] = [];

  for (const opt of options) {
    // Check interventions exist (required regardless of status)
    const interventionEntries = Object.entries(opt.interventions ?? {});
    if (interventionEntries.length === 0) {
      issues.push(`Option "${opt.id}" has no interventions`);
      blockedOptions.push(opt.id);
      continue;
    }

    // Check intervention values are finite numbers — must agree with what
    // run_analysis will accept. Non-numeric or non-finite values would be
    // rejected by PLoT (INVALID_INTERVENTION_VALUE) so they're hard blockers
    // here, regardless of the option's status field.
    // Interventions may be bare numbers or rich { value, display_value? }
    // objects; resolve to numeric before checking.
    const nonNumeric = interventionEntries
      .filter(([, v]) => {
        const n = typeof v === 'number'
          ? v
          : v != null && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number'
            ? (v as { value: number }).value
            : NaN;
        return !Number.isFinite(n);
      })
      .map(([k]) => k);
    if (nonNumeric.length > 0) {
      issues.push(
        `Option "${opt.id}" has non-numeric intervention values for: ${nonNumeric.join(", ")}`,
      );
      blockedOptions.push(opt.id);
      continue;
    }

    // Check intervention targets exist in graph
    const interventionKeys = interventionEntries.map(([k]) => k);
    const missingTargets = interventionKeys.filter((targetId) => !nodeIds.has(targetId));
    if (missingTargets.length > 0) {
      issues.push(
        `Option "${opt.id}" has interventions targeting non-existent nodes: ${missingTargets.join(", ")}`,
      );
      blockedOptions.push(opt.id);
      continue;
    }

    // Status handling. After v2026-04-08, needs_encoding is treated as a
    // hard blocker — the run path checks numeric interventions directly,
    // and the readiness route must agree with it. needs_encoding implies
    // the option's interventions are not yet encoded, so analysis cannot
    // run safely. See intervention-lifecycle audit §6.
    switch (opt.status) {
      case "ready":
        readyOptions.push(opt.id);
        break;
      case "needs_encoding":
      case "needs_user_mapping":
      default:
        issues.push(`Option "${opt.id}" has status "${opt.status}" instead of "ready"`);
        blockedOptions.push(opt.id);
        break;
    }
  }

  // Surface payload-level blockers (Phase 2B: needs_user_input)
  if (analysisReady.status === "needs_user_input" && analysisReady.blockers?.length) {
    for (const blocker of analysisReady.blockers) {
      const optLabel = blocker.option_label ?? blocker.option_id ?? "all";
      issues.push(`Blocker: ${blocker.message} (option: ${optLabel}, factor: ${blocker.factor_id})`);
      if (blocker.option_id && !blockedOptions.includes(blocker.option_id)) {
        blockedOptions.push(blocker.option_id);
      }
    }
  }

  // Option distinctiveness check: compare intervention maps across all
  // non-baseline options. An option pair is "identical" when their
  // intervention keys are identical AND every value differs by less than
  // 0.01. Surfaces the PLoT preflight "identical options" failure earlier
  // so the run path can return a clean blocker instead of a terse PLoT error.
  //
  // Baseline detection priority:
  //   1. Explicit `is_baseline === true` on the option (propagated from the
  //      graph node or draft — authoritative).
  //   2. Exact label / id-suffix heuristics (fallback only, and only when no
  //      option has an explicit is_baseline flag). Substring matching was
  //      too aggressive — "Status quo with bridge financing" got excluded.
  //   3. When every option would be classified as baseline by the heuristic,
  //      compare all of them — do not silently skip the check.
  const critiques: ReadinessCritique[] = [];
  const anyExplicitBaseline = options.some(
    (o) => (o as { is_baseline?: boolean }).is_baseline === true,
  );
  const BASELINE_LABELS = new Set(['status quo', 'baseline', 'do nothing', 'no change']);
  const BASELINE_ID_SUFFIXES = ['_status_quo', '_baseline'];
  const isBaseline = (o: { id?: string; label?: string; is_baseline?: boolean }): boolean => {
    if (anyExplicitBaseline) return o.is_baseline === true;
    const id = (o.id ?? '').toLowerCase();
    const label = (o.label ?? '').toLowerCase().trim();
    if (BASELINE_LABELS.has(label)) return true;
    return BASELINE_ID_SUFFIXES.some((s) => id.endsWith(s));
  };
  let nonBaselineOptions = options.filter((o) => !isBaseline(o));
  if (nonBaselineOptions.length === 0 && options.length > 0) {
    nonBaselineOptions = options;
  }
  type NumericMap = Record<string, number>;
  const toNumericMap = (opt: (typeof options)[number]): NumericMap => {
    const out: NumericMap = {};
    for (const [k, v] of Object.entries(opt.interventions ?? {})) {
      const n = typeof v === 'number'
        ? v
        : v != null && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'number'
          ? (v as { value: number }).value
          : NaN;
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  };
  const sameKeys = (a: NumericMap, b: NumericMap): boolean => {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i += 1) if (ka[i] !== kb[i]) return false;
    return true;
  };
  const sameValues = (a: NumericMap, b: NumericMap): boolean => {
    for (const k of Object.keys(a)) if (Math.abs(a[k] - b[k]) >= 0.01) return false;
    return true;
  };
  const identicalPairs: Array<[string, string]> = [];
  let pairsChecked = 0;
  if (nonBaselineOptions.length >= 2) {
    const maps = nonBaselineOptions.map((o) => ({ id: o.id, map: toNumericMap(o) }));
    for (let i = 0; i < maps.length; i += 1) {
      for (let j = i + 1; j < maps.length; j += 1) {
        pairsChecked += 1;
        if (sameKeys(maps[i].map, maps[j].map) && sameValues(maps[i].map, maps[j].map)) {
          identicalPairs.push([maps[i].id, maps[j].id]);
        }
      }
    }
  }
  const totalNonBaselinePairs = pairsChecked;
  const allIdentical = totalNonBaselinePairs > 0 && identicalPairs.length === totalNonBaselinePairs;
  if (identicalPairs.length > 0) {
    critiques.push({
      code: 'IDENTICAL_OPTION_INTERVENTIONS',
      severity: 'warn',
      message: 'Options have identical intervention profiles and cannot be meaningfully distinguished by analysis.',
    });
  }
  log.info(
    {
      event: 'v4.graph_readiness.option_distinctiveness',
      pairs_checked: pairsChecked,
      identical_pairs: identicalPairs.length,
      all_identical: allIdentical,
    },
    'Option distinctiveness check',
  );

  // Determine overall readiness
  const optionsReady = readyOptions.length;
  const optionsTotal = options.length;
  const hasEnoughOptions = optionsReady >= 2;

  // Analysis can run only when every option is fully ready and goal is valid.
  // When all non-baseline options are intervention-identical, downgrade to
  // blocker — PLoT would reject with "identical options" anyway.
  const isReady = hasEnoughOptions && goalNodeValid && blockedOptions.length === 0 && !allIdentical;

  // Calculate readiness score (0-100). Only fully-ready options count.
  let readinessScore = 0;
  if (goalNodeValid) readinessScore += 30;
  if (optionsTotal > 0) {
    const optionRatio = readyOptions.length / optionsTotal;
    readinessScore += Math.round(optionRatio * 50);
  }
  if (hasEnoughOptions) readinessScore += 20;

  // Determine readiness level
  let readinessLevel: "ready" | "fair" | "needs_work";
  if (allIdentical) {
    // Hard blocker: PLoT preflight will reject indistinguishable options.
    readinessLevel = "needs_work";
  } else if (readinessScore >= 80) {
    readinessLevel = "ready";
  } else if (readinessScore >= 50) {
    readinessLevel = "fair";
  } else {
    readinessLevel = "needs_work";
  }

  // Determine confidence level
  let confidenceLevel: "high" | "medium" | "low";
  if (optionsTotal >= 2 && goalNodeValid && blockedOptions.length === 0) {
    confidenceLevel = "high";
  } else if (optionsTotal >= 1 && goalNodeValid) {
    confidenceLevel = "medium";
  } else {
    confidenceLevel = "low";
  }

  // Build blocker reason if not ready
  let blockerReason: string | undefined;
  if (!isReady) {
    if (!goalNodeValid) {
      blockerReason = `Goal node "${goalNodeId}" not found in graph`;
    } else if (!hasEnoughOptions) {
      blockerReason = `Only ${optionsReady} options ready (need at least 2)`;
    } else if (blockedOptions.length > 0) {
      blockerReason = `${blockedOptions.length} option(s) blocked: ${blockedOptions.slice(0, 3).join(", ")}`;
    } else if (allIdentical) {
      blockerReason = 'All non-baseline options have identical intervention profiles';
    } else if (issues.length > 0) {
      blockerReason = issues[0];
    }
  }

  // Build the confidence explanation.
  let confidenceExplanation: string;
  if (isReady) {
    confidenceExplanation = `V3 analysis ready with ${optionsReady} options and valid goal node`;
  } else {
    confidenceExplanation = `V3 analysis not ready: ${blockerReason || "unknown issue"}`;
  }

  return {
    ready: isReady,
    readiness_score: readinessScore,
    readiness_level: readinessLevel,
    confidence_level: confidenceLevel,
    confidence_explanation: confidenceExplanation,
    options_ready: optionsReady,
    options_total: optionsTotal,
    goal_node_valid: goalNodeValid,
    issues,
    can_run_analysis: isReady,
    blocker_reason: blockerReason,
    critiques: critiques.length > 0 ? critiques : undefined,
  };
}

// Rate limiting
type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const graphReadinessBuckets = new Map<string, BucketState>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

  if (map.size <= MAX_BUCKETS) return;

  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

function checkRateLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(graphReadinessBuckets, now);
  let state = graphReadinessBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    graphReadinessBuckets.set(key, state);
  }

  if (now - state.windowStart >= WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }

  if (state.count >= limit) {
    const resetAt = state.windowStart + WINDOW_MS;
    const diffMs = Math.max(0, resetAt - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  state.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_GRAPH_READINESS_RATE_LIMIT_RPM");
  const FEATURE_VERSION = "graph-readiness-1.0.0";

  app.post("/assist/v1/graph-readiness", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeGraphReadinessRequested, {
      ...telemetryCtx,
      feature: "cee_graph_readiness",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkRateLimit(rateKey, RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Graph Readiness rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeGraphReadinessFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_RATE_LIMIT",
        httpStatus: 429,
      });

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Input validation
    const parsed = GraphReadinessInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeGraphReadinessFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_VALIDATION_FAILED",
        httpStatus: 400,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input = parsed.data as GraphReadinessInputT;

    try {
      const graph = input.graph as unknown as GraphV1;

      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      // Check if this is a V3 request with analysis_ready
      // In V3, options are NOT graph nodes - they live in analysis_ready.options
      if (input.analysis_ready?.options && input.analysis_ready.options.length > 0) {
        log.info(
          {
            request_id: requestId,
            event: "cee.graph_readiness.v3_mode",
            options_count: input.analysis_ready.options.length,
            goal_node_id: input.analysis_ready.goal_node_id,
          },
          "Using V3 analysis_ready mode for graph readiness",
        );

        const v3Result = assessV3Readiness(graph, input.analysis_ready);

        const totalFactorCount = (graph.nodes ?? []).filter(
          (n: any) => n.kind === "factor",
        ).length;

        // F4 (readiness↔run gate): advertise what run_analysis would actually
        // scaffold for this graph. `can_run_analysis` stays HONEST — an
        // unconfigured option is genuinely not "ready" — but the run path
        // scaffolds disclosed placeholders for it in the mixed-configured state
        // and succeeds; the pre-run panel derives "blocked" purely from
        // `can_run_analysis === false` and so contradicts the run. This plan is
        // computed by the SAME predicate run_analysis uses (computeScaffoldPlan
        // → scaffoldUnconfiguredOptions), so the two gates cannot drift: for
        // this input the panel now knows the run would proceed with placeholders
        // rather than block. Additive only — no readiness verdict changes.
        const scaffoldPlan: ScaffoldPlan = computeScaffoldPlan({
          options: input.analysis_ready.options,
          graph: input.graph,
          // Readiness is stateless: the request graph is the proxy for the
          // snapshot run_analysis loads (same graph state ⇒ same decision) for
          // the neutral-value / edge reads. For intervention INTENT, though, the
          // parsed request graph is NOT a faithful proxy — its numeric-only
          // OptionData schema cannot carry a configured-but-non-numeric option's
          // intent, so passing it here would over-report a scaffold the run path
          // won't perform (F4 review P1). We therefore hand the predicate a
          // rawPersistedGraph reconstructed from the analysis_ready wire, where
          // that intent DOES arrive (needs_encoding + raw_interventions) — the
          // same intent the run path's rawPersistedGraph carries, read by the
          // same predicate. See buildReadinessRawPersistedGraph.
          rawPersistedGraph: buildReadinessRawPersistedGraph(
            input.graph,
            input.analysis_ready.options,
          ),
          // The CEE→PLoT egress scale net is unconditional since 2026-07-20
          // (O-7 wave 2), matching run_analysis' pinned-true call site.
          scaleNetEnabled: true,
        });

        // Return V3-specific response with extended fields
        const v3Response = {
          readiness_score: v3Result.readiness_score,
          readiness_level: v3Result.readiness_level,
          confidence_level: v3Result.confidence_level,
          confidence_explanation: v3Result.confidence_explanation,
          quality_factors: [], // V3 doesn't use legacy quality factors
          can_run_analysis: v3Result.can_run_analysis,
          blocker_reason: v3Result.blocker_reason,
          // F4: pre-run projection of the run-path scaffold decision. Shape is
          // pinned in CEEGraphReadinessResponseV1Schema + openapi.yaml.
          scaffold_plan: {
            will_scaffold_options: scaffoldPlan.will_scaffold_options,
            ...(scaffoldPlan.will_scaffold_options
              ? { option_count: scaffoldPlan.option_count }
              : {}),
          },
          // V3-specific fields
          ready: v3Result.ready,
          options_ready: v3Result.options_ready,
          options_total: v3Result.options_total,
          goal_node_valid: v3Result.goal_node_valid,
          issues: v3Result.issues,
          critiques: v3Result.critiques,
          // DEPRECATED: use total_factor_count and user_question_count. Remove after next release.
          factor_count: 0,
          total_factor_count: totalFactorCount,
          user_question_count: 0,
          trace,
        };

        const latencyMs = Date.now() - start;

        emit(TelemetryEvents.CeeGraphReadinessCompleted, {
          ...telemetryCtx,
          latency_ms: latencyMs,
          readiness_score: v3Result.readiness_score,
          readiness_level: v3Result.readiness_level,
          can_run_analysis: v3Result.can_run_analysis,
          // DEPRECATED: use total_factor_count and user_question_count. Remove after next release.
          factor_count: 0,
          total_factor_count: totalFactorCount,
          user_question_count: 0,
          v3_mode: true,
          options_ready: v3Result.options_ready,
          options_total: v3Result.options_total,
        });

        logCeeCall({
          requestId,
          capability: "cee_graph_readiness",
          latencyMs,
          status: "ok",
          httpStatus: 200,
        });

        reply.header("X-CEE-API-Version", "v3");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(200);
        return reply.send(v3Response);
      }

      // Fall back to legacy V1/V2 assessment (options in graph nodes)
      const assessment = assessGraphReadiness(graph);

      const totalFactorCountV1 = (graph.nodes ?? []).filter(
        (n: any) => n.kind === "factor",
      ).length;

      const response: CEEGraphReadinessResponseV1 = {
        readiness_score: assessment.readiness_score,
        readiness_level: assessment.readiness_level,
        confidence_level: assessment.confidence_level,
        confidence_explanation: assessment.confidence_explanation,
        quality_factors: assessment.quality_factors,
        can_run_analysis: assessment.can_run_analysis,
        blocker_reason: assessment.blocker_reason,
        evidence_quality: assessment.evidence_quality,
        // DEPRECATED: use total_factor_count and user_question_count. Remove after next release.
        factor_count: assessment.quality_factors.length,
        total_factor_count: totalFactorCountV1,
        user_question_count: assessment.quality_factors.length,
        trace,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeGraphReadinessCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        readiness_score: assessment.readiness_score,
        readiness_level: assessment.readiness_level,
        can_run_analysis: assessment.can_run_analysis,
        // DEPRECATED: use total_factor_count and user_question_count. Remove after next release.
        factor_count: assessment.quality_factors.length,
        total_factor_count: totalFactorCountV1,
        user_question_count: assessment.quality_factors.length,
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs,
        status: "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (err) {
      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        err instanceof Error ? err.message : "Internal error",
        {
          retryable: true,
          requestId,
        },
      );

      emit(TelemetryEvents.CeeGraphReadinessFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
        error_message: err instanceof Error ? err.message : String(err),
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: 500,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
