/**
 * SSE Streaming Helpers (v1.8.0)
 *
 * Utilities for streaming with auto-reconnect support
 */

import type {
  SseEvent,
  DraftGraphRequest,
  RequestOptions,
} from "./types.js";
import {
  OlumiConfigError,
  OlumiAPIError,
  OlumiNetworkError,
} from "./errors.js";
import { sign } from "./hmac.js";

/**
 * Configuration for SSE streaming
 */
export interface SseStreamConfig {
  baseUrl: string;
  apiKey?: string;
  hmacSecret?: string;
  timeout?: number;
  onDegraded?: (kind: string) => void;
}

/**
 * Parse SSE event from raw text
 *
 * @internal
 */
function parseSseEvent(eventText: string): SseEvent | null {
  const lines = eventText.trim().split("\n");
  let eventType: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      eventType = line.substring(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.substring(6));
    } else if (line.startsWith(": ")) {
      // Heartbeat comment
      eventType = "heartbeat";
    }
  }

  if (!eventType) {
    return null;
  }

  // Handle heartbeat events
  if (eventType === "heartbeat" || dataLines.length === 0) {
    return {
      type: "heartbeat",
      data: null,
    };
  }

  // Parse JSON data
  const dataStr = dataLines.join("\n");
  let data: unknown;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // Malformed JSON, skip event
    return null;
  }

  // Type-specific parsing
  switch (eventType) {
    case "stage":
      return { type: "stage", data: data as any };
    case "resume":
      return { type: "resume", data: data as any };
    case "complete":
      return { type: "complete", data: data as any };
    case "error":
      return { type: "error", data: data as any };
    case "needs_clarification":
      return { type: "needs_clarification", data: data as any };
    default:
      return null;
  }
}


/**
 * Stream draft-graph with SSE
 *
 * Returns an async iterable of SSE events. Automatically captures resume token
 * on first event (seq=1).
 *
 * @param config - SSE stream configuration
 * @param request - Draft graph request
 * @param options - Request options (signal, timeout)
 * @returns Async iterable of SSE events
 *
 * @example
 * ```typescript
 * const events = streamDraftGraph(
 *   { baseUrl, apiKey },
 *   { brief: "Create a todo app" },
 *   { signal: abortController.signal }
 * );
 *
 * let resumeToken: string | null = null;
 * for await (const event of events) {
 *   // Capture resume token
 *   const token = extractResumeTokenFromEvent(event);
 *   if (token) resumeToken = token;
 *
 *   // Handle stage events
 *   if (event.type === 'stage') {
 *     console.log('Stage:', event.data.stage);
 *   }
 * }
 * ```
 */
