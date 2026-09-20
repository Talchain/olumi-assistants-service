/**
 * The durable store's contract, offline against a hand-rolled fake client.
 *
 * The load-bearing property is not "it reads and writes". It is that the
 * store tells MALFORMED STORED DATA apart from AN UNREACHABLE DATABASE, and
 * treats them oppositely:
 *
 *   · a row we cannot make sense of  → EMPTY state, no throw. Losing a
 *     turn's memory costs a turn. The alternative is the
 *     `v5_handler_facts.payload` trap, where a strict parse on an
 *     unfiltered read took a whole scenario down on every later turn.
 *   · a transport failure            → THROW. Returning empty would make
 *     the turn save empty over a live conversation, so a momentary blip
 *     would permanently destroy the proposal the next "yes" resolves
 *     against.
 *
 * An implementation could satisfy either one alone by accident —
 * `try { … } catch { return EMPTY }` passes the malformed tests and
 * converts every outage into silent data loss. The CONTRAST CONTROL block
 * at the bottom is what makes that implementation fail: it pins the two
 * cases against each other with the confounder varied deliberately in both
 * directions (error-SHAPED data that must not throw; a transport error
 * carrying VALID-shaped data that must still throw).
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  REPLACEMENT_STATE_TABLE,
  ReplacementStateStoreError,
  SupabaseReplacementStateStore,
} from '../supabase-state-store.js';
import { EMPTY_REPLACEMENT_STATE, type ReplacementState } from '../turn-entry.js';

// ── fixtures ────────────────────────────────────────────────────────────
// Invented throughout. This repo is public and this column carries a user's
// own words, so nothing here is derived from a real capture.

const SCENARIO = 'sc-replacement-1';

function populatedState(): ReplacementState {
  return {
    version: 1,
    memory: {
      items: [
        {
          id: 'item-1',
          kind: 'user_preference',
          text: 'We will not raise the headline price this quarter.',
          source_turn_id: 'turn-1',
          recorded_at: '2026-09-20T12:00:00.000Z',
          status: 'live',
        },
      ],
    },
    proposals: {
      proposals: [
        {
          id: 'prop-1',
          status: 'open',
          operations: [{ kind: 'set_option_effect', summary: 'Hold price on Option B' }],
          model_revision: 'rev-1',
          proposed_at: '2026-09-20T12:00:00.000Z',
          proposed_in_turn: 'turn-1',
        },
      ],
    },
  };
}

// ── fake client ─────────────────────────────────────────────────────────
// Supports exactly the two chains the adapter builds:
//   .from(t).select(c).eq(col, val).maybeSingle()
//   .from(t).upsert(row, options)

interface ReadCall {
  readonly table: string;
  readonly columns: string;
  readonly eqColumn: string;
  readonly eqValue: unknown;
}
interface WriteCall {
  readonly table: string;
  readonly row: Record<string, unknown>;
  readonly options: unknown;
}

interface Fake {
  readonly client: SupabaseClient;
  readonly reads: ReadCall[];
  readonly writes: WriteCall[];
  /** Counts every decode-able value actually handed to the read path. */
  readonly readResults: Array<{ data: unknown; error: unknown }>;
}

function fakeClient(opts: {
  read?: () => { data: unknown; error: unknown };
  write?: () => { error: unknown };
}): Fake {
  const reads: ReadCall[] = [];
  const writes: WriteCall[] = [];
  const readResults: Array<{ data: unknown; error: unknown }> = [];

  const from = vi.fn((table: string) => ({
    select: (columns: string) => ({
      eq: (eqColumn: string, eqValue: unknown) => ({
        maybeSingle: async () => {
          reads.push({ table, columns, eqColumn, eqValue });
          const result = opts.read?.() ?? { data: null, error: null };
          readResults.push(result);
          return result;
        },
      }),
    }),
    upsert: async (row: Record<string, unknown>, options: unknown) => {
      writes.push({ table, row, options });
      return opts.write?.() ?? { error: null };
    },
  }));

  return { client: { from } as unknown as SupabaseClient, reads, writes, readResults };
}

