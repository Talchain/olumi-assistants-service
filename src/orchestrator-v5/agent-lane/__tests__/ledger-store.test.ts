/**
 * The representation-loss ledger, and where it can durably live.
 *
 * Measured facts behind this module's design, both in its header:
 *   · putting the ledger in the graph CHANGES the graph identity hash, which the
 *     CAS and replay contract are expressed in — disqualifying;
 *   · `scenarios.events` accepts it (no check constraint, no Zod schema, the one
 *     `event_type` switch has no default and no throw) — BUT
 *     `append_scenario_event` gates on `user_id = auth.uid()`, and since
 *     `NULL = NULL` is not TRUE in SQL a GUEST scenario can never append.
 *     Corroborated by population: 0 of the guest scenarios carry any events.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import {
  buildLedgerEvent, persistLedger, readLedgers, LEDGER_EVENT_TYPE,
  type LedgerEventDetails,
} from '../ledger-store.js';

const d = new URL('./fixtures/', import.meta.url);
const admitted = () => admitCandidateModel(
  JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel,
  JSON.parse(readFileSync(new URL('widened.json', d), 'utf8')),
);

const fakeLog = () => {
  const events: { event_type: string; details: unknown; event_id: string }[] = [];
  return {
    events,
    sink: { appendEvent: async (i: { event_id: string; event_type: string; details: unknown }) => {
      // Mirrors append_scenario_event's idempotency on event_id.
      if (events.some((e) => e.event_id === i.event_id)) return;
      events.push({ event_id: i.event_id, event_type: i.event_type, details: i.details });
    } },
    reader: { readEvents: async () => events.map((e) => ({ event_type: e.event_type, details: e.details })) },
  };
};

describe('ledger content', () => {
  it('carries the withheld items — the part the graph CANNOT hold', () => {
    const m = admitted();
    const led = buildLedgerEvent({ graph_identity_hash: 'a'.repeat(64), withheld: m.withheld, loss: m.loss });
    expect(led.withheld.length).toBeGreaterThan(0);
    expect(led.counts.withheld).toBe(m.withheld.length);
    // The decisive price->churn link is withheld from the graph, so the ledger is
    // the ONLY place its existence survives a reload.
    expect(led.withheld.some((w) => w.from.includes('price') && w.to.includes('churn'))).toBe(true);
  });

  it('carries every projected field with its severity', () => {
    const m = admitted();
    const led = buildLedgerEvent({ graph_identity_hash: null, withheld: m.withheld, loss: m.loss });
    expect(led.counts.projected).toBe(m.loss.length);
    expect(led.counts.projected_warn).toBe(m.loss.filter((l) => l.severity === 'warn').length);
    expect(led.projected.every((p) => typeof p.field_path === 'string' && p.reason.length > 0)).toBe(true);
  });
});

describe('durability round trip', () => {
  it('persists under its own event type and reads back identically', async () => {
    const m = admitted();
    const led = buildLedgerEvent({ graph_identity_hash: 'b'.repeat(64), withheld: m.withheld, loss: m.loss });
    const log = fakeLog();
    await persistLedger('scn', 'evt-1', led, log.sink);
    expect(log.events).toHaveLength(1);
    expect(log.events[0].event_type).toBe(LEDGER_EVENT_TYPE);
    const back = await readLedgers('scn', log.reader);
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(led);
  });

  it('is idempotent on event_id, as the RPC is', async () => {
    const led = buildLedgerEvent({ graph_identity_hash: null, withheld: [], loss: [] });
    const log = fakeLog();
    await persistLedger('scn', 'same-id', led, log.sink);
    await persistLedger('scn', 'same-id', led, log.sink);
    expect(log.events).toHaveLength(1);
  });

  it('ignores foreign event types, and a scenario with none reads empty', async () => {
    const log = fakeLog();
    log.events.push({ event_id: 'x', event_type: 'model_version_created', details: { not: 'ours' } });
    expect(await readLedgers('scn', log.reader)).toHaveLength(0);
    const led = buildLedgerEvent({ graph_identity_hash: null, withheld: [], loss: [] });
    await persistLedger('scn', 'y', led, log.sink);
    const back = await readLedgers('scn', log.reader);
    expect(back).toHaveLength(1);
    expect((back[0] as LedgerEventDetails).counts.withheld).toBe(0);
  });

  it('returns most recent first', async () => {
    const log = fakeLog();
    await persistLedger('scn', '1', buildLedgerEvent({ graph_identity_hash: 'one', withheld: [], loss: [] }), log.sink);
    await persistLedger('scn', '2', buildLedgerEvent({ graph_identity_hash: 'two', withheld: [], loss: [] }), log.sink);
    const back = await readLedgers('scn', log.reader);
    expect(back.map((b) => b.graph_identity_hash)).toEqual(['two', 'one']);
  });
});
