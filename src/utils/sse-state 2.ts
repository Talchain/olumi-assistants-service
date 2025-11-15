/**
 * SSE State Management - Redis-backed stream state with event buffering
 *
 * Manages resumable SSE streams with:
 * - Stream state tracking (status, sequences, timestamps)
 * - Event buffering (Redis list with size/count limits)
 * - Snapshot persistence for late resume
 *
 * Environment:
 * - SSE_BUFFER_MAX_EVENTS: Max buffered events per stream (default: 256)
 * - SSE_BUFFER_MAX_SIZE_MB: Max buffer size in MB (default: 1.5)
 * - SSE_STATE_TTL_SEC: State TTL in seconds (default: 900 = 15 min)
 * - SSE_SNAPSHOT_TTL_SEC: Snapshot TTL after completion (default: 60)
 *
 * Redis keys:
 * - sse:state:{request_id} - Stream state JSON
 * - sse:buffer:{request_id} - Event buffer (Redis list)
 * - sse:snapshot:{request_id} - Final snapshot for late resume
 */

import { getRedis } from "../platform/redis.js";
import { log, emit, TelemetryEvents } from "./telemetry.js";
import {
  trimEventPayload,
  compressEvent,
  decompressEvent,
  calculateSavings,
  getEventPriority,
  sortEventsByPriority,
  EventPriority,
} from "./buffer-optimization.js";

const SSE_BUFFER_MAX_EVENTS = Number(process.env.SSE_BUFFER_MAX_EVENTS) || 256;
const SSE_BUFFER_MAX_SIZE_MB = Number(process.env.SSE_BUFFER_MAX_SIZE_MB) || 1.5;
const SSE_BUFFER_MAX_SIZE_BYTES = SSE_BUFFER_MAX_SIZE_MB * 1024 * 1024;
const SSE_STATE_TTL_SEC = Number(process.env.SSE_STATE_TTL_SEC) || 900; // 15 min
const SSE_SNAPSHOT_TTL_SEC = Number(process.env.SSE_SNAPSHOT_TTL_SEC) || 900; // 15 min (matches token TTL)

/**
 * Stream state stored in Redis
 */
export interface SseStreamState {
  request_id: string;
  started_at: number;
  last_seq: number;
  last_heartbeat_at: number;
  status: "drafting" | "complete" | "error";
  buffer_size_bytes: number;
  buffer_event_count: number;
  buffer_trimmed?: boolean;
}

/**
 * SSE event structure
 */
export interface SseEvent {
  seq: number;
  type: string; // "heartbeat" | "stage" | "complete" | "error"
  data: string; // JSON-encoded payload
  timestamp: number;
}

/**
 * Snapshot for late resume
 */
export interface SseSnapshot {
  request_id: string;
  status: "complete" | "error";
  final_payload: any; // Complete graph or error details
  created_at: number;
}

/**
 * Get Redis keys
 */
function getStateKey(requestId: string): string {
  return `sse:state:${requestId}`;
}

function getBufferKey(requestId: string): string {
  return `sse:buffer:${requestId}`;
}

function getSnapshotKey(requestId: string): string {
  return `sse:snapshot:${requestId}`;
}

function getMetaKey(requestId: string, priority: EventPriority): string {
  const suffix =
    priority === EventPriority.LOW
      ? "low"
      : priority === EventPriority.MEDIUM
        ? "medium"
        : "high";
  return `sse:meta:${requestId}:${suffix}`;
}

/**
 * Initialize stream state
 */
export async function initStreamState(requestId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) {
    log.warn({ request_id: requestId }, "Redis unavailable, SSE resume disabled");
    return;
  }

  const state: SseStreamState = {
    request_id: requestId,
    started_at: Date.now(),
    last_seq: 0,
    last_heartbeat_at: Date.now(),
    status: "drafting",
    buffer_size_bytes: 0,
    buffer_event_count: 0,
    buffer_trimmed: false,
  };

  try {
    await redis.set(
      getStateKey(requestId),
      JSON.stringify(state),
      "EX",
      SSE_STATE_TTL_SEC
    );

    log.debug({ request_id: requestId }, "Initialized SSE stream state");
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to initialize SSE state");
  }
}

/**
 * Buffer an event with payload trimming and compression (v1.10.0)
 */
