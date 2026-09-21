/**
 * VersionEventSink seam — safety semantics.
 *
 * The durable v1 sink is the RPC journey event (persisted in-transaction);
 * the TS-side seam must therefore (a) tolerate repeated emits by key
 * (at-least-once), and (b) NEVER let a sink failure escape to the caller.
 */
import { describe, it, expect, vi } from 'vitest';

import { journeyRpcVersionEventSink, notifyVersionEventSink } from '../version-event-sink.js';
import type { ModelVersionEvent } from '../types.js';

const EVENT: ModelVersionEvent = {
  event_version: 'model_version_event.v1',
  event_id: 'model_version_created_33333333-3333-4333-8333-333333333333',
  event_type: 'model_version_created',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  version_id: '33333333-3333-4333-8333-333333333333',
  version_number: 4,
  graph_identity_hash: 'c'.repeat(64),
  restored_from_version_id: null,
  occurred_at_iso: '2026-07-05T10:00:00.000Z',
};

describe('journeyRpcVersionEventSink (v1: durable event already persisted by the RPC)', () => {
  it('emit resolves and is trivially idempotent (repeat emits change nothing)', async () => {
    await expect(journeyRpcVersionEventSink.emit(EVENT)).resolves.toBeUndefined();
    await expect(journeyRpcVersionEventSink.emit(EVENT)).resolves.toBeUndefined();
  });
});

describe('notifyVersionEventSink', () => {
  it('passes the event through to the sink', async () => {
    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    await notifyVersionEventSink(sink, EVENT);
    expect(sink.emit).toHaveBeenCalledExactlyOnceWith(EVENT);
  });

  it('a throwing sink never propagates (logged, re-drivable by event_id)', async () => {
    const sink = {
      emit: vi.fn().mockRejectedValue(new Error('downstream unavailable')),
    };
    await expect(notifyVersionEventSink(sink, EVENT)).resolves.toBeUndefined();
  });

  it('a synchronously-throwing sink is also contained', async () => {
    const sink = {
      emit: () => {
        throw new Error('sync boom');
      },
    };
    await expect(notifyVersionEventSink(sink, EVENT)).resolves.toBeUndefined();
  });

  it('at-least-once: the same event can be dispatched repeatedly', async () => {
    const seen: string[] = [];
    const sink = {
      emit: async (e: ModelVersionEvent) => {
        seen.push(e.event_id);
      },
    };
    await notifyVersionEventSink(sink, EVENT);
    await notifyVersionEventSink(sink, EVENT);
    expect(seen).toEqual([EVENT.event_id, EVENT.event_id]);
  });
});
