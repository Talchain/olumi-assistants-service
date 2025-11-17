/**
 * Buffer Optimization Utilities (v1.10.0)
 *
 * Provides event payload trimming and compression for SSE event buffers:
 * - Payload trimming: Keep only essential immutable fields
 * - Optional compression: gzip/deflate behind SSE_BUFFER_COMPRESS flag
 * - Priority-based trimming: Smart selection of events to trim
 *
 * Environment:
 * - SSE_BUFFER_COMPRESS: Enable compression (default: false)
 * - SSE_BUFFER_TRIM_PAYLOADS: Enable payload trimming (default: true)
 */

import { gzipSync, gunzipSync } from "node:zlib";
import { log } from "./telemetry.js";

const SSE_BUFFER_COMPRESS = process.env.SSE_BUFFER_COMPRESS === "true";
const SSE_BUFFER_TRIM_PAYLOADS = process.env.SSE_BUFFER_TRIM_PAYLOADS !== "false";

/**
 * Event priority levels for trimming decisions
 */
export enum EventPriority {
  CRITICAL = 0, // Never trim: COMPLETE, ERROR, initial resume tokens
  HIGH = 1, // Rarely trim: Stage transitions with graph updates
  MEDIUM = 2, // Trim if needed: Stage events without major changes
  LOW = 3, // Trim first: Heartbeats, trace events
}

/**
 * Determine event priority based on type and content
 */
export function getEventPriority(event: {
  type: string;
  data: string;
}): EventPriority {
  if (event.type === "heartbeat") {
    return EventPriority.LOW;
  }

  if (event.type === "trace") {
    return EventPriority.LOW;
  }

  // Parse data to check for critical events
  try {
    const data = JSON.parse(event.data);

    // COMPLETE and ERROR are critical
    if (data.stage === "COMPLETE" || data.stage === "ERROR") {
      return EventPriority.CRITICAL;
    }

    // Resume tokens are critical
    if (event.type === "resume") {
      return EventPriority.CRITICAL;
    }

    // Stage events with significant graph changes are high priority
    if (event.type === "stage" && data.payload?.graph) {
      return EventPriority.HIGH;
    }

    // Other stage events are medium priority
    if (event.type === "stage") {
      return EventPriority.MEDIUM;
    }
  } catch {
    // Unparseable events are medium priority by default
    return EventPriority.MEDIUM;
  }

  return EventPriority.MEDIUM;
}

/**
 * Trim event payload to keep only essential fields
 *
 * Reduces buffer size by removing:
 * - Verbose explanations
 * - Large arrays (keep only counts)
 * - Duplicate context
 * - Non-essential telemetry
 *
 * Preserves:
 * - stage, status, progress
 * - correlation_id, request_id
 * - Error messages
 * - Critical graph structure (nodes/edges counts)
 */
export function trimEventPayload(eventData: string): string {
  if (!SSE_BUFFER_TRIM_PAYLOADS) {
    return eventData;
  }

  try {
    const data = JSON.parse(eventData);

    // Don't trim critical events or any event that already includes a full graph payload.
    // This keeps resumable streams lossless for graph-carrying events while still
    // allowing trimming for lightweight progress/telemetry stages.
    if (
      data.stage === "COMPLETE" ||
      data.stage === "ERROR" ||
      (data.payload && data.payload.graph)
    ) {
      return eventData;
    }

    // Trim payload fields
    const trimmed: Record<string, unknown> = {
      stage: data.stage,
      correlation_id: data.correlation_id,
    };

    // Preserve essential payload fields
    if (data.payload) {
      const trimmedPayload: Record<string, unknown> = {};

      // Keep progress indicators
      if (typeof data.payload.progress === "number") {
        trimmedPayload.progress = data.payload.progress;
      }

      // Keep status
      if (data.payload.status) {
        trimmedPayload.status = data.payload.status;
      }

      // Trim graph to just counts
      if (data.payload.graph) {
        trimmedPayload.graph = {
          node_count: data.payload.graph.nodes?.length || 0,
          edge_count: data.payload.graph.edges?.length || 0,
        };
      }

      // Keep error details
      if (data.payload.error) {
        trimmedPayload.error = data.payload.error;
      }

      // Keep telemetry but trim verbose fields
      if (data.payload.telemetry) {
        trimmedPayload.telemetry = {
          duration_ms: data.payload.telemetry.duration_ms,
          tokens: data.payload.telemetry.tokens,
          buffer_trimmed: data.payload.telemetry.buffer_trimmed,
        };
      }

      trimmed.payload = trimmedPayload;
    }

    return JSON.stringify(trimmed);
  } catch (error) {
    // If trimming fails, return original
    log.warn({ error }, "Failed to trim event payload, using original");
    return eventData;
  }
}

/**
 * Compress event data using gzip
 */
export function compressEvent(eventStr: string): Buffer {
  if (!SSE_BUFFER_COMPRESS) {
    return Buffer.from(eventStr, "utf-8");
  }

  try {
    const compressed = gzipSync(eventStr, { level: 6 }); // Balanced compression
    return compressed;
  } catch (error) {
    log.warn({ error }, "Failed to compress event, using uncompressed");
    return Buffer.from(eventStr, "utf-8");
  }
}

/**
 * Decompress event data
 */
export function decompressEvent(eventBuffer: Buffer | string): string {
  // Handle string input (uncompressed)
  if (typeof eventBuffer === "string") {
    return eventBuffer;
  }

  if (!SSE_BUFFER_COMPRESS) {
    return eventBuffer.toString("utf-8");
  }

  try {
    const decompressed = gunzipSync(eventBuffer);
    return decompressed.toString("utf-8");
  } catch (error) {
    // If decompression fails, try as uncompressed
    log.warn({ error }, "Failed to decompress event, assuming uncompressed");
    return eventBuffer.toString("utf-8");
  }
}

/**
 * Calculate size savings from optimization
 */
export function calculateSavings(
  original: string,
  optimized: Buffer
): {
  original_size: number;
  optimized_size: number;
  savings_bytes: number;
  savings_percent: number;
} {
  const originalSize = Buffer.byteLength(original, "utf-8");
  const optimizedSize = optimized.length;
  const savingsBytes = originalSize - optimizedSize;
  const savingsPercent = originalSize > 0 ? (savingsBytes / originalSize) * 100 : 0;

  return {
    original_size: originalSize,
    optimized_size: optimizedSize,
    savings_bytes: savingsBytes,
    savings_percent: Math.round(savingsPercent * 10) / 10,
  };
}

/**
 * Sort events by priority for trimming decisions
 * Returns events ordered from lowest to highest priority (trim lowest first)
 */
export function sortEventsByPriority(
  events: Array<{ seq: number; type: string; data: string }>
): Array<{ seq: number; type: string; data: string; priority: EventPriority }> {
  return events
    .map((event) => ({
      ...event,
      priority: getEventPriority(event),
    }))
    .sort((a, b) => {
      // Sort by priority (higher priority value = trim first)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Within same priority, trim older events first
      return a.seq - b.seq;
    });
}
