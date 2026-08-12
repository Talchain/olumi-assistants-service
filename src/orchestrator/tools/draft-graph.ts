/**
 * draft_graph Tool Handler
 *
 * Wraps the existing unified pipeline — does NOT modify it.
 * Calls runUnifiedPipeline() as a function call (same process, not HTTP).
 *
 * Output: GraphPatchBlock (patch_type: 'full_draft', status: 'proposed').
 * Extracts validation_warnings into assistant_text.
 */

import type { FastifyRequest } from "fastify";
import { log } from "../../utils/telemetry.js";
import { runUnifiedPipeline } from "../../cee/unified-pipeline/index.js";
import { currentStageEmitter } from "../../cee/unified-pipeline/stage-stream-context.js";
import type { DraftInputWithCeeExtras, UnifiedPipelineOpts, PipelineOutcome } from "../../cee/unified-pipeline/types.js";
import type { TypedConversationBlock, GraphPatchBlockData, PatchOperation, OrchestratorError, GraphV3T, RepairEntry, DraftCoachingStrengthenItem, DraftCoachingWideningLog } from "../types.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { buildPatchSummary } from "../patch-summary.js";
import { AnalysisReadyPayload } from "../../schemas/analysis-ready.js";
import { computeStructuralReadiness } from "./analysis-ready-helper.js";
import { detectCurrency, buildCurrencyInstruction } from "../../cee/signals/currency-signal.js";
import { pickGoalThresholdTrio } from "../../utils/goal-threshold-trio.js";
import type { CurrencySignal } from "../../cee/signals/currency-signal.js";

/**
 * Convert an ISO currency code (e.g. "GBP") to a CurrencySignal.
 * Returns null for unknown codes or null input.
 *
 * Used to bridge turn-context's `user_currency_hint` (which stores the ISO
 * code from `detectCurrencyInMessage`) into the same shape that
 * `detectCurrency(brief)` produces, so `buildCurrencyInstruction` receives a
 * uniform input regardless of which source supplied the signal.
 */
function signalFromCurrencyCode(code: string | null | undefined): CurrencySignal | null {
  if (!code) return null;
  const map: Record<string, CurrencySignal> = {
    GBP: { symbol: '£', code: 'GBP' },
    USD: { symbol: '$', code: 'USD' },
    EUR: { symbol: '€', code: 'EUR' },
    AUD: { symbol: 'A$', code: 'AUD' },
    CAD: { symbol: 'C$', code: 'CAD' },
  };
  return map[code.toUpperCase()] ?? null;
}

// ============================================================================
// Types
// ============================================================================

/** CEEStructuralWarningV1 shape (from generated OpenAPI) */
export interface CEEDraftWarning {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'blocker';
  affected_node_ids?: string[];
  affected_edge_ids?: string[];
  explanation?: string;
  fix_hint?: string;
  /** Legacy fields */
  node_ids?: string[];
  edge_ids?: string[];
}

/** Structured strengthen item from LLM coaching output. Canonical type
 *  lives in `../types.ts` as `DraftCoachingStrengthenItem`; this is a
 *  re-export for back-compat with existing call sites. */
export type StrengthenItem = DraftCoachingStrengthenItem;

