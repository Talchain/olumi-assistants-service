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
 * Buffer an event
 */
export async function bufferEvent(requestId: string, event: SseEvent): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const stateKey = getStateKey(requestId);
    const bufferKey = getBufferKey(requestId);

    // Get current state
    const stateData = await redis.get(stateKey);
    if (!stateData) {
      log.warn({ request_id: requestId }, "Cannot buffer event: state not found");
      return;
    }

    const state: SseStreamState = JSON.parse(stateData);

    // Serialize event
    const eventStr = JSON.stringify(event);
    const eventSize = Buffer.byteLength(eventStr, "utf-8");

    // Check size limits
    if (state.buffer_size_bytes + eventSize > SSE_BUFFER_MAX_SIZE_BYTES) {
      // Trim oldest event
      const trimmed = await redis.lpop(bufferKey);
      if (trimmed) {
        const trimmedSize = Buffer.byteLength(trimmed, "utf-8");
        state.buffer_size_bytes -= trimmedSize;
        state.buffer_event_count -= 1;

        const trimmedEvent = JSON.parse(trimmed);
        log.warn(
          {
            request_id: requestId,
            trimmed_seq: trimmedEvent.seq,
            new_size_bytes: state.buffer_size_bytes,
          },
          "Trimmed oldest SSE event due to size limit"
        );

        // Emit telemetry for buffer trimming
        emit(TelemetryEvents.SseBufferTrimmed, {
          request_id: requestId,
          trimmed_seq: trimmedEvent.seq,
          trimmed_size_bytes: trimmedSize,
          reason: "size_limit",
          new_buffer_size_bytes: state.buffer_size_bytes,
          new_buffer_event_count: state.buffer_event_count,
        });
      }
    }

    // Check count limit
    if (state.buffer_event_count >= SSE_BUFFER_MAX_EVENTS) {
      // Trim oldest event
      const trimmed = await redis.lpop(bufferKey);
      if (trimmed) {
        const trimmedSize = Buffer.byteLength(trimmed, "utf-8");
        state.buffer_size_bytes -= trimmedSize;
        state.buffer_event_count -= 1;

        const trimmedEvent = JSON.parse(trimmed);
        log.warn(
          {
            request_id: requestId,
            trimmed_seq: trimmedEvent.seq,
            new_count: state.buffer_event_count,
          },
          "Trimmed oldest SSE event due to count limit"
        );

        // Emit telemetry for buffer trimming
        emit(TelemetryEvents.SseBufferTrimmed, {
          request_id: requestId,
          trimmed_seq: trimmedEvent.seq,
          trimmed_size_bytes: trimmedSize,
          reason: "count_limit",
          new_buffer_size_bytes: state.buffer_size_bytes,
          new_buffer_event_count: state.buffer_event_count,
        });
      }
    }

    // Add new event to buffer (RPUSH for FIFO order)
    await redis.rpush(bufferKey, eventStr);
    await redis.expire(bufferKey, SSE_STATE_TTL_SEC);

    // Update state
    state.buffer_size_bytes += eventSize;
    state.buffer_event_count += 1;
    state.last_seq = event.seq;

    if (event.type === "heartbeat") {
      state.last_heartbeat_at = event.timestamp;
    }

    await redis.set(stateKey, JSON.stringify(state), "EX", SSE_STATE_TTL_SEC);
  } catch (error) {
    log.error({ error, request_id: requestId, seq: event.seq }, "Failed to buffer SSE event");
  }
}

/**
 * Get buffered events from sequence
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

    // Filter events after fromSeq
    const events: SseEvent[] = eventStrs
      .map((str) => JSON.parse(str) as SseEvent)
      .filter((evt) => evt.seq > fromSeq);

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
 * Mark stream as complete and save snapshot
 */
export async function markStreamComplete(
  requestId: string,
  finalPayload: any
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    const stateKey = getStateKey(requestId);
    const snapshotKey = getSnapshotKey(requestId);

    // Update state to complete
    const stateData = await redis.get(stateKey);
    if (stateData) {
      const state: SseStreamState = JSON.parse(stateData);
      state.status = "complete";
      await redis.set(stateKey, JSON.stringify(state), "EX", SSE_SNAPSHOT_TTL_SEC);
    }

    // Save snapshot for late resume
    const snapshot: SseSnapshot = {
      request_id: requestId,
      status: "complete",
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
 * Clean up stream state (called after successful completion or expiry)
 */
export async function cleanupStreamState(requestId: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.del(
      getStateKey(requestId),
      getBufferKey(requestId)
      // Keep snapshot for SSE_SNAPSHOT_TTL_SEC
    );

    log.debug({ request_id: requestId }, "Cleaned up SSE stream state");
  } catch (error) {
    log.error({ error, request_id: requestId }, "Failed to cleanup SSE state");
  }
}