export async function bufferEvent(requestId: string, event: SseEvent): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const stateKey = getStateKey(requestId);
    const bufferKey = getBufferKey(requestId);
    const lowMetaKey = getMetaKey(requestId, EventPriority.LOW);
    const mediumMetaKey = getMetaKey(requestId, EventPriority.MEDIUM);
    const highMetaKey = getMetaKey(requestId, EventPriority.HIGH);

    // Get current state
    const stateData = await redis.get(stateKey);
    if (!stateData) {
      log.warn({ request_id: requestId }, "Cannot buffer event: state not found");
      return;
    }

    const state: SseStreamState = JSON.parse(stateData);

    // Serialize event
    let eventStr = JSON.stringify(event);

    // Apply payload trimming to reduce size
    const trimmedData = trimEventPayload(event.data);
    const trimmedEvent = { ...event, data: trimmedData };
    const trimmedEventStr = JSON.stringify(trimmedEvent);

    // Calculate savings from trimming
    const originalSize = Buffer.byteLength(eventStr, "utf-8");
    const trimmedSize = Buffer.byteLength(trimmedEventStr, "utf-8");

    if (trimmedSize < originalSize) {
      eventStr = trimmedEventStr;
      log.debug(
        {
          request_id: requestId,
          seq: event.seq,
          original_size: originalSize,
          trimmed_size: trimmedSize,
          savings_bytes: originalSize - trimmedSize,
        },
        "Applied payload trimming"
      );
    }

    // Apply optional compression
    const eventBuffer = compressEvent(eventStr);
    const eventSize = eventBuffer.length;

    const priority = getEventPriority({ type: event.type, data: event.data });

    if (eventSize < Buffer.byteLength(eventStr, "utf-8")) {
      log.debug(
        {
          request_id: requestId,
          seq: event.seq,
          ...calculateSavings(eventStr, eventBuffer),
        },
        "Applied event compression"
      );
    }

    // Priority-based trimming when limits are reached using sidecar metadata
    let skipBuffer = false;
    if (state.buffer_size_bytes + eventSize > SSE_BUFFER_MAX_SIZE_BYTES ||
        state.buffer_event_count >= SSE_BUFFER_MAX_EVENTS) {
      let trimmedMeta: { seq: number; base64: string } | null = null;
      let trimmedPriority: EventPriority | null = null;

      const lowMetaStr = await redis.lpop(lowMetaKey);
      if (lowMetaStr) {
        trimmedMeta = JSON.parse(lowMetaStr) as { seq: number; base64: string };
        trimmedPriority = EventPriority.LOW;
      } else {
        const mediumMetaStr = await redis.lpop(mediumMetaKey);
        if (mediumMetaStr) {
          trimmedMeta = JSON.parse(mediumMetaStr) as { seq: number; base64: string };
          trimmedPriority = EventPriority.MEDIUM;
        } else {
          const highMetaStr = await redis.lpop(highMetaKey);
          if (highMetaStr) {
            trimmedMeta = JSON.parse(highMetaStr) as { seq: number; base64: string };
            trimmedPriority = EventPriority.HIGH;
          }
        }
      }

      if (trimmedMeta && trimmedPriority !== null) {
        const trimmedBase64 = trimmedMeta.base64;
        await redis.lrem(bufferKey, 1, trimmedBase64);

        const trimmedSize = Buffer.from(trimmedBase64, "base64").length;
        state.buffer_size_bytes -= trimmedSize;
        state.buffer_event_count -= 1;

        log.warn(
          {
            request_id: requestId,
            trimmed_seq: trimmedMeta.seq,
            priority: trimmedPriority,
            reason: state.buffer_size_bytes + eventSize > SSE_BUFFER_MAX_SIZE_BYTES ? "size_limit" : "count_limit",
          },
          "Trimmed low-priority SSE event"
        );

        emit(TelemetryEvents.SseBufferTrimmed, {
          request_id: requestId,
          trimmed_seq: trimmedMeta.seq,
          trimmed_size_bytes: trimmedSize,
          priority: trimmedPriority,
          reason: state.buffer_size_bytes + eventSize > SSE_BUFFER_MAX_SIZE_BYTES ? "size_limit" : "count_limit",
          new_buffer_size_bytes: state.buffer_size_bytes,
          new_buffer_event_count: state.buffer_event_count,
        });

        state.buffer_trimmed = true;
      } else {
        // All buffered events are CRITICAL. To enforce hard caps we
        // deterministically drop the incoming event instead of
        // appending beyond limits.
        skipBuffer = true;

        const incomingPriority = priority;

        log.warn(
          {
            request_id: requestId,
            incoming_seq: event.seq,
            incoming_type: event.type,
            incoming_priority: incomingPriority,
            buffer_event_count: state.buffer_event_count,
            buffer_size_bytes: state.buffer_size_bytes,
          },
          "Buffer full with only CRITICAL events – dropping incoming SSE event to enforce caps"
        );

        emit(TelemetryEvents.SseBufferTrimmed, {
          request_id: requestId,
          trimmed_seq: event.seq,
          trimmed_size_bytes: eventSize,
          priority: incomingPriority,
          reason: state.buffer_size_bytes + eventSize > SSE_BUFFER_MAX_SIZE_BYTES ? "critical_size_limit" : "critical_count_limit",
          new_buffer_size_bytes: state.buffer_size_bytes,
          new_buffer_event_count: state.buffer_event_count,
          dropped_incoming: true,
        });

        state.buffer_trimmed = true;

        await redis.set(stateKey, JSON.stringify(state), "EX", SSE_STATE_TTL_SEC);
      }
    }

    if (!skipBuffer) {
      // Store compressed/optimized event (base64 encode for Redis string storage)
      const eventBase64 = eventBuffer.toString("base64");
      await redis.rpush(bufferKey, eventBase64);
      await redis.expire(bufferKey, SSE_STATE_TTL_SEC);

      if (priority !== EventPriority.CRITICAL) {
        const metaKey = getMetaKey(requestId, priority);
        const meta = JSON.stringify({ seq: event.seq, base64: eventBase64 });
        await redis.rpush(metaKey, meta);
        await redis.expire(metaKey, SSE_STATE_TTL_SEC);
      }

      // Update state only when we actually buffer the event
      state.buffer_size_bytes += eventSize;
      state.buffer_event_count += 1;
      state.last_seq = event.seq;

      if (event.type === "heartbeat") {
        state.last_heartbeat_at = event.timestamp;
      }

      await redis.set(stateKey, JSON.stringify(state), "EX", SSE_STATE_TTL_SEC);
    }
  } catch (error) {
    log.error({ error, request_id: requestId, seq: event.seq }, "Failed to buffer SSE event");
  }
}