/** One in-memory table, for the genuine save → load round trip. */
function statefulFake(): Fake & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: ReadCall[] = [];
  const writes: WriteCall[] = [];
  const readResults: Array<{ data: unknown; error: unknown }> = [];

  const from = vi.fn((table: string) => ({
    select: (columns: string) => ({
      eq: (eqColumn: string, eqValue: unknown) => ({
        maybeSingle: async () => {
          reads.push({ table, columns, eqColumn, eqValue });
          const row = rows.get(String(eqValue));
          const result = { data: row === undefined ? null : { state: row.state }, error: null };
          readResults.push(result);
          return result;
        },
      }),
    }),
    upsert: async (row: Record<string, unknown>, options: unknown) => {
      writes.push({ table, row, options });
      // Round-trip through JSON the way jsonb does, so the test cannot pass
      // by handing back the very object it was given.
      rows.set(String(row.scenario_id), JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
      return { error: null };
    },
  }));

  return { client: { from } as unknown as SupabaseClient, reads, writes, readResults, rows };
}

const transportError = { message: 'TCP connection reset by peer', code: 'PGRST001' };

// ── load ────────────────────────────────────────────────────────────────

describe('SupabaseReplacementStateStore.load', () => {
  it('reads the state column by primary key from the replacement-state table', async () => {
    const fake = fakeClient({ read: () => ({ data: null, error: null }) });
    await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(fake.reads).toEqual([
      {
        table: REPLACEMENT_STATE_TABLE,
        columns: 'state',
        eqColumn: 'scenario_id',
        eqValue: SCENARIO,
      },
    ]);
    expect(REPLACEMENT_STATE_TABLE).toBe('v5_replacement_state');
  });

  it('treats NO ROW as a normal first turn: empty state, no throw', async () => {
    // Every scenario has a first turn. This is the single most ordinary
    // outcome this store has, and it must not look like a failure.
    const fake = fakeClient({ read: () => ({ data: null, error: null }) });
    const state = await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(state).toEqual(EMPTY_REPLACEMENT_STATE);
    expect(state.memory.items).toEqual([]);
    expect(state.proposals.proposals).toEqual([]);
  });

  it('decodes a well-formed stored row, memory and proposals intact', async () => {
    const stored = JSON.parse(JSON.stringify(populatedState())) as unknown;
    const fake = fakeClient({ read: () => ({ data: { state: stored }, error: null }) });

    const state = await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(state.version).toBe(1);
    // Bound by IDENTITY, not by a count another item could satisfy.
    expect(state.memory.items.map((i) => i.id)).toEqual(['item-1']);
    expect(state.memory.items[0]?.text).toBe(
      'We will not raise the headline price this quarter.',
    );
    expect(state.proposals.proposals.map((p) => p.id)).toEqual(['prop-1']);
    expect(state.proposals.proposals[0]?.status).toBe('open');
  });

  it.each([
    ['a null state column', null],
    ['a scalar where an object belongs', 42],
    ['a string where an object belongs', 'not-a-state'],
    ['an array where an object belongs', []],
    ['an empty object', {}],
    ['an unknown future version', { version: 2, memory: { items: [] }, proposals: { proposals: [] } }],
    ['version 1 with memory missing', { version: 1, proposals: { proposals: [] } }],
    ['version 1 with proposals missing', { version: 1, memory: { items: [] } }],
    ['version 1 with items not an array', { version: 1, memory: { items: 'x' }, proposals: { proposals: [] } }],
  ])('reads malformed stored data (%s) as EMPTY and never throws', async (_label, stored) => {
    const fake = fakeClient({ read: () => ({ data: { state: stored }, error: null }) });
    const store = new SupabaseReplacementStateStore(fake.client);

    await expect(store.load(SCENARIO)).resolves.toEqual(EMPTY_REPLACEMENT_STATE);
  });

  it('throws a typed error on a transport failure, carrying the producer code', async () => {
    // We did not read the row; we failed to ask. Degrading to empty here
    // would make the turn save empty OVER a live conversation.
    const fake = fakeClient({ read: () => ({ data: null, error: transportError }) });
    const store = new SupabaseReplacementStateStore(fake.client);

    await expect(store.load(SCENARIO)).rejects.toBeInstanceOf(ReplacementStateStoreError);
    await store.load(SCENARIO).catch((err: unknown) => {
      expect(err).toBeInstanceOf(ReplacementStateStoreError);
      if (err instanceof ReplacementStateStoreError) {
        expect(err.code).toBe('PGRST001');
        expect(err.message).toContain(REPLACEMENT_STATE_TABLE);
        expect(err.message).toContain(SCENARIO);
        expect(err.cause).toBe(transportError);
      }
    });
  });

  it('still throws on a transport failure that supplies no error code', async () => {
    const fake = fakeClient({ read: () => ({ data: null, error: { message: 'socket hang up' } }) });
    const store = new SupabaseReplacementStateStore(fake.client);

    await store.load(SCENARIO).then(
      () => expect.unreachable('a transport failure must not resolve'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(ReplacementStateStoreError);
        if (err instanceof ReplacementStateStoreError) expect(err.code).toBeNull();
      },
    );
  });
});

