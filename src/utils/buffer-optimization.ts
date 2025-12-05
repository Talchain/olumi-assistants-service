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
import { config } from "../config/index.js";

/**
 * Get buffer optimization settings from centralized config (deferred for testability)
 */
function getBufferConfig() {
  return {
    compress: config.sse.bufferCompress,
    trimPayloads: config.sse.bufferTrimPayloads,
  };
}

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
 * Determine event priority from pre-parsed data (avoids redundant JSON.parse)
 */
export function getEventPriorityFromParsed(
  eventType: string,
  parsedData: Record<string, unknown> | null
): EventPriority {
  if (eventType === "heartbeat" || eventType === "trace") {
    return EventPriority.LOW;
  }

  if (!parsedData) {
    return EventPriority.MEDIUM;
  }

  // COMPLETE and ERROR are critical
  if (parsedData.stage === "COMPLETE" || parsedData.stage === "ERROR") {
    return EventPriority.CRITICAL;
  }

  // Resume tokens are critical
  if (eventType === "resume") {
    return EventPriority.CRITICAL;
  }

  // Stage events with significant graph changes are high priority
  const payload = parsedData.payload as Record<string, unknown> | undefined;
  if (eventType === "stage" && payload?.graph) {
    return EventPriority.HIGH;
  }

  // Other stage events are medium priority
  if (eventType === "stage") {
    return EventPriority.MEDIUM;
  }

  return EventPriority.MEDIUM;
}

/**
 * Determine event priority based on type and content
 */
export function getEventPriority(event: {
  type: string;
  data: string;
}): EventPriority {
  if (event.type === "heartbeat" || event.type === "trace") {
    return EventPriority.LOW;
  }

  // Parse data to check for critical events
  try {
    const data = JSON.parse(event.data);
    return getEventPriorityFromParsed(event.type, data);
  } catch {
    // Unparseable events are medium priority by default
    return EventPriority.MEDIUM;
  }
}

/**
 * Trim pre-parsed event payload (avoids redundant JSON.parse)
 * Returns null if the event should not be trimmed (critical/graph events)
 */
function trimParsedPayload(data: Record<string, unknown>): Record<string, unknown> | null {
  // Don't trim critical events or any event that already includes a full graph payload.
  // This keeps resumable streams lossless for graph-carrying events while still
  // allowing trimming for lightweight progress/telemetry stages.
  const payload = data.payload as Record<string, unknown> | undefined;
  if (
    data.stage === "COMPLETE" ||
    data.stage === "ERROR" ||
    (payload && payload.graph)
  ) {
    return null; // Signal: don't trim
  }

  // Trim payload fields
  const trimmed: Record<string, unknown> = {
    stage: data.stage,
    correlation_id: data.correlation_id,
  };

  // Preserve essential payload fields
  if (payload) {
    const trimmedPayload: Record<string, unknown> = {};

    // Keep progress indicators
    if (typeof payload.progress === "number") {
      trimmedPayload.progress = payload.progress;
    }

    // Keep status
    if (payload.status) {
      trimmedPayload.status = payload.status;
    }

    // Trim graph to just counts
    if (payload.graph) {
      const graph = payload.graph as Record<string, unknown>;
      trimmedPayload.graph = {
        node_count: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
        edge_count: Array.isArray(graph.edges) ? graph.edges.length : 0,
      };
    }

    // Keep error details
    if (payload.error) {
      trimmedPayload.error = payload.error;
    }

    // Keep telemetry but trim verbose fields
    if (payload.telemetry) {
      const telemetry = payload.telemetry as Record<string, unknown>;
      trimmedPayload.telemetry = {
        duration_ms: telemetry.duration_ms,
        tokens: telemetry.tokens,
        buffer_trimmed: telemetry.buffer_trimmed,
      };
    }

    trimmed.payload = trimmedPayload;
  }

  return trimmed;
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
  if (!getBufferConfig().trimPayloads) {
    return eventData;
  }

  try {
    const data = JSON.parse(eventData);
    const trimmed = trimParsedPayload(data);
    return trimmed ? JSON.stringify(trimmed) : eventData;
  } catch (error) {
    // If trimming fails, return original
    log.warn({ error }, "Failed to trim event payload, using original");
    return eventData;
  }
}

/**
 * Trim event payload from pre-parsed data (optimized path)
 * Use this when you already have the parsed JSON object
 */
export function trimEventPayloadFromParsed(
  eventData: string,
  parsedData: Record<string, unknown>
): string {
  if (!getBufferConfig().trimPayloads) {
    return eventData;
  }

  const trimmed = trimParsedPayload(parsedData);
  return trimmed ? JSON.stringify(trimmed) : eventData;
}

/**
 * Compress event data using gzip
 */
export function compressEvent(eventStr: string): Buffer {
  if (!getBufferConfig().compress) {
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

  if (!getBufferConfig().compress) {
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
 * Event with cached parsed data for efficient processing
 */
export interface ParsedEvent {
  seq: number;
  type: string;
  data: string;
  priority: EventPriority;
  /** Pre-parsed JSON data (null if parse failed) */
  _parsed: Record<string, unknown> | null;
}

/**
 * Sort events by priority for trimming decisions
 * Returns events ordered from lowest to highest priority (trim lowest first)
 * Caches parsed JSON to avoid redundant parsing in subsequent operations
 */
export function sortEventsByPriority(
  events: Array<{ seq: number; type: string; data: string }>
): ParsedEvent[] {
  return events
    .map((event) => {
      // Parse once, reuse for priority determination and later trimming
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        // Keep null for unparseable events
      }
      return {
        ...event,
        priority: getEventPriorityFromParsed(event.type, parsed),
        _parsed: parsed,
      };
    })
    .sort((a, b) => {
      // Sort by priority (higher priority value = trim first)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Within same priority, trim older events first
      return a.seq - b.seq;
    });
}