export interface DraftGraphResult {
  blocks: TypedConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
  /** Coaching context for Phase 3 LLM narration (coaching.summary + strengthen_items) */
  narrationHint?: string;
  /** Structured strengthen items from LLM coaching, areas the model needs reinforcement. */
  strengthenItems: StrengthenItem[];
  /** Raw LLM coaching.summary text, preserved for V5 ContextPack threading. */
  coachingSummary: string | null;
  /** Raw LLM coaching.widening_log, preserved byte-for-byte for V5 ContextPack. */
  coachingWideningLog: readonly unknown[] | null;
  /**
   * Canonical (v0.11.0+) coaching.widening_log OBJECT, narrowed and validated.
   * The legacy `coachingWideningLog` array field only matches the pre-v0.11.0
   * shape — on V5 the Anthropic-adapter ingress normaliser converts the LLM
   * output to the `{elements_added, elements_considered_but_excluded,
   * brief_completeness}` object, so the array extractor returns null and that
   * field is effectively dead. This field carries the live object.
   * SAFETY: `elements_added` holds NODE IDs — consumers must NEVER render it raw.
   */
  coachingWideningLogObject?: DraftCoachingWideningLog | null;
  /** Raw LLM coaching.bias_signals (namespaced under draft_coaching in V5 to
   *  avoid collision with CEE preflight bias_signals). */
  coachingBiasSignals: readonly unknown[] | null;
  /** Structured draft warnings from the pipeline (CEEStructuralWarningV1[]) */
  draftWarnings: CEEDraftWarning[];
  /** The drafted graph, for post-draft structural analysis */
  graphOutput: GraphV3T | null;
  /** Analysis-ready payload from the pipeline boundary stage. Threaded to V5 for OlumiResponse. */
  analysisReady?: GraphPatchBlockData['analysis_ready'];
  /** Tool-level LLM telemetry extracted from the pipeline response. */
  toolLLMTelemetry?: {
    tool: string;
    model: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    latency_ms: number;
    stop_reason: string;
    thinking_enabled: boolean;
    structured_outputs_used: boolean;
    prompt_version?: string;
    prompt_hash?: string;
  };
  /** Pipeline outcome metadata from the CEE unified pipeline. */
  pipelineOutcome?: PipelineOutcome;
  /**
   * V5 latency observability (Fix 4). Per-stage timings from the CEE
   * unified pipeline, extracted from the pipeline result body's optional
   * `_timings.draft_graph` block. Plumbed through so the V5 dispatch can
   * attach it to the OlumiResponse before the egress strict-validator
   * runs. Undefined when `V5_TIMING_DEBUG=false` (the pipeline writer
   * gates on the same flag).
   */
  draftGraphTimings?: import('../../orchestrator-v5/telemetry/turn-timings.js').DraftGraphTimings;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the draft_graph tool.
 *
 * @param brief - User's decision brief text (min 30 chars)
 * @param request - Fastify request (needed by unified pipeline)
 * @param turnId - Turn ID for block provenance
 * @param draftOpts.userCurrencyHint - ISO code (e.g. "GBP") detected by
 *   `detectCurrencyInMessage` on the full user message. Prefers this over
 *   brief-only detection — the message catches "£100k" even when the brief
 *   itself omits the symbol.
 * @param draftOpts.requestStartMs - Wall-clock baseline of the HTTP request
 *   (route-handler entry). Threaded to the unified pipeline so the draft
 *   retry-affordability gate and the Step-11 budget guard measure elapsed
 *   time from REQUEST start, covering pre-LLM turn time (routing tool-use
 *   call, context assembly). When absent, parse.ts falls back to LLM start —
 *   both measurements are then blind to pre-LLM time (review-576 condition 2).
 * @returns Graph patch block + optional assistant text with warnings
 */
export async function handleDraftGraph(
  brief: string,
  request: FastifyRequest,
  turnId: string,
  draftOpts?: { briefSignalsHeader?: string; signal?: AbortSignal; userCurrencyHint?: string | null; requestStartMs?: number },
): Promise<DraftGraphResult> {
  const startTime = Date.now();

  // Currency precedence: turn-context hint (full message) → brief-level detection.
  // The full-message hint is stronger because the brief may omit the symbol
  // the user wrote elsewhere in their request.
  const hintSignal = signalFromCurrencyCode(draftOpts?.userCurrencyHint ?? null);
  const currencySignal = hintSignal ?? detectCurrency(brief);
  log.debug(
    {
      event: 'v4.draft_currency_resolution',
      hint_code: draftOpts?.userCurrencyHint ?? null,
      brief_detected: currencySignal?.code ?? null,
      source: hintSignal ? 'message_hint' : (currencySignal ? 'brief_detection' : 'none'),
    },
    'draft_graph: currency signal resolved for prompt injection',
  );
  const input: DraftInputWithCeeExtras = {
    brief,
    ...(draftOpts?.briefSignalsHeader ? { briefSignalsHeader: draftOpts.briefSignalsHeader } : {}),
    currencyInstruction: buildCurrencyInstruction(currencySignal),
  };

  // ROADMAP 2.122 / 1.204 M1 (CEE lane 2) — the staged-emission seam, wired for
  // the TURN path.
  //
  // Lane 1 (#745) built `onStage` and gave it exactly one caller: the staged
  // ASSIST route, which calls `runUnifiedPipeline` directly. The product's cold
  // draft does NOT go that way — it is a V5 turn, and it arrives here. This is
  // the line that lets a streamed turn observe the same stage boundaries the
  // staged assist route already observes. It GENERALISES lane 1's emitter; it
  // does not duplicate the pipeline.
  //
  // ABSENT BY DEFAULT, AND THAT IS THE WHOLE SAFETY ARGUMENT. `currentStageEmitter()`
  // reads an async-context store that only `/orchestrate/v2/turn/stream` ever
  // sets. Every other caller of this tool — the buffered `/orchestrate/v2/turn`,
  // every test, every internal draft — runs outside that context and gets
  // `undefined`, so the key is not spread and `opts` is the object it was
  // before. The buffered turn is untouched by construction rather than by flag.
  //
  // The emitter is a PURE OBSERVER (see unified-pipeline/index.ts
  // `emitStageEvent`): synchronous, un-awaited, throw-swallowing, unable to
  // reach `ctx` or the response body. So a streamed draft and a buffered draft
  // execute the same pipeline and commit the same graph.
  const stageEmitter = currentStageEmitter();

  const opts: UnifiedPipelineOpts = {
    schemaVersion: 'v3',
    signal: draftOpts?.signal,
    // Review-576 condition 2: thread the request-start baseline when the
    // caller provides one, so budget arithmetic inside the pipeline starts at
    // request start, not LLM start. Omitted (not defaulted) when absent —
    // parse.ts owns the documented LLM-start fallback for legacy callers.
    ...(draftOpts?.requestStartMs !== undefined ? { requestStartMs: draftOpts.requestStartMs } : {}),
    ...(stageEmitter ? { onStage: stageEmitter } : {}),
  };

  log.info({ brief_length: brief.length, turn_id: turnId }, "draft_graph: starting unified pipeline");

  let pipelineResult;
  try {
    pipelineResult = await runUnifiedPipeline(input, { brief }, request, opts);
  } catch (error) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Draft graph failed: ${error instanceof Error ? error.message : String(error)}`,
      tool: 'draft_graph',
      recoverable: true,
      suggested_retry: 'Try drafting the graph again.',
    };
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
  }

  const latencyMs = Date.now() - startTime;

  // Check for pipeline error responses (non-200 status)
  if (pipelineResult.statusCode !== 200) {
    // Defensive: `pipelineResult.body` is typed `unknown` and could be null /
    // undefined / a non-object if a future pipeline path returns a malformed
    // response. Coerce to an empty record so the subsequent extraction is
    // crash-free; that path falls through to the legacy plain-Error envelope
    // because `pipelineErrorCode` ends up null.
    const rawBody = pipelineResult.body;
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    // Real CEE error bodies built by `buildCeeErrorResponse` carry the
    // category in `body.code` (see src/cee/validation/pipeline.ts:366).
    // Earlier revisions of this file read `body.error`, which is never
    // populated on the pipeline response — leaving `pipelineErrorCode`
    // null and forcing route-v2's legacy fallback. We now read `code`
    // as the primary field with `error` retained for legacy tolerance.
    //
    // The pattern guard (^CEE_[A-Z_]{1,62}$) filters out any non-conformant
    // upstream value before it lands in logs / wire response — known-good
    // producers go through buildCeeErrorResponse with a fixed enum, so
    // anything outside this shape is suspicious and worth discarding.
    const CEE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
    const extractCode = (raw: unknown): string | null =>
      typeof raw === 'string' && CEE_CODE_PATTERN.test(raw) ? raw : null;
    const pipelineErrorCode: string | null =
      extractCode(body.code) ?? extractCode(body.error);
    // Surface the category code in the OrchestratorError message when
    // available so server logs are diagnosable. Falls back to the
    // pipeline's own user-facing `message` field, then to a status-only
    // string of last resort.
    const message =
      pipelineErrorCode ??
      (typeof body?.message === 'string' ? (body.message as string) : null) ??
      `Pipeline returned status ${pipelineResult.statusCode}`;
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Draft graph failed: ${message}`,
      tool: 'draft_graph',
      recoverable: pipelineResult.statusCode >= 500,
      suggested_retry: pipelineResult.statusCode >= 500 ? 'Try drafting the graph again.' : undefined,
    };
    // Preserve tool telemetry even on failure so _diagnostic_trace captures the error
    const failureTelemetry = extractToolLLMTelemetry(body);
    // Carry pipeline category metadata onto the throw so route-v2.ts can emit
    // a typed wire envelope instead of opaque draft_graph_pipeline_threw. See
    // route-v2.ts catch block in dispatchDraftGraph; the legacy fallback path
    // (plain Error with no pipelineStatusCode) preserves the existing wire
    // shape bit-for-bit.
    const pipelineRecoveryRaw = (body as { recovery?: unknown }).recovery;
    const pipelineRecovery =
      pipelineRecoveryRaw && typeof pipelineRecoveryRaw === 'object'
        ? (pipelineRecoveryRaw as Record<string, unknown>)
        : null;
    // The PRODUCER's own retryability declaration (ROADMAP 2.718).
    // `buildCeeErrorResponse` emits `retryable` at the body top level on
    // every CEE error body; emitters that mean "retry is the honest lever"
    // set it TRUE deliberately (the post-enforcement gate's stochastic-
    // topology 422, the OPTIONS_IDENTICAL bypass). Dropping it here forced
    // route-v2 to re-derive retryability from a static per-code map, which
    // flipped those producers' `true` to `false` on the wire — beside
    // recovery copy that says "Try again" (witnessed 2026-08-06, runs
    // de79da/39cf53). Strict boolean guard: any other shape → null, and the
    // route treats null as "producer silent" (static map decides alone).
    const pipelineRetryableRaw = (body as { retryable?: unknown }).retryable;
    const pipelineRetryable: boolean | null =
      typeof pipelineRetryableRaw === 'boolean' ? pipelineRetryableRaw : null;
    // Pipeline-side `body.details` may carry diagnostic fields the route
    // boundary needs to surface on the wire (e.g. OPTIONS_IDENTICAL bypass
    // attaches `violation_code`, `identical_option_ids`,
    // `intervention_signature`, `repair_skip_reason`). We allowlist
    // explicitly rather than passing the whole `details` blob through:
    // future CEE error sites may add fields that contain user input
    // echoes, raw exception text, or other unsafe content. Each new field
    // must be added to the allowlist intentionally with a justification.
    //
    // All allowlisted fields are DIAGNOSTIC — intended for dashboards,
    // logs, and DGAI debug surfaces. They are NOT user-facing copy. The
    // user-facing payload is `recovery.suggestion` + `recovery.hints`
    // (extracted via `pipelineRecovery` below). In particular:
    //   - `identical_option_ids` carries internal graph node IDs (e.g.
    //     "opt_49", "opt_status_quo"), not display labels.
    //   - `intervention_signature` carries internal factor-id:value
    //     fingerprints — useful for operators correlating dashboards
    //     but never appropriate as user text.
    // DGAI should render `recovery.suggestion` for the user and treat
    // these diagnostic fields as opaque dashboard data.
    const PIPELINE_DETAILS_ALLOWLIST = new Set<string>([
      'violation_code',          // CEE-side validation code (e.g. OPTIONS_IDENTICAL)
      'identical_option_ids',    // OPTIONS_IDENTICAL bypass diagnostic — internal graph IDs
      'intervention_signature',  // OPTIONS_IDENTICAL bypass diagnostic — internal factor:value fingerprint
      'repair_skip_reason',      // OPTIONS_IDENTICAL bypass diagnostic
      // ROADMAP 2.718 (2026-08-06): the two graph-validation emitters now
      // ship a codes-only mirror of their blocking errors. Codes are fixed
      // validator enum strings (MISSING_BRIDGE, NO_PATH_TO_GOAL, …) — no
      // user content. The full `validation_errors` objects remain
      // NON-allowlisted: their `message` strings embed node labels drafted
      // from user input. Without the codes on the wire, diagnosing a
      // CEE_GRAPH_INVALID 500 requires a Render-logs round-trip (which is
      // exactly what the de79da/39cf53 diagnosis cost).
      'validation_error_codes',  // codes-only blocking-error mirror — fixed validator enums
      'last_phase',              // which validation emitter fired — fixed pipeline-phase string
      // ROADMAP 2.1086: the bounded auto-retry disclosure. Fixed shape
      // ({ attempted: boolean, attempts: number }, built in
      // draft-auto-retry.ts) — no user content. Without it on the wire, a
      // post-retry 422 is indistinguishable from a single-attempt one and
      // diagnosing "did the server already retry?" costs a Render-logs
      // round-trip (the exact cost 2.718 removed for the validator codes).
      'auto_retry',              // bounded auto-retry disclosure — fixed shape, no user content
    ]);
    const rawDetails = (body as { details?: unknown }).details;
    const pipelineDetails: Record<string, unknown> | null =
      rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
        ? (() => {
            const filtered: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(rawDetails as Record<string, unknown>)) {
              if (PIPELINE_DETAILS_ALLOWLIST.has(key)) {
                filtered[key] = value;
              }
            }
            return Object.keys(filtered).length > 0 ? filtered : null;
          })()
        : null;
    // The pipeline body's typed `details.reason` (e.g. `llm_truncated_max_tokens`)
    // distinguishes sub-cases that share one CEE code. route-v2 uses it to make a
    // truncation (transient over-generation) RETRYABLE even though the parent
    // code CEE_LLM_VALIDATION_FAILED is otherwise not (2026-07-23 firefight).
    // It is a fixed enum string, not user content — pattern-guarded before use.
    const rawReason = (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)
      ? (rawDetails as Record<string, unknown>).reason
      : undefined);
    const pipelineReason: string | null =
      typeof rawReason === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(rawReason) ? rawReason : null;
    const failureError = Object.assign(new Error(message), {
      orchestratorError: err,
      toolLLMTelemetry: failureTelemetry,
      pipelineStatusCode: pipelineResult.statusCode,
      pipelineErrorCode,
      pipelineReason,
      pipelineRetryable,
      pipelineRecovery,
      pipelineDetails,
    });
    throw failureError;
  }

  // Extract graph from pipeline response
  const body = pipelineResult.body as Record<string, unknown>;
  const graph = body.graph ?? body;

  // Build full_draft patch: all nodes and edges as add operations
  const operations = buildFullDraftOps(graph);
  const graphOutput = isGraphV3(graph) ? graph as GraphV3T : null;

  const patchData: GraphPatchBlockData = {
    patch_type: 'full_draft',
    operations,
    status: 'proposed',
    auto_apply: true,
    ...(graphOutput && { applied_graph: graphOutput }),
  };

  // Extract analysis_ready from pipeline response (present in V3 schema responses).
  // Falls back to computeStructuralReadiness() ONLY when analysis_ready is absent
  // from the pipeline body. If present but invalid, don't fallback — let the upstream
  // validation failure surface rather than masking it with graph-derived readiness.
  const pipelineHasAnalysisReady = 'analysis_ready' in body && body.analysis_ready != null;
  const analysisReady = pipelineHasAnalysisReady
    ? extractAnalysisReady(body)
    : (graphOutput ? computeStructuralReadiness(graphOutput) : undefined);
  if (analysisReady) {
    patchData.analysis_ready = analysisReady;
  }

  // Extract coaching summary for narration hint (brief: include in assistantText)
  const coachingSummary = extractCoachingSummary(body);
  // Always emit a summary: prefer coaching text, fall back to operation-derived description
  // Pass the freshly drafted graph so the summary can resolve labels for
  // add_edge ops (factor → goal connections, option → factor interventions).
  patchData.summary = buildPatchSummary(operations, coachingSummary, 'full_draft', graphOutput ?? null);

  // Extract validation warnings if present (plain strings for assistantText / validation_warnings)
  const warnings = extractWarnings(body);
  if (warnings.length > 0) {
    patchData.validation_warnings = warnings;
  }

  // Extract structured draft warnings for guidance generation
  const draftWarnings = extractStructuredWarnings(body);

  // Extract repairs from pipeline trace so UI can display them
  const repairsApplied = extractRepairsApplied(body);
  if (repairsApplied.length > 0) {
    patchData.repairs_applied = repairsApplied;
  }

  // Extract strengthen_items as structured data for guidance conversion
  const strengthenItems = extractStrengthenItems(body);

  // Preserve raw coaching fields for V5 ContextPack threading. Kept alongside
  // the existing narrationHint/strengthenItems flow; no V4 behaviour change.
  const coachingSummaryRaw = extractCoachingSummaryRaw(body);
  const coachingWideningLog = extractCoachingWideningLog(body);
  const coachingWideningLogObject = extractCoachingWideningLogObject(body);
  const coachingBiasSignals = extractCoachingBiasSignals(body);

  // Build narration_hint from coaching data (for Phase 3 LLM context)
  const narrationHint = coachingSummary ?? undefined;

  // Build assistantText: warnings take priority. Otherwise leave null — the
  // response composer (driven by the post-draft CoachingContext) or the LLM
  // text produces assistant_text downstream. Deliberately NOT falling back to
  // `extractFirstSentence(patchData.summary)` — that path pushed patch-count
  // jargon ("Added 5 factors, 3 options, and 24 connections") into the user's
  // first turn whenever coaching signals were weak.
  let assistantText: string | null = null;
  if (warnings.length > 0) {
    assistantText = `The draft graph has ${warnings.length} validation warning${warnings.length > 1 ? 's' : ''}:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
  }

  const block = createGraphPatchBlock(patchData, turnId);

  // Extract tool-level LLM telemetry from pipeline trace for diagnostic trace capture
  const toolLLMTelemetry = extractToolLLMTelemetry(body);

  log.info(
    {
      elapsed_ms: latencyMs,
      operations_count: operations.length,
      warnings_count: warnings.length,
      structured_warnings_count: draftWarnings.length,
      repairs_applied_count: repairsApplied.length,
      has_coaching: coachingSummary !== null,
    },
    "draft_graph completed",
  );

  // Extract _pipeline_outcome from unified pipeline response (CEE-specific diagnostic metadata)
  const pipelineOutcome = (body._pipeline_outcome as PipelineOutcome | undefined) ?? undefined;

  // Fix 4 (observability): extract `_timings.draft_graph` from the pipeline
  // body when present. The unified pipeline gates the attach on
  // `config.cee.timingDebugEnabled` so this field is undefined in default-
  // OFF production runs.
  const timingsField = (body as { _timings?: { draft_graph?: unknown } })._timings;
  const draftGraphTimings = timingsField && typeof timingsField === 'object'
    ? (timingsField.draft_graph as DraftGraphResult['draftGraphTimings'] | undefined)
    : undefined;

  return {
    blocks: [block],
    assistantText,
    latencyMs,
    narrationHint,
    strengthenItems,
    coachingSummary: coachingSummaryRaw,
    coachingWideningLog,
    coachingWideningLogObject,
    coachingBiasSignals,
    draftWarnings,
    graphOutput,
    analysisReady,
    toolLLMTelemetry,
    pipelineOutcome,
    ...(draftGraphTimings !== undefined ? { draftGraphTimings } : {}),
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build PatchOperation[] for a full draft (add_node + add_edge for all elements).
 */
function buildFullDraftOps(graph: unknown): PatchOperation[] {
  const ops: PatchOperation[] = [];
  const g = graph as Record<string, unknown>;

  // Add nodes
  const nodes = g.nodes as unknown[] | undefined;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const nodeId = (node as Record<string, unknown>).id as string;
      ops.push({
        op: 'add_node',
        path: `/nodes/${nodeId}`,
        value: node,
      });
    }
  }

  // Add edges
  const edges = g.edges as unknown[] | undefined;
  if (Array.isArray(edges)) {
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i] as Record<string, unknown>;
      const from = edge.from as string;
      const to = edge.to as string;
      ops.push({
        op: 'add_edge',
        path: `/edges/${from}->${to}`,
        value: edge,
      });
    }
  }

  return ops;
}

/**
 * Check if an unknown value is a GraphV3T-compatible object (has nodes and edges arrays).
 */
function isGraphV3(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const g = value as Record<string, unknown>;
  return Array.isArray(g.nodes) && Array.isArray(g.edges);
}

/**
 * Extract structured draft warnings (CEEStructuralWarningV1[]) from pipeline response body.
 * Reads body.draft_warnings — an array of typed warning objects.
 */
function extractStructuredWarnings(body: Record<string, unknown>): CEEDraftWarning[] {
  const raw = body.draft_warnings;
  if (!Array.isArray(raw)) return [];

  const warnings: CEEDraftWarning[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const obj = w as Record<string, unknown>;
    if (typeof obj.id !== 'string' || typeof obj.severity !== 'string') continue;
    warnings.push({
      id: obj.id,
      severity: obj.severity as CEEDraftWarning['severity'],
      affected_node_ids: Array.isArray(obj.affected_node_ids) ? obj.affected_node_ids.filter((x): x is string => typeof x === 'string') : undefined,
      affected_edge_ids: Array.isArray(obj.affected_edge_ids) ? obj.affected_edge_ids.filter((x): x is string => typeof x === 'string') : undefined,
      explanation: typeof obj.explanation === 'string' ? obj.explanation : undefined,
      fix_hint: typeof obj.fix_hint === 'string' ? obj.fix_hint : undefined,
      node_ids: Array.isArray(obj.node_ids) ? obj.node_ids.filter((x): x is string => typeof x === 'string') : undefined,
      edge_ids: Array.isArray(obj.edge_ids) ? obj.edge_ids.filter((x): x is string => typeof x === 'string') : undefined,
    });
  }
  return warnings;
}

/**
 * Extract repairs from pipeline response trace.
 * The unified pipeline stores deterministic repairs at
 * trace.pipeline.repair_summary.deterministic_repairs and structural edge
 * repairs at trace.pipeline.repair_summary.structural_edge_normalisation.repairs.
 * Convert them to RepairEntry[] so the UI can surface them.
 */
function extractRepairsApplied(body: Record<string, unknown>): RepairEntry[] {
  const trace = body.trace as Record<string, unknown> | undefined;
  if (!trace) return [];

  const pipeline = trace.pipeline as Record<string, unknown> | undefined;
  const raw = pipeline?.repair_summary ?? trace.repair_summary;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const repairSummary = raw as Record<string, unknown>;

  const entries: RepairEntry[] = [];

  // Deterministic sweep repairs
  const deterministicRepairs = repairSummary.deterministic_repairs;
  if (Array.isArray(deterministicRepairs)) {
    for (const r of deterministicRepairs) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as Record<string, unknown>;
      if (typeof rec.code === 'string' && typeof rec.reason === 'string') {
        entries.push({
          code: rec.code,
          layer: 'cee' as const,
          field_path: typeof rec.path === 'string' ? rec.path : typeof rec.field_path === 'string' ? rec.field_path : '',
          before: rec.before ?? rec.from_value ?? null,
          after: rec.after ?? rec.to_value ?? null,
          reason: rec.reason,
          severity: (rec.severity === 'warn' ? 'warn' : 'info') as 'info' | 'warn',
          action: typeof rec.action === 'string' ? rec.action : 'repaired',
        });
      }
    }
  }

  // Structural edge normalisation repairs
  const strEdgeNorm = repairSummary.structural_edge_normalisation as Record<string, unknown> | undefined;
  const strRepairs = strEdgeNorm?.repairs;
  if (Array.isArray(strRepairs)) {
    for (const r of strRepairs) {
      if (!r || typeof r !== 'object') continue;
      const rec = r as Record<string, unknown>;
      entries.push({
        code: typeof rec.code === 'string' ? rec.code : 'STRUCTURAL_EDGE_NORMALISED',
        layer: 'cee' as const,
        field_path: typeof rec.field === 'string' ? rec.field : '',
        before: rec.from_value ?? null,
        after: rec.to_value ?? null,
        reason: typeof rec.reason === 'string' ? rec.reason : 'Structural edge normalised',
        severity: 'info' as const,
        action: typeof rec.action === 'string' ? rec.action : 'normalised',
      });
    }
  }

  // Graph data integrity repairs
  const gdi = repairSummary.graph_data_integrity as Record<string, unknown> | undefined;
  if (gdi) {
    for (const key of ['scale_consistency_repairs', 'edge_field_repairs'] as const) {
      const repairs = gdi[key];
      if (!Array.isArray(repairs)) continue;
      for (const r of repairs) {
        if (!r || typeof r !== 'object') continue;
        const rec = r as Record<string, unknown>;
        entries.push({
          code: typeof rec.code === 'string' ? rec.code : `GDI_${key.toUpperCase()}`,
          layer: 'cee' as const,
          field_path: typeof rec.field_path === 'string' ? rec.field_path : typeof rec.field === 'string' ? rec.field : '',
          before: rec.before ?? rec.from_value ?? null,
          after: rec.after ?? rec.to_value ?? null,
          reason: typeof rec.reason === 'string' ? rec.reason : `Graph data integrity: ${key.replace(/_/g, ' ')}`,
          severity: 'info' as const,
          action: typeof rec.action === 'string' ? rec.action : 'repaired',
        });
      }
    }
  }

  return entries;
}

/**
 * Extract validation warnings from pipeline response body.
 */
function extractWarnings(body: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  // Pipeline may include validation_warnings at top level
  const topLevel = body.validation_warnings;
  if (Array.isArray(topLevel)) {
    for (const w of topLevel) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  // Pipeline may include warnings in debug section
  const debug = body.debug as Record<string, unknown> | undefined;
  if (debug?.warnings && Array.isArray(debug.warnings)) {
    for (const w of debug.warnings) {
      if (typeof w === 'string') warnings.push(w);
    }
  }

  return warnings;
}

/**
 * Extract coaching summary and strengthen_items from pipeline response body.
 * Returns a formatted narration hint string, or null if coaching data is absent.
 */
function extractCoachingSummary(body: Record<string, unknown>): string | null {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return null;

  const parts: string[] = [];

  const summary = coaching.summary;
  if (typeof summary === 'string' && summary.length > 0) {
    parts.push(summary);
  }

  const strengthen = coaching.strengthen_items;
  if (Array.isArray(strengthen) && strengthen.length > 0) {
    // strengthen_items are objects per Zod schema: {id, label, detail, action_type, bias_category?}
    const labels = strengthen
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
      .map((item) => typeof item.label === 'string' ? item.label : null)
      .filter((label): label is string => label != null && label.length > 0);
    if (labels.length > 0) {
      parts.push('Strengthen: ' + labels.map((l) => `- ${l}`).join(', '));
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/** Extract raw coaching.summary text for V5 ContextPack threading. */
function extractCoachingSummaryRaw(body: Record<string, unknown>): string | null {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return null;
  const summary = coaching.summary;
  return typeof summary === 'string' && summary.length > 0 ? summary : null;
}

/** Extract raw coaching.widening_log; pass-through array or null. */
function extractCoachingWideningLog(body: Record<string, unknown>): readonly unknown[] | null {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return null;
  const raw = coaching.widening_log;
  return Array.isArray(raw) ? raw : null;
}

/**
 * Extract the canonical (v0.11.0+) coaching.widening_log OBJECT and narrow it
 * to `{elements_added, elements_considered_but_excluded, brief_completeness}`,
 * or null. Mirrors `narrowWideningLog` in `../draft-coaching.ts` (kept local to
 * avoid a value import into the tool layer). `extractCoachingWideningLog` above
 * only matches the legacy ARRAY shape, which the Anthropic-adapter normaliser
 * has already converted to this object — so on V5 that field is always null and
 * this is the live accessor. SAFETY: `elements_added` holds NODE IDs; callers
 * must never render its contents raw.
 */
function extractCoachingWideningLogObject(
  body: Record<string, unknown>,
): DraftCoachingWideningLog | null {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return null;
  const raw = coaching.widening_log;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const elementsAdded = Array.isArray(o.elements_added)
    ? o.elements_added.filter((s): s is string => typeof s === 'string')
    : [];
  const excluded = Array.isArray(o.elements_considered_but_excluded)
    ? o.elements_considered_but_excluded.filter((s): s is string => typeof s === 'string')
    : [];
  const briefCompleteness: DraftCoachingWideningLog['brief_completeness'] =
    o.brief_completeness === 'complete' || o.brief_completeness === 'partial' || o.brief_completeness === 'thin'
      ? o.brief_completeness
      : 'thin';
  return {
    elements_added: elementsAdded,
    elements_considered_but_excluded: excluded,
    brief_completeness: briefCompleteness,
  };
}

/** Extract raw coaching.bias_signals; pass-through array or null. */
function extractCoachingBiasSignals(body: Record<string, unknown>): readonly unknown[] | null {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return null;
  const raw = coaching.bias_signals;
  return Array.isArray(raw) ? raw : null;
}

/**
 * Extract structured strengthen_items from coaching data.
 * Validates each item against the Zod-defined shape.
 */
function extractStrengthenItems(body: Record<string, unknown>): StrengthenItem[] {
  const coaching = body.coaching as Record<string, unknown> | undefined;
  if (!coaching) return [];

  const raw = coaching.strengthen_items;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const items: StrengthenItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.detail !== 'string' || typeof item.action_type !== 'string') continue;
    items.push({
      id: item.id,
      label: item.label,
      detail: item.detail,
      action_type: item.action_type,
      ...(typeof item.bias_category === 'string' ? { bias_category: item.bias_category } : {}),
    });
  }
  return items;
}

/**
 * Extract analysis_ready payload from pipeline response body.
 * Present when the unified pipeline produces a V3 schema response with
 * options, interventions, and goal_node_id.
 *
 * Preserves source status from each option (falls back to 'ready' when absent).
 * Carries through Batch 1 optional fields: is_baseline, intervention_details,
 * extraction_metadata, raw_interventions, status_reason.
 *
 * Validates the constructed payload against AnalysisReadyPayload before returning.
 * Returns undefined (not a malformed payload) if validation fails.
 */
export function extractAnalysisReady(
  body: Record<string, unknown>,
): GraphPatchBlockData['analysis_ready'] | undefined {
  const ar = body.analysis_ready as Record<string, unknown> | undefined;
  if (!ar || typeof ar !== 'object') {
    log.info({ omission_reason: 'not_in_pipeline_body', body_keys: Object.keys(body) }, 'analysis_ready absent from pipeline body');
    return undefined;
  }

  const arKeys = Object.keys(ar);

  const goalNodeId = ar.goal_node_id;
  if (typeof goalNodeId !== 'string') {
    log.warn({ omission_reason: 'contract_validation_failed', field: 'goal_node_id', analysis_ready_keys: arKeys }, 'analysis_ready missing or invalid goal_node_id');
    return undefined;
  }

  const status = ar.status;
  if (typeof status !== 'string') {
    log.warn({ omission_reason: 'contract_validation_failed', field: 'status', analysis_ready_keys: arKeys }, 'analysis_ready missing or invalid status');
    return undefined;
  }

  const rawOptions = ar.options;
  if (!Array.isArray(rawOptions)) {
    log.warn({ omission_reason: 'contract_validation_failed', field: 'options', analysis_ready_keys: arKeys }, 'analysis_ready missing or invalid options array');
    return undefined;
  }

  // Build options for the contract (outward contract uses option_id, not id)
  type AnalysisReadyOption = NonNullable<GraphPatchBlockData['analysis_ready']>['options'][number];
  const options: AnalysisReadyOption[] = [];
  for (const opt of rawOptions) {
    if (!opt || typeof opt !== 'object') continue;
    const o = opt as Record<string, unknown>;
    // OptionForAnalysis schema uses `id`, not `option_id`
    const optionId = (o.id ?? o.option_id) as unknown;
    const label = o.label;
    const intv = o.interventions;
    if (typeof optionId !== 'string' || typeof label !== 'string') continue;
    if (!intv || typeof intv !== 'object') continue;

    // Flatten intervention values: { fac_id: 0.5 } or { fac_id: { value: 0.5 } }
    const flat: Record<string, number> = {};
    for (const [key, val] of Object.entries(intv as Record<string, unknown>)) {
      if (typeof val === 'number') {
        flat[key] = val;
      } else if (val && typeof val === 'object' && 'value' in val) {
        const v = (val as Record<string, unknown>).value;
        if (typeof v === 'number') flat[key] = v;
      }
    }

    const built: AnalysisReadyOption = {
      option_id: optionId,
      label: label as string,
      status: typeof o.status === 'string' ? o.status : 'ready',
      interventions: flat,
    };

    // Carry through Batch 1 optional fields (CEE-2, CEE-9)
    if (o.is_baseline === true || o.is_baseline === false) {
      built.is_baseline = o.is_baseline as boolean;
    }
    if (o.intervention_details != null && typeof o.intervention_details === 'object'
        && Object.keys(o.intervention_details as object).length > 0) {
      built.intervention_details = o.intervention_details as AnalysisReadyOption['intervention_details'];
    }
    if (o.extraction_metadata != null && typeof o.extraction_metadata === 'object'
        && Object.keys(o.extraction_metadata as object).length > 0) {
      built.extraction_metadata = o.extraction_metadata as Record<string, unknown>;
    }
    if (o.raw_interventions != null && typeof o.raw_interventions === 'object'
        && Object.keys(o.raw_interventions as object).length > 0) {
      built.raw_interventions = o.raw_interventions as Record<string, unknown>;
    }
    if (typeof o.status_reason === 'string') {
      built.status_reason = o.status_reason;
    }

    options.push(built);
  }

  if (options.length === 0) {
    log.warn({ omission_reason: 'contract_validation_failed', raw_option_count: rawOptions.length }, 'analysis_ready has no valid options after filtering');
    return undefined;
  }

  const payload = {
    options,
    goal_node_id: goalNodeId,
    status,
    blockers: Array.isArray(ar.blockers) ? ar.blockers : undefined,
    model_adjustments: Array.isArray(ar.model_adjustments) ? ar.model_adjustments : undefined,
    goal_threshold: typeof ar.goal_threshold === 'number' ? ar.goal_threshold : undefined,
    // ROADMAP 2.315(a) — the raw target trio. This function is a NAMED-FIELD
    // RE-PROJECTION (it rebuilds the payload key by key rather than spreading),
    // so an additive field carried at the builder would be silently dropped
    // here on the draft path alone unless it is also named. RAW-ANCHORED via
    // the shared rule; carried verbatim, never re-derived.
    ...pickGoalThresholdTrio(ar),
    bias_findings: Array.isArray(ar.bias_findings)
      ? ar.bias_findings as NonNullable<GraphPatchBlockData['analysis_ready']>['bias_findings']
      : [],
  };

  // Validate against AnalysisReadyPayload contract before emitting.
  // The schema expects `id` on options (OptionForAnalysis), but the outward contract
  // uses `option_id`. Re-map for validation, then return the option_id version.
  const forValidation = {
    ...payload,
    options: payload.options.map(({ option_id, ...rest }) => ({
      id: option_id,
      ...rest,
    })),
  };

  const result = AnalysisReadyPayload.safeParse(forValidation);
  if (!result.success) {
    log.warn(
      {
        errors_flat: result.error.flatten(),
        error_paths: result.error.issues.slice(0, 3).map(i => ({ path: i.path, message: i.message })),
        body_keys: Object.keys(body),
        omission_reason: 'contract_validation_failed',
      },
      'analysis_ready failed contract validation, omitting from block',
    );
    return undefined;
  }

  return payload;
}

/**
 * Extract tool-level LLM telemetry from the pipeline response body.
 *
 * The unified pipeline writes LLM metadata in two locations:
 *   1. trace.pipeline.llm_metadata.* (authoritative — Step 14 of package.ts)
 *   2. trace.* (root level — Step 9 legacy shape)
 *
 * We prefer llm_metadata (complete set), falling back to root trace fields.
 */
function extractToolLLMTelemetry(
  body: Record<string, unknown>,
): DraftGraphResult['toolLLMTelemetry'] {
  const trace = body.trace as Record<string, unknown> | undefined;
  if (!trace) return undefined;

  // Authoritative: trace.pipeline.llm_metadata
  const pipeline = trace.pipeline as Record<string, unknown> | undefined;
  const llmMeta = pipeline?.llm_metadata as Record<string, unknown> | undefined;

  // Fallback: root trace fields (Step 9)
  const tokenUsage = (llmMeta?.token_usage ?? trace.token_usage) as
    | { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    | undefined;

  const model = (llmMeta?.model ?? trace.model) as string | undefined;
  const durationMs = (llmMeta?.duration_ms ?? (trace.engine as Record<string, unknown> | undefined)?.provider_latency_ms) as number | undefined;
  const finishReason = (llmMeta?.finish_reason ?? trace.finish_reason) as string | undefined;
  const promptVersion = (llmMeta?.prompt_version ?? trace.prompt_version) as string | undefined;
  const promptHash = (llmMeta?.prompt_hash ?? trace.prompt_hash) as string | undefined;

  // Emit telemetry whenever an LLM call occurred (model present), even if
  // token_usage is missing. Zero tokens is better than invisible LLM calls.
  if (!tokenUsage && !model) return undefined;

  return {
    tool: 'draft_graph',
    model: typeof model === 'string' ? model : '',
    provider: 'anthropic',
    input_tokens: tokenUsage?.prompt_tokens ?? 0,
    output_tokens: tokenUsage?.completion_tokens ?? 0,
    latency_ms: typeof durationMs === 'number' ? durationMs : 0,
    stop_reason: typeof finishReason === 'string' ? finishReason : 'end_turn',
    thinking_enabled: false,
    structured_outputs_used: !!(body._structured_outputs_used ?? llmMeta?.structured_outputs_used),
    prompt_version: typeof promptVersion === 'string' ? promptVersion : undefined,
    prompt_hash: typeof promptHash === 'string' ? promptHash : undefined,
  };
}

/**
 * Extract the first sentence from text (up to 200 chars).
 * Used for assistant_text headline to avoid duplicating full coaching.
 */
function extractFirstSentence(text: string): string {
  // Match first sentence boundary: ! or ? anywhere, or . followed by
  // (whitespace + uppercase letter) or end-of-string. This avoids splitting
  // on decimal numbers ("3.5x", "0.7") or abbreviations mid-sentence.
  const match = text.match(/^.+?(?:[!?]|\.(?=\s+[A-Z]|\s*$))/);
  if (match && match[0].length <= 200) {
    return match[0].trim();
  }
  // Fallback: truncate at 200 chars with ellipsis
  if (text.length > 200) {
    return text.substring(0, 197).trim() + '...';
  }
  return text;
}

// Test-only exports for contract testing
export const __test_only = { extractToolLLMTelemetry, extractFirstSentence };
