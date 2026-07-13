/**
 * Context Architecture v2 — S4 rolling summary: the fire-and-forget
 * maintainer, driven with fakes (no network, deterministic).
 *
 * Containment proofs at the hook level:
 *  - MONOTONIC WRITE (R4): a FakeMonotonicStore mirroring the SQL WHERE clause
 *    proves a stale/out-of-order write is a no-op (the store guard is the real
 *    guarantee; the SQL implements this exact semantics — verified live once
 *    Paul executes the migration). The maintainer reports `regressed` honestly.
 *  - REJECT-AND-KEEP-PRIOR: off-contract summariser output never overwrites a
 *    good prior summary.
 *  - FLOOR when there is no prior: the summary is seeded, never left empty.
 *  - OFF-TURN-PATH NON-BLOCKING: model throw, store throw — the maintainer
 *    never rejects; the turn is unaffected.
 *  - REGEN reads FULL history: readRecent is called with the large explicit
 *    limit, not the 20-turn hot-path window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as telemetry from '../../../utils/telemetry.js';
import * as capture from '../capture.js';
import {
  maintainRollingSummaryForCommit,
  SUMMARY_FULL_HISTORY_READ_LIMIT,
} from '../capture.js';
import type { ConversationHistoryReader, MaintainerTurn } from '../capture.js';
import { buildDeterministicFloor } from '../deterministic-floor.js';
import type { RollingSummaryStorePort, UpsertRollingSummaryOutcome } from '../store-adapter.js';
import type { SummariserModel } from '../summariser.js';
import { SUMMARY_SCHEMA_VERSION } from '../summary-types.js';
import type { RollingSummary } from '../summary-types.js';

const SCENARIO = 'scenario-1';

function mkTurn(n: number, user = `user ${n}`): MaintainerTurn {
  return {
    turn_id: `turn-${n}`,
    created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    user_message: user,
    assistant_message: `assistant ${n}`,
  };
}

/** newest-first, as readRecent returns. */
function historyReader(turnsNewestFirst: MaintainerTurn[]): ConversationHistoryReader {
  return { readRecent: vi.fn(async () => turnsNewestFirst) };
}

function fakeModel(text: string): SummariserModel {
  return { summarise: vi.fn(async () => ({ text })) };
}
function throwingModel(): SummariserModel {
  return {
    summarise: vi.fn(async () => {
      throw new Error('upstream timeout');
    }),
  };
}

const VALID = [
  'DECISION FRAME: Choosing an HQ.',
  'CONSTRAINTS & PREFERENCES: Keep Berlin. [t1]',
  'RESOLVED: (none)',
  'OPEN: (none)',
].join('\n');

/** A store that records calls and returns a configurable outcome. */
class RecordingStore implements RollingSummaryStorePort {
  loadSummary = vi.fn<(id: string) => Promise<RollingSummary | null>>(async () => this.prior);
  upsertSummary = vi.fn<(id: string, s: RollingSummary) => Promise<UpsertRollingSummaryOutcome>>(
    async () => this.outcome,
  );
  constructor(
    public prior: RollingSummary | null = null,
    public outcome: UpsertRollingSummaryOutcome = {
      applied: true,
      regressed: false,
      current_watermark: 'x',
    },
  ) {}
}

/**
 * A JS APPROXIMATION of the SQL monotonic WHERE clause — COMPOSITE
 * (created_at, turn_id, version), mirroring the amended DRAFT migration
 * (Codex r2 fix 3): the store permits same-timestamp turns and totally orders
 * them (created_at, turn_id), so a timestamp-only guard would no-op the write
 * that absorbs a same-timestamp sibling, stranding that turn's content
 * forever. `version` breaks the tie when the watermark turn itself is
 * unchanged (a later pass that absorbed a smaller-id sibling under the same
 * watermark).
 *
 * FIDELITY / KNOWN DIVERGENCES (MINOR-2 — do not overclaim): this is a
 * behavioural approximation valid for the domain the session store actually
 * emits, NOT a byte-identical port of Postgres semantics. Specifically:
 *   - Timestamps compare as RAW ISO STRINGS (below), which equals the SQL
 *     timestamptz ordering ONLY for same-precision, normalized-ISO-UTC values
 *     (the store's `created_at` column). It does NOT reproduce timestamptz
 *     µs precision across mixed-precision strings; the earlier Date.parse form
 *     was strictly worse (it truncated µs to ms, turning a µs-ordered pair
 *     into a false tie that fell through to the turn_id branch).
 *   - turn_id compares by JS code unit, which equals C-collation byte order
 *     for the ASCII (uuid-style) turn ids in use — but NOT an arbitrary DB
 *     collation.
 *   - It models ONLY the monotonic no-op ({applied:false, regressed:true}).
 *     It does NOT model the RS001 shape guard or the 22007 bad-cast surface
 *     the live function raises on a malformed p_summary.
 * The live guard is verified only once Paul executes the migration.
 */
