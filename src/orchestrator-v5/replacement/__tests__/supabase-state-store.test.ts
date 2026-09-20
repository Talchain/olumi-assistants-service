/**
 * The durable store's contract, offline against a hand-rolled fake client.
 *
 * TWO load-bearing properties, and neither is "it reads and writes".
 *
 * 1. The store tells MALFORMED STORED DATA apart from AN UNREACHABLE
 *    DATABASE, and treats them oppositely:
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
 *   An implementation could satisfy either one alone by accident —
 *   `try { … } catch { return EMPTY }` passes the malformed tests and
 *   converts every outage into silent data loss. The first CONTRAST CONTROL
 *   block is what makes that implementation fail: it pins the two cases
 *   against each other with the confounder varied deliberately in both
 *   directions (error-SHAPED data that must not throw; a transport error
 *   carrying VALID-shaped data that must still throw).
 *
 * 2. A write built from a STALE READ IS REFUSED. The store was
 *    last-writer-wins, on an assertion — "the turn fence serialises turns
 *    per scenario" — that is refuted at the bytes: the fence records a
 *    generation, never aborts, and covers only writes carrying a graph. So
 *    two turns could both read and the older could overwrite the newer,
 *    destroying a remembered fact or a completed receipt while both writes
 *    reported success.
 *
 *    A rejection test ALONE is worthless here: a store that threw on every
 *    save would pass it and be useless. The second CONTRAST CONTROL block
 *    is the discriminating pair — the SAME store, the SAME scenario, the
 *    SAME row, with ONLY the token varied: stale must be refused, current
 *    must be accepted.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  REPLACEMENT_STATE_REVISION_COLUMN,
  REPLACEMENT_STATE_TABLE,
  ReplacementStateStoreError,
  SupabaseReplacementStateStore,
} from '../supabase-state-store.js';
import {
  EMPTY_REPLACEMENT_STATE,
  ReplacementStateConflictError,
  type ReplacementState,
} from '../turn-entry.js';

// ── fixtures ────────────────────────────────────────────────────────────
// Invented throughout. This repo is public and this column carries a user's
// own words, so nothing here is derived from a real capture.

const SCENARIO = 'sc-replacement-1';
const SELECTED_COLUMNS = `state, ${REPLACEMENT_STATE_REVISION_COLUMN}`;

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

/** A second, DIFFERENT state, so "whose write survived?" is answerable by
 *  identity rather than by a count both arms could satisfy. */
function rivalState(): ReplacementState {
  return {
    version: 1,
    memory: {
      items: [
        {
          id: 'item-rival',
          kind: 'user_fact',
          text: 'The pilot cohort is forty accounts.',
          source_turn_id: 'turn-rival',
          recorded_at: '2026-09-20T12:00:05.000Z',
          status: 'live',
        },
      ],
    },
    proposals: {
      proposals: [
        {
          id: 'prop-rival',
          status: 'open',
          operations: [{ kind: 'set_option_effect', summary: 'Widen the pilot' }],
          model_revision: 'rev-1',
          proposed_at: '2026-09-20T12:00:05.000Z',
          proposed_in_turn: 'turn-rival',
        },
      ],
    },
  };
}

// ── fake client ─────────────────────────────────────────────────────────
// Supports exactly the three chains the adapter builds:
//   .from(t).select(c).eq(col, val).maybeSingle()
//   .from(t).insert(row).select(c)
//   .from(t).update(row).eq(col, val).eq(col, val).select(c)

interface ReadCall {
  readonly table: string;
  readonly columns: string;
  readonly eqColumn: string;
  readonly eqValue: unknown;
}
interface WriteCall {
  readonly table: string;
  readonly verb: 'insert' | 'update';
  readonly row: Record<string, unknown>;
  readonly filters: ReadonlyArray<readonly [string, unknown]>;
  readonly selected: string | null;
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
  write?: (call: WriteCall) => { data: unknown; error: unknown };
}): Fake {
  const reads: ReadCall[] = [];
  const writes: WriteCall[] = [];
  const readResults: Array<{ data: unknown; error: unknown }> = [];

  const settle = (
    table: string,
    verb: 'insert' | 'update',
    row: Record<string, unknown>,
    filters: ReadonlyArray<readonly [string, unknown]>,
    selected: string | null,
  ): { data: unknown; error: unknown } => {
    const call: WriteCall = { table, verb, row, filters, selected };
    writes.push(call);
    // Default: the write landed, one row affected.
    return opts.write?.(call) ?? { data: [{ [REPLACEMENT_STATE_REVISION_COLUMN]: row[REPLACEMENT_STATE_REVISION_COLUMN] }], error: null };
  };

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
    insert: (row: Record<string, unknown>) => ({
      select: async (selected: string) => settle(table, 'insert', row, [], selected),
    }),
    update: (row: Record<string, unknown>) => {
      const filters: Array<readonly [string, unknown]> = [];
      const chain = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val] as const);
          return chain;
        },
        select: async (selected: string) => settle(table, 'update', row, filters, selected),
      };
      return chain;
    },
  }));

  return { client: { from } as unknown as SupabaseClient, reads, writes, readResults };
}