// ── save ────────────────────────────────────────────────────────────────

describe('SupabaseReplacementStateStore.save', () => {
  it('upserts on scenario_id and sets updated_at explicitly', async () => {
    // updated_at is written by hand on purpose: the column's DEFAULT now()
    // fires on INSERT only, so an upsert that omitted it would freeze every
    // scenario's timestamp at row creation.
    const fake = fakeClient({});
    const before = Date.now();
    await new SupabaseReplacementStateStore(fake.client).save(SCENARIO, populatedState());
    const after = Date.now();

    expect(fake.writes).toHaveLength(1);
    const write = fake.writes[0]!;
    expect(write.table).toBe(REPLACEMENT_STATE_TABLE);
    expect(write.options).toEqual({ onConflict: 'scenario_id' });
    expect(write.row.scenario_id).toBe(SCENARIO);
    expect(write.row.state).toEqual(populatedState());

    const updatedAt = write.row.updated_at;
    expect(typeof updatedAt).toBe('string');
    const ms = Date.parse(String(updatedAt));
    expect(Number.isNaN(ms)).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(before - 1000);
    expect(ms).toBeLessThanOrEqual(after + 1000);
  });

  it('throws a typed error when the upsert fails', async () => {
    const fake = fakeClient({ write: () => ({ error: { message: 'deadlock detected', code: '40P01' } }) });
    const store = new SupabaseReplacementStateStore(fake.client);

    await store.save(SCENARIO, populatedState()).then(
      () => expect.unreachable('a failed upsert must not resolve'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(ReplacementStateStoreError);
        if (err instanceof ReplacementStateStoreError) expect(err.code).toBe('40P01');
      },
    );
  });

  it('round trips: what save wrote is what the next turn loads', async () => {
    // The whole point of the layer — the next turn's "yes, make that update
    // now" has to find the proposal this turn offered.
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    expect(await store.load(SCENARIO)).toEqual(EMPTY_REPLACEMENT_STATE);
    await store.save(SCENARIO, populatedState());
    const reloaded = await store.load(SCENARIO);

    expect(reloaded).toEqual(populatedState());
    expect(reloaded.proposals.proposals.map((p) => p.id)).toEqual(['prop-1']);
  });

  it('keys by scenario, so one scenario cannot read another one\'s proposals', async () => {
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    await store.save(SCENARIO, populatedState());

    expect(await store.load('sc-someone-else')).toEqual(EMPTY_REPLACEMENT_STATE);
    expect((await store.load(SCENARIO)).proposals.proposals).toHaveLength(1);
  });
});

