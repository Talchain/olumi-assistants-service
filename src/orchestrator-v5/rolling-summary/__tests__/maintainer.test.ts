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
import {
  maintainRollingSummaryForCommit,
  SUMMARY_FULL_HISTORY_READ_LIMIT,
} from '../capture.js';
import type { ConversationHistoryReader, MaintainerTurn } from '../capture.js';
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

/** A JS reference implementation of the SQL monotonic WHERE clause. */
class FakeMonotonicStore implements RollingSummaryStorePort {
  stored: RollingSummary | null = null;
  async loadSummary(): Promise<RollingSummary | null> {
    return this.stored;
  }
  async upsertSummary(_id: string, s: RollingSummary): Promise<UpsertRollingSummaryOutcome> {
    const storedMs = this.stored ? Date.parse(this.stored.updated_turn_created_at) : -Infinity;
    const newMs = Date.parse(s.updated_turn_created_at);
    if (newMs > storedMs) {
      this.stored = s;
      return { applied: true, regressed: false, current_watermark: s.updated_turn_created_at };
    }
    return { applied: false, regressed: true, current_watermark: this.stored!.updated_turn_created_at };
  }
}

function emitSpy() {
  return vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
}
function updatedEvents(spy: ReturnType<typeof emitSpy>) {
  return spy.mock.calls
    .filter((c) => c[0] === telemetry.TelemetryEvents.V5SummaryUpdated)
    .map((c) => c[1] as Record<string, unknown>);
}

beforeEach(() => vi.restoreAllMocks());

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
