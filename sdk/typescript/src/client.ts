/**
 * Olumi Assistants SDK Client
 *
 * Official TypeScript client for Olumi Assistants Service
 */

import type {
  OlumiConfig,
  RequestOptions,
  DraftGraphRequest,
  DraftGraphResponse,
  SuggestOptionsRequest,
  SuggestOptionsResponse,
  ClarifyBriefRequest,
  ClarifyBriefResponse,
  CritiqueGraphRequest,
  CritiqueGraphResponse,
  ExplainDiffRequest,
  ExplainDiffResponse,
  EvidencePackRequest,
  EvidencePackResponse,
  ShareRequest,
  ShareResponse,
  ShareRevokeResponse,
  StatusResponse,
} from "./types.js";
import {
  OlumiConfigError,
  OlumiAPIError,
  OlumiNetworkError,
  OlumiValidationError,
} from "./errors.js";
import { sign } from "./hmac.js";

/**
 * Response metadata captured from HTTP headers
 */
export interface ResponseMetadata {
  requestId?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    reset: Date;
  };
}

/**
 * Enhanced API response with metadata
 */
export interface ApiResponse<T> {
  data: T;
  metadata: ResponseMetadata;
}

export class OlumiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly hmacSecret?: string;

  constructor(config: OlumiConfig) {
    // Validate configuration: either apiKey or hmacSecret is required
    if (!config.hmacSecret && (!config.apiKey || config.apiKey.trim().length === 0)) {
      throw new OlumiConfigError("Either API key or HMAC secret is required");
    }

    this.apiKey = config.apiKey;
    this.hmacSecret = config.hmacSecret;
    this.baseUrl =
      config.baseUrl || "https://olumi-assistants-service.onrender.com";
    this.timeout = config.timeout || 60000; // 60 seconds default
    this.maxRetries = config.maxRetries ?? 3; // 3 retries default
    this.retryDelay = config.retryDelay ?? 1000; // 1 second base delay

    // Validate baseUrl
    try {
      new URL(this.baseUrl);
    } catch {
      throw new OlumiConfigError(
        `Invalid base URL: ${this.baseUrl}. Must be a valid HTTP(S) URL.`
      );
    }
  }

  /**
   * Draft a decision graph from a brief description
   */
  async draftGraph(
    request: DraftGraphRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<DraftGraphResponse>> {
    this.validateDraftGraphRequest(request);
    return this.request<DraftGraphResponse>(
      "POST",
      "/assist/draft-graph",
      request,
      options
    );
  }

  /**
   * Suggest new options for a question node
   */
  async suggestOptions(
    request: SuggestOptionsRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<SuggestOptionsResponse>> {
    this.validateSuggestOptionsRequest(request);
    return this.request<SuggestOptionsResponse>(
      "POST",
      "/assist/suggest-options",
      request,
      options
    );
  }

  /**
   * Generate clarifying questions for an ambiguous brief
   */
  async clarifyBrief(
    request: ClarifyBriefRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<ClarifyBriefResponse>> {
    this.validateClarifyBriefRequest(request);
    return this.request<ClarifyBriefResponse>(
      "POST",
      "/assist/clarify-brief",
      request,
      options
    );
  }

  /**
   * Critique a decision graph for quality issues
   */
  async critiqueGraph(
    request: CritiqueGraphRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<CritiqueGraphResponse>> {
    this.validateCritiqueGraphRequest(request);
    return this.request<CritiqueGraphResponse>(
      "POST",
      "/assist/critique-graph",
      request,
      options
    );
  }

  /**
   * Explain the differences between two graph versions
   */
  async explainDiff(
    request: ExplainDiffRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<ExplainDiffResponse>> {
    this.validateExplainDiffRequest(request);
    return this.request<ExplainDiffResponse>(
      "POST",
      "/assist/explain-diff",
      request,
      options
    );
  }

  /**
   * Generate supporting evidence for a graph
   */
  async evidencePack(
    request: EvidencePackRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<EvidencePackResponse>> {
    this.validateEvidencePackRequest(request);
    return this.request<EvidencePackResponse>(
      "POST",
      "/assist/evidence-pack",
      request,
      options
    );
  }

  /**
   * Create a shareable link for a graph (v1.6 feature)
   */
  async createShare(
    request: ShareRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<ShareResponse>> {
    this.validateShareRequest(request);
    return this.request<ShareResponse>(
      "POST",
      "/assist/share",
      request,
      options
    );
  }

  /**
   * Revoke a share link (v1.6 feature)
   * @param token - The share token (from share URL, not the share_id)
   */
  async revokeShare(
    token: string,
    options?: RequestOptions
  ): Promise<ApiResponse<ShareRevokeResponse>> {
    if (!token || token.trim().length === 0) {
      throw new OlumiValidationError("Share token is required", "token");
    }
    return this.request<ShareRevokeResponse>(
      "DELETE",
      `/assist/share/${token}`,
      null,
      options
    );
  }

  /**
   * Get service status and diagnostics (v1.6 feature)
   */
  async getStatus(
    options?: RequestOptions
  ): Promise<ApiResponse<StatusResponse>> {
    return this.request<StatusResponse>("GET", "/v1/status", null, options);
  }

  /**
   * Health check endpoint
   */
  async healthCheck(options?: RequestOptions): Promise<
    ApiResponse<{
      ok: boolean;
      service: string;
      version: string;
      provider: string;
      model: string;
    }>
  > {
    return this.request(
      "GET",
      "/healthz",
      null,
      options
    );
  }

  /**
   * Internal request helper with retry logic and metadata extraction
   */
  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const maxRetries = options?.retries ?? this.maxRetries;
    const timeout = options?.timeout ?? this.timeout;
    const signal = options?.signal;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let cleanup: (() => void) | undefined;

      try {
        // Create timeout signal
        const timeoutSignal = AbortSignal.timeout(timeout);

        // Combine with user signal if provided
        let combinedSignal: AbortSignal;
        if (signal) {
          const combined = this.combineAbortSignals(signal, timeoutSignal);
          combinedSignal = combined.signal;
          cleanup = combined.cleanup;
        } else {
          combinedSignal = timeoutSignal;
        }

        const headers: Record<string, string> = {
          Accept: "application/json",
        };

        // Use HMAC authentication if secret is provided, otherwise use API key
        if (this.hmacSecret) {
          const bodyString = body !== null ? JSON.stringify(body) : undefined;
          const hmacHeaders = sign(method, path, bodyString, {
            secret: this.hmacSecret,
          });

          headers["X-Olumi-Signature"] = hmacHeaders["X-Olumi-Signature"];
          headers["X-Olumi-Timestamp"] = hmacHeaders["X-Olumi-Timestamp"];
          headers["X-Olumi-Nonce"] = hmacHeaders["X-Olumi-Nonce"];
        } else {
          headers["X-Olumi-Assist-Key"] = this.apiKey;
        }

        if (method === "POST" && body !== null) {
          headers["Content-Type"] = "application/json";
        }

        const response = await fetch(url, {
          method,
          headers,
          body: body !== null ? JSON.stringify(body) : undefined,
          signal: combinedSignal,
        });

        // Extract metadata from headers
        const metadata = this.extractMetadata(response);

        // Handle error responses BEFORE parsing JSON
        if (!response.ok) {
          // Try to parse error response, but don't fail if malformed
          let errorData: any;
          try {
            const text = await response.text();
            errorData = text ? JSON.parse(text) : {
              schema: "error.v1",
              code: "INTERNAL",
              message: `HTTP ${response.status}: ${response.statusText}`,
            };
          } catch {
            // Malformed response - create safe error
            errorData = {
              schema: "error.v1",
              code: response.status >= 500 ? "INTERNAL" : "BAD_INPUT",
              message: `HTTP ${response.status}: ${response.statusText}`,
            };
          }

          const apiError = new OlumiAPIError(response.status, errorData);

          // Retry on retryable errors (5xx, 429)
          if (apiError.isRetryable() && attempt < maxRetries) {
            lastError = apiError;

            // Use server's retry-after if available, otherwise exponential backoff
            const retryAfter =
              apiError.getRetryAfter() ?? this.calculateBackoff(attempt);

            await this.sleep(retryAfter);
            continue;
          }

          throw apiError;
        }

        // Parse successful response
        let data: T;
        try {
          data = await response.json();
        } catch (parseError) {
          // JSON parse error on successful response - this is a server bug, don't retry
          throw new OlumiAPIError(response.status, {
            schema: "error.v1",
            code: "INTERNAL",
            message: "Server returned malformed JSON",
          });
        }

        return { data, metadata };
      } catch (error) {
        // Don't retry on user abort
        if (signal?.aborted) {
          throw new OlumiNetworkError("Request aborted by user");
        }

        // Handle timeout
        if (error instanceof DOMException && error.name === "AbortError") {
          const timeoutError = new OlumiNetworkError(
            `Request timeout after ${timeout}ms`,
            error,
            true
          );

          if (attempt < maxRetries) {
            lastError = timeoutError;
            await this.sleep(this.calculateBackoff(attempt));
            continue;
          }

          throw timeoutError;
        }

        // Handle network errors (broad detection for fetch failures, DNS errors, etc.)
        const errorCode = (error as any).code;
        const networkErrorCodes = [
          "ENOTFOUND", // DNS lookup failed
          "ECONNREFUSED", // Connection refused
          "ETIMEDOUT", // Connection timeout
          "ECONNRESET", // Connection reset
          "EPIPE", // Broken pipe
          "EHOSTUNREACH", // Host unreachable
          "EAI_AGAIN", // DNS temporary failure
          "ENETUNREACH", // Network unreachable
        ];

        if (
          error instanceof TypeError ||
          (error instanceof Error &&
           (error.message.toLowerCase().includes("fetch") ||
            error.message.toLowerCase().includes("network") ||
            error.message.toLowerCase().includes("failed to fetch") ||
            networkErrorCodes.includes(errorCode)))
        ) {
          const networkError = new OlumiNetworkError(
            "Network request failed - check your connection",
            error
          );

          if (attempt < maxRetries) {
            lastError = networkError;
            await this.sleep(this.calculateBackoff(attempt));
            continue;
          }

          throw networkError;
        }

        // Rethrow API errors without retry
        if (error instanceof OlumiAPIError) {
          throw error;
        }

        // Unknown error - wrap and potentially retry
        const unknownError = new OlumiNetworkError(
          "Unknown error occurred",
          error as Error
        );

        if (attempt < maxRetries) {
          lastError = unknownError;
          await this.sleep(this.calculateBackoff(attempt));
          continue;
        }

        throw unknownError;
      } finally {
        // Clean up event listeners to prevent memory leaks
        cleanup?.();
      }
    }

    // If we exhausted all retries, throw the last error
    throw (
      lastError ||
      new OlumiNetworkError("Request failed after all retry attempts")
    );
  }

  /**
   * Extract metadata from response headers
   */
  private extractMetadata(response: Response): ResponseMetadata {
    const metadata: ResponseMetadata = {};

    // Extract request ID
    const requestId = response.headers.get("X-Request-Id");
    if (requestId) {
      metadata.requestId = requestId;
    }

    // Extract rate limit info
    const rateLimit = response.headers.get("X-RateLimit-Limit");
    const rateRemaining = response.headers.get("X-RateLimit-Remaining");
    const rateReset = response.headers.get("X-RateLimit-Reset");

    if (rateLimit && rateRemaining && rateReset) {
      metadata.rateLimit = {
        limit: parseInt(rateLimit, 10),
        remaining: parseInt(rateRemaining, 10),
        reset: new Date(parseInt(rateReset, 10) * 1000),
      };
    }

    return metadata;
  }

  /**
   * Combine multiple AbortSignals
   * Uses AbortSignal.any() if available (Node 20+), otherwise manual combination with cleanup
   */
  private combineAbortSignals(...signals: AbortSignal[]): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    // Use native AbortSignal.any() if available (Node 20+, modern browsers)
    if (typeof (AbortSignal as any).any === "function") {
      return {
        signal: (AbortSignal as any).any(signals),
        cleanup: () => {}, // No cleanup needed for native implementation
      };
    }

    // Fallback: manual combination with proper cleanup
    const controller = new AbortController();
    const listeners: Array<{ signal: AbortSignal; handler: () => void }> = [];

    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }

      const handler = () => {
        controller.abort();
        // Clean up all listeners when any signal aborts
        for (const { signal: s, handler: h } of listeners) {
          s.removeEventListener("abort", h);
        }
      };

      signal.addEventListener("abort", handler);
      listeners.push({ signal, handler });
    }

    // Return signal and cleanup function to remove listeners
    const cleanup = () => {
      for (const { signal: s, handler: h } of listeners) {
        s.removeEventListener("abort", h);
      }
    };

    return { signal: controller.signal, cleanup };
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attempt: number): number {
    // Exponential backoff with jitter: baseDelay * 2^attempt * (1 + random(0, 0.3))
    const exponentialDelay = this.retryDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 + 1;
    return Math.min(exponentialDelay * jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===== Input Validation =====

  private validateDraftGraphRequest(request: DraftGraphRequest): void {
    if (!request.brief || request.brief.trim().length === 0) {
      throw new OlumiValidationError(
        "Brief is required and cannot be empty",
        "brief"
      );
    }

    if (request.brief.length > 50000) {
      throw new OlumiValidationError(
        "Brief must be less than 50,000 characters",
        "brief"
      );
    }

    if (request.attachments) {
      if (!Array.isArray(request.attachments)) {
        throw new OlumiValidationError(
          "Attachments must be an array",
          "attachments"
        );
      }

      for (const attachment of request.attachments) {
        if (!attachment.id || !attachment.name) {
          throw new OlumiValidationError(
            "Each attachment must have id and name",
            "attachments"
          );
        }
      }
    }
  }

  private validateSuggestOptionsRequest(request: SuggestOptionsRequest): void {
    if (!request.graph) {
      throw new OlumiValidationError("Graph is required", "graph");
    }

    if (!request.question_id || request.question_id.trim().length === 0) {
      throw new OlumiValidationError(
        "Question ID is required",
        "question_id"
      );
    }

    this.validateGraph(request.graph);
  }

  private validateClarifyBriefRequest(request: ClarifyBriefRequest): void {
    if (!request.brief || request.brief.trim().length === 0) {
      throw new OlumiValidationError(
        "Brief is required and cannot be empty",
        "brief"
      );
    }

    if (request.round !== undefined && request.round < 0) {
      throw new OlumiValidationError("Round must be non-negative", "round");
    }
  }

  private validateCritiqueGraphRequest(request: CritiqueGraphRequest): void {
    if (!request.graph) {
      throw new OlumiValidationError("Graph is required", "graph");
    }

    this.validateGraph(request.graph);
  }

  private validateExplainDiffRequest(request: ExplainDiffRequest): void {
    if (!request.patch) {
      throw new OlumiValidationError("Patch is required", "patch");
    }

    const hasAdds = request.patch.adds &&
      (request.patch.adds.nodes?.length || request.patch.adds.edges?.length);
    const hasRemoves = request.patch.removes &&
      (request.patch.removes.nodes?.length || request.patch.removes.edges?.length);
    const hasUpdates = request.patch.updates?.nodes?.length;

    if (!hasAdds && !hasRemoves && !hasUpdates) {
      throw new OlumiValidationError(
        "Patch must contain at least one add, remove, or update",
        "patch"
      );
    }
  }

  private validateEvidencePackRequest(request: EvidencePackRequest): void {
    if (!request.graph) {
      throw new OlumiValidationError("Graph is required", "graph");
    }

    this.validateGraph(request.graph);
  }

  private validateShareRequest(request: ShareRequest): void {
    if (!request.graph) {
      throw new OlumiValidationError("Graph is required", "graph");
    }

    this.validateGraph(request.graph);

    if (
      request.redaction_mode &&
      !["minimal", "full"].includes(request.redaction_mode)
    ) {
      throw new OlumiValidationError(
        "Redaction mode must be 'minimal' or 'full'",
        "redaction_mode"
      );
    }
  }

  private validateGraph(graph: { nodes?: unknown[]; edges?: unknown[] }): void {
    if (!graph.nodes || !Array.isArray(graph.nodes)) {
      throw new OlumiValidationError(
        "Graph must have a nodes array",
        "graph.nodes"
      );
    }

    if (!graph.edges || !Array.isArray(graph.edges)) {
      throw new OlumiValidationError(
        "Graph must have an edges array",
        "graph.edges"
      );
    }

    if (graph.nodes.length === 0) {
      throw new OlumiValidationError(
        "Graph must have at least one node",
        "graph.nodes"
      );
    }
  }
}
