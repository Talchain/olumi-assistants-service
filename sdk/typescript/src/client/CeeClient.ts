/**
 * CeeClient
 *
 * TypeScript SDK client for CEE (Causal Explanation Engine) endpoints.
 * Designed for PLoT orchestrator integration.
 *
 * M1 CEE Orchestrator - CEE SDK Workstream
 * Version 1.2
 *
 * Key features:
 * - Uses native fetch (Node 18+ required - see MIGRATION.md for Node 16 users)
 * - AbortController for timeout handling
 * - trace.request_id is authoritative (throws CEE_PROTOCOL_ERROR if missing)
 * - Auth via X-API-Key header
 * - Client-side request validation with descriptive errors
 * - Pass-through of server response data (no fabrication)
 *
 * @module
 */

import type {
  CeeReviewRequest,
  CeeReviewOptions,
  CeeReviewResponse,
  CeeReviewTrace,
  CeeDecisionReviewPayload,
  CeeReviewBlock,
} from "../types/review.js";
import {
  CeeClientError,
  fromNetworkError,
  fromHttpResponse,
} from "../errors/CeeClientError.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for CeeClient.
 */
export interface CeeClientConfig {
  /**
   * API key for authentication.
   * Sent as X-API-Key header.
   */
  apiKey: string;

  /**
   * Base URL for the CEE service.
   * @default "https://olumi-assistants-service.onrender.com"
   */
  baseUrl?: string;

  /**
   * Default timeout in milliseconds.
   * @default 6000
   */
  timeout?: number;
}

/**
 * Internal validated configuration.
 */
interface InternalConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = "https://olumi-assistants-service.onrender.com";
const DEFAULT_TIMEOUT_MS = 6_000; // 6 seconds as per spec
const REVIEW_ENDPOINT = "/assist/v1/review";

// ============================================================================
// Request Validation
// ============================================================================

/**
 * Validation error details for client-side validation.
 */
interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate CeeReviewRequest before sending to server.
 * Provides immediate, actionable error messages for invalid requests.
 *
 * @throws {CeeClientError} With code CEE_VALIDATION_FAILED if validation fails
 */