class FakeMonotonicStore implements RollingSummaryStorePort {
  stored: RollingSummary | null = null;
  async loadSummary(): Promise<RollingSummary | null> {
    return this.stored;
  }
  async upsertSummary(_id: string, s: RollingSummary): Promise<UpsertRollingSummaryOutcome> {
    const applied = this.stored === null || isStrictlyGreaterComposite(s, this.stored);
    if (applied) {
      this.stored = s;
      return { applied: true, regressed: false, current_watermark: s.updated_turn_created_at };
    }
    return { applied: false, regressed: true, current_watermark: this.stored!.updated_turn_created_at };
  }
}

/** Strict lexicographic tuple compare (created_at, turn_id, version) mirroring
 *  the SQL composite guard's "strictly greater" predicate. See the fidelity
 *  note on FakeMonotonicStore for the domain in which raw-string timestamp
 *  compare equals the live timestamptz ordering. */
function isStrictlyGreaterComposite(a: RollingSummary, b: RollingSummary): boolean {
  if (a.updated_turn_created_at !== b.updated_turn_created_at) {
    return a.updated_turn_created_at > b.updated_turn_created_at;
  }
  if (a.updated_turn_id !== b.updated_turn_id) {
    return a.updated_turn_id > b.updated_turn_id;
  }
  return a.version > b.version;
}

function emitSpy() {
  return vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
}
function updatedEvents(spy: ReturnType<typeof emitSpy>) {
  return spy.mock.calls
    .filter((c) => c[0] === telemetry.TelemetryEvents.V5SummaryUpdated)
    .map((c) => c[1] as Record<string, unknown>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Guarded call: exists once the single-flight fix lands (RED-first).
  capture.resetRollingSummarySingleFlightForTests?.();
});