/**
 * One in-memory table that ACTUALLY ENFORCES the primary key and the
 * revision filter, so a real race can be played out against the real store.
 *
 * It is deliberately not a stub that returns whatever the test wants: the
 * property under test is the store's behaviour when the DATABASE refuses,
 * and a fake that cannot refuse could not observe it.
 */
function statefulFake(): Fake & { rows: Map<string, Record<string, unknown>> } {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: ReadCall[] = [];
  const writes: WriteCall[] = [];
  const readResults: Array<{ data: unknown; error: unknown }> = [];

  // jsonb round trip, so a test cannot pass by handing back the very object
  // it was given.
  const store = (row: Record<string, unknown>): void => {
    rows.set(String(row.scenario_id), JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
  };

  const from = vi.fn((table: string) => ({
    select: (columns: string) => ({
      eq: (eqColumn: string, eqValue: unknown) => ({
        maybeSingle: async () => {
          reads.push({ table, columns, eqColumn, eqValue });
          const row = rows.get(String(eqValue));
          const result = {
            data:
              row === undefined
                ? null
                : {
                    state: row.state,
                    [REPLACEMENT_STATE_REVISION_COLUMN]: row[REPLACEMENT_STATE_REVISION_COLUMN],
                  },
            error: null,
          };
          readResults.push(result);
          return result;
        },
      }),
    }),
    insert: (row: Record<string, unknown>) => ({
      select: async (selected: string) => {
        writes.push({ table, verb: 'insert', row, filters: [], selected });
        // The PRIMARY KEY, honoured. Two first turns racing must not both win.
        if (rows.has(String(row.scenario_id))) {
          return {
            data: null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' },
          };
        }
        store(row);
        return {
          data: [{ [REPLACEMENT_STATE_REVISION_COLUMN]: row[REPLACEMENT_STATE_REVISION_COLUMN] }],
          error: null,
        };
      },
    }),
    update: (row: Record<string, unknown>) => {
      const filters: Array<readonly [string, unknown]> = [];
      const chain = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val] as const);
          return chain;
        },
        select: async (selected: string) => {
          writes.push({ table, verb: 'update', row, filters, selected });
          const byId = filters.find(([c]) => c === 'scenario_id');
          const byRev = filters.find(([c]) => c === REPLACEMENT_STATE_REVISION_COLUMN);
          const existing = byId === undefined ? undefined : rows.get(String(byId[1]));
          // WHERE scenario_id = $1 AND revision = $2 — zero rows if either misses.
          if (
            existing === undefined ||
            byRev === undefined ||
            existing[REPLACEMENT_STATE_REVISION_COLUMN] !== byRev[1]
          ) {
            return { data: [], error: null };
          }
          store({ ...existing, ...row, scenario_id: byId![1] });
          return {
            data: [{ [REPLACEMENT_STATE_REVISION_COLUMN]: row[REPLACEMENT_STATE_REVISION_COLUMN] }],
            error: null,
          };
        },
      };
      return chain;
    },
  }));

  return { client: { from } as unknown as SupabaseClient, reads, writes, readResults, rows };
}

const transportError = { message: 'TCP connection reset by peer', code: 'PGRST001' };

// ── load ────────────────────────────────────────────────────────────────