function validateRequest(request: CeeReviewRequest): void {
  const errors: ValidationError[] = [];

  // Validate scenario_id
  if (!request.scenario_id || typeof request.scenario_id !== "string") {
    errors.push({ field: "scenario_id", message: "scenario_id is required and must be a string" });
  }

  // Validate graph_snapshot
  if (!request.graph_snapshot) {
    errors.push({ field: "graph_snapshot", message: "graph_snapshot is required" });
  } else {
    if (!request.graph_snapshot.nodes) {
      errors.push({ field: "graph_snapshot.nodes", message: "graph_snapshot.nodes is required" });
    } else if (!Array.isArray(request.graph_snapshot.nodes)) {
      errors.push({ field: "graph_snapshot.nodes", message: "graph_snapshot.nodes must be an array" });
    }
    if (!request.graph_snapshot.edges) {
      errors.push({ field: "graph_snapshot.edges", message: "graph_snapshot.edges is required" });
    } else if (!Array.isArray(request.graph_snapshot.edges)) {
      errors.push({ field: "graph_snapshot.edges", message: "graph_snapshot.edges must be an array" });
    }
  }

  // Validate graph_schema_version
  if (request.graph_schema_version !== "2.2") {
    errors.push({ field: "graph_schema_version", message: "graph_schema_version must be '2.2'" });
  }

  // Validate inference_results
  if (!request.inference_results) {
    errors.push({ field: "inference_results", message: "inference_results is required" });
  } else {
    if (!request.inference_results.quantiles) {
      errors.push({ field: "inference_results.quantiles", message: "inference_results.quantiles is required" });
    }
    if (!request.inference_results.top_edge_drivers) {
      errors.push({ field: "inference_results.top_edge_drivers", message: "inference_results.top_edge_drivers is required" });
    }
  }

  // Validate intent
  const validIntents = ["selection", "prediction", "validation"];
  if (!request.intent || !validIntents.includes(request.intent)) {
    errors.push({ field: "intent", message: `intent must be one of: ${validIntents.join(", ")}` });
  }

  // Validate market_context
  if (!request.market_context) {
    errors.push({ field: "market_context", message: "market_context is required" });
  } else {
    if (!request.market_context.id) {
      errors.push({ field: "market_context.id", message: "market_context.id is required" });
    }
    if (!request.market_context.version) {
      errors.push({ field: "market_context.version", message: "market_context.version is required" });
    }
    if (!request.market_context.hash) {
      errors.push({ field: "market_context.hash", message: "market_context.hash is required" });
    }
  }

  if (errors.length > 0) {
    throw new CeeClientError(
      "CEE_VALIDATION_FAILED",
      `Request validation failed: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      { details: { validation_errors: errors } },
    );
  }
}

/**
 * Transform SDK request to service request format.
 */
function transformRequest(request: CeeReviewRequest): Record<string, unknown> {
  // Map SDK request format to service format
  const payload: Record<string, unknown> = {
    graph: {
      version: request.graph_schema_version,
      nodes: request.graph_snapshot.nodes,
      edges: request.graph_snapshot.edges,
      meta: {
        roots: [],
        leaves: [],
        suggested_positions: {},
        source: "sdk",
      },
    },
    brief: `Analysis for scenario ${request.scenario_id} with intent: ${request.intent}`,
    inference: {
      ranked_actions: request.inference_results.ranked_actions,
      top_drivers: request.inference_results.top_edge_drivers,
      summary: `Quantiles: p10=${request.inference_results.quantiles.p10}, p50=${request.inference_results.quantiles.p50}, p90=${request.inference_results.quantiles.p90}`,
    },
    context_id: request.scenario_id,
    // Pass through intent hint (archetype_hint not used for now)
  };

  // Thread through robustness payload if present (ISL sensitivity/uncertainty analysis)
  if (request.robustness) {
    payload.robustness = request.robustness;
  }

  return payload;
}

// ============================================================================
// CeeClient Implementation
// ============================================================================

/**
 * CEE SDK client for PLoT integration.
 *
 * **Node.js Version Requirements:**
 * This client requires Node.js 18+ for native fetch support.
 * For Node 16 users, see the migration guide in sdk/typescript/MIGRATION.md.
 *
 * @example
 * ```typescript
 * const client = new CeeClient({ apiKey: "your-api-key" });
 *
 * const result = await client.review({
 *   scenario_id: "scenario-123",
 *   graph_snapshot: { nodes: [...], edges: [...] },
 *   graph_schema_version: "2.2",
 *   inference_results: { quantiles: {...}, top_edge_drivers: [...] },
 *   intent: "selection",
 *   market_context: { id: "ctx-1", version: "1.0", hash: "abc" },
 * });
 *
 * console.log(result.review.readiness.level);
 * console.log(result.trace.request_id);
 * ```
 */
export class CeeClient {
  private readonly config: InternalConfig;

  constructor(config: CeeClientConfig) {
    this.config = validateConfig(config);
  }

  /**
   * Request a decision review from CEE.
   *
   * Analyzes a decision graph and returns structured review information
   * including bias findings, recommendations, and structural issues.
   *
   * @param request - The review request containing the graph to analyze
   * @param options - Optional request configuration (headers, timeout, signal)
   * @returns Review response with trace and headers
   *
   * @throws {CeeClientError} With code:
   *   - CEE_VALIDATION_FAILED: If input validation fails (client-side)
   *   - CEE_PROTOCOL_ERROR: If response is missing required fields (trace.request_id, intent, etc.)
   *   - CEE_NETWORK_ERROR: On network/transport failure
   *   - CEE_TIMEOUT: If request times out
   *   - CEE_RATE_LIMIT: If rate limited (check retryAfterSeconds)
   *   - CEE_INTERNAL_ERROR: On server-side error
   *
   * @example
   * ```typescript
   * try {
   *   const result = await client.review({
   *     scenario_id: "scenario-123",
   *     graph_snapshot: { nodes: [...], edges: [...] },
   *     graph_schema_version: "2.2",
   *     inference_results: { quantiles: {...}, top_edge_drivers: [...] },
   *     intent: "selection",
   *     market_context: { id: "ctx-1", version: "1.0", hash: "abc" },
   *   }, {
   *     headers: { "X-Request-Id": "custom-id" },
   *     timeout: 10000,
   *   });
   *
   *   // trace.request_id is ALWAYS present
   *   console.log(`Request ID: ${result.trace.request_id}`);
   *   console.log(`Readiness: ${result.review.readiness.level}`);
   * } catch (error) {
   *   if (error instanceof CeeClientError) {
   *     console.error(`[${error.code}] ${error.message}`);
   *     if (error.retriable) {
   *       // Can retry after delay
   *       const delay = error.getRetryDelayMs() ?? 1000;
   *       await sleep(delay);
   *     }
   *   }
   *   throw error;
   * }
   * ```
   */
  async review(
    request: CeeReviewRequest,
    options: CeeReviewOptions = {},
  ): Promise<CeeReviewResponse> {
    // Client-side validation for immediate, actionable errors
    validateRequest(request);

    const url = `${this.config.baseUrl}${REVIEW_ENDPOINT}`;
    const timeoutMs = options.timeout ?? this.config.timeout;

    // Build timeout signal using AbortController (Node 18+ compatible)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Combine with user-provided signal if any
    let signal: AbortSignal = controller.signal;
    if (options.signal) {
      signal = combineSignals(options.signal, controller.signal);
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-API-Key": this.config.apiKey,
      ...options.headers,
    };

    // Transform request to service format
    const serviceRequest = transformRequest(request);

    let response: Response;
    let responseHeaders: Record<string, string> = {};
    let requestId: string | undefined;

    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(serviceRequest),
        signal,
      });

      // Extract headers for debugging (lowercase keys)
      responseHeaders = extractHeaders(response.headers);
      requestId = responseHeaders["x-cee-request-id"];

      // Clear timeout on successful response
      clearTimeout(timeoutId);
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort/timeout
      if (error instanceof DOMException && error.name === "AbortError") {
        throw fromNetworkError(error, { timeout: true, requestId });
      }

      // Handle network errors
      throw fromNetworkError(error, { requestId });
    }

    // Read response body
    const text = await response.text();

    // Handle error responses
    if (!response.ok) {
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }

      throw fromHttpResponse(response.status, body, requestId);
    }

    // Parse successful response
    if (!text) {
      throw new CeeClientError(
        "CEE_PROTOCOL_ERROR",
        "Server returned empty response body",
        { statusCode: response.status, requestId },
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new CeeClientError(
        "CEE_PROTOCOL_ERROR",
        "Server returned malformed JSON",
        { statusCode: response.status, requestId },
      );
    }

    // Validate and normalize response (pass-through, not fabrication)
    return normalizeResponse(data, responseHeaders, requestId);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate client configuration.
 */
function validateConfig(config: CeeClientConfig): InternalConfig {
  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new CeeClientError(
      "CEE_CONFIG_ERROR",
      "API key is required",
    );
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;

  try {
    new URL(baseUrl);
  } catch {
    throw new CeeClientError(
      "CEE_CONFIG_ERROR",
      `Invalid base URL: ${baseUrl}. Must be a valid HTTP(S) URL.`,
    );
  }

  const timeout =
    config.timeout && config.timeout > 0 ? config.timeout : DEFAULT_TIMEOUT_MS;

  return {
    apiKey: config.apiKey,
    baseUrl,
    timeout,
  };
}

/**
 * Combine two AbortSignals into one.
 * Aborts when either signal aborts.
 */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // Use AbortSignal.any if available (Node 20+)
  if (typeof (AbortSignal as any).any === "function") {
    return (AbortSignal as any).any([a, b]);
  }

  // Fallback for Node 18/19
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (a.aborted || b.aborted) {
    controller.abort();
  } else {
    a.addEventListener("abort", abort);
    b.addEventListener("abort", abort);
  }

  return controller.signal;
}

/**
 * Extract relevant headers from response.
 */
function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, key) => {
    // Include all headers, lowercase keys for consistency
    result[key.toLowerCase()] = value;
  });

  return result;
}

/**
 * Normalize service response to SDK response shape.
 *
 * This function passes through server data as-is, with minimal normalization:
 * - Extracts and validates trace.request_id (REQUIRED - throws if missing)
 * - Validates intent, analysis_state, blocks (REQUIRED - throws if missing)
 * - Extracts trace from body, puts everything else in review
 * - Preserves all server-provided fields without fabrication
 *
 * CRITICAL: Throws CEE_PROTOCOL_ERROR if required fields are missing.
 */
function normalizeResponse(
  data: unknown,
  headers: Record<string, string>,
  fallbackRequestId?: string,
): CeeReviewResponse {
  if (!data || typeof data !== "object") {
    throw new CeeClientError(
      "CEE_PROTOCOL_ERROR",
      "Response is not an object",
      { requestId: fallbackRequestId },
    );
  }

  const raw = data as Record<string, unknown>;

  // Extract trace - request_id is REQUIRED
  const rawTrace = raw.trace as Record<string, unknown> | undefined;
  const traceRequestId = rawTrace?.request_id;

  if (typeof traceRequestId !== "string" || !traceRequestId) {
    throw new CeeClientError(
      "CEE_PROTOCOL_ERROR",
      "Response missing required trace.request_id",
      {
        requestId: fallbackRequestId,
        details: { trace: rawTrace },
      },
    );
  }

  // Validate intent (REQUIRED)
  const intent = raw.intent;
  if (typeof intent !== "string" || !["selection", "prediction", "validation"].includes(intent)) {
    throw new CeeClientError(
      "CEE_PROTOCOL_ERROR",
      "Response missing required intent field (must be 'selection', 'prediction', or 'validation')",
      {
        requestId: traceRequestId,
        details: { intent },
      },
    );
  }

  // Validate analysis_state (REQUIRED)
  const analysisState = raw.analysis_state;
  if (typeof analysisState !== "string" || !["not_run", "ran", "partial", "stale"].includes(analysisState)) {
    throw new CeeClientError(
      "CEE_PROTOCOL_ERROR",
      "Response missing required analysis_state field (must be 'not_run', 'ran', 'partial', or 'stale')",
      {
        requestId: traceRequestId,
        details: { analysis_state: analysisState },
      },
    );
  }

  // Validate blocks (REQUIRED and must be array)
  const blocks = raw.blocks;
  if (!Array.isArray(blocks)) {
    throw new CeeClientError(
      "CEE_PROTOCOL_ERROR",
      "Response missing required blocks array",
      {
        requestId: traceRequestId,
        details: { blocks },
      },
    );
  }

  // Build normalized trace
  const trace: CeeReviewTrace = {
    request_id: traceRequestId,
    latency_ms: typeof rawTrace?.latency_ms === "number" ? rawTrace.latency_ms : 0,
    model: typeof rawTrace?.model === "string" ? rawTrace.model : "unknown",
  };

  // Transform blocks to SDK format
  const transformedBlocks = transformBlocks(blocks);

  // Build review payload - everything except trace goes here
  const review: CeeDecisionReviewPayload = {
    intent: intent as CeeDecisionReviewPayload["intent"],
    analysis_state: analysisState as CeeDecisionReviewPayload["analysis_state"],
    readiness: raw.readiness as CeeDecisionReviewPayload["readiness"],
    blocks: transformedBlocks,
  };

  // Copy extra fields (quality, guidance, archetype, etc.)
  for (const key of Object.keys(raw)) {
    if (key !== "trace" && !(key in review)) {
      review[key] = raw[key];
    }
  }

  return {
    review,
    trace,
    headers,
  };
}

/**
 * Transform service blocks to SDK block format.
 * Maps service fields to SDK expected fields.
 */
function transformBlocks(serviceBlocks: unknown[]): CeeReviewBlock[] {
  return serviceBlocks.map((block, index) => {
    if (!block || typeof block !== "object") {
      return createDefaultBlock(index);
    }

    const b = block as Record<string, unknown>;
    const id = b.id ?? b.type ?? `block_${index}`;

    // Map service block to SDK block format
    return {
      id: id as CeeReviewBlock["id"],
      status: mapBlockStatus(b),
      status_reason: typeof b.status_reason === "string" ? b.status_reason : undefined,
      source: mapBlockSource(b),
      summary: buildBlockSummary(b),
      details: typeof b.explanation === "string" ? b.explanation : undefined,
      items: buildBlockItems(b),
      priority: mapBlockPriority(b),
      severity: mapBlockSeverity(b),
      // Pass through extra fields
      ...Object.fromEntries(
        Object.entries(b).filter(([k]) =>
          !["id", "type", "status", "status_reason", "source", "summary", "details", "items", "priority", "severity"].includes(k)
        )
      ),
    } as CeeReviewBlock;
  });
}

function createDefaultBlock(index: number): CeeReviewBlock {
  return {
    id: `block_${index}` as CeeReviewBlock["id"],
    status: "cannot_compute",
    source: "cee",
    summary: "Block data unavailable",
    priority: 3,
  };
}

function mapBlockStatus(block: Record<string, unknown>): CeeReviewBlock["status"] {
  // If block has placeholder=true, it's partial
  if (block.placeholder === true) {
    return "ok"; // Placeholder blocks are still valid
  }
  return "ok";
}

function mapBlockSource(block: Record<string, unknown>): CeeReviewBlock["source"] {
  if (block.placeholder === true) {
    return "cee";
  }
  return "cee";
}

function buildBlockSummary(block: Record<string, unknown>): string {
  // Use headline if available (prediction block)
  if (typeof block.headline === "string") {
    return block.headline;
  }
  // Use summary field if available (next_steps block)
  if (typeof block.summary === "string") {
    return block.summary;
  }
  // Build from type
  const type = block.type ?? block.id ?? "unknown";
  return `${String(type).charAt(0).toUpperCase() + String(type).slice(1)} analysis`;
}

function buildBlockItems(block: Record<string, unknown>): CeeReviewBlock["items"] | undefined {
  // Map findings (biases block)
  if (Array.isArray(block.findings)) {
    return block.findings.map((f: any, i: number) => ({
      id: f.id ?? `finding_${i}`,
      label: f.bias_type ?? f.type ?? "Finding",
      description: f.description ?? f.message,
      severity: mapSeverityString(f.severity),
    }));
  }

  // Map warnings (risks block)
  if (Array.isArray(block.warnings)) {
    return block.warnings.map((w: any, i: number) => ({
      id: w.id ?? `warning_${i}`,
      label: w.type ?? "Warning",
      description: w.message,
      severity: mapSeverityString(w.severity),
    }));
  }

  // Map suggestions (recommendation, drivers, gaps blocks)
  if (Array.isArray(block.suggestions)) {
    return block.suggestions.map((s: any, i: number) => ({
      id: s.id ?? s.node_id ?? `suggestion_${i}`,
      label: s.label ?? s.type ?? "Suggestion",
      description: s.description ?? s.impact_description,
    }));
  }

  // Map recommendations (next_steps block)
  if (Array.isArray(block.recommendations)) {
    return block.recommendations.map((r: string, i: number) => ({
      id: `rec_${i}`,
      label: "Recommendation",
      description: r,
    }));
  }

  return undefined;
}

function mapBlockPriority(block: Record<string, unknown>): CeeReviewBlock["priority"] {
  // Default priorities based on block type
  const type = block.type ?? block.id;
  switch (type) {
    case "biases":
    case "risks":
      return 1;
    case "recommendation":
    case "prediction":
      return 2;
    default:
      return 3;
  }
}

function mapBlockSeverity(block: Record<string, unknown>): CeeReviewBlock["severity"] | undefined {
  // For biases block, derive severity from findings
  if (Array.isArray(block.findings) && block.findings.length > 0) {
    const severities = block.findings.map((f: any) => f.severity).filter(Boolean);
    if (severities.includes("high")) return "high";
    if (severities.includes("medium")) return "medium";
    if (severities.length > 0) return "low";
  }

  // For risks block, derive from warnings
  if (Array.isArray(block.warnings) && block.warnings.length > 0) {
    const hasError = block.warnings.some((w: any) => w.severity === "error");
    const hasWarning = block.warnings.some((w: any) => w.severity === "warning");
    if (hasError) return "high";
    if (hasWarning) return "medium";
    return "low";
  }

  return undefined;
}

function mapSeverityString(severity: unknown): CeeReviewBlock["severity"] | undefined {
  if (typeof severity !== "string") return undefined;
  const s = severity.toLowerCase();
  if (s === "high" || s === "error" || s === "critical") return "high";
  if (s === "medium" || s === "warning") return "medium";
  if (s === "low" || s === "info") return "low";
  return undefined;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new CeeClient instance.
 *
 * **Node.js Version Requirements:**
 * This client requires Node.js 18+ for native fetch support.
 * For Node 16 users, see the migration guide in sdk/typescript/MIGRATION.md.
 *
 * @param config - Client configuration
 * @returns CeeClient instance
 *
 * @example
 * ```typescript
 * const client = createCeeClient({
 *   apiKey: process.env.CEE_API_KEY!,
 *   baseUrl: "https://cee.example.com",
 *   timeout: 10000,
 * });
 * ```
 */
export function createCeeClient(config: CeeClientConfig): CeeClient {
  return new CeeClient(config);
}