export async function* streamDraftGraph(
  config: SseStreamConfig,
  request: DraftGraphRequest,
  options?: RequestOptions
): AsyncIterable<SseEvent> {
  const { baseUrl, apiKey, hmacSecret, timeout = 60000 } = config;
  const url = `${baseUrl}/assist/v1/draft-graph/stream`;
  const signal = options?.signal;

  // Validate config
  if (!hmacSecret && (!apiKey || apiKey.trim().length === 0)) {
    throw new OlumiConfigError("Either API key or HMAC secret is required");
  }

  // Build headers
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };

  // Use HMAC authentication if secret is provided, otherwise use API key
  if (hmacSecret) {
    const bodyString = JSON.stringify(request);
    const hmacHeaders = sign("POST", "/assist/draft-graph/stream", bodyString, {
      secret: hmacSecret,
    });

    headers["X-Olumi-Signature"] = hmacHeaders["X-Olumi-Signature"];
    headers["X-Olumi-Timestamp"] = hmacHeaders["X-Olumi-Timestamp"];
    headers["X-Olumi-Nonce"] = hmacHeaders["X-Olumi-Nonce"];
  } else {
    headers["X-Olumi-Assist-Key"] = apiKey!;
  }

  // Create timeout signal
  const timeoutSignal = AbortSignal.timeout(timeout);

  // Combine signals
  let combinedSignal: AbortSignal;
  if (signal) {
    // Use AbortSignal.any() if available (Node 20+), otherwise manual combination
    if (typeof (AbortSignal as any).any === "function") {
      combinedSignal = (AbortSignal as any).any([signal, timeoutSignal]);
    } else {
      const controller = new AbortController();
      const abortHandler = () => controller.abort();
      signal.addEventListener("abort", abortHandler);
      timeoutSignal.addEventListener("abort", abortHandler);
      combinedSignal = controller.signal;
    }
  } else {
    combinedSignal = timeoutSignal;
  }

  // Make request
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: combinedSignal,
    });
  } catch (error) {
    // Handle abort
    if (signal?.aborted) {
      throw new OlumiNetworkError("Request aborted by user", { cause: error });
    }

    // Handle timeout
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OlumiNetworkError(`Request timeout after ${timeout}ms`, {
        timeout: true,
        cause: error,
      });
    }

    // Handle network errors
    throw new OlumiNetworkError(
      "Network request failed - check your connection",
      { cause: error }
    );
  }

  if (!response) {
    throw new OlumiNetworkError("Network request failed - empty response");
  }

  // Surface degraded mode hint from headers (v1.11 SSE degraded mode)
  const degraded = response.headers?.get("X-Olumi-Degraded");
  if (degraded && typeof config.onDegraded === "function") {
    config.onDegraded(degraded);
  }

  // Check response status
  if (!response.ok) {
    // Try to parse error response
    let errorData: any;
    try {
      const text = await response.text();
      errorData = text
        ? JSON.parse(text)
        : {
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

    throw new OlumiAPIError(response.status, errorData);
  }

  // Stream events
  const reader = response.body?.getReader();
  if (!reader) {
    throw new OlumiNetworkError("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
     
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on double newline (event separator)
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || ""; // Keep incomplete event

      for (const part of parts) {
        if (part.trim()) {
          const event = parseSseEvent(part);
          if (event) {
            yield event;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Configuration for auto-reconnect streaming (v1.9.0)
 */
export interface AutoReconnectConfig extends SseStreamConfig {
  /**
   * Maximum number of reconnection attempts (default: 3)
   */
  maxRetries?: number;
  streamFactory?: (
    config: SseStreamConfig,
    request: DraftGraphRequest,
    options?: RequestOptions
  ) => AsyncIterable<SseEvent>;
}

/**
 * Stream draft-graph with automatic reconnection on disconnection (v1.9.0)
 *
 * Provides resilient streaming with automatic recovery on network errors,
 * 5xx errors, and timeouts. Retries start a fresh stream each time.
 *
 * **Exponential Backoff:**
 * - Attempt 1: 1.5s delay
 * - Attempt 2: 4s delay
 * - Attempt 3: 8s delay
 * - Max 3 retries (configurable)
 * - Respects server-provided Retry-After hints on 429
 *
 * **Error Handling:**
 * - Retries on: network errors, 5xx errors, timeouts, 429
 * - No retry on: other 4xx errors, user abort
 * - Cleans up all iterators in finally block
 */
export async function* streamDraftGraphWithAutoReconnect(
  config: AutoReconnectConfig,
  request: DraftGraphRequest,
  options?: RequestOptions
): AsyncIterable<SseEvent> {
  const { maxRetries = 3, ...streamConfig } = config;
  const streamFactory =
    config.streamFactory ??
    ((cfg: SseStreamConfig, req: DraftGraphRequest, opts?: RequestOptions) =>
      streamDraftGraph(cfg, req, opts));
  const backoffDelays = [1500, 4000, 8000]; // 1.5s, 4s, 8s
  let retryCount = 0;
  let currentStream: AsyncIterable<SseEvent> | null = null;
  let streamIterator: AsyncIterator<SseEvent> | null = null;

  try {
    currentStream = streamFactory(streamConfig, request, options);
    streamIterator = currentStream[Symbol.asyncIterator]();

    while (true) {
      try {
        const { done, value } = await streamIterator.next();
        if (done) break;

        yield value;

        // Reset retry count on successful event
        retryCount = 0;
      } catch (error) {
        const apiErrorLike =
          error instanceof OlumiAPIError ||
          (error && typeof (error as any).statusCode === "number");
        const statusCode = apiErrorLike ? ((error as any).statusCode as number) : undefined;

        const isRetryable =
          error instanceof OlumiNetworkError ||
          (apiErrorLike && statusCode !== undefined && (statusCode >= 500 || statusCode === 429));

        // Don't retry on user abort
        if (options?.signal?.aborted) {
          throw error;
        }

        // Check retry limit
        if (!isRetryable || retryCount >= maxRetries) {
          throw error;
        }

        retryCount++;

        // Prefer server-provided retry-after (seconds) if present, else fall back to static backoff
        const serverRetryAfterSec = (error as any)?.details?.retry_after_seconds ?? null;
        const delay =
          Number.isFinite(serverRetryAfterSec) && serverRetryAfterSec! > 0
            ? serverRetryAfterSec! * 1000
            : backoffDelays[Math.min(retryCount - 1, backoffDelays.length - 1)];

        await new Promise((resolve) => setTimeout(resolve, delay));

        // Start a fresh stream
        currentStream = streamFactory(streamConfig, request, options);
        streamIterator = currentStream[Symbol.asyncIterator]();
      }
    }
  } finally {
    if (streamIterator && typeof streamIterator.return === "function") {
      try {
        await streamIterator.return();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
