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
}

/**
 * Parse SSE event from raw text
 *
 * @internal
 */
function parseSseEvent(eventText: string): SseEvent | null {
  const lines = eventText.trim().split("\n");
  let eventType: string | null = null;
  let dataLines: string[] = [];

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
      throw new OlumiNetworkError("Request aborted by user");
    }

    // Handle timeout
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OlumiNetworkError(`Request timeout after ${timeout}ms`, error, true);
    }

    // Handle network errors
    throw new OlumiNetworkError(
      "Network request failed - check your connection",
      error as Error
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
      throw new OlumiNetworkError("Request aborted by user");
    }

    // Handle timeout
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OlumiNetworkError(`Request timeout after ${timeout}ms`, error, true);
    }

    // Handle network errors
    throw new OlumiNetworkError(
      "Network request failed - check your connection",
      error as Error
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