describe('SupabaseReplacementStateStore.load', () => {
  it('reads the state AND the revision column by primary key, in one response', async () => {
    // One response, so the token describes the row this read actually saw.
    // A token fetched separately would describe some other moment.
    const fake = fakeClient({ read: () => ({ data: null, error: null }) });
    await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(fake.reads).toEqual([
      {
        table: REPLACEMENT_STATE_TABLE,
        columns: SELECTED_COLUMNS,
        eqColumn: 'scenario_id',
        eqValue: SCENARIO,
      },
    ]);
    expect(REPLACEMENT_STATE_TABLE).toBe('v5_replacement_state');
    expect(REPLACEMENT_STATE_REVISION_COLUMN).toBe('revision');
  });

  it('treats NO ROW as a normal first turn: empty state, null revision, no throw', async () => {
    // Every scenario has a first turn. This is the single most ordinary
    // outcome this store has, and it must not look like a failure. The null
    // revision is what makes the next save an INSERT.
    const fake = fakeClient({ read: () => ({ data: null, error: null }) });
    const loaded = await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(loaded.state).toEqual(EMPTY_REPLACEMENT_STATE);
    expect(loaded.revision).toBeNull();
    expect(loaded.state.memory.items).toEqual([]);
    expect(loaded.state.proposals.proposals).toEqual([]);
  });

  it('decodes a well-formed stored row, memory and proposals intact, and carries its revision', async () => {
    const stored = JSON.parse(JSON.stringify(populatedState())) as unknown;
    const fake = fakeClient({
      read: () => ({ data: { state: stored, revision: 'rev-token-a' }, error: null }),
    });

    const { state, revision } = await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(state.version).toBe(1);
    // Bound by IDENTITY, not by a count another item could satisfy.
    expect(state.memory.items.map((i) => i.id)).toEqual(['item-1']);
    expect(state.memory.items[0]?.text).toBe(
      'We will not raise the headline price this quarter.',
    );
    expect(state.proposals.proposals.map((p) => p.id)).toEqual(['prop-1']);
    expect(state.proposals.proposals[0]?.status).toBe('open');
    expect(revision).toBe('rev-token-a');
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

    await expect(store.load(SCENARIO)).resolves.toEqual({
      state: EMPTY_REPLACEMENT_STATE,
      revision: null,
    });
  });

  it('an UNRECOGNISED row still yields its revision — a bad row must stay writable', async () => {
    // The failure this prevents: returning null for a row that EXISTS sends
    // the recovery write down the INSERT arm, where the primary key refuses
    // it forever. One bad row would become a permanently unwritable
    // scenario. Bound to the token by identity, not to "non-null".
    const fake = fakeClient({
      read: () => ({ data: { state: { version: 99 }, revision: 'rev-token-b' }, error: null }),
    });

    const loaded = await new SupabaseReplacementStateStore(fake.client).load(SCENARIO);

    expect(loaded.state).toEqual(EMPTY_REPLACEMENT_STATE);
    expect(loaded.revision).toBe('rev-token-b');
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
  it('creates the row with an INSERT when there was none, and asks for the affected rows back', async () => {
    // Never an upsert. ON CONFLICT DO UPDATE against this table is exactly
    // the last-writer-wins behaviour the token exists to remove, and the
    // primary key is what makes two racing first turns resolve to one.
    const fake = fakeClient({});
    const before = Date.now();
    const revision = await new SupabaseReplacementStateStore(fake.client).save(
      SCENARIO,
      populatedState(),
      null,
    );
    const after = Date.now();

    expect(fake.writes).toHaveLength(1);
    const write = fake.writes[0]!;
    expect(write.table).toBe(REPLACEMENT_STATE_TABLE);
    expect(write.verb).toBe('insert');
    expect(write.row.scenario_id).toBe(SCENARIO);
    expect(write.row.state).toEqual(populatedState());
    // `.select()` is the whole mechanism for seeing zero-rows-affected.
    expect(write.selected).toBe(REPLACEMENT_STATE_REVISION_COLUMN);
    // The token written is the token returned — bound by identity.
    expect(write.row[REPLACEMENT_STATE_REVISION_COLUMN]).toBe(revision);
    expect(typeof revision).toBe('string');
    expect(revision.length).toBeGreaterThan(0);

    // updated_at is written by hand on purpose: the column's DEFAULT now()
    // fires on INSERT only, so an UPDATE that omitted it would freeze every
    // scenario's timestamp at row creation.
    const ms = Date.parse(String(write.row.updated_at));
    expect(Number.isNaN(ms)).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(before - 1000);
    expect(ms).toBeLessThanOrEqual(after + 1000);
  });

  it('updates under the expected token, filtering on BOTH the key and the revision', async () => {
    const fake = fakeClient({});
    const next = await new SupabaseReplacementStateStore(fake.client).save(
      SCENARIO,
      populatedState(),
      'rev-token-a',
    );

    const write = fake.writes[0]!;
    expect(write.verb).toBe('update');
    expect(write.filters).toEqual([
      ['scenario_id', SCENARIO],
      [REPLACEMENT_STATE_REVISION_COLUMN, 'rev-token-a'],
    ]);
    // The scenario id is a FILTER on the update arm, never part of the SET
    // list — a write that re-keyed the row would silently orphan it.
    expect(write.row.scenario_id).toBeUndefined();
    expect(write.row.updated_at).toBeDefined();
    // Every write mints a FRESH token. Reusing the expected one would make
    // the guard vacuous: a stale writer's filter would keep matching.
    expect(write.row[REPLACEMENT_STATE_REVISION_COLUMN]).toBe(next);
    expect(next).not.toBe('rev-token-a');
  });

  it('mints a different token on every write, so two saves cannot share one', async () => {
    // The property `updated_at` cannot provide: two saves inside one
    // millisecond — the ordinary checkpoint-then-final pair — must not
    // produce the same token.
    const fake = fakeClient({});
    const store = new SupabaseReplacementStateStore(fake.client);
    const a = await store.save(SCENARIO, populatedState(), 'rev-token-a');
    const b = await store.save(SCENARIO, populatedState(), a);
    expect(a).not.toBe(b);
  });

  it('reports ZERO ROWS AFFECTED as a conflict rather than resolving', async () => {
    // No error, an empty result set: the filter matched nothing, so the row
    // moved and the write did not happen. Resolving here is the silent
    // success this whole change exists to remove.
    const fake = fakeClient({ write: () => ({ data: [], error: null }) });

    await new SupabaseReplacementStateStore(fake.client)
      .save(SCENARIO, populatedState(), 'rev-token-a')
      .then(
        () => expect.unreachable('a write that affected no rows must not resolve'),
        (err: unknown) => {
          expect(err).toBeInstanceOf(ReplacementStateConflictError);
          if (err instanceof ReplacementStateConflictError) {
            expect(err.scenarioId).toBe(SCENARIO);
            expect(err.expectedRevision).toBe('rev-token-a');
          }
        },
      );
  });

  it('reports a primary-key violation on the INSERT arm as a conflict, not a store fault', async () => {
    // A row appeared between our read and our write. The database worked
    // perfectly and refused a stale write — a different fact from "the
    // database was unreachable", and it leads to different words.
    const fake = fakeClient({
      write: () => ({ data: null, error: { message: 'duplicate key', code: '23505' } }),
    });

    await new SupabaseReplacementStateStore(fake.client).save(SCENARIO, populatedState(), null).then(
      () => expect.unreachable('a duplicate key must not resolve'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(ReplacementStateConflictError);
        expect(err).not.toBeInstanceOf(ReplacementStateStoreError);
        if (err instanceof ReplacementStateConflictError) expect(err.expectedRevision).toBeNull();
      },
    );
  });

  it('throws the STORE error, not a conflict, when the write genuinely fails', async () => {
    const fake = fakeClient({
      write: () => ({ data: null, error: { message: 'deadlock detected', code: '40P01' } }),
    });
    const store = new SupabaseReplacementStateStore(fake.client);

    await store.save(SCENARIO, populatedState(), 'rev-token-a').then(
      () => expect.unreachable('a failed write must not resolve'),
      (err: unknown) => {
        expect(err).toBeInstanceOf(ReplacementStateStoreError);
        expect(err).not.toBeInstanceOf(ReplacementStateConflictError);
        if (err instanceof ReplacementStateStoreError) expect(err.code).toBe('40P01');
      },
    );
  });

  it('round trips: what save wrote is what the next turn loads', async () => {
    // The whole point of the layer — the next turn's "yes, make that update
    // now" has to find the proposal this turn offered.
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    const first = await store.load(SCENARIO);
    expect(first.state).toEqual(EMPTY_REPLACEMENT_STATE);
    await store.save(SCENARIO, populatedState(), first.revision);
    const reloaded = await store.load(SCENARIO);

    expect(reloaded.state).toEqual(populatedState());
    expect(reloaded.state.proposals.proposals.map((p) => p.id)).toEqual(['prop-1']);
    expect(reloaded.revision).not.toBeNull();
  });

  it("keys by scenario, so one scenario cannot read another one's proposals", async () => {
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    await store.save(SCENARIO, populatedState(), null);

    expect((await store.load('sc-someone-else')).state).toEqual(EMPTY_REPLACEMENT_STATE);
    expect((await store.load(SCENARIO)).state.proposals.proposals).toHaveLength(1);
  });
});

// ── contrast control 1: malformed vs unreachable ────────────────────────

describe('CONTRAST CONTROL: malformed data and an unreachable database are different paths', () => {
  it('the SAME unusable value resolves to empty as data, and throws as an error', async () => {
    // The discriminating pair. Everything is held constant except WHICH
    // field of the PostgREST envelope the value arrives in. A store that
    // collapsed the two — the tempting `try { … } catch { return EMPTY }` —
    // cannot make these two assertions disagree.
    const payload = { message: 'boom', code: 'PGRST500' };

    const asData = fakeClient({ read: () => ({ data: { state: payload }, error: null }) });
    await expect(
      new SupabaseReplacementStateStore(asData.client).load(SCENARIO),
    ).resolves.toEqual({ state: EMPTY_REPLACEMENT_STATE, revision: null });

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

    await expect(
      new SupabaseReplacementStateStore(fake.client).load(SCENARIO),
    ).resolves.toEqual({ state: EMPTY_REPLACEMENT_STATE, revision: null });
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

// ── contrast control 2: stale vs current token ──────────────────────────

describe('CONTRAST CONTROL: a stale write is refused and a current one is not', () => {
  it('the SAME store accepts the current token and refuses the stale one', async () => {
    // ⭐ THE DISCRIMINATING PAIR. A store that rejected EVERY save would
    // pass a rejection test on its own and be worthless. Here one store,
    // one scenario, one row, and ONLY the token varies — so the outcome is
    // provably the token's doing and not the store's mood.
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    await store.save(SCENARIO, populatedState(), null);
    const stale = (await store.load(SCENARIO)).revision;

    // Somebody else writes. `stale` now describes a row that no longer exists.
    const current = await store.save(SCENARIO, rivalState(), stale);
    expect(current).not.toBe(stale);

    // Arm A — the stale token. Must be REFUSED.
    await store.save(SCENARIO, populatedState(), stale).then(
      () => expect.unreachable('a write built from a stale read must not resolve'),
      (err: unknown) => expect(err).toBeInstanceOf(ReplacementStateConflictError),
    );

    // Arm B — the current token, everything else identical. Must SUCCEED.
    await expect(store.save(SCENARIO, populatedState(), current)).resolves.toEqual(
      expect.any(String),
    );
  });

  it('the loser does not destroy the winner: the surviving row is the winner\'s, by id', async () => {
    // The harm, reproduced and then asserted absent. Turn A and turn B both
    // read; A writes; B's OLDER snapshot must not overwrite it. Bound by
    // identity — the item and proposal ids — not by a count both states
    // would satisfy.
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);
    await store.save(SCENARIO, EMPTY_REPLACEMENT_STATE, null);

    const turnA = await store.load(SCENARIO);
    const turnB = await store.load(SCENARIO);
    expect(turnA.revision).toBe(turnB.revision); // both read the same row

    await store.save(SCENARIO, rivalState(), turnA.revision);
    await store
      .save(SCENARIO, populatedState(), turnB.revision)
      .catch((err: unknown) => expect(err).toBeInstanceOf(ReplacementStateConflictError));

    const survived = await store.load(SCENARIO);
    expect(survived.state.memory.items.map((i) => i.id)).toEqual(['item-rival']);
    expect(survived.state.proposals.proposals.map((p) => p.id)).toEqual(['prop-rival']);
    // And the loser's content is genuinely absent, not merely outnumbered.
    expect(JSON.stringify(survived.state)).not.toContain('item-1');
  });

  it('two first turns racing: one INSERT wins, the other is a conflict', async () => {
    // Both read no row, so both carry a null token. Without the primary key
    // doing the refusing, the second would silently replace the first.
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    const a = await store.load(SCENARIO);
    const b = await store.load(SCENARIO);
    expect(a.revision).toBeNull();
    expect(b.revision).toBeNull();

    await store.save(SCENARIO, rivalState(), a.revision);
    await store.save(SCENARIO, populatedState(), b.revision).then(
      () => expect.unreachable('the second first-turn write must not resolve'),
      (err: unknown) => expect(err).toBeInstanceOf(ReplacementStateConflictError),
    );

    expect((await store.load(SCENARIO)).state.memory.items.map((i) => i.id)).toEqual(['item-rival']);
  });

  it('a turn can save twice in a row against itself — the token chains', async () => {
    // The checkpoint-then-final pair, which is ORDINARY. If the returned
    // token were not the one written, a turn would conflict with itself and
    // no write would ever complete — a guard that rejects everything.
    const fake = statefulFake();
    const store = new SupabaseReplacementStateStore(fake.client);

    let revision = (await store.load(SCENARIO)).revision;
    revision = await store.save(SCENARIO, EMPTY_REPLACEMENT_STATE, revision);
    revision = await store.save(SCENARIO, populatedState(), revision);
    await expect(store.save(SCENARIO, rivalState(), revision)).resolves.toEqual(expect.any(String));

    expect((await store.load(SCENARIO)).state.memory.items.map((i) => i.id)).toEqual(['item-rival']);
  });
});
