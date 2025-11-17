/**
 * SSE Resume Helpers (v1.8.0)
 *
 * Utilities for streaming with resume support
 */

import type {
  SseEvent,
  ResumeToken,
  ResumeOptions,
  ResumeResult,
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
      return {
        type: "stage",
        data: data as any,
      };
    case "resume":
      return {
        type: "resume",
        data: data as any,
      };
    case "complete":
      return {
        type: "complete",
        data: data as any,
      };
    default:
      return null;
  }
}

/**
 * Extract resume token from SSE event stream
 *
 * Scans SSE events for the resume token (emitted as second event, seq=1)
 *
 * @param event - SSE event to check
 * @returns Resume token if found, null otherwise
 *
 * @example
 * ```typescript
 * for await (const event of streamDraftGraph(...)) {
 *   const token = extractResumeTokenFromEvent(event);
 *   if (token) {
 *     localStorage.setItem('resumeToken', token);
 *   }
 * }
 * ```
 */
export function extractResumeTokenFromEvent(event: SseEvent): ResumeToken | null {
  if (event.type === "resume") {
    return event.data.token;
  }
  return null;
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
  const url = `${baseUrl}/assist/draft-graph/stream`;
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
    // eslint-disable-next-line no-constant-condition
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
 * Resume an interrupted draft-graph stream
 *
 * Replays buffered events from the last sequence number in the resume token.
 *
 * ⚠️ **Important - Replay-Only Behavior (v1.8.0)**
 *
 * The resume endpoint implements **replay-only** behavior:
 * 1. Server replays all buffered events since the token sequence
 * 2. For **completed streams**: Final `complete` event is sent, then connection closes
 * 3. For **in-progress streams**: Buffered events are replayed, heartbeat sent, then connection closes
 *
 * **This means:**
 * - Resume does NOT keep the connection open for live events
 * - Clients must reconnect to the main stream endpoint for ongoing updates
 * - Resume is designed for recovering missed events after disconnection
 *
 * @param config - SSE stream configuration
 * @param options - Resume options (token, signal, timeout)
 * @returns Resume result with replayed events
 *
 * @example
 * ```typescript
 * try {
 *   const result = await resumeDraftGraph(
 *     { baseUrl, apiKey },
 *     { token: savedToken, signal: abortController.signal }
 *   );
 *
 *   console.log(`Replayed ${result.replayedCount} events`);
 *   if (result.completed) {
 *     console.log('Stream completed');
 *   } else {
 *     console.log('Need to reconnect for live events');
 *     // Reconnect to main stream endpoint
 *   }
 * } catch (error) {
 *   if (error instanceof OlumiAPIError && error.statusCode === 426) {
 *     console.log('Resume not available - starting new stream');
 *   }
 * }
 * ```
 */
export async function resumeDraftGraph(
  config: SseStreamConfig,
  options: ResumeOptions
): Promise<ResumeResult> {
  const { baseUrl, apiKey, hmacSecret, timeout = 60000 } = config;
  const { token, signal } = options;
  const url = `${baseUrl}/assist/draft-graph/resume`;

  // Validate config
  if (!hmacSecret && (!apiKey || apiKey.trim().length === 0)) {
    throw new OlumiConfigError("Either API key or HMAC secret is required");
  }

  // Build headers
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "X-Resume-Token": token,
  };

  // Use HMAC authentication if secret is provided, otherwise use API key
  if (hmacSecret) {
    // No body for resume endpoint
    const hmacHeaders = sign("POST", "/assist/draft-graph/resume", undefined, {
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

  // Stream events and collect
  const reader = response.body?.getReader();
  if (!reader) {
    throw new OlumiNetworkError("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];
  let completed = false;

  try {
    // eslint-disable-next-line no-constant-condition
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
            events.push(event);

            // Check for completion
            if (event.type === "complete") {
              completed = true;
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Filter out heartbeat events for replay count
  const nonHeartbeatEvents = events.filter((e) => e.type !== "heartbeat");

  return {
    events,
    completed,
    replayedCount: nonHeartbeatEvents.length,
  };
}

/**
 * Resume an interrupted draft-graph stream in live mode (v1.9.0)
 *
 * Replays buffered events AND continues streaming new events until completion.
 *
 * **Live Resume Behavior:**
 * 1. Server replays all buffered events since the token sequence
 * 2. Server continues polling for new events and streaming them
 * 3. Connection stays open until stream completes, errors, or times out
 *
 * **Fallback:**
 * - If server doesn't support live mode (SSE_RESUME_LIVE_ENABLED=false), falls back to replay-only
 * - Check `result.completed` to know if reconnection to main stream is needed
 *
 * @param config - SSE stream configuration
 * @param options - Resume options (token, signal, timeout)
 * @returns Async iterable of SSE events (replayed + new)
 *
 * @example
 * ```typescript
 * const events = resumeDraftGraphLive(
 *   { baseUrl, apiKey },
 *   { token: savedToken, signal: controller.signal }
 * );
 *
 * for await (const event of events) {
 *   if (event.type === 'stage' && event.data.stage === 'COMPLETE') {
 *     console.log('Stream completed via live resume');
 *   }
 * }
 * ```
 */
export async function* resumeDraftGraphLive(
  config: SseStreamConfig,
  options: ResumeOptions
): AsyncIterable<SseEvent> {
  const { baseUrl, apiKey, hmacSecret, timeout = 120000 } = config;
  const { token, signal } = options;
  const url = `${baseUrl}/assist/draft-graph/resume?mode=live`;

  // Validate config
  if (!hmacSecret && (!apiKey || apiKey.trim().length === 0)) {
    throw new OlumiConfigError("Either API key or HMAC secret is required");
  }

  // Build headers
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "X-Resume-Token": token,
    "X-Resume-Mode": "live",
  };

  // Use HMAC authentication if secret is provided, otherwise use API key
  if (hmacSecret) {
    const hmacHeaders = sign("POST", "/assist/draft-graph/resume", undefined, {
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
  /**
   * Whether to prefer live resume mode when reconnecting (default: true)
   * Falls back to replay-only if live mode unavailable
   */
  preferLiveResume?: boolean;
  streamFactory?: (
    config: SseStreamConfig,
    request: DraftGraphRequest,
    options?: RequestOptions
  ) => AsyncIterable<SseEvent>;
}

/**
 * Stream draft-graph with automatic reconnection on disconnection (v1.9.0)
 *
 * Provides resilient streaming with automatic recovery:
 * 1. Starts initial stream and captures resume token
 * 2. On disconnection, attempts live resume with exponential backoff
 * 3. Falls back to replay-only resume if live mode unavailable
 * 4. Reconnects to main stream if needed
 *
 * **Exponential Backoff:**
 * - Attempt 1: 1.5s delay
 * - Attempt 2: 4s delay
 * - Attempt 3: 8s delay
 * - Max 3 retries (configurable)
 *
 * **Error Handling:**
 * - Retries on: network errors, 5xx errors, timeouts
 * - No retry on: 4xx errors (except 429), user abort
 * - Cleans up all listeners and connections in finally block
 *
 * @param config - Stream configuration with auto-reconnect options
 * @param request - Draft graph request
 * @param options - Request options (signal, timeout)
 * @returns Async iterable of SSE events with automatic recovery
 *
 * @example
 * ```typescript
 * const config: AutoReconnectConfig = {
 *   baseUrl: "https://olumi-assistants-service.onrender.com",
 *   apiKey: process.env.OLUMI_API_KEY!,
 *   maxRetries: 3,
 *   preferLiveResume: true,
 * };
 *
 * try {
 *   for await (const event of streamDraftGraphWithAutoReconnect(config, { brief: "test" })) {
 *     if (event.type === 'stage' && event.data.stage === 'COMPLETE') {
 *       console.log('Stream completed:', event.data.payload);
 *     }
 *   }
 * } catch (error) {
 *   console.error('Stream failed after all retries:', error);
 * }
 * ```
 */
export async function* streamDraftGraphWithAutoReconnect(
  config: AutoReconnectConfig,
  request: DraftGraphRequest,
  options?: RequestOptions
): AsyncIterable<SseEvent> {
  const { maxRetries = 3, preferLiveResume = true, ...streamConfig } = config;
  const streamFactory =
    config.streamFactory ??
    ((cfg: SseStreamConfig, req: DraftGraphRequest, opts?: RequestOptions) =>
      streamDraftGraph(cfg, req, opts));
  const backoffDelays = [1500, 4000, 8000]; // 1.5s, 4s, 8s
  let resumeToken: ResumeToken | null = null;
  let retryCount = 0;
  let currentStream: AsyncIterable<SseEvent> | null = null;
  let streamIterator: AsyncIterator<SseEvent> | null = null;

  try {
    // Start initial stream
    currentStream = streamFactory(streamConfig, request, options);
    streamIterator = currentStream[Symbol.asyncIterator]();

    while (true) {
      try {
        const { done, value } = await streamIterator.next();
        if (done) break;

        // Capture resume token
        const token = extractResumeTokenFromEvent(value);
        if (token) {
          resumeToken = token;
        }

        yield value;

        // Reset retry count on successful event
        retryCount = 0;
      } catch (error) {
        // Check if we should retry
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

        // Attempt resume if we have a token
        if (resumeToken) {
          try {
            // Try live resume first if preferred
            if (preferLiveResume) {
              currentStream = resumeDraftGraphLive(
                streamConfig,
                { token: resumeToken, signal: options?.signal }
              );
              streamIterator = currentStream[Symbol.asyncIterator]();
              continue;
            } else {
              // Replay-only resume
              const result = await resumeDraftGraph(
                streamConfig,
                { token: resumeToken, signal: options?.signal }
              );

              // Yield replayed events
              for (const event of result.events) {
                if (event.type !== "heartbeat") {
                  yield event;
                }
              }

              // If completed, we're done
              if (result.completed) {
                break;
              }

              // Otherwise reconnect to main stream
              currentStream = streamFactory(streamConfig, request, options);
              streamIterator = currentStream[Symbol.asyncIterator]();
              continue;
            }
          } catch (resumeError) {
            // Resume failed (426, 401, etc.) - fall back to new stream
            if (resumeError instanceof OlumiAPIError &&
                (resumeError.statusCode === 426 || resumeError.statusCode === 401)) {
              resumeToken = null; // Invalidate token
              currentStream = streamDraftGraph(streamConfig, request, options);
              streamIterator = currentStream[Symbol.asyncIterator]();
              continue;
            }

            // Other resume errors - propagate
            throw resumeError;
          }
        } else {
          // No resume token - start new stream
          currentStream = streamFactory(streamConfig, request, options);
          streamIterator = currentStream[Symbol.asyncIterator]();
        }
      }
    }
  } finally {
    // Clean up iterator if it exists
    if (streamIterator && typeof streamIterator.return === "function") {
      try {
        await streamIterator.return();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