describe('maintainRollingSummaryForCommit', () => {
  it('writes a parsed summary and reports applied', async () => {
    const spy = emitSpy();
    const store = new RecordingStore(null);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-3',
      persistedRowId: 'row-3',
      historyReader: historyReader([mkTurn(3), mkTurn(2), mkTurn(1)]),
      summaryStore: store,
      model: fakeModel(VALID),
    });
    expect(store.upsertSummary).toHaveBeenCalledOnce();
    const written = store.upsertSummary.mock.calls[0]![1];
    expect(written.updated_turn_id).toBe('turn-3'); // watermark = newest turn
    expect(written.slots.find((s) => s.slot === 'CONSTRAINTS')!.entries[0]!.source_turn_ids)
      .toEqual(['turn-1']); // provenance resolved
    expect(updatedEvents(spy)[0]!.status).toBe('applied');
  });

  it('REGEN reads the FULL history (large limit), not the 20-turn window', async () => {
    const reader = historyReader([mkTurn(1)]);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-1',
      persistedRowId: 'row-1',
      historyReader: reader,
      summaryStore: new RecordingStore(null),
      model: fakeModel(VALID),
    });
    expect(reader.readRecent).toHaveBeenCalledWith(SCENARIO, SUMMARY_FULL_HISTORY_READ_LIMIT);
  });

  it('MONOTONIC: a stale out-of-order write is a no-op — the fresh summary survives', async () => {
    const store = new FakeMonotonicStore();
    // Pass A absorbs through turn 5 (fresh).
    store.stored = null;
    await store.upsertSummary(SCENARIO, {
      text: 'fresh', slots: [], updated_turn_id: 'turn-5',
      updated_turn_created_at: mkTurn(5).created_at, version: 2, generator: 'incremental',
      schema_version: SUMMARY_SCHEMA_VERSION,
    });
    // Pass B is a STALE regen that only saw through turn 3 (older watermark).
    const outcome = await store.upsertSummary(SCENARIO, {
      text: 'stale', slots: [], updated_turn_id: 'turn-3',
      updated_turn_created_at: mkTurn(3).created_at, version: 3, generator: 'regen',
      schema_version: SUMMARY_SCHEMA_VERSION,
    });
    expect(outcome).toMatchObject({ applied: false, regressed: true });
    expect(store.stored!.text).toBe('fresh'); // never regressed
  });

  it('reports regressed when the store no-ops the write (out-of-order land)', async () => {
    const spy = emitSpy();
    const store = new RecordingStore(null, { applied: false, regressed: true, current_watermark: 'x' });
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO, turnId: 'turn-3', persistedRowId: 'row-3',
      historyReader: historyReader([mkTurn(3), mkTurn(2), mkTurn(1)]),
      summaryStore: store, model: fakeModel(VALID),
    });
    expect(updatedEvents(spy)[0]!.status).toBe('regressed');
  });

  it('REJECTS off-contract output and KEEPS the prior summary (no write)', async () => {
    const spy = emitSpy();
    const prior: RollingSummary = {
      text: 'GOOD PRIOR', slots: [], updated_turn_id: 'turn-2',
      updated_turn_created_at: mkTurn(2).created_at, version: 1, generator: 'regen',
      schema_version: SUMMARY_SCHEMA_VERSION,
    };
    const store = new RecordingStore(prior);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO, turnId: 'turn-3', persistedRowId: 'row-3',
      historyReader: historyReader([mkTurn(3), mkTurn(2)]),
      summaryStore: store, model: fakeModel('here is a nice summary for you'), // no labels → reject
    });
    expect(store.upsertSummary).not.toHaveBeenCalled(); // prior preserved
    expect(updatedEvents(spy)[0]!.status).toBe('rejected_kept_prior');
    expect(updatedEvents(spy)[0]!.reject_reason).toBe('content_before_label');
  });

  it('SEEDS the deterministic floor when output is rejected and there is no prior', async () => {
    const store = new RecordingStore(null);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO, turnId: 'turn-1', persistedRowId: 'row-1',
      historyReader: historyReader([mkTurn(1, 'Decide between A and B please.')]),
      summaryStore: store, model: fakeModel('garbage no labels'),
      briefText: null,
    });
    expect(store.upsertSummary).toHaveBeenCalledOnce();
    expect(store.upsertSummary.mock.calls[0]![1].generator).toBe('floor');
  });

  it('NON-BLOCKING: a model throw keeps the prior and never rejects', async () => {
    const spy = emitSpy();
    const prior: RollingSummary = {
      text: 'GOOD PRIOR', slots: [], updated_turn_id: 'turn-2',
      updated_turn_created_at: mkTurn(2).created_at, version: 1, generator: 'regen',
      schema_version: SUMMARY_SCHEMA_VERSION,
    };
    const store = new RecordingStore(prior);
    await expect(
      maintainRollingSummaryForCommit({
        scenarioId: SCENARIO, turnId: 'turn-3', persistedRowId: 'row-3',
        historyReader: historyReader([mkTurn(3), mkTurn(2)]),
        summaryStore: store, model: throwingModel(),
      }),
    ).resolves.toBeUndefined();
    expect(store.upsertSummary).not.toHaveBeenCalled();
    expect(updatedEvents(spy)[0]!.status).toBe('model_error_kept_prior');
  });

  it('NON-BLOCKING: a store read throw is swallowed (status error, no rejection)', async () => {
    const spy = emitSpy();
    const store: RollingSummaryStorePort = {
      loadSummary: vi.fn(async () => {
        throw new Error('rpc not found');
      }),
      upsertSummary: vi.fn(),
    };
    await expect(
      maintainRollingSummaryForCommit({
        scenarioId: SCENARIO, turnId: 'turn-3', persistedRowId: 'row-3',
        historyReader: historyReader([mkTurn(3)]),
        summaryStore: store, model: fakeModel(VALID),
      }),
    ).resolves.toBeUndefined();
    expect(updatedEvents(spy)[0]!.status).toBe('error');
  });

  it('no turns ⇒ no model call, status no_turns', async () => {
    const spy = emitSpy();
    const model = fakeModel(VALID);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO, turnId: 'turn-1', persistedRowId: 'row-1',
      historyReader: historyReader([]),
      summaryStore: new RecordingStore(null), model,
    });
    expect(model.summarise).not.toHaveBeenCalled();
    expect(updatedEvents(spy)[0]!.status).toBe('no_turns');
  });
});