/**
 * Get buffered events from sequence (v1.10.0 with decompression)
 */
export async function getBufferedEvents(
  requestId: string,
  fromSeq: number
): Promise<SseEvent[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const bufferKey = getBufferKey(requestId);

    // Get all buffered events
    const eventStrs = await redis.lrange(bufferKey, 0, -1);

    // Decompress and parse events
    const events: SseEvent[] = eventStrs
      .map((str) => {
        try {
          // Decode base64 and decompress
          const buffer = Buffer.from(str, "base64");
          const decompressed = decompressEvent(buffer);
          return JSON.parse(decompressed) as SseEvent;
        } catch (error) {
          // Fallback for legacy uncompressed events
          try {
            return JSON.parse(str) as SseEvent;
          } catch {
            log.warn({ request_id: requestId, error }, "Failed to parse buffered event");
            return null;
          }
        }
      })
      .filter((evt): evt is SseEvent => evt !== null && evt.seq > fromSeq);

    log.debug(
      {
        request_id: requestId,
        from_seq: fromSeq,
        total_buffered: eventStrs.length,
        replay_count: events.length,
      },
      "Retrieved buffered SSE events"
    );

    return events;
  } catch (error) {
    log.error({ error, request_id: requestId, from_seq: fromSeq }, "Failed to get buffered events");
    return [];
  }
}

/**
 * Get stream state
 */
export async function getStreamState(requestId: string): Promise<SseStreamState | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const stateData = await redis.get(getStateKey(requestId));
    if (!stateData) return null;

    return JSON.parse(stateData) as SseStreamState;
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to get SSE state");
    return null;
  }
}

/**
 * Mark stream as complete or error and save snapshot
 */
export async function markStreamComplete(
  requestId: string,
  finalPayload: any,
  status: "complete" | "error" = "complete"
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const stateKey = getStateKey(requestId);
    const snapshotKey = getSnapshotKey(requestId);

    // Update state to reflect terminal status
    const stateData = await redis.get(stateKey);
    if (stateData) {
      const state: SseStreamState = JSON.parse(stateData);
      state.status = status;
      await redis.set(stateKey, JSON.stringify(state), "EX", SSE_SNAPSHOT_TTL_SEC);
    }

    // Save snapshot for late resume
    const snapshot: SseSnapshot = {
      request_id: requestId,
      status,
      final_payload: finalPayload,
      created_at: Date.now(),
    };

    await redis.set(
      snapshotKey,
      JSON.stringify(snapshot),
      "EX",
      SSE_SNAPSHOT_TTL_SEC
    );

    log.debug({ request_id: requestId }, "Marked SSE stream complete with snapshot");
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to mark stream complete");
  }
}

/**
 * Get snapshot for late resume
 */
export async function getSnapshot(requestId: string): Promise<SseSnapshot | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const snapshotData = await redis.get(getSnapshotKey(requestId));
    if (!snapshotData) return null;

    return JSON.parse(snapshotData) as SseSnapshot;
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to get SSE snapshot");
    return null;
  }
}

/**
 * Renew snapshot TTL during live streaming (v1.9)
 */
export async function renewSnapshot(requestId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const snapshotKey = getSnapshotKey(requestId);
    const exists = await redis.exists(snapshotKey);

    if (exists) {
      await redis.expire(snapshotKey, SSE_SNAPSHOT_TTL_SEC);
      log.debug({ request_id: requestId }, "Renewed snapshot TTL during live streaming");

      emit(TelemetryEvents.SseSnapshotRenewed, {
        request_id: requestId,
        ttl_sec: SSE_SNAPSHOT_TTL_SEC,
      });
    }
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to renew snapshot TTL");
  }
}

/**
 * Clean up stream state (called after successful completion or expiry)
 */
export async function cleanupStreamState(requestId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.del(
      getStateKey(requestId),
      getBufferKey(requestId),
      getMetaKey(requestId, EventPriority.LOW),
      getMetaKey(requestId, EventPriority.MEDIUM),
      getMetaKey(requestId, EventPriority.HIGH)
      // Keep snapshot for SSE_SNAPSHOT_TTL_SEC
    );

    log.debug({ request_id: requestId }, "Cleaned up SSE stream state");
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to cleanup SSE state");
  }
}