// ── contrast control ────────────────────────────────────────────────────

describe('CONTRAST CONTROL: malformed data and an unreachable database are different paths', () => {
  it('the SAME unusable value resolves to empty as data, and throws as an error', async () => {
    // The discriminating pair. Everything is held constant except WHICH
    // field of the PostgREST envelope the value arrives in. A store that
    // collapsed the two — the tempting `try { … } catch { return EMPTY }` —
    // cannot make these two assertions disagree.
    const payload = { message: 'boom', code: 'PGRST500' };

    const asData = fakeClient({ read: () => ({ data: { state: payload }, error: null }) });
    await expect(new SupabaseReplacementStateStore(asData.client).load(SCENARIO)).resolves.toEqual(
      EMPTY_REPLACEMENT_STATE,
    );

    const asError = fakeClient({ read: () => ({ data: null, error: payload }) });
    await expect(
      new SupabaseReplacementStateStore(asError.client).load(SCENARIO),
    ).rejects.toBeInstanceOf(ReplacementStateStoreError);
  });

  it('error-SHAPED stored data is still data: it must not throw', async () => {
    // Confounder varied in one direction. An implementation that sniffed the
    // payload for an error shape, instead of reading the envelope's `error`
    // field, would pass the plain malformed tests and fail here.
    const fake = fakeClient({
      read: () => ({
        data: { state: { message: 'permission denied', code: '42501', details: null, hint: null } },
        error: null,
      }),
    });

    await expect(new SupabaseReplacementStateStore(fake.client).load(SCENARIO)).resolves.toEqual(
      EMPTY_REPLACEMENT_STATE,
    );
  });

  it('a transport error alongside a PERFECTLY VALID row must still throw', async () => {
    // Confounder varied in the other direction, and this is the one that
    // matters most. An implementation that decoded whatever it could find
    // and only threw when decoding failed would pass every test above — and
    // would silently serve a stale or partial read as if it were authoritative.
    // PostgREST can and does return both fields populated.
    const fake = fakeClient({
      read: () => ({
        data: { state: JSON.parse(JSON.stringify(populatedState())) as unknown },
        error: transportError,
      }),
    });

    await new SupabaseReplacementStateStore(fake.client).load(SCENARIO).then(
      () => expect.unreachable('a transport error must throw even when the row decodes'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(ReplacementStateStoreError);
        if (err instanceof ReplacementStateStoreError) expect(err.code).toBe('PGRST001');
      },
    );
  });

  it('the transport path never even looks at the row, and the malformed path always does', async () => {
    // Pins the precondition in-test rather than trusting the outcome: prove
    // the two cases reach different code, not merely that they return
    // different values. On the throwing path the decode is skipped entirely;
    // on the empty path a value was genuinely read and decoded.
    const malformed = fakeClient({ read: () => ({ data: { state: { version: 99 } }, error: null }) });
    await new SupabaseReplacementStateStore(malformed.client).load(SCENARIO);
    expect(malformed.readResults).toHaveLength(1);
    expect(malformed.readResults[0]?.error).toBeNull();
    expect(malformed.readResults[0]?.data).not.toBeNull();

    const unreachable = fakeClient({ read: () => ({ data: null, error: transportError }) });
    await new SupabaseReplacementStateStore(unreachable.client)
      .load(SCENARIO)
      .catch(() => undefined);
    expect(unreachable.readResults).toHaveLength(1);
    expect(unreachable.readResults[0]?.error).toBe(transportError);
    expect(unreachable.readResults[0]?.data).toBeNull();
  });

  it('a failed LOAD does not write anything: no empty state over a live row', async () => {
    // The consequence the distinction exists to prevent, asserted directly.
    const fake = fakeClient({ read: () => ({ data: null, error: transportError }) });
    await new SupabaseReplacementStateStore(fake.client).load(SCENARIO).catch(() => undefined);

    expect(fake.writes).toEqual([]);
  });
});