// ---------------------------------------------------------------------------
// Codex r2 blocker 2 — SILENT SLOT ERASURE: a summariser response that drops
// one of the four slots must be rejected (kept-prior), never accepted with
// the missing slot rendered "(none)" over prior memory.
// ---------------------------------------------------------------------------

describe('maintainRollingSummaryForCommit — slot completeness', () => {
  it('a 3-slot response KEEPS the prior summary (no write, rejected_kept_prior)', async () => {
    const spy = emitSpy();
    const prior: RollingSummary = {
      text: 'DECISION FRAME: prior.\nCONSTRAINTS & PREFERENCES: Keep Berlin.\nRESOLVED: (none)\nOPEN: (none)',
      slots: [
        { slot: 'FRAME', entries: [{ text: 'prior.', source_turn_ids: [] }] },
        { slot: 'CONSTRAINTS', entries: [{ text: 'Keep Berlin.', source_turn_ids: ['turn-1'] }] },
        { slot: 'RESOLVED', entries: [] },
        { slot: 'OPEN', entries: [] },
      ],
      updated_turn_id: 'turn-2',
      updated_turn_created_at: mkTurn(2).created_at,
      version: 1,
      generator: 'regen',
      schema_version: SUMMARY_SCHEMA_VERSION,
    };
    const store = new RecordingStore(prior);
    // Missing CONSTRAINTS — pre-fix this was ACCEPTED and assemble.ts wrote
    // CONSTRAINTS as "(none)", erasing "Keep Berlin." from memory.
    const threeSlots = ['DECISION FRAME: Choosing an HQ.', 'RESOLVED: (none)', 'OPEN: (none)'].join('\n');
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-3',
      persistedRowId: 'row-3',
      historyReader: historyReader([mkTurn(3), mkTurn(2)]),
      summaryStore: store,
      model: fakeModel(threeSlots),
    });
    expect(store.upsertSummary).not.toHaveBeenCalled();
    expect(updatedEvents(spy)[0]!.status).toBe('rejected_kept_prior');
    expect(updatedEvents(spy)[0]!.reject_reason).toBe('missing_slot');
  });
});

// ---------------------------------------------------------------------------
// Codex r2 fix 4a — HISTORY-CAP HONESTY: when the full-history read fills the
// cap, the "full history" is not full; the stored summary must say so rather
// than claim silent completeness.
// ---------------------------------------------------------------------------

describe('maintainRollingSummaryForCommit — history-cap honesty', () => {
  it('a read that fills the cap marks the summary history_capped with an in-text disclosure', async () => {
    const turns: MaintainerTurn[] = [];
    for (let n = SUMMARY_FULL_HISTORY_READ_LIMIT; n >= 1; n--) turns.push(mkTurn(n, 'u'));
    const store = new RecordingStore(null);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: `turn-${SUMMARY_FULL_HISTORY_READ_LIMIT}`,
      persistedRowId: 'row-x',
      historyReader: historyReader(turns),
      summaryStore: store,
      model: fakeModel(VALID),
    });
    expect(store.upsertSummary).toHaveBeenCalledOnce();
    const written = store.upsertSummary.mock.calls[0]![1];
    expect(written.history_capped).toBe(true);
    expect(written.text).toContain(String(SUMMARY_FULL_HISTORY_READ_LIMIT));
    expect(written.text.toLowerCase()).toContain('earlier turns');
  });

  it('an uncapped read stores no history_capped marker (byte-stable)', async () => {
    const store = new RecordingStore(null);
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-3',
      persistedRowId: 'row-3',
      historyReader: historyReader([mkTurn(3), mkTurn(2), mkTurn(1)]),
      summaryStore: store,
      model: fakeModel(VALID),
    });
    const written = store.upsertSummary.mock.calls[0]![1];
    expect('history_capped' in written).toBe(false);
    expect(written.text.toLowerCase()).not.toContain('most recent');
  });
});

// ---------------------------------------------------------------------------
// Codex r2 fix 4b — SINGLE-FLIGHT / COALESCING: commit.ts fires one
// independent job per commit; concurrent commits for one scenario must not
// stampede the model/store. In-process per-scenario single-flight with
// latest-wins coalescing (the monotonic write already prevents regressions —
// this is waste + race pressure).
// ---------------------------------------------------------------------------

describe('maintainRollingSummaryForCommit — per-scenario single-flight', () => {
  function gatedModel() {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const model: SummariserModel = {
      summarise: vi.fn(async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
        return { text: VALID };
      }),
    };
    return { model, release, stats: () => ({ maxActive, calls }) };
  }

  it('three concurrent commits for one scenario → one in-flight pass + ONE coalesced rerun', async () => {
    const { model, release, stats } = gatedModel();
    const store = new RecordingStore(null);
    const mk = (turn: string) =>
      maintainRollingSummaryForCommit({
        scenarioId: SCENARIO,
        turnId: turn,
        persistedRowId: `row-${turn}`,
        historyReader: historyReader([mkTurn(3), mkTurn(2), mkTurn(1)]),
        summaryStore: store,
        model,
      });
    const p1 = mk('turn-1');
    const p2 = mk('turn-2');
    const p3 = mk('turn-3');
    // Let the coalesced callers return while the first pass is still gated.
    await Promise.all([p2, p3]);
    release();
    await p1;
    const s = stats();
    expect(s.maxActive).toBe(1); // never two concurrent passes per scenario
    expect(s.calls).toBe(2); // first pass + ONE coalesced rerun (latest-wins)
  });

  it('different scenarios are NOT serialised against each other', async () => {
    const { model, release, stats } = gatedModel();
    const store = new RecordingStore(null);
    const mk = (scenario: string) =>
      maintainRollingSummaryForCommit({
        scenarioId: scenario,
        turnId: 'turn-1',
        persistedRowId: 'row-1',
        historyReader: historyReader([mkTurn(1)]),
        summaryStore: store,
        model,
      });
    const pa = mk('scenario-A');
    const pb = mk('scenario-B');
    // Both scenarios should reach the model concurrently.
    await vi.waitFor(() => expect(stats().maxActive).toBe(2));
    release();
    await Promise.all([pa, pb]);
    expect(stats().calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Codex r2 fix 3 — COMPOSITE WATERMARK reference semantics (the JS mirror of
// the amended DRAFT SQL guard; the live guard is verified once Paul executes
// the migration).
// ---------------------------------------------------------------------------

describe('FakeMonotonicStore — composite (created_at, turn_id, version) guard', () => {
  const base = (over: Partial<RollingSummary>): RollingSummary => ({
    text: 'x',
    slots: [],
    updated_turn_id: 'turn-5',
    updated_turn_created_at: mkTurn(5).created_at,
    version: 2,
    generator: 'incremental',
    schema_version: SUMMARY_SCHEMA_VERSION,
    ...over,
  });

  it('same timestamp + same watermark turn + higher version → APPLIES (sibling absorbed)', async () => {
    const store = new FakeMonotonicStore();
    await store.upsertSummary(SCENARIO, base({ text: 'before sibling' }));
    const outcome = await store.upsertSummary(
      SCENARIO,
      base({ text: 'after sibling', version: 3 }),
    );
    expect(outcome.applied).toBe(true);
    expect(store.stored!.text).toBe('after sibling');
  });

  it('same timestamp + lexicographically newer watermark turn → APPLIES', async () => {
    const store = new FakeMonotonicStore();
    await store.upsertSummary(SCENARIO, base({}));
    const outcome = await store.upsertSummary(
      SCENARIO,
      base({ updated_turn_id: 'turn-6', version: 3 }),
    );
    expect(outcome.applied).toBe(true);
  });

  it('identical composite (retry of the same write) → no-op', async () => {
    const store = new FakeMonotonicStore();
    await store.upsertSummary(SCENARIO, base({}));
    const outcome = await store.upsertSummary(SCENARIO, base({}));
    expect(outcome).toMatchObject({ applied: false, regressed: true });
  });
});

// ---------------------------------------------------------------------------
// M1 — a stored FLOOR is never an incremental base. The floor absorbed NO
// history (brief/goal only). Building incrementally on it (its watermark is
// the newest turn) would only show turns AFTER the floor and strand every
// pre-floor turn's content out of the summary until the next horizon regen —
// a maintain-path memory hole. shouldRegenerate must treat a floor prior as
// REGEN so the next pass re-reads and absorbs the FULL conversation.
// ---------------------------------------------------------------------------

describe('maintainRollingSummaryForCommit — a floor prior forces a full regen (M1)', () => {
  it('the next pass regenerates from FULL history (re-reads pre-floor turns), writes generator regen', async () => {
    const floorPrior = buildDeterministicFloor({
      briefText: 'Decide HQ.',
      goalLabel: null,
      // Floor was stamped at turn-1 (the only turn at first-ever failure).
      watermark: { turn_id: 'turn-1', created_at: mkTurn(1).created_at },
      version: 1,
      latestUserMessage: 'keep the Berlin office',
    });
    const store = new RecordingStore(floorPrior);
    const summarise = vi.fn(async (_userMessage: string) => ({ text: VALID }));
    const model: SummariserModel = { summarise };
    await maintainRollingSummaryForCommit({
      scenarioId: SCENARIO,
      turnId: 'turn-3',
      persistedRowId: 'row-3',
      historyReader: historyReader([mkTurn(3), mkTurn(2), mkTurn(1)]),
      summaryStore: store,
      model,
    });
    const input = summarise.mock.calls[0]![0];
    // A REGEN over the full history — NOT an incremental that only shows the
    // post-floor turns. Pre-floor turn-1's content IS re-read.
    expect(input).toContain('## Full conversation (oldest first)');
    expect(input).toContain('user 1');
    const written = store.upsertSummary.mock.calls[0]![1];
    expect(written.generator).toBe('regen');
    expect(written.updated_turn_id).toBe('turn-3');
  });
});

// ---------------------------------------------------------------------------
// MINOR-1 — latest-wins coalescing must PRESERVE briefText. The brief arrives
// only on the brief-carrying turn and is NOT re-readable from history; a later
// commit (no brief) coalescing over the brief-carrying pass must still
// summarise WITH the brief (contradicts the pre-fix capture.ts:117 invariant).
// ---------------------------------------------------------------------------

describe('maintainRollingSummaryForCommit — coalescing preserves briefText (MINOR-1)', () => {
  it('a brief-less commit coalescing over a brief-carrying pass keeps the brief in the rerun', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inputs: string[] = [];
    let calls = 0;
    const summarise = vi.fn(async (userMessage: string) => {
      inputs.push(userMessage);
      calls += 1;
      if (calls === 1) await gate; // hold the first (brief-carrying) pass in flight
      return { text: VALID };
    });
    const model: SummariserModel = { summarise };
    const store = new RecordingStore(null);
    const mk = (turn: string, briefText?: string | null) =>
      maintainRollingSummaryForCommit({
        scenarioId: SCENARIO,
        turnId: turn,
        persistedRowId: `row-${turn}`,
        historyReader: historyReader([mkTurn(2), mkTurn(1)]),
        summaryStore: store,
        model,
        briefText,
      });
    const p1 = mk('turn-1', 'KEEP-BERLIN-BRIEF'); // brief-carrying turn, held in flight
    const p2 = mk('turn-2', undefined); // later commit, NO brief → coalesces
    await p2; // the coalesced caller returns immediately
    release();
    await p1;
    expect(calls).toBe(2); // first pass + one coalesced rerun
    // The rerun MUST still carry the brief text even though its own commit
    // (turn-2) had none.
    expect(inputs[1]).toContain('KEEP-BERLIN-BRIEF');
  });
});
